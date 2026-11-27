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
  const X = !!data.extra;   // Bảng lương mở rộng (Cài đặt › Quy tắc tính công): tiền ăn + đơn giá tăng ca theo mốc
  const xTh = X ? '<th>Tiền ăn</th>' : '';
  if (hourlyMode()) {
    tbl.innerHTML = `<thead><tr><th>Mã NV</th><th>Họ tên</th><th>Bộ phận</th><th>Đơn giá 1 giờ</th><th>Phụ cấp</th>${xTh}<th></th></tr></thead>`;
    for (const s of data.rows) {
      tb.append(el('tr', {},
        el('td', {}, s.code),
        el('td', {}, el('b', {}, s.full_name)),
        el('td', {}, s.department || '—'),
        el('td', {}, s.hourly_rate ? money(s.hourly_rate) : el('span', { style: 'color:#c0392b' }, 'chưa đặt')),
        el('td', {}, money(s.allowance)),
        ...(X ? [el('td', {}, foodText(s))] : []),
        el('td', {}, canEdit ? btnSm('Sửa', () => salaryModal(s, X)) : ''),
      ));
    }
  } else {
    tbl.innerHTML = `<thead><tr><th>Mã NV</th><th>Họ tên</th><th>Bộ phận</th><th>Lương cơ bản</th><th>Đơn giá ngày</th><th>Ngày công chuẩn</th><th>Hệ số OT (T/CT/Lễ)</th>${X ? '<th>Đơn giá TC / giờ (mốc 1 / 2 / 3)</th>' : ''}<th>Phụ cấp</th>${xTh}<th></th></tr></thead>`;
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
        ...(X ? [el('td', {}, otPayText(s))] : []),
        el('td', {}, money(s.allowance)),
        ...(X ? [el('td', {}, foodText(s))] : []),
        el('td', {}, canEdit ? btnSm('Sửa', () => salaryModal(s, X)) : ''),
      ));
    }
  }
  tbl.append(tb);
  const hint = el('div', { class: 'map-hint', style: 'margin-bottom:10px' }, hourlyMode()
    ? 'Chế độ tính công theo giờ: Lương = Tổng giờ làm × đơn giá 1 giờ + phụ cấp.'
    : 'Lương = Số công × đơn giá ngày + OT (giờ × đơn giá giờ × hệ số) + nghỉ phép có lương + phụ cấp. Đơn giá giờ = đơn giá ngày ÷ số giờ chuẩn 1 ngày công (mặc định 8, đổi ở Cài đặt › Quy tắc tính công).');
  const howTo = canEdit ? el('div', { style: 'margin-bottom:8px;padding:9px 12px;border-radius:8px;background:#fff7ed;border:1px solid #fed7aa;font-size:13.5px' },
    '👉 Cài lương cho 1 người: bấm ', el('b', {}, 'Sửa'), ' ở cuối dòng nhân viên đó. Cài cho cả bộ phận (hoặc tất cả) một lần: bấm ', el('b', {}, '✎ Sửa hàng loạt'), ' ở góc trên.') : null;
  const bulkBtn = canEdit ? el('button', { class: 'btn sm', onclick: () => salaryBulkModal(X) }, '✎ Sửa hàng loạt') : null;
  const xHint = X ? el('div', { class: 'map-hint', style: 'margin-bottom:10px' }, hourlyMode()
    ? 'Đang bật Bảng lương mở rộng: tiền ăn cộng vào lương; Trừ khác nhập ở thẻ Bảng lương.'
    : 'Đang bật Bảng lương mở rộng: mốc tăng ca nào có đơn giá VNĐ / giờ riêng thì Lương OT = số giờ mốc đó × đơn giá; mốc để trống (—) vẫn tính theo hệ số × đơn giá giờ. Mốc giờ do ca chia (tab Tăng ca của ca). Trừ khác nhập ở thẻ Bảng lương.') : null;
  setMain(head('Lương', bulkBtn), tabs, howTo, hint, xHint, payScroll(tbl));
}

