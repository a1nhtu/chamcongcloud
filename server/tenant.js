// MÁY CHỦ NHIỀU CÔNG TY (chạy trên VPS): 1 tiến trình phục vụ nhiều công ty, mỗi công ty 1 thư mục riêng
// (CSDL, ảnh, bản quyền, sao lưu — y hệt cấu trúc 1 bản cài) và tên miền riêng.
// Công tắc: biến môi trường MULTI_TENANT=1 (config.txt của bản cài máy chủ). TẮT (mặc định) = chạy 1 công ty như cũ.
//
// Công ty đang phục vụ được giữ theo NGỮ CẢNH của từng yêu cầu / từng lượt hẹn giờ (AsyncLocalStorage).
// Code đọc CSDL / thư mục mà không có ngữ cảnh công ty → BÁO LỖI ngay, không bao giờ "đoán" sang công ty khác.
import { AsyncLocalStorage } from 'node:async_hooks';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..');            // thư mục app (chứa data/, uploads/)
export const MULTI = process.env.MULTI_TENANT === '1';

const als = new AsyncLocalStorage();

// Công ty của ngữ cảnh hiện tại (null nếu không có). Bản 1 công ty luôn null.
export const currentTenant = () => als.getStore() || null;

export function needTenant() {
  const t = als.getStore();
  if (!t) throw new Error('[nhiều công ty] Không xác định được công ty đang phục vụ (thiếu ngữ cảnh)');
  return t;
}

// Chạy fn trong ngữ cảnh 1 công ty (mọi hẹn giờ / promise tạo bên trong giữ nguyên công ty đó)
export const runAsTenant = (t, fn) => als.run(t, fn);

// Thư mục gốc của công ty hiện tại: bản 1 công ty = thư mục app; máy chủ nhiều công ty = thư mục riêng của công ty
export const appRoot = () => (MULTI ? needTenant().root : ROOT);
export const dataDir = () => join(appRoot(), 'data');

// Cấu hình bản cài (config.txt): bản 1 công ty đọc biến môi trường; máy chủ nhiều công ty đọc cấu hình riêng của công ty
export const cfg = (name) => (MULTI ? (needTenant().env || {})[name] : process.env[name]);

// Khoá phân biệt công ty cho bộ nhớ tạm dùng chung (bản 1 công ty = '')
export const tenantKey = () => (MULTI ? needTenant().slug : '');

// Cờ "đang bận" riêng từng công ty (bản 1 công ty = 1 cờ như cũ): công ty A đang tải máy không làm công ty B phải chờ
export function busyFlag() {
  const on = new Set();
  return {
    take() { const k = tenantKey(); if (on.has(k)) return false; on.add(k); return true; },
    done() { on.delete(tenantKey()); },
  };
}

// Danh sách công ty đang mở (máy chủ đăng ký vào đây khi nạp xong)
const open = new Map();   // slug → tenant
export const registerTenant = (t) => open.set(t.slug, t);
export const unregisterTenant = (slug) => open.delete(slug);
export const openTenants = () => [...open.values()];
export const tenantBySlug = (slug) => open.get(String(slug || '').toLowerCase()) || null;

// Công ty của 1 yêu cầu HTTP / kết nối máy (theo tên miền) — máy chủ (host.js) gắn hàm tra vào đây
let resolver = () => null;
export const setTenantResolver = (fn) => { resolver = fn; };
export const tenantForRequest = (req) => (MULTI ? resolver(req) : null);

// Chạy fn cho TỪNG công ty, lần lượt (không song song — việc nặng / máy chấm công phải tuần tự).
// Bản 1 công ty: chạy fn 1 lần như cũ. Lỗi ở 1 công ty không làm dừng các công ty khác.
export async function eachTenant(fn) {
  if (!MULTI) return fn();
  for (const t of openTenants()) {
    if (t.disabled) continue;
    try { await als.run(t, fn); } catch (e) { console.error(`[${t.slug}]`, e?.message || e); }
  }
}
