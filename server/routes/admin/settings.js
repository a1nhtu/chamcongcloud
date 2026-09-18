// Nhóm route CÀI ĐẶT hệ thống + logo thương hiệu + cập nhật phần mềm.
import { getSetting, setSetting } from '../../db.js';
import { saveBrandLogo, removeBrandLogo } from '../../storage.js';
import { checkUpdate, applyUpdate, currentVersion, updateConfig } from '../../update.js';

export function registerSettingsRoutes(r, { need, adminOnly }) {
  /* ----------------------------- CÀI ĐẶT ----------------------------- */
  r.get('/settings', (req, res) => {
    res.json({
      company_name: getSetting('company_name', 'Digiplus'),
      company_address: getSetting('company_address', ''),
      weekend_days: getSetting('weekend_days', '7'),
      workunit_rounding: getSetting('workunit_rounding', '2'),
      workunit_rounding_mode: getSetting('workunit_rounding_mode', '0'), // 0=lùi,1=tới,2=gần nhất
      pay_period_start_day: getSetting('pay_period_start_day', '1'),
      geofence_enforce: getSetting('geofence_enforce', '0'),
      attendance_mode: getSetting('attendance_mode', 'shift'),   // shift | hourly
      device_enabled: getSetting('device_enabled', '0'),         // dùng máy chấm công
      device_autocreate: getSetting('device_autocreate', '1'),   // tự tạo NV khi máy đăng ký vân tay
      device_lock_enabled: getSetting('device_lock_enabled', '0'), // khoá thiết bị chấm công điện thoại
      self_shift_enabled: getSetting('self_shift_enabled', '0'), // NV tự chọn ca
      self_shift_approve: getSetting('self_shift_approve', '1'), // chọn ca cần duyệt
      setup_done: getSetting('setup_done', '0'),
      company_logo: getSetting('company_logo', ''),
      app_version: currentVersion(),
      update_repo: updateConfig().repo,
      update_branch: updateConfig().branch,
    });
  });
  r.put('/settings', need('settings'), (req, res) => {
    const b = req.body || {};
    if (b.company_name != null) setSetting('company_name', b.company_name);
    if (b.company_address != null) setSetting('company_address', b.company_address);
    if (b.weekend_days != null) setSetting('weekend_days', b.weekend_days);
    if (b.workunit_rounding != null) setSetting('workunit_rounding', b.workunit_rounding);
    if (b.workunit_rounding_mode != null) setSetting('workunit_rounding_mode', String(parseInt(b.workunit_rounding_mode, 10) || 0));
    if (b.pay_period_start_day != null) setSetting('pay_period_start_day', b.pay_period_start_day);
    if (b.geofence_enforce != null) setSetting('geofence_enforce', b.geofence_enforce ? '1' : '0');
    if (b.attendance_mode != null) setSetting('attendance_mode', b.attendance_mode === 'hourly' ? 'hourly' : 'shift');
    // Bật/tắt tính năng MÁY CHẤM CÔNG: CHỈ tài khoản tổng mới đổi được
    if (req.user.master) {
      if (b.device_enabled != null) setSetting('device_enabled', b.device_enabled ? '1' : '0');
      if (b.device_autocreate != null) setSetting('device_autocreate', b.device_autocreate ? '1' : '0');
    }
    if (b.device_lock_enabled != null) setSetting('device_lock_enabled', b.device_lock_enabled ? '1' : '0');
    if (b.punch_dedup_min != null) setSetting('punch_dedup_min', String(Math.max(0, parseInt(b.punch_dedup_min, 10) || 0)));
    if (b.self_shift_enabled != null) setSetting('self_shift_enabled', b.self_shift_enabled ? '1' : '0');
    if (b.self_shift_approve != null) setSetting('self_shift_approve', b.self_shift_approve ? '1' : '0');
    if (b.setup_done != null) setSetting('setup_done', b.setup_done ? '1' : '0');
    if (b.update_repo != null) setSetting('update_repo', String(b.update_repo).trim());
    if (b.update_branch != null) setSetting('update_branch', String(b.update_branch).trim() || 'main');
    res.json({ ok: true });
  });

  // Logo công ty: upload (dataURL base64) hoặc xoá → hiện ở màn đăng nhập + app nhân viên
  r.post('/branding', need('settings'), (req, res) => {
    const b = req.body || {};
    try {
      if (b.remove) { removeBrandLogo(); setSetting('company_logo', ''); return res.json({ ok: true, logo: '' }); }
      const url = saveBrandLogo(b.logo);
      setSetting('company_logo', url);
      res.json({ ok: true, logo: url });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  /* ----------------------------- CẬP NHẬT PHẦN MỀM ----------------------------- */
  // Kiểm tra bản mới trên GitHub (chỉ admin)
  r.get('/update/check', adminOnly, async (req, res) => {
    try { res.json(await checkUpdate()); }
    catch (e) { res.status(400).json({ error: e.message, current: currentVersion() }); }
  });
  // Tải & áp dụng bản mới rồi khởi động lại (chỉ admin)
  r.post('/update/apply', adminOnly, async (req, res) => {
    try { res.json(await applyUpdate()); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
}
