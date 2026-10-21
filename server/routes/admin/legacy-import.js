// Nhóm route CHUYỂN DỮ LIỆU TỪ PHẦN MỀM CŨ (Wise Eye On39 / Ronald Jack Pro) — xem server/legacy-import.js.
// Bước 1: chọn file (.mdb trên máy chủ, hoặc tải file lên) → đọc + trả bản XEM TRƯỚC (giữ dữ liệu đã đọc 30 phút theo mã token).
// Bước 2: chọn phần cần chuyển + khoảng ngày → chạy NỀN (job), giao diện hỏi tiến độ tới khi xong.
import express from 'express';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { readLegacy, summarize, applyLegacy, LEGACY_PATHS } from '../../legacy-import.js';

const cache = new Map();   // token → { data, summary, at }
const jobs = new Map();    // id → { state: run|done|err, pct, msg, result }
let busy = false;
const TTL = 30 * 60000;
function keep(data) {
  for (const [k, v] of cache) if (Date.now() - v.at > TTL) cache.delete(k);
  while (cache.size >= 3) cache.delete(cache.keys().next().value);   // file chấm công lớn tốn RAM → chỉ giữ vài bản gần nhất
  const token = randomBytes(9).toString('hex');
  const summary = summarize(data);
  cache.set(token, { data, summary, at: Date.now() });
  return { token, summary };
}
const isMdb = (p) => /\.(mdb|accdb)$/i.test(p || '');

export function registerLegacyImportRoutes(r, { need }) {
  // File dữ liệu của phần mềm cũ có sẵn trên máy chủ (cài chung máy) — chỗ cài mặc định
  r.get('/legacy/detect', need('devices'), (req, res) => {
    const files = [];
    for (const p of LEGACY_PATHS) {
      try { if (existsSync(p)) { const s = statSync(p); files.push({ path: p, size: s.size, mtime: s.mtime.toISOString(), kind: /RJData/i.test(p) ? 'rj' : 'on39' }); } } catch {}
    }
    res.json({ files });
  });

  // Đọc file theo đường dẫn trên máy chủ: body { path, password }
  r.post('/legacy/parse-path', need('devices'), (req, res) => {
    const p = String(req.body?.path || '').trim().replace(/^"|"$/g, '');
    if (!isMdb(p)) return res.status(400).json({ error: 'Đường dẫn phải là file .mdb (VD C:\\WiseEyeOn39\\Data\\WiseEyeOn39.mdb)' });
    if (!existsSync(p)) return res.status(400).json({ error: 'Không thấy file trên máy chủ: ' + p });
    try { res.json({ ok: true, ...keep(readLegacy(readFileSync(p), String(req.body?.password || ''))) }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  // Tải file lên (máy chủ là VPS / khác máy với phần mềm cũ): thân yêu cầu = nội dung file; ?password=
  r.post('/legacy/parse-upload', need('devices'), express.raw({ type: () => true, limit: '1024mb' }), (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 4096) return res.status(400).json({ error: 'File rỗng hoặc không đọc được' });
    try { res.json({ ok: true, ...keep(readLegacy(buf, String(req.query.password || ''))) }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  // Chạy chuyển: body { token, depts, emps, punches, overwrite, from, to } → { job }
  r.post('/legacy/apply', need('devices'), (req, res) => {
    const b = req.body || {};
    const c = cache.get(String(b.token || ''));
    if (!c) return res.status(400).json({ error: 'Dữ liệu đã đọc hết hạn (quá 30 phút) — chọn lại file' });
    if (busy) return res.status(409).json({ error: 'Đang chuyển dữ liệu — chờ lượt trước xong' });
    const ISO = /^\d{4}-\d{2}-\d{2}$/;
    const opts = { depts: b.depts !== false, emps: b.emps !== false, punches: b.punches !== false, overwrite: !!b.overwrite,
      from: ISO.test(b.from || '') ? b.from : '', to: ISO.test(b.to || '') ? b.to : '' };
    if (!opts.depts && !opts.emps && !opts.punches) return res.status(400).json({ error: 'Chưa chọn phần nào để chuyển' });
    const id = randomBytes(6).toString('hex');
    const j = { state: 'run', pct: 0, msg: 'Bắt đầu…', result: null, at: Date.now() };
    jobs.set(id, j);
    for (const [k, v] of jobs) if (v.state !== 'run' && Date.now() - v.at > TTL) jobs.delete(k);
    busy = true;
    applyLegacy(c.data, opts, (pct, msg) => { j.pct = Math.round(pct); j.msg = msg; })
      .then((r2) => { j.state = 'done'; j.result = { ...r2, label: c.summary.label }; j.pct = 100; j.msg = 'Xong'; cache.delete(String(b.token)); })
      .catch((e) => { j.state = 'err'; j.msg = e.message || String(e); console.error('[POST /admin/legacy/apply]', e); })
      .finally(() => { busy = false; j.at = Date.now(); });
    res.json({ ok: true, job: id });
  });

  r.get('/legacy/job/:id', need('devices'), (req, res) => {
    const j = jobs.get(req.params.id);
    if (!j) return res.status(404).json({ error: 'Không thấy tiến trình' });
    res.json(j);
  });
}
