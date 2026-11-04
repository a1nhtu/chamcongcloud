// CHUYỂN PHẦN MỀM SANG MÁY KHÁC — phía MÁY MỚI (xem chuyen-may.js).
// 1) Lúc khởi động, TRƯỚC khi mở CSDL: Setup.exe ("Chuyển từ máy cũ") đã chép file chuyển máy vào <thư mục cài>\ChuyenMay-nhan.zip
//    → giải nén, đặt CSDL làm bản phục hồi chờ (db.js thay lúc mở), chép ảnh + giấy tờ NV, cất license máy cũ.
//    PHẢI import ngay sau install-config.js + logger.js, trước mọi module mở CSDL; file này không import db.js.
// 2) Sau khi chạy: license máy cũ không dùng được ở máy mới (gắn Mã máy) → gửi lên máy chủ Digiplus đổi lấy license
//    cho Mã máy mới, GIỮ hạn + số NV (/api/chuyen-may, mỗi license chỉ chuyển 1 lần). Chưa có mạng thì tự thử lại.
//    Máy chủ từ chối (đã chuyển rồi, hết hạn…) → màn kích hoạt hiện lý do + Mã máy để Digiplus cấp lại tay như cũ.
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, MULTI } from './tenant.js';
import { verifyLicense, machineId } from './license.js';

