// NHÂN VIÊN TỰ ĐĂNG KÝ LÀM THÊM trên app (công tắc ot_self_reg — mặc định TẮT: tắt thì mọi API ở đây báo "đang tắt").
// NV gửi đơn: ngày + từ giờ → đến giờ + lý do; loại 'ot' = làm thêm ngoài ca, 'lunch' = tăng ca trưa (chỉ khi bật ot_lunch_reg).
// Đơn chờ quản lý duyệt ở menu ⏰ Đăng ký làm thêm (routes/admin/ot-reg.js) — duyệt mới ghi vào đăng ký và áp vào công.
import { Router } from 'express';
import { db, empHourly } from '../db.js';
import { authRequired, inspectorGuard } from '../auth.js';
import { vnDateStr } from '../util.js';
import { otSelfOn, otLunchOn, normHm, hmSpan, OT_REQ_KIND } from '../ot-reg.js';
import { resolveEffectiveShift } from '../shift-resolver.js';
import { notifyPerm } from '../push.js';

const r = Router();
r.use(authRequired);
r.use(inspectorGuard([]));   // tài khoản kiểm tra không gửi đơn

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const on = (req) => otSelfOn() && !empHourly(req.user.id);   // NV chấm theo giờ không có tăng ca
const BACK_DAYS = 31, AHEAD_DAYS = 93;   // gửi đơn cho ngày trong khoảng: 31 ngày trước → 93 ngày tới
const toHm = (min) => String(Math.floor(((min % 1440) + 1440) % 1440 / 60)).padStart(2, '0') + ':' + String(((min % 60) + 60) % 60).padStart(2, '0');
const minOf = (hm) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);

// Công tắc + giờ gợi ý theo ca của ngày: làm thêm bắt đầu từ giờ kết thúc ca, tăng ca trưa = giờ nghỉ giữa ca
r.get('/info', (req, res) => {
  if (!on(req)) return res.json({ enabled: false });
  const date = ISO.test(String(req.query.date || '')) ? req.query.date : vnDateStr();
  let suggest = {};
  try {
    const sh = resolveEffectiveShift(req.user.id, date, `${date}T00:00:00Z`, null).shift;
    if (sh) {
      suggest = { ot_from: sh.end_time || '', shift: `${sh.name || ''} (${sh.start_time}–${sh.end_time})` };
      if (sh.break_start && sh.break_minutes > 0) { suggest.lunch_from = sh.break_start; suggest.lunch_to = toHm(minOf(sh.break_start) + sh.break_minutes); }
    }
  } catch { /* không dò được ca → không gợi ý */ }
  res.json({ enabled: true, lunch: otLunchOn(), kinds: OT_REQ_KIND, minDate: addDays(vnDateStr(), -BACK_DAYS), maxDate: addDays(vnDateStr(), AHEAD_DAYS), suggest });
});

// Gửi đơn
r.post('/', (req, res) => {
  if (!on(req)) return res.status(403).json({ error: 'Chức năng tự đăng ký làm thêm đang tắt' });
  const b = req.body || {};
  const date = String(b.work_date || '').slice(0, 10);
  const kind = b.kind === 'lunch' ? 'lunch' : 'ot';
  if (kind === 'lunch' && !otLunchOn()) return res.status(400).json({ error: 'Công ty chưa bật đăng ký tăng ca trưa' });
  if (!ISO.test(date)) return res.status(400).json({ error: 'Chọn ngày làm thêm' });
  const today = vnDateStr();
  if (date < addDays(today, -BACK_DAYS) || date > addDays(today, AHEAD_DAYS)) return res.status(400).json({ error: `Chỉ đăng ký cho ngày trong khoảng ${BACK_DAYS} ngày trước tới ${AHEAD_DAYS} ngày tới` });
  const f = normHm(b.from_hm), t = normHm(b.to_hm);
  if (!f || !t) return res.status(400).json({ error: 'Nhập giờ bắt đầu và giờ kết thúc (dạng 17:30)' });
  const minutes = hmSpan(f, t);
  if (!minutes) return res.status(400).json({ error: 'Giờ kết thúc phải khác giờ bắt đầu' });
  if (kind === 'lunch' && minutes > 240) return res.status(400).json({ error: 'Tăng ca trưa tối đa 4 giờ — kiểm tra lại giờ bắt đầu / kết thúc' });
  const reason = String(b.reason || '').trim().slice(0, 300);
  // trùng giờ với đơn khác (đang chờ / đã duyệt) cùng ngày cùng loại → không nhận
  const mine = db.prepare("SELECT from_hm, to_hm FROM ot_requests WHERE employee_id=? AND work_date=? AND kind=? AND status IN ('pending','approved')").all(req.user.id, date, kind);
  if (kind === 'lunch' && mine.length) return res.status(400).json({ error: 'Ngày này đã có đơn tăng ca trưa — muốn đổi giờ thì huỷ đơn cũ (khi còn chờ duyệt) rồi gửi lại' });
  const a0 = minOf(f), a1 = a0 + minutes;
  const clash = mine.find((x) => { const b0 = minOf(x.from_hm), b1 = b0 + hmSpan(x.from_hm, x.to_hm); return [-1440, 0, 1440].some((s) => a0 < b1 + s && b0 + s < a1); });
  if (clash) return res.status(400).json({ error: `Trùng giờ với đơn ${clash.from_hm}–${clash.to_hm} đã gửi cho ngày này` });
  const id = db.prepare('INSERT INTO ot_requests(employee_id, work_date, kind, from_hm, to_hm, minutes, reason) VALUES (?,?,?,?,?,?,?)')
    .run(req.user.id, date, kind, f, t, minutes, reason).lastInsertRowid;
  res.json({ ok: true, request: db.prepare('SELECT * FROM ot_requests WHERE id=?').get(id) });
  // báo người có quyền duyệt (Sửa công) — không chờ
  notifyPerm('attendance_edit', { title: '⏰ ' + (req.user.full_name || 'Nhân viên') + ' gửi đơn ' + OT_REQ_KIND[kind].toLowerCase(),
    body: `Ngày ${date.slice(8)}/${date.slice(5, 7)}: ${f}–${t}` + (reason ? ' · ' + reason : ''), url: '/admin', tag: 'otreq-new-' + id }).catch(() => {});
});

// Đơn của tôi (60 đơn gần nhất)
r.get('/mine', (req, res) => {
  res.json({ rows: db.prepare('SELECT * FROM ot_requests WHERE employee_id=? ORDER BY work_date DESC, created_at DESC LIMIT 60').all(req.user.id) });
});

// Huỷ đơn còn chờ duyệt
r.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM ot_requests WHERE id=?').get(req.params.id);
  if (!row || row.employee_id !== req.user.id) return res.status(404).json({ error: 'Không tìm thấy đơn' });
  if (row.status !== 'pending') return res.status(400).json({ error: 'Đơn đã được xử lý, không huỷ được — liên hệ quản lý' });
  db.prepare('DELETE FROM ot_requests WHERE id=?').run(row.id);
  res.json({ ok: true });
});

export default r;
