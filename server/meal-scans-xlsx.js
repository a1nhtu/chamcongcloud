// Excel BÁO CÁO CHI TIẾT LƯỢT ĂN (server/meal-scans.js): sheet "Chi tiết lượt ăn" (mỗi lượt quét 1 dòng) + sheet "Tổng hợp" (theo bữa, theo trạng thái).
// Một tháng có thể vài trăm nghìn dòng (2.000 người × 5 bữa × 31 ngày) → bộ ghi LUỒNG của ExcelJS, mỗi kiểu ô dùng chung 1 đối tượng style
// (ExcelJS chỉ nhận ra kiểu trùng khi cùng đối tượng), ghi xong dòng nào đẩy dòng đó ra file.
import ExcelJS from 'exceljs';

const vn = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
const vnTime = (iso) => (iso ? new Date(Date.parse(iso) + 7 * 3600000).toISOString().slice(11, 16) : '');
const hm = (m) => (m == null ? '' : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`);
const thin = { style: 'thin', color: { argb: 'FFCBD5E1' } }, border = { top: thin, bottom: thin, left: thin, right: thin };
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const S = {
  title: { font: { bold: true, size: 14, color: { argb: 'FF1E3A68' } } },
  sub: { font: { italic: true, color: { argb: 'FF64748B' } } },
  head: { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: fill('FF1E3A68'), border, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } },
  txt: { border },
  mid: { border, alignment: { horizontal: 'center' } },
  money: { border, numFmt: '#,##0' },
  tot: { border, font: { bold: true }, fill: fill('FFE5EDF7') },
  totMoney: { border, font: { bold: true }, fill: fill('FFE5EDF7'), numFmt: '#,##0' },
};
const ST_FILL = { thieu: fill('FFFDE2E1'), cho: fill('FFFEF3C7'), lap: fill('FFF1F5F9'), nghi: fill('FFFDE2E1'), la: fill('FFFDE2E1') };
const stStyle = Object.fromEntries(Object.entries(ST_FILL).map(([k, f]) => [k, { border, fill: f, font: { bold: true } }]));

function put(ws, vals, styles) {
  const row = ws.addRow(vals);
  vals.forEach((_, i) => { row.getCell(i + 1).style = Array.isArray(styles) ? (styles[i] || S.txt) : styles; });
  return row;
}

export async function writeMealScansXlsx(res, r) {
  const range = r.from === r.to ? `Ngày ${vn(r.from)}` : `Từ ${vn(r.from)} đến ${vn(r.to)}`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="chi_tiet_luot_an_${r.from}_${r.to}.xlsx"`);
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true, useSharedStrings: true });
  wb.creator = 'Digiplus';
  const head = ['STT', 'Ngày ăn', 'Giờ ăn', 'Bữa', 'Mã NV', 'Họ tên', 'Bộ phận', 'Máy', 'Số máy', 'Hình thức', 'Đơn giá', 'Tăng ca thực tế', 'Trạng thái', 'Ghi chú',
    'Ngày vào làm', 'Ngày nghỉ việc', 'Quốc tịch', 'Loại NV'];
  const widths = [7, 11, 8, 14, 11, 26, 22, 18, 8, 11, 11, 11, 20, 40, 12, 12, 12, 14];
  const ws = wb.addWorksheet('Chi tiết lượt ăn', { views: [{ state: 'frozen', ySplit: 3 }] });
  ws.columns = widths.map((w) => ({ width: w }));
  put(ws, [`${r.company ? r.company + ' — ' : ''}CHI TIẾT LƯỢT ĂN`], S.title).commit();
  put(ws, [`${range} · Đơn giá ${r.price ? r.price.toLocaleString('vi-VN') + ' đ/suất' : 'chưa đặt (Cấu hình suất ăn)'} · Mỗi người 1 suất/bữa: lượt quẹt sau trong cùng bữa = quẹt lặp, không tính tiền · Bữa tăng ca xét theo tăng ca thực tế của ngày công`], S.sub).commit();
  const h = put(ws, head, S.head); h.height = 30; h.commit();
  const styles = [S.mid, S.mid, S.mid, S.txt, S.txt, S.txt, S.txt, S.txt, S.mid, S.txt, S.money, S.mid, S.txt, S.txt, S.mid, S.mid, S.txt, S.txt];
  let i = 0;
  for (const x of r.rows) {
    const st = styles.slice(); if (stStyle[x.status]) st[12] = stStyle[x.status];
    put(ws, [++i, vn(x.date), vnTime(x.at), x.shift_name, x.code, x.full_name, x.department, x.device, x.machine_number || '', x.verify,
      x.price || (x.counted ? 0 : ''), x.ot_meal ? hm(x.ot) : '', x.status_text, x.note, vn(x.start_date), vn(x.leave_date), x.nationality, x.emp_type], st).commit();
    if (i % 2000 === 0) { await new Promise(setImmediate); if (res.destroyed) throw new Error('Người dùng đã huỷ tải file'); }
  }
  const t = r.totals;
  put(ws, ['Tổng cộng', '', '', '', '', `${t.meals.toLocaleString('vi-VN')} suất`, '', '', '', '', t.amount, '', `${t.rows.toLocaleString('vi-VN')} lượt`, '', '', '', '', ''],
    [S.tot, S.tot, S.tot, S.tot, S.tot, S.tot, S.tot, S.tot, S.tot, S.tot, S.totMoney, S.tot, S.tot, S.tot, S.tot, S.tot, S.tot, S.tot]).commit();
  await ws.commit();

  const s2 = wb.addWorksheet('Tổng hợp');
  s2.columns = [{ width: 26 }, { width: 14 }, { width: 16 }];
  put(s2, ['TỔNG HỢP LƯỢT ĂN'], S.title).commit();
  put(s2, [range], S.sub).commit();
  put(s2, ['Bữa', 'Số suất', 'Thành tiền'], S.head).commit();
  for (const b of t.by_shift) put(s2, [b.shift_name, b.meals, b.amount], [S.txt, S.mid, S.money]).commit();
  put(s2, ['Tổng cộng', t.meals, t.amount], [S.tot, S.tot, S.totMoney]).commit();
  s2.addRow([]).commit();
  put(s2, ['Trạng thái', 'Số lượt', ''], S.head).commit();
  for (const [k, label] of Object.entries(r.statuses)) put(s2, [label, t.by[k] || 0, ''], [S.txt, S.mid, S.txt]).commit();
  if (r.outside) put(s2, ['Quẹt ngoài giờ ăn (không tính, không có trong bảng)', r.outside, ''], [S.txt, S.mid, S.txt]).commit();
  await s2.commit();
  await wb.commit();
}
