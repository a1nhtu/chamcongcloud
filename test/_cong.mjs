// CỔNG NGẪU NHIÊN AN TOÀN cho test (file này không phải test — tên không kết thúc bằng .test.mjs).
// Vì sao cần: test mở máy chủ thử bằng listen(0) rồi gọi bằng fetch. Trên máy có dải cổng động bắt đầu từ 1024 (Windows có Hyper-V / WSL —
// máy Anh: 1024–15000) hệ điều hành thỉnh thoảng cấp trúng:
//   · cổng fetch từ chối ("bad port": 6000, 6666, 5060, 10080…) → cả file test hỏng với "fetch failed";
//   · cổng mà test khác đang DÒ như máy chấm công (4370, 8818, 80, 8080…) → test kia thấy "máy lạ".
// Hai kiểu này làm bộ test hỏng ngẫu nhiên khoảng 1 lần / 30 lần chạy (11/11/2026). Máy CI (dải 49152+) không gặp.
import { createServer } from 'node:net';

// Cổng bị chặn theo chuẩn Fetch (phần ≥ 1024) + cổng các test / phần mềm dùng để dò hoặc đang chạy thật trên máy
const CAM = new Set([
  1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
  4370, 8818, 5005, 8000, 8080, 8081, 8088, 8443, 8444, 8686, 8899, 9870, 7887, 7888,
]);
export const congOk = (p) => p >= 1024 && !CAM.has(p);

// Mở cổng ngẫu nhiên an toàn cho express app (app.listen) hoặc http / net Server (server.listen). Trả về server ĐANG nghe.
// Mặc định chỉ nghe 127.0.0.1 (không lộ ra 0.0.0.0 để test dò mạng khác khỏi bắt gặp).
export async function moCong(target, host = '127.0.0.1') {
  for (let i = 0; i < 50; i++) {
    const srv = await new Promise((ok, fail) => {
      const s = target.listen(0, host);
      s.once('listening', () => ok(s));
      s.once('error', fail);
    });
    if (congOk(srv.address().port)) return srv;
    await new Promise((ok) => srv.close(ok));   // trúng cổng cấm → đóng, xin cổng khác
  }
  throw new Error('Không xin được cổng an toàn sau 50 lần');
}

// Một số cổng đang TRỐNG (mở rồi đóng ngay) — cho test cần "cổng chưa ai nghe"
export async function congTrong(host = '127.0.0.1') {
  const s = await moCong(createServer(), host);
  const p = s.address().port;
  await new Promise((ok) => s.close(ok));
  return p;
}
