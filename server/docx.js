// Tạo / điền file Word (.docx) — dùng cho in hợp đồng, quyết định của phân hệ Nhân sự.
// KHÔNG thêm thư viện: .docx là file zip chứa XML, đọc/ghi bằng `jszip` (có sẵn trong node_modules vì exceljs dùng nó).
//  - fillDocx(buf, data): thay các trường {ten_truong} trong văn bản (cả đầu trang / chân trang) bằng dữ liệu.
//    Word hay tự cắt 1 trường thành nhiều đoạn chữ (do kiểm tra chính tả, đổi định dạng giữa chừng) → ghép
//    nội dung các <w:t> trong cùng 1 đoạn văn rồi mới tìm trường, nên vẫn thay đúng.
//  - buildDocx(blocks): dựng file .docx đơn giản từ danh sách đoạn văn / bảng 2 cột (mẫu mặc định).
import JSZip from 'jszip';

export const EMPTY_MARK = '…………';   // trường không có dữ liệu → để chỗ trống cho viết tay
const PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;
const T_RE = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<\/w:p>/g;
const PH_RE = /\{\s*([A-Za-z0-9_]+)\s*\}/g;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Word: "không giãn chữ ở dòng kết thúc bằng Shift+Enter" — danh sách nhiều dòng trong đoạn căn đều không bị dàn chữ
const NO_EXPAND = '<w:doNotExpandShiftReturn/>';

// Quét các <w:t> của 1 phần XML → danh sách nút + chuỗi phẳng (mỗi hết đoạn văn chèn \u0001 để trường không vắt qua 2 đoạn)
function scan(xml) {
  const nodes = [];
  let flat = '', m;
  T_RE.lastIndex = 0;
  while ((m = T_RE.exec(xml))) {
    if (m[0] === '</w:p>') { flat += '\u0001'; continue; }
    const openLen = m[0].indexOf('>') + 1;
    nodes.push({ s: m.index, e: m.index + m[0].length, openLen, text: m[1], fs: flat.length, fe: flat.length + m[1].length });
    flat += m[1];
  }
  return { nodes, flat };
}

// Tên các trường có trong 1 phần XML (chữ thường)
export function placeholdersInXml(xml) {
  const { flat } = scan(xml);
  const out = new Set();
  for (const m of flat.matchAll(PH_RE)) out.add(m[1].toLowerCase());
  return out;
}

// Điền 1 phần XML. data: { key: giá trị } — key chữ thường; giá trị rỗng/null → EMPTY_MARK;
// key không có trong data (undefined) → giữ nguyên "{key}" và ghi vào `unknown`. Xuống dòng (\n) → ngắt dòng Word.
export function fillXml(xml, data, report = { unknown: new Set(), empty: new Set() }) {
  const { nodes, flat } = scan(xml);
  const matches = [];
  for (const m of flat.matchAll(PH_RE)) {
    const key = m[1].toLowerCase();
    let val;
    if (data[key] === undefined) { report.unknown.add(key); val = esc(m[0]); }
    else {
      let v = data[key];
      if (v == null || String(v).trim() === '') { report.empty.add(key); v = EMPTY_MARK; }
      val = String(v).split(/\r?\n/).map(esc).join('</w:t><w:br/><w:t xml:space="preserve">');
    }
    matches.push({ s: m.index, e: m.index + m[0].length, val });
  }
  if (!matches.length) return xml;
  let out = '', last = 0, k = 0;
  for (const n of nodes) {
    while (k < matches.length && matches[k].e <= n.fs) k++;
    if (k >= matches.length || matches[k].s >= n.fe) continue;   // nút này không dính trường nào
    let res = '', p = n.fs, j = k;
    while (p < n.fe) {
      const M = matches[j];
      if (!M || M.s >= n.fe) { res += flat.slice(p, n.fe); break; }
      if (M.s > p) { res += flat.slice(p, M.s); p = M.s; continue; }
      if (p === M.s) res += M.val;           // chèn giá trị đúng 1 lần, tại nút chứa ký tự "{"
      p = Math.min(M.e, n.fe);              // phần còn lại của trường (nếu vắt sang nút sau) bị bỏ
      if (M.e <= n.fe) j++;
    }
    out += xml.slice(last, n.s) + '<w:t xml:space="preserve">' + res + '</w:t>';
    last = n.e;
  }
  return out + xml.slice(last);
}

async function loadZip(buf) {
  let zip;
  try { zip = await JSZip.loadAsync(buf); } catch { throw new Error('File không phải .docx hợp lệ (lưu lại bằng Word dạng .docx)'); }
  if (!zip.file('word/document.xml')) throw new Error('File không phải .docx hợp lệ (thiếu word/document.xml)');
  return zip;
}

// Các trường dùng trong 1 file .docx
export async function listPlaceholders(buf) {
  const zip = await loadZip(buf);
  const out = new Set();
  for (const name of Object.keys(zip.files).filter((n) => PARTS.test(n))) {
    for (const k of placeholdersInXml(await zip.file(name).async('string'))) out.add(k);
  }
  return [...out];
}

