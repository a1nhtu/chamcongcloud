// Nhóm route IN GIẤY TỜ NHÂN SỰ theo mẫu Word: quản lý mẫu (mặc định / mẫu riêng của công ty), thông tin công ty
// trên giấy tờ, in hợp đồng / phụ lục / quyết định ra file .docx đã điền sẵn. Mọi route cần quyền "hr".
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, extname } from 'node:path';
import { db, getSetting, setSetting } from '../../db.js';
import { sendCaughtError } from '../../util.js';
import { hrFilesDir, hrToday, hrGate } from '../../hr.js';
import { currentContract, addDays, isDate } from '../../hr-rules.js';
import { buildDocx, fillDocx, listPlaceholders } from '../../docx.js';
import {
  DOC_TEMPLATES, DOC_TEMPLATE_KEYS, DOC_FIELD_GROUPS, templateForContract, fieldsForTemplate, fieldLabel, defaultTemplateBlocks,
  companyFields, employeeFields, contractFields, annexFields, decisionFields, mergeFields,
} from '../../hr-docs.js';

// Mẫu riêng của công ty: data/hr-files/_templates/<key>.docx (không phát công khai, có trong "Sao lưu toàn bộ")
const tplDir = () => join(hrFilesDir(), '_templates');
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// Thông tin công ty in trên giấy tờ: [setting, trường trong co, nhãn]
const CO_KEYS = [['hr_doc_company', 'name'], ['hr_doc_address', 'address'], ['hr_doc_tax', 'tax'], ['hr_doc_phone', 'phone'],
  ['hr_doc_rep', 'rep'], ['hr_doc_rep_title', 'rep_title'], ['hr_doc_place', 'place']];

