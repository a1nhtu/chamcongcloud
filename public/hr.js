// PHÂN HỆ NHÂN SỰ (giao diện) — Hồ sơ nhân sự · Hợp đồng lao động · Thuyên chuyển & nghỉ việc.
// Nạp khi mở menu "Nhân sự" (admin.js gọi import('/hr.js')). Dùng chung khung trang / hộp thoại của admin.js qua ctx.
import { api, toast, el } from '/common.js';

let C = null;        // { head, setMain, openModal, closeModal, loading, hasPerm, go }
let META = null;     // danh mục từ /admin/hr/meta
let EMPS = [];       // danh sách NV (từ /admin/hr/profiles) cho ô chọn nhân viên

/* ---------- tiện ích ---------- */
const dmy = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');
const money = (n) => (n ? Number(n).toLocaleString('vi-VN') : '');
const typeLabel = (k) => (META.contract_types.find((t) => t[0] === k) || [k, k])[1];
const resignLabel = (k) => (META.resign_kinds.find((t) => t[0] === k) || [k, k])[1];
const CSTATUS_PILL = { hieu_luc: 'ok', sap_het_han: 'warn', het_han: 'bad', da_tai_ky: 'muted', cham_dut: 'muted', chua_hieu_luc: 'muted' };
const WSTATUS_PILL = { chinh_thuc: 'ok', thu_viec: 'warn', sap_nghi: 'warn', da_nghi: 'muted', chua_ro: 'muted' };
const DSTATUS = { pending: ['Chờ hiệu lực', 'warn'], applied: ['Đã áp dụng', 'ok'], cancelled: ['Đã huỷ', 'muted'] };
const pill = (txt, cls) => el('span', { class: 'pill ' + (cls || 'muted') }, txt);
function cpill(c) {
  if (!c) return pill('Chưa có HĐ', 'bad');
  let t = META.contract_status[c.status] || c.status;
  if ((c.status === 'sap_het_han' || c.status === 'hieu_luc') && c.days_left != null && c.days_left <= META.warn_days) t += ` · còn ${c.days_left} ngày`;
  return pill(t, CSTATUS_PILL[c.status]);
}
const small = (txt) => el('div', { style: 'font-size:12px;color:var(--muted)' }, txt);
const hint = (txt) => el('div', { class: 'fhint', style: 'font-size:12.5px;color:var(--muted);line-height:1.45' }, txt);
const box = (cls, items) => el('div', { style: `border-radius:10px;padding:10px 12px;font-size:13px;line-height:1.5;${cls === 'err' ? 'background:#fee2e2;color:#991b1b' : 'background:var(--warn-bg);color:var(--warn-ink)'}` },
  ...items.map((t) => el('div', {}, (cls === 'err' ? '⛔ ' : '⚠️ ') + t)));
function fld(label, node, extra) { return el('div', {}, el('label', {}, label), node, extra || null); }
function inp(value = '', attrs = {}) { return el('input', { value: value ?? '', ...attrs }); }
function dateInp(value = '') { return el('input', { type: 'date', value: value || '' }); }
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
function listInp(value, list, id) {   // ô nhập có gợi ý (datalist) — chọn sẵn hoặc gõ mới
  const dl = el('datalist', { id }, ...list.map((x) => el('option', { value: x })));
  const i = inp(value, { list: id, autocomplete: 'off' });
  return el('div', {}, i, dl);
}
const listVal = (wrap) => wrap.querySelector('input').value.trim();
async function download(path, name) {
  try {
    const res = await api(path, { raw: true });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Không tải được');
    const url = URL.createObjectURL(await res.blob());
    const a = el('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) { toast(e.message, 'err'); }
}
// Ô chọn nhân viên có ô lọc nhanh (công ty đông người)
function empPicker(value, { activeOnly = false, onChange } = {}) {
  const list = EMPS.filter((e) => !activeOnly || e.active);
  const q = inp('', { placeholder: '🔍 Gõ mã / tên để lọc…', style: 'margin-bottom:6px' });
  const s = el('select');
  const fill = () => {
    const t = q.value.trim().toLowerCase();
    const cur = s.value || String(value || '');
    s.innerHTML = '';
    s.append(el('option', { value: '' }, '— Chọn nhân viên —'));
    for (const e of list) {
      if (t && !`${e.code} ${e.full_name} ${e.department}`.toLowerCase().includes(t) && String(e.id) !== cur) continue;
      const o = el('option', { value: e.id }, `${e.code} — ${e.full_name}${e.department ? ' (' + e.department + ')' : ''}${e.active ? '' : ' · đã nghỉ'}`);
      if (String(e.id) === cur) o.selected = true;
      s.append(o);
    }
  };
  q.addEventListener('input', fill);
  s.addEventListener('change', () => onChange && onChange(+s.value || 0));
  fill();
  return { box: el('div', {}, q, s), value: () => +s.value || 0, select: s };
}
const empById = (id) => EMPS.find((e) => e.id === +id);

async function loadMeta() { META = await api('/admin/hr/meta'); return META; }
async function loadEmps() { const r = await api('/admin/hr/profiles'); EMPS = r.rows; return r; }

/* =====================================================================
 * 1. HỒ SƠ NHÂN SỰ
 * ===================================================================== */
let _pf = { q: '', dept: '', status: 'working' };
export async function pageHrProfiles(ctx) {
  C = ctx;
  C.setMain(C.loading());
  let data;
  try { await loadMeta(); data = await loadEmps(); } catch (e) { return C.setMain(el('div', { class: 'empty' }, e.message)); }
  const s = data.stats;
  const q = inp(_pf.q, { placeholder: '🔍 Mã, tên, SĐT, CCCD…', style: 'width:220px' });
  const depts = [...new Set(data.rows.map((r) => r.department).filter(Boolean))].sort();
  const dsel = sel([['', 'Tất cả bộ phận'], ...depts], _pf.dept);
  const ssel = sel([['working', 'Đang làm việc'], ['thu_viec', 'Thử việc'], ['chinh_thuc', 'Chính thức'], ['no_contract', 'Chưa có HĐ'],
    ['expiring', 'HĐ sắp hết hạn'], ['expired', 'HĐ hết hạn chưa tái ký'], ['sap_nghi', 'Sắp nghỉ việc'], ['da_nghi', 'Đã nghỉ việc'], ['all', 'Tất cả']], _pf.status);
  const xbtn = el('button', { class: 'btn ghost sm' }, '⬇ Xuất Excel');
  xbtn.onclick = () => download('/admin/hr/profiles/export.xlsx', 'ho_so_nhan_su.xlsx');
  const tools = [q, dsel, ssel, xbtn];
  if (C.hasPerm('employees')) { const add = el('button', { class: 'btn sm' }, '＋ Thêm hồ sơ'); add.onclick = addEmployeeForm; tools.push(add); }

  const card = (n, l, cls, st) => {
    const c = el('div', { class: 'mcard ' + cls, style: 'cursor:pointer' + (_pf.status === st ? ';outline:2px solid var(--brand)' : '') }, el('div', { class: 'n' }, String(n)), el('div', { class: 'l' }, l));
    c.onclick = () => { _pf.status = st; pageHrProfiles(C); };
    return c;
  };
  const cards = el('div', { class: 'cards' },
    card(s.working, 'Đang làm việc', 'brand', 'working'), card(s.probation, 'Thử việc', 'warn', 'thu_viec'), card(s.official, 'Chính thức', 'green', 'chinh_thuc'),
    card(s.no_contract, 'Chưa có hợp đồng', 'red', 'no_contract'), card(s.expiring, `HĐ sắp hết hạn (≤${data.warn_days} ngày)`, 'warn', 'expiring'),
    card(s.expired, 'HĐ hết hạn chưa tái ký', 'red', 'expired'), card(s.leaving, 'Sắp nghỉ việc', 'warn', 'sap_nghi'), card(s.resigned, 'Đã nghỉ việc', '', 'da_nghi'));

  const tbody = el('tbody');
  const count = el('span', { style: 'color:var(--muted);font-size:13px' });
  const match = (r) => {
    const st = _pf.status;
    if (st === 'working' && !r.active) return false;
    if (st === 'da_nghi' && r.active) return false;
    if (st === 'thu_viec' && !(r.active && r.status === 'thu_viec')) return false;
    if (st === 'chinh_thuc' && !(r.active && r.status === 'chinh_thuc')) return false;
    if (st === 'no_contract' && !(r.active && !r.contract)) return false;
    if (st === 'expiring' && !(r.active && r.watch && r.watch.status === 'sap_het_han')) return false;
    if (st === 'expired' && !(r.active && r.watch && r.watch.status === 'het_han')) return false;
    if (st === 'sap_nghi' && r.status !== 'sap_nghi') return false;
    if (_pf.dept && r.department !== _pf.dept) return false;
    const t = _pf.q.trim().toLowerCase();
    if (t && !`${r.code} ${r.full_name} ${r.phone} ${r.id_number} ${r.position}`.toLowerCase().includes(t)) return false;
    return true;
  };
  const render = () => {
    tbody.innerHTML = '';
    const rows = data.rows.filter(match);
    count.textContent = `${rows.length} hồ sơ`;
    if (!rows.length) { tbody.append(el('tr', {}, el('td', { colspan: 8, class: 'empty' }, 'Không có hồ sơ phù hợp'))); return; }
    for (const r of rows.slice(0, 1000)) {
      const open = el('button', { class: 'btn ghost sm' }, 'Hồ sơ');
      open.onclick = () => openProfile(r.id);
      const ct = r.contract;
      const watch = r.watch && r.watch.status === 'het_han' ? pill(`HĐ hết hạn ${dmy(r.watch.end_date)}`, 'bad') : null;
      const bar = el('div', { style: 'width:70px;height:6px;border-radius:4px;background:#eee;overflow:hidden' },
        el('div', { style: `height:100%;width:${r.complete}%;background:${r.complete >= 80 ? 'var(--green)' : r.complete >= 40 ? '#d97706' : 'var(--danger)'}` }));
      const tr = el('tr', { style: 'cursor:pointer' },
        el('td', {}, el('b', {}, r.code)),
        el('td', {}, el('div', { style: 'font-weight:600' }, r.full_name), small([r.gender, r.birth_date ? 'sinh ' + dmy(r.birth_date) : '', r.phone].filter(Boolean).join(' · '))),
        el('td', {}, r.department || '—', small(r.position || '')),
        el('td', {}, dmy(r.start_date) || '—'),
        el('td', {}, pill(r.status_label, WSTATUS_PILL[r.status])),
        el('td', {}, ct ? el('div', {}, el('div', { style: 'font-size:13px' }, ct.label), small(ct.end_date ? 'đến ' + dmy(ct.end_date) : 'không thời hạn')) : null, ct ? cpill(ct) : (r.active ? watch || cpill(null) : null)),
        el('td', {}, bar, small(r.complete + '%')),
        el('td', {}, open));
      tr.addEventListener('click', (ev) => { if (ev.target.tagName !== 'BUTTON') openProfile(r.id); });
      tbody.append(tr);
    }
  };
  q.addEventListener('input', () => { _pf.q = q.value; render(); });
  dsel.onchange = () => { _pf.dept = dsel.value; render(); };
  ssel.onchange = () => { _pf.status = ssel.value; pageHrProfiles(C); };
  render();
  C.setMain(C.head('📇 Hồ sơ nhân sự', ...tools), cards,
    el('div', { class: 'panel' }, el('div', { style: 'padding:10px 14px;border-bottom:1px solid var(--line)' }, count),
      el('div', { class: 'tbl-scroll' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, ...['Mã NV', 'Họ tên', 'Bộ phận / chức danh', 'Ngày vào làm', 'Trạng thái', 'Hợp đồng hiện tại', 'Hồ sơ đủ', ''].map((h) => el('th', {}, h)))), tbody))));
}

