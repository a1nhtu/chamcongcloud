// TIỀN LƯƠNG NÂNG CAO (giao diện) — kiểu AMIS Tiền lương: Bảng lương (chốt / duyệt / khoá / phiếu / chuyển khoản) · Hồ sơ lương
// · Thành phần lương (công thức) · Dữ liệu theo kỳ · Tạm ứng · Mẫu bảng lương · Báo cáo · Phản hồi · Thông số.
// Nạp khi mở menu "Lương" và tài khoản tổng đã bật Tiền lương nâng cao (admin.js gọi import('/payroll.js')).
import { api, toast, el, todayMonth } from '/common.js';

let C = null;        // { head, setMain, openModal, closeModal, loading, hasPerm, go }
let META = null;     // /admin/pay/meta
let DEPTS = [];
let _tab = 'sheets';
let _period = todayMonth();
let _openSheet = null;

/* ---------- tiện ích ---------- */
const money = (n) => (n == null || n === '' ? '' : Math.round(+n || 0).toLocaleString('vi-VN'));
const num = (n) => (n == null || n === '' ? '' : (+n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 }));
const parseMoney = (s) => { const v = String(s ?? '').replace(/[^\d-]/g, ''); return v === '' || v === '-' ? '' : +v; };
const dmy = (s) => (/^\d{4}-\d{2}-\d{2}/.test(s || '') ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');
const pdisp = (p) => `${p.slice(5)}/${p.slice(0, 4)}`;
const pill = (txt, cls) => el('span', { class: 'pill ' + (cls || 'muted'), style: 'white-space:nowrap' }, txt);
const hint = (txt) => el('div', { class: 'map-hint', style: 'margin:6px 0 10px' }, txt);
const small = (txt) => el('div', { style: 'font-size:12px;color:var(--muted)' }, txt);
const btn = (t, fn, cls = '') => { const b = el('button', { class: 'btn sm ' + cls }, t); b.onclick = fn; return b; };
function fld(label, node, extra) { return el('div', {}, el('label', {}, label), node, extra || null); }
function inp(value = '', attrs = {}) { return el('input', { value: value ?? '', ...attrs }); }
function moneyInp(value, attrs = {}) {
  const i = el('input', { value: value === '' || value == null ? '' : money(value), inputmode: 'numeric', ...attrs });
  i.addEventListener('blur', () => { const v = parseMoney(i.value); i.value = v === '' ? '' : money(v); });
  return i;
}
function sel(options, value = '', attrs = {}) {
  const s = el('select', attrs);
  for (const o of options) {
    const [v, t] = Array.isArray(o) ? o : [o, o];
    const op = el('option', { value: v }, t);
    if (String(v) === String(value ?? '')) op.selected = true;
    s.append(op);
  }
  return s;
}
const chk = (on, attrs = {}) => el('input', { type: 'checkbox', style: 'width:auto', ...attrs, ...(on ? { checked: '' } : {}) });
const chkRow = (c, label, desc) => el('label', { style: 'display:flex;gap:8px;align-items:flex-start;cursor:pointer;margin:6px 0' }, c, el('div', {}, el('b', {}, label), desc ? small(desc) : null));
async function download(path, name) {
  try {
    const res = await api(path, { raw: true });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Không tải được');
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename\*=UTF-8''([^;]+)/);
    if (m) { try { name = decodeURIComponent(m[1]); } catch {} }
    const url = URL.createObjectURL(await res.blob());
    const a = el('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) { toast(e.message, 'err'); }
}
function pickFile(onB64, accept = '.xlsx') {
  const f = el('input', { type: 'file', accept, style: 'display:none' });
  f.onchange = () => {
    const file = f.files[0]; if (!file) return;
    const rd = new FileReader();
    rd.onload = () => onB64(rd.result, file.name);
    rd.readAsDataURL(file);
  };
  document.body.append(f); f.click(); setTimeout(() => f.remove(), 60000);
}
function wide(px = 900) { const m = document.getElementById('modal'); if (m) m.style.maxWidth = px + 'px'; }
function deptPicker(selected = []) {
  const box = el('div', { style: 'max-height:180px;overflow:auto;border:1px solid var(--line,#e5e7eb);border-radius:8px;padding:6px 10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:2px 12px' });
  const cbs = DEPTS.map((d) => { const c = chk(selected.includes(d), { value: d }); box.append(el('label', { style: 'display:flex;gap:6px;align-items:center;font-size:13px;cursor:pointer' }, c, d)); return c; });
  if (!DEPTS.length) box.append(small('Chưa có bộ phận'));
  return { box, value: () => cbs.filter((c) => c.checked).map((c) => c.value) };
}
const STATUS = { draft: ['Nháp', 'muted'], pending: ['Chờ duyệt', 'warn'], locked: ['Đã chốt', 'ok'] };
const TAX_LABEL = { progressive: 'Lũy tiến', flat10: '10% (thời vụ / CTV)', none: 'Không tính' };

/* ---------- khung trang ---------- */
const TABS = [
  ['sheets', '📄 Bảng lương'], ['profiles', '👤 Hồ sơ lương'], ['comps', '🧩 Thành phần lương'], ['items', '📝 Dữ liệu theo kỳ'],
  ['adv', '💵 Tạm ứng'], ['tpl', '🗂️ Mẫu bảng lương'], ['reports', '📊 Báo cáo'], ['feedback', '💬 Phản hồi'], ['params', '⚙️ Thông số'],
];
export async function pagePayPro(ctx) {
  C = ctx;
  C.setMain(C.loading());
  try {
    META = await api('/admin/pay/meta');
    if (!DEPTS.length) { try { DEPTS = (await api('/reports/departments')).rows || []; } catch {} }
  } catch (e) { C.setMain(el('div', { class: 'empty' }, e.message)); return; }
  render();
}
function tabBar() {
  const f = META.flags;
  const show = TABS.filter(([k]) => !(k === 'adv' && !f.adv) && !(k === 'items' && !f.items) && !(k === 'feedback' && !f.app_slip));
  if (!show.some(([k]) => k === _tab)) _tab = 'sheets';
  return el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px' },
    ...show.map(([k, t]) => btn(t, () => { _tab = k; _openSheet = null; render(); }, _tab === k ? '' : 'ghost')));
}
function render() {
  ({ sheets: viewSheets, profiles: viewProfiles, comps: viewComps, items: viewItems, adv: viewAdv, tpl: viewTpl, reports: viewReports, feedback: viewFeedback, params: viewParams }[_tab] || viewSheets)();
}
function page(title, tools, ...body) { C.setMain(C.head(title, ...(tools || [])), tabBar(), ...body); }
function monthInput(onChange) {
  const m = el('input', { type: 'month', value: _period });
  m.onchange = () => { if (m.value) { _period = m.value; onChange(); } };
  return m;
}

/* =============================== BẢNG LƯƠNG =============================== */
async function viewSheets() {
  if (_openSheet) return viewSheet(_openSheet);
  const mi = monthInput(viewSheets);
  const add = btn('＋ Tạo bảng lương', () => createSheetModal());
  page('Tiền lương', [mi, add], C.loading());
  let d;
  try { d = await api('/admin/pay/sheets?period=' + _period); } catch (e) { page('Tiền lương', [mi, add], el('div', { class: 'empty' }, e.message)); return; }
  const tbl = el('table', { class: 'data' });
  tbl.innerHTML = '<thead><tr><th>Tên bảng lương</th><th>Kỳ</th><th>Số NV</th><th>Tổng thu nhập</th><th>Thực lĩnh</th><th>Trạng thái</th><th></th></tr></thead>';
  const tb = el('tbody');
  if (!d.rows.length) tb.append(el('tr', {}, el('td', { colspan: 7 }, el('div', { class: 'empty' }, `Chưa có bảng lương tháng ${pdisp(_period)}. Bấm "＋ Tạo bảng lương".`))));
  for (const s of d.rows) {
    const st = STATUS[s.status] || [s.status];
    tb.append(el('tr', { style: 'cursor:pointer', onclick: () => { _openSheet = s.id; viewSheet(s.id); } },
      el('td', {}, el('b', {}, s.name), s.reject_note ? small('↩ Bị trả lại: ' + s.reject_note) : null),
      el('td', {}, `${dmy(s.from_date)} – ${dmy(s.to_date)}`),
      el('td', {}, String(s.totals.count ?? '')),
      el('td', {}, money(s.totals.income)),
      el('td', {}, el('b', {}, money(s.totals.net))),
      el('td', {}, pill(st[0], st[1]), s.published ? pill('📱 Đã gửi phiếu', 'ok') : null),
      el('td', {}, btn('Mở', () => {}, 'ghost'))));
  }
  tbl.append(tb);
  page('Tiền lương', [mi, add],
    hint('Bảng lương = công trong kỳ (như bảng lương cũ) + phụ cấp / thưởng / khấu trừ + bảo hiểm + thuế TNCN − tạm ứng → THỰC LĨNH. Nháp thì tính lại thoải mái; CHỐT rồi số liệu giữ nguyên, sửa công / dữ liệu kỳ không làm đổi bảng đã chốt.'),
    el('div', { class: 'panel tbl-scroll' }, tbl));
}
async function createSheetModal() {
  let tpls = [];
  try { tpls = (await api('/admin/pay/templates')).rows.filter((t) => t.active); } catch {}
  const name = inp('', { placeholder: `Bảng lương tháng ${pdisp(_period)}` });
  const tsel = sel([['', '— Không dùng mẫu (tất cả thành phần, cột mặc định) —'], ...tpls.map((t) => [t.id, t.name])]);
  const dp = deptPicker([]);
  const save = el('button', { class: 'btn' }, 'Tạo & tính lương');
  save.onclick = async () => {
    save.disabled = true; save.textContent = 'Đang tính…';
    try {
      const r = await api('/admin/pay/sheets', { method: 'POST', body: { period: _period, name: name.value, template_id: tsel.value || null, depts: dp.value() } });
      try { await api(`/admin/pay/sheets/${r.id}/compute`, { method: 'POST' }); } catch (e) { toast('Đã tạo bảng nhưng tính lỗi: ' + e.message, 'err'); }
      C.closeModal(); _openSheet = r.id; viewSheet(r.id);
    } catch (e) { toast(e.message, 'err'); save.disabled = false; save.textContent = 'Tạo & tính lương'; }
  };
  C.openModal('Tạo bảng lương tháng ' + pdisp(_period), [
    fld('Tên bảng lương', name),
    fld('Mẫu bảng lương', tsel, small('Mẫu quy định bộ phận áp dụng, thành phần được tính và các cột hiển thị (thẻ 🗂️ Mẫu bảng lương).')),
    fld('Bộ phận (bỏ trống = theo mẫu / tất cả nhân viên)', dp.box),
  ], [btn('Huỷ', C.closeModal, 'ghost'), save]);
}

async function viewSheet(id) {
  page('Tiền lương', [], C.loading());
  let d;
  try { d = await api('/admin/pay/sheets/' + id); } catch (e) { _openSheet = null; toast(e.message, 'err'); return viewSheets(); }
  const s = d.sheet, f = d.flags, st = STATUS[s.status] || [s.status];
  const back = btn('← Danh sách', () => { _openSheet = null; viewSheets(); }, 'ghost');
  const act = async (path, body, okMsg, confirmMsg) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    try { await api(`/admin/pay/sheets/${id}/${path}`, { method: 'POST', body }); if (okMsg) toast(okMsg, 'ok'); viewSheet(id); } catch (e) { toast(e.message, 'err'); }
  };
  const tools = [back];
  if (s.status === 'draft') {
    const rc = btn('🔄 Tính lại', async () => { rc.disabled = true; rc.textContent = 'Đang tính…'; await act('compute', undefined, 'Đã tính lại'); });
    tools.push(rc);
    if (f.approve) tools.push(btn('📨 Gửi duyệt', () => act('send', undefined, 'Đã gửi duyệt', 'Gửi bảng lương này cho người duyệt? Trong lúc chờ duyệt không tính lại được.')));
    else tools.push(btn('🔒 Chốt bảng lương', () => act('lock', undefined, 'Đã chốt', 'CHỐT bảng lương? Sau khi chốt số liệu được giữ nguyên (muốn sửa phải mở khoá).')));
  }
  if (s.status === 'pending' && d.can_approve) {
    tools.push(btn('✅ Duyệt & chốt', () => act('lock', undefined, 'Đã duyệt', 'Duyệt và chốt bảng lương này?')));
    tools.push(btn('↩ Trả lại', () => { const n = prompt('Lý do trả lại (người lập sẽ thấy):'); if (n != null) act('reject', { note: n }, 'Đã trả lại'); }, 'ghost'));
  }
  if (s.status === 'locked') {
    if (f.app_slip) tools.push(s.published ? btn('📱 Thu hồi phiếu trên app', () => act('publish', { on: false }, 'Đã thu hồi'), 'ghost')
      : btn('📱 Gửi phiếu lương lên app', () => act('publish', { on: true }, 'Đã gửi phiếu lương cho nhân viên', 'Nhân viên sẽ xem được phiếu lương của mình trên app (có thông báo). Gửi?')));
    tools.push(btn('🏦 File chuyển khoản', () => download(`/admin/pay/sheets/${id}/bank.xlsx`, 'chuyen_khoan.xlsx'), 'ghost'));
    tools.push(btn('💸 Đã trả hết', () => act('paid', { paid: true }, 'Đã đánh dấu đã trả'), 'ghost'));
    if (!f.approve || d.can_approve) tools.push(btn('🔓 Mở khoá', () => act('unlock', undefined, 'Đã mở khoá — bảng về Nháp', 'Mở khoá bảng lương đã chốt? Phiếu lương trên app sẽ bị thu hồi cho tới khi chốt lại.'), 'ghost'));
  }
  tools.push(btn('⬇ Excel', () => download(`/admin/pay/sheets/${id}/export.xlsx`, 'bang_luong.xlsx'), 'ghost'));
  if (s.status !== 'locked') tools.push(btn('🗑', async () => {
    if (!confirm('Xoá bảng lương này?')) return;
    try { await api('/admin/pay/sheets/' + id, { method: 'DELETE' }); toast('Đã xoá', 'ok'); _openSheet = null; viewSheets(); } catch (e) { toast(e.message, 'err'); }
  }, 'ghost'));

  const t = s.totals || {};
  const card = (label, v, strong) => el('div', { class: 'panel', style: 'padding:10px 14px;min-width:150px;flex:1' }, small(label), el('div', { style: `font-size:${strong ? 20 : 16}px;font-weight:800;font-variant-numeric:tabular-nums` }, money(v)));
  const cards = el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px' },
    card('Số nhân viên', t.count), card('Tổng thu nhập', t.income),
    f.ins ? card('BH người lao động', (t.ins_emp || 0) + (t.union || 0)) : null, f.tax ? card('Thuế TNCN', t.tax) : null,
    f.adv ? card('Tạm ứng', t.advance) : null, card('Thực lĩnh', t.net, true), f.ins ? card('Chi phí lương công ty', t.cost) : null);

  const q = el('input', { placeholder: '🔎 Tìm mã / tên / bộ phận', style: 'max-width:260px' });
  const cols = s.columns || [];
  const tbl = el('table', { class: 'data' });
  const thead = el('thead', {}, el('tr', {}, ...cols.map((c) => el('th', { style: c.type === 'text' ? '' : 'text-align:right' }, c.label)),
    s.status === 'locked' ? el('th', {}, 'Đã trả') : null, el('th', {}, '')));
  const tb = el('tbody');
  const draw = () => {
    tb.innerHTML = '';
    const k = q.value.trim().toLowerCase();
    for (const r of d.rows) {
      if (k && !`${r.code} ${r.full_name} ${r.department}`.toLowerCase().includes(k)) continue;
      const tr = el('tr', {});
      for (const c of cols) {
        const v = r.cells[c.key];
        tr.append(el('td', { style: 'white-space:nowrap;' + (c.type === 'text' ? '' : 'text-align:right;font-variant-numeric:tabular-nums' + (c.key === 'THUC_LINH' ? ';font-weight:800' : '')) },
          c.key === 'HO_TEN' ? el('b', {}, v || '') : c.type === 'text' ? (v ?? '') : c.type === 'num' ? num(v) : money(v)));
      }
      if (s.status === 'locked') {
        const pc = chk(r.paid);
        pc.onchange = async () => { try { await api(`/admin/pay/sheets/${id}/paid`, { method: 'POST', body: { ids: [r.employee_id], paid: pc.checked } }); r.paid = pc.checked ? 1 : 0; } catch (e) { toast(e.message, 'err'); pc.checked = !pc.checked; } };
        tr.append(el('td', { style: 'text-align:center' }, pc));
      }
      tr.append(el('td', { style: 'white-space:nowrap' }, btn('🧾', () => slipModal(r, s, d.company), 'ghost'), r.feedback ? el('span', { title: r.feedback }, ' 💬') : null, r.seen_at ? el('span', { title: 'NV đã xem ' + r.seen_at }, ' 👁') : null));
      tb.append(tr);
    }
  };
  q.oninput = draw; draw();
  tbl.append(thead, tb);
  const info = [`Kỳ ${dmy(s.from_date)} – ${dmy(s.to_date)}`, s.computed_at ? `tính lúc ${s.computed_at}` : 'chưa tính', s.locked_at ? `chốt bởi ${s.locked_by} lúc ${s.locked_at}` : '', s.sent_at && s.status === 'pending' ? `${s.sent_by} gửi duyệt ${s.sent_at}` : ''].filter(Boolean).join(' · ');
  C.setMain(C.head(s.name, ...tools), tabBar(),
    el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px' }, pill(st[0], st[1]), s.published ? pill('📱 NV đã xem được phiếu', 'ok') : null, small(info)),
    s.reject_note && s.status === 'draft' ? el('div', { class: 'status-banner', style: 'background:#fef3c7;color:#92400e;padding:8px 12px;border-radius:8px;margin-bottom:8px' }, '↩ Bị trả lại: ' + s.reject_note) : null,
    cards, el('div', { style: 'margin-bottom:8px' }, q),
    el('div', { class: 'panel tbl-scroll', style: 'max-height:70vh' }, tbl),
    s.status === 'draft' ? hint('Sửa công / phụ cấp / dữ liệu kỳ / tạm ứng xong → bấm "🔄 Tính lại". Bấm 🧾 để xem / in phiếu lương từng người.') : null);
}

