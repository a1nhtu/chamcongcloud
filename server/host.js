// MÁY CHỦ NHIỀU CÔNG TY (MULTI_TENANT=1) — nạp / tạo / mở lại từng công ty, tra công ty theo tên miền,
// và API điều khiển (/_host/...) cho trang "Tạo công ty" trên điện thoại (huongdan.maychamcongcloud.com).
//
// Mỗi công ty 1 thư mục  data/tenants/<mã>/  có cấu trúc Y HỆT 1 bản cài (data/digiplus.db, data/license.key,
// data/backups, uploads/…) + tenant.json (tên, cấu hình). Nhờ vậy file "Sao lưu TOÀN BỘ (.zip)" của bản cài
// riêng phục hồi thẳng vào máy chủ được (chuyển khách cũ vào), và ngược lại.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { createServer as createHttp } from 'node:http';
import express from 'express';
import { ROOT, runAsTenant, registerTenant, openTenants, tenantBySlug, setTenantResolver, currentTenant } from './tenant.js';
import { openDb, applyPendingRestore, initSchema, optimizeDb, setSetting, getSetting, db } from './db.js';
import { fixOverlappingAssignmentsOnce } from './assign-normalize.js';
import { ensureSeed } from './seed.js';
import { hashPassword } from './auth.js';
import { licenseState, verifyLicense, saveLicenseKey } from './license.js';
import { currentVersion, startUpdate, updateStatus } from './update.js';
import { stopHeavyWorkers } from './heavy.js';

export const TENANTS_DIR = process.env.TENANTS_DIR || join(ROOT, 'data', 'tenants');
export const HOST_DOMAIN = String(process.env.HOST_DOMAIN || 'maychamcongcloud.com').toLowerCase();
// Mã công ty = phần đầu tên miền (<mã>.maychamcongcloud.com): chữ thường không dấu, số, gạch ngang
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const RESERVED = new Set(['www', 'huongdan', 'app', 'api', 'admin', 'mail', 'ctl', 'host', 'noibo']);

const metaFile = (slug) => join(TENANTS_DIR, slug, 'tenant.json');
function readMeta(slug) {
  try { return JSON.parse(readFileSync(metaFile(slug), 'utf8')); } catch { return null; }
}
function writeMeta(slug, meta) {
  const f = metaFile(slug);
  writeFileSync(f + '.tmp', JSON.stringify(meta, null, 2));
  renameSync(f + '.tmp', f);
}
const dbFile = (t) => join(t.root, 'data', 'digiplus.db');

function makeTenant(slug, meta) {
  return {
    slug, name: meta.name || slug, root: join(TENANTS_DIR, slug), env: { ...(meta.env || {}) },
    disabled: !!meta.disabled, devicePort: Number(meta.devicePort) || 0, created: meta.created || '', db: null,
  };
}

// Mở CSDL + chuẩn bị dữ liệu (bảng mới, dữ liệu khởi tạo) — như lúc khởi động 1 bản cài
function bootTenant(t) {
  mkdirSync(join(t.root, 'data'), { recursive: true });
  mkdirSync(join(t.root, 'uploads'), { recursive: true });
  applyPendingRestore(dbFile(t));
  t.db = openDb(dbFile(t));
  runAsTenant(t, () => { initSchema(); fixOverlappingAssignmentsOnce(); optimizeDb(); ensureSeed(); });
  registerTenant(t);
  return t;
}

// Khởi động máy chủ: mở mọi công ty trong data/tenants (công ty lỗi CSDL thì bỏ qua, các công ty khác vẫn chạy)
export function openAllTenants() {
  mkdirSync(TENANTS_DIR, { recursive: true });
  let n = 0;
  for (const slug of readdirSync(TENANTS_DIR).sort()) {
    if (!SLUG_RE.test(slug)) continue;
    const meta = readMeta(slug);
    if (!meta) continue;
    try { bootTenant(makeTenant(slug, meta)); n++; } catch (e) { console.error(`[máy chủ] Không mở được công ty ${slug}:`, e.message); }
  }
  console.log(`  [máy chủ nhiều công ty] Đã mở ${n} công ty`);
  return n;
}

// Mở lại 1 công ty (sau khi phục hồi sao lưu): đóng CSDL → áp file phục hồi → mở lại. Các công ty khác không bị ảnh hưởng.
export async function reloadTenant(slug) {
  const t = tenantBySlug(slug);
  if (!t) return false;
  await stopHeavyWorkers();   // luồng phụ đang mở file CSDL cũ (Windows không cho thay file đang mở)
  try { t.db?.close(); } catch {}
  t.db = null;
  bootTenant(t);
  return true;
}