// Thêm nhân viên mới (tạo luôn tài khoản chấm công: tài khoản = mã NV, mật khẩu 123456) rồi mở hồ sơ
function addEmployeeForm() {
  const code = inp('', { placeholder: 'VD NV025' }), name = inp(''), phone = inp('');
  const dept = listInp('', META.departments, 'hr-dl-dept'), pos = listInp('', META.positions, 'hr-dl-pos');
  const start = dateInp(META.today);
  const save = el('button', { class: 'btn' }, 'Tạo hồ sơ');
  save.onclick = async () => {
    if (!code.value.trim() || !name.value.trim()) return toast('Nhập mã NV và họ tên', 'err');
    save.disabled = true;
    try {
      const r = await api('/admin/employees', { method: 'POST', body: { code: code.value.trim(), full_name: name.value.trim(), phone: phone.value.trim(),
        department: listVal(dept), position: listVal(pos), start_date: start.value, username: code.value.trim(), password: '123456', role: 'employee' } });
      C.closeModal(); toast('Đã tạo hồ sơ', 'ok'); await loadEmps(); openProfile(r.id);
    } catch (e) { toast(e.message, 'err'); save.disabled = false; }
  };
  C.openModal('＋ Thêm hồ sơ nhân viên', [
    el('div', { class: 'two-col' }, fld('Mã nhân viên *', code), fld('Họ và tên *', name)),
    el('div', { class: 'two-col' }, fld('Bộ phận', dept), fld('Chức danh', pos)),
    el('div', { class: 'two-col' }, fld('Số điện thoại', phone), fld('Ngày vào làm', start)),
    hint('Phần mềm tạo luôn tài khoản chấm công: tài khoản = mã NV, mật khẩu 123456 (nhắc nhân viên đổi sau). Sau khi tạo sẽ mở hồ sơ để khai báo đầy đủ và ký hợp đồng.'),
  ], [save]);
}

