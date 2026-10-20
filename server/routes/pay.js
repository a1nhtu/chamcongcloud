// PHIẾU LƯƠNG CỦA NHÂN VIÊN trên app (/api/pay/*) — chỉ khi bật Tiền lương nâng cao + "Nhân viên xem phiếu lương trên app";
// chỉ thấy phiếu của CHÍNH MÌNH, của bảng lương đã chốt và đã được gửi (published). Tắt → config.enabled = false, app y như cũ.
import { Router } from 'express';
import { authRequired } from '../auth.js';
import { sendCaughtError } from '../util.js';
import { notifyPerm } from '../push.js';
import { payProEnabled, payFlags, mySlips, mySlip, sendFeedback } from '../payroll-pro.js';

const r = Router();
r.use(authRequired);
const on = (req) => payProEnabled() && payFlags().app_slip && !req.user.master && !req.user.audit_only;
const wrap = (name, fn) => (req, res) => {
  if (!on(req)) return res.status(403).json({ error: 'Chưa bật xem phiếu lương trên app' });
  try { fn(req, res); } catch (e) { sendCaughtError(res, name, e); }
};

r.get('/config', (req, res) => res.json({ enabled: on(req) }));
r.get('/slips', wrap('GET /pay/slips', (req, res) => res.json({ rows: mySlips(req.user.id) })));
r.get('/slips/:id', wrap('GET /pay/slips/:id', (req, res) => res.json(mySlip(req.user.id, +req.params.id))));
r.post('/slips/:id/feedback', wrap('POST /pay/slips/feedback', (req, res) => {
  sendFeedback(req.user.id, +req.params.id, req.body?.text);
  notifyPerm('salary', { title: 'Phản hồi phiếu lương', body: `${req.user.full_name}: ${String(req.body?.text || '').slice(0, 100)}`, url: '/admin#salary' }).catch(() => {});
  res.json({ ok: true });
}));

export default r;
