/* ---------- 5b) LƯƠNG ---------- */
const money = (n) => (Number(n) || 0).toLocaleString('vi-VN');
let _salTab = 'config';
async function pageSalary() {
  // TIỀN LƯƠNG NÂNG CAO (public/payroll.js) — tài khoản tổng bật thì trang Lương dùng giao diện mới; tắt = y như cũ
  if (SETTINGS.pay_pro === '1' && !isInspector() && !_virt) {
    setMain(loading());
    try { const m = await import('/payroll.js'); return m.pagePayPro({ head, setMain, openModal, closeModal, loading, hasPerm, go }); }
    catch (e) { setMain(el('div', { class: 'empty' }, 'Không tải được phân hệ Tiền lương: ' + e.message)); return; }
  }
  // 2 THẺ (không phải nút bấm): thẻ đang chọn gạch chân màu cam, bấm lại thẻ đang chọn thì không làm gì
  const tabBtn = (key, label) => {
    const b = el('button', { type: 'button', class: 'tab-btn' + (_salTab === key ? ' on' : '') }, label);
    b.onclick = () => { if (_salTab === key) return; _salTab = key; pageSalary(); };
    return b;
  };
  const tabs = el('div', { class: 'tab-bar', style: 'margin-bottom:12px' }, tabBtn('config', '⚙ Cấu hình lương từng nhân viên'), tabBtn('payroll', '📄 Bảng lương / Phiếu lương'));
  if (_salTab === 'payroll') return salaryPayrollView(tabs);
  setMain(head('Lương'), tabs, loading());
  let data;
  try { data = await api('/admin/salary'); } catch (e) { setMain(head('Lương'), tabs, el('div', { class: 'empty' }, e.message)); return; }
  const tbl = el('table', { class: 'data' });
  const canEdit = hasPerm('salary');
  const tb = el('tbody');
  if (hourlyMode()) {
    tbl.innerHTML = `<thead><tr><th>Mã NV</th><th>Họ tên</th><th>Bộ phận</th><th>Đơn giá 1 giờ</th><th>Phụ cấp</th><th></th></tr></thead>`;
    for (const s of data.rows) {
      tb.append(el('tr', {},
        el('td', {}, s.code),
        el('td', {}, el('b', {}, s.full_name)),
        el('td', {}, s.department || '—'),
        el('td', {}, s.hourly_rate ? money(s.hourly_rate) : el('span', { style: 'color:#c0392b' }, 'chưa đặt')),
        el('td', {}, money(s.allowance)),
        el('td', {}, canEdit ? btnSm('Sửa', () => salaryModal(s)) : ''),
      ));
    }
  } else {
    tbl.innerHTML = `<thead><tr><th>Mã NV</th><th>Họ tên</th><th>Bộ phận</th><th>Lương cơ bản</th><th>Đơn giá ngày</th><th>Ngày công chuẩn</th><th>Hệ số OT (T/CT/Lễ)</th><th>Phụ cấp</th><th></th></tr></thead>`;
    for (const s of data.rows) {
      const wd = s.working_days_per_month || 26;
      const autoDaily = s.daily_rate ? null : Math.round((s.basic_salary || 0) / wd);
      tb.append(el('tr', {},
        el('td', {}, s.code),
        el('td', {}, el('b', {}, s.full_name)),
        el('td', {}, s.department || '—'),
        el('td', {}, money(s.basic_salary)),
        el('td', {}, s.daily_rate ? money(s.daily_rate) : el('span', { style: 'color:#999' }, money(autoDaily) + ' (auto)')),
        el('td', {}, String(wd)),
        el('td', {}, `${s.ot_rate_weekday ?? 1.5}/${s.ot_rate_weekend ?? 2}/${s.ot_rate_holiday ?? 3}`),
        el('td', {}, money(s.allowance)),
        el('td', {}, canEdit ? btnSm('Sửa', () => salaryModal(s)) : ''),
      ));
    }
  }
  tbl.append(tb);
  const hint = el('div', { class: 'map-hint', style: 'margin-bottom:10px' }, hourlyMode()
    ? 'Chế độ tính công theo giờ: Lương = Tổng giờ làm × đơn giá 1 giờ + phụ cấp.'
    : 'Lương = Số công × đơn giá ngày + OT (giờ × đơn giá giờ × hệ số) + nghỉ phép có lương + phụ cấp. Đơn giá giờ = đơn giá ngày ÷ số giờ chuẩn 1 ngày công (mặc định 8, đổi ở Cài đặt › Quy tắc tính công).');
  const howTo = canEdit ? el('div', { style: 'margin-bottom:8px;padding:9px 12px;border-radius:8px;background:#fff7ed;border:1px solid #fed7aa;font-size:13.5px' },
    '👉 Cài lương cho 1 người: bấm ', el('b', {}, 'Sửa'), ' ở cuối dòng nhân viên đó. Cài cho cả bộ phận (hoặc tất cả) một lần: bấm ', el('b', {}, '✎ Sửa hàng loạt'), ' ở góc trên.') : null;
  const bulkBtn = canEdit ? el('button', { class: 'btn sm', onclick: () => salaryBulkModal() }, '✎ Sửa hàng loạt') : null;
  setMain(head('Lương', bulkBtn), tabs, howTo, hint, el('div', { class: 'panel tbl-scroll' }, tbl));
}