/* ---------- Hồ sơ chi tiết ---------- */
let _ptab = 'chung';
async function openProfile(id) {
  C.setMain(C.loading());
  let d;
  try { if (!META) await loadMeta(); if (!EMPS.length) await loadEmps(); d = await api('/admin/hr/profiles/' + id); }
  catch (e) { return C.setMain(el('div', { class: 'empty' }, e.message)); }
  const e = d.employee, p = d.profile || {};
  const row = empById(e.id) || {};
  const back = el('button', { class: 'btn ghost sm' }, '← Danh sách');
  back.onclick = () => pageHrProfiles(C);
  const bSign = el('button', { class: 'btn sm' }, '📄 Ký hợp đồng');
  bSign.onclick = () => contractForm({ employee_id: e.id, done: () => openProfile(e.id) });
  const bMove = el('button', { class: 'btn ghost sm' }, '🔀 Thuyên chuyển');
  bMove.onclick = () => decisionForm('transfer', { employee_id: e.id, done: () => openProfile(e.id) });
  const bQuit = el('button', { class: 'btn ghost sm' }, '🚪 Nghỉ việc');
  bQuit.onclick = () => decisionForm('resign', { employee_id: e.id, done: () => openProfile(e.id) });
  const tools = [back, bSign, bMove];
  if (e.active) tools.push(bQuit);

  const title = el('div', {},
    el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, el('span', {}, `📇 ${e.full_name}`), pill(row.status_label || (e.active ? 'Đang làm việc' : 'Đã nghỉ việc'), WSTATUS_PILL[row.status])),
    el('div', { style: 'font-size:13px;color:var(--muted);font-weight:500;margin-top:4px' }, [e.code, e.department, e.position].filter(Boolean).join(' · ')));

  // ô nhập của các nhóm trường hồ sơ (lưu 1 lần cho tất cả nhóm)
  const inputs = {};
  const mkInput = ([k, , type, , opts]) => {
    const v = p[k] || '';
    if (type === 'select') return sel([['', '—'], ...opts], v);
    if (type === 'date') return dateInp(v);
    if (type === 'textarea') return el('textarea', { rows: 2 }, v);
    if (type === 'employee') return sel([['', '— Không —'], ...EMPS.filter((x) => x.active && x.id !== e.id).map((x) => [x.id, `${x.code} — ${x.full_name}`])], v);
    return inp(v);
  };
  const base = { full_name: inp(e.full_name), phone: inp(e.phone || ''), start_date: dateInp(e.start_date) };
  const grid = (...nodes) => el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px' }, ...nodes);
  const groupPane = (g) => {
    const nodes = [];
    if (g === 'chung') nodes.push(fld('Mã nhân viên', inp(e.code, { disabled: '' })), fld('Họ và tên', base.full_name));
    if (g === 'lienhe') nodes.push(fld('Số điện thoại', base.phone));
    if (g === 'congviec') {
      nodes.push(fld('Bộ phận', inp(e.department || '', { disabled: '' }), small('Đổi qua 🔀 Thuyên chuyển')),
        fld('Chức danh', inp(e.position || '', { disabled: '' }), small('Đổi qua 🔀 Thuyên chuyển')), fld('Ngày vào làm', base.start_date));
      if (e.leave_date) nodes.push(fld('Ngày nghỉ việc', inp(dmy(e.leave_date), { disabled: '' })));
    }
    for (const f of META.fields.filter((x) => x[3] === g)) { inputs[f[0]] = mkInput(f); nodes.push(fld(f[1], inputs[f[0]])); }
    return grid(...nodes);
  };
  const saveBtn = el('button', { class: 'btn' }, '💾 Lưu hồ sơ');
  saveBtn.onclick = async () => {
    const body = { full_name: base.full_name.value, phone: base.phone.value, start_date: base.start_date.value };
    for (const [k, node] of Object.entries(inputs)) body[k] = node.value;
    saveBtn.disabled = true;
    try { await api('/admin/hr/profiles/' + e.id, { method: 'PUT', body }); toast('Đã lưu hồ sơ', 'ok'); await loadEmps(); openProfile(e.id); }
    catch (err) { toast(err.message, 'err'); saveBtn.disabled = false; }
  };

  const TABS = [...META.groups, ['family', `Người thân (${d.family.length})`], ['docs', `Giấy tờ (${d.documents.length})`],
    ['contracts', `Hợp đồng (${d.contracts.length})`], ['history', 'Quá trình công tác']];
  const bar = el('div', { class: 'tab-bar' });
  const panes = {};
  const show = (k) => { _ptab = k; for (const [kk, pane] of Object.entries(panes)) pane.style.display = kk === k ? 'flex' : 'none'; bar.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('on', b.dataset.k === k)); };
  for (const [k, label] of TABS) {
    const b = el('button', { class: 'tab-btn', 'data-k': k, type: 'button' }, label);
    b.onclick = () => show(k);
    bar.append(b);
    let content;
    if (META.groups.some((g) => g[0] === k)) content = [groupPane(k), el('div', {}, saveBtn)];
    else if (k === 'family') content = familyPane(e, d.family);
    else if (k === 'docs') content = docsPane(e, d.documents);
    else if (k === 'contracts') content = [contractsTable(d.contracts, { inProfile: true, done: () => openProfile(e.id) }), el('div', {}, (() => { const b2 = el('button', { class: 'btn sm' }, '＋ Ký hợp đồng mới'); b2.onclick = () => bSign.onclick(); return b2; })())];
    else content = historyPane(d);
    panes[k] = el('div', { class: 'tab-pane', style: 'padding:16px;gap:14px' }, ...[].concat(content));
  }
  // Lưu ở tab trường hồ sơ khác cũng dùng chung nút → mỗi tab nhóm có nút riêng trỏ cùng hàm
  for (const [k] of META.groups) { if (panes[k] && !panes[k].contains(saveBtn)) { const b = el('button', { class: 'btn' }, '💾 Lưu hồ sơ'); b.onclick = () => saveBtn.onclick(); panes[k].append(el('div', {}, b)); } }
  C.setMain(C.head(title, ...tools), el('div', { class: 'panel' }, el('div', { style: 'padding:0 12px' }, bar), ...Object.values(panes)));
  show(panes[_ptab] ? _ptab : 'chung');
}

function familyPane(e, family) {
  const tbody = el('tbody');
  for (const f of family) {
    const ed = el('button', { class: 'btn ghost sm' }, 'Sửa'); ed.onclick = () => familyForm(e, f);
    const del = el('button', { class: 'btn ghost sm' }, 'Xoá');
    del.onclick = async () => { if (!confirm(`Xoá "${f.full_name}"?`)) return; try { await api('/admin/hr/family/' + f.id, { method: 'DELETE' }); openProfile(e.id); } catch (x) { toast(x.message, 'err'); } };
    tbody.append(el('tr', {}, el('td', {}, el('b', {}, f.full_name)), el('td', {}, f.relation), el('td', {}, f.birth_date), el('td', {}, f.phone), el('td', {}, f.job),
      el('td', {}, f.dependent ? pill('Người phụ thuộc', 'ok') : ''), el('td', {}, f.note), el('td', { style: 'white-space:nowrap' }, ed, ' ', del)));
  }
  if (!family.length) tbody.append(el('tr', {}, el('td', { colspan: 8, class: 'empty' }, 'Chưa khai báo người thân')));
  const add = el('button', { class: 'btn sm' }, '＋ Thêm người thân'); add.onclick = () => familyForm(e, null);
  return [el('div', { class: 'tbl-scroll' }, el('table', { class: 'data' }, el('thead', {}, el('tr', {}, ...['Họ tên', 'Quan hệ', 'Năm / ngày sinh', 'SĐT', 'Nghề nghiệp', 'Giảm trừ thuế', 'Ghi chú', ''].map((h) => el('th', {}, h)))), tbody)),
    el('div', {}, add), hint('Đánh dấu "Người phụ thuộc" cho người được đăng ký giảm trừ gia cảnh khi tính thuế TNCN.')];
}
function familyForm(e, f) {
  f = f || {};
  const name = inp(f.full_name), rel = sel([['', '—'], 'Bố', 'Mẹ', 'Vợ', 'Chồng', 'Con', 'Anh / chị / em', 'Khác'], f.relation), birth = inp(f.birth_date, { placeholder: 'VD 1965 hoặc 12/05/2015' });
  const phone = inp(f.phone), job = inp(f.job), note = inp(f.note);
  const dep = el('input', { type: 'checkbox', style: 'width:auto', ...(f.dependent ? { checked: '' } : {}) });
  const save = el('button', { class: 'btn' }, 'Lưu');
  save.onclick = async () => {
    const body = { full_name: name.value, relation: rel.value, birth_date: birth.value, phone: phone.value, job: job.value, note: note.value, dependent: dep.checked };
    try { await api(f.id ? '/admin/hr/family/' + f.id : `/admin/hr/profiles/${e.id}/family`, { method: f.id ? 'PUT' : 'POST', body }); C.closeModal(); openProfile(e.id); }
    catch (x) { toast(x.message, 'err'); }
  };
  C.openModal(f.id ? 'Sửa người thân' : 'Thêm người thân', [
    el('div', { class: 'two-col' }, fld('Họ và tên *', name), fld('Quan hệ', rel)),
    el('div', { class: 'two-col' }, fld('Năm / ngày sinh', birth), fld('Số điện thoại', phone)),
    el('div', { class: 'two-col' }, fld('Nghề nghiệp', job), fld('Ghi chú', note)),
    el('label', { style: 'display:flex;gap:8px;align-items:center' }, dep, 'Là người phụ thuộc (giảm trừ gia cảnh)'),
  ], [save]);
}