// Phiếu lương chi tiết (in được) — dùng chung cho bảng lương đã lưu
export function slipNode(r, sheet, company) {
  const sl = r.slip || {}, b = r.base || {};
  const line = (label, val, opt = {}) => el('div', { style: `display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px dashed #e5e5e5${opt.bold ? ';font-weight:800;font-size:15px;border-bottom:2px solid #ccc' : ''}${opt.sub ? ';padding-left:14px;color:#555' : ''}` },
    el('span', {}, label), el('span', { style: 'font-variant-numeric:tabular-nums;white-space:nowrap' }, val));
  const sec = (t) => el('div', { style: 'margin:12px 0 4px;font-weight:800;color:#1e3a8a;font-size:13px;text-transform:uppercase' }, t);
  const lines = (sl.lines || []).filter((l) => l.show !== 0);
  const ins = sl.ins || {};
  const out = [
    el('div', { style: 'text-align:center;margin-bottom:8px' },
      el('div', { style: 'font-weight:800' }, company || ''),
      el('div', { style: 'font-size:18px;font-weight:800;margin-top:6px' }, 'PHIẾU LƯƠNG'),
      el('div', { style: 'color:#666;font-size:13px' }, `Tháng ${pdisp(sheet.period)} · Kỳ ${dmy(sheet.from_date || sheet.from)} – ${dmy(sheet.to_date || sheet.to)}`)),
    el('div', { style: 'font-size:14px;margin:8px 0' }, el('div', {}, el('b', {}, 'Nhân viên: '), `${r.full_name} (${r.code})`), el('div', {}, el('b', {}, 'Bộ phận: '), r.department || '—')),
    sec('Ngày công'),
    b.hourly ? line('Tổng giờ làm', num(b.totalHours) + ' giờ') : line('Số công làm việc', num(b.workUnits)),
    !b.hourly ? line('Nghỉ có lương', num(b.paidLeaveDays) + ' ngày') : null,
    b.otHoursTotal ? line('Giờ tăng ca', num(b.otHoursTotal) + ' giờ') : null,
    b.basicSalary ? line('Lương cơ bản', money(b.basicSalary)) : null,
    sec('Thu nhập'),
    ...lines.filter((l) => l.kind === 'income').map((l) => line(l.name, money(l.amount), { sub: true })),
    line('TỔNG THU NHẬP', money(sl.income), { bold: true }),
    sec('Các khoản trừ'),
    ins.emp_total ? line(`Bảo hiểm (BHXH ${money(ins.bhxh)} · BHYT ${money(ins.bhyt)} · BHTN ${money(ins.bhtn)})`, money(ins.emp_total), { sub: true }) : null,
    sl.ins_skipped ? line(sl.ins_skipped, '0', { sub: true }) : null,
    ins.union_fee ? line('Đoàn phí công đoàn', money(ins.union_fee), { sub: true }) : null,
    sl.tax_mode !== 'none' ? line(sl.tax_mode === 'flat10' ? 'Thuế TNCN (khấu trừ 10%)' : `Thuế TNCN (TN tính thuế ${money(sl.assessable)})`, money(sl.tax), { sub: true }) : null,
    ...lines.filter((l) => l.kind === 'deduct').map((l) => line(l.name, money(l.amount), { sub: true })),
    sl.advance ? line('Tạm ứng', money(sl.advance), { sub: true }) : null,
    line('TỔNG KHẤU TRỪ', money(sl.total_deduct), { bold: true }),
    el('div', { style: 'display:flex;justify-content:space-between;margin-top:12px;padding:10px 12px;background:#eef2ff;border-radius:8px;font-weight:900;font-size:17px' }, el('span', {}, 'THỰC LĨNH'), el('span', {}, money(sl.net) + ' đ')),
    ...lines.filter((l) => l.kind === 'info').map((l) => line(l.name, num(l.amount))),
    sl.tax_mode === 'progressive' && sl.family_deduct ? small(`Giảm trừ gia cảnh: ${money(sl.family_deduct)} (${sl.dependents || 0} người phụ thuộc)`) : null,
  ];
  return el('div', { id: 'payslip-print' }, ...out);
}
function slipModal(r, s, company) {
  const node = slipNode(r, s, company);
  const extra = [];
  if (r.feedback) {
    const rep = el('textarea', { rows: 2, placeholder: 'Trả lời nhân viên…' }, r.feedback_reply || '');
    extra.push(el('div', { class: 'panel', style: 'padding:10px;margin-top:10px;background:#fffbeb' },
      el('b', {}, '💬 Phản hồi của nhân viên: '), el('div', { style: 'margin:4px 0 8px' }, r.feedback), rep,
      btn('Gửi trả lời', async () => { try { await api(`/admin/pay/sheets/${s.id}/reply`, { method: 'POST', body: { employee_id: r.employee_id, reply: rep.value } }); toast('Đã gửi', 'ok'); r.feedback_reply = rep.value; } catch (e) { toast(e.message, 'err'); } })));
  }
  const pr = el('button', { class: 'btn' }, '🖨 In phiếu');
  pr.onclick = () => printNode(node, `Phiếu lương ${r.code} ${s.period}`);
  C.openModal('Phiếu lương · ' + r.full_name, [node, ...extra], [btn('Đóng', C.closeModal, 'ghost'), pr]);
}
function printNode(node, title) {
  const w = window.open('', '_blank', 'width=560,height=760');
  if (!w) return toast('Trình duyệt chặn cửa sổ in', 'err');
  w.document.write(`<html><head><title>${title}</title><meta charset="utf-8"><style>body{font-family:system-ui,Arial,sans-serif;padding:24px;color:#222;max-width:520px;margin:auto}</style></head><body>${node.outerHTML}</body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

/* =============================== HỒ SƠ LƯƠNG =============================== */
async function viewProfiles() {
  page('Tiền lương', [], C.loading());
  let rows, cfg;
  try { [rows, cfg] = await Promise.all([api('/admin/pay/profiles').then((x) => x.rows), api('/admin/salary').then((x) => x.rows)]); } catch (e) { page('Tiền lương', [], el('div', { class: 'empty' }, e.message)); return; }
  const cmap = new Map(cfg.map((c) => [c.employee_id, c]));
  const q = el('input', { placeholder: '🔎 Tìm mã / tên / bộ phận', style: 'max-width:240px' });
  const picked = new Set();
  const all = chk(false);
  const tbl = el('table', { class: 'data' });
  const f = META.flags;
  tbl.append(el('thead', {}, el('tr', {}, el('th', {}, all), ...['Mã NV', 'Họ tên', 'Bộ phận', 'Lương CB', 'Phụ cấp (cũ)', f.ins ? 'Lương đóng BH' : null, f.ins ? 'BH' : null, f.ins ? 'Công đoàn' : null, f.tax ? 'Thuế TNCN' : null, f.tax ? 'NPT' : null, 'Tài khoản NH', ''].filter((x) => x !== null).map((t) => el('th', {}, t)))));
  const tb = el('tbody'); tbl.append(tb);
  const vis = () => { const k = q.value.trim().toLowerCase(); return rows.filter((r) => !k || `${r.code} ${r.full_name} ${r.department}`.toLowerCase().includes(k)); };
  const draw = () => {
    tb.innerHTML = '';
    for (const r of vis()) {
      const c = chk(picked.has(r.employee_id));
      c.onchange = () => { c.checked ? picked.add(r.employee_id) : picked.delete(r.employee_id); };
      tb.append(el('tr', {},
        el('td', {}, c), el('td', {}, r.code), el('td', { style: 'white-space:nowrap' }, el('b', {}, r.full_name)), el('td', { style: 'white-space:nowrap' }, r.department || ''),
        el('td', { style: 'text-align:right' }, money(r.basic_salary || r.hourly_rate) + (r.hourly_rate && !r.basic_salary ? '/giờ' : '')),
        el('td', { style: 'text-align:right' }, money(r.allowance)),
        f.ins ? el('td', { style: 'text-align:right' }, r.ins_salary ? money(r.ins_salary) : el('span', { style: 'color:var(--muted)' }, 'theo lương CB')) : null,
        f.ins ? el('td', {}, r.ins_on ? pill('Có', 'ok') : pill('Không', 'muted')) : null,
        f.ins ? el('td', {}, r.union_on ? '✓' : '') : null,
        f.tax ? el('td', {}, TAX_LABEL[r.tax_mode] || r.tax_mode) : null,
        f.tax ? el('td', {}, String(r.dependents || 0)) : null,
        el('td', {}, r.bank_account || (r.hr_bank_account ? el('span', { style: 'color:var(--muted)', title: 'Lấy từ hồ sơ Nhân sự' }, r.hr_bank_account) : '')),
        el('td', {}, btn('Sửa', () => profileModal(r, cmap.get(r.employee_id) || {})))));
    }
  };
  all.onchange = () => { for (const r of vis()) all.checked ? picked.add(r.employee_id) : picked.delete(r.employee_id); draw(); };
  q.oninput = draw; draw();
  const bulk = btn('✎ Đặt hàng loạt cho NV đã chọn', () => { if (!picked.size) return toast('Tích chọn nhân viên trước', 'err'); bulkProfileModal([...picked]); }, 'ghost');
  const fromHd = META.hr_enabled ? btn('📇 Lấy lương từ hợp đồng', async () => {
    const list = [...picked];
    if (!confirm(`Lấy lương thoả thuận + lương đóng BH từ hợp đồng lao động đang hiệu lực cho ${list.length ? list.length + ' NV đã chọn' : 'TẤT CẢ nhân viên có hợp đồng'}?\n(Ghi đè Lương cơ bản hiện tại)`)) return;
    try { const r = await api('/admin/pay/profiles/from-contracts', { method: 'POST', body: { ids: list } }); toast(`Đã cập nhật ${r.updated} nhân viên`, 'ok'); viewProfiles(); } catch (e) { toast(e.message, 'err'); }
  }, 'ghost') : null;
  page('Tiền lương', [q, bulk, fromHd],
    hint('Lương cơ bản / đơn giá / ngày công chuẩn / hệ số tăng ca dùng chung với bảng lương cũ. Lương đóng BH để trống = tự tính (lương cơ bản + các khoản có tick "tính vào lương đóng BH"). Tài khoản ngân hàng trống thì lấy ở hồ sơ Nhân sự.'),
    el('div', { class: 'panel tbl-scroll' }, tbl));
}
function profileModal(r, c) {
  const hourly = !!(c.hourly_rate && !c.basic_salary);
  const basic = moneyInp(c.basic_salary || 0), daily = moneyInp(c.daily_rate || ''), wd = inp(c.working_days_per_month || 26, { type: 'number', min: 1, step: '0.5' });
  const otw = inp(c.ot_rate_weekday ?? 1.5, { type: 'number', step: '0.1' }), ote = inp(c.ot_rate_weekend ?? 2, { type: 'number', step: '0.1' }), oth = inp(c.ot_rate_holiday ?? 3, { type: 'number', step: '0.1' });
  const allow = moneyInp(c.allowance || 0), hrate = moneyInp(c.hourly_rate || 0);
  const insOn = chk(r.ins_on), insSal = moneyInp(r.ins_salary || ''), union = chk(r.union_on);
  const tax = sel(Object.entries(TAX_LABEL), r.tax_mode), deps = inp(r.dependents || 0, { type: 'number', min: 0, max: 20 });
  const bn = inp(r.bank_name), ba = inp(r.bank_account, { placeholder: r.hr_bank_account || '' }), bh = inp(r.bank_holder, { placeholder: r.full_name });
  const save = el('button', { class: 'btn' }, 'Lưu');
  save.onclick = async () => {
    try {
      await api('/admin/salary/' + r.employee_id, { method: 'PUT', body: {
        basic_salary: +parseMoney(basic.value) || 0, daily_rate: parseMoney(daily.value) || null, working_days_per_month: +wd.value || 26,
        ot_rate_weekday: +otw.value || 1.5, ot_rate_weekend: +ote.value || 2, ot_rate_holiday: +oth.value || 3, allowance: +parseMoney(allow.value) || 0, hourly_rate: +parseMoney(hrate.value) || 0 } });
      await api('/admin/pay/profiles/' + r.employee_id, { method: 'PUT', body: {
        ins_on: insOn.checked, ins_salary: parseMoney(insSal.value) || 0, union_on: union.checked, tax_mode: tax.value, dependents: +deps.value || 0,
        bank_name: bn.value, bank_account: ba.value, bank_holder: bh.value } });
      toast('Đã lưu', 'ok'); C.closeModal(); viewProfiles();
    } catch (e) { toast(e.message, 'err'); }
  };
  const f = META.flags;
  C.openModal(`Hồ sơ lương · ${r.full_name} (${r.code})`, [
    el('div', { class: 'two-col' }, fld('Lương cơ bản / tháng', basic), fld('Đơn giá 1 ngày (trống = lương CB ÷ công chuẩn)', daily)),
    el('div', { class: 'two-col' }, fld('Ngày công chuẩn / tháng', wd), fld(hourly ? 'Đơn giá 1 giờ (NV tính theo giờ)' : 'Đơn giá 1 giờ (chỉ NV tính công theo giờ)', hrate)),
    el('div', { class: 'two-col' }, fld('Hệ số TC ngày thường', otw), fld('Hệ số TC ngày nghỉ', ote)),
    el('div', { class: 'two-col' }, fld('Hệ số TC ngày lễ', oth), fld('Phụ cấp cố định / tháng (ô cũ)', allow)),
    f.ins ? el('div', { style: 'margin-top:10px;font-weight:800' }, '🛡️ Bảo hiểm') : null,
    f.ins ? chkRow(insOn, 'Tham gia BHXH, BHYT, BHTN') : null,
    f.ins ? fld('Lương đóng bảo hiểm (trống = tự tính)', insSal, small(`Trần BHXH/BHYT ${money(META.caps.si)} · trần BHTN ${money(META.caps.ui)} · tối thiểu vùng ${money(META.caps.region_min)}`)) : null,
    f.ins ? chkRow(union, 'Đoàn viên công đoàn (trừ đoàn phí 1%)') : null,
    f.tax ? el('div', { style: 'margin-top:10px;font-weight:800' }, '🧾 Thuế TNCN') : null,
    f.tax ? el('div', { class: 'two-col' }, fld('Cách tính thuế', tax), fld('Số người phụ thuộc đã đăng ký', deps)) : null,
    el('div', { style: 'margin-top:10px;font-weight:800' }, '🏦 Ngân hàng (file chuyển khoản)'),
    el('div', { class: 'two-col' }, fld('Ngân hàng', bn), fld('Số tài khoản', ba)),
    fld('Tên chủ tài khoản', bh),
  ], [btn('Huỷ', C.closeModal, 'ghost'), save]);
  wide(720);
}
function bulkProfileModal(ids) {
  const f = META.flags;
  const rows = [];
  const opt = (label, node) => { const on = chk(false); rows.push([on, node]); return el('div', { style: 'display:flex;gap:8px;align-items:center;margin:6px 0' }, on, el('span', { style: 'min-width:190px' }, label), node); };
  const insOn = sel([['1', 'Có'], ['0', 'Không']], '1'), union = sel([['1', 'Có'], ['0', 'Không']], '0'), tax = sel(Object.entries(TAX_LABEL), 'progressive'), deps = inp(0, { type: 'number', min: 0 });
  const fields = [f.ins ? ['ins_on', insOn, 'Tham gia bảo hiểm'] : null, f.ins ? ['union_on', union, 'Đoàn viên công đoàn'] : null, f.tax ? ['tax_mode', tax, 'Cách tính thuế'] : null, f.tax ? ['dependents', deps, 'Số người phụ thuộc'] : null].filter(Boolean);
  const nodes = fields.map(([, node, label]) => opt(label, node));
  const save = el('button', { class: 'btn' }, 'Áp dụng');
  save.onclick = async () => {
    const body = { ids };
    rows.forEach(([on, node], i) => { if (on.checked) { const k = fields[i][0]; body[k] = k === 'ins_on' || k === 'union_on' ? node.value === '1' : k === 'dependents' ? +node.value || 0 : node.value; } });
    if (Object.keys(body).length < 2) return toast('Tích ít nhất 1 mục cần đổi', 'err');
    try { await api('/admin/pay/profiles/bulk', { method: 'POST', body }); toast('Đã cập nhật ' + ids.length + ' nhân viên', 'ok'); C.closeModal(); viewProfiles(); } catch (e) { toast(e.message, 'err'); }
  };
  C.openModal(`Đặt hàng loạt cho ${ids.length} nhân viên`, [small('Chỉ đổi những mục được tích.'), ...nodes], [btn('Huỷ', C.closeModal, 'ghost'), save]);
}

/* =============================== THÀNH PHẦN LƯƠNG =============================== */
const kindLabel = (k) => (META.comp_kinds.find((x) => x[0] === k) || [k, k])[1];
const typeLabel = (k) => (META.comp_types.find((x) => x[0] === k) || [k, k])[1];
async function viewComps() {
  page('Tiền lương', [], C.loading());
  let rows;
  try { rows = (await api('/admin/pay/components')).rows; } catch (e) { page('Tiền lương', [], el('div', { class: 'empty' }, e.message)); return; }
  const add = btn('＋ Thêm thành phần', () => compModal({}));
  const samples = btn('✨ Tạo khoản mẫu', async () => {
    try { const r = await api('/admin/pay/components/samples', { method: 'POST' }); toast(r.added ? `Đã tạo ${r.added} khoản mẫu (đang NGỪNG DÙNG — bật lên để tính)` : 'Đã có đủ khoản mẫu', 'ok'); viewComps(); } catch (e) { toast(e.message, 'err'); }
  }, 'ghost');
  const tbl = el('table', { class: 'data' });
  tbl.innerHTML = '<thead><tr><th>Mã</th><th>Tên thành phần</th><th>Tính chất</th><th>Cách tính</th><th>Giá trị</th><th>Thuế</th><th>Áp dụng</th><th>Trạng thái</th><th></th></tr></thead>';
  const tb = el('tbody');
  if (!rows.length) tb.append(el('tr', {}, el('td', { colspan: 9 }, el('div', { class: 'empty' }, 'Chưa có thành phần lương. Bấm "✨ Tạo khoản mẫu" để có sẵn phụ cấp ăn trưa, xăng xe, chuyên cần, phạt đi trễ… rồi sửa theo công ty.'))));
  for (const c of rows) {
    const val = c.value_type === 'formula' ? el('code', { style: 'font-size:12px;word-break:break-all' }, c.formula)
      : c.value_type === 'input' ? el('span', { style: 'color:var(--muted)' }, 'nhập theo kỳ') : money(c.amount) + (c.value_type === 'per_unit' ? ' / công' : '');
    const apply = [c.apply_all ? 'Mọi NV' : `${c.assigned} NV được gán`, c.depts.length ? `bộ phận: ${c.depts.join(', ')}` : '', c.apply_all && c.excluded_n ? `trừ ${c.excluded_n} NV` : ''].filter(Boolean).join(' · ');
    tb.append(el('tr', { style: c.active ? '' : 'opacity:.55' },
      el('td', {}, el('code', {}, c.code)), el('td', { style: 'white-space:nowrap' }, el('b', {}, c.name), small(c.grp)),
      el('td', {}, c.kind === 'income' ? pill('Thu nhập', 'ok') : c.kind === 'deduct' ? pill('Khấu trừ', 'bad') : pill('Khác', 'muted')),
      el('td', {}, small(typeLabel(c.value_type))), el('td', {}, val),
      el('td', {}, c.kind !== 'income' ? '' : !c.taxable ? 'Miễn' : c.tax_free_cap ? `Miễn ≤ ${money(c.tax_free_cap)}` : 'Chịu thuế'),
      el('td', {}, small(apply)),
      el('td', {}, c.active ? pill('Đang dùng', 'ok') : pill('Ngừng', 'muted')),
      el('td', { style: 'white-space:nowrap' }, btn('Sửa', () => compModal(c)), btn('👥 Gán NV', () => assignModal(c), 'ghost'))));
  }
  tbl.append(tb);
  page('Tiền lương', [add, samples],
    hint('Mỗi khoản: Thu nhập (cộng) / Khấu trừ (trừ) / Khác (chỉ hiển thị, dùng trong công thức). Cách tính: cố định, theo ngày công, theo mỗi công, nhập theo kỳ, hoặc công thức kiểu Excel. Ở thẻ "Dữ liệu theo kỳ" có thể sửa tay số của bất kỳ khoản nào cho từng người.'),
    el('div', { class: 'panel tbl-scroll' }, tbl));
}
function compModal(c) {
  const isNew = !c.id;
  const name = inp(c.name || ''), code = inp(c.code || '', { placeholder: 'tự tạo theo tên', style: 'text-transform:uppercase' });
  const grp = sel(META.comp_groups, c.grp || 'Phụ cấp'), kind = sel(META.comp_kinds, c.kind || 'income'), vt = sel(META.comp_types, c.value_type || 'fixed');
  const amount = moneyInp(c.amount ?? ''), formula = el('textarea', { rows: 3, style: 'font-family:monospace', placeholder: '=IF(DI_TRE_LAN=0, 300000, 0)' }, c.formula || '');
  const taxable = chk(c.id ? c.taxable : true), cap = moneyInp(c.tax_free_cap || ''), insInc = chk(c.ins_include), show = chk(c.id ? c.show : true), showZero = chk(c.show_zero);
  const applyAll = chk(c.id ? c.apply_all : true), active = chk(c.id ? c.active : true), note = inp(c.note || '');
  const dp = deptPicker(c.depts || []);
  const ckOut = el('div', { style: 'font-size:13px;margin-top:4px' });
  const empSel = el('select', { style: 'max-width:260px' }, el('option', { value: '' }, '— thử với nhân viên —'));
  api('/admin/pay/profiles').then((x) => { for (const e of x.rows) empSel.append(el('option', { value: e.employee_id }, `${e.code} · ${e.full_name}`)); }).catch(() => {});
  const check = async () => {
    ckOut.textContent = '…';
    try {
      const r = await api('/admin/pay/formula/check', { method: 'POST', body: { formula: formula.value, code: code.value, employee_id: empSel.value || null, period: _period } });
      if (!r.ok) { ckOut.innerHTML = ''; ckOut.append(el('span', { style: 'color:#b91c1c' }, '⛔ ' + r.error)); return; }
      ckOut.innerHTML = '';
      ckOut.append(el('span', { style: 'color:#15803d' }, '✓ Công thức hợp lệ' + (r.vars.length ? ` — dùng: ${r.vars.join(', ')}` : '')));
      if (r.test !== undefined && r.test !== null) ckOut.append(el('div', {}, `→ Tháng ${pdisp(_period)}: `, el('b', {}, typeof r.test === 'number' ? num(r.test) : String(r.test)), small(Object.entries(r.vars || {}).map(([k, v]) => `${k} = ${typeof v === 'number' ? num(v) : v}`).join(' · '))));
      if (r.test_error) ckOut.append(small(r.test_error));
    } catch (e) { ckOut.textContent = e.message; }
  };
  const varBox = el('div', { style: 'max-height:160px;overflow:auto;border:1px solid var(--line,#e5e7eb);border-radius:8px;padding:6px;font-size:12px' },
    ...META.system_vars.map(([k, d]) => el('div', { style: 'cursor:pointer;padding:2px 0', title: 'Bấm để chèn', onclick: () => { formula.setRangeText(k, formula.selectionStart, formula.selectionEnd, 'end'); formula.focus(); } }, el('code', {}, k), ' — ', d)),
    small('Hàm: ' + META.funcs.join(', ') + ' · so sánh = <> < > <= >= · chuỗi trong "…" · dùng được MÃ của thành phần khác'));
  const fBox = el('div', {}, fld('Công thức', formula), el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:4px' }, btn('Kiểm tra', check, 'ghost'), empSel), ckOut, el('div', { style: 'margin-top:6px;font-weight:700;font-size:13px' }, 'Mã dùng được (bấm để chèn):'), varBox);
  const aBox = fld('Số tiền mặc định', amount);
  const taxBox = el('div', {}, chkRow(taxable, 'Chịu thuế TNCN'), fld('Phần được miễn thuế tối đa / tháng (VD ăn giữa ca)', cap), chkRow(insInc, 'Tính vào lương đóng BH', 'Phụ cấp lương có tính chất cố định — cộng vào lương đóng BH khi lương đóng BH của NV để "tự tính"'));
  const sync = () => {
    fBox.style.display = vt.value === 'formula' ? '' : 'none';
    aBox.style.display = ['fixed', 'prorate', 'per_unit'].includes(vt.value) ? '' : 'none';
    taxBox.style.display = kind.value === 'income' ? '' : 'none';
  };
  vt.onchange = sync; kind.onchange = sync; sync();
  const save = el('button', { class: 'btn' }, 'Lưu');
  save.onclick = async () => {
    const body = { name: name.value, code: code.value.trim().toUpperCase() || undefined, grp: grp.value, kind: kind.value, value_type: vt.value,
      amount: parseMoney(amount.value) || 0, formula: formula.value, taxable: taxable.checked, tax_free_cap: parseMoney(cap.value) || 0, ins_include: insInc.checked,
      show: show.checked, show_zero: showZero.checked, apply_all: applyAll.checked, depts: dp.value(), active: active.checked, note: note.value, sort: c.sort };
    try { await api('/admin/pay/components' + (isNew ? '' : '/' + c.id), { method: isNew ? 'POST' : 'PUT', body }); toast('Đã lưu', 'ok'); C.closeModal(); viewComps(); } catch (e) { toast(e.message, 'err'); }
  };
  const del = isNew ? null : btn('Xoá', async () => {
    if (!confirm(`Xoá thành phần ${c.code}? (Đã có dữ liệu kỳ thì chỉ chuyển sang Ngừng dùng)`)) return;
    try { const r = await api('/admin/pay/components/' + c.id, { method: 'DELETE' }); toast(r.deleted ? 'Đã xoá' : 'Đã chuyển sang Ngừng dùng', 'ok'); C.closeModal(); viewComps(); } catch (e) { toast(e.message, 'err'); }
  }, 'ghost');
  C.openModal(isNew ? 'Thêm thành phần lương' : 'Sửa thành phần ' + c.code, [
    el('div', { class: 'two-col' }, fld('Tên thành phần *', name), fld('Mã (CHỮ_IN_HOA, dùng trong công thức)', code)),
    el('div', { class: 'two-col' }, fld('Nhóm', grp), fld('Tính chất', kind)),
    fld('Cách tính', vt), aBox, fBox, taxBox,
    el('div', { style: 'margin-top:8px;font-weight:800' }, 'Áp dụng'),
    chkRow(applyAll, 'Mọi nhân viên', 'Bỏ tích = chỉ những NV được gán ở nút "👥 Gán NV". Đang tích thì vẫn loại riêng được từng NV ở "👥 Gán NV".'),
    fld('Chỉ bộ phận (bỏ trống = mọi bộ phận)', dp.box),
    chkRow(show, 'Hiện trên phiếu lương'), chkRow(showZero, 'Hiện cả khi bằng 0'), chkRow(active, 'Đang dùng'),
    fld('Ghi chú', note),
  ], [del, btn('Huỷ', C.closeModal, 'ghost'), save].filter(Boolean));
  wide(820);
}
async function assignModal(c) {
  let emps, cur;
  try { [emps, cur] = await Promise.all([api('/admin/pay/profiles').then((x) => x.rows), api(`/admin/pay/components/${c.id}/assign`).then((x) => x.rows)]); } catch (e) { return toast(e.message, 'err'); }
  const m = new Map(cur.map((a) => [a.employee_id, a]));
  const q = el('input', { placeholder: '🔎 Tìm', style: 'max-width:200px' });
  const dsel = sel([['', '— Tất cả bộ phận —'], ...DEPTS], '', { style: 'max-width:240px' });
  const state = new Map(emps.map((e) => { const a = m.get(e.employee_id); return [e.employee_id, { on: c.apply_all ? !(a && a.excluded) : !!(a && !a.excluded), amount: a?.amount ?? '' }]; }));
  const tbl = el('table', { class: 'data' });
  const tb = el('tbody');
  const showAmt = ['fixed', 'prorate', 'per_unit'].includes(c.value_type);
  tbl.append(el('thead', {}, el('tr', {}, el('th', {}, ''), el('th', {}, 'Mã NV'), el('th', {}, 'Họ tên'), el('th', {}, 'Bộ phận'), showAmt ? el('th', {}, `Số tiền riêng (trống = ${money(c.amount)})`) : null)), tb);
  const vis = () => emps.filter((e) => (!dsel.value || e.department === dsel.value) && (!q.value || `${e.code} ${e.full_name}`.toLowerCase().includes(q.value.toLowerCase())));
  const draw = () => {
    tb.innerHTML = '';
    for (const e of vis()) {
      const s = state.get(e.employee_id);
      const cb = chk(s.on); cb.onchange = () => { s.on = cb.checked; };
      const a = moneyInp(s.amount, { style: 'max-width:150px' }); a.oninput = () => { s.amount = parseMoney(a.value); };
      tb.append(el('tr', {}, el('td', {}, cb), el('td', {}, e.code), el('td', {}, e.full_name), el('td', {}, e.department || ''), showAmt ? el('td', {}, a) : null));
    }
  };
  q.oninput = draw; dsel.onchange = draw; draw();
  const allOn = btn('Tích tất cả đang lọc', () => { for (const e of vis()) state.get(e.employee_id).on = true; draw(); }, 'ghost');
  const allOff = btn('Bỏ tích đang lọc', () => { for (const e of vis()) state.get(e.employee_id).on = false; draw(); }, 'ghost');
  const save = el('button', { class: 'btn' }, 'Lưu');
  save.onclick = async () => {
    const rows = emps.map((e) => {
      const s = state.get(e.employee_id);
      const amt = s.amount === '' || s.amount == null ? null : s.amount;
      if (c.apply_all) return s.on && amt == null ? { employee_id: e.employee_id, remove: true } : { employee_id: e.employee_id, excluded: !s.on, amount: amt };
      return s.on ? { employee_id: e.employee_id, excluded: false, amount: amt } : { employee_id: e.employee_id, remove: true };
    });
    try { await api(`/admin/pay/components/${c.id}/assign`, { method: 'PUT', body: { rows } }); toast('Đã lưu', 'ok'); C.closeModal(); viewComps(); } catch (e) { toast(e.message, 'err'); }
  };
  C.openModal(`Gán nhân viên · ${c.name}`, [
    small(c.apply_all ? 'Khoản này áp dụng MỌI nhân viên: bỏ tích = loại riêng người đó.' : 'Khoản này chỉ áp dụng cho nhân viên được tích.'),
    el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin:8px 0' }, q, dsel, allOn, allOff),
    el('div', { class: 'tbl-scroll', style: 'max-height:55vh' }, tbl),
  ], [btn('Huỷ', C.closeModal, 'ghost'), save]);
  wide(820);
}

/* =============================== DỮ LIỆU THEO KỲ =============================== */
async function viewItems() {
  const mi = monthInput(viewItems);
  page('Tiền lương', [mi], C.loading());
  let d;
  try { d = await api('/admin/pay/period-items?period=' + _period); } catch (e) { page('Tiền lương', [mi], el('div', { class: 'empty' }, e.message)); return; }
  const showAll = chk(false);
  const q = el('input', { placeholder: '🔎 Tìm', style: 'max-width:200px' });
  const dsel = sel([['', '— Tất cả bộ phận —'], ...DEPTS], '', { style: 'max-width:240px' });
  const vals = new Map(d.items.map((i) => [`${i.employee_id}:${i.component_id}`, i.amount]));
  const dirty = new Map();
  const wrap = el('div', { class: 'panel tbl-scroll', style: 'max-height:68vh' });
  const draw = () => {
    const comps = d.comps.filter((c) => showAll.checked || c.value_type === 'input');
    wrap.innerHTML = '';
    if (!comps.length) { wrap.append(el('div', { class: 'empty' }, 'Chưa có thành phần "Nhập theo kỳ". Tạo ở thẻ 🧩 Thành phần lương (VD Thưởng khác, Khấu trừ khác) — hoặc tích "Hiện cả khoản khác" để sửa tay số của khoản cố định / công thức.')); return; }
    const tbl = el('table', { class: 'data' });
    tbl.append(el('thead', {}, el('tr', {}, el('th', {}, 'Mã NV'), el('th', {}, 'Họ tên'), el('th', {}, 'Bộ phận'), ...comps.map((c) => el('th', { title: c.code }, c.name, c.kind === 'deduct' ? small('(khấu trừ)') : c.value_type !== 'input' ? small('(ghi đè)') : null)))));
    const tb = el('tbody');
    const k = q.value.trim().toLowerCase();
    for (const e of d.employees) {
      if (dsel.value && e.department !== dsel.value) continue;
      if (k && !`${e.code} ${e.full_name}`.toLowerCase().includes(k)) continue;
      tb.append(el('tr', {}, el('td', {}, e.code), el('td', {}, el('b', {}, e.full_name)), el('td', {}, e.department || ''),
        ...comps.map((c) => {
          const key = `${e.id}:${c.id}`;
          const v = dirty.has(key) ? dirty.get(key) : vals.get(key);
          const i = moneyInp(v ?? '', { style: 'width:120px;text-align:right' + (dirty.has(key) ? ';background:#fef9c3' : '') });
          i.oninput = () => { dirty.set(key, parseMoney(i.value)); i.style.background = '#fef9c3'; };
          return el('td', {}, i);
        })));
    }
    tbl.append(tb); wrap.append(tbl);
  };
  showAll.onchange = draw; q.oninput = draw; dsel.onchange = draw; draw();
  const save = btn('💾 Lưu thay đổi', async () => {
    if (!dirty.size) return toast('Chưa sửa ô nào', 'err');
    const cells = [...dirty].map(([k, amount]) => { const [employee_id, component_id] = k.split(':').map(Number); return { employee_id, component_id, amount: amount === '' ? null : amount }; });
    try { await api('/admin/pay/period-items', { method: 'PUT', body: { period: _period, cells } }); toast(`Đã lưu ${cells.length} ô`, 'ok'); viewItems(); } catch (e) { toast(e.message, 'err'); }
  });
  const tplBtn = btn('⬇ File mẫu Excel', () => download(`/admin/pay/period-items/template.xlsx?period=${_period}${showAll.checked ? '&all=1' : ''}`, 'du_lieu_luong.xlsx'), 'ghost');
  const imp = btn('⬆ Nhập Excel', () => pickFile(async (b64) => {
    try { const r = await api('/admin/pay/period-items/import', { method: 'POST', body: { period: _period, fileBase64: b64 } }); toast(`Đã nhập ${r.cells} ô (${r.columns.join(', ')})` + (r.missing.length ? ` · không thấy mã: ${r.missing.join(', ')}` : ''), 'ok'); viewItems(); } catch (e) { toast(e.message, 'err'); }
  }), 'ghost');
  page('Tiền lương', [mi, save, tplBtn, imp],
    hint(`Dữ liệu tháng ${pdisp(_period)}: thưởng, phạt, truy lĩnh, truy thu, doanh số… cho từng người. Ô trống = không có / theo cách tính của khoản. Số nhập ở đây được ƯU TIÊN hơn cách tính tự động. Xong thì vào bảng lương bấm "🔄 Tính lại".`),
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px' }, q, dsel, el('label', { style: 'display:flex;gap:6px;align-items:center;font-size:13px' }, showAll, 'Hiện cả khoản khác (sửa tay số tự tính)')),
    wrap);
}

/* =============================== TẠM ỨNG =============================== */
async function viewAdv() {
  const mi = monthInput(viewAdv);
  page('Tiền lương', [mi], C.loading());
  let rows, emps;
  try { [rows, emps] = await Promise.all([api('/admin/pay/advances?period=' + _period).then((x) => x.rows), api('/admin/pay/profiles').then((x) => x.rows)]); } catch (e) { page('Tiền lương', [mi], el('div', { class: 'empty' }, e.message)); return; }
  const tbl = el('table', { class: 'data' });
  tbl.innerHTML = '<thead><tr><th>Mã NV</th><th>Họ tên</th><th>Bộ phận</th><th>Ngày ứng</th><th style="text-align:right">Số tiền</th><th>Ghi chú</th><th></th></tr></thead>';
  const tb = el('tbody');
  if (!rows.length) tb.append(el('tr', {}, el('td', { colspan: 7 }, el('div', { class: 'empty' }, 'Chưa có khoản tạm ứng nào trừ vào lương tháng này.'))));
  for (const a of rows) tb.append(el('tr', {}, el('td', {}, a.code), el('td', {}, el('b', {}, a.full_name)), el('td', {}, a.department || ''), el('td', {}, dmy(a.adv_date)),
    el('td', { style: 'text-align:right' }, money(a.amount)), el('td', {}, a.note || ''),
    el('td', { style: 'white-space:nowrap' }, btn('Sửa', () => advModal(a, emps), 'ghost'), btn('🗑', async () => {
      if (!confirm('Xoá khoản tạm ứng này?')) return;
      try { await api('/admin/pay/advances/' + a.id, { method: 'DELETE' }); viewAdv(); } catch (e) { toast(e.message, 'err'); }
    }, 'ghost'))));
  tbl.append(tb);
  const total = rows.reduce((s, a) => s + a.amount, 0);
  page('Tiền lương', [mi, btn('＋ Thêm tạm ứng', () => advModal({}, emps)), btn('👥 Tạm ứng hàng loạt', () => bulkAdvModal(), 'ghost'),
    btn('⬇ File mẫu', () => download('/admin/pay/advances/template.xlsx', 'mau_tam_ung.xlsx'), 'ghost'),
    btn('⬆ Nhập Excel', () => pickFile(async (b64) => { try { const r = await api('/admin/pay/advances/import', { method: 'POST', body: { period: _period, fileBase64: b64 } }); toast(`Đã nhập ${r.n} khoản` + (r.missing.length ? ` · không thấy mã: ${r.missing.join(', ')}` : ''), 'ok'); viewAdv(); } catch (e) { toast(e.message, 'err'); } }), 'ghost')],
    hint(`Các khoản tạm ứng được TRỪ vào bảng lương tháng ${pdisp(_period)}. Tổng: ${money(total)} đ (${rows.length} khoản).`),
    el('div', { class: 'panel tbl-scroll' }, tbl));
}
function advModal(a, emps) {
  const es = sel([['', '— chọn nhân viên —'], ...emps.map((e) => [e.employee_id, `${e.code} · ${e.full_name}`])], a.employee_id || '');
  const per = el('input', { type: 'month', value: a.period || _period }), dt = el('input', { type: 'date', value: a.adv_date || '' });
  const amt = moneyInp(a.amount || ''), note = inp(a.note || '');
  const save = el('button', { class: 'btn' }, 'Lưu');
  save.onclick = async () => {
    try { await api('/admin/pay/advances' + (a.id ? '/' + a.id : ''), { method: a.id ? 'PUT' : 'POST', body: { employee_id: +es.value, period: per.value, adv_date: dt.value, amount: parseMoney(amt.value), note: note.value } }); toast('Đã lưu', 'ok'); C.closeModal(); viewAdv(); } catch (e) { toast(e.message, 'err'); }
  };
  C.openModal(a.id ? 'Sửa tạm ứng' : 'Thêm tạm ứng', [fld('Nhân viên', es), el('div', { class: 'two-col' }, fld('Trừ vào lương tháng', per), fld('Ngày ứng', dt)), fld('Số tiền', amt), fld('Ghi chú', note)], [btn('Huỷ', C.closeModal, 'ghost'), save]);
}
function bulkAdvModal() {
  const pct = inp('', { type: 'number', min: 1, max: 100, placeholder: 'VD 30' }), amt = moneyInp(''), round = sel([['0', 'Không làm tròn'], ['1000', 'Làm tròn xuống nghìn'], ['10000', 'Chục nghìn'], ['100000', 'Trăm nghìn']], '100000');
  const dt = el('input', { type: 'date' }), note = inp('Tạm ứng kỳ 1');
  const dp = deptPicker([]);
  const save = el('button', { class: 'btn' }, 'Tạo tạm ứng');
  save.onclick = async () => {
    try { const r = await api('/admin/pay/advances/bulk', { method: 'POST', body: { period: _period, percent: +pct.value || 0, amount: parseMoney(amt.value) || 0, round: +round.value, adv_date: dt.value, note: note.value, depts: dp.value() } }); toast(`Đã tạo ${r.n} khoản tạm ứng`, 'ok'); C.closeModal(); viewAdv(); } catch (e) { toast(e.message, 'err'); }
  };
  C.openModal('Tạm ứng hàng loạt tháng ' + pdisp(_period), [
    el('div', { class: 'two-col' }, fld('% lương cơ bản', pct), fld('hoặc Số tiền cố định / người', amt)),
    el('div', { class: 'two-col' }, fld('Làm tròn', round), fld('Ngày ứng', dt)), fld('Ghi chú', note),
    fld('Bộ phận (bỏ trống = tất cả)', dp.box),
  ], [btn('Huỷ', C.closeModal, 'ghost'), save]);
}

/* =============================== MẪU BẢNG LƯƠNG =============================== */
async function viewTpl() {
  page('Tiền lương', [], C.loading());
  let d, comps;
  try { [d, comps] = await Promise.all([api('/admin/pay/templates'), api('/admin/pay/components').then((x) => x.rows)]); } catch (e) { page('Tiền lương', [], el('div', { class: 'empty' }, e.message)); return; }
  const tbl = el('table', { class: 'data' });
  tbl.innerHTML = '<thead><tr><th>Tên mẫu</th><th>Bộ phận áp dụng</th><th>Thành phần</th><th>Cột</th><th>Trạng thái</th><th></th></tr></thead>';
  const tb = el('tbody');
  if (!d.rows.length) tb.append(el('tr', {}, el('td', { colspan: 6 }, el('div', { class: 'empty' }, 'Chưa có mẫu. Không dùng mẫu thì bảng lương tính mọi thành phần đang dùng, cột tự chọn theo dữ liệu.'))));
  for (const t of d.rows) tb.append(el('tr', { style: t.active ? '' : 'opacity:.55' }, el('td', {}, el('b', {}, t.name), t.note ? small(t.note) : null),
    el('td', {}, t.depts.length ? t.depts.join(', ') : 'Tất cả'), el('td', {}, t.comp_ids.length ? `${t.comp_ids.length} khoản` : 'Tất cả'), el('td', {}, t.columns.length ? `${t.columns.length} cột` : 'Mặc định'),
    el('td', {}, t.active ? pill('Đang áp dụng', 'ok') : pill('Ngừng', 'muted')), el('td', {}, btn('Sửa', () => tplModal(t, d.catalog, comps)))));
  tbl.append(tb);
  page('Tiền lương', [btn('＋ Thêm mẫu', () => tplModal({}, d.catalog, comps))],
    hint('Mẫu bảng lương (như AMIS): mỗi khối / bộ phận một mẫu — chọn thành phần được tính và cột hiện trên bảng lương + file Excel (đổi tên cột, sắp thứ tự).'),
    el('div', { class: 'panel tbl-scroll' }, tbl));
}
function tplModal(t, catalog, comps) {
  const name = inp(t.name || ''), note = inp(t.note || ''), active = chk(t.id ? t.active : true);
  const dp = deptPicker(t.depts || []);
  const cbox = el('div', { style: 'max-height:160px;overflow:auto;border:1px solid var(--line,#e5e7eb);border-radius:8px;padding:6px 10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:2px 12px' });
  const ccb = comps.filter((c) => c.active).map((c) => { const x = chk((t.comp_ids || []).includes(c.id), { value: c.id }); cbox.append(el('label', { style: 'display:flex;gap:6px;font-size:13px;cursor:pointer' }, x, `${c.name} (${c.code})`)); return x; });
  // cột: danh sách có thứ tự, tích để dùng, sửa tên
  const chosen = (t.columns && t.columns.length) ? t.columns.map((c) => ({ ...c, on: true })) : [];
  const cols = [...chosen, ...catalog.filter((c) => !chosen.some((x) => x.key === c.key)).map((c) => ({ key: c.key, label: '', on: !chosen.length && false }))];
  const catMap = new Map(catalog.map((c) => [c.key, c]));
  const colBox = el('div', { style: 'max-height:260px;overflow:auto;border:1px solid var(--line,#e5e7eb);border-radius:8px;padding:6px' });
  const drawCols = () => {
    colBox.innerHTML = '';
    cols.forEach((c, i) => {
      const cb = chk(c.on); cb.onchange = () => { c.on = cb.checked; };
      const lb = inp(c.label, { placeholder: catMap.get(c.key)?.label || c.key, style: 'flex:1;padding:4px 6px' }); lb.oninput = () => { c.label = lb.value; };
      const up = btn('↑', () => { if (i) { [cols[i - 1], cols[i]] = [cols[i], cols[i - 1]]; drawCols(); } }, 'ghost');
      const dn = btn('↓', () => { if (i < cols.length - 1) { [cols[i + 1], cols[i]] = [cols[i], cols[i + 1]]; drawCols(); } }, 'ghost');
      colBox.append(el('div', { style: 'display:flex;gap:6px;align-items:center;padding:2px 0' }, cb, el('code', { style: 'min-width:150px;font-size:11px' }, c.key), lb, up, dn));
    });
  };
  drawCols();
  const save = el('button', { class: 'btn' }, 'Lưu');
  save.onclick = async () => {
    const body = { name: name.value, note: note.value, active: active.checked, depts: dp.value(), comp_ids: ccb.filter((x) => x.checked).map((x) => +x.value),
      columns: cols.filter((c) => c.on).map((c) => ({ key: c.key, label: c.label })) };
    try { await api('/admin/pay/templates' + (t.id ? '/' + t.id : ''), { method: t.id ? 'PUT' : 'POST', body }); toast('Đã lưu', 'ok'); C.closeModal(); viewTpl(); } catch (e) { toast(e.message, 'err'); }
  };
  const del = t.id ? btn('Xoá', async () => { if (!confirm('Xoá mẫu này?')) return; try { await api('/admin/pay/templates/' + t.id, { method: 'DELETE' }); C.closeModal(); viewTpl(); } catch (e) { toast(e.message, 'err'); } }, 'ghost') : null;
  C.openModal(t.id ? 'Sửa mẫu bảng lương' : 'Thêm mẫu bảng lương', [
    el('div', { class: 'two-col' }, fld('Tên mẫu *', name), fld('Ghi chú', note)), chkRow(active, 'Đang áp dụng'),
    fld('Bộ phận áp dụng (bỏ trống = tất cả)', dp.box),
    fld('Thành phần được tính (bỏ trống = mọi thành phần đang dùng)', cbox),
    fld('Cột hiển thị (tích cột cần dùng, sửa tên, ↑↓ sắp thứ tự; không tích cột nào = cột mặc định)', colBox),
  ], [del, btn('Huỷ', C.closeModal, 'ghost'), save].filter(Boolean));
  wide(860);
}

/* =============================== BÁO CÁO =============================== */
let _rep = 'year', _repYear = String(new Date().getFullYear()), _repField = 'income';
async function viewReports() {
  const kind = sel([['year', 'Tổng hợp thu nhập năm'], ['insurance', 'Bảo hiểm tháng'], ['tax', 'Thuế TNCN tháng'], ['settlement', 'Quyết toán thuế TNCN năm']], _rep);
  const yr = inp(_repYear, { type: 'number', min: 2020, max: 2100, style: 'width:90px' });
  const mi = el('input', { type: 'month', value: _period });
  const fieldSel = sel([['income', 'Tổng thu nhập'], ['net', 'Thực lĩnh'], ['tax', 'Thuế TNCN'], ['ins', 'BH NLĐ']], _repField);
  const wrap = el('div', {}, C.loading());
  const q = () => (['year', 'settlement'].includes(_rep) ? `year=${_repYear}` : `period=${_period}`) + (_rep === 'year' ? `&field=${_repField}` : '');
  const xl = btn('⬇ Excel', () => download(`/admin/pay/reports/${_rep}.xlsx?${q()}`, 'bao_cao_luong.xlsx'), 'ghost');
  const load = async () => {
    yr.style.display = fieldSel.style.display = ['year', 'settlement'].includes(_rep) ? '' : 'none';
    if (_rep !== 'year') fieldSel.style.display = 'none';
    mi.style.display = ['year', 'settlement'].includes(_rep) ? 'none' : '';
    wrap.innerHTML = ''; wrap.append(C.loading());
    let d;
    try { d = await api(`/admin/pay/reports/${_rep}?${q()}`); } catch (e) { wrap.innerHTML = ''; wrap.append(el('div', { class: 'empty' }, e.message)); return; }
    const tbl = el('table', { class: 'data' });
    tbl.append(el('thead', {}, el('tr', {}, ...d.cols.map((c) => el('th', { style: c.type === 'text' ? '' : 'text-align:right' }, c.label)))));
    const tb = el('tbody');
    if (!d.rows.length) tb.append(el('tr', {}, el('td', { colspan: d.cols.length }, el('div', { class: 'empty' }, 'Chưa có bảng lương ĐÃ CHỐT trong khoảng này.'))));
    for (const r of d.rows) tb.append(el('tr', {}, ...d.cols.map((c) => el('td', { style: c.type === 'text' ? '' : 'text-align:right;font-variant-numeric:tabular-nums' }, c.type === 'text' ? (r[c.key] ?? '') : c.type === 'num' ? num(r[c.key]) : money(r[c.key])))));
    if (d.rows.length) tb.append(el('tr', { style: 'font-weight:800;background:#eef2ff' }, ...d.cols.map((c, i) => el('td', { style: c.type === 'money' ? 'text-align:right' : '' }, i === 0 ? 'Tổng' : c.type === 'money' ? money(d.rows.reduce((s, r) => s + (+r[c.key] || 0), 0)) : ''))));
    tbl.append(tb);
    wrap.innerHTML = '';
    wrap.append(el('div', { style: 'font-weight:800;margin-bottom:6px' }, d.title), el('div', { class: 'panel tbl-scroll', style: 'max-height:68vh' }, tbl),
      _rep === 'settlement' ? hint('Quyết toán thay cho NV ký HĐ từ 3 tháng trở lên: thuế cả năm tính theo biểu lũy tiến năm (mốc tháng × 12), giảm trừ bản thân 12 tháng + người phụ thuộc theo số tháng đã đăng ký. Cột cuối dương = NV nộp thêm, âm = được hoàn. Kế toán đối chiếu trước khi nộp tờ khai 05/QTT-TNCN.') : null);
  };
  kind.onchange = () => { _rep = kind.value; load(); };
  yr.onchange = () => { _repYear = yr.value; load(); };
  mi.onchange = () => { if (mi.value) { _period = mi.value; load(); } };
  fieldSel.onchange = () => { _repField = fieldSel.value; load(); };
  page('Tiền lương', [kind, yr, fieldSel, mi, xl], hint('Báo cáo lấy từ các bảng lương ĐÃ CHỐT.'), wrap);
  load();
}

/* =============================== PHẢN HỒI =============================== */
async function viewFeedback() {
  page('Tiền lương', [], C.loading());
  let rows;
  try { rows = (await api('/admin/pay/feedback')).rows; } catch (e) { page('Tiền lương', [], el('div', { class: 'empty' }, e.message)); return; }
  const list = el('div', { style: 'display:flex;flex-direction:column;gap:10px' });
  if (!rows.length) list.append(el('div', { class: 'empty' }, 'Chưa có phản hồi phiếu lương nào.'));
  for (const r of rows) {
    const rep = el('textarea', { rows: 2, placeholder: 'Trả lời…' }, r.feedback_reply || '');
    list.append(el('div', { class: 'panel', style: 'padding:12px' },
      el('div', {}, el('b', {}, `${r.full_name} (${r.code})`), ` · ${r.department || ''} · ${r.name} · `, small(r.feedback_at)),
      el('div', { style: 'margin:6px 0;padding:8px;background:#fffbeb;border-radius:8px' }, r.feedback), rep,
      btn('Gửi trả lời', async () => { try { await api(`/admin/pay/sheets/${r.sheet_id}/reply`, { method: 'POST', body: { employee_id: r.employee_id, reply: rep.value } }); toast('Đã gửi', 'ok'); } catch (e) { toast(e.message, 'err'); } })));
  }
  page('Tiền lương', [], hint('Nhân viên xem phiếu lương trên app và gửi phản hồi (thắc mắc) — trả lời ở đây, nhân viên nhận thông báo.'), list);
}

/* =============================== THÔNG SỐ =============================== */
async function viewParams() {
  const p = JSON.parse(JSON.stringify(META.params)), D = META.defaults;
  const flags = {};
  const flagBox = el('div', { class: 'panel', style: 'padding:14px;margin-bottom:12px' }, el('h3', { style: 'margin-top:0' }, 'Chức năng dùng'),
    small('Công ty cần đơn giản thì tắt bớt — bảng lương / phiếu lương tự bỏ phần đó.'),
    ...META.flag_keys.map((f) => { const c = chk(META.flags[f.key.slice(4)] ?? f.def === '1'); flags[f.key] = c; return chkRow(c, f.label); }));
  const mI = (v) => moneyInp(v, { style: 'max-width:160px' });
  const nI = (v, step = '0.1') => inp(v, { type: 'number', step, style: 'max-width:90px' });
  const base = mI(p.base_salary), region = sel([[1, 'Vùng I'], [2, 'Vùng II'], [3, 'Vùng III'], [4, 'Vùng IV']], p.region);
  const rmin = p.region_min.map((v) => mI(v));
  const siM = nI(p.si_cap_mult, '1'), uiM = nI(p.ui_cap_mult, '1');
  const er = Object.fromEntries(Object.entries(p.emp_rate).map(([k, v]) => [k, nI(v)])), cr = Object.fromEntries(Object.entries(p.co_rate).map(([k, v]) => [k, nI(v)]));
  const uf = nI(p.union_fee_pct), ufc = nI(p.union_fee_cap_pct, '1'), skip14 = chk(p.si_skip_14);
  const selfD = mI(p.self_deduct), depD = mI(p.dep_deduct), flatR = nI(p.flat_rate, '1'), flatMin = mI(p.flat_min), flatBase = sel([['taxable', 'Thu nhập chịu thuế × 10%'], ['total', 'Tổng thu nhập × 10%']], p.flat_base);
  const otEx = chk(p.ot_premium_exempt), roundNet = sel([[0, 'Tới đồng'], [3, 'Tới nghìn đồng']], p.round_net);
  const br = p.brackets.map((b) => ({ ...b }));
  const brBox = el('div');
  const drawBr = () => {
    brBox.innerHTML = '';
    const t = el('table', { class: 'data' }, el('thead', {}, el('tr', {}, el('th', {}, 'Bậc'), el('th', {}, 'Thu nhập tính thuế / tháng đến'), el('th', {}, 'Thuế suất %'), el('th', {}, ''))));
    const tb = el('tbody');
    br.forEach((b, i) => {
      const to = b.to == null ? el('span', { style: 'color:var(--muted)' }, 'trở lên') : mI(b.to);
      if (b.to != null) to.oninput = () => { b.to = +parseMoney(to.value) || 0; };
      const rt = nI(b.rate, '1'); rt.oninput = () => { b.rate = +rt.value || 0; };
      tb.append(el('tr', {}, el('td', {}, String(i + 1)), el('td', {}, to), el('td', {}, rt),
        el('td', {}, br.length > 1 && b.to != null ? btn('✕', () => { br.splice(i, 1); drawBr(); }, 'ghost') : null)));
    });
    t.append(tb);
    brBox.append(t, btn('＋ Thêm bậc', () => { br.splice(br.length - 1, 0, { to: (br[br.length - 2]?.to || 0) + 10000000, rate: 0 }); drawBr(); }, 'ghost'));
  };
  drawBr();
  const row = (label, node, extra) => el('div', { style: 'display:flex;gap:10px;align-items:center;margin:6px 0;flex-wrap:wrap' }, el('span', { style: 'min-width:240px' }, label), node, extra ? small(extra) : null);
  const rateRow = (title, o) => el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0' }, el('b', { style: 'min-width:130px' }, title),
    ...Object.entries(o).map(([k, i]) => el('label', { style: 'display:flex;gap:4px;align-items:center' }, k.toUpperCase(), i)));
  const collect = () => ({
    base_salary: +parseMoney(base.value) || 0, region: +region.value, region_min: rmin.map((i) => +parseMoney(i.value) || 0),
    si_cap_mult: +siM.value, ui_cap_mult: +uiM.value,
    emp_rate: Object.fromEntries(Object.entries(er).map(([k, i]) => [k, +i.value])), co_rate: Object.fromEntries(Object.entries(cr).map(([k, i]) => [k, +i.value])),
    union_fee_pct: +uf.value, union_fee_cap_pct: +ufc.value, si_skip_14: skip14.checked ? 1 : 0,
    self_deduct: +parseMoney(selfD.value) || 0, dep_deduct: +parseMoney(depD.value) || 0, brackets: br,
    flat_rate: +flatR.value, flat_min: +parseMoney(flatMin.value) || 0, flat_base: flatBase.value, ot_premium_exempt: otEx.checked ? 1 : 0, round_net: +roundNet.value,
  });
  const save = btn('💾 Lưu thông số', async () => {
    try {
      const body = { params: collect() };
      for (const [k, c] of Object.entries(flags)) body[k] = c.checked;
      await api('/admin/pay/settings', { method: 'PUT', body });
      META = await api('/admin/pay/meta'); toast('Đã lưu', 'ok'); viewParams();
    } catch (e) { toast(e.message, 'err'); }
  });
  const reset = btn('↺ Lấy lại mặc định theo luật', () => { if (confirm('Đặt lại toàn bộ thông số BH / thuế về mặc định?')) { META.params = JSON.parse(JSON.stringify(D)); viewParams(); } }, 'ghost');
  // máy tính thử
  const tg = mI(20000000), tdp = nI(0, '1'), tout = el('div', { style: 'margin-top:6px;font-size:14px' });
  const calc = btn('Tính thử', async () => {
    try {
      const r = await api('/admin/pay/calc-test', { method: 'POST', body: { gross: +parseMoney(tg.value) || 0, dependents: +tdp.value || 0, params: collect() } });
      tout.innerHTML = '';
      tout.append(el('div', {}, `BH NLĐ: ${money(r.ins.emp_total)} (BHXH ${money(r.ins.bhxh)} · BHYT ${money(r.ins.bhyt)} · BHTN ${money(r.ins.bhtn)}) · BH công ty: ${money(r.ins.co_total)}`),
        el('div', {}, `Giảm trừ: ${money(r.family)} · TN tính thuế: ${money(r.assessable)} · Thuế: `, el('b', {}, money(r.tax))),
        el('div', {}, 'Thực lĩnh (chưa tính khoản khác): ', el('b', {}, money(r.net))));
    } catch (e) { toast(e.message, 'err'); }
  }, 'ghost');
  page('Tiền lương', [save, reset], flagBox,
    el('div', { class: 'panel', style: 'padding:14px;margin-bottom:12px' }, el('h3', { style: 'margin-top:0' }, '🛡️ Mức lương & bảo hiểm'),
      row('Lương cơ sở', base, 'trần BHXH, BHYT = lương cơ sở × hệ số trần'),
      row('Vùng của công ty', region),
      el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin:6px 0' }, ...rmin.map((i, k) => el('label', {}, `Tối thiểu vùng ${['I', 'II', 'III', 'IV'][k]}`, i))),
      row('Hệ số trần BHXH/BHYT (× lương cơ sở)', siM), row('Hệ số trần BHTN (× tối thiểu vùng)', uiM),
      rateRow('NLĐ đóng (%)', er), rateRow('Công ty đóng (%)', cr),
      row('Đoàn phí công đoàn NLĐ (%)', uf, null), row('Đoàn phí tối đa (% lương cơ sở)', ufc),
      chkRow(skip14, 'Nghỉ không lương từ 14 ngày trở lên trong tháng → không đóng BH tháng đó')),
    el('div', { class: 'panel', style: 'padding:14px;margin-bottom:12px' }, el('h3', { style: 'margin-top:0' }, '🧾 Thuế TNCN'),
      row('Giảm trừ bản thân / tháng', selfD), row('Giảm trừ mỗi người phụ thuộc / tháng', depD),
      el('div', { style: 'font-weight:700;margin:8px 0 4px' }, 'Biểu thuế lũy tiến từng phần (tháng)'), brBox,
      row('Thuế suất khấu trừ thời vụ / CTV (%)', flatR), row('Chỉ khấu trừ khi trả từ', flatMin), row('Cách tính 10%', flatBase),
      chkRow(otEx, 'Phần tiền tăng ca cao hơn lương giờ bình thường được miễn thuế'),
      row('Làm tròn thực lĩnh', roundNet),
      small('Mặc định theo NQ 110/2025/UBTVQH15 (giảm trừ 15,5tr / 6,2tr) và biểu 5 bậc của Luật Thuế TNCN 2025 — kế toán nên đối chiếu văn bản gốc trước khi dùng.')),
    el('div', { class: 'panel', style: 'padding:14px' }, el('h3', { style: 'margin-top:0' }, '🧮 Tính thử'),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, el('span', {}, 'Lương (gross, đóng BH theo mức này)'), tg, el('span', {}, 'Người phụ thuộc'), tdp, calc), tout));
}
