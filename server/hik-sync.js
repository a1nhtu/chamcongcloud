// ĐỒNG BỘ CÁC MÁY HIKVISION CÙNG "NHÓM ĐỒNG BỘ": người + thẻ + ảnh khuôn mặt + vân tay đăng ký ở máy này tự chép sang máy kia.
// Máy Hikvision không tự đẩy dữ liệu đăng ký về → phần mềm ĐỌC từng máy (ISAPI) rồi GHI sang máy còn thiếu, tuần tự từng máy.
//  - Khuôn mặt: chép ẢNH đăng ký (JPG) → máy nhận tự dựng mẫu, khác đời máy vẫn dùng được.
//  - Vân tay: chép mẫu (cùng chuẩn Hikvision), ghi vào ĐẦU ĐỌC vân tay của MÁY NHẬN (hỏi từng đầu đọc; máy thật DS-K1T671M không có vân tay → chỉ chép người / mặt / thẻ).
//  - Chỉ THÊM / BỔ SUNG, không xoá gì trên máy nào. Bỏ qua NV đang khoá + Số ID đang nghi trùng (như đồng bộ máy ZKTeco).
// Chạy khi: bấm "🔁 Đồng bộ nhóm ngay" ở máy; đặt nhóm cho máy; vòng tự tải thấy số người trên máy đổi.
// Tài liệu Person-Based Access Control Guide: E.35/E.36 thẻ, E.98/E.103 vân tay, E.187 FDSearch, F.112–F.117.
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { isapi, faceLib, hikWriteUser, hikWriteFace, hikEnabled, HIK_MAX_PIN, HIK_PIN } from './hik-isapi.js';
import { ingestUserData, lockedPins } from './device-sync.js';
import { heldSet, pmNameFor } from './pin-guard.js';
import { busyFlag, tenantKey } from './tenant.js';

const FATAL = new Set(['CONN', 'AUTH', 'TIMEOUT']);
const okPin = (p) => !!p && !/[\s=\t]/.test(p) && p.length <= HIK_MAX_PIN;

// Danh sách người trên máy: Map Số ID → { name, face, fp, card }. pins: chỉ hỏi những Số ID này (null = tất cả).
export async function hikListPeople(dev, pins = null, prog = () => {}) {
  const out = new Map(), searchID = randomUUID();
  const take = (list) => { for (const u of list) {
    const pin = String(u.employeeNo ?? '').trim();
    if (!okPin(pin) || (u.userType && !['normal', ''].includes(String(u.userType)))) continue;
    out.set(pin, { name: String(u.name || '').trim(), face: +u.numOfFace || 0, fp: +u.numOfFP || 0, card: +u.numOfCard || 0 });
  } };
  if (pins) {
    for (let i = 0; i < pins.length; i += 10) {
      const r = await isapi(dev, 'POST', '/ISAPI/AccessControl/UserInfo/Search?format=json',
        { UserInfoSearchCond: { searchID: randomUUID(), searchResultPosition: 0, maxResults: 10, EmployeeNoList: pins.slice(i, i + 10).map((employeeNo) => ({ employeeNo })) } }, { timeoutMs: 30000 });
      take(Array.isArray(r.json?.UserInfoSearch?.UserInfo) ? r.json.UserInfoSearch.UserInfo : []);
    }
    return out;
  }
  let pos = 0;
  for (let page = 0; page < 5000; page++) {
    const r = await isapi(dev, 'POST', '/ISAPI/AccessControl/UserInfo/Search?format=json',
      { UserInfoSearchCond: { searchID, searchResultPosition: pos, maxResults: 30 } }, { timeoutMs: 30000 });
    const s = r.json?.UserInfoSearch || {};
    const list = Array.isArray(s.UserInfo) ? s.UserInfo : [];
    take(list); pos += list.length;
    if (pos && pos % 600 < 30) prog(`${dev.name || dev.serial}: đã đọc ${pos} người…`);
    if (s.responseStatusStrg !== 'MORE' || !list.length) break;
  }
  return out;
}