function docsPane(e, docs) {
  const tbody = el('tbody');
  for (const x of docs) {
    const view = el('button', { class: 'btn ghost sm' }, 'Xem');
    view.onclick = async () => {
      try {
        const res = await api(`/admin/hr/documents/${x.id}/file`, { raw: true });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Không mở được file');
        const url = URL.createObjectURL(await res.blob());
        const w = window.open(url, '_blank');
        if (!w) { const a = el('a', { href: url, download: x.orig_name || 'file' }); document.body.append(a); a.click(); a.remove(); }
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (err) { toast(err.message, 'err'); }
    };
    const del = el('button', { class: 'btn ghost sm' }, 'Xoá');
    del.onclick = async () => { if (!confirm(`Xoá giấy tờ "${x.title}"?`)) return; try { await api('/admin/hr/documents/' + x.id, { method: 'DELETE' }); openProfile(e.id); } catch (err) { toast(err.message, 'err'); } };
    tbody.append(el('tr', {}, el('td', {}, x.kind || '—'), el('td', {}, el('b', {}, x.title), small(x.orig_name)), el('td', {}, Math.max(1, Math.round(x.size / 1024)) + ' KB'),
      el('td', {}, x.uploaded_by, small(x.uploaded_at)), el('td', { style: 'white-space:nowrap' }, view, ' ', del)));
  }
  if (!docs.length) tbody.append(el('tr', {}, el('td', { colspan: 5, class: 'empty' }, 'Chưa có giấy tờ')));
  const kind = sel(META.doc_kinds, META.doc_kinds[0], { style: 'width:auto' });
  const title = inp('', { placeholder: 'Tên giấy tờ (để trống = tên file)', style: 'width:240px' });
  const file = el('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx', style: 'width:auto' });
  const up = el('button', { class: 'btn sm' }, '⬆ Tải lên');
  up.onclick = () => {
    const f = file.files[0];
    if (!f) return toast('Chọn file', 'err');
    if (f.size > 4 * 1024 * 1024) return toast('File quá lớn (tối đa 4MB)', 'err');
    const rd = new FileReader();
    rd.onload = async () => {
      up.disabled = true;
      try { await api(`/admin/hr/profiles/${e.id}/documents`, { method: 'POST', body: { kind: kind.value, title: title.value, fileName: f.name, fileBase64: rd.result } }); toast('Đã tải lên', 'ok'); _ptab = 'docs'; openProfile(e.id); }
      catch (err) { toast(err.message, 'err'); up.disabled = false; }
    };
    rd.readAsDataURL(f);
  };
  return [el('div', { class: 'tbl-scroll' }, el('table', { class: 'data' }, el('thead', {}, el('tr', {}, ...['Loại', 'Giấy tờ', 'Dung lượng', 'Người tải / lúc', ''].map((h) => el('th', {}, h)))), tbody)),
    el('div', { class: 'toolbar' }, kind, title, file, up),
    hint('Nhận PDF, ảnh, Word, Excel (tối đa 4MB/file). Giấy tờ chỉ người có quyền Nhân sự mới mở được; có trong bản "Sao lưu toàn bộ".')];
}

function historyPane(d) {
  const ICON = { join: '🟢', contract: '📄', annex: '📝', end: '⛔', transfer: '🔀', resign: '🚪' };
  if (!d.history.length) return [el('div', { class: 'empty' }, 'Chưa có quá trình công tác')];
  const list = el('div', { style: 'display:flex;flex-direction:column;gap:0;border-left:2px solid var(--line);margin-left:8px' },
    ...d.history.map((h) => el('div', { style: 'display:flex;gap:10px;padding:8px 0 8px 14px;position:relative' },
      el('span', { style: 'position:absolute;left:-11px;top:8px;background:#fff' }, ICON[h.kind] || '•'),
      el('b', { style: 'min-width:92px;font-size:13px' }, dmy(h.date) || '—'), el('span', { style: 'font-size:13.5px' }, h.text))));
  return [list, hint('Tự tổng hợp từ ngày vào làm, các hợp đồng / phụ lục và quyết định thuyên chuyển, nghỉ việc.')];
}

/* =====================================================================
 * 2. HỢP ĐỒNG LAO ĐỘNG
 * ===================================================================== */
let _cf = { q: '', type: '', status: '' };
export async function pageHrContracts(ctx) {
  C = ctx;
  C.setMain(C.loading());
  let data;
  try { await loadMeta(); await loadEmps(); data = await api('/admin/hr/contracts'); } catch (e) { return C.setMain(el('div', { class: 'empty' }, e.message)); }
  const rows = data.rows;
  const cnt = (st) => rows.filter((c) => c.status === st && (st !== 'het_han' || c.emp_active)).length;
  const q = inp(_cf.q, { placeholder: '🔍 Số HĐ, mã, tên NV…', style: 'width:200px' });
  const tsel = sel([['', 'Tất cả loại HĐ'], ...META.contract_types], _cf.type);
  const ssel = sel([['', 'Tất cả trạng thái'], ...Object.entries(META.contract_status)], _cf.status);
  const wd = inp(String(data.warn_days), { type: 'number', min: 1, max: 365, style: 'width:70px' });
  const wdSave = el('button', { class: 'btn ghost sm' }, 'Lưu');
  wdSave.onclick = async () => { try { await api('/admin/hr/settings', { method: 'PUT', body: { warn_days: +wd.value } }); toast('Đã lưu', 'ok'); pageHrContracts(C); } catch (e) { toast(e.message, 'err'); } };
  const xbtn = el('button', { class: 'btn ghost sm' }, '⬇ Xuất Excel');
  xbtn.onclick = () => download('/admin/hr/contracts/export.xlsx', 'hop_dong_lao_dong.xlsx');
  const add = el('button', { class: 'btn sm' }, '＋ Ký hợp đồng');
  add.onclick = () => contractForm({ done: () => pageHrContracts(C) });

  const card = (n, l, cls, st) => {
    const c = el('div', { class: 'mcard ' + cls, style: 'cursor:pointer' + (_cf.status === st ? ';outline:2px solid var(--brand)' : '') }, el('div', { class: 'n' }, String(n)), el('div', { class: 'l' }, l));
    c.onclick = () => { _cf.status = _cf.status === st ? '' : st; pageHrContracts(C); };
    return c;
  };
  const cards = el('div', { class: 'cards' }, card(cnt('hieu_luc'), 'Còn hiệu lực', 'green', 'hieu_luc'), card(cnt('sap_het_han'), `Sắp hết hạn (≤${data.warn_days} ngày)`, 'warn', 'sap_het_han'),
    card(cnt('het_han'), 'Hết hạn chưa tái ký', 'red', 'het_han'), card(cnt('cham_dut'), 'Đã chấm dứt', '', 'cham_dut'));
  const alerts = rows.filter((c) => c.alerts.length);
  const alertBox = alerts.length ? box('warn', alerts.map((c) => `${c.emp_name} (${c.emp_code}) — HĐ ${c.contract_no || '#' + c.id}: ${c.alerts.join(' ')}`)) : null;

  const wrap = el('div');
  const render = () => {
    const t = _cf.q.trim().toLowerCase();
    let list = rows.filter((c) => (!_cf.type || c.ctype === _cf.type) && (!_cf.status || c.status === _cf.status)
      && (!t || `${c.contract_no} ${c.emp_code} ${c.emp_name} ${c.department}`.toLowerCase().includes(t)));
    if (_cf.status === 'sap_het_han' || _cf.status === 'het_han') list = list.slice().sort((a, b) => (a.end_date > b.end_date ? 1 : -1));
    wrap.innerHTML = '';
    wrap.append(contractsTable(list, { done: () => pageHrContracts(C) }));
  };
  q.addEventListener('input', () => { _cf.q = q.value; render(); });
  tsel.onchange = () => { _cf.type = tsel.value; render(); };
  ssel.onchange = () => { _cf.status = ssel.value; pageHrContracts(C); };
  render();
  C.setMain(C.head('📄 Hợp đồng lao động', q, tsel, ssel, el('span', { style: 'font-size:13px;color:var(--muted)' }, 'Cảnh báo trước'), wd, el('span', { style: 'font-size:13px;color:var(--muted)' }, 'ngày'), wdSave, xbtn, add),
    cards, alertBox, el('div', { class: 'panel' }, wrap));
}

