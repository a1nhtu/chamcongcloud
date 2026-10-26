// BÁO CÁO SUẤT ĂN ra Excel (Suất ăn › Báo cáo › Xuất Excel): 3 sheet
//   1. Tổng hợp   — mỗi ngày × bữa × món: NV tự chọn · HR chọn hộ · HR điều chỉnh · Tổng phải nấu · Thực tế đã quẹt (+ dòng cộng của bữa)
//   2. Chi tiết NV — từng nhân viên đã chọn món / đã quẹt thẻ trong giờ ăn
//   3. Lịch sử chỉnh sửa — mọi lần HR chỉnh tay (ai, lúc nào, cũ → mới, lý do)
import ExcelJS from 'exceljs';
import { listShifts, mealShiftReport, adjustLog, mealRangeSummary, mealNoShow, mealExceptions, mealMonthGrid, mealDayList, mealCompare } from './meal.js';
import { userError } from './util.js';
import { addDaysIso } from './meal-rules.js';

const vn = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
const vnTime = (iso) => (iso ? new Date(Date.parse(iso) + 7 * 3600000).toISOString().slice(11, 16) : '');
// datetime('now') của SQLite (UTC 'YYYY-MM-DD HH:MM:SS') → giờ VN 'dd/mm/yyyy HH:MM'
const vnStamp = (s) => { if (!s) return ''; const t = new Date(Date.parse(s.replace(' ', 'T') + 'Z') + 7 * 3600000).toISOString(); return `${vn(t.slice(0, 10))} ${t.slice(11, 16)}`; };
const DEF = '(Không chọn món — suất mặc định)';