// Để trống thì lấy tên / địa chỉ ở Cài đặt chung. Tên "Digiplus" là tên mặc định của bản cài mới → không in lên giấy tờ của khách.
export function docCompany() {
  const appName = getSetting('company_name', '');
  return {
    name: getSetting('hr_doc_company', '') || (appName && appName !== 'Digiplus' ? appName : ''),
    address: getSetting('hr_doc_address', '') || getSetting('company_address', ''),
    tax: getSetting('hr_doc_tax', ''), phone: getSetting('hr_doc_phone', ''), rep: getSetting('hr_doc_rep', ''),
    rep_title: getSetting('hr_doc_rep_title', '') || 'Giám đốc', place: getSetting('hr_doc_place', ''),
  };
}
const tplMeta = () => { try { return JSON.parse(getSetting('hr_doc_templates', '{}')) || {}; } catch { return {}; } };
const customPath = (key) => join(tplDir(), key + '.docx');
const hasCustom = (key) => existsSync(customPath(key));
async function templateBuffer(key, which = 'current') {
  if (which !== 'default' && hasCustom(key)) return readFileSync(customPath(key));
  return buildDocx(defaultTemplateBlocks(key), { title: (DOC_TEMPLATES.find((t) => t[0] === key) || [])[1] });
}
const safeName = (s) => String(s).replace(/[\\/:*?"<>|\r\n]+/g, '-').slice(0, 120);
const asciiName = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^\w.-]+/g, '_');
function sendDocx(res, buffer, fileName) {
  res.setHeader('Content-Type', DOCX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${asciiName(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.setHeader('Cache-Control', 'no-store');
  res.end(buffer);
}
// Điền mẫu rồi gửi; báo chỗ còn trống qua header (giao diện nhắc bổ sung): X-Doc-Missing-Co = thiếu thông tin công ty,
// X-Doc-Missing = các trường khác (hồ sơ NV / hợp đồng / quyết định)
const CO_FIELDS = new Set(DOC_FIELD_GROUPS.find((g) => g[0] === 'cty')[3].map((f) => f[0]));
async function sendFilled(res, tplKey, data, fileName) {
  const { buffer, empty, unknown } = await fillDocx(await templateBuffer(tplKey), data);
  if (empty.some((k) => CO_FIELDS.has(k))) res.setHeader('X-Doc-Missing-Co', '1');
  const missing = [...new Set(empty.filter((k) => !CO_FIELDS.has(k)).map((k) => fieldLabel(k).replace(/\s*\(.*\)$/, '')))].slice(0, 15);
  if (missing.length) res.setHeader('X-Doc-Missing', encodeURIComponent(missing.join(', ')));
  if (unknown.length) res.setHeader('X-Doc-Unknown', encodeURIComponent(unknown.slice(0, 15).join(', ')));
  sendDocx(res, buffer, fileName);
}
function empCtx(empId) {
  const e = db.prepare('SELECT id, code, full_name, department, position, phone, start_date FROM employees WHERE id = ?').get(empId);
  if (!e) return null;
  const p = db.prepare('SELECT * FROM hr_profiles WHERE employee_id = ?').get(empId) || {};
  const mgr = p.manager_id ? (db.prepare('SELECT full_name FROM employees WHERE id = ?').get(+p.manager_id) || {}).full_name || '' : '';
  return { e, ef: employeeFields(e, p, mgr) };
}

export function registerHrDocRoutes(r, { need }) {
  const hr = [hrGate, need('hr')];

  // ---------- Mẫu giấy tờ ----------
  r.get('/hr/templates', hr, (req, res) => {
    const meta = tplMeta();
    res.json({
      templates: DOC_TEMPLATES.map(([key, label, kind]) => ({ key, label, kind, custom: hasCustom(key), ...(hasCustom(key) ? meta[key] || {} : {}) })),
      groups: DOC_FIELD_GROUPS,
      company: Object.fromEntries(CO_KEYS.map(([s, k]) => [k, getSetting(s, '')])),
      effective: docCompany(),
      app_company: { name: getSetting('company_name', ''), address: getSetting('company_address', '') },
    });
  });
  r.put('/hr/templates/company', hr, (req, res) => {
    const b = req.body || {};
    for (const [s, k] of CO_KEYS) if (b[k] !== undefined) setSetting(s, String(b[k] ?? '').trim().slice(0, k === 'address' ? 300 : 150));
    res.json({ ok: true, effective: docCompany() });
  });
  r.get('/hr/templates/:key/file', hr, async (req, res) => {
    const key = req.params.key;
    if (!DOC_TEMPLATE_KEYS.includes(key)) return res.status(404).json({ error: 'Không có mẫu này' });
    try {
      const which = req.query.which === 'default' ? 'default' : 'current';
      sendDocx(res, await templateBuffer(key, which), `Mau_${key}${which === 'default' || !hasCustom(key) ? '_mac_dinh' : '_rieng'}.docx`);
    } catch (e) { sendCaughtError(res, 'GET /admin/hr/templates/file', e); }
  });
  // Tải mẫu riêng lên: {fileName, fileBase64} — kiểm tra đúng .docx, báo trường gõ sai
  r.post('/hr/templates/:key', hr, async (req, res) => {
    const key = req.params.key;
    if (!DOC_TEMPLATE_KEYS.includes(key)) return res.status(404).json({ error: 'Không có mẫu này' });
    const b = req.body || {};
    const ext = extname(String(b.fileName || '')).toLowerCase();
    if (ext !== '.docx') return res.status(400).json({ error: 'Chỉ nhận file Word .docx (Word 2007 trở lên). File .doc cũ: mở bằng Word → Lưu thành (Save As) → chọn kiểu .docx' });
    const buf = Buffer.from(String(b.fileBase64 || '').replace(/^data:.*;base64,/, ''), 'base64');
    if (!buf.length) return res.status(400).json({ error: 'File rỗng' });
    if (buf.length > 4.2 * 1024 * 1024) return res.status(400).json({ error: 'File quá lớn (tối đa 4MB) — bớt ảnh trong mẫu' });
    let found;
    try { found = await listPlaceholders(buf); await fillDocx(buf, {}); }
    catch (e) { return res.status(400).json({ error: e.message || 'File Word không đọc được' }); }
    const valid = fieldsForTemplate(key);
    const unknown = found.filter((k) => !valid.has(k));
    try {
      mkdirSync(tplDir(), { recursive: true });
      writeFileSync(customPath(key), buf);
      const meta = tplMeta();
      meta[key] = { name: String(b.fileName).slice(0, 150), at: new Date().toISOString(), by: req.user?.full_name || 'Quản lý' };
      setSetting('hr_doc_templates', JSON.stringify(meta));
    } catch (e) { return sendCaughtError(res, 'POST /admin/hr/templates', e); }
    res.json({ ok: true, fields: found.length, unknown, no_fields: !found.length });
  });
  r.delete('/hr/templates/:key', hr, (req, res) => {
    const key = req.params.key;
    if (!DOC_TEMPLATE_KEYS.includes(key)) return res.status(404).json({ error: 'Không có mẫu này' });
    try { rmSync(customPath(key), { force: true }); } catch {}
    const meta = tplMeta(); delete meta[key]; setSetting('hr_doc_templates', JSON.stringify(meta));
    res.json({ ok: true });
  });

  // ---------- In ----------
  r.get('/hr/contracts/:id/print', hr, async (req, res) => {
    try {
      const c = db.prepare('SELECT * FROM hr_contracts WHERE id = ?').get(+req.params.id);
      const x = c && empCtx(c.employee_id);
      if (!x) return res.status(404).json({ error: 'Không tìm thấy hợp đồng' });
      const co = docCompany();
      const data = mergeFields(companyFields(co, hrToday()), x.ef, contractFields(c, co));
      await sendFilled(res, templateForContract(c.ctype), data, safeName(`HD_${c.contract_no || c.id}_${x.e.code}.docx`));
    } catch (e) { sendCaughtError(res, 'GET /admin/hr/contracts/print', e); }
  });
  r.get('/hr/annexes/:aid/print', hr, async (req, res) => {
    try {
      const a = db.prepare('SELECT * FROM hr_contract_annexes WHERE id = ?').get(+req.params.aid);
      const c = a && db.prepare('SELECT * FROM hr_contracts WHERE id = ?').get(a.contract_id);
      const x = c && empCtx(c.employee_id);
      if (!x) return res.status(404).json({ error: 'Không tìm thấy phụ lục' });
      const co = docCompany();
      const data = mergeFields(companyFields(co, hrToday()), x.ef, contractFields(c, co), annexFields(a));
      await sendFilled(res, 'phu_luc', data, safeName(`PL_${a.annex_no || a.id}_${x.e.code}.docx`));
    } catch (e) { sendCaughtError(res, 'GET /admin/hr/annexes/print', e); }
  });
  r.get('/hr/decisions/:id/print', hr, async (req, res) => {
    try {
      const d = db.prepare('SELECT * FROM hr_decisions WHERE id = ?').get(+req.params.id);
      const x = d && empCtx(d.employee_id);
      if (!x) return res.status(404).json({ error: 'Không tìm thấy quyết định' });
      const co = docCompany();
      let cur = null;
      if (d.kind === 'resign') {
        // HĐ còn hiệu lực ngày làm việc cuối cùng (QĐ đã áp dụng thì HĐ đã chấm dứt đúng ngày nghỉ)
        const list = db.prepare('SELECT * FROM hr_contracts WHERE employee_id = ?').all(d.employee_id);
        const last = isDate(d.effective_date) ? addDays(d.effective_date, -1) : hrToday();
        cur = currentContract(list, last) || list.filter((c) => c.start_date <= last).sort((p, q) => (p.start_date < q.start_date ? 1 : -1))[0] || null;
      }
      const data = mergeFields(companyFields(co, hrToday()), x.ef, decisionFields(d, x.ef, co, cur));
      await sendFilled(res, d.kind === 'resign' ? 'qd_nghi_viec' : 'qd_thuyen_chuyen', data, safeName(`QD_${d.decision_no || d.id}_${x.e.code}.docx`));
    } catch (e) { sendCaughtError(res, 'GET /admin/hr/decisions/print', e); }
  });
}
