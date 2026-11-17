// ĐĂNG KÝ VÂN TAY / KHUÔN MẶT TỪ XA: người quản lý ngồi văn phòng bấm nút ở tab Sinh trắc của NV → máy chấm công ở xa
// hiện màn hình chờ, NV đứng tại máy đặt ngón / nhìn vào máy là đăng ký xong, mẫu về phần mềm rồi chép sang máy cùng nhóm.
//  - Máy ZKTeco đẩy về máy chủ (ADMS): lệnh ENROLL_FP (vân tay) / ENROLL_BIO (khuôn mặt) đi qua hàng lệnh như mọi lệnh khác.
//    Máy nhận ở lần hỏi lệnh kế tiếp (~10 giây), đăng ký xong báo kết quả ở /devicecmd và tự gửi mẫu (FP / BIODATA) về
//    → storeTemplates + đồng bộ nhóm sẵn có lo phần còn lại. Đời máy không hiểu ENROLL_FP thì thử ENROLL_BIO TYPE=1.
//  - Máy ZKTeco kết nối TCP/IP: SDK StartEnrollEx (zk-tcp.ps1 'enroll'), KHÔNG hỏi máy trong lúc đăng ký (máy thoát màn hình đăng ký),
//    nghe sự kiện máy báo hoặc chờ yên hết giờ rồi đọc mẫu về. Chỉ vân tay.
//  - Máy Hikvision: ISAPI CaptureFingerPrint (máy bật đầu đọc chờ ngón, trả mẫu) / CaptureFaceData (máy chụp mặt, trả ảnh)
//    → phần mềm ghi mẫu / ảnh vào đúng người trên máy đó + chép sang máy Hikvision cùng nhóm đồng bộ.
// Việc chạy nền bằng startJob (giao diện hỏi tiến độ ở /admin/devices/tcp-jobs/:job, như các việc máy khác).
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { db } from './db.js';
import { buildUserCommand, deviceOnline, storeTemplates, upsertDeviceUserSerial, syncPinsToGroup, cmdErrText } from './device-sync.js';
import { pmNameFor } from './pin-guard.js';
import { tcpEnabled, tcpProbe, tcpInfo, zkRun, startJob } from './zk-tcp.js';
import { hikEnabled, isapi, hikPushUsers, hikWriteFace, HIK_FACE_MAX } from './hik-isapi.js';
import { hikListPeople, hikWriteFingers, saveHikPhoto, hikSyncGroup } from './hik-sync.js';

// Số ngón theo quy ước ZKTeco (FID 0–9). Hikvision đánh số 1–10 → FID + 1.
export const FINGERS = ['Ngón út trái', 'Ngón áp út trái', 'Ngón giữa trái', 'Ngón trỏ trái', 'Ngón cái trái',
  'Ngón cái phải', 'Ngón trỏ phải', 'Ngón giữa phải', 'Ngón áp út phải', 'Ngón út phải'];
