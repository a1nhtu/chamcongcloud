// TÊN NHÂN VIÊN BỊ RÁC: máy ZK lưu tên dài (> ~20 ký tự) mà phần mềm cũ đọc qua SDK sai kiểu (Ronald Jack Pro…) thì tên thành
// chuỗi ký tự rỗng NUL + vài ký tự lạ (VD 20 × \u0000 + "〲1" = Số ID 201 đọc nhầm UTF-16) — khách trankimxuyen 10/11/2026.
// Tên có ký tự điều khiển / ký tự thay thế là tên rác: không nhận khi chuyển dữ liệu, và máy gửi tên thật thì được thay.
const CTRL = /[\u0000-\u001f\u007f�]/;
export const isJunkName = (s) => !s || CTRL.test(String(s));
// Tên dùng được: bỏ khoảng trắng thừa; tên rác → ''
export const cleanName = (s) => { const t = String(s ?? '').trim(); return t && !CTRL.test(t) ? t : ''; };
