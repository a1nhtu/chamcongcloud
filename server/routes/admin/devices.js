// Nhóm route MÁY CHẤM CÔNG (ZKTeco ADMS push) — tách khỏi admin.js.
import { networkInterfaces } from 'node:os';
import { db, getSetting } from '../../db.js';
import { rebuildDay, resyncNow, importUsbAttlog, importUsbUsers, deviceUserList, clearDeviceLog, clearDeviceAll, deleteDeviceUsers, clearDeviceAdmins, openDoor, queryDeviceUsers, queryDeviceAttlog, syncFillDevice, relearnDevice } from '../../device-sync.js';
import { sendCaughtError } from '../../util.js';

// IP LAN thật của máy chủ (để điền vào máy chấm công). Adapter ảo xếp cuối.
function lanIPs() {
  const real = [], virt = [];
  const isVirtual = (name) => /vethernet|virtual|vmware|virtualbox|hyper-?v|wsl|loopback|default switch|docker|tap-|tailscale|zerotier|bluetooth|npcap/i.test(name);
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family !== 'IPv4' || ni.internal || /^169\.254\./.test(ni.address)) continue;
      (isVirtual(name) ? virt : real).push(ni.address);
    }
  }
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  real.sort((a, b) => rank(a) - rank(b));
  return [...real, ...virt];
}

