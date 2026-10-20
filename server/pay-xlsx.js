// TIỀN LƯƠNG NÂNG CAO — xuất / nhập Excel: bảng lương, file chuyển khoản, dữ liệu theo kỳ, tạm ứng, báo cáo.
import ExcelJS from 'exceljs';
import { normText, cellText, parseMoneyCell, parseDateCell } from './hr-import.js';

const NAVY = 'FF1E3A8A';
export async function sendXlsx(res, wb, name) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  await wb.xlsx.write(res);
  res.end();
}

// 1 trang tính dạng bảng: tiêu đề + dòng phụ + đầu cột xanh + số tiền #,##0 + dòng tổng
export function tableSheet(wb, sheetName, { company, title, subtitle, cols, rows, totals = true, freeze = 3 }) {
  const ws = wb.addWorksheet(String(sheetName).slice(0, 31).replace(/[\\/?*[\]:]/g, '-'));
  const n = cols.length;
  let r = 1;
  if (company) { ws.getCell(r, 1).value = company; ws.getCell(r, 1).font = { bold: true }; r++; }
  ws.getCell(r, 1).value = title; ws.getCell(r, 1).font = { bold: true, size: 14 };
  ws.mergeCells(r, 1, r, Math.max(1, n)); ws.getCell(r, 1).alignment = { horizontal: 'center' }; r++;
  if (subtitle) { ws.getCell(r, 1).value = subtitle; ws.mergeCells(r, 1, r, Math.max(1, n)); ws.getCell(r, 1).alignment = { horizontal: 'center' }; ws.getCell(r, 1).font = { italic: true, color: { argb: 'FF555555' } }; r++; }
  r++;
  const head = ws.getRow(r);
  head.values = ['STT', ...cols.map((c) => c.label)];
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.height = 34;
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }; c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }; });
  const headRow = r;
  rows.forEach((row, i) => {
    const x = ws.getRow(++r);
    x.values = [i + 1, ...cols.map((c) => (c.type === 'text' ? (row[c.key] ?? '') : (row[c.key] == null || row[c.key] === '' ? null : Number(row[c.key]))))];
  });
  if (totals && rows.length) {
    const t = ws.getRow(++r);
    t.values = ['', ...cols.map((c, j) => (j === 0 ? 'TỔNG CỘNG' : c.type === 'money' ? rows.reduce((s, row) => s + (Number(row[c.key]) || 0), 0) : null))];
    t.font = { bold: true };
    t.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF3FB' } }; });
  }
  ws.getColumn(1).width = 6;
  cols.forEach((c, j) => {
    const col = ws.getColumn(j + 2);
    col.width = c.type === 'text' ? (/HO_TEN|full_name|name|holder/i.test(c.key) ? 26 : 16) : 14;
    if (c.type === 'money') col.numFmt = '#,##0';
    else if (c.type === 'num') col.numFmt = '#,##0.##';
  });
  for (let i = headRow + 1; i <= r; i++) ws.getRow(i).eachCell({ includeEmpty: false }, (c) => { c.border = { top: { style: 'hair' }, bottom: { style: 'hair' }, left: { style: 'hair' }, right: { style: 'hair' } }; });
  ws.views = [{ state: 'frozen', xSplit: Math.min(freeze, n + 1), ySplit: headRow }];
  return ws;
}

export async function readFirstSheet(b64) {
  const buf = Buffer.from(String(b64 || '').replace(/^data:.*;base64,/, ''), 'base64');
  if (!buf.length) throw Object.assign(new Error('Thiếu file'), { user: true });
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf); } catch { throw Object.assign(new Error('File Excel không đọc được (cần file .xlsx)'), { user: true }); }
  const ws = wb.worksheets[0];
  if (!ws) throw Object.assign(new Error('File rỗng'), { user: true });
  const rows = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => { rows[n - 1] = row.values; });
  return rows;
}
// Tìm dòng tiêu đề có ô "Mã NV" trong 10 dòng đầu → { headerRow, codeCol, cols: Map(chỉ số cột → tiêu đề) }
export function findHeader(rows) {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const v = rows[i] || [];
    const idx = v.findIndex((c) => ['ma nv', 'ma nhan vien'].includes(normText(cellText(c))));
    if (idx > 0) {
      const cols = new Map();
      v.forEach((c, j) => { const t = cellText(c); if (t) cols.set(j, t); });
      return { headerRow: i, codeCol: idx, cols };
    }
  }
  return null;
}
export { normText, cellText, parseMoneyCell, parseDateCell, ExcelJS };