// Bảng Cấu hình lương / Bảng lương nhiều cột (Bảng lương mở rộng thêm Tiền ăn, Đơn giá TC, Trừ khác…): khung tự cuộn như báo cáo —
// thanh kéo ngang luôn thấy ở đáy màn hình, dòng tiêu đề + 2 cột Mã NV / Họ tên đứng yên, chữ không xuống dòng. Trước: danh sách dài,
// thanh kéo ngang nằm tận cuối bảng → cột cuối + nút Phiếu lương bị che, tên bẻ 3 dòng (mythuatlt 27/11/2026).
function payScroll(tbl) {
  const box = el('div', { class: 'rep-scroll pay-scroll' }, tbl);
  setTimeout(() => {
    if (!box.isConnected) return;
    box.style.maxHeight = Math.max(300, innerHeight - box.getBoundingClientRect().top - 16) + 'px';
    if (innerWidth <= 820 || tbl.querySelector('td[colspan]')) return;   // điện thoại: chỉ kéo ngang (2 cột ghim chiếm gần hết màn)
    let left = 0;
    [...tbl.querySelectorAll('thead th')].slice(0, 2).forEach((th, i) => {
      th.classList.add('pin'); th.style.left = left + 'px';
      tbl.querySelectorAll(`tbody tr > td:nth-child(${i + 1})`).forEach((td) => { td.classList.add('pin'); td.style.left = left + 'px'; });
      left += th.getBoundingClientRect().width;
    });
  });
  return el('div', { class: 'panel', style: 'overflow:hidden' }, box);
}

// BẢNG LƯƠNG MỞ RỘNG — chữ hiển thị
const FOOD_MODE_LABEL = { day: 'mỗi ngày đi làm', unit: 'mỗi công', month: 'cố định / kỳ lương' };
const foodText = (s) => (+s.food_allowance > 0 ? `${money(s.food_allowance)} · ${FOOD_MODE_LABEL[s.food_mode] || FOOD_MODE_LABEL.day}` : '—');
const otPayText = (s) => {
  const v = (n) => (+n > 0 ? money(n) : '—');
  const main = `${v(s.ot_pay1)} / ${v(s.ot_pay2)} / ${v(s.ot_pay3)}`;
  const more = [+s.ot_pay_weekend > 0 ? 'nghỉ ' + money(s.ot_pay_weekend) : '', +s.ot_pay_holiday > 0 ? 'lễ ' + money(s.ot_pay_holiday) : ''].filter(Boolean).join(' · ');
  return more ? el('span', {}, main, el('div', { style: 'color:var(--muted);font-size:12px' }, more)) : main;
};
const foodModeSel = (id, v) => el('select', { id }, ...Object.entries(FOOD_MODE_LABEL).map(([k, t]) => el('option', { value: k, ...((v || 'day') === k ? { selected: '' } : {}) }, t)));