export function registerDeviceRoutes(r, { need }) {
  r.get('/devices', need('devices'), (req, res) => {
    const rows = db.prepare('SELECT * FROM push_devices ORDER BY created_at').all();
    for (const d of rows) {
      d.punch_count = db.prepare('SELECT COUNT(*) c FROM device_punches WHERE serial=?').get(d.serial).c;
      d.unmatched = db.prepare('SELECT COUNT(DISTINCT pin) c FROM device_punches WHERE serial=? AND employee_id IS NULL').get(d.serial).c;
      d.emp_count = db.prepare('SELECT COUNT(*) c FROM (SELECT pin FROM device_users_serial WHERE serial=? UNION SELECT pin FROM device_bio_templates WHERE serial=?)').get(d.serial, d.serial).c;
      d.fp_count = db.prepare('SELECT COUNT(*) c FROM device_bio_templates WHERE serial=? AND bio_type=1').get(d.serial).c;
      d.face_count = db.prepare('SELECT COUNT(*) c FROM device_bio_templates WHERE serial=? AND bio_type IN (2,9)').get(d.serial).c;
      d.card_count = db.prepare("SELECT COUNT(*) c FROM device_users_serial WHERE serial=? AND card<>''").get(d.serial).c;
    }
    res.json({ rows, enabled: getSetting('device_enabled', '0') === '1', autocreate: getSetting('device_autocreate', '1') === '1', server_ips: lanIPs(), port: Number(process.env.PORT || 8080) });
  });
  // Lấy lại IP mạng LAN hiện tại (bấm "Refresh mạng" sau khi đổi mạng) để điền vào máy chấm công
  r.get('/server-ips', need('devices'), (req, res) => {
    res.json({ ips: lanIPs(), port: Number(process.env.PORT || 8080) });
  });
  // Đồng bộ NGAY: đẩy toàn bộ vân tay/user của nhóm sang mọi máy trong nhóm (khỏi cần restart máy)
  r.post('/devices/resync', need('devices'), (req, res) => {
    try { res.json(resyncNow(!!req.body?.force)); }
    catch (e) { sendCaughtError(res, 'POST /admin/devices/resync', e, { status: 400 }); }
  });
  r.put('/devices/:id', need('devices'), (req, res) => {
    const b = req.body || {};
    const d = db.prepare('SELECT * FROM push_devices WHERE id=?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy máy' });
    const newGroup = b.sync_group !== undefined ? (b.sync_group || '').trim() : (d.sync_group || '');
    db.prepare('UPDATE push_devices SET name=?, active=?, sync_group=?, machine_number=?, access_control=? WHERE id=?')
      .run(b.name ?? d.name, b.active != null ? (b.active ? 1 : 0) : d.active, newGroup,
           b.machine_number != null ? (parseInt(b.machine_number, 10) || 0) : (d.machine_number || 0),
           b.access_control != null ? (b.access_control ? 1 : 0) : (d.access_control || 0), d.id);
    // Tự kích hoạt đồng bộ NGAY cho CẢ NHÓM (khỏi phải bấm nút / khởi động lại máy) khi:
    //  - Vừa ĐẶT/ĐỔI Nhóm ĐB, HOẶC
    //  - Vừa DUYỆT máy (active 0→1) mà máy đã có nhóm → máy mới tự nhận vân tay/mặt/thẻ/mật mã/NV của nhóm.
    let synced = 0;
    const becameActive = b.active != null && !!b.active && !d.active;
    if (newGroup && (b.sync_group !== undefined || becameActive)) {
      try {
        const groupSerials = db.prepare("SELECT serial FROM push_devices WHERE sync_group=? AND active=1").all(newGroup).map((r) => r.serial);
        if (groupSerials.length >= 2) { for (const s of groupSerials) syncFillDevice(s); synced = groupSerials.length; }
      } catch (e) { console.error('[device] auto-sync lỗi:', e.message); }
    }
    res.json({ ok: true, synced });
  });
  // Đọc lại thông tin từ máy: xóa số đếm hiện tại + yêu cầu máy đẩy lại thực tế (sửa số hiển thị sai)
  r.post('/devices/:id/relearn', need('devices'), (req, res) => {
    const d = db.prepare('SELECT serial FROM push_devices WHERE id=?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy máy' });
    relearnDevice(d.serial);
    res.json({ ok: true });
  });
  // Mở cửa từ xa (chỉ máy có kiểm soát cửa) — gửi lệnh ADMS AC_UNLOCK xuống hàng đợi
  r.post('/devices/:id/open-door', need('door_open'), (req, res) => {
    const d = db.prepare('SELECT serial, access_control FROM push_devices WHERE id=?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy máy' });
    if (!d.access_control) return res.status(400).json({ error: 'Máy này chưa bật chức năng kiểm soát cửa.' });
    openDoor(d.serial);
    res.json({ ok: true, msg: 'Đã gửi lệnh mở cửa. Máy sẽ mở khi có kết nối.' });
  });
  r.delete('/devices/:id', need('devices'), (req, res) => {
    const d = db.prepare('SELECT serial FROM push_devices WHERE id=?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy máy' });
    db.prepare('DELETE FROM push_devices WHERE id=?').run(req.params.id);
    db.prepare('DELETE FROM push_device_commands WHERE serial=?').run(d.serial);
    db.prepare('DELETE FROM device_bio_templates WHERE serial=?').run(d.serial);
    res.json({ ok: true });
  });
  // Log quẹt gần đây (để kiểm tra kết nối)
  r.get('/devices/:id/punches', need('devices'), (req, res) => {
    const d = db.prepare('SELECT serial FROM push_devices WHERE id=?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy máy' });
    const rows = db.prepare(`SELECT p.pin, p.punch_at, p.verify, p.employee_id, e.full_name
      FROM device_punches p LEFT JOIN employees e ON e.id = p.employee_id
      WHERE p.serial=? ORDER BY p.punch_at DESC LIMIT 100`).all(d.serial);
    res.json({ rows });
  });
  // Dựng lại chấm công từ toàn bộ punch (khi mới khớp thêm nhân viên với mã trên máy)
  r.post('/devices/rebuild', need('devices'), (req, res) => {
    // gán lại employee_id cho punch chưa khớp (mã trùng employees.code)
    const un = db.prepare('SELECT DISTINCT pin FROM device_punches WHERE employee_id IS NULL').all();
    for (const { pin } of un) {
      const emp = db.prepare('SELECT id FROM employees WHERE code=? AND active=1').get(pin);
      if (emp) db.prepare('UPDATE device_punches SET employee_id=? WHERE pin=? AND employee_id IS NULL').run(emp.id, pin);
    }
    const days = db.prepare('SELECT DISTINCT employee_id, work_date FROM device_punches WHERE employee_id IS NOT NULL').all();
    let n = 0;
    db.exec('BEGIN');
    try { for (const d of days) { rebuildDay(d.employee_id, d.work_date); n++; } db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); return sendCaughtError(res, 'POST /admin/devices/rebuild', e); }
    res.json({ ok: true, rebuilt: n });
  });

  // Nhập dữ liệu từ USB (máy không kết nối mạng): file chấm công *_attlog.dat/.txt hoặc danh sách NV.
  // Body: { kind:'attlog'|'users', fileBase64 hoặc text }
  r.post('/devices/import-usb', need('devices'), (req, res) => {
    const b = req.body || {};
    let content = b.text || '';
    if (!content && b.fileBase64) { try { content = Buffer.from(b.fileBase64.replace(/^data:.*;base64,/, ''), 'base64').toString('utf8'); } catch {} }
    if (!content.trim()) return res.status(400).json({ error: 'File rỗng hoặc không đọc được' });
    db.exec('BEGIN');
    try {
      const r2 = b.kind === 'users' ? importUsbUsers(content) : importUsbAttlog(content);
      db.exec('COMMIT');
      res.json({ ok: true, kind: b.kind || 'attlog', ...r2 });
    } catch (e) { db.exec('ROLLBACK'); sendCaughtError(res, 'POST /admin/devices/import-usb', e); }
  });

  /* -------- Xóa dữ liệu / nhân viên TRÊN MÁY (gửi lệnh ADMS xuống máy) -------- */
  const serialOfDevice = (id) => db.prepare('SELECT serial FROM push_devices WHERE id=?').get(id)?.serial;

  r.get('/devices/:id/users', need('devices'), (req, res) => {
    const serial = serialOfDevice(req.params.id);
    if (!serial) return res.status(404).json({ error: 'Không tìm thấy máy' });
    res.json({ rows: deviceUserList(serial) });
  });
  r.post('/devices/:id/query-users', need('devices'), (req, res) => {
    const serial = serialOfDevice(req.params.id);
    if (!serial) return res.status(404).json({ error: 'Không tìm thấy máy' });
    queryDeviceUsers(serial);
    res.json({ ok: true, msg: 'Đã gửi lệnh tải nhân viên từ máy. Máy sẽ đẩy danh sách NV + vân tay lên khi có kết nối (chờ chút rồi làm mới).' });
  });
  // Tải lại log chấm công cũ từ máy theo khoảng ngày (DATA QUERY ATTLOG)
  r.post('/devices/:id/query-attlog', need('devices'), (req, res) => {
    const serial = serialOfDevice(req.params.id);
    if (!serial) return res.status(404).json({ error: 'Không tìm thấy máy' });
    const from = (req.body?.from || '').slice(0, 10), to = (req.body?.to || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return res.status(400).json({ error: 'Thiếu khoảng ngày hợp lệ' });
    if (to < from) return res.status(400).json({ error: 'Đến ngày phải sau Từ ngày' });
    queryDeviceAttlog(serial, from, to);
    res.json({ ok: true, msg: `Đã gửi lệnh tải log ${from} → ${to}. Máy sẽ đẩy log lên khi có kết nối; chờ chút rồi vào Tính lại công / xem báo cáo.` });
  });
  r.post('/devices/:id/clear-log', need('devices'), (req, res) => {
    const serial = serialOfDevice(req.params.id);
    if (!serial) return res.status(404).json({ error: 'Không tìm thấy máy' });
    clearDeviceLog(serial);
    res.json({ ok: true, msg: 'Đã gửi lệnh xóa log chấm công. Máy sẽ xóa khi kết nối.' });
  });
  r.post('/devices/:id/clear-admins', need('devices'), (req, res) => {
    const serial = serialOfDevice(req.params.id);
    if (!serial) return res.status(404).json({ error: 'Không tìm thấy máy' });
    const n = clearDeviceAdmins(serial);
    res.json({ ok: true, count: n, msg: n ? `Đã gửi lệnh hạ quyền ${n} quản trị.` : 'Không thấy quản trị nào trên máy (theo dữ liệu đã đồng bộ).' });
  });
  r.post('/devices/:id/clear-all', need('devices'), (req, res) => {
    const serial = serialOfDevice(req.params.id);
    if (!serial) return res.status(404).json({ error: 'Không tìm thấy máy' });
    clearDeviceAll(serial);
    res.json({ ok: true, msg: 'Đã gửi lệnh xóa TOÀN BỘ dữ liệu trên máy (NV + vân tay + log).' });
  });
  r.post('/devices/:id/delete-users', need('devices'), (req, res) => {
    const serial = serialOfDevice(req.params.id);
    if (!serial) return res.status(404).json({ error: 'Không tìm thấy máy' });
    const pins = Array.isArray(req.body?.pins) ? req.body.pins : [];
    if (!pins.length) return res.status(400).json({ error: 'Chưa chọn nhân viên' });
    const n = deleteDeviceUsers(serial, pins);
    res.json({ ok: true, count: n, msg: `Đã gửi lệnh xóa ${n} nhân viên trên máy.` });
  });
}
