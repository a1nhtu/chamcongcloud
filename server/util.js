// Tiện ích chung: thời gian múi giờ VN, khoảng cách GPS, che lỗi hệ thống khi trả về client
// (Tính đi muộn / giờ công nằm ở attendance-calc.js — bản computeLate cũ ở đây đã bỏ vì không còn nơi nào dùng.)

export const VN_OFFSET_MIN = 7 * 60; // UTC+7

// Trả về đối tượng thời gian theo giờ VN từ 1 Date (mặc định now)
export function vnParts(date = new Date()) {
  const t = new Date(date.getTime() + VN_OFFSET_MIN * 60 * 1000);
  return {
    y: t.getUTCFullYear(),
    mo: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    h: t.getUTCHours(),
    mi: t.getUTCMinutes(),
    s: t.getUTCSeconds(),
    dow: t.getUTCDay() === 0 ? 7 : t.getUTCDay(), // 1=T2..7=CN
  };
}

const pad = (n) => String(n).padStart(2, '0');

// 'YYYY-MM-DD' theo giờ VN
export function vnDateStr(date = new Date()) {
  const p = vnParts(date);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

// Khoảng cách Haversine (mét)
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

// Định dạng phút -> 'Xg Ym'
export function humanMinutes(min) {
  if (!min || min <= 0) return '0g';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}g${m ? ' ' + m + 'p' : ''}`;
}

// ISO 8601 UTC an toàn (tránh lỗi 1899-12-30 do parse sai)
export function nowIso() {
  return new Date().toISOString();
}

// --- Che lỗi hệ thống khi trả về client (không lộ câu SQL / đường dẫn file) ---

// Đánh dấu lỗi NGHIỆP VỤ có chủ đích (thông báo tiếng Việt an toàn để hiện cho người dùng),
// khác với lỗi hệ thống không lường trước (SQLite, hệ thống tệp...) cần bị che lại.
export function userError(message, status = 400) {
  const err = new Error(message);
  err.userFacing = true;
  err.status = status;
  return err;
}

const GENERIC_ERROR_MESSAGE = 'Có lỗi hệ thống, vui lòng thử lại hoặc liên hệ Digiplus';

// Trả lỗi cho client: nếu là lỗi nghiệp vụ (tạo bằng userError) thì trả nguyên văn message;
// nếu không, che lại bằng thông báo chung và ghi chi tiết đầy đủ ra log server (kèm tên route).
export function sendCaughtError(res, routeName, e, { status = 500, message = GENERIC_ERROR_MESSAGE } = {}) {
  if (e && e.userFacing) return res.status(e.status || 400).json({ error: e.message });
  console.error(`[${routeName}]`, e);
  res.status(status).json({ error: message });
}