// Mật khẩu admin ban đầu cho công ty mới (dễ đọc qua điện thoại: bỏ các ký tự dễ nhầm)
const PASS_CH = 'abcdefghjkmnpqrstuvwxyz23456789';
const newPass = () => Array.from({ length: 8 }, () => PASS_CH[randomInt(PASS_CH.length)]).join('');

// Tạo công ty mới. opts: { slug, name, env:{USE_DEVICE,USE_PHONE}, phone, email }. Trả { slug, name, admin_user, admin_pass, machine_id }.
export function createTenant(opts = {}) {
  const slug = String(opts.slug || '').trim().toLowerCase();
  if (!SLUG_RE.test(slug) || RESERVED.has(slug) || slug.startsWith('ctl-')) throw Object.assign(new Error('Mã công ty không hợp lệ'), { status: 400 });
  if (tenantBySlug(slug) || existsSync(metaFile(slug))) throw Object.assign(new Error(`Công ty "${slug}" đã có trên máy chủ`), { status: 409 });
  const name = String(opts.name || slug).trim().slice(0, 120) || slug;
  const env = {};
  for (const k of ['USE_DEVICE', 'USE_PHONE']) if (['0', '1'].includes(String(opts.env?.[k] ?? ''))) env[k] = String(opts.env[k]);
  mkdirSync(join(TENANTS_DIR, slug), { recursive: true });
  const meta = { name, env, created: new Date().toISOString(), phone: String(opts.phone || '').slice(0, 30), email: String(opts.email || '').slice(0, 120) };
  writeMeta(slug, meta);
  const t = bootTenant(makeTenant(slug, meta));
  const pass = newPass();
  runAsTenant(t, () => {
    setSetting('company_name', name);
    db.prepare("UPDATE employees SET password_hash=? WHERE username='admin'").run(hashPassword(pass));
  });
  return { slug, name, admin_user: 'admin', admin_pass: pass, machine_id: runAsTenant(t, () => licenseState().machineIdFmt) };
}

export function setTenantDisabled(slug, disabled) {
  const t = tenantBySlug(slug), meta = readMeta(slug);
  if (!t || !meta) return false;
  meta.disabled = !!disabled; writeMeta(slug, meta);
  t.disabled = !!disabled;
  return true;
}

export function tenantInfo(t) {
  return runAsTenant(t, () => {
    const lic = licenseState();
    let emps = 0;
    try { emps = db.prepare("SELECT COUNT(*) c FROM employees WHERE active=1 AND role<>'admin'").get().c; } catch {}
    return {
      slug: t.slug, name: getSetting('company_name', t.name), created: t.created, disabled: t.disabled, employees: emps,
      machine_id: lic.machineIdFmt, activated: !!lic.activated, exp: lic.exp || null, days_left: lic.daysLeft ?? null, reason: lic.reason || '',
    };
  });
}

/* ------------------------------ TRA CÔNG TY THEO YÊU CẦU ------------------------------ */
// Cổng riêng cho máy chấm công đời cũ chỉ điền được IP + cổng (không gửi tên miền): cổng → công ty
const portMap = new Map();
export function slugFromHost(host) {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '');
  if (h.endsWith('.' + HOST_DOMAIN)) return h.slice(0, -(HOST_DOMAIN.length + 1));
  if (h.endsWith('.localhost')) return h.slice(0, -'.localhost'.length);   // thử trên máy: http://<mã>.localhost:<cổng>
  return '';
}
export function resolveTenant(req) {
  const byPort = portMap.get(req.socket?.localPort);
  if (byPort) return byPort;
  const slug = slugFromHost(req.headers.host);
  return SLUG_RE.test(slug) ? tenantBySlug(slug) : null;
}
setTenantResolver(resolveTenant);

// Luồng phụ (heavy-worker): mở CSDL của công ty theo mã luồng chính gửi kèm (chỉ đọc, không khởi tạo lại)
const workerOpen = new Map();
export function workerTenant(slug) {
  slug = String(slug || '').toLowerCase();
  if (!SLUG_RE.test(slug)) return null;
  let t = workerOpen.get(slug);
  if (t) return t;
  const meta = readMeta(slug);
  if (!meta) return null;
  t = makeTenant(slug, meta);
  t.db = openDb(dbFile(t));
  workerOpen.set(slug, t);
  return t;
}

const PAGE = (title, msg) => `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font-family:system-ui,sans-serif;background:#f1f5f9;margin:0;display:grid;place-items:center;min-height:100vh}
div{background:#fff;padding:28px 24px;border-radius:14px;max-width:420px;margin:16px;box-shadow:0 4px 20px #0001;text-align:center}
h1{font-size:20px;color:#0f172a;margin:0 0 10px}p{color:#475569;line-height:1.5;margin:0}</style></head>
<body><div><h1>${title}</h1><p>${msg}</p></div></body></html>`;