/* ---------- đọc 1 người từ máy nguồn ---------- */
export async function hikReadFace(dev, pin, ctx) {
  ctx.lib = ctx.lib || await faceLib(dev);
  const r = await isapi(dev, 'POST', '/ISAPI/Intelligent/FDLib/FDSearch?format=json',
    { searchResultPosition: 0, maxResults: 1, faceLibType: ctx.lib.faceLibType, FDID: ctx.lib.FDID, FPID: pin }, { timeoutMs: 30000 });
  const m = (Array.isArray(r.json?.MatchList) ? r.json.MatchList : []).find((x) => String(x.FPID) === pin);
  if (!m || !m.faceURL) return null;
  const path = String(m.faceURL).replace(/^[a-z]+:\/\/[^/]+/i, '');   // máy trả URL đủ (http://IP/LOCALS/pic/…) → chỉ lấy đường dẫn
  if (!path.startsWith('/')) return null;
  const g = await isapi(dev, 'GET', path, null, { timeoutMs: 30000 });
  return g.buf && g.buf.length > 100 && g.buf[0] === 0xff && g.buf[1] === 0xd8 ? g.buf : null;   // chỉ nhận ảnh JPG
}
export async function hikReadFingers(dev, pin) {
  const searchID = randomUUID(), seen = new Map();
  for (let i = 0; i < 10; i++) {   // có máy trả hết 1 lần, có máy trả từng ngón → hỏi tiếp tới khi không có ngón mới
    const r = await isapi(dev, 'POST', '/ISAPI/AccessControl/FingerPrintUpload?format=json', { FingerPrintCond: { searchID, employeeNo: pin } }, { timeoutMs: 30000 });
    const fi = r.json?.FingerPrintInfo || {};
    const list = fi.status === 'OK' && Array.isArray(fi.FingerPrintList) ? fi.FingerPrintList : [];
    let added = 0;
    for (const f of list) if (f.fingerData && f.fingerPrintID && !seen.has(+f.fingerPrintID)) { seen.set(+f.fingerPrintID, { id: +f.fingerPrintID, type: f.fingerType || 'normalFP', data: f.fingerData }); added++; }
    if (!added) break;
  }
  return [...seen.values()];
}
export async function hikReadCards(dev, pin) {
  const r = await isapi(dev, 'POST', '/ISAPI/AccessControl/CardInfo/Search?format=json',
    { CardInfoSearchCond: { searchID: randomUUID(), searchResultPosition: 0, maxResults: 5, EmployeeNoList: [{ employeeNo: pin }] } });
  return (Array.isArray(r.json?.CardInfoSearch?.CardInfo) ? r.json.CardInfoSearch.CardInfo : [])
    .filter((c) => c.cardNo && String(c.employeeNo ?? pin) === pin).map((c) => ({ no: String(c.cardNo), type: c.cardType || 'normalCard' }));
}

/* ---------- ảnh khuôn mặt đăng ký → phần mềm (hộp chi tiết NV "📸 Ảnh khuôn mặt đăng ký trên máy") ---------- */
// Máy ZKTeco tự gửi ảnh (BIOPHOTO) về; máy Hikvision KHÔNG gửi → phần mềm tự tải ảnh trong thư viện mặt (FDSearch → faceURL).
// Chỉ lấy cho Số ID ĐÃ LÀ NV (không lưu ảnh người lạ), NV chưa có ảnh. Ảnh lưu chung bảng device_user_photos như máy ZK.
export function saveHikPhoto(pin, buf) {
  db.prepare(`INSERT INTO device_user_photos(pin,kind,face_type,photo) VALUES(?,'face',9,?)
    ON CONFLICT(pin) DO UPDATE SET kind='face',face_type=9,photo=excluded.photo,updated_at=datetime('now')`).run(String(pin), buf.toString('base64'));
}
export function hikPhotoMissing(pins) {
  const q = db.prepare("SELECT 1 FROM employees e WHERE e.device_pin=? AND e.active=1 AND NOT EXISTS (SELECT 1 FROM device_user_photos p WHERE p.pin=e.device_pin)");
  return [...new Set(pins.map(String))].filter((p) => q.get(p));
}
const photoTried = new Map();   // máy|Số ID → lúc thử gần nhất (người chưa có mặt trên máy thì khỏi hỏi mỗi lượt quẹt)
// Tải ảnh mặt của các Số ID (đã là NV, chưa có ảnh) từ 1 máy. Tuần tự. Trả số ảnh đã lưu.
export async function hikFetchPhotos(dev, pins, prog = () => {}) {
  const todo = hikPhotoMissing(pins).filter((p) => Date.now() - (photoTried.get(tenantKey() + '|' + dev.serial + '|' + p) || 0) > 30 * 60000);
  const ctx = {};
  let n = 0, i = 0;
  for (const pin of todo) {
    photoTried.set(tenantKey() + '|' + dev.serial + '|' + pin, Date.now());
    if (++i % 50 === 1 && todo.length > 20) prog(`${dev.name || dev.serial}: đang tải ảnh khuôn mặt ${i} / ${todo.length}…`);
    try { const buf = await hikReadFace(dev, pin, ctx); if (buf) { saveHikPhoto(pin, buf); n++; } }
    catch (e) { if (FATAL.has(e.code)) break; }
  }
  return n;
}
// chạy nền (sau khi máy tự gửi lượt chấm / tải NV xong) — lỗi chỉ ghi log
export function hikFetchPhotosLater(dev, pins) {
  if (!pins || !pins.length || !hikPhotoMissing(pins).length) return;
  hikFetchPhotos(dev, pins).catch((e) => console.error('[hik] tải ảnh khuôn mặt lỗi:', e.message));
}

