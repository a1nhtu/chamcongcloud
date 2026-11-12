/* ---------- MÁY KẾT NỐI TRỰC TIẾP TCP/IP (cổng 4370) ---------- */
// Chạy 1 thao tác trên máy: mở hộp thoại tiến độ, hỏi máy chủ mỗi giây tới khi xong. after(): gọi khi xong (VD tải lại danh sách).
// kind: 'tcp' (máy ZKTeco TCP/IP) | 'hik' (máy Hikvision) — cùng kiểu "phần mềm kết nối vào máy".
async function tcpJob(m, action, body, after, kind = 'tcp') {
  const msg = el('div', { style: 'font-size:15px;font-weight:600' }, 'Đang kết nối máy…');
  const sub = el('div', { class: 'map-hint', style: 'margin-top:8px' }, kind !== 'tcp' ? 'Đang trao đổi dữ liệu với máy. Đừng tắt máy / rút dây mạng.' : 'Trong lúc tải, máy chấm công tạm hiện "Đang làm việc…" và chưa chấm công được. Đừng tắt máy / rút dây mạng.');
  const out = el('div', { style: 'margin-top:12px' });
  const closeB = el('button', { class: 'btn', disabled: '' }, 'Đóng');
  closeB.onclick = () => { closeModal(); after && after(); };
  let title = 'Máy ' + (m.name || m.serial);
  openModal(title, [msg, sub, out], [closeB]);
  const fail = (t) => { msg.textContent = '❌ ' + t; msg.style.color = '#c0392b'; sub.style.display = 'none'; closeB.disabled = false; };
  let job;
  try { const r = await api(`/admin/devices/${m.id}/${kind}/${action}`, { method: 'POST', body: body || {} }); job = r.job; $('#modal h3') && r.title && ($('#modal h3').textContent = r.title + ' · ' + (m.name || m.serial)); }
  catch (e) { return fail(e.message); }
  for (;;) {
    await new Promise((ok) => setTimeout(ok, 1000));
    let j; try { j = await api('/admin/devices/tcp-jobs/' + job); } catch (e) { return fail(e.message); }
    if (j.state === 'run') { msg.textContent = '⏳ ' + j.msg; continue; }
    if (j.state === 'err') return fail(j.msg);
    const r = j.result || {};
    sub.style.display = 'none'; closeB.disabled = false; msg.style.color = '#15803d';
    const line = (k, v) => el('div', { style: 'display:flex;justify-content:space-between;gap:16px;padding:5px 0;border-bottom:1px dashed var(--line,#eee)' }, el('span', { class: 'muted' }, k), el('b', {}, v));
    const n = (v) => Number(v || 0).toLocaleString('vi');
    if (action === 'logs' || action === 'new-logs') {
      msg.textContent = action === 'new-logs' ? '✅ Đã tải các lượt chấm mới' : `✅ Đã tải xong${r.from ? ` ${r.from} → ${r.to}` : ' toàn bộ'}`;
      out.append(line('Lượt chấm đọc từ máy', n(r.read)), line('Lượt chấm MỚI thêm vào phần mềm', n(r.added)), line('Đã có sẵn (bỏ qua, không trùng)', n(r.read - r.added)), line('Nhân viên trên máy', r.users == null && kind === 'tcp' ? 'không đổi (không cần đọc lại)' : n(r.users)));
      if (r.ms && kind === 'tcp') { const sec = (v) => (v / 1000).toLocaleString('vi', { maximumFractionDigits: 1 }) + ' giây';
        out.append(el('div', { class: 'map-hint', style: 'margin-top:8px' }, 'Thời gian: ' + [r.ms.connect != null && 'kiểm tra máy ' + sec(r.ms.connect), r.ms.users != null && 'đọc NV ' + sec(r.ms.users),
          r.ms.range_try && 'thử lọc theo ngày ' + sec(r.ms.range_try), r.ms.read != null && 'đọc chấm công ' + sec(r.ms.read), r.ms.save != null && 'lưu + tính công ' + sec(r.ms.save)].filter(Boolean).join(' · '))); }
      if (r.unmatched) out.append(el('div', { class: 'dv-warn', style: 'margin-top:8px' }, `${r.unmatched} Số ID trên máy chưa khớp nhân viên nào — vào Nhân viên điền "Số ID máy" cho khớp.`));
      if (r.long) out.append(el('div', { class: 'dv-warn', style: 'margin-top:8px' }, `${n(r.long)} người trên máy có Số ID dài hơn 32 ký tự — phần mềm chưa nhận các người này và lượt chấm của họ.`));
      if (!r.ranged && r.from && kind === 'tcp') out.append(el('div', { class: 'map-hint', style: 'margin-top:8px' }, `Máy này (firmware cũ) không lọc được theo ngày nên phần mềm đã đọc cả ${n(r.onDevice)} lượt trên máy rồi lọc lại.`));
      out.append(el('div', { class: 'map-hint', style: 'margin-top:8px' }, 'Công đã tự tính cho các ngày có lượt chấm mới. Xem ở menu Tính công.'));
    } else if (action === 'users') {
      msg.textContent = '✅ Đã tải nhân viên'; out.append(line('Nhân viên đọc từ máy', n(r.read)), line('Đã lưu / cập nhật', n(r.saved)));
      if (r.onDevice != null && r.onDevice !== r.read) out.append(line('Người trên máy', n(r.onDevice)));
      if (r.long) out.append(el('div', { class: 'dv-warn', style: 'margin-top:8px' }, `${n(r.long)} người trên máy có Số ID dài hơn 32 ký tự — phần mềm chưa nhận.`));
      if (r.fps != null) out.append(line('Mẫu vân tay đọc từ máy', n(r.fps)));
      if (r.photos) out.append(el('div', { class: 'map-hint', style: 'margin-top:8px' }, `Đang tải ảnh khuôn mặt đăng ký của ${n(r.photos)} nhân viên về phần mềm (chạy nền${r.photos > 200 ? ', vài phút' : ''}) — xem ở chi tiết nhân viên.`));
    } else if (action === 'sync') {
      msg.textContent = r.devices < 2 && r.note ? '⚠ ' + r.note : `✅ Đã đồng bộ nhóm "${r.group}" (${n(r.devices)} máy)`;
      if (r.devices < 2 && r.note) msg.style.color = '#b45309';
      out.append(line('Người có trên các máy trong nhóm', n(r.people)), line('Người chép sang máy còn thiếu', n(r.users)), line('Ảnh khuôn mặt đã chép', n(r.faces)), line('Vân tay đã chép', n(r.fps)), line('Thẻ đã chép', n(r.cards)));
      for (const p of r.per || []) if (p.users || p.faces || p.fps || p.cards || p.failed) out.append(el('div', { class: 'map-hint', style: 'margin-top:4px' }, `→ ${p.device}: +${n(p.users)} người, +${n(p.faces)} mặt, +${n(p.fps)} vân tay, +${n(p.cards)} thẻ${p.failed ? `, lỗi ${n(p.failed)}` : ''}`));
      if (r.noSavePic && r.noSavePic.length) out.append(el('div', { class: 'dv-warn', style: 'margin-top:8px' }, `Máy ${r.noSavePic.join(', ')} đang tắt lưu ảnh đăng ký: máy vẫn nhận diện được khuôn mặt vừa chép nhưng không giữ ảnh nên không hiện ảnh khi quẹt. Muốn hiện ảnh: bật lưu ảnh khuôn mặt trong cài đặt máy rồi đẩy lại ảnh mặt.`));
      if (r.full) out.append(el('div', { class: 'map-hint', style: 'margin-top:6px;color:#b45309' }, `${n(r.full)} người chưa chép vì máy nhận đã ĐẦY (xem từng máy ở trên). Máy nhỏ chỉ chứa được số người theo hãng — dùng máy lớn hơn hoặc bớt người.`));
      if (r.nofp) out.append(el('div', { class: 'map-hint', style: 'margin-top:6px' }, `${n(r.nofp)} người có vân tay nhưng máy nhận không có đầu đọc vân tay — chỉ chép người / mặt / thẻ.`));
      if (r.skipped) out.append(el('div', { class: 'map-hint', style: 'margin-top:6px' }, `Bỏ qua ${n(r.skipped)} Số ID đang nghi trùng.`));
      if (r.errors?.length) out.append(el('div', { class: 'dv-warn', style: 'margin-top:8px;white-space:normal' }, 'Lỗi: ' + r.errors.join(' · ')));
      if (!r.users && !r.faces && !r.fps && !r.cards && !r.errors?.length && r.devices >= 2) out.append(el('div', { class: 'map-hint', style: 'margin-top:8px' }, 'Các máy đã giống nhau, không có gì cần chép.'));
    } else if (action === 'info') { msg.textContent = '✅ Đã đọc thông tin máy'; out.append(tcpInfoBox(r.info || {})); }
    else if (action === 'delete-users') {
      msg.textContent = `✅ Đã xoá ${n(r.deleted?.length)} nhân viên trên máy`;
      if (r.absent?.length) out.append(line('Không có trên máy (bỏ qua)', n(r.absent.length)));
      if (r.failed?.length) { msg.textContent = `⚠ Xoá được ${n(r.deleted?.length)} / ${n(r.deleted?.length + r.failed.length)} nhân viên`; msg.style.color = '#b45309';
        out.append(el('div', { class: 'dv-warn', style: 'margin-top:8px' }, `Máy không cho xoá ${r.failed.length} Số ID: ${r.failed.slice(0, 30).join(', ')}${r.failed.length > 30 ? '…' : ''}. Thử lại lần nữa; vẫn không được thì xoá tay trên máy (Menu → Quản lý người dùng).`)); }
      if (r.info) out.append(tcpInfoBox(r.info));
    }
    else { msg.textContent = '✅ Xong' + (action === 'set-time' && r.note ? (kind === 'hik' ? ` — ${r.note[0]}` : ` — giờ máy: ${r.note[0]}`) : ''); if (r.info) out.append(tcpInfoBox(r.info)); }
    return;
  }
}
// Khung thông tin + dung lượng (thanh % đã dùng)
function tcpInfoBox(i) {
  const n = (v) => Number(v || 0).toLocaleString('vi');
  const bar = (label, used, cap) => {
    if (!(used >= 0)) return null;
    const pct = cap > 0 ? Math.min(100, Math.round(used / cap * 100)) : 0;
    return el('div', { style: 'margin:8px 0' },
      el('div', { style: 'display:flex;justify-content:space-between;font-size:13px' }, el('span', {}, label), el('b', {}, cap > 0 ? `${n(used)} / ${n(cap)} (${pct}%)` : n(used))),
      cap > 0 ? el('div', { style: 'height:8px;border-radius:99px;background:#eef2f7;overflow:hidden;margin-top:4px' }, el('div', { style: `height:100%;width:${pct}%;background:${pct >= 90 ? '#dc2626' : pct >= 70 ? '#f59e0b' : '#16a34a'}` })) : '');
  };
  const kv = (k, v) => (v ? el('div', { style: 'display:flex;justify-content:space-between;gap:16px;padding:4px 0;font-size:13px' }, el('span', { class: 'muted' }, k), el('b', { style: 'font-family:monospace' }, String(v))) : null);
  return el('div', {},
    bar('Nhân viên', i.users, i.user_cap), bar('Vân tay', i.fps, i.fp_cap), i.faces >= 0 && (i.faces > 0 || i.face_cap > 0) ? bar('Khuôn mặt', i.faces, i.face_cap) : null, i.cards > 0 ? bar('Thẻ', i.cards) : null, bar('Lượt chấm công', i.logs, i.log_cap),
    i.log_cap > 0 && i.logs / i.log_cap >= 0.9 ? el('div', { class: 'dv-warn' }, 'Bộ nhớ lượt chấm sắp đầy — tải dữ liệu về phần mềm rồi xóa lượt chấm trên máy.') : null,
    el('div', { style: 'margin-top:10px;border-top:1px solid var(--line,#eee);padding-top:8px' },
      kv('Serial', i.serial), kv('Quản trị trên máy', i.admins >= 0 ? i.admins : ''), kv('Giờ trên máy', i.time), kv('Firmware', i.firmware), kv('Nền tảng', i.platform), kv('Model', i.model), kv('MAC', i.mac), kv('Thuật toán vân tay', i.fp_version ? 'ZKFinger ' + i.fp_version : '')));
}
function tcpInfoModal(m) { tcpJob(m, 'info', {}, pageDevices); }
// Lịch khởi động lại 'HH:MM|0123456' (0 = CN) → "03:00 hằng ngày" / "03:00 T2, CN" (giống schedLabel ở server/reboot-schedule.js)
const DAY_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
function rebootSchedLabel(s) {
  const m = /^(\d{2}:\d{2})\|([0-6]+)$/.exec(s || '');
  if (!m) return '';
  const ds = [...new Set(m[2].split('').map(Number))];
  return m[1] + ' ' + (ds.length === 7 ? 'hằng ngày' : [...ds.filter((x) => x).sort(), ...ds.filter((x) => !x)].map((x) => DAY_VI[x]).join(', '));
}
// Hẹn giờ khởi động lại máy: Tắt / Hằng ngày / Theo thứ trong tuần (+ áp cho tất cả máy)
function rebootSchedModal(m, rows) {
  const cur = /^(\d{2}:\d{2})\|([0-6]+)$/.exec(m.reboot_sched || '');
  const curDays = cur ? cur[2].split('').map(Number) : [0];
  const mode = el('select', { style: 'width:auto' },
    el('option', { value: 'off' }, 'Tắt'), el('option', { value: 'daily' }, 'Hằng ngày'), el('option', { value: 'weekly' }, 'Theo thứ trong tuần'));
  mode.value = !cur ? 'off' : curDays.length === 7 ? 'daily' : 'weekly';
  const time = el('input', { type: 'time', value: cur ? cur[1] : '03:00', style: 'width:auto' });
  const dayBoxes = [1, 2, 3, 4, 5, 6, 0].map((x) => {
    const c = el('input', { type: 'checkbox', value: x, ...(curDays.includes(x) ? { checked: '' } : {}) });
    return { x, c, lb: el('label', { style: 'display:inline-flex;align-items:center;gap:4px;margin:0 10px 6px 0;font-weight:500' }, c, DAY_VI[x]) };
  });
  const daysRow = el('div', { style: 'margin-top:4px' }, ...dayBoxes.map((b) => b.lb));
  const timeRow = el('div', { style: 'display:flex;gap:10px;align-items:center;margin-top:10px' }, el('span', {}, 'Lúc'), time);
  const allC = el('input', { type: 'checkbox' });
  const others = (rows || []).length - 1;
  const refresh = () => { timeRow.style.display = mode.value === 'off' ? 'none' : 'flex'; daysRow.style.display = mode.value === 'weekly' ? '' : 'none'; };
  mode.onchange = refresh; refresh();
  const save = el('button', { class: 'btn' }, 'Lưu');
  save.onclick = async () => {
    const days = dayBoxes.filter((b) => b.c.checked).map((b) => b.x);
    save.disabled = true;
    try {
      const r = await api(`/admin/devices/${m.id}/reboot-schedule`, { method: 'PUT', body: { mode: mode.value, time: time.value, days, all: allC.checked } });
      toast(r.sched ? `Đã hẹn khởi động lại ${r.label}${r.count > 1 ? ` cho ${r.count} máy` : ''}` : `Đã tắt hẹn giờ khởi động lại${r.count > 1 ? ` cho ${r.count} máy` : ''}`, 'ok');
      closeModal(); pageDevices();
    } catch (e) { toast(e.message, 'err'); save.disabled = false; }
  };
  openModal('⏰ Hẹn giờ khởi động lại · ' + (m.name || m.serial), [
    el('div', { class: 'map-hint', style: 'margin-top:0' }, 'Máy chạy lâu ngày dễ đơ — khởi động lại định kỳ cho máy chạy ổn định. Máy khởi động lại mất khoảng 1 phút, trong lúc đó không chấm được → nên chọn giờ đêm / ngoài giờ làm.'),
    el('div', { style: 'display:flex;gap:10px;align-items:center;margin-top:12px' }, el('b', {}, 'Khởi động lại'), mode),
    timeRow, daysRow,
    others > 0 ? el('label', { style: 'display:flex;align-items:center;gap:6px;margin-top:12px;font-weight:500' }, allC, `Áp dụng cho tất cả ${others + 1} máy`) : '',
    m.reboot_note ? el('div', { style: 'font-size:12.5px;margin-top:10px;color:var(--muted)' }, 'Lần gần nhất: ' + m.reboot_note) : '',
    el('div', { class: 'map-hint', style: 'margin-top:12px' }, 'Phần mềm gửi lệnh khởi động lại đúng giờ hẹn, nên máy tính cài phần mềm phải đang BẬT lúc đó (bản chạy trên VPS / máy chủ luôn bật). Máy tính tắt / ngủ qua giờ hẹn thì bỏ lượt hôm đó, KHÔNG khởi động lại bù giữa giờ làm.'),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), save]);
}
// Tìm máy chấm công trong mạng LAN (dò cổng 4370) → xem máy đang trỏ Cloud Server về đâu → 1 bấm trỏ về tên miền phần mềm này (máy tự khởi động lại)
function lanScanModal() {
  const box = el('div', {}, loading());
  const again = el('button', { class: 'btn ghost' }, '🔄 Tìm lại');
  const warn = (t) => el('div', { style: 'margin:8px 0;padding:8px 12px;border-radius:8px;background:#fff7e0;color:#7a4b00;font-size:13px' }, t);
  let changed = false;
  const close = () => { closeModal(); if (changed) pageDevices(); };
  const svrText = (x) => x.error ? '' : x.svr_fun !== '1' ? 'Chưa bật Cloud Server'
    : x.svr_mode === '1' ? 'Tên miền: ' + (x.svr_url || '(trống)') + (x.svr_port ? ' · cổng ' + x.svr_port : '') + (x.svr_ssl === '1' ? ' · HTTPS' : x.svr_ssl === '0' ? ' · HTTPS tắt' : '') : 'Theo IP' + (x.svr_url ? ': ' + x.svr_url : '') + (x.svr_port ? ' · cổng ' + x.svr_port : '');
  const point = async (x, r, cell) => {
    let key = '';
    // máy báo cần mật khẩu kết nối (bắt tay ZK) / SDK không vào được bằng mật mã 0 → hỏi Comm Key
    if (/^(NEEDKEY|WRONGKEY|CONNECT)/.test(String(x.code || ''))) {
      key = prompt(`${x.code === 'NEEDKEY' ? `Máy ${x.ip} có đặt mật khẩu kết nối` : `Máy ${x.ip} không cho kết nối — có thể máy đặt mật khẩu kết nối`} (Menu → Comm → PC Connection → Comm Key).\nNhập mật khẩu:`, '');
      if (key == null) return;
    }
    if (!confirm(`Trỏ máy ${x.model || ''} ${x.serial || x.ip} về ${r.domain}?\n\nMáy sẽ KHỞI ĐỘNG LẠI (khoảng 1 phút). Nếu máy đang gửi dữ liệu cho phần mềm khác thì sẽ chuyển sang gửi về phần mềm này.\nMáy đang tắt DHCP (IP tĩnh) thì phần mềm bật DHCP để máy tự xin IP từ modem — IP máy có thể đổi.`)) return;
    cell.innerHTML = ''; cell.append(el('span', { class: 'muted' }, 'Đang ghi vào máy…'));
    try {
      const o = await api('/admin/devices/lan-point', { method: 'POST', body: { ip: x.ip, port: x.port, key, udp: !!x.udp } });
      changed = true;
      cell.innerHTML = ''; cell.append(el('span', { class: 'pill ok' }, '✓ Đã trỏ — máy đang khởi động lại'));
      // kết quả bật DHCP (server/zk/zk-tcp.ps1 set-svr): bật cả cổng dây LAN lẫn Wi-Fi, khoá nào máy có
      const inf = o.info || {}, ifs = [['dhcp_lan', 'dây LAN', 'Ethernet'], ['dhcp_wifi', 'Wi-Fi', 'Mạng không dây (Wi-Fi)']];
      const on = ifs.filter(([k]) => inf[k] === 'on').map(([, n]) => n), fail = ifs.filter(([k]) => inf[k] === 'fail');
      const dhcpMsg = [
        inf.dhcp_skip === 'tcp' ? 'Không bật DHCP vì phần mềm đang kết nối máy này theo IP (TCP/IP) — bật DHCP sẽ đổi IP, mất kết nối.' : '',
        on.length ? `Đã bật DHCP (${on.join(' + ')}): máy tự xin IP mới từ modem.` : '',
        ...fail.map(([, n, m]) => `Máy không nhận lệnh bật DHCP ${n} — nếu máy không về, bật tay trên máy: Menu → Comm → ${m} → DHCP.`),
      ].filter(Boolean).join(' ');
      if (dhcpMsg) cell.append(warn(dhcpMsg));
      toast(`Đã trỏ máy ${o.serial || x.ip} về ${o.domain}. Khoảng 1 phút sau máy hiện ở danh sách (Chờ duyệt).${dhcpMsg ? ' ' + dhcpMsg : ''}`, fail.length ? 'err' : 'ok');
    } catch (e) {
      cell.innerHTML = ''; cell.append(el('span', { style: 'color:#b91c1c' }, '❌ ' + e.message)); toast(e.message, 'err');
      if (/^(NEEDKEY|WRONGKEY)$/.test(e.code || '')) cell.append(' ', btnSm('🔑 Nhập lại mật khẩu', () => point({ ...x, code: 'NEEDKEY' }, r, cell), 'ghost'));
    }
  };
  const render = (r) => {
    box.innerHTML = '';
    box.append(el('div', { class: 'map-hint', style: 'margin:0 0 8px' }, `Đã dò mạng ${r.nets.join(', ') || '(không thấy mạng LAN)'} · cổng 4370, 8818 · địa chỉ MAC 00:17:… · MAC Hikvision`));
    box.append(r.domain ? el('div', { style: 'font-size:13.5px;margin-bottom:6px' }, 'Tên miền của phần mềm này: ', el('b', { style: 'font-family:monospace;color:var(--brand-ink,#c0392b)' }, r.domain))
      : warn('Bản cài này chưa có tên miền (bản LAN) — chỉ xem được máy, chưa trỏ tự động được. Trên máy chấm công điền IP + Port theo "Cách A".'));
    if (!r.enabled) box.append(warn('Phần mềm đang TẮT dùng máy chấm công — máy trỏ về sẽ chưa hiện. Liên hệ Digiplus để bật.'));
    if (!r.rows.length) return box.append(warn('Không thấy máy chấm công nào trong mạng. Kiểm tra máy đã bật, cắm dây mạng / Wi-Fi CÙNG mạng với máy tính này, rồi bấm Tìm lại.'));
    const tbl = el('table', { class: 'data' });
    tbl.innerHTML = '<thead><tr><th>Máy</th><th>Đang gửi dữ liệu về</th></tr></thead>';
    const tb = el('tbody');
    for (const x of r.rows) {
      const act = el('div', { style: 'margin-top:6px' });
      if (x.points_here) act.append(el('span', { class: 'pill ok' }, x.known ? (x.known.active ? '✓ Đang dùng' : '✓ Đã về · Chờ duyệt') : '✓ Đã trỏ về đây'));
      // trỏ đúng tên miền mà HTTPS lệch cổng (bật HTTPS + cổng HTTP, hoặc tắt HTTPS + cổng HTTPS) → máy không về được
      const httpsPort = ['443', '2053', '2083', '2087', '2096', '8443'].includes(String(x.svr_port || ''));
      const mismatch = x.points_here && x.svr_port && ((x.svr_ssl === '1' && !httpsPort) || (x.svr_ssl === '0' && httpsPort));
      const offline = x.known && x.known.offline;
      if (mismatch) act.append(warn(`HTTPS ${x.svr_ssl === '1' ? 'đang BẬT' : 'đang TẮT'} nhưng cổng máy là ${x.svr_port} → máy không về được. Bấm "Trỏ lại" để sửa.`));
      else if (x.points_here && offline) act.append(warn('Máy trỏ đúng tên miền nhưng mấy phút nay không về phần mềm. Bấm "Trỏ lại" để ghi lại cài đặt.'));
      if (r.domain && !x.points_here) act.append(btnSm('➜ Trỏ về phần mềm này', () => point(x, r, act)));
      else if (r.domain && x.points_here && (!x.known || mismatch || offline)) act.append(' ', btnSm('Trỏ lại', () => point(x, r, act), 'ghost'));
      const mono = (t) => el('div', { class: 'muted', style: 'font-size:12px;font-family:monospace' }, t);
      // thấy máy qua cổng 8818 / MAC 00:17 nhưng không kết nối SDK được (4370 đóng, 8818 không nhận) → chỉ báo, cài Cloud Server tay trên máy
      const seen = x.no_sdk && [(x.ports || []).length ? 'cổng ' + x.ports.join(', ') : '', x.mac ? 'MAC ' + x.mac : ''].filter(Boolean).join(' · ');
      // 3 trường hợp khác nhau, báo đúng từng cái: máy đã tắt / đổi IP (chỉ còn MAC trong bộ nhớ ARP) · máy từ chối cổng 4370 · máy im ở 4370
      const why = x.offline ? `⚠️ Máy không trả lời (${seen}) — chỉ còn địa chỉ MAC trong bộ nhớ mạng của máy tính: máy vừa TẮT, rút dây mạng hoặc đã ĐỔI IP. Bật máy / xem IP trên máy (Menu → Comm → Ethernet) rồi bấm Tìm lại.`
        : x.closed ? `⚠️ Máy đang bật (${seen}) nhưng TỪ CHỐI kết nối ở cổng 4370 — cổng SDK đang tắt trên máy${x.sdk_tried ? `, cổng ${x.sdk_tried} cũng không nhận` : ''}. Phần mềm không đọc / trỏ tự động được.`
        : `⚠️ Thấy máy (${seen}) nhưng máy không trả lời ở cổng 4370 (đã thử TCP chờ lâu 2 lần + UDP${x.sdk_tried ? ` + cổng ${x.sdk_tried}` : ''}). Kiểm tra IP máy cùng lớp mạng với máy tính rồi bấm Tìm lại.`;
      // MAC Hikvision ở IP này: conflict = lúc dò có máy ZK trả lời rồi im → IP trùng (máy ZKTeco + thiết bị Hikvision cùng 1 IP)
      const zkTip = `Nếu máy chấm công của Anh/Chị là ZKTeco / Ronald Jack: xem MAC trên máy (Menu → Comm → Ethernet / Thông tin hệ thống) — khác ${x.mac} là IP ${x.ip} đang TRÙNG với camera / đầu ghi Hikvision. Đổi IP máy chấm công sang IP trống (VD ${x.ip.split('.').slice(0, 3).join('.')}.2xx chưa ai dùng) rồi bấm Tìm lại.`;
      const noSdk = x.hik ? el('div', {},
        el('span', { style: 'color:#b45309' }, x.conflict
          ? `⚠️ IP ${x.ip} có máy chấm công ZKTeco trả lời lúc dò, nhưng ngay sau đó im — và địa chỉ MAC đang giữ IP này là của Hikvision (${x.mac}). Gần như chắc IP bị TRÙNG: máy chấm công và 1 thiết bị Hikvision (camera / đầu ghi) cùng dùng ${x.ip}, gói tin lúc tới máy này lúc tới máy kia → không đọc được. Máy KHÔNG bận phần mềm nào.`
          : `IP ${x.ip} là thiết bị Hikvision (theo MAC ${x.mac}) — không trả lời giao thức ZKTeco cổng 4370.`),
        warn(zkTip),
        x.conflict ? '' : el('div', { style: 'font-size:12.5px;margin-top:4px' }, `Nếu đúng là máy chấm công Hikvision: phần mềm đọc qua cổng web ${x.web ? `(cổng ${x.web_port} đang trả lời ✓)` : `(cổng ${x.web_port} chưa trả lời)`} — bấm "Thêm máy Hikvision", nhập IP + tài khoản admin + mật khẩu kích hoạt máy. Là camera thì bỏ qua.`,
          r.hik_enabled ? el('div', { style: 'margin-top:6px' }, btnSm('＋ Thêm máy Hikvision', () => hikAddModal(null, { ip: x.ip }))) : ''))
        : x.no_sdk && el('div', {}, el('span', { style: 'color:#b45309' }, why),
        x.offline ? '' : warn(r.domain ? `Hoặc ra máy chấm công: Comm → Cloud Server → bật chế độ tên miền, điền ${r.domain} rồi khởi động lại máy.` : 'Ra máy chấm công cài Cloud Server theo IP + Port ("Cách A").'));
      tb.append(el('tr', {},
        el('td', {}, el('b', {}, x.model || (x.hik ? (x.conflict ? 'Máy chấm công — IP bị trùng?' : 'Thiết bị Hikvision (theo MAC)') : x.no_sdk ? 'Có thể là máy chấm công' : 'Máy chấm công')), x.serial ? mono(x.serial) : '', mono('IP ' + x.ip + (x.port && x.port !== 4370 && !x.no_sdk ? ' · cổng ' + x.port : '') + (x.udp ? ' · UDP' : '')), x.mac ? mono('MAC ' + x.mac) : ''),
        el('td', { style: 'font-size:13px' }, x.no_sdk ? noSdk : x.error ? el('span', { style: 'color:#b45309' }, (x.code === 'NEEDKEY' ? '🔑 ' : '⚠️ Không đọc được: ') + x.error) : svrText(x), x.no_sdk ? '' : act)));
    }
    tbl.append(tb);
    box.append(el('div', { class: 'tbl-scroll' }, tbl),
      el('div', { class: 'map-hint', style: 'margin-top:8px' }, 'Phần mềm ghi vào máy: bật Cloud Server theo tên miền (IclockSvrFun = 1, WebServerURLModel = 1, ICLOCKSVRURL = tên miền; máy có mục HTTPS thì bật IISSupportSSL = 1 + cổng 443) rồi khởi động lại máy.'));
  };
  const run = async () => {
    again.disabled = true;
    box.innerHTML = ''; box.append(el('div', { class: 'map-hint' }, 'Đang dò máy chấm công trong mạng LAN… khoảng 5–30 giây.'), loading());
    try { render(await api('/admin/devices/lan-scan', { method: 'POST' })); }
    catch (e) { box.innerHTML = ''; box.append(warn('❌ ' + e.message)); }
    again.disabled = false;
  };
  again.onclick = run;
  openModal('🔍 Tìm máy chấm công trong mạng LAN', [box], [el('button', { class: 'btn ghost', onclick: close }, 'Đóng'), again]);
  run();
}
// Thêm máy (m = null) / sửa kết nối (m = máy)
function tcpAddModal(m) {
  const nameI = el('input', { placeholder: 'VD Máy cổng chính', value: m ? (m.name || '') : '' });
  const ipI = el('input', { placeholder: '192.168.1.201', value: m ? (m.tcp_ip || '') : '', style: 'font-family:monospace' });
  const portI = el('input', { type: 'number', value: m ? (m.tcp_port || 4370) : 4370, style: 'width:110px' });
  const keyI = el('input', { type: 'number', placeholder: m && m.tcp_has_key ? '(giữ nguyên)' : '0', style: 'width:140px' });
  const go = el('button', { class: 'btn' }, m ? 'Lưu' : '🔌 Kết nối & thêm máy');
  go.onclick = async () => {
    if (!ipI.value.trim()) return toast('Nhập địa chỉ IP của máy chấm công', 'err');
    go.disabled = true; const t = go.textContent; go.textContent = 'Đang kết nối máy…';
    try {
      if (m) { await api(`/admin/devices/${m.id}/tcp`, { method: 'PUT', body: { ip: ipI.value.trim(), port: portI.value, ...(keyI.value !== '' ? { key: keyI.value } : {}) } }); if (nameI.value !== (m.name || '')) await api('/admin/devices/' + m.id, { method: 'PUT', body: { name: nameI.value } }); toast('Đã lưu kết nối', 'ok'); }
      else { const r = await api('/admin/devices/tcp', { method: 'POST', body: { name: nameI.value, ip: ipI.value.trim(), port: portI.value, key: keyI.value } }); toast(`Đã kết nối máy ${r.serial}` + (r.active ? '' : ' — bấm Duyệt để bắt đầu dùng'), 'ok'); }
      closeModal(); pageDevices();
    } catch (e) { toast(e.message, 'err'); go.disabled = false; go.textContent = t; }
  };
  openModal(m ? 'Sửa kết nối · ' + (m.name || m.serial) : 'Thêm máy chấm công TCP/IP', [
    m ? '' : el('div', { class: 'map-hint' }, 'Xem IP trên máy: Menu → Comm / Kết nối → Ethernet (hoặc Wi-Fi). Máy chấm công và máy tính cài phần mềm phải CÙNG mạng LAN. Phần mềm sẽ kết nối thử và tự đọc Serial của máy.'),
    el('label', { style: 'margin-top:10px' }, 'Tên máy'), nameI,
    el('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;margin-top:10px' },
      el('div', { style: 'flex:1;min-width:180px' }, el('label', {}, 'Địa chỉ IP'), ipI),
      el('div', {}, el('label', {}, 'Cổng'), portI),
      el('div', {}, el('label', { title: 'Menu → Comm → PC Connection → Comm Key. Máy không đặt thì để 0.' }, 'Mật mã kết nối (Comm Key)'), keyI)),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), go]);
  setTimeout(() => (m ? ipI : nameI).focus(), 50);
}
// Tải dữ liệu chấm công từ ngày – đến ngày (hoặc toàn bộ). kind: 'tcp' | 'hik'
function tcpLogsModal(m, kind = 'tcp') {
  const today = todayVN();
  const fromI = el('input', { type: 'date', value: today.slice(0, 8) + '01' }), toI = el('input', { type: 'date', value: today });
  const allChk = el('input', { type: 'checkbox', style: 'width:auto' });
  allChk.onchange = () => { fromI.disabled = toI.disabled = allChk.checked; };
  const go = el('button', { class: 'btn' }, '⬇ Tải về');
  go.onclick = () => {
    if (!allChk.checked && (!fromI.value || !toI.value || toI.value < fromI.value)) return toast('Khoảng ngày không hợp lệ', 'err');
    tcpJob(m, 'logs', allChk.checked ? {} : { from: fromI.value, to: toI.value }, pageDevices, kind);
  };
  const last = m.tcp_sync_at ? `Lần tải gần nhất: ${isoToHMS(m.tcp_sync_at)} ngày ${m.tcp_sync_at.slice(8, 10)}/${m.tcp_sync_at.slice(5, 7)}.` : 'Máy này chưa tải lần nào.';
  openModal('Tải dữ liệu chấm công · ' + (m.name || m.serial), [
    el('div', { class: 'map-hint' }, 'Phần mềm kết nối máy, tải danh sách nhân viên rồi tải lượt chấm trong khoảng ngày. Lượt đã có trong phần mềm tự bỏ qua (tải lại nhiều lần không bị trùng). Tải xong công tự tính. ' + last),
    el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px' }, el('span', {}, 'Từ'), fromI, el('span', {}, 'đến'), toI),
    el('label', { style: 'display:flex;gap:8px;align-items:center;margin-top:12px;cursor:pointer' }, allChk, 'Tải TOÀN BỘ lượt chấm còn trên máy (lần đầu chuyển sang phần mềm)'),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng'), go]);
}
// Xóa dữ liệu TRÊN MÁY (không xóa dữ liệu đã tải về phần mềm)
// Máy TCP/IP: chọn từng NV để xoá trên máy (danh sách theo lần "Tải nhân viên" gần nhất) — chạy nền qua SDK
async function tcpDeleteUsersModal(m) {
  const name = m.name || m.serial;
  const searchI = el('input', { type: 'search', placeholder: '🔍 Tìm Số ID, tên…', style: 'flex:1;min-width:180px' });
  const onlyLocked = el('input', { type: 'checkbox', style: 'width:auto' });
  const selAll = el('input', { type: 'checkbox', style: 'width:auto' });
  const box = el('div', { style: 'max-height:340px;overflow:auto;border:1px solid var(--line,#e5e5e5);border-radius:8px;padding:6px 10px;margin-top:8px' }, loading());
  const goBtn = el('button', { class: 'btn', style: 'background:#c0392b;border-color:#c0392b' });
  const picked = new Set();
  let rows = [];
  const shown = () => { const q = searchI.value.trim().toLowerCase(); return rows.filter((u) => (!onlyLocked.checked || u.active === false) && (!q || [u.pin, u.name].some((v) => String(v || '').toLowerCase().includes(q)))); };
  const upd = () => { goBtn.textContent = `🗑 Xóa trên máy (${picked.size})`; goBtn.disabled = !picked.size; };
  const render = () => {
    const list = shown();
    box.innerHTML = '';
    selAll.checked = list.length > 0 && list.every((u) => picked.has(u.pin));
    if (!list.length) { box.append(el('div', { class: 'map-hint' }, rows.length ? 'Không có ai khớp bộ lọc.' : 'Chưa có danh sách nhân viên của máy — bấm "⬇ Tải nhân viên" của máy trước.')); return; }
    for (const u of list.slice(0, 1500)) {
      const cb = el('input', { type: 'checkbox', style: 'width:auto', ...(picked.has(u.pin) ? { checked: '' } : {}) });
      cb.onchange = () => { cb.checked ? picked.add(u.pin) : picked.delete(u.pin); upd(); };
      box.append(el('label', { style: 'display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px dashed var(--line,#eee);font-weight:500;color:var(--ink)' }, cb,
        el('span', {}, el('b', {}, u.pin), ' · ', u.name || el('i', { class: 'muted' }, '(chưa có tên)')),
        u.active === false ? el('span', { class: 'pill bad' }, 'Đã khoá') : u.active == null ? el('span', { class: 'pill warn' }, 'Chưa gắn NV') : '',
        u.privilege > 0 ? el('span', { class: 'pill' }, 'Quản trị') : ''));
    }
    if (list.length > 1500) box.append(el('div', { class: 'map-hint' }, `…còn ${list.length - 1500} người — gõ tìm để thu gọn.`));
  };
  searchI.oninput = render; onlyLocked.onchange = render;
  selAll.onchange = () => { for (const u of shown()) selAll.checked ? picked.add(u.pin) : picked.delete(u.pin); render(); upd(); };
  goBtn.onclick = () => {
    const pins = [...picked];
    if (!pins.length || !confirm(`Xóa ${pins.length} nhân viên trên máy "${name}"?

Vân tay / thẻ / mật mã của họ trên máy sẽ bị xoá. Dữ liệu công trong phần mềm GIỮ NGUYÊN.`)) return;
    tcpJob(m, 'delete-users', { pins }, pageDevices);
  };
  upd();
  openModal('Xóa nhân viên trên máy · ' + name, [
    el('div', { class: 'map-hint', style: 'margin:0 0 8px' }, 'Danh sách theo lần tải nhân viên gần nhất từ máy. Sau khi xoá phần mềm đọc lại máy để báo đúng ai đã xoá được.'),
    el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, searchI,
      el('label', { style: 'display:flex;align-items:center;gap:6px;font-weight:500;color:var(--ink)' }, onlyLocked, 'Chỉ NV đã khoá'),
      el('label', { style: 'display:flex;align-items:center;gap:6px;font-weight:600;color:var(--ink)' }, selAll, 'Chọn tất cả (theo lọc)')),
    box,
  ], [goBtn, el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng')]);
  try { rows = (await api('/admin/devices/' + m.id + '/users')).rows; } catch (e) { box.innerHTML = ''; box.append(el('div', { class: 'dv-warn' }, e.message)); return; }
  if (rows.some((u) => u.active === false)) onlyLocked.checked = true;
  render();
}
function tcpClearModal(m) {
  const today = todayVN();
  const fromI = el('input', { type: 'date', value: today.slice(0, 4) + '-01-01' }), toI = el('input', { type: 'date', value: today });
  const name = m.name || m.serial;
  const row = (title, desc, btn, extra) => el('div', { style: 'padding:12px 0;border-bottom:1px solid var(--line,#eee)' },
    el('div', { style: 'display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap' }, el('div', { style: 'flex:1;min-width:220px' }, el('b', {}, title), el('div', { style: 'font-size:13px;color:var(--muted)' }, desc)), btn), extra || '');
  const ask = (action, q, body) => () => { if (!confirm(q + `\n\nMáy: ${name}\nThao tác này KHÔNG hoàn tác được trên máy.`)) return; if (prompt('Gõ chữ XOA để xác nhận:') !== 'XOA') return toast('Chưa xác nhận — không xóa gì', 'err'); tcpJob(m, action, body ? body() : {}, pageDevices); };
  openModal('Xóa dữ liệu trên máy · ' + name, [
    el('div', { class: 'map-hint' }, 'Chỉ xóa trên MÁY CHẤM CÔNG. Dữ liệu đã tải về phần mềm vẫn giữ nguyên. Nên bấm "⬇ Tải chấm công" (toàn bộ) trước khi xóa lượt chấm.'),
    row('Xóa lượt chấm theo khoảng ngày', 'Chỉ máy firmware mới hỗ trợ; máy cũ sẽ báo không hỗ trợ.', btnSm('Xóa khoảng ngày', ask('delete-logs', `Xóa lượt chấm trên máy từ ${fromI.value} đến ${toI.value}?`, () => ({ from: fromI.value, to: toI.value })), 'ghost'),
      el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px' }, el('span', {}, 'Từ'), fromI, el('span', {}, 'đến'), toI)),
    row('Xóa TOÀN BỘ lượt chấm', 'Giải phóng bộ nhớ lượt chấm khi máy sắp đầy. Nhân viên + vân tay giữ nguyên.', btnSm('Xóa lượt chấm', ask('clear-logs', 'Xóa TOÀN BỘ lượt chấm công trên máy?'), 'ghost')),
    row('Xóa nhân viên đã chọn', 'Chọn từng người (VD nhân viên đã khoá / nghỉ việc) → xoá vân tay + thẻ + mật mã của họ trên máy. Người khác giữ nguyên.', btnSm('Chọn nhân viên…', () => tcpDeleteUsersModal(m), 'ghost')),
    row('Xóa toàn bộ nhân viên + vân tay', 'Máy không còn ai chấm được cho tới khi đăng ký lại. Lượt chấm giữ nguyên.', btnSm('Xóa nhân viên', ask('clear-users', 'Xóa TOÀN BỘ nhân viên + vân tay trên máy?'), 'ghost')),
    row('Xóa sạch máy', 'Lượt chấm + nhân viên + vân tay. Dùng khi chuyển máy sang nơi khác.', btnSm('Xóa sạch', ask('clear-all', 'Xóa SẠCH máy (lượt chấm + nhân viên + vân tay)?'), 'danger')),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng')]);
}

