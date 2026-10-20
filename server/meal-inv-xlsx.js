// BÁO CÁO NGUYÊN LIỆU ra Excel (Suất ăn › Nguyên liệu & kho › Báo cáo › Xuất Excel):
//   need  — nhu cầu nguyên liệu theo ngày / bữa / bếp + tổng theo nguyên liệu + món chưa có định lượng
//   stock — nhập – xuất – tồn theo kỳ + chi tiết từng phiếu
//   cost  — chi phí nguyên liệu trên mỗi suất (dự tính theo định lượng · thực xuất kho)
import ExcelJS from 'exceljs';
import { userError } from './util.js';
import { needsRange, stockReport, costReport, listDocs, getDoc } from './meal-inv.js';

const vn = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
const thin = { style: 'thin', color: { argb: 'FFCBD5E1' } }, border = { top: thin, bottom: thin, left: thin, right: thin };
const QTY = '#,##0.###', MONEY = '#,##0';
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
// fmt: { <số cột 1-based>: định dạng số }
const addRow = (ws, vals, { bold = false, fill = null, fmt = {} } = {}) => {
  const r = ws.addRow(vals);
  r.eachCell({ includeEmpty: true }, (c, i) => {
    c.border = border;
    if (fmt[i]) { c.numFmt = fmt[i]; c.alignment = { horizontal: 'right' }; }
    if (bold) c.font = { bold: true };
    if (fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  });
  return r;
};
const STATE_TXT = { out: 'Hết hàng', short: 'Không đủ cho kế hoạch', low: 'Sắp hết', ok: '' };

export async function writeInvXlsx(res, type, from, to, { kitchen = null, now = new Date() } = {}) {
  const wb = new ExcelJS.Workbook();
  const range = from === to ? `Ngày ${vn(from)}` : `Từ ${vn(from)} đến ${vn(to)}`;
  let fname;
  if (type === 'need') {
    const N = needsRange(from, to, { kitchen, now });
    const kTxt = kitchen == null ? 'mọi bếp' : (N.kitchens.find((k) => k.id === kitchen)?.name || 'Chung / chưa phân bếp');
    const s1 = sheet(wb, 'Tổng nguyên liệu', 'NHU CẦU NGUYÊN LIỆU — TỔNG THEO NGUYÊN LIỆU', `${range} · ${kTxt} · ${N.portions} suất · Lượng cần = số suất phải nấu × định lượng 1 suất`,
      ['Nguyên liệu', 'ĐVT', 'Lượng cần', 'Đơn giá', 'Thành tiền', 'Tồn hiện tại', 'Thiếu'], [30, 9, 14, 13, 15, 14, 12]);
    for (const l of N.lines) addRow(s1, [l.name, l.unit, l.qty, l.price, l.cost, l.stock, l.short || null], { fmt: { 3: QTY, 4: MONEY, 5: MONEY, 6: QTY, 7: QTY }, fill: l.short ? 'FFFDECEA' : null });
    addRow(s1, ['Cộng', '', null, null, N.cost, null, null], { bold: true, fill: 'FFE5EDF7', fmt: { 5: MONEY } });
    const s2 = sheet(wb, 'Theo bữa', 'NHU CẦU NGUYÊN LIỆU — THEO NGÀY / BỮA / BẾP', `${range} · ${kTxt}`,
      ['Ngày', 'Bữa', 'Bếp', 'Số suất', 'Món (số suất)', 'Nguyên liệu', 'ĐVT', 'Lượng cần', 'Thành tiền', 'Đã xuất kho'], [12, 13, 18, 9, 40, 26, 8, 13, 14, 16]);
    for (const m of N.meals) {
      const dishes = m.dishes.map((d) => `${d.dish || 'Suất chung'}: ${d.qty}${d.has_recipe ? '' : ' (chưa có định lượng)'}`).join(' · ');
      const kn = m.kitchen_name || (N.kitchens.length ? 'Chung / chưa phân bếp' : 'Bếp chung');
      const iss = m.issued ? 'Đã xuất' : '';
      if (!m.lines.length) addRow(s2, [vn(m.date), m.shift_name, kn, m.portions, dishes, '(chưa có định lượng)', '', null, null, iss], { fmt: { 4: '0' } });
      m.lines.forEach((l, i) => addRow(s2, [vn(m.date), m.shift_name, kn, i ? null : m.portions, i ? '' : dishes, l.name, l.unit, l.qty, l.cost, i ? '' : iss], { fmt: { 4: '0', 8: QTY, 9: MONEY } }));
      addRow(s2, [vn(m.date), m.shift_name, kn, m.portions, `Cộng ${m.shift_name.toLowerCase()}`, '', '', null, m.cost, iss], { bold: true, fill: 'FFE5EDF7', fmt: { 4: '0', 9: MONEY } });
    }
    const s3 = sheet(wb, 'Món chưa có định lượng', 'MÓN CHƯA CÓ ĐỊNH LƯỢNG', `${range} · Các suất này CHƯA được tính vào nhu cầu nguyên liệu — vào tab Định lượng món để nhập`,
      ['Món', 'Số suất'], [44, 12]);
    for (const x of N.missing) addRow(s3, [x.dish || `Suất chung — ${x.shift_name}`, x.portions], { fmt: { 2: '0' } });
    fname = `nhu_cau_nguyen_lieu_${from}_${to}.xlsx`;
  } else if (type === 'stock') {
    const S = stockReport(from, to);
    const s1 = sheet(wb, 'Nhập xuất tồn', 'BÁO CÁO NHẬP – XUẤT – TỒN NGUYÊN LIỆU', `${range} · Tồn cuối = tồn đầu + nhập − xuất ± kiểm kê · Giá trị tồn theo đơn giá hiện tại (giá nhập gần nhất)`,
      ['Nguyên liệu', 'ĐVT', 'Tồn đầu kỳ', 'Nhập (SL)', 'Nhập (tiền)', 'Xuất (SL)', 'Xuất (tiền)', 'Kiểm kê ±', 'Tồn cuối kỳ', 'Đơn giá', 'Giá trị tồn', 'Tồn tối thiểu', 'Cảnh báo'],
      [28, 8, 12, 12, 14, 12, 14, 11, 12, 12, 15, 12, 16]);
    for (const r of S.rows) {
      const warn = r.closing <= 0 ? 'Hết hàng' : r.min_stock > 0 && r.closing <= r.min_stock ? 'Sắp hết' : '';
      addRow(s1, [r.name + (r.active ? '' : ' (ngừng dùng)'), r.unit, r.opening, r.in_qty || null, r.in_value || null, r.out_qty || null, r.out_value || null, r.adj || null, r.closing, r.price, r.closing_value, r.min_stock || null, warn],
        { fmt: { 3: QTY, 4: QTY, 5: MONEY, 6: QTY, 7: MONEY, 8: QTY, 9: QTY, 10: MONEY, 11: MONEY, 12: QTY }, fill: warn ? 'FFFFF1D6' : null });
    }
    addRow(s1, ['Cộng', '', null, null, S.totals.in_value, null, S.totals.out_value, null, null, null, S.totals.closing_value, null, ''], { bold: true, fill: 'FFE5EDF7', fmt: { 5: MONEY, 7: MONEY, 11: MONEY } });
    const s2 = sheet(wb, 'Chi tiết phiếu', 'CHI TIẾT PHIẾU KHO', range,
      ['Ngày', 'Loại phiếu', 'Số phiếu', 'Bữa', 'Bếp', 'Nhà cung cấp', 'Nguyên liệu', 'ĐVT', 'Số lượng', 'Đơn giá', 'Thành tiền', 'Ghi chú', 'Người lập'],
      [12, 12, 9, 12, 16, 22, 26, 8, 12, 12, 14, 36, 18]);
    for (const d of listDocs(from, to).reverse()) {
      const doc = getDoc(d.id);
      for (const l of doc.lines) addRow(s2, [vn(d.doc_date), d.kind_txt, 'PK' + String(d.id).padStart(5, '0'), d.shift_name, d.kitchen_name, d.supplier, l.name, l.unit,
        l.qty, l.price, l.value, d.kind === 'count' ? `Đếm thực tế ${l.counted} · sổ sách ${l.book}` : d.note, d.created_by], { fmt: { 9: QTY, 10: MONEY, 11: MONEY } });
    }
    fname = `nhap_xuat_ton_nguyen_lieu_${from}_${to}.xlsx`;
  } else if (type === 'cost') {
    const R = costReport(from, to, { kitchen, now });
    const s1 = sheet(wb, 'Chi phí mỗi suất', 'CHI PHÍ NGUYÊN LIỆU TRÊN MỖI SUẤT', `${range} · Dự tính = định lượng × đơn giá · Thực xuất = giá trị phiếu xuất kho của bữa · Chi phí/suất lấy số thực xuất nếu đã xuất, chưa xuất thì lấy dự tính`,
      ['Ngày', 'Bữa', 'Bếp', 'Số suất', 'Chi phí dự tính', 'Chi phí thực xuất', 'Chi phí/suất', 'Ghi chú'], [12, 13, 20, 10, 16, 16, 14, 40]);
    for (const r of R.rows) addRow(s1, [vn(r.date), r.shift_name, r.kitchen_name || (R.kitchens.length ? 'Chung / chưa phân bếp' : 'Bếp chung'), r.portions, r.est_cost, r.actual_cost, r.per_portion,
      [r.actual_cost == null ? 'chưa xuất kho — tính theo dự tính' : '', r.missing ? 'có món chưa có định lượng' : ''].filter(Boolean).join(' · ')], { fmt: { 4: '0', 5: MONEY, 6: MONEY, 7: MONEY } });
    const t = R.totals;
    addRow(s1, ['Cộng', '', '', t.portions, t.est_cost, null, t.per_portion, `Tổng chi phí ${t.cost.toLocaleString('vi-VN')} đ`], { bold: true, fill: 'FFE5EDF7', fmt: { 4: '0', 5: MONEY, 7: MONEY } });
    if (R.other) addRow(s1, ['', '', '', null, null, R.other, t.per_portion_all, 'Xuất kho khác (không gắn bữa) — chi phí/suất tính cả phần này'], { fmt: { 6: MONEY, 7: MONEY } });
    fname = `chi_phi_nguyen_lieu_moi_suat_${from}_${to}.xlsx`;
  } else throw userError('Loại báo cáo không hợp lệ');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
  await wb.xlsx.write(res);
  res.end();
}
