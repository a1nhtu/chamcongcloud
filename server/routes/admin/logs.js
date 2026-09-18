// Nhóm route NHẬT KÝ THAO TÁC — admin/quản lý trên phần mềm + trên máy chấm công (OPERLOG/OPLOG).
import ExcelJS from 'exceljs';
import { db } from '../../db.js';
import { oplogLabel } from '../../device-sync.js';

export function registerLogRoutes(r, { need }) {
  // --- Nhật ký thao tác của admin/quản lý trên phần mềm ---
  function adminLogQuery(query) {
    const where = [], args = [];
    if (query.from) { where.push("date(at,'+7 hours') >= ?"); args.push(String(query.from).slice(0, 10)); }
    if (query.to)   { where.push("date(at,'+7 hours') <= ?"); args.push(String(query.to).slice(0, 10)); }
    if (query.q)    { const s = '%' + query.q + '%'; where.push('(action LIKE ? OR user_name LIKE ? OR username LIKE ? OR detail LIKE ?)'); args.push(s, s, s, s); }
    return { w: where.length ? 'WHERE ' + where.join(' AND ') : '', args };
  }
  r.get('/logs/admin', need('logs'), (req, res) => {
    const { w, args } = adminLogQuery(req.query);
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    const offset = parseInt(req.query.offset, 10) || 0;
    const total = db.prepare(`SELECT COUNT(*) c FROM audit_logs ${w}`).get(...args).c;
    const rows = db.prepare(`SELECT id, datetime(at,'+7 hours') at, user_name, username, role, action, method, path, detail, ip
      FROM audit_logs ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
    res.json({ rows, total });
  });
  r.get('/logs/admin/export.xlsx', need('logs'), async (req, res) => {
    const { w, args } = adminLogQuery(req.query);
    const rows = db.prepare(`SELECT datetime(at,'+7 hours') at, user_name, username, role, action, method, path, detail, ip
      FROM audit_logs ${w} ORDER BY id DESC LIMIT 50000`).all(...args);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Nhat ky quan tri');
    const roleVi = { master: 'Tài khoản tổng', admin: 'Quản trị viên', manager: 'Quản lý' };
    ws.addRow(['Thời gian', 'Người thực hiện', 'Tài khoản', 'Vai trò', 'Thao tác', 'Chi tiết', 'IP']).font = { bold: true };
    for (const x of rows) ws.addRow([x.at, x.user_name, x.username, roleVi[x.role] || x.role, x.action, x.detail, x.ip]);
    ws.columns = [{ width: 20 }, { width: 22 }, { width: 16 }, { width: 15 }, { width: 30 }, { width: 50 }, { width: 15 }];
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="nhatky_quantri.xlsx"');
    await wb.xlsx.write(res); res.end();
  });

  // --- Nhật ký thao tác trên máy chấm công (OPERLOG/OPLOG) ---
  function deviceLogRows(query, limit, offset) {
    const where = [], args = [];
    if (query.from)   { where.push('substr(o.op_time,1,10) >= ?'); args.push(String(query.from).slice(0, 10)); }
    if (query.to)     { where.push('substr(o.op_time,1,10) <= ?'); args.push(String(query.to).slice(0, 10)); }
    if (query.serial) { where.push('o.serial = ?'); args.push(query.serial); }
    if (query.q)      { const s = '%' + query.q + '%'; where.push('(o.raw LIKE ? OR o.admin_pin LIKE ? OR e.full_name LIKE ?)'); args.push(s, s, s); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = db.prepare(`SELECT COUNT(*) c FROM device_oplogs o LEFT JOIN employees e ON e.device_pin=o.admin_pin ${w}`).get(...args).c;
    const rows = db.prepare(`SELECT o.id, o.serial, d.name dev_name, o.op_code, o.op_time, o.admin_pin, e.full_name emp_name,
        o.obj1, o.obj2, o.obj3, o.raw
      FROM device_oplogs o
      LEFT JOIN push_devices d ON d.serial=o.serial
      LEFT JOIN employees e ON e.device_pin=o.admin_pin
      ${w} ORDER BY o.op_time DESC, o.id DESC ${limit != null ? 'LIMIT ? OFFSET ?' : ''}`)
      .all(...args, ...(limit != null ? [limit, offset] : []));
    return { rows: rows.map((x) => ({ ...x, action: oplogLabel(x.op_code) })), total };
  }
  r.get('/logs/device', need('logs'), (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    const offset = parseInt(req.query.offset, 10) || 0;
    const out = deviceLogRows(req.query, limit, offset);
    out.serials = db.prepare(`SELECT DISTINCT o.serial serial, d.name name
      FROM device_oplogs o LEFT JOIN push_devices d ON d.serial=o.serial ORDER BY d.name`).all();
    res.json(out);
  });
  r.get('/logs/device/export.xlsx', need('logs'), async (req, res) => {
    const { rows } = deviceLogRows(req.query, null, 0);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Nhat ky may cham cong');
    ws.addRow(['Thời gian', 'Máy', 'Serial', 'Thao tác', 'Mã', 'Số ID', 'Người thao tác', 'Đối tượng', 'Dòng gốc']).font = { bold: true };
    for (const x of rows) ws.addRow([x.op_time, x.dev_name || '', x.serial, x.action, x.op_code, x.admin_pin,
      x.emp_name || '', [x.obj1, x.obj2, x.obj3].filter(Boolean).join(' | '), x.raw]);
    ws.columns = [{ width: 20 }, { width: 18 }, { width: 18 }, { width: 26 }, { width: 6 }, { width: 10 }, { width: 20 }, { width: 24 }, { width: 40 }];
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="nhatky_maychamcong.xlsx"');
    await wb.xlsx.write(res); res.end();
  });
}