// SỬA LƯƠNG HÀNG LOẠT: chọn bộ phận (kèm bộ phận con) hoặc tất cả, tích ô nào thì ghi đè ô đó, ô không tích giữ nguyên
async function salaryBulkModal(X) {
  const deptSel = el('select', { id: 'sb-dept' }, el('option', { value: '' }, '-- Tất cả nhân viên --'));
  try { const { rows } = await api('/reports/departments'); for (const d of rows) deptSel.append(el('option', { value: d }, d)); } catch {}
  const row = (key, label, inp) => {
    const chk = el('input', { type: 'checkbox', 'data-k': key });
    inp.disabled = true; chk.onchange = () => { inp.disabled = !chk.checked; if (chk.checked) inp.focus(); };
    return el('label', { style: 'display:grid;grid-template-columns:22px 1fr 160px;gap:8px;align-items:center;padding:5px 0' }, chk, el('span', {}, label), inp);
  };
  const num = (id, v, extra = {}) => el('input', { id, type: 'number', min: 0, value: v, ...extra });
  const xRows = !X ? [] : [
    row('food_allowance', 'Tiền ăn (VNĐ)', num('sb-food_allowance', 0, { step: 1000 })),
    row('food_mode', 'Tiền ăn tính theo', foodModeSel('sb-food_mode', 'day')),
    ...(hourlyMode() ? [] : [
      row('ot_pay1', 'Đơn giá TC mốc 1 (VNĐ / giờ, 0 = theo hệ số)', num('sb-ot_pay1', 0, { step: 1000 })),
      row('ot_pay2', 'Đơn giá TC mốc 2 (VNĐ / giờ)', num('sb-ot_pay2', 0, { step: 1000 })),
      row('ot_pay3', 'Đơn giá TC mốc 3 (VNĐ / giờ)', num('sb-ot_pay3', 0, { step: 1000 })),
      row('ot_pay_weekend', 'Đơn giá TC ngày nghỉ (VNĐ / giờ)', num('sb-ot_pay_weekend', 0, { step: 1000 })),
      row('ot_pay_holiday', 'Đơn giá TC ngày lễ (VNĐ / giờ)', num('sb-ot_pay_holiday', 0, { step: 1000 })),
    ]),
  ];
  const rows = hourlyMode() ? [
    row('hourly_rate', 'Đơn giá 1 giờ (VNĐ)', num('sb-hourly_rate', 0)),
    row('allowance', 'Phụ cấp cố định / tháng (VNĐ)', num('sb-allowance', 0)),
    ...xRows,
  ] : [
    row('basic_salary', 'Lương cơ bản / tháng (VNĐ)', num('sb-basic_salary', 0)),
    row('daily_rate', 'Đơn giá 1 ngày công (để trống = tự tính)', num('sb-daily_rate', '')),
    row('working_days_per_month', 'Ngày công chuẩn / tháng', num('sb-working_days_per_month', 26, { min: 1, max: 31 })),
    row('ot_rate_weekday', 'Hệ số OT ngày thường', num('sb-ot_rate_weekday', 1.5, { step: '0.1' })),
    row('ot_rate_weekend', 'Hệ số OT cuối tuần', num('sb-ot_rate_weekend', 2, { step: '0.1' })),
    row('ot_rate_holiday', 'Hệ số OT ngày lễ', num('sb-ot_rate_holiday', 3, { step: '0.1' })),
    row('allowance', 'Phụ cấp cố định / tháng (VNĐ)', num('sb-allowance', 0)),
    ...xRows,
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
      fields[k] = k === 'daily_rate' ? (v ? +v : null) : k === 'food_mode' ? v : +v;
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
    const X = !!data.extra;   // Bảng lương mở rộng: thêm cột Tiền ăn + Trừ khác (nhập tay theo kỳ)
    const canEdit = hasPerm('salary');
    const xTh = X ? '<th>Tiền ăn</th><th>Trừ khác</th>' : '';
    const tbl = el('table', { class: 'data' });
    tbl.innerHTML = hourly
      ? '<thead><tr><th>Mã NV</th><th>Họ tên</th><th>Bộ phận</th><th>Tổng giờ</th><th>Đơn giá giờ</th><th>Lương giờ</th>' + (night ? '<th>Giờ đêm</th><th>Phụ cấp đêm</th>' : '') + '<th>Phụ cấp</th>' + xTh + '<th>Thực lĩnh</th><th></th></tr></thead>'
      : '<thead><tr><th>Mã NV</th><th>Họ tên</th><th>Bộ phận</th><th>Công</th><th>Phép</th><th>OT(g)</th><th>Đơn giá ngày</th><th>Lương công</th><th>Lương OT</th>' + (night ? '<th>Giờ đêm</th><th>Phụ cấp đêm</th>' : '') + '<th>Phụ cấp</th>' + xTh + '<th>Thực lĩnh</th><th></th></tr></thead>';
    const tb = el('tbody');
    if (!data.rows.length) tb.append(el('tr', {}, el('td', { colspan: (hourly ? 9 : 12) + (night ? 2 : 0) + (X ? 2 : 0) }, el('div', { class: 'empty' }, 'Chưa có nhân viên.'))));
    const totSpan = el('b', {});
    const sumNet = () => { totSpan.textContent = money(data.rows.reduce((s, r) => s + (r.pay.net || 0), 0)) + ' đ'; };
    const deductInputs = [];
    for (const { emp, pay } of data.rows) {
      const psBtn = btnSm('🧾 Phiếu lương', () => payslipModal(emp, pay, data));
      const netSpan = el('span', {}, money(pay.net));
      const cells = hourly
        ? [emp.code, emp.full_name, emp.department || '', pay.totalHours, money(pay.hourlyRate), money(pay.workSalary), money(pay.allowance), netSpan]
        : [emp.code, emp.full_name, emp.department || '', pay.workUnits, pay.paidLeaveDays, pay.otHoursTotal, money(pay.dailyRate), money(pay.workSalary), money(pay.otSalary), money(pay.allowance), netSpan];
      if (night) cells.splice(cells.length - 2, 0, Math.round(((pay.nightHours || 0) + (pay.nightOtHours || 0)) * 100) / 100, money(pay.nightPay));
      if (X) cells.splice(cells.length - 1, 0, money(pay.foodAllowance), deductCell(emp, pay, data, canEdit, deductInputs, () => { netSpan.textContent = money(pay.net); sumNet(); }));
      const tr = el('tr', {});
      cells.forEach((c, i) => tr.append(el('td', {}, i === 1 ? el('b', {}, c) : c instanceof Node ? c : String(c))));
      tr.append(el('td', {}, psBtn));
      tb.append(tr);
    }
    tbl.append(tb);
    sumNet();
    wrap.innerHTML = '';
    wrap.append(
      el('div', { style: 'font-weight:800;font-size:16px;color:var(--ink);margin-bottom:4px' }, data.custom ? `Bảng lương từ ${dmyFull(data.from)} đến ${dmyFull(data.to)}` : `Bảng lương tháng ${data.month}`),
      el('div', { class: 'map-hint', style: 'margin-bottom:10px' }, `Kỳ lương: ${data.from} → ${data.to} · Tổng thực lĩnh: `, totSpan, data.custom ? ' · Phụ cấp cố định tính đủ 1 lần cho kỳ đang chọn' : '',
        X ? ' · Trừ khác: gõ số tiền rồi Enter (lưu cho đúng kỳ đang xem), ✎ để ghi lý do' : ''),
      payScroll(tbl));
  };
  monthI.onchange = () => { custom = false; load(); };
  deptSel.onchange = load;
  load();
}