// SỬA LƯƠNG HÀNG LOẠT: chọn bộ phận (kèm bộ phận con) hoặc tất cả, tích ô nào thì ghi đè ô đó, ô không tích giữ nguyên
async function salaryBulkModal() {
  const deptSel = el('select', { id: 'sb-dept' }, el('option', { value: '' }, '-- Tất cả nhân viên --'));
  try { const { rows } = await api('/reports/departments'); for (const d of rows) deptSel.append(el('option', { value: d }, d)); } catch {}
  const row = (key, label, inp) => {
    const chk = el('input', { type: 'checkbox', 'data-k': key });
    inp.disabled = true; chk.onchange = () => { inp.disabled = !chk.checked; if (chk.checked) inp.focus(); };
    return el('label', { style: 'display:grid;grid-template-columns:22px 1fr 160px;gap:8px;align-items:center;padding:5px 0' }, chk, el('span', {}, label), inp);
  };
  const num = (id, v, extra = {}) => el('input', { id, type: 'number', min: 0, value: v, ...extra });
  const rows = hourlyMode() ? [
    row('hourly_rate', 'Đơn giá 1 giờ (VNĐ)', num('sb-hourly_rate', 0)),
    row('allowance', 'Phụ cấp cố định / tháng (VNĐ)', num('sb-allowance', 0)),
  ] : [
    row('basic_salary', 'Lương cơ bản / tháng (VNĐ)', num('sb-basic_salary', 0)),
    row('daily_rate', 'Đơn giá 1 ngày công (để trống = tự tính)', num('sb-daily_rate', '')),
    row('working_days_per_month', 'Ngày công chuẩn / tháng', num('sb-working_days_per_month', 26, { min: 1, max: 31 })),
    row('ot_rate_weekday', 'Hệ số OT ngày thường', num('sb-ot_rate_weekday', 1.5, { step: '0.1' })),
    row('ot_rate_weekend', 'Hệ số OT cuối tuần', num('sb-ot_rate_weekend', 2, { step: '0.1' })),
    row('ot_rate_holiday', 'Hệ số OT ngày lễ', num('sb-ot_rate_holiday', 3, { step: '0.1' })),
    row('allowance', 'Phụ cấp cố định / tháng (VNĐ)', num('sb-allowance', 0)),
  ];
  const body = [
    field('Áp dụng cho', deptSel),
    el('div', { class: 'map-hint' }, 'Chọn bộ phận thì áp cho cả bộ phận con. Tích ô nào thì ô đó được ghi đè cho mọi người; ô không tích giữ nguyên như cũ.'),
    el('div', {}, ...rows),
  ];
  const save = el('button', { class: 'btn' }, 'Áp dụng');
  save.onclick = async () => {
    const fields = {};
    for (const c of document.querySelectorAll('#modal input[data-k]:checked')) {
      const k = c.dataset.k, v = $('#sb-' + k).value;
      fields[k] = k === 'daily_rate' ? (v ? +v : null) : +v;
    }
    if (!Object.keys(fields).length) return toast('Tích ít nhất 1 ô cần sửa', 'err');
    const who = deptSel.value ? `bộ phận "${deptSel.value}" (kèm bộ phận con)` : 'TẤT CẢ nhân viên';
    if (!confirm(`Ghi đè ${Object.keys(fields).length} ô lương cho ${who}?`)) return;
    try { const r = await api('/admin/salary/bulk', { method: 'POST', body: { dept: deptSel.value, fields } }); toast(`Đã cập nhật ${r.count} nhân viên`, 'ok'); closeModal(); pageSalary(); }
    catch (e) { toast(e.message, 'err'); }
  };
  openModal('Sửa lương hàng loạt', body, [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), save]);
}

