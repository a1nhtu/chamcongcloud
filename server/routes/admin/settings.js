// Nhóm route CÀI ĐẶT hệ thống + logo thương hiệu + cập nhật phần mềm.
import { getSetting, setSetting, attModeMix } from '../../db.js';
import { saveBrandLogo, removeBrandLogo } from '../../storage.js';
import { checkUpdate, applyUpdate, currentVersion, updateConfig } from '../../update.js';

export function registerSettingsRoutes(r, { need, adminOnly }) {
  /* ----------------------------- CÀI ĐẶT ----------------------------- */
  r.get('/settings', (req, res) => {
    res.json({
      company_name: getSetting('company_name', 'Digiplus'),
      company_address: getSetting('company_address', ''),
      weekend_days: getSetting('weekend_days', '7'),
      weekend_work_as_ot: getSetting('weekend_work_as_ot', '1'),
      workunit_rounding: getSetting('workunit_rounding', '2'),
      workunit_rounding_mode: getSetting('workunit_rounding_mode', '0'), // 0=lùi,1=tới,2=gần nhất
      pay_period_start_day: getSetting('pay_period_start_day', '1'),
      geofence_enforce: getSetting('geofence_enforce', '0'),
      attendance_mode: getSetting('attendance_mode', 'shift'),   // shift | hourly
      ...attModeMix(),   // any_shift / any_hourly: công ty đang có NV chấm theo ca / theo giờ
      hourly_merge_rule: getSetting('hourly_merge_rule', 'filo'), // theo giờ: filo | pairs (nhiều lần vào/ra)
      device_enabled: getSetting('device_enabled', '0'),         // dùng máy chấm công
      phone_enabled: getSetting('phone_enabled', '1'),           // dùng chấm công điện thoại (selfie+GPS)
      // Nếu bộ cài (config.txt) có đặt sẵn USE_DEVICE/USE_PHONE thì 2 mục này do bộ cài quyết (khoá UI)
      use_device_locked: process.env.USE_DEVICE === '0' || process.env.USE_DEVICE === '1',
      use_phone_locked: process.env.USE_PHONE === '0' || process.env.USE_PHONE === '1',
      device_autocreate: getSetting('device_autocreate', '1'),   // tự tạo NV khi máy đăng ký vân tay
      device_key_required: getSetting('device_key_required', '0'),// bắt buộc key theo máy mới duyệt được
      device_lock_enabled: getSetting('device_lock_enabled', '0'), // khoá thiết bị chấm công điện thoại
      payroll_include_admin: getSetting('payroll_include_admin', '0'), // tính công cho cả tài khoản Admin
      self_shift_enabled: getSetting('self_shift_enabled', '0'), // NV tự chọn ca
      self_shift_approve: getSetting('self_shift_approve', '1'), // chọn ca cần duyệt
      punch_dedup_min: getSetting('punch_dedup_min', '15'),       // bỏ qua lần chấm trùng trong N phút
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
    if (b.weekend_work_as_ot != null) setSetting('weekend_work_as_ot', b.weekend_work_as_ot ? '1' : '0');
    if (b.workunit_rounding != null) setSetting('workunit_rounding', b.workunit_rounding);
    if (b.workunit_rounding_mode != null) setSetting('workunit_rounding_mode', String(parseInt(b.workunit_rounding_mode, 10) || 0));
    if (b.pay_period_start_day != null) setSetting('pay_period_start_day', b.pay_period_start_day);
    if (b.geofence_enforce != null) setSetting('geofence_enforce', b.geofence_enforce ? '1' : '0');
    if (b.attendance_mode != null) setSetting('attendance_mode', b.attendance_mode === 'hourly' ? 'hourly' : 'shift');
    if (b.hourly_merge_rule != null) setSetting('hourly_merge_rule', b.hourly_merge_rule === 'pairs' ? 'pairs' : 'filo');
    // Bật/tắt tính năng MÁY CHẤM CÔNG: CHỈ tài khoản tổng mới đổi được
    if (req.user.master) {
      if (b.device_enabled != null) setSetting('device_enabled', b.device_enabled ? '1' : '0');
      if (b.phone_enabled != null) setSetting('phone_enabled', b.phone_enabled ? '1' : '0');
      if (b.device_autocreate != null) setSetting('device_autocreate', b.device_autocreate ? '1' : '0');
      if (b.device_key_required != null) setSetting('device_key_required', b.device_key_required ? '1' : '0');
    }
    if (b.device_lock_enabled != null) setSetting('device_lock_enabled', b.device_lock_enabled ? '1' : '0');
    if (b.punch_dedup_min != null) setSetting('punch_dedup_min', String(Math.max(0, parseInt(b.punch_dedup_min, 10) || 0)));
    if (b.payroll_include_admin != null) setSetting('payroll_include_admin', b.payroll_include_admin ? '1' : '0');
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
