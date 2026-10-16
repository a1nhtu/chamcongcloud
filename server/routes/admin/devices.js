// Nhóm route MÁY CHẤM CÔNG (ZKTeco ADMS push) — tách khỏi admin.js.
import { networkInterfaces } from 'node:os';
import { db, getSetting } from '../../db.js';
import { rebuildDay, resyncNow, importUsbAttlog, importUsbUsers, deviceUserList, clearDeviceLog, clearDeviceAll, deleteDeviceUsers, forgetDeviceUsers, clearDeviceAdmins, openDoor, queryDeviceUsers, queryDeviceAttlog, syncFillDevice, relearnDevice, rebootDevice, queryDeviceClock, vnNowStr } from '../../device-sync.js';
import { sendCaughtError } from '../../util.js';
import { verifyDeviceKey } from '../../license.js';
import { tcpEnabled, tcpProbe, tcpInfo, saveInfo, tcpUsers, tcpLogs, zkRun, startJob, getJob, autoMinutes, autoCycle, AUTO_CHOICES } from '../../zk-tcp.js';
import { setSetting } from '../../db.js';
import { listConflicts, countConflicts, resolveSame, resolveOther, retryMove, dropConflicts, parseRange, pushNames, guardOn, pushNamesOn, autoPushOn, pushEmployees } from '../../pin-guard.js';

// Máy đã có key hợp lệ (đúng serial) chưa?
function deviceKeyOk(dev) {
  return !!(dev && dev.dev_key && verifyDeviceKey(dev.dev_key, dev.serial).valid);
}

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