// Bảng hợp đồng (dùng cho trang Hợp đồng và tab Hợp đồng trong hồ sơ)
function contractsTable(list, { inProfile = false, done } = {}) {
  const tbody = el('tbody');
  for (const c of list) {
    const acts = el('div', { style: 'display:flex;gap:4px;flex-wrap:wrap' });
    const b = (txt, fn, title) => { const x = el('button', { class: 'btn ghost sm', title: title || '' }, txt); x.onclick = (ev) => { ev.stopPropagation(); fn(); }; acts.append(x); };
    b('Sửa', () => contractForm({ contract: c, done }));
    if (!c.terminated_date) {
      b('Tái ký', () => contractForm({ renewFrom: c, done }), 'Ký hợp đồng mới nối tiếp (nhân bản hợp đồng này)');
      b('Phụ lục', () => annexForm(c, done), 'Điều chỉnh lương / chức danh / điều khoản');
      b('Chấm dứt', () => terminateForm(c, done));
    } else b('Bỏ chấm dứt', async () => { if (!confirm('Bỏ trạng thái chấm dứt của hợp đồng này?')) return; try { await api(`/admin/hr/contracts/${c.id}/terminate`, { method: 'POST', body: { undo: true } }); done(); } catch (e) { toast(e.message, 'err'); } });
    b('Xoá', async () => { if (!confirm(`Xoá hợp đồng ${c.contract_no || '#' + c.id} của ${c.emp_name}? (chỉ xoá khi nhập nhầm)`)) return; try { await api('/admin/hr/contracts/' + c.id, { method: 'DELETE' }); toast('Đã xoá', 'ok'); done(); } catch (e) { toast(e.message, 'err'); } });
    const salaryChanged = c.eff.salary !== c.salary;
    tbody.append(el('tr', {},
      el('td', {}, el('b', {}, c.contract_no || '—'), c.parent_id ? small('tái ký') : null),
      inProfile ? null : el('td', {}, el('div', { style: 'font-weight:600' }, c.emp_name), small(`${c.emp_code} · ${c.department || c.emp_department || ''}`)),
      el('td', {}, typeLabel(c.ctype), small(c.eff.position || '')),
      el('td', {}, dmy(c.start_date), c.sign_date ? small('ký ' + dmy(c.sign_date)) : null),
      el('td', {}, c.end_date ? dmy(c.end_date) : 'Không thời hạn', c.terminated_date ? small('chấm dứt từ ' + dmy(c.terminated_date)) : null),
      el('td', {}, money(c.eff.salary) || '—', salaryChanged ? small('theo phụ lục') : null, c.annexes.length ? small(c.annexes.length + ' phụ lục') : null),
      el('td', {}, cpill(c), c.alerts.length ? el('div', { style: 'color:var(--danger);font-size:12px;margin-top:3px' }, '⚠ quá hạn 30 ngày') : null),
      el('td', {}, acts)));
  }
  if (!list.length) tbody.append(el('tr', {}, el('td', { colspan: 8, class: 'empty' }, 'Chưa có hợp đồng')));
  const heads = ['Số HĐ', inProfile ? null : 'Nhân viên', 'Loại HĐ', 'Hiệu lực từ', 'Đến ngày', 'Lương', 'Trạng thái', 'Thao tác'].filter(Boolean);
  return el('div', { class: 'tbl-scroll' }, el('table', { class: 'data' }, el('thead', {}, el('tr', {}, ...heads.map((h) => el('th', {}, h)))), tbody));
}

// Ngày hết hạn = ngày bắt đầu + n tháng − 1 ngày (giống server/hr-rules.js)
function endDate(start, months) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !(months > 0)) return '';
  const d = new Date(start + 'T00:00:00Z'); const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  if (day > last) d.setUTCDate(last); else d.setUTCDate(day - 1);
  return d.toISOString().slice(0, 10);
}
const addDay = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Form ký mới / sửa / tái ký hợp đồng
function contractForm({ employee_id, contract, renewFrom, done }) {
  const src = contract || renewFrom || {};
  const isEdit = !!contract;
  let ctype = src.ctype || 'thu_viec', months = src.term_months || 0, start = src.start_date || META.today, end = src.end_date || '';
  if (renewFrom) {
    // gợi ý khi tái ký: thử việc → XĐTH 12 tháng; XĐTH → XĐTH cùng thời hạn (máy chủ cảnh báo nếu đã ký đủ 2 lần XĐTH)
    ctype = renewFrom.ctype === 'thu_viec' ? 'xac_dinh' : renewFrom.ctype;
    months = ctype === 'xac_dinh' ? (renewFrom.ctype === 'xac_dinh' && renewFrom.term_months ? renewFrom.term_months : 12) : 0;
    start = renewFrom.end_date ? addDay(renewFrom.end_date, 1) : META.today;
    end = ctype === 'xac_dinh' ? endDate(start, months) : '';
  }
  const empId = employee_id || src.employee_id;
  const picker = empId ? null : empPicker(0, { activeOnly: true, onChange: (id) => { const x = empById(id); if (x) { dept.querySelector('input').value = x.department || ''; pos.querySelector('input').value = x.position || ''; } check(); } });
  const emp = empId ? empById(empId) : null;
  const no = inp(isEdit ? src.contract_no : '', { placeholder: 'VD 15/2026/HĐLĐ' });
  const type = sel(META.contract_types, ctype);
  const term = sel([['0', '— tự nhập ngày —'], ['1', '1 tháng'], ['2', '2 tháng'], ['3', '3 tháng'], ['6', '6 tháng'], ['12', '12 tháng'], ['24', '24 tháng'], ['36', '36 tháng']], String(months));
  const sign = dateInp(isEdit ? src.sign_date : (renewFrom ? start : META.today));
  const st = dateInp(start), en = dateInp(end);
  const dept = listInp(src.department || emp?.department || '', META.departments, 'hr-c-dept');
  const pos = listInp((renewFrom ? renewFrom.eff?.position : src.position) || emp?.position || '', META.positions, 'hr-c-pos');
  const place = inp(src.work_place || '');
  const salary = inp(money(renewFrom ? renewFrom.eff?.salary : src.salary), { inputmode: 'numeric', placeholder: 'VD 8.000.000' });
  const ins = inp(money(src.insurance_salary), { inputmode: 'numeric' });
  const allow = inp(src.allowance || '', { placeholder: 'VD ăn trưa 730.000đ, xăng xe 500.000đ' });
  const signer = inp(src.signer || '');
  const note = el('textarea', { rows: 2 }, isEdit ? src.note || '' : '');
  for (const m of [salary, ins]) m.addEventListener('input', () => { const n = m.value.replace(/\D/g, ''); m.value = n ? Number(n).toLocaleString('vi-VN') : ''; });
  const termWrap = fld('Thời hạn', term);
  const msg = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  const syncType = () => {
    const t = type.value;
    termWrap.style.display = t === 'khong_xac_dinh' ? 'none' : '';
    en.disabled = t === 'khong_xac_dinh';
    if (t === 'khong_xac_dinh') en.value = '';
  };
  const syncEnd = () => { const m = +term.value; if (m && type.value !== 'khong_xac_dinh') en.value = endDate(st.value, m); };
  let _t;
  const check = () => {
    clearTimeout(_t);
    _t = setTimeout(async () => {
      const eid = empId || (picker && picker.value());
      try {
        const r = await api('/admin/hr/contracts/check', { method: 'POST', body: { ...body(), employee_id: eid, id: isEdit ? src.id : 0 } });
        msg.innerHTML = '';
        if (r.errors.length) msg.append(box('err', r.errors));
        if (r.warnings.length) msg.append(box('warn', r.warnings));
      } catch {}
    }, 250);
  };
  type.onchange = () => { syncType(); if (type.value === 'xac_dinh' && !+term.value) term.value = '12'; if (type.value === 'thu_viec' && !+term.value) term.value = '2'; syncEnd(); check(); };
  term.onchange = () => { syncEnd(); check(); };
  st.onchange = () => { syncEnd(); check(); };
  en.onchange = () => { term.value = '0'; check(); };
  const body = () => ({ contract_no: no.value, ctype: type.value, term_months: +term.value, sign_date: sign.value, start_date: st.value, end_date: en.value,
    department: listVal(dept), position: listVal(pos), work_place: place.value, salary: salary.value, insurance_salary: ins.value, allowance: allow.value,
    signer: signer.value, note: note.value, parent_id: renewFrom ? renewFrom.id : undefined });
  const save = el('button', { class: 'btn' }, isEdit ? 'Lưu hợp đồng' : renewFrom ? 'Tái ký' : 'Ký hợp đồng');
  save.onclick = async () => {
    const eid = empId || (picker && picker.value());
    if (!eid) return toast('Chọn nhân viên', 'err');
    save.disabled = true;
    try {
      const r = await api(isEdit ? '/admin/hr/contracts/' + src.id : '/admin/hr/contracts', { method: isEdit ? 'PUT' : 'POST', body: { ...body(), employee_id: eid } });
      C.closeModal();
      toast(r.warnings && r.warnings.length ? 'Đã lưu — lưu ý: ' + r.warnings[0].slice(0, 120) + '…' : 'Đã lưu hợp đồng', r.warnings && r.warnings.length ? '' : 'ok');
      done && done();
    } catch (e) { toast(e.message, 'err'); save.disabled = false; }
  };
  syncType();
  if (renewFrom) syncEnd();
  const who = emp ? el('div', { style: 'font-weight:600' }, `${emp.code} — ${emp.full_name}`) : picker.box;
  C.openModal(isEdit ? 'Sửa hợp đồng' : renewFrom ? `Tái ký hợp đồng ${renewFrom.contract_no || ''}` : '📄 Ký hợp đồng lao động', [
    fld('Nhân viên', who),
    el('div', { class: 'two-col' }, fld('Số hợp đồng', no), fld('Loại hợp đồng', type)),
    el('div', { class: 'two-col' }, termWrap, fld('Ngày ký', sign)),
    el('div', { class: 'two-col' }, fld('Hiệu lực từ ngày *', st), fld('Đến ngày', en)),
    el('div', { class: 'two-col' }, fld('Bộ phận', dept), fld('Chức danh', pos)),
    el('div', { class: 'two-col' }, fld('Lương thoả thuận (đ/tháng)', salary), fld('Lương đóng BHXH', ins)),
    fld('Phụ cấp', allow),
    el('div', { class: 'two-col' }, fld('Nơi làm việc', place), fld('Người đại diện ký', signer)),
    fld('Ghi chú', note), msg,
    renewFrom ? hint('Tái ký = nhân bản hợp đồng cũ, ngày hiệu lực nối tiếp ngày hết hạn cũ. Theo BLLĐ 2019, HĐ xác định thời hạn chỉ ký thêm 1 lần, lần sau phải là HĐ không xác định thời hạn — phần mềm sẽ cảnh báo.') : null,
  ].filter(Boolean), [save]);
  document.getElementById('modal').style.maxWidth = '720px';
  check();
}

