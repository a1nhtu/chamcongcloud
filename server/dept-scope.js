// QUẢN LÝ BỘ PHẬN (Anh 25/11/2026, khách thefifty: 12 cửa hàng = 12 bộ phận, mỗi cửa hàng 1 quản lý).
// Tài khoản Quản lý có tích "Chỉ quản lý bộ phận" (employees.dept_scope = JSON mảng tên bộ phận) thì:
//   - chỉ XEM (mọi thao tác ghi bị chặn: không thêm / sửa / xoá giờ chấm, NV, ca…), trừ đổi mật khẩu của chính mình;
//   - chỉ thấy NV thuộc các bộ phận đó (gồm bộ phận con): Tổng quan, Tính công, Báo cáo + Xuất Excel, danh sách NV.
// Cách chặn (ở trong từng router, sau authRequired — chạy cả ở luồng phụ vì luồng phụ nhận lại đúng yêu cầu):
//   1) chỉ cho các GET trong danh sách được phép;
//   2) ÉP bộ lọc NV của yêu cầu (?ids / ?depts / ?dept / ?employee_id) vào trong phạm vi; không gửi bộ lọc = cả phạm vi;
//   3) lọc lại JSON trả về: dòng có employee_id ngoài phạm vi bị bỏ; danh sách NV / bộ phận chỉ còn của phạm vi.
import { db, deptWithChildren, splitDeptList } from './db.js';

// Tên bộ phận đã tích (chưa gồm con) — [] = không giới hạn
export function rawDeptScope(user) {
  if (!user || user.master || user.role !== 'manager') return [];
  try { const a = JSON.parse(user.dept_scope || '[]'); return Array.isArray(a) ? [...new Set(a.map((s) => String(s || '').trim()).filter(Boolean))] : []; } catch { return []; }
}

// Phạm vi đầy đủ: { names: tên đã tích, depts: gồm bộ phận con (+ dạng dấu NFC/NFD), ids: Set id NV trong các bộ phận đó }
export function deptScopeOf(user) {
  const names = rawDeptScope(user);
  if (!names.length) return null;
  const depts = deptWithChildren(names);
  const ids = new Set(db.prepare(`SELECT id FROM employees WHERE department IN (${depts.map(() => '?').join(',')})`).all(...depts).map((r) => r.id));
  return { names, depts, deptSet: new Set(depts.map((d) => d.normalize('NFC'))), ids };
}

export const SCOPE_READONLY_MSG = 'Tài khoản quản lý bộ phận chỉ được xem';

// allow: các đường dẫn GET được dùng (regex trên req.path của router). writes: đường dẫn ghi vẫn cho (VD tự đổi mật khẩu).
export function deptScopeGuard(allow = [], writes = []) {
  return (req, res, next) => {
    const sc = deptScopeOf(req.user);
    if (!sc) return next();
    req.deptScope = sc;
    if (req.method !== 'GET') {
      if (writes.some((re) => re.test(req.path))) return next();
      return res.status(403).json({ error: SCOPE_READONLY_MSG });
    }
    if (!allow.some((re) => re.test(req.path))) return res.status(403).json({ error: 'Không có quyền dùng chức năng này' });
    const q = { ...req.query };
    // NV cụ thể: chỉ giữ NV trong phạm vi (không còn ai → id không tồn tại, ra danh sách rỗng)
    for (const k of ['ids', 'employee_ids']) {
      if (q[k] == null || q[k] === '') continue;
      const keep = String(q[k]).split(',').map((s) => parseInt(s, 10)).filter((n) => sc.ids.has(n));
      q[k] = keep.length ? keep.join(',') : '-1';
    }
    for (const k of ['employee_id', 'emp', 'eid']) {
      if (q[k] == null || q[k] === '') continue;
      if (!sc.ids.has(parseInt(q[k], 10))) return res.status(403).json({ error: 'Nhân viên này không thuộc bộ phận bạn quản lý' });
    }
    // Bộ phận: chỉ giữ bộ phận trong phạm vi; gửi bộ phận ngoài phạm vi → không ai
    const inScope = (d) => sc.deptSet.has(String(d).trim().normalize('NFC'));
    let deptAsked = false, deptKept = [];
    for (const k of ['depts', 'dept', 'department']) {
      if (q[k] == null || q[k] === '' || q[k] === '*') { if (q[k] === '*') delete q[k]; continue; }
      deptAsked = true;
      deptKept.push(...splitDeptList(q[k]).filter(inScope));
      delete q[k];
    }
    if (deptAsked) {
      if (deptKept.length) q.depts = [...new Set(deptKept)].join(',');
      else q.ids = '-1';
    } else if (!q.ids && !q.employee_ids) {
      q.depts = sc.names.join(',');   // không lọc gì = cả các bộ phận được quản lý
    }
    // Express 4: req.query là thuộc tính thường; vẫn đặt bằng defineProperty để chắc ghi đè được
    Object.defineProperty(req, 'query', { value: q, writable: true, configurable: true, enumerable: true });
    const json = res.json.bind(res);
    res.json = (body) => json(scopeBody(body, sc, req.path));
    next();
  };
}

// Lọc lại JSON trả về theo phạm vi
function scopeBody(body, sc, path) {
  const empList = /^\/employees$/.test(path);
  const deptList = /^\/departments$/.test(path);
  const okDept = (n) => sc.deptSet.has(String(n || '').trim().normalize('NFC'));
  const walk = (v, depth) => {
    if (depth > 6 || v == null || typeof v !== 'object') return v;
    if (Array.isArray(v)) {
      let a = v;
      if (a.length && a.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
        if (a.some((x) => x.employee_id != null)) a = a.filter((x) => x.employee_id == null || sc.ids.has(Number(x.employee_id)));
        else if (empList && a.some((x) => x.id != null && 'full_name' in x)) a = a.filter((x) => sc.ids.has(Number(x.id)));
        else if (deptList && a.some((x) => 'name' in x)) a = a.filter((x) => okDept(x.name));
      } else if (deptList && a.every((x) => typeof x === 'string')) a = a.filter(okDept);
      return a.map((x) => walk(x, depth + 1));
    }
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = walk(x, depth + 1);
    return o;
  };
  return walk(body, 0);
}

// Mệnh đề SQL giới hạn NV theo phạm vi (cho các route tự đếm cả công ty, VD Tổng quan): '' khi không giới hạn
export function scopeEmpSql(req, col = 'id') {
  const sc = req && req.deptScope;
  if (!sc) return { where: '', args: [] };
  const ids = [...sc.ids];
  return ids.length ? { where: ` AND ${col} IN (${ids.map(() => '?').join(',')})`, args: ids } : { where: ' AND 0', args: [] };
}
