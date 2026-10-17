// BÁO CÁO SUẤT ĂN ra Excel (Suất ăn › Báo cáo › Xuất Excel): 3 sheet
//   1. Tổng hợp   — mỗi ngày × bữa × món: NV tự chọn · HR chọn hộ · HR điều chỉnh · Tổng phải nấu · Thực tế đã quẹt (+ dòng cộng của bữa)
//   2. Chi tiết NV — từng nhân viên đã chọn món / đã quẹt thẻ trong giờ ăn
//   3. Lịch sử chỉnh sửa — mọi lần HR chỉnh tay (ai, lúc nào, cũ → mới, lý do)
import ExcelJS from 'exceljs';
import { listShifts, mealShiftReport, adjustLog } from './meal.js';
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
