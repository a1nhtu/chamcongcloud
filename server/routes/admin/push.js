// Nhóm route THÔNG BÁO ĐẨY (Web Push) cho quản lý — tách khỏi admin.js.
import { getVapid, saveSubscription, removeSubscription, notifyManagers } from '../../push.js';
import { sendCaughtError } from '../../util.js';

export function registerPushRoutes(r) {
  r.get('/push/vapid', (req, res) => res.json({ publicKey: getVapid().publicKey }));
  r.post('/push/subscribe', (req, res) => {
    try { saveSubscription(req.user.id, req.body?.subscription); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.post('/push/unsubscribe', (req, res) => { removeSubscription(req.body?.endpoint); res.json({ ok: true }); });
  r.post('/push/test', async (req, res) => {
    try { const r2 = await notifyManagers({ title: 'Digiplus Chấm công', body: 'Thông báo thử — hoạt động tốt ✅', url: '/admin' }); res.json({ ok: true, ...r2 }); }
    catch (e) { sendCaughtError(res, 'POST /admin/push/test', e, { status: 400 }); }
  });
}
