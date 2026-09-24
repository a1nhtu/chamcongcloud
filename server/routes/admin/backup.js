// Nhóm route SAO LƯU / PHỤC HỒI dữ liệu — tách khỏi admin.js (đăng ký lên router chung).
import { raw } from 'express';
import { getSetting, setSetting } from '../../db.js';
import { doBackup, listBackups, pruneBackups, backupPath, deleteBackup, stageRestore, doFullBackup, stageFullRestore } from '../../backup.js';
import { sendCaughtError } from '../../util.js';

export function registerBackupRoutes(r, { need }) {
  r.get('/backup', need('backup'), (req, res) => {
    res.json({
      config: {
        enabled: getSetting('backup_enabled', '1') === '1',
        hour: parseInt(getSetting('backup_hour', '2'), 10),
        keep_days: parseInt(getSetting('backup_keep_days', '7'), 10),
        last_date: getSetting('backup_last_date', ''),
      },
      list: listBackups(),
    });
  });
  r.put('/backup/config', need('backup'), (req, res) => {
    const b = req.body || {};
    if (b.enabled != null) setSetting('backup_enabled', b.enabled ? '1' : '0');
    if (b.hour != null) setSetting('backup_hour', String(Math.max(0, Math.min(23, +b.hour || 0))));
    if (b.keep_days != null) setSetting('backup_keep_days', String(Math.max(1, +b.keep_days || 7)));
    pruneBackups(getSetting('backup_keep_days', '7'));
    res.json({ ok: true });
  });
  r.post('/backup/now', need('backup'), (req, res) => {
    try { const r2 = doBackup('manual'); pruneBackups(getSetting('backup_keep_days', '7')); res.json({ ok: true, ...r2 }); }
    catch (e) { sendCaughtError(res, 'POST /admin/backup/now', e); }
  });
  r.get('/backup/download', need('backup'), (req, res) => {
    const p = backupPath(req.query.name || '');
    if (!p) return res.status(404).json({ error: 'Không tìm thấy bản sao lưu' });
    res.download(p, req.query.name);
  });
  r.delete('/backup', need('backup'), (req, res) => {
    if (!deleteBackup(req.query.name || '')) return res.status(404).json({ error: 'Không tìm thấy bản sao lưu' });
    res.json({ ok: true });
  });
  // Phục hồi: nhận file .db (nhị phân) → ghi file chờ, cần khởi động lại app để áp
  r.post('/backup/restore', need('backup'), raw({ type: () => true, limit: '200mb' }), (req, res) => {
    try {
      if (!req.body || !req.body.length) return res.status(400).json({ error: 'Chưa nhận được file' });
      stageRestore(req.body);
      res.json({ ok: true, restartNeeded: true });
    } catch (e) { sendCaughtError(res, 'POST /admin/backup/restore', e, { status: 400 }); }
  });
  // Sao lưu TOÀN BỘ (.zip = DB + ảnh + logo) — dùng khi chuyển máy/VPS
  r.post('/backup/full', need('backup'), (req, res) => {
    try { res.json({ ok: true, ...doFullBackup() }); }
    catch (e) { sendCaughtError(res, 'POST /admin/backup/full', e, { message: 'Không tạo được bản sao lưu toàn bộ, vui lòng thử lại hoặc liên hệ Digiplus' }); }
  });
  // Phục hồi TOÀN BỘ từ .zip → nạp DB (áp lúc khởi động lại) + thay ảnh/logo ngay
  r.post('/backup/full-restore', need('backup'), raw({ type: () => true, limit: '500mb' }), (req, res) => {
    try {
      if (!req.body || !req.body.length) return res.status(400).json({ error: 'Chưa nhận được file' });
      stageFullRestore(req.body);
      res.json({ ok: true, restartNeeded: true });
    } catch (e) { sendCaughtError(res, 'POST /admin/backup/full-restore', e, { status: 400 }); }
  });
}