const thin = { style: 'thin', color: { argb: 'FFCBD5E1' } }, border = { top: thin, bottom: thin, left: thin, right: thin };
function sheet(wb, name, title, sub, head, widths) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 3 }] });
  ws.addRow([title]).font = { bold: true, size: 14, color: { argb: 'FF1E3A68' } };
  ws.addRow([sub]).font = { italic: true, color: { argb: 'FF64748B' } };
  const h = ws.addRow(head);
  h.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A68' } }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = border; });
  h.height = 30;
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  return ws;
}
const addRow = (ws, vals, { bold = false, fill = null, numFrom = 99 } = {}) => {
  const r = ws.addRow(vals);
  r.eachCell({ includeEmpty: true }, (c, i) => {
    c.border = border;
    if (i >= numFrom) c.alignment = { horizontal: 'center' };
    if (bold) c.font = { bold: true };
    if (fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  });
  return r;
};

export async function writeMealReportXlsx(res, from, to, now = new Date()) {
  const shifts = listShifts({ onlyEnabled: true });
  const wb = new ExcelJS.Workbook();
  const range = from === to ? `Ngày ${vn(from)}` : `Từ ${vn(from)} đến ${vn(to)}`;
  const s1 = sheet(wb, 'Tổng hợp', 'BÁO CÁO SUẤT ĂN — TỔNG HỢP THEO MÓN', `${range} · Tổng phải nấu = NV tự chọn + HR chọn hộ + HR điều chỉnh · Thực tế = số người đã quẹt máy chấm công trong giờ ăn`,
    ['Ngày', 'Bữa', 'Món', 'NV tự chọn', 'HR chọn hộ', 'HR điều chỉnh (+/−)', 'Tổng phải nấu', 'Thực tế đã quẹt', 'Ghi chú'], [12, 14, 34, 11, 11, 13, 13, 13, 60]);
  const s2 = sheet(wb, 'Chi tiết NV', 'BÁO CÁO SUẤT ĂN — CHI TIẾT TỪNG NHÂN VIÊN', `${range} · Gồm người đã chọn món và người quẹt thẻ trong giờ ăn mà không chọn món`,
    ['Ngày', 'Bữa', 'Mã NV', 'Họ tên', 'Bộ phận', 'Món', 'Người chọn món', 'Quẹt thẻ lúc'], [12, 14, 11, 26, 24, 30, 22, 12]);
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    for (const sh of shifts) {
      const r = mealShiftReport(d, sh, now, { detail: true });
      const noteOf = (dish) => { const n = r.adjust_notes[dish]; return n ? `${n.note} (${n.by})` : ''; };
      for (const x of r.rows) addRow(s1, [vn(d), sh.name, x.dish, x.app, x.hr, x.adjust || null, x.total, x.ate, noteOf(x.dish)], { numFrom: 4 });
      if (r.default.total || r.default.ate || r.default.adjust)
        addRow(s1, [vn(d), sh.name, DEF, r.default.base || null, null, r.default.adjust || null, r.default.total, r.default.ate, noteOf('') || (r.default.base ? 'Trưởng BP đăng ký nhiều hơn số người chọn món' : '')], { numFrom: 4 });
      const t = r.totals;
      const status = [`Trưởng BP đăng ký: ${t.registered == null ? 'chưa' : t.registered}`, `hạn chọn món ${r.deadline.slice(11)} ${vn(r.deadline.slice(0, 10))}${r.locked ? ' (đã khoá)' : ' (còn mở)'}`,
        r.closed ? `HR đã chốt ${r.closed.total} suất (${r.closed.by})` : 'HR chưa chốt'].join(' · ');
      addRow(s1, [vn(d), sh.name, `Cộng ${sh.name}`, t.app, t.hr, t.adjust || null, t.total, t.ate, status], { bold: true, fill: 'FFE5EDF7', numFrom: 4 });
      // chi tiết từng NV
      for (const o of r.orders) {
        const p = r.punchers.get(o.employee_id);
        addRow(s2, [vn(d), sh.name, o.code || '', o.full_name, o.department, o.dish, o.set_by ? `HR chọn hộ (${o.set_by})` : 'NV tự chọn', p ? vnTime(p.at) : ''], { numFrom: 8 });
      }
      const chosen = new Set(r.orders.map((o) => o.employee_id));
      for (const [id, p] of r.punchers) if (!chosen.has(id)) addRow(s2, [vn(d), sh.name, p.code || '', p.full_name, p.department, '(không chọn món)', '', vnTime(p.at)], { numFrom: 8 });
    }
  }
  const s3 = sheet(wb, 'Lịch sử chỉnh sửa', 'LỊCH SỬ HR CHỈNH TAY SUẤT ĂN', `${range} · Mọi lần điều chỉnh số suất / chọn món hộ nhân viên đều được ghi lại`,
    ['Thời gian sửa', 'Người sửa', 'Ngày ăn', 'Bữa', 'Loại', 'Nhân viên', 'Món', 'Cũ', 'Mới', 'Lý do'], [17, 18, 12, 14, 20, 26, 26, 18, 18, 44]);
  const shName = Object.fromEntries(listShifts().map((s) => [s.code, s.name]));
  for (const l of adjustLog(from, to).reverse()) {
    const isAdj = l.kind === 'adjust';
    addRow(s3, [vnStamp(l.at), l.by_name, vn(l.work_date), shName[l.shift] || l.shift, isAdj ? 'Điều chỉnh số suất' : 'Chọn món hộ NV', l.emp_label,
      l.dish || (isAdj ? DEF : ''), isAdj ? Number(l.old_value) : (l.old_value || '(chưa chọn)'), isAdj ? Number(l.new_value) : (l.new_value || '(bỏ món)'), l.reason]);
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="bao_cao_suat_an_${from}_${to}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

// BÁO CÁO SUẤT ĂN theo khoảng ngày (Suất ăn › Báo cáo suất ăn › Xuất Excel):
//   summary — 1. TỔNG SỐ SUẤT ĂN & GIỜ ĐĂNG KÝ (sheet Tổng hợp theo ngày × bữa × bếp + sheet Chi tiết từng lượt đăng ký)
//   noshow  — 2. SỐ LẦN BÁO ĂN MÀ KHÔNG ĂN theo nhân viên
//   except  — 3. NGOẠI LỆ: đăng ký mà không quẹt · quẹt mà không đăng ký
//   month   — BẢNG TỔNG HỢP BÁO CƠM (mẫu bảng tháng: NV × bữa × ngày ghi giờ báo / giờ ăn, Tổng buổi, dòng Tổng cộng)
//   daylist — DANH SÁCH BÁO CƠM 1 bữa 1 ngày (mẫu in cho bếp: 3 khối TT · Họ và tên · Ghi chú, 90 người / trang)
//   compare — ĐỐI CHIẾU BÁO ↔ ĂN: tổng hợp theo ngày, theo nhân viên + chi tiết báo mà không ăn / ăn mà không báo
const vnDT = (s) => { if (!s) return ''; const t = new Date(Date.parse(s.replace(' ', 'T') + (s.includes('T') ? '' : 'Z')) + 7 * 3600000).toISOString(); return `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)}`; };
const vnOf = (v) => (v ? `${v.slice(11)} ${v.slice(8, 10)}/${v.slice(5, 7)}` : '');   // 'YYYY-MM-DD HH:MM' → 'HH:MM dd/mm'
const kitchenLabel = (kitchens) => { const m = new Map(kitchens.map((k) => [k.id, k.name])); return (id) => m.get(id) || (kitchens.length ? 'Chưa phân bếp' : ''); };
const byWho = (setBy, source) => (setBy ? `HR đăng ký hộ (${setBy})` : source === 'may' ? 'Quẹt máy chấm công' : 'NV tự đăng ký');

export async function writeMealRptXlsx(res, type, from, to, now = new Date(), opt = {}) {
  const wb = new ExcelJS.Workbook();
  const range = from === to ? `Ngày ${vn(from)}` : `Từ ${vn(from)} đến ${vn(to)}`;
  let name;
  if (type === 'month') {
    const r = mealMonthGrid(from, to, { mode: opt.mode, kitchenId: opt.kitchenId, now });
    name = 'bang_tong_hop_bao_com';
    writeMonthSheet(wb, r, placeOf(opt.place, r));
  } else if (type === 'daylist') {
    const r = mealDayList(from, opt.shift, { kitchenId: opt.kitchenId });
    name = `danh_sach_bao_com_${r.shift}`;
    writeDayListSheet(wb, r, placeOf(opt.place, r));
  } else if (type === 'compare') {
    const r = mealCompare(from, to, { kitchenId: opt.kitchenId, now });
    const kn = kitchenLabel(r.kitchens);
    name = 'doi_chieu_bao_an';
    const sub = `${range}${r.kitchen_id ? ' · ' + kn(r.kitchen_id) : ''} · Báo = có đăng ký ăn (tự báo hoặc HR báo hộ) · Ăn = quẹt máy chấm ăn trong giờ ăn · Báo mà không ăn chỉ tính bữa đã kết thúc`;
    const s1 = sheet(wb, 'Tổng hợp theo ngày', 'ĐỐI CHIẾU BÁO CƠM ↔ ĂN THỰC TẾ — THEO NGÀY', sub,
      ['Ngày', 'Bữa', 'Số báo cơm', 'Số ăn (quẹt thẻ)', 'Báo và có ăn', 'Báo mà không ăn', 'Ăn mà không báo'], [12, 16, 12, 14, 12, 14, 14]);
    for (const x of r.days) addRow(s1, [vn(x.date), x.shift_name, x.signed, x.ate, x.ok, x.ended ? x.no_show : 'chưa ăn xong', x.walk_in], { numFrom: 3 });
    const t = r.totals;
    addRow(s1, ['Tổng cộng', '', t.signed, t.ate, t.ok, t.no_show, t.walk_in], { bold: true, fill: 'FFE5EDF7', numFrom: 3 });
    const its = (list) => list.map((i) => `${i.date.slice(8, 10)}/${i.date.slice(5, 7)} ${i.shift_name}`).join(', ');
    const s2 = sheet(wb, 'Theo nhân viên', 'ĐỐI CHIẾU BÁO CƠM ↔ ĂN THỰC TẾ — THEO NHÂN VIÊN', sub + ' · Người có ngoại lệ nhiều nhất lên đầu',
      ['Mã NV', 'Họ tên', 'Bộ phận', 'Bếp', 'Số lần báo', 'Số lần ăn', 'Báo và có ăn', 'Báo mà không ăn', 'Ăn mà không báo', 'Các bữa báo mà không ăn', 'Các bữa ăn mà không báo'],
      [11, 26, 24, 16, 10, 10, 11, 12, 12, 50, 50]);
    for (const x of r.people) addRow(s2, [x.code || '', x.full_name, x.department, kn(x.kitchen_id), x.signed, x.ate, x.ok, x.no_show, x.walk_in, its(x.no_show_items), its(x.walk_in_items)], { numFrom: 5 });
    const s3 = sheet(wb, 'Báo mà không ăn', 'CHI TIẾT BÁO CƠM MÀ KHÔNG ĂN', sub,
      ['Ngày', 'Bữa', 'Mã NV', 'Họ tên', 'Bộ phận', 'Bếp', 'Giờ báo', 'Người báo', 'Món'], [12, 14, 11, 26, 24, 16, 13, 26, 24]);
    for (const x of r.no_show) addRow(s3, [vn(x.date), x.shift_name, x.code || '', x.full_name, x.department, kn(x.kitchen_id), vnDT(x.at), byWho(x.set_by, x.source), x.dish || '']);
    const s4 = sheet(wb, 'Ăn mà không báo', 'CHI TIẾT ĂN MÀ KHÔNG BÁO CƠM', sub,
      ['Ngày', 'Bữa', 'Mã NV', 'Họ tên', 'Bộ phận', 'Bếp', 'Quẹt thẻ lúc'], [12, 14, 11, 26, 24, 16, 12]);
    for (const x of r.walk_in) addRow(s4, [vn(x.date), x.shift_name, x.code || '', x.full_name, x.department, kn(x.kitchen_id), vnTime(x.punched)]);
  } else if (type === 'summary') {
    const r = mealRangeSummary(from, to, now, { detail: true });
    const kn = kitchenLabel(r.kitchens);
    name = 'tong_so_suat_an';
    const s1 = sheet(wb, 'Tổng hợp', 'BÁO CÁO TỔNG SỐ SUẤT ĂN & GIỜ ĐĂNG KÝ', `${range} · Tổng phải nấu = NV tự đăng ký + HR đăng ký hộ + HR thêm tay · Đã quẹt = người đăng ký có quẹt máy chấm ăn trong giờ ăn`,
      ['Ngày', 'Bữa', 'Bếp', 'Mở đăng ký', 'Khoá đăng ký', 'ĐK sớm nhất', 'ĐK muộn nhất', 'NV tự ĐK', 'HR ĐK hộ', 'HR thêm tay (+/−)', 'Tổng phải nấu', 'Đã quẹt', 'ĐK mà không quẹt', 'Quẹt mà không ĐK', 'Gửi bếp lúc'],
      [12, 14, 16, 13, 13, 13, 13, 10, 10, 12, 12, 10, 12, 12, 14]);
    for (const x of r.rows) {
      const ns = (k) => (x.ended ? k.no_show : null);   // bữa chưa kết thúc: chưa tính "không quẹt"
      for (const k of x.kitchens) addRow(s1, [vn(x.date), x.shift_name, kn(k.kitchen_id) || 'Tất cả', x.open ? vnOf(x.open) : 'luôn mở', vnOf(x.deadline), '', '', k.app, k.hr, k.extra || null, k.total, k.ate, ns(k), k.walk_in, ''], { numFrom: 8 });
      const t = x.totals;
      addRow(s1, [vn(x.date), x.shift_name, `Cộng ${x.shift_name}`, x.open ? vnOf(x.open) : 'luôn mở', vnOf(x.deadline), vnDT(x.first_signup), vnDT(x.last_signup), t.app, t.hr, t.extra || null, t.total, t.ate,
        x.ended ? t.no_show : 'chưa ăn xong', t.walk_in, x.sent_at ? `${vnDT(x.sent_at)} (${x.sent_total} suất)` : 'chưa gửi'], { bold: true, fill: 'FFE5EDF7', numFrom: 8 });
    }
    const s2 = sheet(wb, 'Chi tiết đăng ký', 'CHI TIẾT TỪNG LƯỢT ĐĂNG KÝ ĂN', `${range} · Giờ đăng ký = lúc bấm đăng ký lần đầu`,
      ['Ngày', 'Bữa', 'Mã NV', 'Họ tên', 'Bộ phận', 'Bếp', 'Giờ đăng ký', 'Người đăng ký', 'Món', 'Quẹt thẻ lúc'], [12, 14, 11, 26, 24, 16, 13, 26, 24, 12]);
    for (const l of r.list) addRow(s2, [vn(l.date), l.shift_name, l.code || '', l.full_name, l.department, kn(l.kitchen_id), vnDT(l.at), byWho(l.set_by, l.source), l.dish || '', l.punched ? vnTime(l.punched) : (l.ended ? 'KHÔNG ĂN' : '')]);
  } else if (type === 'noshow') {
    const r = mealNoShow(from, to, now);
    const kn = kitchenLabel(r.kitchens);
    name = 'bao_an_khong_an';
    const s1 = sheet(wb, 'Báo ăn mà không ăn', 'SỐ LẦN BÁO ĂN MÀ KHÔNG ĂN — THEO NHÂN VIÊN', `${range} · Chỉ tính bữa đã kết thúc (${r.meals} bữa có dữ liệu) · Không ăn = có đăng ký nhưng không quẹt máy chấm ăn trong giờ ăn`,
      ['Mã NV', 'Họ tên', 'Bộ phận', 'Bếp', 'Số lần đăng ký', 'Đã ăn', 'Báo mà không ăn', 'Tỉ lệ không ăn (%)', 'Quẹt mà không ĐK', 'Các bữa không ăn'], [11, 26, 24, 16, 12, 10, 12, 12, 12, 70]);
    for (const x of r.rows) addRow(s1, [x.code || '', x.full_name, x.department, kn(x.kitchen_id), x.registered, x.ate, x.no_show, x.rate, x.walk_in,
      x.items.map((i) => `${i.date.slice(8, 10)}/${i.date.slice(5, 7)} ${i.shift_name}${i.set_by ? ' (HR ĐK hộ)' : ''}`).join(', ')], { numFrom: 5 });
  } else if (type === 'except') {
    const r = mealExceptions(from, to, now);
    const kn = kitchenLabel(r.kitchens);
    name = 'ngoai_le_suat_an';
    const s1 = sheet(wb, 'ĐK mà không quẹt', 'ĐĂNG KÝ ĂN MÀ KHÔNG QUẸT THẺ', `${range} · Chỉ bữa đã kết thúc`,
      ['Ngày', 'Bữa', 'Mã NV', 'Họ tên', 'Bộ phận', 'Bếp', 'Giờ đăng ký', 'Người đăng ký', 'Món'], [12, 14, 11, 26, 24, 16, 13, 26, 24]);
    for (const x of r.no_show) addRow(s1, [vn(x.date), x.shift_name, x.code || '', x.full_name, x.department, kn(x.kitchen_id), vnDT(x.at), byWho(x.set_by, x.source), x.dish || '']);
    const s2 = sheet(wb, 'Quẹt mà không ĐK', 'QUẸT MÁY CHẤM ĂN MÀ KHÔNG ĐĂNG KÝ', range,
      ['Ngày', 'Bữa', 'Mã NV', 'Họ tên', 'Bộ phận', 'Bếp', 'Quẹt thẻ lúc'], [12, 14, 11, 26, 24, 16, 12]);
    for (const x of r.walk_in) addRow(s2, [vn(x.date), x.shift_name, x.code || '', x.full_name, x.department, kn(x.kitchen_id), vnTime(x.punched)]);
  } else throw userError('Loại báo cáo không hợp lệ');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}_${from}_${to}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

/* ---------------------------- MẪU IN BÁO CƠM (giống mẫu giấy khách đang dùng: chữ Times New Roman, viền đen) ---------------------------- */
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const TNR = 'Times New Roman';
const solid = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const blk = { style: 'thin', color: { argb: 'FF000000' } }, dot = { style: 'dotted', color: { argb: 'FF000000' } };
const NO_SHOW_FILL = 'FFFDE2E2', WALK_IN_FILL = 'FFFFEDD5', NOTE_FILL = 'FFFFD1D6';
// Nơi ăn in trên tiêu đề (VD "NHÀ CÔNG VỤ"): HR gõ, để trống = tên bếp đang lọc (nếu có)
const placeOf = (place, r) => {
  const p = String(place || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return (p || (r.kitchen_id ? r.kitchens.find((k) => k.id === r.kitchen_id)?.name || '' : '')).toUpperCase();
};
const fullMonth = (from, to) => from.slice(0, 7) === to.slice(0, 7) && from.slice(8) === '01' && addDaysIso(to, 1).slice(8) === '01';
const fmtCell = (c, { bold = false, size = 12, h = 'center', italic = false, color = null } = {}) => {
  c.font = { name: TNR, size, bold, italic, ...(color ? { color: { argb: color } } : {}) };
  c.alignment = { horizontal: h, vertical: 'middle', wrapText: true };
};
const mergeTxt = (ws, r1, c1, r2, c2, v, f = {}) => { if (r1 !== r2 || c1 !== c2) ws.mergeCells(r1, c1, r2, c2); const c = ws.getCell(r1, c1); c.value = v; fmtCell(c, f); return c; };
const boxAll = (ws, r1, c1, r2, c2) => { for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) ws.getCell(r, c).border = { top: blk, bottom: blk, left: blk, right: blk }; };

function writeMonthSheet(wb, r, place) {
  const ws = wb.addWorksheet('Bảng tổng hợp báo cơm', { views: [{ state: 'frozen', xSplit: 3, ySplit: 8 }] });
  const nD = r.days.length, last = 3 + nD + 1, nS = Math.max(1, r.shifts.length);
  ws.getColumn(1).width = 5; ws.getColumn(2).width = 24; ws.getColumn(3).width = 11;
  for (let i = 0; i < nD; i++) ws.getColumn(4 + i).width = 6.4;
  ws.getColumn(last).width = 8.5;
  // tên công ty bên trái, quốc hiệu bên phải
  const L = Math.max(3, Math.floor(last * 0.4)), R0 = Math.min(last, Math.max(L + 2, last - Math.floor(last * 0.48)));
  mergeTxt(ws, 1, 1, 2, L, (r.company || '').toUpperCase(), { bold: true, size: 13 });
  mergeTxt(ws, 1, R0, 1, last, 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', { bold: true, size: 13 });
  const qh = mergeTxt(ws, 2, R0, 2, last, 'Độc lập - Tự do - Hạnh phúc', { bold: true, size: 13 });
  qh.font = { ...qh.font, underline: true };
  ws.getRow(1).height = 20; ws.getRow(2).height = 20;
  mergeTxt(ws, 4, 1, 4, last, `BẢNG TỔNG HỢP BÁO CƠM${place ? ' ' + place : ''}`, { bold: true, size: 15 });
  mergeTxt(ws, 5, 1, 5, last, fullMonth(r.from, r.to) ? `Tháng ${r.from.slice(5, 7)} năm ${r.from.slice(0, 4)}` : `Từ ngày ${vn(r.from)} đến ngày ${vn(r.to)}`, { bold: true, size: 14 });
  if (r.mode === 'punch') mergeTxt(ws, 6, 1, 6, last, '(Mỗi ô ghi giờ quẹt máy chấm ăn — giờ ăn thực tế)', { italic: true, size: 11 });
  // tiêu đề bảng 2 dòng: số ngày + thứ
  mergeTxt(ws, 7, 1, 8, 1, 'STT', { bold: true, size: 11 });
  mergeTxt(ws, 7, 2, 8, 2, 'Tên nhân viên', { bold: true, size: 11 });
  mergeTxt(ws, 7, 3, 8, 3, 'Buổi ăn', { bold: true, size: 11 });
  r.days.forEach((d, i) => {
    const wd = new Date(d + 'T12:00:00Z').getUTCDay();
    mergeTxt(ws, 7, 4 + i, 7, 4 + i, Number(d.slice(8)), { bold: true, size: 11 });
    mergeTxt(ws, 8, 4 + i, 8, 4 + i, WD[wd], { size: 10, bold: wd === 0, color: wd === 0 ? 'FFC00000' : null });
  });
  mergeTxt(ws, 7, last, 8, last, 'Tổng buổi', { bold: true, size: 11 });
  boxAll(ws, 7, 1, 8, last);
  ws.getRow(7).height = 20;
  // mỗi NV: 1 dòng / bữa, gộp ô STT + tên
  let row = 9;
  const flagged = { no_show: false, walk_in: false };
  r.rows.forEach((p, idx) => {
    const r1 = row, r2 = row + nS - 1;
    mergeTxt(ws, r1, 1, r2, 1, idx + 1, { size: 11 });
    mergeTxt(ws, r1, 2, r2, 2, p.full_name, { size: 11 });
    r.shifts.forEach((s, si) => {
      const rr = r1 + si, cells = p.cells[s.code] || {};
      mergeTxt(ws, rr, 3, rr, 3, s.name, { size: 10 });
      r.days.forEach((d, i) => {
        const v = cells[d], c = ws.getCell(rr, 4 + i);
        c.value = v ? v.t : null;
        fmtCell(c, { size: 10, italic: !!v?.hr });
        if (v?.no_show) { c.fill = solid(NO_SHOW_FILL); flagged.no_show = true; }
        if (v?.walk_in) { c.fill = solid(WALK_IN_FILL); flagged.walk_in = true; }
      });
      const t = ws.getCell(rr, last); t.value = p.totals[s.code] || null; fmtCell(t, { size: 11 });
      for (let c = 1; c <= last; c++) ws.getCell(rr, c).border = { left: blk, right: blk, top: si === 0 ? blk : dot, bottom: si === nS - 1 ? blk : dot };
    });
    row = r2 + 1;
  });
  // Tổng cộng: từng bữa + tổng số suất
  const span = r.from.slice(0, 7) === r.to.slice(0, 7) ? `từ ${r.from.slice(8)} đến ${vn(r.to)}` : `từ ${vn(r.from)} đến ${vn(r.to)}`;
  const f1 = row, f2 = row + r.shifts.length;
  mergeTxt(ws, f1, 1, f2, 3, 'Tổng Cộng', { bold: true, size: 14 });
  r.shifts.forEach((s, i) => {
    mergeTxt(ws, f1 + i, 4, f1 + i, last - 1, `Số suất ăn ${s.name.toLowerCase()} ${span}`, { bold: true, size: 13 });
    const c = ws.getCell(f1 + i, last); c.value = r.totals[s.code] || 0; c.numFmt = '#,##0'; fmtCell(c, { bold: true, size: 13 });
  });
  mergeTxt(ws, f2, 4, f2, last - 1, `Tổng số suất ăn ${span}`, { bold: true, size: 13 });
  const tc = ws.getCell(f2, last); tc.value = r.total; tc.numFmt = '#,##0'; fmtCell(tc, { bold: true, size: 13 });
  boxAll(ws, f1, 1, f2, last);
  for (let i = f1; i <= f2; i++) ws.getRow(i).height = 20;
  // chú thích màu ô
  let note = f2 + 2;
  const legend = (fill, txt) => {
    mergeTxt(ws, note, 4, note, last, txt, { italic: true, size: 11, h: 'left' });
    ws.getCell(note, 3).fill = solid(fill); ws.getCell(note, 3).border = { top: blk, bottom: blk, left: blk, right: blk };
    note++;
  };
  if (flagged.no_show) legend(NO_SHOW_FILL, 'Báo cơm mà không ăn (không quẹt máy chấm ăn trong giờ ăn)');
  if (flagged.walk_in) legend(WALK_IN_FILL, 'Ăn mà không báo cơm (có quẹt máy chấm ăn nhưng không đăng ký)');
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
    margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };
  ws.pageSetup.printTitlesRow = '7:8';
}

function writeDayListSheet(wb, r, place) {
  const ws = wb.addWorksheet('Danh sách báo cơm');
  [6, 30, 14, 6, 30, 14, 6, 30, 14].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  mergeTxt(ws, 1, 1, 1, 9, `DANH SÁCH BÁO CƠM${place ? ' ' + place : ''} ${r.shift_name.toUpperCase()} NGÀY ${vn(r.date)}`, { bold: true, size: 14 });
  ws.getRow(1).height = 24;
  // mỗi trang 3 khối × 30 dòng = 90 người; đánh số dọc từng khối như mẫu giấy
  const PER = 30, pages = Math.max(1, Math.ceil(r.rows.length / (PER * 3)));
  let row = 3;
  for (let p = 0; p < pages; p++) {
    if (p) ws.getRow(row - 1).addPageBreak();
    for (let b = 0; b < 3; b++) ['TT', 'Họ và tên', 'Ghi chú'].forEach((h, i) => mergeTxt(ws, row, b * 3 + 1 + i, row, b * 3 + 1 + i, h, { bold: true, size: 13 }));
    ws.getRow(row).height = 21;
    for (let i = 0; i < PER; i++) {
      for (let b = 0; b < 3; b++) {
        const n = p * PER * 3 + b * PER + i, x = r.rows[n], c0 = b * 3 + 1;
        const tt = ws.getCell(row + 1 + i, c0); tt.value = n + 1; fmtCell(tt, { size: 13, h: 'right' });
        const nm = ws.getCell(row + 1 + i, c0 + 1); nm.value = x ? x.full_name : null; fmtCell(nm, { size: 13, h: 'left' });
        const nt = ws.getCell(row + 1 + i, c0 + 2); nt.value = x?.note || null; fmtCell(nt, { size: 13, h: 'left', color: x?.note ? 'FFC00000' : null });
        if (x?.note) nt.fill = solid(NOTE_FILL);
      }
      ws.getRow(row + 1 + i).height = 19;
    }
    boxAll(ws, row, 1, row + PER, 9);
    row += PER + 2;
  }
  const hr = r.rows.filter((x) => x.set_by).length;
  mergeTxt(ws, row - 1, 1, row - 1, 9, `Tổng cộng: ${r.rows.length} suất${hr ? ` (tự báo ${r.rows.length - hr} · HR báo hộ ${hr})` : ''}`, { bold: true, size: 13, h: 'left' });
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
    margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };
}
