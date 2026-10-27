// Nhóm route CHUYỂN DỮ LIỆU TỪ PHẦN MỀM CŨ (Wise Eye On39 / Ronald Jack Pro) — xem server/legacy-import.js.
// Bước 1: chọn phần mềm (On39 / Ronald Jack) + tải file .mdb lên → đọc + trả bản XEM TRƯỚC (giữ dữ liệu đã đọc 30 phút theo mã token).
// Bước 2: chọn phần cần chuyển + khoảng ngày → chạy NỀN (job), giao diện hỏi tiến độ tới khi xong.
import express from 'express';
import { randomBytes } from 'node:crypto';
import { readLegacy, summarize, applyLegacy } from '../../legacy-import.js';
import { tenantKey } from '../../tenant.js';

const cache = new Map();   // token → { data, summary, at }
const jobs = new Map();    // id → { state: run|done|err, pct, msg, result }
let busy = false;
const TTL = 30 * 60000;
function keep(data) {
  for (const [k, v] of cache) if (Date.now() - v.at > TTL) cache.delete(k);
  while (cache.size >= 3) cache.delete(cache.keys().next().value);   // file chấm công lớn tốn RAM → chỉ giữ vài bản gần nhất
  const token = randomBytes(9).toString('hex');
  const summary = summarize(data);
  cache.set(token, { data, summary, at: Date.now(), tk: tenantKey() });
  return { token, summary };
}

export function registerLegacyImportRoutes(r, { need }) {
  // Tải file lên: thân yêu cầu = nội dung file; ?kind=on39|rj (phần mềm đã chọn) &password=
  r.post('/legacy/parse-upload', need('devices'), express.raw({ type: () => true, limit: '1024mb' }), (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 4096) return res.status(400).json({ error: 'File rỗng hoặc không đọc được' });
    try { res.json({ ok: true, ...keep(readLegacy(buf, String(req.query.password || ''), String(req.query.kind || ''))) }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  // Chạy chuyển: body { token, depts, emps, punches, overwrite, from, to } → { job }
  r.post('/legacy/apply', need('devices'), (req, res) => {
    const b = req.body || {};
    const c = cache.get(String(b.token || ''));
    if (!c || c.tk !== tenantKey()) return res.status(400).json({ error: 'Dữ liệu đã đọc hết hạn (quá 30 phút) — chọn lại file' });
    if (busy) return res.status(409).json({ error: 'Đang chuyển dữ liệu — chờ lượt trước xong' });
    const ISO = /^\d{4}-\d{2}-\d{2}$/;
    const opts = { depts: b.depts !== false, emps: b.emps !== false, punches: b.punches !== false, overwrite: !!b.overwrite,
      from: ISO.test(b.from || '') ? b.from : '', to: ISO.test(b.to || '') ? b.to : '' };
    if (!opts.depts && !opts.emps && !opts.punches) return res.status(400).json({ error: 'Chưa chọn phần nào để chuyển' });
    const id = randomBytes(6).toString('hex');
    const j = { state: 'run', pct: 0, msg: 'Bắt đầu…', result: null, at: Date.now() };
    Object.defineProperty(j, 'tk', { value: tenantKey() });
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
    if (!j || j.tk !== tenantKey()) return res.status(404).json({ error: 'Không thấy tiến trình' });
    res.json(j);
  });
}