/* ---------- Bảng lương + Phiếu lương ---------- */
const dmyFull = (d) => d.split('-').reverse().join('/');
async function salaryPayrollView(tabs) {
  // Chọn tháng = kỳ lương đã cài (Cài đặt › Lương); sửa Từ ngày / Đến ngày rồi Áp dụng = tính đúng khoảng đó (VD trả lương 05 → 04 tháng sau)
  const monthI = el('input', { type: 'month', value: todayMonth(), title: 'Chọn tháng: lấy theo kỳ lương đã cài' });
  const fromI = el('input', { type: 'date', title: 'Từ ngày', style: 'width:auto;margin:0' });
  const toI = el('input', { type: 'date', title: 'Đến ngày', style: 'width:auto;margin:0' });
  let custom = false;
  const dApply = dateApply(fromI, toI, () => { custom = true; load(); });
  const deptSel = el('select', {}, el('option', { value: '' }, '-- Tất cả phòng ban --'));
  const wrap = el('div', {}, loading());
  const vt = virtToggle(() => load());
  setMain(head('Lương', monthI, el('span', { class: 'muted' }, 'Từ'), fromI, el('span', { class: 'muted' }, 'đến'), toI, dApply.btn, deptSel, vt), tabs, wrap);
  try { const { rows } = await api('/reports/departments'); for (const d of rows) deptSel.append(el('option', { value: d }, d)); } catch {}

  const load = async () => {
    wrap.innerHTML = ''; wrap.append(loading());
    let data;
    const when = custom ? `from=${fromI.value}&to=${toI.value}` : `month=${monthI.value}`;
    try { data = await api(`/admin/payroll?${when}&dept=${encodeURIComponent(deptSel.value)}` + (_virt && auditOn() ? '&virt=' + _virt : '')); }
    catch (e) { wrap.innerHTML = ''; wrap.append(el('div', { class: 'empty' }, e.message)); return; }
    fromI.value = data.from; toI.value = data.to; dApply.synced();
    const hourly = data.mode === 'hourly';
    const night = data.rows.some(({ pay }) => pay.nightPay !== undefined);   // đang bật Phụ cấp làm đêm
    const tbl = el('table', { class: 'data' });
    tbl.innerHTML = hourly
      ? '<thead><tr><th>Mã NV</th><th>Họ tên</th><th>Bộ phận</th><th>Tổng giờ</th><th>Đơn giá giờ</th><th>Lương giờ</th>' + (night ? '<th>Giờ đêm</th><th>Phụ cấp đêm</th>' : '') + '<th>Phụ cấp</th><th>Thực lĩnh</th><th></th></tr></thead>'
      : '<thead><tr><th>Mã NV</th><th>Họ tên</th><th>Bộ phận</th><th>Công</th><th>Phép</th><th>OT(g)</th><th>Đơn giá ngày</th><th>Lương công</th><th>Lương OT</th>' + (night ? '<th>Giờ đêm</th><th>Phụ cấp đêm</th>' : '') + '<th>Phụ cấp</th><th>Thực lĩnh</th><th></th></tr></thead>';
    const tb = el('tbody');
    if (!data.rows.length) tb.append(el('tr', {}, el('td', { colspan: (hourly ? 9 : 12) + (night ? 2 : 0) }, el('div', { class: 'empty' }, 'Chưa có nhân viên.'))));
    for (const { emp, pay } of data.rows) {
      const psBtn = btnSm('🧾 Phiếu lương', () => payslipModal(emp, pay, data));
      const cells = hourly
        ? [emp.code, emp.full_name, emp.department || '', pay.totalHours, money(pay.hourlyRate), money(pay.workSalary), money(pay.allowance), money(pay.net)]
        : [emp.code, emp.full_name, emp.department || '', pay.workUnits, pay.paidLeaveDays, pay.otHoursTotal, money(pay.dailyRate), money(pay.workSalary), money(pay.otSalary), money(pay.allowance), money(pay.net)];
      if (night) cells.splice(cells.length - 2, 0, Math.round(((pay.nightHours || 0) + (pay.nightOtHours || 0)) * 100) / 100, money(pay.nightPay));
      const tr = el('tr', {});
      cells.forEach((c, i) => tr.append(el('td', i === 1 ? {} : {}, i === 1 ? el('b', {}, c) : String(c))));
      tr.append(el('td', {}, psBtn));
      tb.append(tr);
    }
    tbl.append(tb);
    const totNet = data.rows.reduce((s, r) => s + (r.pay.net || 0), 0);
    wrap.innerHTML = '';
    wrap.append(
      el('div', { style: 'font-weight:800;font-size:16px;color:var(--ink);margin-bottom:4px' }, data.custom ? `Bảng lương từ ${dmyFull(data.from)} đến ${dmyFull(data.to)}` : `Bảng lương tháng ${data.month}`),
      el('div', { class: 'map-hint', style: 'margin-bottom:10px' }, `Kỳ lương: ${data.from} → ${data.to} · Tổng thực lĩnh: ${money(totNet)} đ` + (data.custom ? ' · Phụ cấp cố định tính đủ 1 lần cho kỳ đang chọn' : '')),
      el('div', { class: 'panel tbl-scroll' }, tbl));
  };
  monthI.onchange = () => { custom = false; load(); };
  deptSel.onchange = load;
  load();
}

