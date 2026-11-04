// Cờ "ĐANG CHUYỂN SANG MÁY KHÁC" (bản cài 1 công ty — xem chuyen-may.js).
// Từ lúc chụp dữ liệu để đóng file chuyển máy tới lúc tắt máy cũ: KHÔNG nhận lượt chấm / dữ liệu mới
// (lượt nhận sau lúc chụp sẽ không có trong file → mất). Máy chấm công tự giữ lượt chấm và gửi lại sau.
// File này KHÔNG import gì (device-sync, zk-tcp, index.js dùng chung, tránh vòng import).
export const MOVE_HOLD_MS = 2 * 3600 * 1000;   // quá 2 giờ chưa bấm tắt máy cũ → tự bỏ, nhận dữ liệu lại như thường

let state = null;
export function setMoving(s) { state = s ? { ...s, until: Date.now() + MOVE_HOLD_MS } : null; return state; }
export function movingOut() {
  if (state && Date.now() > state.until) state = null;
  return state;
}
