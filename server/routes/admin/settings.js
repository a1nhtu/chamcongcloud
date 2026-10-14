// Nhóm route CÀI ĐẶT hệ thống + logo thương hiệu + cập nhật phần mềm.
import { db, getSetting, setSetting, attModeMix } from '../../db.js';
import { saveBrandLogo, removeBrandLogo } from '../../storage.js';
import { checkUpdate, applyUpdate, currentVersion, updateConfig } from '../../update.js';
import { auditAllowed } from '../../virtual-att.js';

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
      ot_rounding: getSetting('ot_rounding', '2'), ot_rounding_mode: getSetting('ot_rounding_mode', '0'),   // làm tròn số giờ tăng ca
      ot_rounding_type: getSetting('ot_rounding_type', 'hour'), ot_rounding_block: getSetting('ot_rounding_block', '15'),   // hour = theo số lẻ giờ · block = theo khối phút
      late_round_block: getSetting('late_round_block', '0'),
      leave_days_per_year: getSetting('leave_days_per_year', '12'), leave_seniority_years: getSetting('leave_seniority_years', '5'),
      leave_seniority_add: getSetting('leave_seniority_add', '1'), leave_accrual: getSetting('leave_accrual', 'year'),
      leave_prorate_new: getSetting('leave_prorate_new', '1'), leave_carry_max: getSetting('leave_carry_max', '0'),
      leave_carry_until_month: getSetting('leave_carry_until_month', '3'), leave_allow_over: getSetting('leave_allow_over', '0'),
      weekend_normal_depts: (() => { try { return JSON.parse(getSetting('weekend_normal_depts', '[]')) || []; } catch { return []; } })(),   // làm tròn LÊN đi trễ / về sớm theo khối phút (0 = không)
      pay_period_start_day: getSetting('pay_period_start_day', '1'),
      ot_rate_weekday: getSetting('ot_rate_weekday', '1.5'), ot_rate_weekend: getSetting('ot_rate_weekend', '2'), ot_rate_holiday: getSetting('ot_rate_holiday', '3'),
      geofence_enforce: getSetting('geofence_enforce', '0'),
      attendance_mode: getSetting('attendance_mode', 'shift'),   // shift | hourly
      ...attModeMix(),   // any_shift / any_hourly: công ty đang có NV chấm theo ca / theo giờ
      hourly_merge_rule: getSetting('hourly_merge_rule', 'filo'), // theo giờ: filo | pairs (nhiều lần vào/ra)
      device_enabled: getSetting('device_enabled', '0'),         // dùng máy chấm công
      tcp_device_enabled: getSetting('tcp_device_enabled', '0'), // dùng máy chấm công kết nối trực tiếp TCP/IP (cổng 4370)
      phone_enabled: getSetting('phone_enabled', '1'),           // dùng chấm công điện thoại (selfie+GPS)
      // Giá trị bộ cài (config.txt) đặt sẵn lúc cài — chỉ để hiện gợi ý; tài khoản tổng vẫn đổi được trên web
      use_device_cfg: ['0', '1'].includes(process.env.USE_DEVICE) ? process.env.USE_DEVICE : '',
      use_phone_cfg: ['0', '1'].includes(process.env.USE_PHONE) ? process.env.USE_PHONE : '',
      device_autocreate: getSetting('device_autocreate', '1'),   // tự tạo NV khi máy đăng ký vân tay
      device_key_required: getSetting('device_key_required', '0'),// bắt buộc key theo máy mới duyệt được
      audit_enabled: req.forceVirt ? '0' : getSetting('audit_enabled', '0'),   // CÔNG ẢO / LƯƠNG ẢO — chỉ tài khoản tổng bật (tài khoản kiểm tra: luôn '0')
      ...(auditAllowed(req.user) && !req.forceVirt ? {
        audit_ot_day_min: getSetting('audit_ot_day_min', '0'), audit_ot_week_h: getSetting('audit_ot_week_h', '0'),
        audit_ot_month_h: getSetting('audit_ot_month_h', '0'), audit_ot_year_h: getSetting('audit_ot_year_h', '0'),
        audit_incl_weekend: getSetting('audit_incl_weekend', '1'), audit_incl_holiday: getSetting('audit_incl_holiday', '1'),
        audit_method: getSetting('audit_method', 'ratio'), audit_block: getSetting('audit_block', '15'),
        audit_week_lv: getSetting('audit_week_lv', '1,2,3'), audit_month_lv: getSetting('audit_month_lv', '1,2,3'), audit_year_lv: getSetting('audit_year_lv', '1,2,3'),
        audit_sun_l1: getSetting('audit_sun_l1', ''), audit_sun_l2: getSetting('audit_sun_l2', ''), audit_sun_l3: getSetting('audit_sun_l3', ''),
        audit_clamp_lv: getSetting('audit_clamp_lv', ''), audit_clamp_in_min: getSetting('audit_clamp_in_min', '14'), audit_clamp_out_min: getSetting('audit_clamp_out_min', '14'),
      } : {}),
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
    if (b.ot_rounding != null) setSetting('ot_rounding', String(Math.max(0, Math.min(3, parseInt(b.ot_rounding, 10) || 0))));
    if (b.ot_rounding_mode != null) setSetting('ot_rounding_mode', String(parseInt(b.ot_rounding_mode, 10) === 1 ? 1 : 0));
    if (b.ot_rounding_type != null) setSetting('ot_rounding_type', b.ot_rounding_type === 'block' ? 'block' : 'hour');
    if (b.ot_rounding_block != null) {
      const v = parseInt(b.ot_rounding_block, 10);
      if (!(v >= 1 && v <= 240)) return res.status(400).json({ error: 'Khối phút làm tròn tăng ca phải từ 1 đến 240' });
      setSetting('ot_rounding_block', String(v));
    }
    if (Array.isArray(b.weekend_normal_depts)) setSetting('weekend_normal_depts', JSON.stringify(b.weekend_normal_depts.map((x) => String(x).trim()).filter(Boolean)));
    // Phép năm
    for (const [k, lo, hi] of [['leave_days_per_year', 0, 60], ['leave_seniority_years', 0, 50], ['leave_seniority_add', 0, 30], ['leave_carry_max', 0, 60], ['leave_carry_until_month', 0, 12]]) {
      if (b[k] == null) continue;
      const v = parseFloat(b[k]);
      if (!(Number.isFinite(v) && v >= lo && v <= hi)) return res.status(400).json({ error: `Giá trị phép năm không hợp lệ (${k})` });
      setSetting(k, String(v));
    }
    if (b.leave_accrual != null) setSetting('leave_accrual', b.leave_accrual === 'month' ? 'month' : 'year');
    if (b.leave_prorate_new != null) setSetting('leave_prorate_new', b.leave_prorate_new ? '1' : '0');
    if (b.leave_allow_over != null) setSetting('leave_allow_over', b.leave_allow_over ? '1' : '0');
    if (b.late_round_block != null) {
      const v = parseInt(b.late_round_block, 10) || 0;
      if (!(v >= 0 && v <= 120)) return res.status(400).json({ error: 'Khối phút làm tròn đi trễ / về sớm phải từ 0 đến 120' });
      setSetting('late_round_block', String(v));
    }
    if (b.pay_period_start_day != null) setSetting('pay_period_start_day', b.pay_period_start_day);
    // Hệ số tăng ca chung: NV đang dùng đúng hệ số chung CŨ (chưa đặt riêng) được đổi theo; NV đã đặt hệ số riêng giữ nguyên
    for (const [k, d] of [['ot_rate_weekday', '1.5'], ['ot_rate_weekend', '2'], ['ot_rate_holiday', '3']]) {
      if (b[k] == null) continue;
      const v = parseFloat(b[k]);
      if (!(Number.isFinite(v) && v > 0 && v <= 10)) return res.status(400).json({ error: 'Hệ số tăng ca phải từ 0,1 đến 10' });
      const old = parseFloat(getSetting(k, d));
      if (v !== old) db.prepare(`UPDATE salary_configs SET ${k} = ? WHERE ABS(${k} - ?) < 0.0001`).run(v, old);
      setSetting(k, String(v));
    }
    if (b.geofence_enforce != null) setSetting('geofence_enforce', b.geofence_enforce ? '1' : '0');
    if (b.attendance_mode != null) setSetting('attendance_mode', b.attendance_mode === 'hourly' ? 'hourly' : 'shift');
    if (b.hourly_merge_rule != null) setSetting('hourly_merge_rule', b.hourly_merge_rule === 'pairs' ? 'pairs' : 'filo');
    // Bật/tắt tính năng MÁY CHẤM CÔNG: CHỈ tài khoản tổng mới đổi được
    if (req.user.master) {
      if (b.device_enabled != null) setSetting('device_enabled', b.device_enabled ? '1' : '0');
      if (b.tcp_device_enabled != null) setSetting('tcp_device_enabled', b.tcp_device_enabled ? '1' : '0');
      if (b.phone_enabled != null) setSetting('phone_enabled', b.phone_enabled ? '1' : '0');
      if (b.device_autocreate != null) setSetting('device_autocreate', b.device_autocreate ? '1' : '0');
      if (b.device_key_required != null) setSetting('device_key_required', b.device_key_required ? '1' : '0');
      if (b.audit_enabled != null) setSetting('audit_enabled', b.audit_enabled ? '1' : '0');
    }
    // Hạn mức công ảo: người được xem công ảo mới chỉnh được
    if (auditAllowed(req.user)) {
      const n = (v, max) => { const x = parseFloat(v); return Number.isFinite(x) && x >= 0 ? String(Math.min(max, x)) : null; };
      for (const [k, max] of [['audit_ot_day_min', 1440], ['audit_ot_week_h', 168], ['audit_ot_month_h', 744], ['audit_ot_year_h', 8784], ['audit_block', 120]])
        if (b[k] != null) { const v = n(b[k], max); if (v == null) return res.status(400).json({ error: 'Hạn mức tăng ca phải là số ≥ 0' }); setSetting(k, v); }
      if (b.audit_incl_weekend != null) setSetting('audit_incl_weekend', b.audit_incl_weekend ? '1' : '0');
      if (b.audit_incl_holiday != null) setSetting('audit_incl_holiday', b.audit_incl_holiday ? '1' : '0');
      if (b.audit_method != null) setSetting('audit_method', b.audit_method === 'days' ? 'days' : 'ratio');
      // hạn mức tuần / tháng / năm + khống chế giờ chấm: áp cho những mức ảo nào ('1,2,3'; '' = không mức nào)
      for (const k of ['audit_week_lv', 'audit_month_lv', 'audit_year_lv', 'audit_clamp_lv'])
        if (b[k] != null) setSetting(k, [...new Set(String(b[k]).split(',').map((x) => parseInt(x, 10)).filter((x) => [1, 2, 3].includes(x)))].sort().join(','));
      // chủ nhật đi làm tối đa / tháng của từng mức ảo ('' = không giới hạn)
      for (const k of ['audit_sun_l1', 'audit_sun_l2', 'audit_sun_l3']) if (b[k] != null) {
        const v = String(b[k]).trim();
        if (v === '') { setSetting(k, ''); continue; }
        const x = parseInt(v, 10);
        if (!Number.isFinite(x) || x < 0 || x > 6 || String(x) !== v) return res.status(400).json({ error: 'Số chủ nhật đi làm tối đa phải là số nguyên 0 – 6 (để trống = không giới hạn)' });
        setSetting(k, String(x));
      }
      for (const k of ['audit_clamp_in_min', 'audit_clamp_out_min'])
        if (b[k] != null) { const v = n(b[k], 120); if (v == null) return res.status(400).json({ error: 'Số phút khống chế giờ chấm phải là số ≥ 0' }); setSetting(k, String(Math.round(+v))); }
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