// Middleware: mọi yêu cầu chạy trong ngữ cảnh ĐÚNG công ty của tên miền; không thấy công ty → trang báo, không đụng dữ liệu nào
export function tenantGate(req, res, next) {
  const t = resolveTenant(req);
  if (!t) return res.status(404).type('html').send(PAGE('Không tìm thấy công ty', 'Địa chỉ này chưa được đăng ký trên Digiplus. Kiểm tra lại tên miền hoặc liên hệ Digiplus.'));
  if (t.disabled) return res.status(403).type('html').send(PAGE('Công ty đang tạm khoá', 'Phần mềm chấm công của công ty đang tạm khoá. Vui lòng liên hệ Digiplus để mở lại.'));
  req.tenant = t;
  runAsTenant(t, next);
}

// Ảnh (selfie + logo) của từng công ty
const statics = new Map();
export function tenantUploads(opts) {
  return (req, res, next) => {
    const t = currentTenant();
    if (!t) return next();
    let st = statics.get(t.slug);
    if (!st) { st = express.static(join(t.root, 'uploads'), opts); statics.set(t.slug, st); }
    st(req, res, next);
  };
}

/* ------------------------------ API ĐIỀU KHIỂN (/_host) ------------------------------ */
// Chỉ trang tạo công ty của Digiplus (Cloudflare Worker) gọi, kèm HOST_TOKEN (config.txt của máy chủ) — không có token → 401
function tokenOk(req) {
  const want = String(process.env.HOST_TOKEN || '');
  const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (want.length < 16 || !got) return false;
  const a = Buffer.from(want), b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function hostRouter() {
  const r = express.Router();
  r.use('/_host', (req, res, next) => (tokenOk(req) ? next() : res.status(401).json({ error: 'Sai mã máy chủ' })));
  r.use('/_host', express.json({ limit: '1mb' }));
  r.get('/_host/ping', (req, res) => res.json({ ok: true, version: currentVersion(), tenants: openTenants().length,
    rss_mb: Math.round(process.memoryUsage().rss / 1048576), domain: HOST_DOMAIN }));
  r.get('/_host/tenants', (req, res) => res.json({ tenants: openTenants().map(tenantInfo) }));
  r.get('/_host/tenants/:slug', (req, res) => {
    const t = tenantBySlug(req.params.slug);
    if (!t) return res.status(404).json({ error: 'Không có công ty này' });
    res.json(tenantInfo(t));
  });
  r.post('/_host/tenants', (req, res) => {
    try { res.json({ ok: true, ...createTenant(req.body || {}) }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  // Nạp bản quyền (trang tạo công ty ký bản dùng thử 30 ngày theo Mã máy của công ty rồi gửi về đây)
  r.post('/_host/tenants/:slug/license', (req, res) => {
    const t = tenantBySlug(req.params.slug);
    if (!t) return res.status(404).json({ error: 'Không có công ty này' });
    const key = String(req.body?.key || '').trim();
    const v = runAsTenant(t, () => verifyLicense(key));
    if (!v.valid) return res.status(400).json({ error: v.reason });
    runAsTenant(t, () => saveLicenseKey(key));
    res.json({ ok: true, ...tenantInfo(t) });
  });
  r.post('/_host/tenants/:slug/disable', (req, res) => res.json({ ok: setTenantDisabled(req.params.slug, true) }));
  r.post('/_host/tenants/:slug/enable', (req, res) => res.json({ ok: setTenantDisabled(req.params.slug, false) }));
  // Cập nhật phần mềm cho cả máy chủ (mọi công ty dùng chung 1 bản code)
  r.post('/_host/update', async (req, res) => {
    try { res.json(await startUpdate()); } catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.get('/_host/update', (req, res) => res.json(updateStatus()));
  return r;
}

/* ------------------------------ CỔNG RIÊNG CHO MÁY CHẤM CÔNG ------------------------------ */
// Công ty có devicePort (tenant.json): máy chấm công đời cũ điền IP máy chủ + cổng đó (không cần tên miền)
export function startDevicePorts(app, attach = () => {}) {
  for (const t of openTenants()) {
    if (!t.devicePort || t.devicePort < 1024 || t.devicePort > 65535) continue;
    portMap.set(t.devicePort, t);
    const srv = createHttp(app);
    attach(srv);
    srv.on('error', (e) => console.error(`[máy chủ] Không mở được cổng máy chấm công ${t.devicePort} của ${t.slug}:`, e.code || e.message));
    srv.listen(t.devicePort, '0.0.0.0', () => console.log(`  Cổng máy chấm công ${t.devicePort} → công ty ${t.slug}`));
  }
}