function annexForm(c, done) {
  const list = el('div', { style: 'display:flex;flex-direction:column;gap:6px' });
  for (const a of c.annexes) {
    const del = el('button', { class: 'btn ghost sm' }, 'Xoá');
    del.onclick = async () => { if (!confirm('Xoá phụ lục này?')) return; try { await api('/admin/hr/annexes/' + a.id, { method: 'DELETE' }); C.closeModal(); done && done(); } catch (e) { toast(e.message, 'err'); } };
    list.append(el('div', { style: 'display:flex;gap:8px;align-items:center;border:1px solid var(--line);border-radius:10px;padding:8px 10px;font-size:13px' },
      el('div', { style: 'flex:1' }, el('b', {}, `Phụ lục ${a.annex_no || ''} · hiệu lực ${dmy(a.effective_date)}`),
        small([a.salary ? 'Lương mới ' + money(a.salary) + 'đ' : '', a.position ? 'Chức danh: ' + a.position : '', a.content].filter(Boolean).join(' · '))), del));
  }
  const no = inp('', { placeholder: 'VD 01/PLHĐ' }), sign = dateInp(META.today), eff = dateInp(META.today);
  const salary = inp('', { inputmode: 'numeric', placeholder: 'để trống = không đổi' });
  salary.addEventListener('input', () => { const n = salary.value.replace(/\D/g, ''); salary.value = n ? Number(n).toLocaleString('vi-VN') : ''; });
  const pos = listInp('', META.positions, 'hr-a-pos');
  const content = el('textarea', { rows: 3, placeholder: 'Nội dung điều chỉnh, bổ sung…' });
  const save = el('button', { class: 'btn' }, 'Thêm phụ lục');
  save.onclick = async () => {
    try { await api(`/admin/hr/contracts/${c.id}/annexes`, { method: 'POST', body: { annex_no: no.value, sign_date: sign.value, effective_date: eff.value, salary: salary.value, position: listVal(pos), content: content.value } }); C.closeModal(); toast('Đã thêm phụ lục', 'ok'); done && done(); }
    catch (e) { toast(e.message, 'err'); }
  };
  C.openModal(`📝 Phụ lục hợp đồng ${c.contract_no || '#' + c.id} — ${c.emp_name}`, [
    c.annexes.length ? list : null,
    el('div', { class: 'two-col' }, fld('Số phụ lục', no), fld('Ngày ký', sign)),
    el('div', { class: 'two-col' }, fld('Ngày hiệu lực *', eff), fld('Lương mới (đ/tháng)', salary)),
    fld('Chức danh mới', pos), fld('Nội dung', content),
    hint('Phụ lục chỉ sửa đổi, bổ sung điều khoản (lương, chức danh, phụ cấp…), KHÔNG được sửa thời hạn hợp đồng (khoản 2 Điều 22 BLLĐ 2019). Muốn kéo dài thời hạn → dùng "Tái ký". Đổi chức danh ở phụ lục không tự đổi chức danh trên hồ sơ — dùng 🔀 Thuyên chuyển nếu cần.'),
  ].filter(Boolean), [save]);
}

function terminateForm(c, done) {
  const date = dateInp(META.today);
  const reason = sel(['Hết hạn hợp đồng', 'Nhân viên xin nghỉ', 'Hai bên thoả thuận', 'Ký hợp đồng mới thay thế', 'Công ty đơn phương chấm dứt', 'Sa thải', 'Khác'], 'Hết hạn hợp đồng');
  const more = inp('', { placeholder: 'Ghi thêm (không bắt buộc)' });
  const save = el('button', { class: 'btn danger' }, 'Chấm dứt hợp đồng');
  save.onclick = async () => {
    try { await api(`/admin/hr/contracts/${c.id}/terminate`, { method: 'POST', body: { date: date.value, reason: [reason.value, more.value].filter(Boolean).join(' — ') } }); C.closeModal(); toast('Đã chấm dứt hợp đồng', 'ok'); done && done(); }
    catch (e) { toast(e.message, 'err'); }
  };
  C.openModal(`⛔ Chấm dứt hợp đồng ${c.contract_no || '#' + c.id}`, [
    el('div', {}, el('b', {}, c.emp_name), small(`${typeLabel(c.ctype)} · ${dmy(c.start_date)} → ${c.end_date ? dmy(c.end_date) : 'không thời hạn'}`)),
    el('div', { class: 'two-col' }, fld('Chấm dứt kể từ ngày', date), fld('Lý do', reason)), more,
    hint('Chỉ chấm dứt hợp đồng, KHÔNG khoá tài khoản chấm công. Nếu nhân viên nghỉ hẳn → lập quyết định 🚪 Nghỉ việc (tự chấm dứt hợp đồng và khoá tài khoản đúng ngày).'),
  ], [save]);
}