const INSTALL_ROOT = join(ROOT, '..');
export const INCOMING = 'ChuyenMay-nhan.zip';
const tarBin = () => { if (process.platform !== 'win32') return 'bsdtar'; const p = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'); return existsSync(p) ? p : 'tar'; };
const pendingFile = (app = ROOT) => join(app, 'data', 'license.chuyen-may');   // license máy cũ chờ đổi
const licFile = (app = ROOT) => join(app, 'data', 'license.key');               // = license.js licensePath() của bản 1 công ty
const licValid = (app = ROOT) => { try { return verifyLicense(readFileSync(licFile(app), 'utf8').trim()).valid; } catch { return false; } };
const saveLic = (app, key) => { mkdirSync(join(app, 'data'), { recursive: true }); writeFileSync(licFile(app), String(key).trim()); };

function moveAside(file, suffix) {
  try { rmSync(file + suffix, { force: true }); renameSync(file, file + suffix); }
  catch { try { rmSync(file, { force: true }); } catch {} }
}

// root = thư mục cài (chứa ChuyenMay-nhan.zip), app = thư mục app (chứa data/, uploads/). Trả null nếu không có file.
export function applyIncomingMove(root = INSTALL_ROOT, app = ROOT) {
  if (MULTI) return null;
  const zip = join(root, INCOMING);
  if (!existsSync(zip)) return null;
  const data = join(app, 'data');
  const tmp = join(data, '_nhan_chuyen_may_' + Date.now());
  try {
    mkdirSync(tmp, { recursive: true });
    execFileSync(tarBin(), ['-xf', zip, '-C', tmp], { stdio: 'ignore', windowsHide: true });
    let man;
    try { man = JSON.parse(readFileSync(join(tmp, 'chuyen-may.json'), 'utf8')); } catch { throw new Error('không phải file chuyển máy Digiplus (thiếu chuyen-may.json)'); }
    const dbIn = join(tmp, 'digiplus.db');
    if (!existsSync(dbIn) || !readFileSync(dbIn).subarray(0, 16).toString('latin1').startsWith('SQLite format 3'))
      throw new Error('file chuyển máy thiếu dữ liệu (digiplus.db)');
    const dbPath = process.env.DB_PATH || join(data, 'digiplus.db');
    copyFileSync(dbIn, dbPath + '.restore');   // db.js thay lúc mở CSDL (CSDL đang có trên máy mới giữ lại ở .prerestore)
    for (const [from, to] of [[join(tmp, 'uploads'), join(app, 'uploads')], [join(tmp, 'hr-files'), join(data, 'hr-files')]]) {
      if (!existsSync(from)) continue;
      rmSync(to, { recursive: true, force: true });
      cpSync(from, to, { recursive: true });
    }
    // License máy cũ: dùng được luôn ở máy này (license mọi máy / cài lại đúng máy cũ) → lưu; không thì chờ đổi license mới
    let license = 'none';
    const licIn = join(tmp, 'license.key');
    if (existsSync(licIn)) {
      const key = readFileSync(licIn, 'utf8').trim();
      if (verifyLicense(key).valid) { saveLic(app, key); rmSync(pendingFile(app), { force: true }); license = 'ok'; }
      else if (!licValid(app)) { writeFileSync(pendingFile(app), key); license = 'pending'; }
    }
    moveAside(zip, '.da-nhap');
    console.log(`  [chuyen-may] Đã nhận dữ liệu từ máy cũ (khách ${man.customer || 'LAN'}, đóng file lúc ${man.at || '?'}, bản ${man.version || '?'}). Bản quyền: ${license}.`);
    return { ok: true, manifest: man, license };
  } catch (e) {
    console.error('  [chuyen-may] Không nhận được file chuyển máy:', e.message);
    moveAside(zip, '.loi');   // không thử lại mỗi lần khởi động; đổi tên lại thành ChuyenMay-nhan.zip để nhận lại
    return { ok: false, error: e.message };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// Bản cài Windows (có runtime\node.exe): tự nhận ngay khi nạp module (trước khi db.js mở CSDL)
if (!MULTI && existsSync(join(INSTALL_ROOT, 'runtime', 'node.exe'))) applyIncomingMove();

/* ---------------- Đổi license máy cũ → license máy mới ---------------- */
const hubUrl = () => (process.env.DGP_HUB || 'https://huongdan.maychamcongcloud.com').replace(/\/+$/, '') + '/api/chuyen-may';
const st = { error: '', stopped: false, tries: 0, busy: false, last: 0 };
let timer = null;

const readPending = (app = ROOT) => { try { return readFileSync(pendingFile(app), 'utf8').trim(); } catch { return ''; } };

// Cho màn kích hoạt: null = không có gì đang chuyển
export function moveState(app = ROOT) {
  if (MULTI || !readPending(app)) return null;
  return { pending: true, error: st.error, stopped: st.stopped, tries: st.tries };
}

// Gửi 1 lần. Trả 'done' | 'retry' (lỗi mạng / máy chủ bận) | 'refused' (máy chủ từ chối — không tự thử lại) | 'none'
export async function claimOnce(app = ROOT) {
  const old = readPending(app);
  if (!old) return 'none';
  if (licValid(app)) { rmSync(pendingFile(app), { force: true }); return 'done'; }   // đã có license dùng được (Digiplus dán tay…)
  st.busy = true; st.tries++; st.last = Date.now();
  try {
    const r = await fetch(hubUrl(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ license: old, machine: machineId(), customer: process.env.CUSTOMER || '' }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.license) {
      const v = verifyLicense(d.license);
      if (!v.valid) { st.error = 'License nhận về không dùng được trên máy này (' + v.reason + ').'; st.stopped = true; return 'refused'; }
      saveLic(app, d.license);
      rmSync(pendingFile(app), { force: true });
      Object.assign(st, { error: '', stopped: false });
      console.log(`  [chuyen-may] Đã nhận bản quyền cho máy mới (Mã máy ${machineId()}).`);
      return 'done';
    }
    if (r.status >= 400 && r.status < 500 && r.status !== 429) {
      st.error = d.error || `Máy chủ Digiplus từ chối (mã ${r.status}).`; st.stopped = true;
      console.error('  [chuyen-may] Máy chủ từ chối chuyển bản quyền:', st.error);
      return 'refused';
    }
    st.error = d.error || `Máy chủ Digiplus đang bận (mã ${r.status}) — tự thử lại.`;
    return 'retry';
  } catch {
    st.error = 'Chưa kết nối được máy chủ Digiplus (máy này cần Internet) — tự thử lại.';
    return 'retry';
  } finally { st.busy = false; }
}

// Thử lại: 1 phút/lần trong 10 lần đầu, sau đó 5 phút/lần. Máy chủ từ chối thì dừng (nút "Thử lại" trên màn kích hoạt).
export function startMoveClaim() {
  if (MULTI || timer) return;
  const loop = async () => {
    timer = null;
    if (!readPending() || st.stopped) return;
    const r = await claimOnce();
    if (r === 'retry') { timer = setTimeout(loop, st.tries < 10 ? 60000 : 300000); timer.unref?.(); }
  };
  timer = setTimeout(loop, 3000);
  timer.unref?.();
}

// Nút "Thử lại" (màn kích hoạt, không cần đăng nhập): tối đa 1 lần / 10 giây
export async function retryMoveClaim() {
  if (!readPending()) return moveState();
  if (!st.busy && Date.now() - st.last > 10000) {
    st.stopped = false;
    if (timer) { clearTimeout(timer); timer = null; }
    const r = await claimOnce();
    if (r === 'retry') startMoveClaim();
  }
  return moveState();
}