/* ---------- ghi sang máy nhận ---------- */
// Đầu đọc CÓ VÂN TAY của máy nhận. null = máy không có vân tay.
// capabilities chỉ cho dải số đầu đọc (máy thật DS-K1T671M báo 2…2 nhưng đầu đọc 2 là cổng Wiegand ngoài, không cắm gì)
// → hỏi từng đầu đọc (CardReaderCfg/<số>) xem cardReaderFunction có "fingerPrint" không. Máy không trả được thì dùng số nhỏ nhất như cũ.
async function fpReaders(dev, ctx) {
  if (ctx.readers !== undefined) return ctx.readers;
  try {
    const r = await isapi(dev, 'GET', '/ISAPI/AccessControl/FingerPrintCfg/capabilities?format=json');
    const c = r.json?.FingerPrintCfg?.enableCardReader || {};
    const lo = +c['@min'] || 1, hi = Math.min(Math.max(+c['@max'] || lo, lo), lo + 7);
    const fp = [];
    let known = false;
    for (let n = lo; n <= hi; n++) {
      try {
        const f = (await isapi(dev, 'GET', `/ISAPI/AccessControl/CardReaderCfg/${n}?format=json`)).json?.CardReaderCfg?.cardReaderFunction;
        if (Array.isArray(f)) { known = true; if (f.includes('fingerPrint')) fp.push(n); }
      } catch (e) { if (FATAL.has(e.code)) throw e; }
    }
    ctx.readers = known ? (fp.length ? fp : null) : [lo];
  } catch (e) { if (FATAL.has(e.code)) throw e; ctx.readers = null; }
  return ctx.readers;
}
const FP_ERR = { 0: 'đầu đọc vân tay mất kết nối', 2: 'đầu đọc vân tay đang offline', 3: 'mẫu vân tay kém', 4: 'bộ nhớ vân tay đầy', 6: 'trùng số ngón', 7: 'số ngón không hợp lệ', 8: 'đầu đọc không có vân tay', 10: 'đầu đọc vân tay đời cũ' };
export async function hikWriteFingers(dev, pin, fps, ctx) {
  const readers = await fpReaders(dev, ctx);
  if (!readers) throw Object.assign(new Error('máy không có vân tay'), { code: 'NOFP' });
  let n = 0;
  for (const f of fps) {
    const r = await isapi(dev, 'POST', '/ISAPI/AccessControl/FingerPrint/SetUp?format=json',
      { FingerPrintCfg: { employeeNo: pin, enableCardReader: readers, fingerPrintID: f.id, fingerType: f.type, fingerData: f.data } }, { timeoutMs: 30000 });
    const st = r.json?.FingerPrintStatus || {};
    const list = Array.isArray(st.StatusList) ? st.StatusList : [];
    if (list.length && list.every((x) => +x.cardReaderRecvStatus === 8)) { ctx.readers = null; throw Object.assign(new Error('máy không có vân tay'), { code: 'NOFP' }); }   // 8 = đầu đọc không có vân tay
    const bad = list.find((x) => ![1, 5].includes(+x.cardReaderRecvStatus));   // 1 = ghi được, 5 = máy có ngón này rồi
    if (bad) throw Object.assign(new Error(`vân tay ngón ${f.id}: ${FP_ERR[+bad.cardReaderRecvStatus] || bad.errorMsg || 'mã ' + bad.cardReaderRecvStatus}`), { code: 'ISAPI' });
    if (st.status === 'failed') throw Object.assign(new Error(`vân tay ngón ${f.id}: máy báo không ghi được`), { code: 'ISAPI' });
    n++;
  }
  return n;
}
async function hikWriteCards(dev, pin, cards) {
  for (const c of cards) await isapi(dev, 'PUT', '/ISAPI/AccessControl/CardInfo/SetUp?format=json', { CardInfo: { employeeNo: pin, cardNo: c.no, cardType: c.type } });
  return cards.length;
}

