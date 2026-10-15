// Test IN GIẤY TỜ NHÂN SỰ theo mẫu Word: điền trường {..} vào .docx (kể cả khi Word cắt trường thành nhiều đoạn chữ),
// đọc số tiền thành chữ, ngày "ngày … tháng … năm …", dữ liệu điền cho hợp đồng / phụ lục / quyết định,
// và 6 mẫu mặc định: mọi trường trong mẫu đều là trường đã biết, điền xong không còn sót "{".
// (server/docx.js + server/hr-docs.js là hàm thuần — không cần CSDL)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { fillXml, fillDocx, buildDocx, listPlaceholders, docxText, EMPTY_MARK } from '../server/docx.js';
import {
  DOC_TEMPLATES, fieldsForTemplate, defaultTemplateBlocks, moneyWords, money, dateWords, termText,
  companyFields, employeeFields, contractFields, annexFields, decisionFields, mergeFields, templateForContract,
} from '../server/hr-docs.js';

const para = (...runs) => `<w:p>${runs.map((t) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`).join('')}</w:p>`;
const texts = (xml) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');

test('số tiền bằng chữ (đúng cách đọc tiếng Việt: mốt, tư, lăm, lẻ, không trăm)', () => {
  assert.equal(moneyWords(0), 'Không đồng');
  assert.equal(moneyWords(5), 'Năm đồng');
  assert.equal(moneyWords(15), 'Mười lăm đồng');
  assert.equal(moneyWords(21), 'Hai mươi mốt đồng');
  assert.equal(moneyWords(24), 'Hai mươi tư đồng');
  assert.equal(moneyWords(105), 'Một trăm lẻ năm đồng');
  assert.equal(moneyWords(9500000), 'Chín triệu năm trăm nghìn đồng');
  assert.equal(moneyWords(1005000), 'Một triệu không trăm lẻ năm nghìn đồng');
  assert.equal(moneyWords(2025000), 'Hai triệu không trăm hai mươi lăm nghìn đồng');
  assert.equal(moneyWords(7650000), 'Bảy triệu sáu trăm năm mươi nghìn đồng');
  assert.equal(moneyWords(1000000000), 'Một tỷ đồng');
  assert.equal(moneyWords(15000000), 'Mười lăm triệu đồng');
  assert.equal(money(7500000), '7.500.000');
  assert.equal(money(0), '');
});

test('ngày bằng chữ: ngày < 10 và tháng 1, 2 thêm số 0 (Nghị định 30/2020/NĐ-CP)', () => {
  assert.equal(dateWords('2026-02-05'), 'ngày 05 tháng 02 năm 2026');
  assert.equal(dateWords('2026-10-15'), 'ngày 15 tháng 10 năm 2026');
  assert.equal(dateWords('2026-03-09'), 'ngày 09 tháng 3 năm 2026');
  assert.equal(dateWords(''), 'ngày …… tháng …… năm ……');
});

test('điền trường bị Word cắt thành nhiều đoạn chữ (khác định dạng) vẫn đúng, giữ nguyên chữ xung quanh', () => {
  const xml = `<w:document><w:body><w:p><w:r><w:t>Họ tên: {ho_</w:t></w:r><w:proofErr w:type="spellStart"/><w:r><w:rPr><w:b/></w:rPr><w:t>ten</w:t></w:r><w:r><w:t xml:space="preserve">} – mã {ma_nv}.</w:t></w:r></w:p></w:body></w:document>`;
  const out = fillXml(xml, { ho_ten: 'Trần Thị Bình', ma_nv: 'NV025' });
  assert.equal(texts(out), 'Họ tên: Trần Thị Bình – mã NV025.');
  assert.ok(out.includes('<w:b/>'), 'giữ định dạng của các đoạn chữ');
});

test('nhiều trường trong 1 đoạn chữ; viết hoa / có khoảng trắng trong ngoặc vẫn nhận', () => {
  const out = fillXml(para('{ho_ten} ({MA_NV}) – { gioi_tinh }'), { ho_ten: 'A', ma_nv: 'B', gioi_tinh: 'Nữ' });
  assert.equal(texts(out), 'A (B) – Nữ');
});

test('trường không vắt qua 2 đoạn văn khác nhau', () => {
  const xml = para('{ho_') + para('ten}');
  assert.equal(fillXml(xml, { ho_ten: 'X' }), xml);
});

test('ký tự đặc biệt được mã hoá XML; xuống dòng → ngắt dòng Word', () => {
  const out = fillXml(para('{ghi_chu}'), { ghi_chu: 'A & B <c>\ndòng 2' });
  assert.ok(out.includes('A &amp; B &lt;c&gt;'));
  assert.ok(out.includes('</w:t><w:br/><w:t xml:space="preserve">dòng 2'));
});

test('trường lạ giữ nguyên + báo; trường rỗng in thành dấu chấm + báo', () => {
  const report = { unknown: new Set(), empty: new Set() };
  const out = fillXml(para('{ho_tne} | {cccd}'), { cccd: '' }, report);
  assert.equal(texts(out), `{ho_tne} | ${EMPTY_MARK}`);
  assert.deepEqual([...report.unknown], ['ho_tne']);
  assert.deepEqual([...report.empty], ['cccd']);
});

test('fillDocx điền cả đầu trang / chân trang; file vẫn là .docx hợp lệ', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', `<w:document><w:body>${para('Xin chào {ho_ten}')}</w:body></w:document>`);
  zip.file('word/header1.xml', `<w:hdr>${para('{cong_ty}')}</w:hdr>`);
  zip.file('word/styles.xml', '<w:styles>{ho_ten}</w:styles>');   // phần không phải văn bản: không đụng
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  assert.deepEqual((await listPlaceholders(buf)).sort(), ['cong_ty', 'ho_ten']);
  const r = await fillDocx(buf, { ho_ten: 'Bình', cong_ty: 'ABC' });
  const z2 = await JSZip.loadAsync(r.buffer);
  assert.equal(texts(await z2.file('word/document.xml').async('string')), 'Xin chào Bình');
  assert.equal(texts(await z2.file('word/header1.xml').async('string')), 'ABC');
  assert.equal(await z2.file('word/styles.xml').async('string'), '<w:styles>{ho_ten}</w:styles>');
  await assert.rejects(() => fillDocx(Buffer.from('không phải zip'), {}), /docx/);
});

// Dữ liệu mẫu đầy đủ cho mọi loại giấy tờ
const CO = { name: 'Công ty TNHH ABC', address: '12 Nguyễn Huệ, Q.1, TP.HCM', tax: '0312345678', phone: '028 3822 1234', rep: 'Nguyễn Văn Giám', rep_title: 'Giám đốc', place: 'TP. Hồ Chí Minh' };
const EMP = { code: 'NV025', full_name: 'Trần Thị Bình', phone: '0901234567', department: 'Kế toán', position: 'Kế toán viên', start_date: '2026-03-01' };
const PROF = { gender: 'Nữ', birth_date: '1995-05-20', birth_place: 'Hà Nội', hometown: 'Nam Định', ethnicity: 'Kinh', id_number: '001195012345', id_issue_date: '2021-08-10',
  id_issue_place: 'Cục CS QLHC', tax_code: '8123456789', si_number: '7912345678', permanent_address: '5 Lê Lợi, Nam Định', current_address: '20 Võ Văn Tần, Q.3',
  personal_email: 'b@x.vn', education_level: 'Đại học', major: 'Kế toán', bank_account: '0123456789', bank_name: 'Vietcombank', bank_branch: 'CN Sài Gòn' };
const HD = { id: 1, contract_no: '15/2026/HĐLĐ', ctype: 'xac_dinh', term_months: 12, sign_date: '2026-02-27', start_date: '2026-03-01', end_date: '2027-02-28',
  department: 'Kế toán', position: 'Kế toán viên', work_place: 'Văn phòng TP.HCM', salary: 9000000, insurance_salary: 6000000, allowance: 'Ăn trưa 730.000đ', signer: '', note: 'Ghi chú' };
function sample(tplKey) {
  const ef = employeeFields(EMP, PROF, 'Lê Văn Cường');
  const base = [companyFields(CO, '2026-10-15'), ef];
  if (tplKey === 'hd_thu_viec') return mergeFields(...base, contractFields({ ...HD, ctype: 'thu_viec', end_date: '2026-04-29', term_months: 2 }, CO));
  if (tplKey === 'hd_dich_vu') return mergeFields(...base, contractFields({ ...HD, ctype: 'dich_vu' }, CO));
  if (tplKey === 'hd_lao_dong') return mergeFields(...base, contractFields(HD, CO));
  if (tplKey === 'phu_luc') return mergeFields(...base, contractFields(HD, CO), annexFields({ annex_no: '01/PL', sign_date: '2026-09-01', effective_date: '2026-09-01', salary: 11000000, position: 'Kế toán tổng hợp', content: 'Bổ sung phụ cấp' }));
  if (tplKey === 'qd_thuyen_chuyen') return mergeFields(...base, decisionFields({ kind: 'transfer', sub_kind: 'Điều chuyển', decision_no: '08/QĐ', decision_date: '2026-10-20', effective_date: '2026-11-01',
    from_department: 'Kế toán', to_department: 'Kinh doanh', from_position: 'Kế toán viên', to_position: 'Trưởng nhóm', reason: 'Nhu cầu', signer: '', note: 'x' }, ef, CO));
  return mergeFields(...base, decisionFields({ kind: 'resign', sub_kind: 'tu_nguyen', decision_no: '12/QĐ', decision_date: '2026-10-25', effective_date: '2026-11-01', request_date: '2026-10-01',
    reason: 'Gia đình', note: 'x', signer: '', handover: JSON.stringify([{ t: 'Bàn giao hồ sơ', done: false }, { t: 'Trả thẻ', done: true }]) }, ef, CO, HD));
}

test('6 mẫu mặc định: mọi trường đều là trường đã biết của đúng loại giấy tờ; điền đủ thì không sót "{" và không chỗ trống', async () => {
  for (const [key] of DOC_TEMPLATES) {
    const tpl = await buildDocx(defaultTemplateBlocks(key));
    const used = await listPlaceholders(tpl);
    const valid = fieldsForTemplate(key);
    assert.ok(used.length > 10, key + ' có trường tự điền');
    assert.deepEqual(used.filter((k) => !valid.has(k)), [], key + ': trường lạ trong mẫu mặc định');
    const r = await fillDocx(tpl, sample(key));
    assert.deepEqual(r.unknown, [], key);
    assert.deepEqual(r.empty, [], key + ': dữ liệu mẫu đầy đủ thì không có chỗ trống');
    const txt = await docxText(r.buffer);
    assert.ok(!txt.includes('{'), key + ' còn sót trường chưa điền');
    assert.ok(txt.includes('Trần Thị Bình') && txt.includes('CÔNG TY TNHH ABC'), key);
  }
});

test('nội dung điền: thời hạn, lương bằng chữ, phụ lục, quyết định thuyên chuyển / nghỉ việc', async () => {
  const hd = await docxText((await fillDocx(await buildDocx(defaultTemplateBlocks('hd_lao_dong')), sample('hd_lao_dong'))).buffer);
  assert.ok(hd.includes('12 tháng, từ ngày 01/03/2026 đến hết ngày 28/02/2027'));
  assert.ok(hd.includes('9.000.000 đồng/tháng (Bằng chữ: Chín triệu đồng)'));
  assert.ok(hd.includes('TP. Hồ Chí Minh, ngày 27 tháng 02 năm 2026'));
  assert.ok(hd.includes('Bà Trần Thị Bình'));
  const tv = await docxText((await fillDocx(await buildDocx(defaultTemplateBlocks('hd_thu_viec')), sample('hd_thu_viec'))).buffer);
  assert.ok(tv.includes('60 ngày, từ ngày 01/03/2026 đến hết ngày 29/04/2026'));
  const pl = await docxText((await fillDocx(await buildDocx(defaultTemplateBlocks('phu_luc')), sample('phu_luc'))).buffer);
  assert.ok(pl.includes('11.000.000 đồng/tháng (Bằng chữ: Mười một triệu đồng)') && pl.includes('Kế toán tổng hợp'));
  const tc = await docxText((await fillDocx(await buildDocx(defaultTemplateBlocks('qd_thuyen_chuyen')), sample('qd_thuyen_chuyen'))).buffer);
  assert.ok(tc.includes('Về việc điều chuyển nhân sự') && tc.includes('bộ phận Kinh doanh, chức danh Trưởng nhóm'));
  const nv = await docxText((await fillDocx(await buildDocx(defaultTemplateBlocks('qd_nghi_viec')), sample('qd_nghi_viec'))).buffer);
  assert.ok(nv.includes('kể từ ngày 01/11/2026 (ngày làm việc cuối cùng: 31/10/2026)'));
  assert.ok(nv.includes('Đơn xin nghỉ việc của Bà Trần Thị Bình ngày 01/10/2026'));
  assert.ok(nv.includes('- Bàn giao hồ sơ\n- Trả thẻ'));
  assert.ok(nv.includes('Hợp đồng lao động số 15/2026/HĐLĐ ký ngày 27/02/2026'));
});

test('chọn mẫu theo loại HĐ; câu thời hạn; HĐ ghi bộ phận riêng thì đè bộ phận hiện tại; người ký trên HĐ thay người đại diện', () => {
  assert.equal(templateForContract('thu_viec'), 'hd_thu_viec');
  assert.equal(templateForContract('xac_dinh'), 'hd_lao_dong');
  assert.equal(templateForContract('khong_xac_dinh'), 'hd_lao_dong');
  assert.equal(templateForContract('dich_vu'), 'hd_dich_vu');
  assert.equal(termText({ ctype: 'khong_xac_dinh', start_date: '2026-03-01', end_date: '' }), 'Không xác định thời hạn, kể từ ngày 01/03/2026');
  assert.equal(termText({ ctype: 'xac_dinh', start_date: '2026-03-01', end_date: '2026-08-31', term_months: 0 }), 'Từ ngày 01/03/2026 đến hết ngày 31/08/2026');
  const f = mergeFields(employeeFields(EMP, PROF), contractFields({ ...HD, department: '', position: 'Kế toán trưởng', signer: 'Phó GĐ Lan' }, CO));
  assert.equal(f.bo_phan, 'Kế toán');           // HĐ không ghi bộ phận → lấy bộ phận hiện tại
  assert.equal(f.chuc_danh, 'Kế toán trưởng');  // HĐ ghi chức danh → dùng chức danh trên HĐ
  assert.equal(f.dai_dien, 'Phó GĐ Lan');
  assert.equal(employeeFields({ ...EMP }, { gender: 'Nam' }).xung_ho, 'Ông');
  assert.equal(employeeFields({ ...EMP }, {}).xung_ho, 'Ông/Bà');
  assert.equal(employeeFields({ ...EMP }, {}).quoc_tich, 'Việt Nam');
});