/* =====================================================================
 * 3. THUYÊN CHUYỂN & NGHỈ VIỆC
 * ===================================================================== */
let _df = { kind: 'transfer', status: '', q: '' };
export async function pageHrDecisions(ctx) {
  C = ctx;
  C.setMain(C.loading());
  let data;
  try { await loadMeta(); await loadEmps(); data = await api('/admin/hr/decisions'); } catch (e) { return C.setMain(el('div', { class: 'empty' }, e.message)); }
  const q = inp(_df.q, { placeholder: '🔍 Số QĐ, mã, tên NV…', style: 'width:200px' });
  const ssel = sel([['', 'Tất cả trạng thái'], ['pending', 'Chờ hiệu lực'], ['applied', 'Đã áp dụng'], ['cancelled', 'Đã huỷ']], _df.status);
  const addT = el('button', { class: 'btn sm' + (_df.kind === 'transfer' ? '' : ' ghost') }, '＋ Thuyên chuyển');
  addT.onclick = () => decisionForm('transfer', { done: () => { _df.kind = 'transfer'; pageHrDecisions(C); } });
  const addR = el('button', { class: 'btn sm' + (_df.kind === 'resign' ? '' : ' ghost') }, '＋ Nghỉ việc');
  addR.onclick = () => decisionForm('resign', { done: () => { _df.kind = 'resign'; pageHrDecisions(C); } });
  const bar = el('div', { class: 'tab-bar' });
  for (const [k, label] of [['transfer', `🔀 Thuyên chuyển (${data.rows.filter((d) => d.kind === 'transfer').length})`], ['resign', `🚪 Nghỉ việc (${data.rows.filter((d) => d.kind === 'resign').length})`]]) {
    const b = el('button', { class: 'tab-btn' + (_df.kind === k ? ' on' : ''), type: 'button' }, label);
    b.onclick = () => { _df.kind = k; pageHrDecisions(C); };
    bar.append(b);
  }
  const pendingN = data.rows.filter((d) => d.status === 'pending').length;
  const wrap = el('div');
  const render = () => {
    const t = _df.q.trim().toLowerCase();
    const list = data.rows.filter((d) => d.kind === _df.kind && (!_df.status || d.status === _df.status)
      && (!t || `${d.decision_no} ${d.emp_code} ${d.emp_name}`.toLowerCase().includes(t)));
    wrap.innerHTML = '';
    wrap.append(decisionsTable(list, _df.kind, () => pageHrDecisions(C)));
  };
  q.addEventListener('input', () => { _df.q = q.value; render(); });
  ssel.onchange = () => { _df.status = ssel.value; render(); };
  render();
  C.setMain(C.head('🔀 Thuyên chuyển & nghỉ việc', q, ssel, addT, addR),
    pendingN ? hint(`Có ${pendingN} quyết định chờ hiệu lực — đến ngày hiệu lực phần mềm TỰ áp dụng (đổi bộ phận / chức danh, hoặc cho nghỉ việc: khoá tài khoản chấm công + chấm dứt hợp đồng). Bảng công, báo cáo, bảng lương vẫn giữ đủ công tháng cuối của người nghỉ.`) : null,
    el('div', { class: 'panel' }, el('div', { style: 'padding:0 12px' }, bar), wrap));
}

function decisionsTable(list, kind, done) {
  const tbody = el('tbody');
  for (const d of list) {
    const acts = el('div', { style: 'display:flex;gap:4px;flex-wrap:wrap' });
    const b = (txt, fn) => { const x = el('button', { class: 'btn ghost sm' }, txt); x.onclick = fn; acts.append(x); };
    b(d.status === 'applied' ? (kind === 'resign' ? 'Bàn giao / sửa' : 'Sửa') : 'Sửa', () => decisionForm(kind, { decision: d, done }));
    if (d.status === 'pending') b('Huỷ', async () => { if (!confirm('Huỷ quyết định này (chưa tới ngày hiệu lực)?')) return; try { await api(`/admin/hr/decisions/${d.id}/cancel`, { method: 'POST' }); done(); } catch (e) { toast(e.message, 'err'); } });
    if (d.status !== 'applied') b('Xoá', async () => { if (!confirm('Xoá quyết định này?')) return; try { await api('/admin/hr/decisions/' + d.id, { method: 'DELETE' }); done(); } catch (e) { toast(e.message, 'err'); } });
    const [stTxt, stCls] = DSTATUS[d.status] || [d.status, 'muted'];
    const empCell = el('td', {}, el('div', { style: 'font-weight:600' }, d.emp_name), small(d.emp_code));
    const noCell = el('td', {}, el('b', {}, d.decision_no || '—'), d.decision_date ? small('ký ' + dmy(d.decision_date)) : null);
    if (kind === 'transfer') {
      const change = (a, b2) => (b2 ? el('div', { style: 'font-size:13px' }, `${a || '—'} → `, el('b', {}, b2)) : null);
      tbody.append(el('tr', {}, noCell, empCell, el('td', {}, d.sub_kind || 'Thuyên chuyển'),
        el('td', {}, change(d.from_department, d.to_department), change(d.from_position, d.to_position)),
        el('td', {}, dmy(d.effective_date)), el('td', {}, d.reason || ''), el('td', {}, pill(stTxt, stCls)), el('td', {}, acts)));
    } else {
      const ho = d.handover || [];
      const doneN = ho.filter((x) => x.done).length;
      tbody.append(el('tr', {}, noCell, empCell, el('td', {}, resignLabel(d.sub_kind)), el('td', {}, dmy(d.request_date) || '—'), el('td', {}, el('b', {}, dmy(d.effective_date))),
        el('td', {}, d.reason || ''), el('td', {}, ho.length ? pill(`${doneN}/${ho.length}`, doneN === ho.length ? 'ok' : 'warn') : '—'), el('td', {}, pill(stTxt, stCls)), el('td', {}, acts)));
    }
  }
  const heads = kind === 'transfer' ? ['Số QĐ', 'Nhân viên', 'Loại', 'Thay đổi', 'Hiệu lực', 'Lý do', 'Trạng thái', 'Thao tác']
    : ['Số QĐ', 'Nhân viên', 'Hình thức', 'Ngày nộp đơn', 'Nghỉ từ ngày', 'Lý do', 'Bàn giao', 'Trạng thái', 'Thao tác'];
  if (!list.length) tbody.append(el('tr', {}, el('td', { colspan: heads.length, class: 'empty' }, 'Chưa có quyết định')));
  return el('div', { class: 'tbl-scroll' }, el('table', { class: 'data' }, el('thead', {}, el('tr', {}, ...heads.map((h) => el('th', {}, h)))), tbody));
}