// Còn chứa thêm được bao nhiêu người (UserInfo/capabilities maxRecordNum − UserInfo/Count). Máy MT05WE chỉ 500 người. Không đọc được = không giới hạn.
async function userRoom(dev) {
  try {
    const max = +(await isapi(dev, 'GET', '/ISAPI/AccessControl/UserInfo/capabilities?format=json')).json?.UserInfo?.maxRecordNum;
    const now = +(await isapi(dev, 'GET', '/ISAPI/AccessControl/UserInfo/Count?format=json')).json?.UserInfoCount?.userNumber;
    if (max > 0 && now >= 0) return { max, room: Math.max(0, max - now) };
  } catch (e) { if (FATAL.has(e.code)) throw e; }
  return { max: 0, room: Infinity };
}

/* ---------- đồng bộ cả nhóm ---------- */
const syncBusy = busyFlag();
export const hikGroupDevices = (group) => (group ? db.prepare("SELECT * FROM push_devices WHERE conn_type='hik' AND active=1 AND sync_group=? ORDER BY id").all(group) : []);
// group: tên nhóm đồng bộ. opts.pins: chỉ đồng bộ các Số ID này (null = tất cả). Trả số liệu từng máy + lỗi (tối đa 15 dòng).
export async function hikSyncGroup(group, { pins = null, prog = () => {} } = {}) {
  const devs = hikGroupDevices(group);
  if (devs.length < 2) return { group, devices: devs.length, people: 0, note: 'Nhóm cần ít nhất 2 máy Hikvision đã duyệt mới đồng bộ được.' };
  if (!syncBusy.take()) throw new Error('Đang đồng bộ nhóm máy Hikvision khác — chờ xong rồi bấm lại.');
  try {
    const want = pins ? [...new Set(pins.map((p) => String(p || '').trim()).filter(okPin))] : null;
    // 1) đọc danh sách người của từng máy
    const lists = new Map(), offline = [];
    for (const d of devs) {
      if (!hikEnabled()) throw new Error('Đã tắt tính năng máy Hikvision');
      prog(`Đang đọc danh sách người: ${d.name || d.serial}…`);
      try { lists.set(d.serial, await hikListPeople(d, want, prog)); }
      catch (e) { if (!FATAL.has(e.code)) throw e; offline.push(`${d.name || d.serial}: ${e.message}`); }
    }
    const live = devs.filter((d) => lists.has(d.serial));
    if (live.length < 2) return { group, devices: devs.length, people: 0, offline, errors: offline };
    // 2) gộp: Số ID → máy có mặt / nhiều vân tay nhất / có thẻ / có tên
    const all = new Map();
    for (const d of live) for (const [pin, u] of lists.get(d.serial)) {
      const a = all.get(pin) || { name: '', face: null, fp: null, fpN: 0, card: null, cardN: 0 };
      if (!a.name && u.name) a.name = u.name;
      if (u.face && !a.face) a.face = d;
      if (u.fp > a.fpN) { a.fp = d; a.fpN = u.fp; }
      if (u.card > a.cardN) { a.card = d; a.cardN = u.card; }
      all.set(pin, a);
    }
    const locked = lockedPins(), held = heldSet(), hasEmp = db.prepare("SELECT id FROM employees WHERE device_pin=? AND device_pin<>''");
    const tot = { users: 0, faces: 0, fps: 0, cards: 0, skipped: 0, nofp: 0, full: 0 }, errors = [...offline], per = [];
    const cache = new Map(), srcCtx = new Map();   // dữ liệu đã đọc của từng Số ID (dùng lại cho máy nhận thứ 2, 3…)
    const ctxOf = (d) => { if (!srcCtx.has(d.serial)) srcCtx.set(d.serial, {}); return srcCtx.get(d.serial); };
    // 3) từng máy nhận: ghi người / thẻ / mặt / vân tay còn thiếu
    for (const t of live) {
      const have = lists.get(t.serial), tctx = {}, me = { device: t.name || t.serial, users: 0, faces: 0, fps: 0, cards: 0, failed: 0 };
      const todo = [...all].filter(([pin, a]) => {
        if (locked.has(pin) || held.has(t.serial + '|' + pin)) return false;
        const h = have.get(pin);
        return !h || (a.face && !h.face) || (a.fp && h.fp < a.fpN) || (a.card && h.card < a.cardN);
      });
      // máy nhỏ không chứa hết → bổ sung người đã có trên máy trước, rồi NV có trong phần mềm, sau cùng người chỉ có trên máy khác
      const rk = new Map(todo.map(([pin]) => [pin, have.has(pin) ? 0 : hasEmp.get(pin) ? 1 : 2]));
      todo.sort((x, y) => rk.get(x[0]) - rk.get(y[0]));
      const cap = todo.some(([pin]) => !have.has(pin)) ? await userRoom(t) : { max: 0, room: Infinity };
      let full = 0;
      let i = 0;
      for (const [pin, a] of todo) {
        if (me.lost) break;
        if (!hikEnabled()) throw new Error('Đã tắt tính năng máy Hikvision');
        if (++i % 10 === 1) prog(`${t.name || t.serial}: đang chép ${i} / ${todo.length} người…`);
        if ([a.face, a.fp, a.card].some((s) => s && held.has(s.serial + '|' + pin))) { tot.skipped++; continue; }
        const h = have.get(pin), c = cache.get(pin) || {};
        if (!h && me.users >= cap.room) { full++; continue; }   // máy nhận đã đầy → không ghi thêm người mới
        cache.set(pin, c);
        const name = pmNameFor(pin, true) || a.name || pin;
        try {
          if (!h) {
            await hikWriteUser(t, pin, name); me.users++;
            // chỉ báo phần mềm khi Số ID đã là NV — đồng bộ máy↔máy KHÔNG tự tạo NV nháp (máy khách có thể cả nghìn người lạ)
            if (hasEmp.get(pin)) ingestUserData(t.serial, 'USER', `USER PIN=${pin}\tName=${name}`, null, HIK_PIN);
          }
          if (a.card && (!h || h.card < a.cardN)) {
            if (c.cards === undefined) c.cards = await hikReadCards(a.card, pin);
            me.cards += await hikWriteCards(t, pin, c.cards);
          }
          if (a.face && (!h || !h.face)) {
            if (c.face === undefined) {
              c.face = await hikReadFace(a.face, pin, ctxOf(a.face));
              if (c.face && hikPhotoMissing([pin]).length) saveHikPhoto(pin, c.face);   // NV chưa có ảnh trong phần mềm → lưu luôn
            }
            if (c.face) { await hikWriteFace(t, pin, c.face, name, tctx); me.faces++; }
          }
          if (a.fp && (!h || h.fp < a.fpN)) {
            if (!(await fpReaders(t, tctx))) { tot.nofp++; continue; }   // máy nhận không có vân tay → khỏi đọc vân tay máy nguồn
            if (c.fps === undefined) c.fps = await hikReadFingers(a.fp, pin);
            if (c.fps.length) me.fps += await hikWriteFingers(t, pin, c.fps, tctx);
          }
        } catch (e) {
          if (FATAL.has(e.code)) {   // máy nhận (hoặc máy nguồn) mất kết nối giữa chừng → dừng máy này, các máy khác vẫn chạy
            me.lost = true; errors.push(`${t.name || t.serial}: dừng giữa chừng — ${e.message}`); continue;
          }
          if (e.code === 'NOFP') { tot.nofp++; continue; }   // máy nhận không có vân tay → bỏ phần vân tay, phần khác đã ghi
          me.failed++; if (errors.length < 15) errors.push(`${t.name || t.serial} · ${pin}: ${e.message}`);
        }
      }
      if (full) { me.full = full; tot.full += full; errors.unshift(`${t.name || t.serial} ĐẦY: máy chỉ chứa ${cap.max || '?'} người — còn ${full} người chưa chép được.`); }
      for (const k of ['users', 'faces', 'fps', 'cards']) tot[k] += me[k];
      per.push(me);
    }
    return { group, devices: live.length, people: all.size, ...tot, failed: per.reduce((s, x) => s + x.failed, 0), per, errors, offline };
  } finally { syncBusy.done(); }
}
