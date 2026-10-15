// Test NHẬP EXCEL phân hệ Nhân sự — đọc ô Excel (server/hr-import.js, hàm thuần):
// ngày (ô ngày / số serial / chữ dd/mm/yyyy), tiền, loại hợp đồng, ô chọn, số CCCD mất số 0, dò cột theo tiêu đề.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  parseDateCell, parseMoneyCell, mapContractType, matchOption, fixIdNumber, fixPhone, headerMap, cellText, normText,
  PROFILE_COLS, CONTRACT_COLS_X,
} from '../server/hr-import.js';

test('ngày: chữ dd/mm/yyyy (kiểu Việt Nam), yyyy-mm-dd, ô ngày Excel, số serial; ngày sai → null; trống → ""', () => {
  assert.equal(parseDateCell('20/05/1995'), '1995-05-20');
  assert.equal(parseDateCell('5/1/2026'), '2026-01-05');          // ngày/tháng, KHÔNG đảo kiểu Mỹ
  assert.equal(parseDateCell('05-01-2026'), '2026-01-05');
  assert.equal(parseDateCell('05.01.2026'), '2026-01-05');
  assert.equal(parseDateCell('2026-01-05'), '2026-01-05');
  assert.equal(parseDateCell(new Date(Date.UTC(1995, 4, 20))), '1995-05-20');
  assert.equal(parseDateCell(45658), '2025-01-01');               // số serial ngày của Excel
  assert.equal(parseDateCell({ richText: [{ text: '20/05/' }, { text: '1995' }] }), '1995-05-20');
  assert.equal(parseDateCell('31/02/2026'), null);
  assert.equal(parseDateCell('abc'), null);
  assert.equal(parseDateCell(''), '');
  assert.equal(parseDateCell(null), '');
});

test('tiền: số giữ nguyên; chữ "7.500.000 đ" / "7,500,000" → 7500000; rỗng → 0', () => {
  assert.equal(parseMoneyCell(9000000), 9000000);
  assert.equal(parseMoneyCell('7.500.000 đ'), 7500000);
  assert.equal(parseMoneyCell('7,500,000'), 7500000);
  assert.equal(parseMoneyCell({ formula: 'A1*2', result: 1000 }), 1000);
  assert.equal(parseMoneyCell(''), 0);
});

test('loại hợp đồng: tên đầy đủ, tên ngắn, mã; không rõ → null', () => {
  assert.equal(mapContractType('Thử việc'), 'thu_viec');
  assert.equal(mapContractType('Hợp đồng thử việc'), 'thu_viec');
  assert.equal(mapContractType('HĐLĐ không xác định thời hạn'), 'khong_xac_dinh');
  assert.equal(mapContractType('Không xác định thời hạn'), 'khong_xac_dinh');
  assert.equal(mapContractType('Xác định thời hạn'), 'xac_dinh');
  assert.equal(mapContractType('HĐLĐ xác định thời hạn'), 'xac_dinh');
  assert.equal(mapContractType('12 tháng'), 'xac_dinh');
  assert.equal(mapContractType('Cộng tác viên'), 'dich_vu');
  assert.equal(mapContractType('Hợp đồng dịch vụ / cộng tác viên'), 'dich_vu');
  assert.equal(mapContractType('khong_xac_dinh'), 'khong_xac_dinh');
  assert.equal(mapContractType('hợp đồng gì đó'), null);
  assert.equal(mapContractType(''), '');
});

test('ô chọn khớp không phân biệt hoa thường / dấu; số CCCD, SĐT bị Excel đổi thành số → thêm lại số 0', () => {
  assert.equal(matchOption('nu', ['Nam', 'Nữ', 'Khác']), 'Nữ');
  assert.equal(matchOption('ĐẠI HỌC', ['Cao đẳng', 'Đại học']), 'Đại học');
  assert.equal(matchOption('Kỹ sư', ['Cao đẳng', 'Đại học']), null);
  assert.equal(fixIdNumber(1195012345 + 0), '1195012345');        // 10 số: không đoán
  assert.equal(fixIdNumber(11950123456), '011950123456');         // CCCD 12 số mất số 0 đầu
  assert.equal(fixIdNumber(23456789), '023456789');               // CMND 9 số
  assert.equal(fixIdNumber('001195012345'), '001195012345');
  assert.equal(fixPhone(901234567), '0901234567');
  assert.equal(normText('  Mã NV * '), 'ma nv');
});

test('dò cột theo tiêu đề: file mẫu, file đã đổi thứ tự / xoá cột, file "Xuất Excel" của trang Hồ sơ / Hợp đồng', () => {
  const tpl = [[undefined, ...PROFILE_COLS.map((c) => c[1])]];
  const m1 = headerMap(tpl, PROFILE_COLS);
  assert.equal(m1.headerRow, 0);
  assert.equal(m1.map.get('code'), 1);
  assert.equal(m1.map.size, PROFILE_COLS.length);
  // đổi thứ tự + xoá bớt cột, tiêu đề viết khác dấu
  const m2 = headerMap([[undefined, 'Số CCCD / CMND', 'ma nhan vien', 'Ngay sinh']], PROFILE_COLS);
  assert.deepEqual([...m2.map.entries()].sort(), [['birth_date', 3], ['code', 2], ['id_number', 1]]);
  // file xuất của trang Hợp đồng (có thêm cột lạ: Họ tên, Còn (ngày), Trạng thái…)
  const exp = [undefined, 'Số HĐ', 'Mã NV', 'Họ tên', 'Bộ phận', 'Chức danh', 'Loại hợp đồng', 'Ngày ký', 'Hiệu lực từ', 'Đến ngày', 'Còn (ngày)', 'Trạng thái', 'Lương thoả thuận', 'Lương đóng BHXH'];
  const m3 = headerMap([['Tiêu đề phụ'], exp], CONTRACT_COLS_X);
  assert.equal(m3.headerRow, 1);
  assert.equal(m3.map.get('ctype'), 6);
  assert.equal(m3.map.get('start_date'), 8);
  assert.equal(m3.map.get('salary'), 12);
  assert.equal(headerMap([['A', 'B']], CONTRACT_COLS_X), null);   // không có cột Mã NV
});

test('đọc lại file .xlsx thật (ExcelJS): ô ngày, ô chữ định dạng "@", ô số', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('x');
  ws.addRow(['Mã NV *', 'Ngày sinh', 'Ngày cấp', 'Số CCCD / CMND']);
  ws.addRow(['0012', new Date(Date.UTC(1995, 4, 20)), '10/08/2021', '001195012345']);
  ws.getColumn(1).numFmt = '@';
  const buf = await wb.xlsx.writeBuffer();
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buf);
  const rows = [];
  wb2.worksheets[0].eachRow({ includeEmpty: true }, (r, n) => { rows[n - 1] = r.values; });
  const { map } = headerMap(rows, PROFILE_COLS);
  const r = rows[1];
  assert.equal(cellText(r[map.get('code')]), '0012');
  assert.equal(parseDateCell(r[map.get('birth_date')]), '1995-05-20');
  assert.equal(parseDateCell(r[map.get('id_issue_date')]), '2021-08-10');
  assert.equal(fixIdNumber(r[map.get('id_number')]), '001195012345');
});