// Ô TRỪ KHÁC trên bảng lương (Bảng lương mở rộng): gõ số → Enter / rời ô = lưu cho đúng kỳ from → to đang xem; ✎ = ghi lý do
function deductCell(emp, pay, data, canEdit, list, onSaved) {
  if (!canEdit) return el('span', { title: pay.deductNote || '' }, money(pay.deductOther) + (pay.deductNote ? ' 📝' : ''));
  const inp = el('input', { type: 'number', min: 0, step: 1000, value: pay.deductOther || '', placeholder: '0', title: pay.deductNote || 'Số tiền trừ khác của kỳ này', style: 'width:110px;margin:0;padding:4px 6px' });
  const noteBtn = el('button', { type: 'button', class: 'btn sm ghost', style: 'margin-left:4px;padding:2px 7px', title: pay.deductNote || 'Ghi lý do trừ' }, pay.deductNote ? '📝' : '✎');
  list.push(inp);
  const save = async (amount, note) => {
    try {
      const r = await api('/admin/payroll/deduct', { method: 'PUT', body: { employee_id: emp.id, from: data.from, to: data.to, amount: amount === '' ? 0 : amount, note } });
      pay.deductOther = r.deduct_other; pay.deductNote = r.note; pay.net = (pay.gross || 0) - r.deduct_other;
      inp.value = r.deduct_other || ''; inp.title = r.note || 'Số tiền trừ khác của kỳ này';
      noteBtn.textContent = r.note ? '📝' : '✎'; noteBtn.title = r.note || 'Ghi lý do trừ';
      onSaved(); toast(`Đã lưu trừ khác ${emp.full_name}`, 'ok');
    } catch (e) { toast(e.message, 'err'); inp.value = pay.deductOther || ''; }
  };
  inp.onchange = () => { if ((+inp.value || 0) !== (pay.deductOther || 0)) save(inp.value, pay.deductNote || ''); };
  inp.onkeydown = (e) => {   // Enter = lưu + sang ô người kế tiếp
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const nx = list[list.indexOf(inp) + 1];
    if (nx) nx.focus(); else inp.blur();
  };
  noteBtn.onclick = () => {
    const amt = input('dd-amt', { type: 'number', min: 0, step: 1000, value: pay.deductOther || '' });
    const note = input('dd-note', { value: pay.deductNote || '', maxlength: 200, placeholder: 'VD trừ tạm ứng, đồng phục, làm hỏng hàng…' });
    const ok = el('button', { class: 'btn' }, 'Lưu');
    ok.onclick = async () => { await save(amt.value, note.value); closeModal(); };
    openModal(`Trừ khác · ${emp.full_name}`, [
      el('div', { class: 'map-hint' }, `Kỳ ${dmyFull(data.from)} → ${dmyFull(data.to)}. Để 0 và xoá lý do = bỏ khoản trừ.`),
      field('Số tiền trừ (VNĐ)', amt), field('Lý do', note)], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), ok]);
  };
  return el('span', { style: 'display:inline-flex;align-items:center;white-space:nowrap' }, inp, noteBtn);
}