// Tên miền của bản cài có tunnel (config.txt: CUSTOMER + TUNNEL_TOKEN) — để hướng dẫn điền vào máy ở chi nhánh khác.
// Bản LAN (không có tunnel) trả ''.
function tunnelDomain() {
  const c = (process.env.CUSTOMER || '').trim().toLowerCase();
  return c && process.env.TUNNEL_TOKEN ? c + '.maychamcongcloud.com' : '';
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
      d.key_ok = deviceKeyOk(d);          // đã có key hợp lệ chưa
      delete d.dev_key;                    // KHÔNG lộ chuỗi key ra client
      d.tcp_has_key = !!d.tcp_key; delete d.tcp_key;   // không lộ mật mã kết nối
      try { d.tcp_info = d.tcp_info ? JSON.parse(d.tcp_info) : null; } catch { d.tcp_info = null; }
    }
    res.json({ rows, tcp_auto_min: autoMinutes(), tcp_auto_choices: AUTO_CHOICES, tcp_enabled: tcpEnabled(), tcp_supported: process.platform === 'win32', enabled: getSetting('device_enabled', '0') === '1', autocreate: getSetting('device_autocreate', '1') === '1', key_required: getSetting('device_key_required', '0') === '1', pin_guard: guardOn(), push_names: pushNamesOn(), auto_push: autoPushOn(), name_ascii: getSetting('device_name_ascii', '1') === '1', pin_conflicts: countConflicts(), server_ips: lanIPs(), port: Number(process.env.PORT || 8080), domain: tunnelDomain() });
  });
  // Công tắc VẬN HÀNH máy chấm công — admin có quyền "Máy chấm công" tự bật/tắt được.
  // (Dùng máy chấm công / Bắt buộc key / Máy TCP/IP vẫn CHỈ tài khoản tổng — đổi ở PUT /settings.)
  r.put('/device-options', need('devices'), (req, res) => {
    const b = req.body || {};
    for (const k of ['device_autocreate', 'device_pin_guard', 'device_push_names', 'device_name_ascii', 'device_auto_push_emp'])
      if (b[k] != null) setSetting(k, b[k] ? '1' : '0');
    res.json({ ok: true });
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
    // Chặn DUYỆT máy (active 0→1) nếu bật "bắt buộc key" mà máy chưa có key hợp lệ.
    // Máy ĐANG chạy (đã active) không bị ảnh hưởng — chỉ chặn lúc duyệt máy mới.
    const willActivate = b.active != null && !!b.active && !d.active;
    if (willActivate && getSetting('device_key_required', '0') === '1' && !deviceKeyOk(d)) {
      return res.status(403).json({ error: 'Máy chưa có KEY bản quyền hợp lệ. Dán key Digiplus cấp cho serial ' + d.serial + ' rồi mới duyệt được.' });
    }
    const newGroup = b.sync_group !== undefined ? (b.sync_group || '').trim() : (d.sync_group || '');
    if (b.recv_new != null) db.prepare('UPDATE push_devices SET recv_new=? WHERE id=?').run(b.recv_new ? 1 : 0, d.id);
    // Dải Số ID của máy (VD 1001-1999; rỗng = bỏ giới hạn)
    if (b.pin_range !== undefined) {
      const pr = String(b.pin_range || '').trim();
      if (pr && !parseRange(pr)) return res.status(400).json({ error: 'Dải Số ID phải dạng "từ-đến", VD 1001-1999' });
      db.prepare('UPDATE push_devices SET pin_range=? WHERE id=?').run(pr.replace(/\s+/g, ''), d.id);
    }
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
    // Vừa DUYỆT máy: lúc còn chờ duyệt máy chỉ nhận cấu hình tối thiểu → ra lệnh khởi động lại để máy
    // bắt tay đầy đủ (bật đẩy dữ liệu real-time + nhận lại giờ/múi giờ đúng).
    // KHÔNG tự tải toàn bộ NV từ máy (máy có thể cả nghìn người → nặng). NV đăng ký trước khi nối phần mềm
    // sẽ được hỏi RIÊNG từng người khi họ quẹt mà chưa khớp (askUserFromDevice); cần tải hết thì bấm tay.
    if (becameActive && d.conn_type !== 'tcp') { try { rebootDevice(d.serial); } catch (e) { console.error('[device] reboot sau duyệt lỗi:', e.message); } }
    res.json({ ok: true, synced, rebooting: becameActive && d.conn_type !== 'tcp' });
  });
  // Đồng bộ giờ: ra lệnh máy khởi động lại để lấy lại giờ máy chủ + múi giờ (chỉ máy đã duyệt mới nhận lệnh)
  r.post('/devices/:id/sync-time', need('devices'), (req, res) => {
    const d = db.prepare('SELECT serial, active FROM push_devices WHERE id=?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy máy' });
    if (!d.active) return res.status(400).json({ error: 'Máy chưa được duyệt — duyệt máy trước rồi mới đồng bộ giờ được.' });
    rebootDevice(d.serial);
    res.json({ ok: true, msg: 'Đã gửi lệnh. Máy sẽ khởi động lại (khoảng 30 giây) rồi tự lấy giờ theo máy chủ.' });
  });
  // Xem giờ trên máy: xếp lệnh đọc đồng hồ; giao diện tự hỏi lại /devices tới khi clock_at >= since
  r.post('/devices/:id/read-clock', need('devices'), (req, res) => {
    const d = db.prepare('SELECT serial, active FROM push_devices WHERE id=?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy máy' });
    if (!d.active) return res.status(400).json({ error: 'Máy chưa được duyệt — duyệt máy trước rồi mới xem giờ được.' });
    queryDeviceClock(d.serial);
    res.json({ ok: true, since: vnNowStr() });
  });
  // Dán KEY bản quyền cho 1 máy (Digiplus cấp theo serial). Verify serial khớp mới lưu.
  r.post('/devices/:id/key', need('devices'), (req, res) => {
    const d = db.prepare('SELECT * FROM push_devices WHERE id=?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy máy' });
    const key = String((req.body && req.body.key) || '').trim();
    const v = verifyDeviceKey(key, d.serial);
    if (!v.valid) return res.status(400).json({ error: v.reason });
    db.prepare('UPDATE push_devices SET dev_key=? WHERE id=?').run(key, d.id);
    res.json({ ok: true, data: v.data });
  });
  // Gỡ key khỏi máy
  r.delete('/devices/:id/key', need('devices'), (req, res) => {
    const d = db.prepare('SELECT id FROM push_devices WHERE id=?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy máy' });
    db.prepare("UPDATE push_devices SET dev_key='' WHERE id=?").run(d.id);
    res.json({ ok: true });
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
    const rows = db.prepare(`SELECT p.id, p.pin, p.punch_at, p.verify, p.employee_id, e.full_name
      FROM device_punches p LEFT JOIN employees e ON e.id = p.employee_id
      WHERE p.serial=? ORDER BY p.punch_at DESC LIMIT 100`).all(d.serial);
    res.json({ rows });
  });
  // Xoá 1 LƯỢT QUẸT lẻ trên máy (quẹt nhầm / nghịch). Không đụng bản ghi công đã tính.
  r.delete('/devices/:id/punch/:pid', need('devices'), (req, res) => {
    const d = db.prepare('SELECT serial FROM push_devices WHERE id=?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy máy' });
    const n = db.prepare('DELETE FROM device_punches WHERE id=? AND serial=?').run(req.params.pid, d.serial).changes;
    res.json({ ok: true, deleted: n });
  });
  // Dựng lại chấm công từ toàn bộ punch (khi mới khớp thêm nhân viên với mã trên máy)
  r.post('/devices/rebuild', need('devices'), (req, res) => {
    // gán lại employee_id cho punch chưa khớp: ưu tiên NV có Số ID máy trùng mã trên máy, sau đó mới tới Mã NV trùng
    const un = db.prepare('SELECT DISTINCT pin FROM device_punches WHERE employee_id IS NULL').all();
    for (const { pin } of un) {
      const emp = db.prepare("SELECT id FROM employees WHERE device_pin=? AND device_pin<>'' AND active=1").get(pin)
        || db.prepare('SELECT id FROM employees WHERE code=? AND active=1').get(pin);
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

  /* -------- MÁY KẾT NỐI TRỰC TIẾP TCP/IP (SDK zkemkeeper, cổng 4370) — xem server/zk-tcp.js -------- */
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const tcpOn = (req, res, next) => (tcpEnabled() ? next() : res.status(400).json({ error: 'Chưa bật "Dùng máy chấm công kết nối TCP/IP" (trang Máy chấm công / Cài đặt).' }));
  const connOf = (b, old = {}) => {
    const ip = String(b.ip ?? old.tcp_ip ?? '').trim();
    const port = b.port != null && b.port !== '' ? parseInt(b.port, 10) : (old.tcp_port || 4370);
    const key = b.key != null && b.key !== '' ? parseInt(b.key, 10) : (b.key === '' ? 0 : (old.tcp_key || 0));
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || ip.split('.').some((x) => +x > 255)) return { error: 'Địa chỉ IP máy chấm công không hợp lệ (VD 192.168.1.201)' };
    if (!(port > 0 && port < 65536)) return { error: 'Cổng không hợp lệ (mặc định 4370)' };
    if (!(key >= 0 && key <= 999999)) return { error: 'Mật mã kết nối (Comm Key) phải là số 0–999999' };
    return { tcp_ip: ip, tcp_port: port, tcp_key: key };
  };
  // Thêm máy: kết nối thử → đọc Serial + thông tin → ghi vào danh sách (Chờ duyệt, cần key như máy Push)
  r.post('/devices/tcp', need('devices'), tcpOn, async (req, res) => {
    const b = req.body || {}, c = connOf(b);
    if (c.error) return res.status(400).json({ error: c.error });
    try {
      if (!(await tcpProbe(c.tcp_ip, c.tcp_port))) return res.status(400).json({ error: `Không thấy máy ở ${c.tcp_ip}:${c.tcp_port}. Kiểm tra: máy đã bật, cắm dây mạng, IP đúng và máy tính này CÙNG lớp mạng với máy chấm công.` });
      const info = await tcpInfo(c);
      if (!info.serial) return res.status(400).json({ error: 'Kết nối được nhưng không đọc được Serial của máy.' });
      const name = String(b.name || '').trim();
      const old = db.prepare('SELECT * FROM push_devices WHERE serial=?').get(info.serial);
      if (old) db.prepare("UPDATE push_devices SET conn_type='tcp', tcp_ip=?, tcp_port=?, tcp_key=?, name=CASE WHEN ?<>'' THEN ? ELSE name END WHERE id=?").run(c.tcp_ip, c.tcp_port, c.tcp_key, name, name, old.id);
      else db.prepare("INSERT INTO push_devices(serial, name, active, conn_type, tcp_ip, tcp_port, tcp_key) VALUES(?,?,0,'tcp',?,?,?)").run(info.serial, name, c.tcp_ip, c.tcp_port, c.tcp_key);
      const d = db.prepare('SELECT id, serial, active FROM push_devices WHERE serial=?').get(info.serial);
      saveInfo(d.id, info);
      res.json({ ok: true, id: d.id, serial: d.serial, active: !!d.active, existed: !!old, info });
    } catch (e) { res.status(400).json({ error: e.message, code: e.code || '' }); }
  });
  // Sửa IP / cổng / mật mã kết nối
  r.put('/devices/:id/tcp', need('devices'), tcpOn, (req, res) => {
    const d = db.prepare('SELECT * FROM push_devices WHERE id=?').get(req.params.id);
    if (!d || d.conn_type !== 'tcp') return res.status(404).json({ error: 'Không tìm thấy máy TCP/IP' });
    const c = connOf(req.body || {}, d);
    if (c.error) return res.status(400).json({ error: c.error });
    db.prepare('UPDATE push_devices SET tcp_ip=?, tcp_port=?, tcp_key=? WHERE id=?').run(c.tcp_ip, c.tcp_port, c.tcp_key, d.id);
    res.json({ ok: true });
  });
  // TỰ ĐỘNG TẢI: đặt chu kỳ chung (phút, 0 = tắt)
  r.put('/tcp-devices/auto', need('devices'), tcpOn, (req, res) => {
    const n = parseInt(req.body?.minutes, 10) || 0;
    if (!AUTO_CHOICES.includes(n)) return res.status(400).json({ error: 'Chu kỳ không hợp lệ' });
    setSetting('tcp_auto_min', String(n));
    res.json({ ok: true, minutes: n });
  });
  // bật / tắt tự tải cho riêng 1 máy
  r.put('/tcp-devices/:id/auto', need('devices'), tcpOn, (req, res) => {
    const d = db.prepare("SELECT id FROM push_devices WHERE id=? AND conn_type='tcp'").get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy máy TCP/IP' });
    db.prepare('UPDATE push_devices SET tcp_auto=? WHERE id=?').run(req.body?.on ? 1 : 0, d.id);
    res.json({ ok: true });
  });
  // "Tải ngay tất cả máy": chạy 1 lượt tự tải cho mọi máy đang bật (không chờ tới giờ hẹn)
  r.post('/tcp-devices/auto/run', need('devices'), tcpOn, (req, res) => {
    const j = startJob('auto', 'tất cả máy TCP/IP', async (prog) => {
      const out = await autoCycle(true, prog);
      if (out == null) throw new Error('Đang có một lượt tự tải chạy dở — chờ xong rồi thử lại.');
      return { devices: out };
    });
    res.json({ ok: true, job: j.id, title: 'Tải dữ liệu chấm công tất cả máy TCP/IP' });
  });
  r.get('/devices/tcp-jobs/:job', need('devices'), (req, res) => {
    const j = getJob(req.params.job);
    if (!j) return res.status(404).json({ error: 'Không còn thông tin việc này (máy chủ vừa khởi động lại?)' });
    res.json(j);
  });
  // Chạy 1 thao tác trên máy (chạy nền, giao diện hỏi tiến độ ở /devices/tcp-jobs/:job)
  const TCP_ACTIONS = {
    info: 'Đọc thông tin máy', users: 'Tải nhân viên', logs: 'Tải dữ liệu chấm công', 'set-time': 'Đặt giờ máy', restart: 'Khởi động lại máy',
    'clear-admins': 'Xóa quyền quản trị', 'clear-logs': 'Xóa toàn bộ dữ liệu chấm công trên máy', 'delete-logs': 'Xóa dữ liệu chấm công theo khoảng ngày',
    'clear-users': 'Xóa toàn bộ nhân viên + vân tay trên máy', 'clear-all': 'Xóa sạch máy',
  };
  r.post('/devices/:id/tcp/:action', need('devices'), tcpOn, async (req, res) => {
    const d = db.prepare('SELECT * FROM push_devices WHERE id=?').get(req.params.id);
    if (!d || d.conn_type !== 'tcp') return res.status(404).json({ error: 'Không tìm thấy máy TCP/IP' });
    const action = req.params.action, b = req.body || {};
    if (!TCP_ACTIONS[action]) return res.status(400).json({ error: 'Thao tác không hỗ trợ' });
    // Máy chưa duyệt (chưa có key bản quyền): chỉ được đọc thông tin
    if (action !== 'info' && !d.active) return res.status(400).json({ error: 'Máy chưa được duyệt — duyệt máy trước (dán key bản quyền nếu được yêu cầu).' });
    const from = String(b.from || '').slice(0, 10), to = String(b.to || '').slice(0, 10);
    if (action === 'delete-logs' || (action === 'logs' && (from || to))) {
      if (!ISO.test(from) || !ISO.test(to) || to < from) return res.status(400).json({ error: 'Khoảng ngày không hợp lệ' });
    }
    if (!(await tcpProbe(d.tcp_ip, d.tcp_port))) return res.status(400).json({ error: `Không thấy máy ở ${d.tcp_ip}:${d.tcp_port} — kiểm tra máy đã bật và cùng mạng LAN.` });
    const j = startJob(action, d.name || d.serial, async (prog) => {
      // luôn đọc Serial trước: chặn trường hợp IP này giờ là MÁY KHÁC (đổi máy / trùng IP) → không ghi nhầm dữ liệu, không xoá nhầm máy
      prog('Đang kết nối máy…');
      const info = await tcpInfo(d);
      if (info.serial && info.serial !== d.serial) throw new Error(`Máy ở ${d.tcp_ip} có Serial ${info.serial}, KHÁC máy đã khai (${d.serial}). Dừng lại để tránh nhầm máy — sửa lại IP hoặc thêm máy mới.`);
      saveInfo(d.id, info);
      if (action === 'info') return { info };
      if (action === 'users') { prog('Đang đọc nhân viên từ máy…'); return await tcpUsers(d, prog); }
      if (action === 'logs') {
        prog('Đang đọc nhân viên từ máy…');
        const u = await tcpUsers(d, prog);   // tải NV trước để lượt chấm khớp được người
        prog('Đang đọc dữ liệu chấm công từ máy…');
        return { ...(await tcpLogs(d, from, to, prog)), users: u.read, from, to };
      }
      prog(TCP_ACTIONS[action] + '…');
      const r2 = await zkRun(d, action, { from, to, timeoutMs: 5 * 60000 });
      if (action !== 'restart') { try { const i2 = await tcpInfo(d); saveInfo(d.id, i2); return { info: i2, note: r2.note }; } catch { /* máy đang bận sau khi xoá */ } }
      return { note: r2.note };
    });
    res.json({ ok: true, job: j.id, title: TCP_ACTIONS[action] });
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
    dropConflicts(serial, pins);
    res.json({ ok: true, count: n, msg: `Đã gửi lệnh xóa ${n} nhân viên trên máy.` });
  });

  /* -------- CẢNH BÁO TRÙNG SỐ ID giữa các máy -------- */
  r.get('/devices/pin-conflicts', need('devices'), (req, res) => {
    if (req.query.count) return res.json({ count: countConflicts() });
    res.json({ enabled: guardOn(), rows: listConflicts() });
  });
  // action: same (cùng 1 người) | other (người khác → cấp Số ID mới new_pin) | retry (máy báo lỗi → gửi lại)
  r.post('/devices/pin-conflicts/:id/resolve', need('devices'), (req, res) => {
    const b = req.body || {};
    const by = req.user ? (req.user.full_name || req.user.username || '') : '';
    try {
      if (b.action === 'same') return res.json(resolveSame(+req.params.id, by));
      if (b.action === 'other') return res.json(resolveOther(+req.params.id, b.new_pin, by));
      if (b.action === 'retry') return res.json(retryMove(+req.params.id));
      res.status(400).json({ error: 'Thao tác không hợp lệ' });
    } catch (e) {
      if (e.status === 400) return res.status(400).json({ error: e.message });
      sendCaughtError(res, 'POST /admin/devices/pin-conflicts/:id/resolve', e, { status: 400 });
    }
  });
  // ĐẨY NV TỪ PHẦN MỀM XUỐNG MÁY (bấm tay): pins = Số ID NV chọn, serials = máy chọn, with_bio = kèm vân tay/khuôn mặt phần mềm đang có
  r.post('/devices/push-employees', need('devices'), (req, res) => {
    const b = req.body || {};
    const pins = (Array.isArray(b.pins) ? b.pins : []).map((p) => String(p).trim()).filter(Boolean);
    const serials = (Array.isArray(b.serials) ? b.serials : []).map((p) => String(p).trim()).filter(Boolean);
    if (!pins.length) return res.status(400).json({ error: 'Chưa chọn nhân viên' });
    if (!serials.length) return res.status(400).json({ error: 'Chưa chọn máy' });
    const r2 = pushEmployees(pins, { serials, withBio: !!b.with_bio });
    res.json({ ok: true, ...r2, msg: r2.users ? `Đã gửi ${r2.users} lệnh ghi NV${r2.bios ? ` + ${r2.bios} mẫu vân tay/khuôn mặt` : ''} xuống ${r2.devices} máy. Máy nhận dần khi kết nối.` : 'Không có NV nào để đẩy (NV đã khoá / chưa có Số ID / máy chưa duyệt).' });
  });
  // Đẩy tên NV (phần mềm) xuống mọi máy đang có Số ID của họ — bấm tay, chạy cả khi chưa bật tự đẩy
  r.post('/devices/push-names', need('devices'), (req, res) => {
    const n = pushNames(null, true);
    res.json({ ok: true, queued: n, msg: n ? `Đã gửi ${n} lệnh ghi tên xuống máy. Máy nhận dần khi kết nối.` : 'Không có tên nào cần đẩy (NV chưa có Số ID trên máy nào).' });
  });

  /* -------- Xóa nhân viên trên TẤT CẢ máy 1 lần (khỏi vào từng máy) -------- */
  // Danh sách Số ID: có trên máy nào (theo đồng bộ) + NV phần mềm đang gắn Số ID đó
  r.get('/devices/all-users', need('devices'), (req, res) => {
    const devName = new Map(db.prepare('SELECT serial, name FROM push_devices').all().map((d) => [d.serial, d.name || d.serial]));
    const onDev = new Map();
    for (const s of db.prepare('SELECT serial, pin, name FROM device_users_serial').all()) {
      const p = String(s.pin).trim();
      if (!onDev.has(p)) onDev.set(p, { devices: [], name: '' });
      const o = onDev.get(p); o.devices.push(devName.get(s.serial) || s.serial); if (!o.name && s.name) o.name = s.name;
    }
    const emps = new Map(db.prepare("SELECT id, code, full_name, department, active, device_pin FROM employees WHERE device_pin IS NOT NULL AND device_pin<>''").all()
      .map((e) => [String(e.device_pin).trim(), e]));
    const pins = new Set([...onDev.keys(), ...emps.keys()]);
    const rows = [...pins].map((pin) => {
      const e = emps.get(pin), o = onDev.get(pin) || { devices: [], name: '' };
      return { pin, emp_id: e ? e.id : null, code: e ? e.code : '', name: e ? e.full_name : (o.name || ''), department: e ? (e.department || '') : '',
        active: e ? !!e.active : null, devices: o.devices };
    }).sort((a, b) => (Number(a.pin) - Number(b.pin)) || a.pin.localeCompare(b.pin));
    res.json({ rows });
  });
  // Xóa các Số ID đã chọn trên MỌI máy đang dùng: máy đẩy (ADMS) xếp lệnh chờ máy lấy; máy TCP/IP chạy nền qua SDK
  r.post('/devices/delete-users-all', need('devices'), (req, res) => {
    const pins = [...new Set((Array.isArray(req.body?.pins) ? req.body.pins : []).map((p) => String(p).trim()).filter((p) => /^[0-9A-Za-z_-]{1,20}$/.test(p)))];
    if (!pins.length) return res.status(400).json({ error: 'Chưa chọn nhân viên' });
    const devs = db.prepare("SELECT * FROM push_devices WHERE active=1 ORDER BY name, serial").all();
    const push = devs.filter((d) => d.conn_type !== 'tcp'), tcp = devs.filter((d) => d.conn_type === 'tcp');
    for (const d of push) { deleteDeviceUsers(d.serial, pins); dropConflicts(d.serial, pins); }
    let job = null, tcpNote = '';
    if (tcp.length && !tcpEnabled()) tcpNote = `${tcp.length} máy TCP/IP chưa xoá được vì đang tắt "Dùng máy chấm công kết nối TCP/IP".`;
    else if (tcp.length) {
      job = startJob('delete-users-all', tcp.length + ' máy TCP/IP', async (prog) => {
        const out = [];
        for (const d of tcp) {
          const name = d.name || d.serial;
          prog(`Đang xoá trên máy ${name}…`);
          try {
            if (!(await tcpProbe(d.tcp_ip, d.tcp_port))) throw new Error(`Không thấy máy ở ${d.tcp_ip}:${d.tcp_port}`);
            const info = await tcpInfo(d);
            if (info.serial && info.serial !== d.serial) throw new Error(`IP ${d.tcp_ip} giờ là máy khác (Serial ${info.serial}) — bỏ qua cho an toàn`);
            const gone = [];
            await zkRun(d, 'delete-users', { from: pins.join(','), timeoutMs: 5 * 60000 }, (k, c) => { if (k === 'D' && c[1] === '1') gone.push(c[0]); });
            forgetDeviceUsers(d.serial, pins);
            out.push({ device: name, ok: true, deleted: gone.length });
          } catch (e) { out.push({ device: name, ok: false, error: e.message }); }
        }
        return { devices: out };
      }).id;
    }
    // Máy đang tạm dừng / chờ duyệt mà vẫn còn người này → báo để người dùng biết chưa xoá ở đó
    const ph = pins.map(() => '?').join(',');
    const idle = db.prepare(`SELECT DISTINCT COALESCE(NULLIF(d.name,''), d.serial) AS n FROM push_devices d JOIN device_users_serial s ON s.serial=d.serial
      WHERE d.active=0 AND s.pin IN (${ph})`).all(...pins).map((x) => x.n);
    res.json({ ok: true, pins: pins.length, push: push.map((d) => d.name || d.serial), tcp: tcp.map((d) => d.name || d.serial), job, tcpNote, idle });
  });
}