// Form lập / sửa quyết định thuyên chuyển hoặc nghỉ việc
function decisionForm(kind, { employee_id, decision, done }) {
  const d = decision || {};
  const locked = !!decision && d.status !== 'pending';   // đã áp dụng / huỷ: chỉ sửa giấy tờ + bàn giao
  const empId = employee_id || d.employee_id;
  const emp = empId ? empById(empId) : null;
  const cur = el('div', { style: 'font-size:13px;color:var(--muted)' });
  const showCur = (x) => { cur.textContent = x ? `Hiện tại: ${x.department || '—'} · ${x.position || '—'}` : ''; };
  const picker = empId ? null : empPicker(0, { activeOnly: true, onChange: (id) => { showCur(empById(id)); check(); } });
  showCur(emp);
  const no = inp(d.decision_no || '', { placeholder: kind === 'resign' ? 'VD 12/2026/QĐ-TV' : 'VD 08/2026/QĐ-ĐC' });
  const ddate = dateInp(d.decision_date || META.today);
  const eff = dateInp(d.effective_date || META.today);
  const signer = inp(d.signer || '');
  const reason = el('textarea', { rows: 2 }, d.reason || '');
  const note = inp(d.note || '');
  const msg = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  const rows = [fld('Nhân viên', emp ? el('div', { style: 'font-weight:600' }, `${emp.code} — ${emp.full_name}`) : picker.box, cur)];
  let body, check = () => {};
  if (kind === 'transfer') {
    const sub = sel(META.transfer_kinds, d.sub_kind || 'Điều chuyển');
    const toDept = listInp(d.to_department || '', META.departments, 'hr-d-dept');
    const toPos = listInp(d.to_position || '', META.positions, 'hr-d-pos');
    rows.push(el('div', { class: 'two-col' }, fld('Loại quyết định', sub), fld('Ngày hiệu lực *', eff)),
      el('div', { class: 'two-col' }, fld('Bộ phận mới', toDept), fld('Chức danh mới', toPos)),
      hint('Để trống ô nào = giữ nguyên. Đến ngày hiệu lực phần mềm tự đổi bộ phận / chức danh của nhân viên (bảng công, báo cáo, phân quyền theo bộ phận dùng thông tin mới). Bộ phận / chức danh chưa có sẽ tự tạo.'));
    body = () => ({ sub_kind: sub.value, to_department: listVal(toDept), to_position: listVal(toPos) });
    if (locked) [sub, eff, toDept.querySelector('input'), toPos.querySelector('input')].forEach((x) => { x.disabled = true; });
  } else {
    const sub = sel(META.resign_kinds, d.sub_kind || 'tu_nguyen');
    const req = dateInp(d.request_date || META.today);
    const endC = el('input', { type: 'checkbox', style: 'width:auto', ...(d.end_contract === 0 ? {} : { checked: '' }) });
    const lock = el('input', { type: 'checkbox', style: 'width:auto', ...(d.lock_account === 0 ? {} : { checked: '' }) });
    const items = (d.handover && d.handover.length ? d.handover : META.handover.map((t) => ({ t, done: false }))).map((x) => ({ ...x }));
    const hoBox = el('div', { style: 'display:flex;flex-direction:column;gap:4px' });
    const drawHo = () => {
      hoBox.innerHTML = '';
      items.forEach((it, i) => {
        const cb = el('input', { type: 'checkbox', style: 'width:auto', ...(it.done ? { checked: '' } : {}) });
        cb.onchange = () => { it.done = cb.checked; };
        const x = el('button', { class: 'btn ghost sm', type: 'button', title: 'Bỏ mục này' }, '×');
        x.onclick = () => { items.splice(i, 1); drawHo(); };
        hoBox.append(el('label', { style: 'display:flex;gap:8px;align-items:center;font-size:13.5px' }, cb, el('span', { style: 'flex:1' }, it.t), x));
      });
      const ni = inp('', { placeholder: 'Thêm việc cần bàn giao…' });
      const nb = el('button', { class: 'btn ghost sm', type: 'button' }, '＋');
      nb.onclick = () => { if (ni.value.trim()) { items.push({ t: ni.value.trim(), done: false }); drawHo(); } };
      hoBox.append(el('div', { style: 'display:flex;gap:6px' }, ni, nb));
    };
    drawHo();
    rows.push(el('div', { class: 'two-col' }, fld('Hình thức nghỉ', sub), fld('Ngày nộp đơn', req)),
      el('div', { class: 'two-col' }, fld('Nghỉ việc kể từ ngày *', eff, small('ngày đầu tiên không còn đi làm')), fld('Người ký', signer)),
      el('label', { style: 'display:flex;gap:8px;align-items:center' }, endC, 'Chấm dứt hợp đồng đang hiệu lực từ ngày nghỉ'),
      el('label', { style: 'display:flex;gap:8px;align-items:center' }, lock, 'Khoá tài khoản chấm công từ ngày nghỉ (công các ngày đã làm vẫn giữ trong báo cáo / lương)'),
      fld('Việc cần bàn giao', hoBox));
    body = () => ({ sub_kind: sub.value, request_date: req.value, end_contract: endC.checked, lock_account: lock.checked, handover: items });
    let _t;
    check = () => {
      clearTimeout(_t);
      _t = setTimeout(async () => {
        const eid = empId || (picker && picker.value());
        if (!eid) return;
        try { const r = await api('/admin/hr/decisions/check', { method: 'POST', body: { employee_id: eid, sub_kind: sub.value, request_date: req.value, effective_date: eff.value } }); msg.innerHTML = ''; if (r.warnings.length) msg.append(box('warn', r.warnings)); } catch {}
      }, 250);
    };
    sub.onchange = check; req.onchange = check; eff.onchange = check;
    if (locked) [sub, req, eff, endC, lock].forEach((x) => { x.disabled = true; });
  }
  if (kind === 'transfer') rows.splice(rows.length - 1, 0, el('div', { class: 'two-col' }, fld('Số quyết định', no), fld('Ngày ký quyết định', ddate)), fld('Người ký', signer));
  else rows.splice(1, 0, el('div', { class: 'two-col' }, fld('Số quyết định', no), fld('Ngày ký quyết định', ddate)));
  rows.push(fld('Lý do', reason), fld('Ghi chú', note), msg);
  if (locked) rows.push(hint(d.status === 'applied' ? 'Quyết định đã áp dụng — chỉ sửa được số / ngày ký / người ký / lý do / ghi chú' + (kind === 'resign' ? ' và đánh dấu việc bàn giao.' : '.') : 'Quyết định đã huỷ.'));
  const save = el('button', { class: 'btn' + (kind === 'resign' && !decision ? ' danger' : '') }, decision ? 'Lưu' : kind === 'resign' ? 'Lập quyết định nghỉ việc' : 'Lập quyết định');
  save.onclick = async () => {
    const eid = empId || (picker && picker.value());
    if (!eid) return toast('Chọn nhân viên', 'err');
    const payload = { kind, employee_id: eid, decision_no: no.value, decision_date: ddate.value, effective_date: eff.value, signer: signer.value, reason: reason.value, note: note.value, ...body() };
    if (!decision && payload.effective_date <= META.today && !confirm(kind === 'resign'
      ? 'Ngày nghỉ việc là hôm nay hoặc đã qua → áp dụng NGAY: khoá tài khoản chấm công' + (payload.end_contract ? ' và chấm dứt hợp đồng' : '') + '. Tiếp tục?'
      : 'Ngày hiệu lực là hôm nay hoặc đã qua → đổi bộ phận / chức danh NGAY. Tiếp tục?')) return;
    save.disabled = true;
    try {
      const r = await api(decision ? '/admin/hr/decisions/' + d.id : '/admin/hr/decisions', { method: decision ? 'PUT' : 'POST', body: payload });
      C.closeModal();
      toast(r.applied ? 'Đã lưu và áp dụng quyết định' : 'Đã lưu quyết định' + (decision ? '' : ' — tự áp dụng vào ngày hiệu lực'), 'ok');
      done && done();
    } catch (e) { toast(e.message, 'err'); save.disabled = false; }
  };
  C.openModal(decision ? 'Sửa quyết định' : kind === 'resign' ? '🚪 Quyết định nghỉ việc' : '🔀 Quyết định thuyên chuyển', rows, [save]);
  document.getElementById('modal').style.maxWidth = '680px';
  check();
}
