// Nhóm route MẪU BÁO CÁO RIÊNG của công ty (server/custom-reports.js) — chỉ tài khoản tổng thêm / sửa / xoá.
// Xem + xuất Excel mẫu riêng đi qua /api/reports (type = cr + id) như báo cáo thường.
import { saveCustom, deleteCustom } from '../../custom-reports.js';

export function registerCustomReportRoutes(r) {
  const masterOnly = (req, res, next) => (req.user?.master ? next() : res.status(403).json({ error: 'Chỉ tài khoản tổng (Digiplus) sửa được mẫu báo cáo riêng' }));
  r.post('/custom-reports', masterOnly, (req, res) => {
    try { res.json(saveCustom({ ...(req.body || {}), id: null })); } catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.put('/custom-reports/:id', masterOnly, (req, res) => {
    try { res.json(saveCustom({ ...(req.body || {}), id: +req.params.id })); } catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.delete('/custom-reports/:id', masterOnly, (req, res) => res.json({ ok: deleteCustom(req.params.id) }));
}