// Phiếu lương 1 nhân viên (in được)
function payslipModal(emp, pay, ctx) {
  const hourly = ctx.mode === 'hourly';
  const line = (label, val, bold) => el('div', { style: 'display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #eee' + (bold ? ';font-weight:800;font-size:15px;border-bottom:2px solid #ddd' : '') },
    el('span', {}, label), el('span', { style: 'font-variant-numeric:tabular-nums' }, val));
  const sub = (label, val) => el('div', { style: 'display:flex;justify-content:space-between;padding:3px 0 3px 16px;font-size:13px;color:#555;border-bottom:1px dashed #f2f2f2' },
    el('span', {}, '· ' + label), el('span', { style: 'font-variant-numeric:tabular-nums' }, val));
  // Bảng lương mở rộng: tiền ăn, tổng thu nhập, trừ khác (công tắc tắt → không có dòng nào)
  const extraLines = () => !pay.extra ? [] : [
    line(pay.foodMode === 'month' ? 'Tiền ăn' : `Tiền ăn (${pay.foodMode === 'unit' ? pay.workUnits + ' công' : pay.foodDays + ' ngày'} × ${money(pay.foodRate)})`, money(pay.foodAllowance) + ' đ'),
    line('Tổng thu nhập', money(pay.gross) + ' đ'),
    line('Trừ khác' + (pay.deductNote ? ` (${pay.deductNote})` : ''), (pay.deductOther ? '− ' : '') + money(pay.deductOther) + ' đ'),
  ];
  const rows = hourly ? [
    line('Tổng giờ làm', pay.totalHours + ' giờ'),
    line('Số ngày có công', String(pay.daysWorked)),
    line('Đơn giá 1 giờ', money(pay.hourlyRate) + ' đ'),
    line('Lương theo giờ', money(pay.workSalary) + ' đ'),
    ...(pay.nightPay ? [line(`Phụ cấp làm đêm (${pay.nightHours} giờ)`, money(pay.nightPay) + ' đ')] : []),
    line('Phụ cấp', money(pay.allowance) + ' đ'),
    ...extraLines(),
    line('THỰC LĨNH', money(pay.net) + ' đ', true),
  ] : [
    line('Số công', String(pay.workUnits)),
    line('Nghỉ phép có lương', pay.paidLeaveDays + ' ngày'),
    line('Lương cơ bản', money(pay.basicSalary) + ' đ'),
    line('Đơn giá 1 ngày công', money(pay.dailyRate) + ' đ'),
    line('Lương theo công', money(pay.workSalary) + ' đ'),
    line('Lương nghỉ phép', money(pay.paidLeaveSalary) + ' đ'),
    line(`Tăng ca (${pay.otHoursTotal} giờ)`, money(pay.otSalary) + ' đ'),
    ...(pay.otLines || []).map((l) => sub(`${l.label}: ${l.hours} giờ × ${money(l.rate)}${l.own ? '' : ' (theo hệ số)'}`, money(l.amount) + ' đ')),
    ...(pay.nightPay ? [line(`Phụ cấp làm đêm (${Math.round(((pay.nightHours || 0) + (pay.nightOtHours || 0)) * 100) / 100} giờ)`, money(pay.nightPay) + ' đ')] : []),
    line('Phụ cấp', money(pay.allowance) + ' đ'),
    ...extraLines(),
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
function salaryModal(s, X) {
  // Bảng lương mở rộng: tiền ăn + đơn giá tăng ca theo mốc (VNĐ / giờ, 0 = theo hệ số)
  const mon = (id, v) => input(id, { type: 'number', min: 0, step: 1000, value: +v > 0 ? v : '', placeholder: '0' });
  const xFood = !X ? [] : [
    el('div', { class: 'two-col' },
      field('Tiền ăn (VNĐ)', mon('sl-food', s.food_allowance)),
      field('Tiền ăn tính theo', foodModeSel('sl-foodmode', s.food_mode))),
  ];
  const xOt = !X || hourlyMode() ? [] : [
    el('div', { style: 'font-weight:700;margin-top:6px' }, 'Đơn giá tăng ca riêng (VNĐ / giờ)'),
    el('div', { class: 'map-hint' }, 'Để trống = tính theo hệ số × đơn giá giờ như cũ. Mốc giờ do ca chia (tab Tăng ca của ca), VD tăng ca từ 18:00, TC1 180 phút, TC2 180 phút → mốc 1 = 18h–21h, mốc 2 = 21h–0h, mốc 3 = từ 0h.'),
    el('div', { class: 'two-col' }, field('Mốc 1 (TC1)', mon('sl-otp1', s.ot_pay1)), field('Mốc 2 (TC2)', mon('sl-otp2', s.ot_pay2))),
    el('div', { class: 'two-col' }, field('Mốc 3 (TC3 trở đi)', mon('sl-otp3', s.ot_pay3)), field('Ngày nghỉ', mon('sl-otpwe', s.ot_pay_weekend))),
    el('div', { class: 'two-col' }, field('Ngày lễ', mon('sl-otpho', s.ot_pay_holiday)), el('div')),
  ];
  const body = hourlyMode() ? [
    el('div', { style: 'font-weight:700' }, `${s.full_name} (${s.code})`),
    field('Đơn giá 1 giờ làm (VNĐ)', input('sl-hourly', { type: 'number', value: s.hourly_rate || 0, min: 0 })),
    field('Phụ cấp cố định / tháng (VNĐ)', input('sl-allow', { type: 'number', value: s.allowance || 0, min: 0 })),
    el('div', { class: 'map-hint' }, 'Lương kỳ = Tổng giờ làm trong kỳ × đơn giá 1 giờ + phụ cấp.'),
    ...xFood,
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
    ...xFood, ...xOt,
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
    if (X) {
      Object.assign(b, { food_allowance: +$('#sl-food').value || 0, food_mode: $('#sl-foodmode').value });
      if (!hourlyMode()) Object.assign(b, { ot_pay1: +$('#sl-otp1').value || 0, ot_pay2: +$('#sl-otp2').value || 0, ot_pay3: +$('#sl-otp3').value || 0, ot_pay_weekend: +$('#sl-otpwe').value || 0, ot_pay_holiday: +$('#sl-otpho').value || 0 });
    }
    try { await api('/admin/salary/' + s.employee_id, { method: 'PUT', body: b }); toast('Đã lưu', 'ok'); closeModal(); pageSalary(); }
    catch (e) { toast(e.message, 'err'); }
  };
  openModal('Cấu hình lương', body, [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), save]);
}

