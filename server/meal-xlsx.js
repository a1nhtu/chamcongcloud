// BÁO CÁO SUẤT ĂN ra Excel (Suất ăn › Báo cáo › Xuất Excel): 3 sheet
//   1. Tổng hợp   — mỗi ngày × bữa × món: NV tự chọn · HR chọn hộ · HR điều chỉnh · Tổng phải nấu · Thực tế đã quẹt (+ dòng cộng của bữa)
//   2. Chi tiết NV — từng nhân viên đã chọn món / đã quẹt thẻ trong giờ ăn
//   3. Lịch sử chỉnh sửa — mọi lần HR chỉnh tay (ai, lúc nào, cũ → mới, lý do)
import ExcelJS from 'exceljs';
import { listShifts, mealShiftReport, adjustLog, mealRangeSummary, mealNoShow, mealExceptions } from './meal.js';
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
const vnDT = (s) => { if (!s) return ''; const t = new Date(Date.parse(s.replace(' ', 'T') + (s.includes('T') ? '' : 'Z')) + 7 * 3600000).toISOString(); return `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)}`; };
const vnOf = (v) => (v ? `${v.slice(11)} ${v.slice(8, 10)}/${v.slice(5, 7)}` : '');   // 'YYYY-MM-DD HH:MM' → 'HH:MM dd/mm'
const kitchenLabel = (kitchens) => { const m = new Map(kitchens.map((k) => [k.id, k.name])); return (id) => m.get(id) || (kitchens.length ? 'Chưa phân bếp' : ''); };
const byWho = (setBy) => (setBy ? `HR đăng ký hộ (${setBy})` : 'NV tự đăng ký');

export async function writeMealRptXlsx(res, type, from, to, now = new Date()) {
  const wb = new ExcelJS.Workbook();
  const range = from === to ? `Ngày ${vn(from)}` : `Từ ${vn(from)} đến ${vn(to)}`;
  let name;
  if (type === 'summary') {
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
    for (const l of r.list) addRow(s2, [vn(l.date), l.shift_name, l.code || '', l.full_name, l.department, kn(l.kitchen_id), vnDT(l.at), byWho(l.set_by), l.dish || '', l.punched ? vnTime(l.punched) : (l.ended ? 'KHÔNG ĂN' : '')]);
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
    for (const x of r.no_show) addRow(s1, [vn(x.date), x.shift_name, x.code || '', x.full_name, x.department, kn(x.kitchen_id), vnDT(x.at), byWho(x.set_by), x.dish || '']);
    const s2 = sheet(wb, 'Quẹt mà không ĐK', 'QUẸT MÁY CHẤM ĂN MÀ KHÔNG ĐĂNG KÝ', range,
      ['Ngày', 'Bữa', 'Mã NV', 'Họ tên', 'Bộ phận', 'Bếp', 'Quẹt thẻ lúc'], [12, 14, 11, 26, 24, 16, 12]);
    for (const x of r.walk_in) addRow(s2, [vn(x.date), x.shift_name, x.code || '', x.full_name, x.department, kn(x.kitchen_id), vnTime(x.punched)]);
  } else throw userError('Loại báo cáo không hợp lệ');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}_${from}_${to}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}
