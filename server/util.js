// Tiện ích chung: thời gian múi giờ VN, khoảng cách GPS, tính đi muộn/số giờ công

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

// 'HH:MM' theo giờ VN
export function vnTimeStr(date = new Date()) {
  const p = vnParts(date);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

// Số phút kể từ 00:00 theo giờ VN
export function vnMinutesOfDay(date = new Date()) {
  const p = vnParts(date);
  return p.h * 60 + p.mi;
}

export function hhmmToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
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

// Tính số phút đi muộn dựa trên ca làm + thời điểm chấm (giờ VN)
export function computeLate(shift, checkDate = new Date()) {
  if (!shift) return 0;
  const nowMin = vnMinutesOfDay(checkDate);
  const startMin = hhmmToMinutes(shift.start_time);
  const grace = shift.late_grace_min || 0;
  const late = nowMin - (startMin + grace);
  return late > 0 ? late : 0;
}

// Định dạng khoảng cách thân thiện
export function humanDistance(m) {
  if (m == null) return '';
  if (m < 1000) return `${m} m`;
  return `${(m / 1000).toFixed(1)} km`;
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
