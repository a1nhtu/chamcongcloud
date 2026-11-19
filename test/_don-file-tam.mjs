// Dọn file tạm do bộ test để lại trong thư mục Temp (nạp qua `--test-global-setup` trong `npm test`).
// Mỗi file test tạo CSDL riêng `dgp-…-<pid>.db` (+ -wal/-shm) hoặc thư mục `mkdtemp('dgp-…')` nhưng không xoá khi xong,
// nên Temp phình hàng chục GB (19/11/2026: hơn 10.000 file, ~10 GB trên ổ C máy Anh).
// Chạy SAU khi mọi tiến trình test đã thoát (lúc đó file CSDL không còn bị mở, Windows mới cho xoá).
//   - Mục tạo ra trong lượt chạy này: xoá.
//   - Mục cũ hơn 1 ngày (sót từ các lượt trước / chạy tay): xoá.
//   - Tên có số tiến trình mà tiến trình đó còn sống: để nguyên (có thể là lượt test khác đang chạy).
//   - `dgp-push-*`, `dgp-enroll-*`: file của phần mềm đang chạy thật (server/zk-tcp.js, server/remote-enroll.js) → không đụng.
import { readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEN = /^(dgp-|prove-meal-|prove-\d)/;
const BO_QUA = /^dgp-(push|enroll)-/;
const MOT_NGAY = 24 * 3600 * 1000;
let batDau = 0;

function conSong(pid) {
  if (!pid || pid === process.pid) return pid === process.pid;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

export function donFileTam({ tuLuc = 0, dir = tmpdir() } = {}) {
  let soMuc = 0, soByte = 0;
  let ten;
  try { ten = readdirSync(dir); } catch { return { soMuc, soByte }; }
  const bayGio = Date.now();
  for (const t of ten) {
    if (!TEN.test(t) || BO_QUA.test(t)) continue;
    const p = join(dir, t);
    let st;
    try { st = statSync(p); } catch { continue; }
    const moc = Math.max(st.mtimeMs, st.birthtimeMs || 0);
    const moi = tuLuc && moc >= tuLuc - 1000;
    const cu = bayGio - moc > MOT_NGAY;
    if (!moi && !cu) continue;
    const pids = (t.match(/\d{3,}/g) || []).map(Number);
    if (!cu && pids.some((n) => n !== process.pid && conSong(n))) continue;
    let size = st.isFile() ? st.size : 0;
    try { rmSync(p, { recursive: true, force: true }); soMuc++; soByte += size; } catch { /* đang bị mở → lần sau xoá */ }
  }
  return { soMuc, soByte };
}

export async function globalSetup() { batDau = Date.now(); }

export async function globalTeardown() {
  const { soMuc, soByte } = donFileTam({ tuLuc: batDau });
  if (soMuc) console.log(`[don-file-tam] Đã xoá ${soMuc} file/thư mục tạm (${(soByte / 1048576).toFixed(0)} MB) trong ${tmpdir()}`);
}