// Phiếu lương 1 nhân viên (in được)
function payslipModal(emp, pay, ctx) {
  const hourly = ctx.mode === 'hourly';
  const line = (label, val, bold) => el('div', { style: 'display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #eee' + (bold ? ';font-weight:800;font-size:15px;border-bottom:2px solid #ddd' : '') },
    el('span', {}, label), el('span', { style: 'font-variant-numeric:tabular-nums' }, val));
  const rows = hourly ? [
    line('Tổng giờ làm', pay.totalHours + ' giờ'),
    line('Số ngày có công', String(pay.daysWorked)),
    line('Đơn giá 1 giờ', money(pay.hourlyRate) + ' đ'),
    line('Lương theo giờ', money(pay.workSalary) + ' đ'),
    ...(pay.nightPay ? [line(`Phụ cấp làm đêm (${pay.nightHours} giờ)`, money(pay.nightPay) + ' đ')] : []),
    line('Phụ cấp', money(pay.allowance) + ' đ'),
    line('THỰC LĨNH', money(pay.net) + ' đ', true),
  ] : [
    line('Số công', String(pay.workUnits)),
    line('Nghỉ phép có lương', pay.paidLeaveDays + ' ngày'),
    line('Lương cơ bản', money(pay.basicSalary) + ' đ'),
    line('Đơn giá 1 ngày công', money(pay.dailyRate) + ' đ'),
    line('Lương theo công', money(pay.workSalary) + ' đ'),
    line('Lương nghỉ phép', money(pay.paidLeaveSalary) + ' đ'),
    line(`Tăng ca (${pay.otHoursTotal} giờ)`, money(pay.otSalary) + ' đ'),
    ...(pay.nightPay ? [line(`Phụ cấp làm đêm (${Math.round(((pay.nightHours || 0) + (pay.nightOtHours || 0)) * 100) / 100} giờ)`, money(pay.nightPay) + ' đ')] : []),
    line('Phụ cấp', money(pay.allowance) + ' đ'),
    line('THỰC LĨNH', money(pay.net) + ' đ', true),
  ];
  const sheet = el('div', { id: 'payslip-print' },
    el('div', { style: 'text-align:center;margin-bottom:10px' },
      el('div', { style: 'font-weight:800;font-size:16px' }, ctx.company || 'Digiplus'),
      el('div', { style: 'font-size:18px;font-weight:800;margin-top:6px' }, 'PHIẾU LƯƠNG'),
      el('div', { style: 'color:var(--muted);font-size:13px' }, ctx.custom ? `Kỳ ${dmyFull(ctx.from)} → ${dmyFull(ctx.to)}` : `Tháng ${ctx.month} · Kỳ ${ctx.from} → ${ctx.to}`)),
    el('div', { style: 'margin:10px 0;font-size:14px' },
      el('div', {}, el('b', {}, 'Nhân viên: '), `${emp.full_name} (${emp.code})`),
      el('div', {}, el('b', {}, 'Bộ phận: '), emp.department || '—')),
    el('div', {}, ...rows));
  const printBtn = el('button', { class: 'btn' }, '🖨 In phiếu');
  printBtn.onclick = () => printNode(sheet, `Phiếu lương ${emp.code} ${ctx.custom ? `${ctx.from} - ${ctx.to}` : ctx.month}`);
  openModal('Phiếu lương · ' + emp.full_name, [sheet], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng'), printBtn]);
}

// In 1 node ra cửa sổ in (mở popup, chép HTML, gọi print)
function printNode(node, title) {
  const w = window.open('', '_blank', 'width=520,height=700');
  if (!w) return toast('Trình duyệt chặn cửa sổ in', 'err');
  w.document.write(`<html><head><title>${title}</title><meta charset="utf-8"><style>body{font-family:system-ui,Arial,sans-serif;padding:24px;color:#222}</style></head><body>${node.outerHTML}</body></html>`);
  w.document.close(); w.focus(); setTimeout(() => { w.print(); }, 300);
}
function salaryModal(s) {
  const body = hourlyMode() ? [
    el('div', { style: 'font-weight:700' }, `${s.full_name} (${s.code})`),
    field('Đơn giá 1 giờ làm (VNĐ)', input('sl-hourly', { type: 'number', value: s.hourly_rate || 0, min: 0 })),
    field('Phụ cấp cố định / tháng (VNĐ)', input('sl-allow', { type: 'number', value: s.allowance || 0, min: 0 })),
    el('div', { class: 'map-hint' }, 'Lương kỳ = Tổng giờ làm trong kỳ × đơn giá 1 giờ + phụ cấp.'),
  ] : [
    el('div', { style: 'font-weight:700' }, `${s.full_name} (${s.code})`),
    field('Lương cơ bản / tháng (VNĐ)', input('sl-basic', { type: 'number', value: s.basic_salary || 0, min: 0 })),
    field('Đơn giá 1 ngày công (để trống = tự tính: lương CB ÷ ngày công chuẩn)', input('sl-daily', { type: 'number', value: s.daily_rate || '', min: 0 })),
    field('Ngày công chuẩn / tháng', input('sl-wd', { type: 'number', value: s.working_days_per_month || 26, min: 1 })),
    el('div', { class: 'two-col' },
      field('Hệ số OT ngày thường', input('sl-otw', { type: 'number', step: '0.1', value: s.ot_rate_weekday ?? 1.5 })),
      field('Hệ số OT cuối tuần', input('sl-ote', { type: 'number', step: '0.1', value: s.ot_rate_weekend ?? 2.0 }))),
    el('div', { class: 'two-col' },
      field('Hệ số OT ngày lễ', input('sl-oth', { type: 'number', step: '0.1', value: s.ot_rate_holiday ?? 3.0 })),
      field('Phụ cấp cố định / tháng', input('sl-allow', { type: 'number', value: s.allowance || 0, min: 0 }))),
  ];
  const save = el('button', { class: 'btn' }, 'Lưu');
  save.onclick = async () => {
    const b = hourlyMode() ? {
      hourly_rate: +$('#sl-hourly').value || 0, allowance: +$('#sl-allow').value || 0,
    } : {
      basic_salary: +$('#sl-basic').value || 0, daily_rate: $('#sl-daily').value ? +$('#sl-daily').value : null,
      working_days_per_month: +$('#sl-wd').value || 26, ot_rate_weekday: +$('#sl-otw').value || 1.5,
      ot_rate_weekend: +$('#sl-ote').value || 2.0, ot_rate_holiday: +$('#sl-oth').value || 3.0, allowance: +$('#sl-allow').value || 0,
    };
    try { await api('/admin/salary/' + s.employee_id, { method: 'PUT', body: b }); toast('Đã lưu', 'ok'); closeModal(); pageSalary(); }
    catch (e) { toast(e.message, 'err'); }
  };
  openModal('Cấu hình lương', body, [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), save]);
}