export const fingerName = (fid) => FINGERS[fid] || `Ngón số ${fid}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowDb = () => db.prepare("SELECT datetime('now') t").get().t;
// Thời gian chờ (đổi được khi kiểm thử)
export const ENROLL_WAIT = { sendMs: 120000, answerMs: 150000, tmplMs: 30000, tickMs: 1000 };

// Máy dùng được đăng ký từ xa: { fp, face } theo loại kết nối. Máy AI / Union chưa hỗ trợ.
export function enrollSupport(d) {
  if (d.conn_type === 'push') return { fp: true, face: true };
  if (d.conn_type === 'tcp') return tcpEnabled() ? { fp: true, face: false } : null;
  if (d.conn_type === 'hik') return hikEnabled() ? { fp: true, face: true } : null;
  return null;
}
export function enrollDevices(pin) {
  const onDev = db.prepare('SELECT 1 FROM device_users_serial WHERE serial=? AND pin=?');
  return db.prepare("SELECT * FROM push_devices WHERE active=1 ORDER BY name, serial").all()
    .map((d) => ({ d, s: enrollSupport(d) })).filter((x) => x.s)
    .map(({ d, s }) => ({ serial: d.serial, name: d.name || d.serial, conn_type: d.conn_type, fp: s.fp, face: s.face,
      online: d.conn_type === 'push' ? deviceOnline(d.last_seen) : null, onDevice: !!(pin && onDev.get(d.serial, pin)) }));
}

/* ---------- máy ZKTeco ADMS ---------- */
// Mã máy trả ở /devicecmd. Số âm = mã lỗi chung của giao thức PUSH; số dương = đăng ký không thành công (đặt ngón chưa đạt,
// hết thời gian chờ, bấm huỷ trên máy… — tài liệu hãng không thống nhất từng mã giữa các đời máy nên không đoán nghĩa).
export function enrollErr(code) {
  const c = String(code ?? '').trim();
  if (parseInt(c, 10) < 0) return `máy báo lỗi ${c}: ${cmdErrText(c)}`;
  return `đăng ký không thành công (máy báo mã ${c || '?'}). Thường do đặt ngón / nhìn chưa đạt, hết thời gian chờ hoặc bấm huỷ trên máy — bấm đăng ký lại.`;
}
// Các kiểu lệnh thử lần lượt (kiểu sau chỉ dùng khi máy báo không hiểu kiểu trước)
export function enrollCommands(pin, kind, fid, faceType = 9) {
  if (kind === 'fp') return [`ENROLL_FP PIN=${pin}\tFID=${fid}\tRETRY=3\tOVERWRITE=1`, `ENROLL_BIO TYPE=1\tPIN=${pin}\tFID=${fid}\tRETRY=3\tOVERWRITE=1`];
  const other = faceType === 2 ? 9 : 2;
  return [`ENROLL_BIO TYPE=${faceType}\tPIN=${pin}\tRETRY=3\tOVERWRITE=1`, `ENROLL_BIO TYPE=${other}\tPIN=${pin}\tRETRY=3\tOVERWRITE=1`];
}
// Máy đang dùng khuôn mặt loại nào (9 = mặt ánh sáng thường đời mới, 2 = mặt hồng ngoại đời cũ) — theo mẫu đã có trên máy
function faceTypeOf(serial) {
  const r = db.prepare('SELECT bio_type, COUNT(*) c FROM device_bio_templates WHERE serial=? AND bio_type IN (2,9) GROUP BY bio_type ORDER BY c DESC LIMIT 1').get(serial);
  return r ? r.bio_type : 9;
}
const UNKNOWN_CMD = new Set([-1, -1002]);
// Chờ 1 lệnh: máy lấy lệnh (trans_time) rồi báo kết quả (response_at). Trả mã máy báo (chuỗi).
async function waitCmd(id, onSent) {
  const q = db.prepare('SELECT trans_time, response_at, TRIM(return_value) ret FROM push_device_commands WHERE id=?');
  const t0 = Date.now();
  let sentAt = 0;
  for (;;) {
    await sleep(ENROLL_WAIT.tickMs);
    const c = q.get(id);
    if (!c) throw new Error('Lệnh đăng ký đã bị huỷ.');
    if (c.response_at) return c.ret ?? '';
    if (c.trans_time && !sentAt) { sentAt = Date.now(); onSent(); }
    if (!sentAt && Date.now() - t0 > ENROLL_WAIT.sendMs) {
      db.prepare('DELETE FROM push_device_commands WHERE id=? AND trans_time IS NULL').run(id);
      throw Object.assign(new Error(`Máy chưa nhận lệnh sau ${Math.round(ENROLL_WAIT.sendMs / 60000)} phút — kiểm tra máy còn kết nối về phần mềm. Đã huỷ lệnh.`), { code: 'NOSEND' });
    }
    if (sentAt && Date.now() - sentAt > ENROLL_WAIT.answerMs)
      throw Object.assign(new Error('Máy đã nhận lệnh nhưng chưa báo kết quả. Nếu máy không hiện màn hình đăng ký thì đời máy này chưa hỗ trợ đăng ký từ xa — đăng ký trực tiếp trên máy.'), { code: 'NOANSWER' });
  }
}
export async function admsEnroll(dev, pin, kind, fid, prog = () => {}) {
  if (!deviceOnline(dev.last_seen)) throw new Error('Máy đang mất kết nối với phần mềm (quá 2,5 phút không gọi về) — bật máy / kiểm tra mạng rồi thử lại.');
  const onDev = db.prepare('SELECT 1 FROM device_users_serial WHERE serial=? AND pin=?').get(dev.serial, pin);
  const ins = db.prepare('INSERT INTO push_device_commands(serial,content,pin,mkind) VALUES(?,?,?,?)');
  if (!onDev) ins.run(dev.serial, buildUserCommand(pin, dev.serial, null, true), pin, 'user');   // máy phải có NV trước mới đăng ký được
  const what = kind === 'fp' ? fingerName(fid) : 'khuôn mặt';
  const t0 = nowDb();
  const cmds = enrollCommands(pin, kind, fid, faceTypeOf(dev.serial));
  let ok = false;
  for (let i = 0; i < cmds.length && !ok; i++) {
    prog(i ? 'Máy không hiểu kiểu lệnh trước — đang thử kiểu lệnh khác…' : `Đang chờ máy nhận lệnh (máy hỏi lệnh khoảng 10 giây/lần)…`);
    const id = Number(ins.run(dev.serial, cmds[i], pin, 'enroll').lastInsertRowid);
    const ret = await waitCmd(id, () => prog(kind === 'fp'
      ? `Máy đã vào màn hình đăng ký — mời nhân viên đặt ${what.toLowerCase()} lên máy (thường 3 lần, nhấc lên đặt lại khi máy báo).`
      : 'Máy đã vào màn hình đăng ký — mời nhân viên đứng trước máy, nhìn thẳng vào camera tới khi máy báo xong.'));
    if (ret === '0') { ok = true; break; }
    if (i < cmds.length - 1 && UNKNOWN_CMD.has(parseInt(ret, 10))) continue;
    throw Object.assign(new Error(enrollErr(ret)), { code: 'ENROLL' });
  }
  // máy báo xong → chờ mẫu về (máy gửi qua OPERLOG / BIODATA ngay sau khi đăng ký)
  prog('Máy báo đăng ký xong — đang chờ máy gửi mẫu về phần mềm…');
  const types = kind === 'fp' ? '1' : '2,9';
  const q = db.prepare(`SELECT 1 FROM device_bio_templates WHERE serial=? AND pin=? AND bio_type IN (${types})${kind === 'fp' ? ' AND idx=?' : ''} AND received_at>=? LIMIT 1`);
  const end = Date.now() + ENROLL_WAIT.tmplMs;
  let got = false;
  while (!got && Date.now() < end) { await sleep(ENROLL_WAIT.tickMs); got = !!(kind === 'fp' ? q.get(dev.serial, pin, fid, t0) : q.get(dev.serial, pin, t0)); }
  return { device: dev.name || dev.serial, kind, fid, what, received: got,
    note: got ? 'Mẫu đã về phần mềm, máy cùng nhóm đồng bộ sẽ tự nhận.' : 'Máy đã đăng ký xong nhưng chưa gửi mẫu về — mẫu sẽ về khi máy gửi dữ liệu đợt sau.' };
}

/* ---------- máy ZKTeco TCP/IP (SDK) ---------- */
// Máy TCP/IP: trong lúc máy đang đăng ký phần mềm không được hỏi máy → chờ người quản lý bấm "Nhân viên đã đặt xong"
// (tạo file báo hiệu, script thấy file thì đọc mẫu ngay) hoặc hết giờ. job id → file báo hiệu.
const signals = new Map();
export function finishEnroll(jobId) {
  const f = signals.get(String(jobId));
  if (!f) return false;
  try { writeFileSync(f, '1'); return true; } catch { return false; }
}
export async function tcpEnroll(dev, pin, kind, fid, prog = () => {}, sig = '') {
  if (kind !== 'fp') throw new Error('Máy kết nối TCP/IP hiện mới đăng ký từ xa được VÂN TAY. Khuôn mặt: tải ảnh nhân viên lên rồi đẩy xuống máy.');
  if (!(await tcpProbe(dev.tcp_ip, dev.tcp_port))) throw new Error(`Không thấy máy ở ${dev.tcp_ip}:${dev.tcp_port} — kiểm tra máy đã bật và cùng mạng LAN với máy chủ phần mềm.`);
  const info = await tcpInfo(dev);
  if (info.serial && info.serial !== dev.serial) throw new Error(`IP ${dev.tcp_ip} giờ là máy khác (Serial ${info.serial}) — bỏ qua cho an toàn.`);
  const name = (pmNameFor(pin, true) || db.prepare('SELECT name FROM device_users WHERE pin=?').get(pin)?.name || pin).slice(0, 24);
  const what = fingerName(fid);
  prog('Đang kết nối máy, chuẩn bị màn hình đăng ký…');
  const lines = [];
  let ver = '';
  await zkRun(dev, 'enroll', { from: pin, to: String(fid), opt: name, sig, timeoutMs: 180000 }, (k, c) => {
    if (k === 'W' && c[0] === 'started') prog(`Máy đã vào màn hình đăng ký — mời nhân viên đặt ${what.toLowerCase()} lên máy (thường 3 lần). Máy báo xong thì bấm "Nhân viên đã đặt xong" (không bấm thì phần mềm tự đọc sau khoảng 75 giây).`);
    if (k === 'F' && c[0] && c[4]) {
      const [p, idx, flag, v, tmp] = c; ver = v;
      lines.push(v === '10' ? `BIODATA Pin=${p}\tNo=${idx}\tIndex=${idx}\tValid=1\tDuress=${flag === '3' ? 1 : 0}\tType=1\tMajorVer=10\tMinorVer=0\tFormat=0\tTmp=${tmp}`
        : `FP PIN=${p}\tFID=${idx}\tSize=${tmp.length}\tValid=1\tTMP=${tmp}`);
    }
  });
  if (!lines.length) throw new Error('Máy báo xong nhưng không đọc được mẫu vân tay vừa đăng ký — bấm Tải nhân viên (kèm vân tay) để lấy lại.');
  upsertDeviceUserSerial(dev.serial, pin, name, '');
  storeTemplates(dev.serial, ver === '10' ? 'BIODATA' : 'FP', lines.join('\n'));
  try { syncPinsToGroup(dev.serial, new Set([pin])); } catch (e) { console.error('[enroll] đồng bộ nhóm lỗi:', e.message); }
  return { device: dev.name || dev.serial, kind, fid, what, received: true, note: 'Mẫu đã về phần mềm.' };
}

/* ---------- máy Hikvision (ISAPI) ---------- */
const NS = 'version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"';
const tag = (xml, t) => ((new RegExp(`<${t}>([^<]*)</${t}>`).exec(String(xml || '')) || [])[1] || '').trim();
// Ảnh JPG nằm trong dữ liệu máy trả (có máy trả multipart: phần XML + phần ảnh)
export function jpgIn(buf) {
  if (!buf || buf.length < 100) return null;
  const a = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
  if (a < 0) return null;
  const b = buf.lastIndexOf(Buffer.from([0xff, 0xd9]));
  return b > a ? buf.subarray(a, b + 2) : null;
}
const notSupported = (e) => e.code === 'ISAPI' && (e.status === 404 || e.status === 405 || /notSupport|invalidOperation|methodNotAllowed/i.test(e.message));
// Máy bật đầu đọc chờ ngón → trả { data, no, quality }
export async function hikCaptureFinger(dev, fid) {
  let r;
  try {
    r = await isapi(dev, 'POST', '/ISAPI/AccessControl/CaptureFingerPrint',
      `<CaptureFingerPrintCond ${NS}><fingerNo>${fid + 1}</fingerNo></CaptureFingerPrintCond>`, { timeoutMs: 90000 });
  } catch (e) {
    if (notSupported(e)) throw Object.assign(new Error('Máy Hikvision này không hỗ trợ lấy vân tay từ xa (hoặc không có đầu đọc vân tay).'), { code: 'NOFP' });
    throw e;
  }
  const data = tag(r.text, 'fingerData') || r.json?.CaptureFingerPrint?.fingerData || '';
  if (!data) throw Object.assign(new Error('Máy không trả mẫu vân tay (nhân viên chưa đặt ngón kịp, hoặc mẫu kém) — bấm đăng ký lại.'), { code: 'ENROLL' });
  return { data, no: parseInt(tag(r.text, 'fingerNo'), 10) || fid + 1, quality: parseInt(tag(r.text, 'fingerPrintQuality'), 10) || null };
}
// Máy chụp khuôn mặt → ảnh JPG. Máy trả thẳng ảnh (multipart) hoặc đường dẫn ảnh (faceDataUrl), có máy trả tiến độ phải hỏi lại.
async function hikGetUrl(dev, url) {
  let p = url;
  try { const u = new URL(url); p = u.pathname + u.search; } catch {}
  const g = await isapi(dev, 'GET', p, null, { timeoutMs: 30000 });
  return jpgIn(g.buf);
}
export async function hikCaptureFace(dev, prog = () => {}) {
  let r;
  try {
    r = await isapi(dev, 'POST', '/ISAPI/AccessControl/CaptureFaceData',
      `<CaptureFaceDataCond ${NS}><captureInfrared>false</captureInfrared><dataType>url</dataType></CaptureFaceDataCond>`, { timeoutMs: 90000 });
  } catch (e) {
    if (notSupported(e)) throw Object.assign(new Error('Máy Hikvision này không hỗ trợ chụp khuôn mặt từ xa — dùng "Tải ảnh khuôn mặt lên" rồi đẩy xuống máy.'), { code: 'NOFACE' });
    throw e;
  }
  for (let i = 0; i < 40; i++) {
    const img = jpgIn(r.buf);
    if (img) return img;
    const url = tag(r.text, 'faceDataUrl');
    if (url) { const g = await hikGetUrl(dev, url); if (g) return g; throw Object.assign(new Error('Không tải được ảnh khuôn mặt máy vừa chụp.'), { code: 'ENROLL' }); }
    const err = tag(r.text, 'errorMsg') || tag(r.text, 'errorCode');
    if (tag(r.text, 'isCurRequestOver') === 'true' || err) throw Object.assign(new Error('Máy không chụp được khuôn mặt' + (err ? ` (${err})` : '') + ' — bấm đăng ký lại.'), { code: 'ENROLL' });
    const pct = tag(r.text, 'captureProgress');
    if (pct) prog(`Máy đang chụp khuôn mặt… ${pct}%`);
    await sleep(1500);
    r = await isapi(dev, 'GET', '/ISAPI/AccessControl/CaptureFaceData/Progress', null, { timeoutMs: 20000 });
  }
  throw Object.assign(new Error('Hết thời gian chờ máy chụp khuôn mặt — bấm đăng ký lại.'), { code: 'ENROLL' });
}
export async function hikEnroll(dev, pin, kind, fid, prog = () => {}) {
  const name = pmNameFor(pin, true) || db.prepare('SELECT name FROM device_users WHERE pin=?').get(pin)?.name || pin;
  // Chỉ ghi người khi máy CHƯA có (người đã có trên máy giữ nguyên quyền cửa / hạn dùng đang cài, kể cả do nền tảng khác quản lý)
  const has = await hikListPeople(dev, [pin]);
  if (!has.has(pin)) {
    prog('Máy chưa có nhân viên này — đang ghi nhân viên xuống máy…');
    const w = await hikPushUsers(dev, [pin]);
    if (!w.pushed) throw new Error('Không ghi được nhân viên xuống máy: ' + (w.errors?.[0] || 'lỗi không rõ'));
  }
  const what = kind === 'fp' ? fingerName(fid) : 'khuôn mặt';
  let extra = {};
  if (kind === 'fp') {
    prog(`Máy đang chờ — mời nhân viên đặt ${what.toLowerCase()} lên đầu đọc vân tay của máy.`);
    const f = await hikCaptureFinger(dev, fid);
    prog('Đã lấy được vân tay — đang lưu vào máy…');
    await hikWriteFingers(dev, pin, [{ id: f.no, type: 'normalFP', data: f.data }], {});
    extra = { quality: f.quality };
  } else {
    prog('Máy đang chờ — mời nhân viên đứng trước máy, nhìn thẳng vào camera.');
    const img = await hikCaptureFace(dev, prog);
    if (img.length > HIK_FACE_MAX) throw new Error(`Ảnh máy chụp ${Math.round(img.length / 1024)} KB, quá cỡ máy nhận (200 KB).`);
    prog('Đã chụp được khuôn mặt — đang lưu vào máy…');
    await hikWriteFace(dev, pin, img, name, {});
    saveHikPhoto(pin, img);   // ảnh về phần mềm: hiện ở hồ sơ NV, đẩy được sang máy khác (kể cả máy ZKTeco)
    extra = { photo: true };
  }
  let sync = null;
  if (dev.sync_group) {
    prog('Đang chép sang các máy Hikvision cùng nhóm đồng bộ…');
    try { sync = await hikSyncGroup(dev.sync_group, { pins: [pin], prog }); }
    catch (e) { sync = { error: e.message }; }
  }
  return { device: dev.name || dev.serial, kind, fid, what, received: true, ...extra, sync,
    note: sync && !sync.error ? 'Đã lưu vào máy và chép sang máy cùng nhóm.' : sync?.error ? 'Đã lưu vào máy; chép sang máy cùng nhóm lỗi: ' + sync.error : 'Đã lưu vào máy.' };
}

/* ---------- bắt đầu (route gọi) ---------- */
const running = new Set();   // máy|Số ID đang đăng ký (chống bấm 2 lần)
export function startRemoteEnroll(dev, pin, kind, fid) {
  const s = enrollSupport(dev);
  if (!s) throw Object.assign(new Error('Máy này chưa hỗ trợ đăng ký từ xa.'), { status: 400 });
  if (kind === 'face' ? !s.face : !s.fp) throw Object.assign(new Error(kind === 'face'
    ? 'Máy này chưa đăng ký khuôn mặt từ xa được — dùng "Tải ảnh khuôn mặt lên" rồi đẩy xuống máy.' : 'Máy này chưa đăng ký vân tay từ xa được.'), { status: 400 });
  const key = dev.serial + '|' + pin;
  if (running.has(key)) throw Object.assign(new Error('Đang đăng ký cho nhân viên này trên máy này — chờ xong lượt trước.'), { status: 409 });
  running.add(key);
  const fn = dev.conn_type === 'push' ? admsEnroll : dev.conn_type === 'tcp' ? tcpEnroll : hikEnroll;
  const sig = dev.conn_type === 'tcp' ? join(tmpdir(), `dgp-enroll-${process.pid}-${randomBytes(6).toString('hex')}.sig`) : '';
  const j = startJob('remote-enroll', dev.name || dev.serial, async (prog) => {
    try { return await fn(dev, pin, kind, fid, prog, sig); }
    finally { running.delete(key); signals.delete(String(j.id)); if (sig) rmSync(sig, { force: true }); }
  });
  if (sig) { signals.set(String(j.id), sig); j.canFinish = true; }   // giao diện hiện nút "Nhân viên đã đặt xong"
  return j;
}