// Điền dữ liệu vào file .docx → { buffer, unknown:[], empty:[] }
export async function fillDocx(buf, data) {
  const zip = await loadZip(buf);
  const report = { unknown: new Set(), empty: new Set() };
  for (const name of Object.keys(zip.files).filter((n) => PARTS.test(n))) {
    const xml = await zip.file(name).async('string');
    const filled = fillXml(xml, data, report);
    if (filled !== xml) zip.file(name, filled);
  }
  // mẫu riêng của khách + trường nhiều dòng: thêm thiết lập trên vào <w:compat> sẵn có (không tự tạo mới để khỏi sai thứ tự XML)
  if (Object.values(data).some((v) => /\n/.test(String(v ?? ''))) && zip.file('word/settings.xml')) {
    const st = await zip.file('word/settings.xml').async('string');
    if (!st.includes('doNotExpandShiftReturn') && /<w:compat\s*>/.test(st)) zip.file('word/settings.xml', st.replace(/<w:compat\s*>/, (m) => m + NO_EXPAND));
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { buffer, unknown: [...report.unknown], empty: [...report.empty] };
}

/* ------------------------- Dựng .docx từ khối nội dung ------------------------- */
// Khối: { p: 'chữ có **đậm**', align: 'center'|'both'|'right'|'left', bold, italic, underline, size (pt),
//         indent (thụt đầu dòng 1 cm), before/after (pt), tab (cm — điểm dừng tab cho '\t') }
//       { table: [[khối cột trái…], [khối cột phải…]], widths: [twip, twip] }  — bảng 2 cột không viền
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const PAGE_W = 11906, MARGIN_L = 1701, MARGIN_R = 850;   // A4, lề trái 3 cm, phải 1,5 cm (Nghị định 30/2020: 15–20 mm)
export const TEXT_W = PAGE_W - MARGIN_L - MARGIN_R;

function runXml(text, o) {
  const rpr = (o.bold ? '<w:b/><w:bCs/>' : '') + (o.italic ? '<w:i/><w:iCs/>' : '')
    + (o.size ? `<w:sz w:val="${o.size * 2}"/><w:szCs w:val="${o.size * 2}"/>` : '') + (o.underline ? '<w:u w:val="single"/>' : '');
  // luôn có ít nhất 1 dấu cách trước tab: chữ bên trái dài quá điểm dừng tab thì vẫn không dính vào chữ bên phải
  const parts = String(text).split('\t');
  const body = parts.map((t, i) => (i < parts.length - 1 && t && !/\s$/.test(t) ? t + ' ' : t))
    .map((t) => (t ? `<w:t xml:space="preserve">${esc(t)}</w:t>` : '')).join('<w:tab/>');
  return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}${body}</w:r>`;
}
function pXml(b) {
  let ppr = b.keepNext ? '<w:keepNext/>' : '';   // tiêu đề Điều không đứng lẻ cuối trang (phải đứng TRƯỚC tabs/spacing trong w:pPr)
  if (b.tab) ppr += `<w:tabs><w:tab w:val="left" w:pos="${Math.round(b.tab * 567)}"/></w:tabs>`;
  ppr += `<w:spacing w:before="${Math.round((b.before || 0) * 20)}" w:after="${Math.round((b.after ?? 3) * 20)}" w:line="${b.line || 276}" w:lineRule="auto"/>`;
  if (b.indent) ppr += '<w:ind w:firstLine="567"/>';
  else if (b.left) ppr += `<w:ind w:left="${Math.round(b.left * 567)}"/>`;   // thụt trái CẢ đoạn (cm) — danh sách nhiều dòng
  if (b.align) ppr += `<w:jc w:val="${b.align}"/>`;
  // **đậm** trong câu: tách thành nhiều đoạn chữ
  const runs = String(b.p || '').split('**').map((seg, i) => (seg ? runXml(seg, { ...b, bold: b.bold || i % 2 === 1 }) : '')).join('');
  return `<w:p><w:pPr>${ppr}</w:pPr>${runs}</w:p>`;
}
function tableXml(b) {
  const widths = b.widths || [Math.round(TEXT_W * 0.42), TEXT_W - Math.round(TEXT_W * 0.42)];
  const none = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((k) => `<w:${k} w:val="nil"/>`).join('');
  const cells = b.table.map((col, i) => `<w:tc><w:tcPr><w:tcW w:w="${widths[i]}" w:type="dxa"/></w:tcPr>${col.map(pXml).join('') || '<w:p/>'}</w:tc>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, x) => a + x, 0)}" w:type="dxa"/><w:tblBorders>${none}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblLook w:val="0000"/></w:tblPr>`
    + `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr>${cells}</w:tr></w:tbl>`;   // khối chữ ký không bị cắt đôi qua 2 trang
}

export async function buildDocx(blocks, { title = '' } = {}) {
  // văn bản Word phải kết thúc bằng 1 đoạn văn (không được là bảng) — đoạn này cao 1pt để không đẻ ra trang trắng khi trang đã đầy
  const TAIL = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>';
  const body = blocks.map((b) => (b.table ? tableXml(b) : pXml(b))).join('') + (blocks.length && blocks[blocks.length - 1].table ? TAIL : '');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '</Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    + '</Relationships>');
  zip.file('docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">'
    + `<dc:title>${esc(title)}</dc:title><dc:creator>Digiplus</dc:creator></cp:coreProperties>`);
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>'
    + '</Relationships>');
  zip.file('word/settings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ${W_NS}><w:compat>${NO_EXPAND}</w:compat></w:settings>`);
  // Times New Roman 13 — cỡ chữ văn bản hành chính (Nghị định 30/2020/NĐ-CP)
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W_NS}>`
    + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>'
    + '<w:sz w:val="26"/><w:szCs w:val="26"/><w:lang w:val="vi-VN" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>'
    + '<w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>'
    + '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
    + '</w:styles>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W_NS}><w:body>${body}`
    + `<w:sectPr><w:pgSz w:w="${PAGE_W}" w:h="16838"/><w:pgMar w:top="1134" w:right="${MARGIN_R}" w:bottom="1134" w:left="${MARGIN_L}" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`
    + '</w:body></w:document>');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

// Toàn bộ chữ của file .docx (mỗi đoạn 1 dòng) — dùng cho test / kiểm tra nhanh
export async function docxText(buf) {
  const zip = await loadZip(buf);
  const xml = await zip.file('word/document.xml').async('string');
  return xml.replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
