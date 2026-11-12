/* ---------- MÁY HIKVISION (phần mềm gọi ISAPI vào máy) ---------- */
// MÁY TỰ GỬI LƯỢT CHẤM: chọn địa chỉ máy chủ mà MÁY CHẤM CÔNG gọi tới được → phần mềm ghi lên máy (HTTP Listening) + nhờ máy gửi thử
function hikPushModal(m, d) {
  const opts = [...(d.domain ? [{ host: d.domain, port: 80, label: d.domain + ' (qua internet)' }] : []),
    ...(d.server_ips || []).map((ip) => ({ host: ip, port: d.port, label: `${ip}:${d.port} (mạng LAN)` }))];
  const hostI = el('input', { value: opts[0] ? opts[0].host : '', placeholder: '192.168.1.10', style: 'font-family:monospace' });
  const portI = el('input', { type: 'number', value: opts[0] ? opts[0].port : (d.port || 8686), style: 'width:100px' });
  const pick = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 10px' }, ...opts.map((o) => btnSm(o.label, () => { hostI.value = o.host; portI.value = o.port; }, 'ghost')));
  const when = (iso) => `${isoToHMS(iso)} ngày ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const urlB = (u) => el('b', { style: 'font-family:monospace;word-break:break-all' }, u);
  const out = el('div', { style: 'margin-top:10px' });
  if (m.hik_push_url) out.append(el('div', { class: 'map-hint', style: 'margin-top:0' }, 'Đang cài: ', urlB(m.hik_push_url), m.hik_push_at ? ` · tin gần nhất từ máy: ${when(m.hik_push_at)}` : ' · chưa nhận tin nào từ máy'));
  const go = el('button', { class: 'btn' }, m.hik_push_url ? '📡 Cài lại lên máy' : '📡 Cài lên máy');
  go.onclick = async () => {
    if (!hostI.value.trim()) return toast('Nhập địa chỉ máy chủ phần mềm', 'err');
    go.disabled = true; const t = go.textContent; go.textContent = 'Đang cài lên máy…';
    try {
      const r = await api(`/admin/devices/${m.id}/hik-push`, { method: 'POST', body: { host: hostI.value.trim(), port: portI.value } });
      const ok = /^ok$/i.test(r.test);
      out.innerHTML = '';
      out.append(el('div', { style: 'font-weight:600;color:#15803d' }, '✅ Đã cài địa chỉ nhận lên máy (ô số ' + r.slot + ')'), el('div', { class: 'map-hint', style: 'margin-top:4px' }, 'Địa chỉ: ', urlB(r.url)),
        el('div', { class: ok || !r.test ? 'map-hint' : 'dv-warn', style: 'margin-top:4px;white-space:normal' }, ok ? '✅ Máy gửi thử về phần mềm: thành công.'
          : r.test ? '⚠️ Máy gửi thử: ' + r.test + ' — kiểm tra máy chấm công gọi tới được địa chỉ trên (cùng mạng, đúng cổng, tường lửa).'
          : 'Máy không có lệnh gửi thử — quẹt thử 1 lần rồi bấm "Xem quẹt" để kiểm tra.'));
      if (r.lost?.length) out.append(el('div', { class: 'dv-warn', style: 'margin-top:6px;white-space:normal' }, `⚠️ Máy này chỉ giữ được 1 địa chỉ nhận: địa chỉ của phần mềm khác (${r.lost.join(', ')}) đã bị máy tự xoá. Phần mềm đó (VD iVMS-4200) sẽ không nhận lượt chấm tức thì nữa — vẫn tải lượt chấm được bình thường.`));
      toast('Đã cài máy tự gửi lượt chấm', 'ok');
    } catch (e) { toast(e.message, 'err'); }
    go.disabled = false; go.textContent = t;
  };
  openModal('Máy tự gửi lượt chấm · ' + (m.name || m.serial), [
    el('div', { class: 'map-hint' }, 'Phần mềm ghi địa chỉ nhận lên máy (HTTP Listening). Từ đó mỗi lần nhân viên chấm, máy GỬI NGAY lượt chấm về phần mềm — khỏi chờ tới giờ tự tải. Chọn địa chỉ mà MÁY CHẤM CÔNG gọi tới được: cùng mạng LAN thì chọn IP máy tính cài phần mềm; phần mềm chạy trên VPS / tên miền thì chọn tên miền (cổng 80).'),
    opts.length ? el('b', {}, 'Chọn nhanh') : '', pick,
    el('div', { style: 'display:flex;gap:12px;flex-wrap:wrap' },
      el('div', { style: 'flex:1;min-width:200px' }, el('label', {}, 'IP / tên miền máy chủ phần mềm'), hostI),
      el('div', {}, el('label', { title: 'Cổng phần mềm. 443 = HTTPS' }, 'Cổng'), portI)),
    el('div', { class: 'map-hint', style: 'margin-top:8px' }, 'Nên để "Tự động tải" theo lịch làm dự phòng: máy mất mạng lúc chấm thì lượt đó được tải bù sau, không bị trùng.'),
    out,
  ], [el('button', { class: 'btn ghost', onclick: () => { closeModal(); pageDevices(); } }, 'Đóng'), go]);
}
// Tiến độ ghi NV (+ ảnh khuôn mặt) xuống máy Hikvision sau khi bấm "Đẩy NV xuống máy"
async function hikPushJobModal(job, withFace, after) {
  const msg = el('div', { style: 'font-size:15px;font-weight:600' }, '⏳ Đang ghi xuống máy…');
  const out = el('div', { style: 'margin-top:12px' });
  const closeB = el('button', { class: 'btn', disabled: '' }, 'Đóng');
  closeB.onclick = () => { closeModal(); after && after(); };
  openModal('Ghi nhân viên xuống máy', [msg, out], [closeB]);
  for (;;) {
    await new Promise((ok) => setTimeout(ok, 1000));
    let j; try { j = await api('/admin/devices/tcp-jobs/' + job); } catch (e) { msg.textContent = '❌ ' + e.message; closeB.disabled = false; return; }
    if (j.state === 'run') { msg.textContent = '⏳ ' + j.msg; continue; }
    closeB.disabled = false;
    if (j.state === 'err') { msg.textContent = '❌ ' + j.msg; msg.style.color = '#c0392b'; return; }
    msg.textContent = '✅ Đã xong'; msg.style.color = '#15803d';
    for (const x of (j.result && j.result.devices) || []) {
      out.append(el('div', { style: 'display:flex;justify-content:space-between;gap:16px;padding:6px 0;border-bottom:1px dashed var(--line,#eee)' }, el('b', {}, x.device),
        el('span', {}, !x.ok ? '❌ ' + x.error : x.tcp
          ? `Ghi ${x.pushed} NV${withFace ? ` · ${x.fps || 0} mẫu vân tay` : ''}${x.failed ? ` · lỗi ${x.failed}` : ''}${x.fp_failed ? ` · ${x.fp_failed} vân tay không ghi được` : ''}`
          : `Ghi ${x.pushed} NV${withFace ? ` · ${x.faces || 0} ảnh khuôn mặt` : ''}${x.failed || x.face_failed ? ` · lỗi ${(x.failed || 0) + (x.face_failed || 0)}` : ''}`)));
      if (x.tcp && x.failed_pins?.length) out.append(el('div', { class: 'dv-warn', style: 'margin-top:4px' }, 'Máy không nhận Số ID: ' + x.failed_pins.slice(0, 30).join(', ')));
      for (const er of x.errors || []) out.append(el('div', { class: 'dv-warn', style: 'margin-top:4px;white-space:normal' }, er));
    }
    if (withFace && (j.result?.devices || []).some((x) => !x.tcp)) out.append(el('div', { class: 'map-hint', style: 'margin-top:8px' }, 'Ảnh khuôn mặt lấy từ ảnh phần mềm đã có (ảnh tải lên ở form nhân viên, hoặc máy khác gửi về). NV chưa có ảnh thì chỉ ghi Số ID + tên — thêm ảnh ở form nhân viên hoặc đăng ký mặt trực tiếp trên máy.'));
    return;
  }
}
// Thêm máy (m = null) / sửa kết nối (m = máy)
// pre = { ip } điền sẵn (bấm từ "Tìm máy LAN")
function hikAddModal(m, pre = {}) {
  const nameI = el('input', { placeholder: 'VD Máy cổng chính', value: m ? (m.name || '') : '' });
  const ipI = el('input', { placeholder: '192.168.1.64', value: m ? (m.tcp_ip || '') : (pre.ip || ''), style: 'font-family:monospace' });
  const portI = el('input', { type: 'number', value: m ? (m.tcp_port || 80) : 80, style: 'width:100px' });
  const userI = el('input', { value: m ? (m.dev_user || 'admin') : 'admin', style: 'width:140px' });
  const passI = el('input', { type: 'password', placeholder: m && m.has_pass ? '(giữ nguyên)' : 'Mật khẩu máy', style: 'width:180px', autocomplete: 'new-password' });
  const go = el('button', { class: 'btn' }, m ? 'Lưu' : '🔌 Kết nối & thêm máy');
  go.onclick = async () => {
    if (!ipI.value.trim()) return toast('Nhập địa chỉ IP của máy Hikvision', 'err');
    if (!m && !passI.value) return toast('Nhập mật khẩu đăng nhập máy', 'err');
    go.disabled = true; const t = go.textContent; go.textContent = 'Đang kết nối máy…';
    const body = { ip: ipI.value.trim(), port: portI.value, user: userI.value.trim(), ...(passI.value ? { pass: passI.value } : {}) };
    try {
      if (m) { await api(`/admin/devices/${m.id}/hik`, { method: 'PUT', body }); if (nameI.value !== (m.name || '')) await api('/admin/devices/' + m.id, { method: 'PUT', body: { name: nameI.value } }); toast('Đã lưu kết nối', 'ok'); }
      else { const r = await api('/admin/devices/hik', { method: 'POST', body: { ...body, name: nameI.value } }); toast(`Đã kết nối máy ${r.serial}` + (r.active ? '' : ' — bấm Duyệt để bắt đầu dùng'), 'ok'); }
      closeModal(); pageDevices();
    } catch (e) { toast(e.message, 'err'); go.disabled = false; go.textContent = t; }
  };
  openModal(m ? 'Sửa kết nối · ' + (m.name || m.serial) : 'Thêm máy chấm công Hikvision', [
    m ? '' : el('div', { class: 'map-hint' }, 'Xem IP trên máy: Menu → Communication / Network. Tài khoản mặc định "admin", mật khẩu là mật khẩu đặt lúc kích hoạt máy. Phần mềm phải CÙNG mạng LAN với máy (hoặc máy đã được mở port ra internet). Phần mềm sẽ đăng nhập thử và tự đọc Serial.'),
    el('label', { style: 'margin-top:10px' }, 'Tên máy'), nameI,
    el('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;margin-top:10px' },
      el('div', { style: 'flex:1;min-width:180px' }, el('label', {}, 'Địa chỉ IP'), ipI),
      el('div', {}, el('label', { title: 'Cổng web của máy (HTTP), mặc định 80' }, 'Cổng'), portI)),
    el('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;margin-top:10px' },
      el('div', {}, el('label', {}, 'Tài khoản'), userI),
      el('div', {}, el('label', {}, 'Mật khẩu'), passI)),
    el('div', { class: 'map-hint', style: 'margin-top:8px' }, '⚠️ Nhập sai mật khẩu nhiều lần, máy Hikvision sẽ tạm khoá đăng nhập khoảng 30 phút.'),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), go]);
  setTimeout(() => (m ? ipI : nameI).focus(), 50);
}

/* ---------- MÁY AI (tự nối về qua WebSocket): thao tác = gửi lệnh, máy làm khi đang kết nối ---------- */
async function aiCall(m, action, body, confirmMsg) {
  if (confirmMsg && !confirm(confirmMsg)) return;
  try { const r = await api(`/admin/devices/${m.id}/ai/${action}`, { method: 'POST', body: body || {} }); toast(r.msg || 'Đã gửi lệnh', r.online ? 'ok' : 'err'); }
  catch (e) { toast(e.message, 'err'); }
}
// Tải lại lượt chấm cũ còn trên máy (theo khoảng ngày / toàn bộ) — máy gửi dần lên, công tự tính
function aiLogsModal(m) {
  const today = todayVN();
  const fromI = el('input', { type: 'date', value: today.slice(0, 8) + '01' }), toI = el('input', { type: 'date', value: today });
  const allChk = el('input', { type: 'checkbox', style: 'width:auto' });
  allChk.onchange = () => { fromI.disabled = toI.disabled = allChk.checked; };
  const go = el('button', { class: 'btn' }, '⬇ Tải về');
  go.onclick = async () => {
    if (!allChk.checked && (!fromI.value || !toI.value || toI.value < fromI.value)) return toast('Khoảng ngày không hợp lệ', 'err');
    closeModal(); aiCall(m, 'logs', allChk.checked ? {} : { from: fromI.value, to: toI.value });
  };
  openModal('Tải lại dữ liệu chấm công · ' + (m.name || m.serial), [
    el('div', { class: 'map-hint' }, 'Bình thường máy AI tự gửi lượt chấm về ngay khi chấm. Dùng mục này khi cần lấy lại lượt cũ (máy mới nối phần mềm, mất mạng lâu…). Lượt đã có tự bỏ qua, công tự tính lại. Máy phải đang kết nối.'),
    el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px' }, el('span', {}, 'Từ'), fromI, el('span', {}, 'đến'), toI),
    el('label', { style: 'display:flex;gap:8px;align-items:center;margin-top:12px;cursor:pointer' }, allChk, 'Tải TOÀN BỘ lượt chấm còn trên máy'),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng'), go]);
}
// Xóa dữ liệu TRÊN MÁY AI (không xóa dữ liệu đã có trong phần mềm)
function aiClearModal(m) {
  const name = m.name || m.serial;
  const row = (title, desc, btn) => el('div', { style: 'padding:12px 0;border-bottom:1px solid var(--line,#eee);display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap' },
    el('div', { style: 'flex:1;min-width:220px' }, el('b', {}, title), el('div', { style: 'font-size:13px;color:var(--muted)' }, desc)), btn);
  const ask = (action, q) => () => { if (!confirm(q + `\n\nMáy: ${name}\nThao tác này KHÔNG hoàn tác được trên máy.`)) return; if (prompt('Gõ chữ XOA để xác nhận:') !== 'XOA') return toast('Chưa xác nhận — không xóa gì', 'err'); closeModal(); aiCall(m, action); };
  openModal('Xóa dữ liệu trên máy · ' + name, [
    el('div', { class: 'map-hint' }, 'Chỉ xóa trên MÁY CHẤM CÔNG. Dữ liệu đã có trong phần mềm vẫn giữ nguyên.'),
    row('Xóa TOÀN BỘ lượt chấm', 'Giải phóng bộ nhớ lượt chấm. Nhân viên + vân tay / khuôn mặt giữ nguyên.', btnSm('Xóa lượt chấm', ask('clear-logs', 'Xóa TOÀN BỘ lượt chấm công trên máy?'), 'ghost')),
    row('Xóa toàn bộ nhân viên', 'Máy không còn ai chấm được cho tới khi đăng ký lại. Lượt chấm giữ nguyên.', btnSm('Xóa nhân viên', ask('clear-users', 'Xóa TOÀN BỘ nhân viên + vân tay / khuôn mặt trên máy?'), 'ghost')),
    row('Xóa sạch máy', 'Nhân viên + lượt chấm (cài đặt máy giữ nguyên). Dùng khi chuyển máy sang nơi khác.', btnSm('Xóa sạch', ask('clear-all', 'Xóa SẠCH máy (nhân viên + lượt chấm)?'), 'danger')),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng')]);
}

// Ô "ID máy" (kiểu Ronald Jack) ngay trên bảng máy: gõ số là lưu; lẻ = máy VÀO, chẵn = máy RA, 0 = vào + ra.
// Đổi xong chỉ cần bấm "↻ Tính lại" ở trang Tính công (ghép lại giờ vào/ra theo ID mới).
function idCell(m) {
  const can = hasPerm('devices');
  const tag = el('div', { class: 'dv-sub', style: 'text-align:center' });
  const show = (n) => { tag.textContent = !n ? 'vào + ra' : n % 2 ? 'máy VÀO' : 'máy RA'; tag.style.color = !n ? '' : n % 2 ? '#15803d' : '#b45309'; };
  const inp = el('input', { type: 'number', min: 0, max: 99, value: m.machine_number || 0, style: 'width:62px;text-align:center;padding:5px 6px;margin:0', ...(can ? {} : { disabled: '' }) });
  show(m.machine_number || 0);
  inp.oninput = () => show(parseInt(inp.value, 10) || 0);
  inp.onchange = async () => {
    const n = Math.max(0, parseInt(inp.value, 10) || 0); inp.value = n;
    try { await api('/admin/devices/' + m.id, { method: 'PUT', body: { machine_number: n } }); m.machine_number = n; toast('Đã lưu ID máy. Bấm "↻ Tính lại" ở trang Tính công để áp cho các ngày đã chấm', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  };
  return el('td', { class: 'c' }, inp, tag);
}

// Nhập dữ liệu chấm công + nhân viên từ USB (máy không nối mạng)
function usbImportModal() {
  const doImport = (kind, file, btn) => {
    const reader = new FileReader();
    reader.onload = async () => {
      if (btn) { btn.disabled = true; btn.textContent = 'Đang nhập…'; }
      try {
        const r = await api('/admin/devices/import-usb', { method: 'POST', body: { kind, fileBase64: reader.result } });
        if (kind === 'users') toast(`Đã nhập ${r.total} nhân viên (${r.created} NV mới)`, 'ok');
        else toast(`Đã nhập ${r.punches} lượt chấm, tạo ${r.newEmps} NV mới`, 'ok');
        closeModal(); pageDevices();
      } catch (e) { toast(e.message, 'err'); if (btn) { btn.disabled = false; btn.textContent = btn._t; } }
    };
    reader.readAsDataURL(file);
  };
  const attFile = el('input', { type: 'file', accept: '.dat,.txt,.csv', style: 'display:block;margin-top:6px' });
  attFile.onchange = () => { if (attFile.files[0]) doImport('attlog', attFile.files[0]); };
  const usrFile = el('input', { type: 'file', accept: '.dat,.txt,.csv', style: 'display:block;margin-top:6px' });
  usrFile.onchange = () => { if (usrFile.files[0]) doImport('users', usrFile.files[0]); };
  openModal('Nhập dữ liệu từ USB', [
    el('div', { class: 'map-hint' }, 'Dùng khi máy chấm công KHÔNG nối mạng: cắm USB vào máy → chọn "Tải dữ liệu ra USB / Download" trên máy → rút USB cắm vào máy tính → chọn file bên dưới.'),
    el('div', { style: 'margin:14px 0;padding-top:8px;border-top:1px solid #f0efec' },
      el('div', { style: 'font-weight:700' }, '1) Nhập dữ liệu chấm công'),
      el('div', { class: 'map-hint', style: 'margin:2px 0 0' }, 'File thường tên *_attlog.dat hoặc .txt. Tự tạo NV cho Số ID chưa có rồi tính công.'),
      attFile),
    el('div', { style: 'margin:14px 0;padding-top:8px;border-top:1px solid #f0efec' },
      el('div', { style: 'font-weight:700' }, '2) Nhập danh sách nhân viên'),
      el('div', { class: 'map-hint', style: 'margin:2px 0 0' }, 'File danh sách NV: mỗi dòng "Số ID [tab/phẩy] Tên nhân viên".'),
      usrFile),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng')]);
}

// CHUYỂN DỮ LIỆU TỪ PHẦN MỀM CŨ (Wise Eye On39 / V5.1 / Ronald Jack Pro, file .mdb): bộ phận + nhân viên + lượt chấm.
// Bước 1 chọn phần mềm cũ (On39 / V5.1 có mật khẩu file, Ronald Jack không) + chọn file .mdb → bước 2 xem trước + chọn phần cần chuyển → bước 3 chạy nền, hiện tiến độ.
function legacyImportModal() {
  const SOFT = {
    on39: { name: 'Wise Eye On39', path: 'C:\\WiseEyeOn39\\Data\\WiseEyeOn39.mdb', pass: '12112009' },
    we51: { name: 'Wise Eye V5.1', path: 'C:\\Program Files\\WiseEyeV5.1\\Data\\WiseEyeV5.1.mdb', pass: '12112009' },   // cùng cấu trúc file với On39
    rj: { name: 'Ronald Jack Pro', path: 'C:\\Program Files (x86)\\RonaldJackVN\\Ronald Jack Pro\\Data\\RJData.mdb', pass: '' },
  };
  let kind = '';
  const status = el('div', { class: 'map-hint', style: 'min-height:18px;margin:10px 0 0' });
  const box = el('div');
  const busy = (msg) => { status.textContent = msg; status.style.color = ''; };
  const fail = (msg) => { status.textContent = '⚠ ' + msg; status.style.color = '#b91c1c'; };
  const pass = el('input', { type: 'text', autocomplete: 'off', style: 'margin:0;max-width:200px' });
  const upload = async (file) => {
    if (!file) return;
    if (!/\.(mdb|accdb)$/i.test(file.name)) return fail('Chọn file .mdb của ' + SOFT[kind].name);
    try {
      // Nén gzip ngay trong trình duyệt: file .mdb phần lớn là trang trống → nhỏ đi 4–11 lần (26 MB → 2,3 MB),
      // máy chủ qua tên miền / mạng chậm nhận nhanh hơn hẳn. Trình duyệt cũ không có CompressionStream thì gửi file thô.
      let body = file;
      if (typeof CompressionStream === 'function') {
        busy(`Đang nén ${file.name} (${fmtSize(file.size)})…`);
        try { body = await new Response(file.stream().pipeThrough(new CompressionStream('gzip'))).blob(); } catch { body = file; }
      }
      const q = `?kind=${kind}&password=${encodeURIComponent(kind !== 'rj' ? pass.value.trim() : '')}`;
      const r = await sendWithProgress('/api/admin/legacy/parse-upload' + q, body, (sent, total) => {
        const pct = total ? Math.floor((sent / total) * 100) : 0;
        busy(pct < 100 ? `Đang gửi ${file.name} lên máy chủ: ${fmtSize(sent)} / ${fmtSize(total)} (${pct}%)…`
          : `Máy chủ đang đọc ${file.name}…`);
      });
      if (r.ok) preview(r); else fail(r.error || 'Không đọc được file');
    } catch (e) { fail(e.message); }
    finally { fileI.value = ''; }   // chọn lại đúng file đó vẫn đọc lại được
  };
  // fetch không báo tiến độ tải lên → dùng XHR để hiện % (file lớn qua mạng chậm khỏi tưởng treo)
  const sendWithProgress = (url, body, onProgress) => new Promise((ok, no) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.setRequestHeader('Authorization', 'Bearer ' + getToken());
    x.setRequestHeader('X-Device-Id', deviceId());
    x.setRequestHeader('Content-Type', 'application/octet-stream');
    x.upload.onprogress = (e) => onProgress(e.loaded, e.lengthComputable ? e.total : body.size);
    x.upload.onload = () => onProgress(body.size, body.size);
    x.onload = () => { try { ok(JSON.parse(x.responseText)); } catch { ok({ error: 'Máy chủ trả lỗi ' + x.status }); } };
    x.onerror = () => no(new Error('Mất kết nối tới máy chủ khi gửi file — kiểm tra mạng rồi chọn lại file'));
    x.send(body);
  });
  const fileI = el('input', { type: 'file', accept: '.mdb,.accdb', style: 'display:none' });
  fileI.onchange = () => upload(fileI.files[0]);
  const pickBtn = el('button', { class: 'btn' }, '📂 Chọn file .mdb…');
  pickBtn.onclick = () => fileI.click();
  const where = el('div', { class: 'map-hint', style: 'margin:4px 0 0' });
  const passRow = el('div', { style: 'display:flex;gap:8px;align-items:center;margin:10px 0 0;flex-wrap:wrap' }, el('span', {}, 'Mật khẩu file Access:'), pass);
  const fileSec = el('div', { style: 'display:none;margin:14px 0 0;padding-top:10px;border-top:1px solid #f0efec' },
    el('div', { style: 'font-weight:700' }, '2) Chọn file dữ liệu'), where, passRow,
    el('div', { style: 'margin-top:12px' }, pickBtn, fileI));
  // 2 ô chọn phần mềm: bấm ô nào thì hiện đúng chỗ để file + mật khẩu của phần mềm đó
  const cards = {};
  const choose = (k) => {
    kind = k; status.textContent = '';
    for (const [kk, c] of Object.entries(cards)) { c.style.borderColor = kk === k ? 'var(--brand, #ea580c)' : '#e5e7eb'; c.style.background = kk === k ? '#fff7ed' : '#fff'; }
    where.replaceChildren('File dữ liệu thường nằm ở: ', el('code', { style: 'font-size:12px' }, SOFT[k].path),
      k === 'on39' ? ' (bản dùng SQL Server thì không có file .mdb)' : '');
    pass.value = SOFT[k].pass;
    passRow.style.display = k !== 'rj' ? 'flex' : 'none';
    fileSec.style.display = '';
    pickBtn.textContent = '📂 Chọn file .mdb của ' + SOFT[k].name + '…';
  };
  for (const [k, s] of Object.entries(SOFT)) {
    cards[k] = el('button', { type: 'button', style: 'flex:1;min-width:180px;padding:14px;border:2px solid #e5e7eb;border-radius:12px;background:#fff;color:inherit;cursor:pointer;text-align:left' },
      el('div', { style: 'font-weight:700;font-size:15px' }, s.name), el('div', { class: 'map-hint', style: 'margin:2px 0 0' }, k !== 'rj' ? 'File có mật khẩu' : 'File không có mật khẩu'));
    cards[k].onclick = () => choose(k);
  }
  const step1 = [
    el('div', { class: 'map-hint' }, 'Lấy BỘ PHẬN + NHÂN VIÊN + DỮ LIỆU CHẤM CÔNG từ phần mềm cũ sang Digiplus. Phần mềm cũ không bị thay đổi gì. Nhập lại nhiều lần cũng không bị trùng.'),
    el('div', { style: 'margin:14px 0 0;font-weight:700' }, '1) Chọn phần mềm đang dùng'),
    el('div', { style: 'display:flex;gap:10px;margin-top:8px;flex-wrap:wrap' }, cards.on39, cards.we51, cards.rj),
    fileSec,
  ];
  box.append(...step1);
  openModal('Chuyển dữ liệu từ Wise Eye On39 / V5.1 / Ronald Jack Pro', [box, status], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng')]);

  // Bước 2: XEM TRƯỚC + chọn phần cần chuyển
  function preview({ token, summary: s }) {
    status.textContent = '';
    const chk = (on, label, hint) => {
      const c = el('input', { type: 'checkbox', style: 'width:auto;margin:3px 0 0;flex:none', ...(on ? { checked: '' } : {}) });
      return [c, el('label', { style: 'display:flex;gap:10px;align-items:flex-start;margin:10px 0;cursor:pointer;font-weight:400' }, c,
        el('div', { style: 'flex:1' }, el('b', {}, label), hint ? el('div', { class: 'map-hint', style: 'margin:2px 0 0' }, hint) : ''))];
    };
    const [cD, lD] = chk(s.depts > 0, `Bộ phận: ${s.depts} (${s.depts_new} chưa có trong Digiplus)`, s.dept_names.join(' · ') || 'Phần mềm cũ chưa khai báo bộ phận');
    const [cE, lE] = chk(s.emps > 0, `Nhân viên: ${s.emps} (${s.emps_new} NV mới · ${s.emps_existing} đã có)`,
      'NV đã có khớp theo Số ID máy (hoặc mã NV) → chỉ điền ô đang trống, không tạo trùng. NV mới mật khẩu app mặc định 123456.' + (s.emps_no_dept ? ` ${s.emps_no_dept} NV chưa có bộ phận.` : ''));
    // Chọn bộ phận cần lấy: bỏ tick (VD "Nghỉ việc") → không tạo bộ phận đó, không lấy NV + lượt chấm của NV đó
    const pick = (label, n) => {
      const c = el('input', { type: 'checkbox', checked: '', style: 'width:auto;margin:0;flex:none' });
      return [c, el('label', { style: 'display:flex;gap:8px;align-items:center;margin:0;cursor:pointer;font-weight:400;font-size:13px' }, c, el('span', {}, label), el('span', { class: 'map-hint', style: 'margin:0' }, `(${n} NV)`))];
    };
    const deptPicks = (s.dept_list || []).map((d) => [d.key, ...pick(d.name, d.emps)]);
    const [cNo, lNo] = pick('NV chưa có bộ phận', s.emps_no_dept || 0);
    const pickBox = deptPicks.length ? el('div', { style: 'margin:0 0 8px 24px' },
      el('div', { class: 'map-hint', style: 'margin:0 0 4px' }, 'Chỉ lấy bộ phận được tick (bỏ tick bộ phận như "Nghỉ việc" → không lấy bộ phận + NV + lượt chấm của NV đó):'),
      el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:4px 12px;max-height:180px;overflow:auto' },
        ...deptPicks.map((x) => x[2]), ...(s.emps_no_dept ? [lNo] : []))) : '';
    const dmy = (d) => d.split('-').reverse().join('/');
    const [cP, lP] = chk(s.punches > 0, `Dữ liệu chấm công: ${s.punches.toLocaleString('vi')} lượt` + (s.first_date ? ` (từ ${dmy(s.first_date)} đến ${dmy(s.last_date)})` : ''),
      'Lượt trùng tự bỏ qua; công các ngày được tính lại theo ca đang cài ở Digiplus.');
    const [cO, lO] = chk(false, 'Ghi đè thông tin NV đã có', 'Lấy tên, bộ phận, chức danh, SĐT, ngày vào làm theo phần mềm cũ (mặc định chỉ điền ô trống).');
    const fromI = el('input', { type: 'date', value: s.first_date, style: 'margin:0;width:auto' }), toI = el('input', { type: 'date', value: s.last_date, style: 'margin:0;width:auto' });
    const range = el('div', { style: 'display:flex;gap:8px;align-items:center;margin:0 0 6px 24px;flex-wrap:wrap;font-size:13px' }, el('span', {}, 'Chỉ lấy từ ngày'), fromI, el('span', {}, 'đến'), toI);
    cP.onchange = () => { range.style.display = cP.checked ? 'flex' : 'none'; };
    cP.onchange();
    const go = el('button', { class: 'btn' }, '⇄ Chuyển dữ liệu');
    go.onclick = async () => {
      if (!cD.checked && !cE.checked && !cP.checked) return toast('Chưa chọn phần nào để chuyển', 'err');
      if (cP.checked && fromI.value && toI.value && toI.value < fromI.value) return toast('Khoảng ngày không hợp lệ', 'err');
      go.disabled = true;
      try {
        const r = await api('/admin/legacy/apply', { method: 'POST', body: { token, depts: cD.checked, emps: cE.checked, punches: cP.checked, overwrite: cO.checked, from: fromI.value, to: toI.value,
          skip_depts: deptPicks.filter((x) => !x[1].checked).map((x) => x[0]), skip_no_dept: !cNo.checked } });
        run(r.job);
      } catch (e) { go.disabled = false; toast(e.message, 'err'); }
    };
    const back = btnSm('← Chọn file khác', () => { box.innerHTML = ''; box.append(...step1); $('#modal .m-foot').replaceChildren(el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng')); }, 'ghost');
    box.innerHTML = '';
    box.append(
      el('div', { class: 'panel', style: 'padding:10px 14px;margin:0 0 10px;background:#f8fafc' },
        el('div', {}, el('b', {}, s.label), s.company ? ' · ' + s.company : ''),
        s.machines.length ? el('div', { class: 'map-hint', style: 'margin:4px 0 0' }, 'Máy chấm công: ' + s.machines.map((m) => `${m.name || 'Máy'} (${m.serial})`).join(' · ')) : ''),
      lD, lE, pickBox, lP, range, lO, back);
    $('#modal .m-foot').replaceChildren(el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng'), go);
  }

  // Bước 3: chạy nền — hỏi tiến độ tới khi xong
  function run(job) {
    const bar = el('div', { class: 'xp-bar' }, el('i', {}));
    const pct = el('b', {}, '0%'), msg = el('div', { class: 'map-hint', style: 'margin:0' }, 'Bắt đầu…');
    box.innerHTML = '';
    box.append(el('div', { style: 'display:flex;justify-content:space-between;gap:10px' }, el('span', {}, 'Đang chuyển dữ liệu — đóng hộp này máy chủ vẫn chạy tiếp'), pct), bar, msg);
    $('#modal .m-foot').replaceChildren(el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng'));
    const t0 = Date.now();
    const poll = async () => {
      let j;
      try { j = await api('/admin/legacy/job/' + job); } catch (e) { msg.textContent = e.message; return setTimeout(poll, 1500); }
      bar.firstChild.style.width = j.pct + '%'; pct.textContent = j.pct + '%';
      msg.textContent = `${j.msg} · ${Math.round((Date.now() - t0) / 1000)} giây`;
      if (j.state === 'run') return setTimeout(poll, 700);
      if (j.state === 'err') { msg.textContent = '⚠ Lỗi: ' + j.msg; msg.style.color = '#b91c1c'; return; }
      const x = j.result;
      const line = `Đã chuyển từ ${x.label}: ${x.depts_created} bộ phận mới · ${x.emps_created} NV mới, ${x.emps_updated} NV cập nhật`
        + (x.emps_linked ? `, ${x.emps_linked} NV gắn Số ID` : '') + ` · ${x.punches_new.toLocaleString('vi')} lượt chấm mới / ${x.punches_read.toLocaleString('vi')} lượt đọc được`;
      box.append(el('div', { class: 'panel', style: 'padding:10px 14px;margin:12px 0 0;border-color:#86efac;background:#f0fdf4' }, '✅ ' + line,
        el('div', { class: 'map-hint', style: 'margin:4px 0 0' }, 'Kiểm tra lại ở trang Nhân viên (bộ phận, Số ID) và Tính công. Nhớ khai báo ca / lịch trình cho NV mới để tính công đúng.')));
      toast('Chuyển dữ liệu xong', 'ok');
    };
    poll();
  }
}

// Xóa dữ liệu trên máy chấm công (gửi lệnh ADMS) + xóa chấm công trong phần mềm theo ngày
// Tải lại log chấm công CŨ từ máy theo khoảng ngày (DATA QUERY ATTLOG)
function deviceAttlogModal(m) {
  const fromI = el('input', { type: 'date' }), toI = el('input', { type: 'date' });
  fromI.value = addDays(todayVN(), -30); toI.value = todayVN();
  const go = el('button', { class: 'btn' }, '⬇ Tải log về');
  go.onclick = async () => {
    if (!fromI.value || !toI.value) return toast('Chọn khoảng ngày', 'err');
    try { const r = await api('/admin/devices/' + m.id + '/query-attlog', { method: 'POST', body: { from: fromI.value, to: toI.value } }); toast(r.msg || 'Đã gửi lệnh', 'ok'); closeModal(); }
    catch (e) { toast(e.message, 'err'); }
  };
  openModal('Tải lại log chấm công · ' + (m.name || m.serial), [
    el('div', { class: 'map-hint' }, 'Yêu cầu máy gửi lại các lượt chấm công đã lưu trong khoảng ngày. Log về sẽ tự tính lại công. Chỉ tải được log MÁY CÒN LƯU (máy đầy sẽ ghi đè log cũ nhất).'),
    el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px' }, el('span', {}, 'Từ'), fromI, el('span', {}, 'đến'), toI, go),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng')]);
}
async function deviceClearModal(m) {
  const post = async (path, body, okMsg) => { try { const r = await api('/admin/devices/' + m.id + path, { method: 'POST', body: body || {} }); toast(r.msg || okMsg || 'Đã gửi lệnh', 'ok'); return r; } catch (e) { toast(e.message, 'err'); throw e; } };
  const userBox = el('div', { style: 'max-height:160px;overflow:auto;border:1px solid var(--line,#e5e5e5);border-radius:8px;padding:6px 10px;margin-top:6px' }, loading());
  const selAll = el('input', { type: 'checkbox', style: 'width:auto' });
  const loadUsers = async () => {
    let rows = []; try { rows = (await api('/admin/devices/' + m.id + '/users')).rows; } catch {}
    userBox.innerHTML = '';
    if (!rows.length) { userBox.append(el('div', { class: 'map-hint' }, 'Chưa có dữ liệu nhân viên trên máy này (theo đồng bộ).')); return; }
    for (const u of rows) userBox.append(el('label', { style: 'display:flex;align-items:center;gap:8px;padding:3px 0;font-weight:500;color:var(--ink)' },
      el('input', { type: 'checkbox', class: 'dc-pick', value: u.pin, style: 'width:auto' }), `${u.pin}${u.name ? ' · ' + u.name : ''}${u.privilege > 0 ? ' · [Quản trị]' : ''}`));
  };
  selAll.onchange = () => userBox.querySelectorAll('.dc-pick').forEach((c) => { c.checked = selAll.checked; });
  const delUsersBtn = el('button', { class: 'btn' }, 'Xóa NV đã chọn khỏi máy');
  delUsersBtn.onclick = async () => {
    const pins = [...userBox.querySelectorAll('.dc-pick:checked')].map((x) => x.value);
    if (!pins.length) return toast('Chưa chọn nhân viên', 'err');
    if (!confirm(`Xóa ${pins.length} nhân viên khỏi máy "${m.name || m.serial}"? (không xóa dữ liệu trong phần mềm)`)) return;
    const r = await post('/delete-users', { pins }); loadUsers(); pageDevices();
    cmdTrack(`Xóa ${pins.length} NV trên máy ${m.name || m.serial}`, r.track);
  };
  const fromI = el('input', { type: 'date' }), toI = el('input', { type: 'date' });
  const rangeBtn = el('button', { class: 'btn' }, 'Xóa chấm công (phần mềm)');
  rangeBtn.onclick = async () => {
    if (!fromI.value || !toI.value) return toast('Chọn khoảng ngày', 'err');
    if (!confirm(`XÓA dữ liệu chấm công TRONG PHẦN MỀM từ ${fromI.value} đến ${toI.value}? Không thể hoàn tác.`)) return;
    try { const r = await api('/admin/attendance/clear-range', { method: 'POST', body: { from: fromI.value, to: toI.value } }); toast(`Đã xóa ${r.attendance} bản ghi công + ${r.punches} lượt quẹt`, 'ok'); } catch (e) { toast(e.message, 'err'); }
  };
  const clearLogBtn = el('button', { class: 'btn ghost' }, '🧹 Xóa log chấm công trên máy');
  clearLogBtn.onclick = () => { if (confirm(`Xóa TOÀN BỘ log chấm công trên máy "${m.name || m.serial}"?\n(Dữ liệu đã đồng bộ về phần mềm vẫn còn.)`)) post('/clear-log'); };
  const clearAdminBtn = el('button', { class: 'btn ghost' }, '👤 Xóa quyền quản trị');
  clearAdminBtn.onclick = () => { if (confirm('Hạ quyền tất cả quản trị trên máy về nhân viên thường (Pri=0)?')) post('/clear-admins'); };
  const clearAllBtn = el('button', { class: 'btn', style: 'background:#c0392b' }, '⚠️ Xóa TOÀN BỘ dữ liệu máy');
  clearAllBtn.onclick = () => { if (confirm(`XÓA SẠCH máy "${m.name || m.serial}": toàn bộ nhân viên + vân tay + log trên máy. Không hoàn tác được trên máy.`) && confirm('Xác nhận LẦN 2: xóa toàn bộ dữ liệu trên máy?')) { post('/clear-all'); pageDevices(); } };

  openModal('Xóa dữ liệu máy · ' + (m.name || m.serial), [
    el('div', { class: 'map-hint' }, 'Lệnh gửi xuống MÁY sẽ chạy khi máy có kết nối mạng. Xóa log máy KHÔNG mất dữ liệu đã đồng bộ về phần mềm.'),
    el('div', { style: 'margin-top:12px;padding-top:8px;border-top:1px solid #f0efec' },
      el('div', { style: 'font-weight:700;margin-bottom:6px' }, '1) Xóa nhân viên trên máy'),
      el('div', { style: 'display:flex;align-items:center;gap:10px' }, el('label', { style: 'display:flex;align-items:center;gap:6px;font-weight:600;color:var(--ink)' }, selAll, 'Chọn tất cả'), delUsersBtn),
      userBox),
    el('div', { style: 'margin-top:14px;padding-top:8px;border-top:1px solid #f0efec' },
      el('div', { style: 'font-weight:700;margin-bottom:6px' }, '2) Xóa nhanh trên máy'),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, clearLogBtn, clearAdminBtn, clearAllBtn)),
    el('div', { style: 'margin-top:14px;padding-top:8px;border-top:1px solid #f0efec' },
      el('div', { style: 'font-weight:700;margin-bottom:6px' }, '3) Xóa chấm công trong phần mềm (theo khoảng ngày)'),
      el('div', { class: 'map-hint', style: 'margin:0 0 6px' }, 'Xóa bản ghi công + lượt quẹt trong phần mềm (không đụng máy). Dùng khi cần dọn dữ liệu sai.'),
      el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, el('span', {}, 'Từ'), fromI, el('span', {}, 'đến'), toI, rangeBtn)),
  ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng')]);
  loadUsers();
}
// Xem giờ trên máy: gửi lệnh đọc đồng hồ rồi chờ máy trả lời (máy hỏi lệnh ~10 giây/lần). Chỉ đọc, không đổi gì trên máy.
async function deviceClockModal(m) {
  const box = el('div', {}, el('div', { class: 'empty' }, '⏳ Đang hỏi giờ máy "' + (m.name || m.serial) + '"… (chờ tối đa 45 giây)'));
  let stop = false;
  openModal('Giờ trên máy · ' + (m.name || m.serial), [box], [el('button', { class: 'btn', onclick: () => { stop = true; closeModal(); } }, 'Đóng')]);
  const show = (...nodes) => { box.innerHTML = ''; box.append(...nodes); };
  let since;
  try { since = (await api('/admin/devices/' + m.id + '/read-clock', { method: 'POST' })).since; }
  catch (e) { return show(el('div', { class: 'empty' }, e.message)); }
  const toMs = (s) => { const [d, t] = s.split(' '); const [y, mo, da] = d.split('-').map(Number); const [h, mi, se] = t.split(':').map(Number); return Date.UTC(y, mo - 1, da, h, mi, se); };
  for (let i = 0; i < 22 && !stop; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    let row;
    try { row = ((await api('/admin/devices')).rows || []).find((x) => x.id === m.id); } catch { continue; }
    if (!row || !row.clock_at || row.clock_at < since) continue;
    if (!row.clock_text) {
      return show(el('div', { class: 'empty' }, 'Máy có trả lời nhưng không đọc được giờ (dòng máy này có thể không hỗ trợ lệnh xem giờ).'),
        el('div', { style: 'font-size:12px;color:var(--muted);word-break:break-all' }, 'Máy trả về: ' + (row.clock_raw || '(trống)')));
    }
    const diff = Math.round((toMs(row.clock_text) - toMs(row.clock_at)) / 1000);
    const abs = Math.abs(diff), mins = Math.round(abs / 60);
    const verdict = abs <= 90
      ? el('b', { style: 'color:#1a7f37' }, '✓ Giờ máy khớp máy chủ (lệch ' + abs + ' giây)')
      : el('b', { style: 'color:#c0392b' }, '⚠ Máy ' + (diff > 0 ? 'NHANH' : 'CHẬM') + ' hơn máy chủ khoảng ' + (mins >= 1 ? mins + ' phút' : abs + ' giây'));
    return show(
      el('div', { style: 'font-size:15px;line-height:2' },
        el('div', {}, 'Giờ trên máy: ', el('b', { style: 'font-family:monospace' }, row.clock_text)),
        el('div', {}, 'Giờ máy chủ lúc nhận: ', el('b', { style: 'font-family:monospace' }, row.clock_at)),
        el('div', {}, verdict)),
      el('div', { style: 'font-size:12px;color:var(--muted);margin-top:8px' }, 'Sai số vài giây là bình thường (thời gian truyền). Nếu lệch, bấm "🕒 Đồng bộ giờ" ở dòng máy đó.'));
  }
  if (!stop) show(el('div', { class: 'empty' }, 'Máy chưa trả lời sau 45 giây. Máy có thể đang offline, hoặc dòng máy này không hỗ trợ lệnh xem giờ từ xa.'));
}
function devicePunchesModal(m) {
  const box = el('div', {}, loading());
  api('/admin/devices/' + m.id + '/punches').then(({ rows }) => {
    box.innerHTML = '';
    if (!rows.length) { box.append(el('div', { class: 'empty' }, 'Chưa có lượt quẹt nào.')); return; }
    const t = el('table', { class: 'data' });
    t.innerHTML = '<thead><tr><th>Mã</th><th>Nhân viên</th><th>Thời điểm</th><th>Kiểu</th><th></th></tr></thead>';
    const tb = el('tbody');
    const vName = { 1: 'Vân tay', 15: 'Khuôn mặt', 4: 'Thẻ', 0: 'Mật mã' };
    for (const p of rows) {
      const tr = el('tr', {},
        el('td', {}, p.pin),
        el('td', {}, p.full_name || el('span', { class: 'pill warn' }, 'chưa khớp')),
        el('td', {}, isoToHMS(p.punch_at) + ' ' + p.punch_at.slice(8, 10) + '/' + p.punch_at.slice(5, 7)),
        el('td', {}, vName[p.verify] || ('#' + p.verify)),
        el('td', {}, btnSm('🗑', async () => {
          if (!confirm('Xoá lượt quẹt này (quẹt nhầm/nghịch)?\nLưu ý: nếu bấm "Tính lại công" thì giờ tính từ các lượt quẹt còn lại.')) return;
          try { await api('/admin/devices/' + m.id + '/punch/' + p.id, { method: 'DELETE' }); tr.remove(); toast('Đã xoá lượt quẹt', 'ok'); }
          catch (e) { toast(e.message, 'err'); }
        }, 'ghost')));
      tb.append(tr);
    }
    t.append(tb);
    box.append(el('div', { class: 'tbl-scroll' }, t));
  }).catch(e => { box.innerHTML = ''; box.append(el('div', { class: 'empty' }, e.message)); });
  openModal('Lượt quẹt gần đây — ' + (m.name || m.serial), [box], [el('button', { class: 'btn', onclick: closeModal }, 'Đóng')]);
}

const REPORT_TYPES = [
  ['horizontal', 'Bảng công ngang'],
  ['detail', 'Chi tiết chấm công'],
  ['attendance', 'Chấm công'],
  ['late', 'Đi muộn / về sớm'],
  ['ot', 'Tăng ca'],
  ['leave', 'Nghỉ phép / đơn từ'],
  ['symbol', 'Ký hiệu công'],
  ['summary', 'Tổng hợp nhân viên'],
  ['firstlast', 'Giờ vào-ra đầu/cuối'],
  ['payroll', 'Bảng lương 💰'],
];
const SYMBOL_COLOR = { X: '#166534', T: '#b45309', P: '#1d4ed8', KL: '#475569', CT: '#0e7490', K: '#6b21a8', L: '#7c3aed', V: '#dc2626', O: '#b45309' };
// Nhóm báo cáo cho giao diện dạng thẻ: [nhóm, [ [type, icon, tên, mô tả] ... ]]
const REPORT_GROUPS = [
  ['Bản ghi chấm công', [
    ['attendance', '📋', 'Bản ghi chấm công', 'Tất cả lần chấm: giờ vào/ra, đi muộn, vị trí'],
    ['firstlast', '🕐', 'Giờ vào & ra đầu/cuối', 'Giờ chấm sớm nhất và muộn nhất mỗi ngày'],
  ]],
  ['Chi tiết chấm công', [
    ['detail', '📆', 'Chi tiết theo ngày', 'Chi tiết chấm công từng ngày của từng nhân viên'],
    ['detaillist', '🧾', 'Chi tiết chấm công (danh sách)', 'Danh sách mỗi NV × mỗi ngày: vào/ra, trễ, sớm, công, tăng ca, ca'],
    ['empsheet', '🖨️', 'Bảng chi tiết từng nhân viên (in A4)', 'Mỗi nhân viên 1 trang A4: tổng giờ/công/trễ/sớm/vắng + chi tiết từng ngày + chỗ ký tên. Bấm Xuất Excel để in'],
    ['empsheetlate', '⏰', 'Đi muộn / về sớm theo nhân viên (in A4)', 'Chỉ nhân viên có đi muộn/về sớm, chỉ những ngày đó; mỗi người 1 trang A4 có chỗ ký tên. Bấm Xuất Excel để in'],
    ['detailmulti', '🔁', 'Chi tiết chấm công (nhiều lần vào/ra)', 'Mỗi NV × mỗi ngày: Giờ vào 1 → Giờ ra 4 theo từng lần chấm, trễ, sớm, giờ, công, tăng ca'],
    ['daytime', '⏱️', 'Chi tiết giờ vào/ra', 'Giờ vào–ra thực tế từng ngày trong tháng (ma trận)'],
    ['workhours', '🕘', 'Giờ công & tăng ca', 'Ma trận giờ công mỗi ngày + tổng giờ, giờ tăng ca'],
    ['track6', '🗒️', 'Bảng theo dõi chấm công (4 lần quẹt)', 'Mỗi nhân viên 6 dòng × từng ngày: Vào 1 · Ra 1 · Vào 2 · Ra 2 · Giờ HC · Giờ TC, kèm ngày công, giờ công, nghỉ từng loại, tăng ca. Dành cho công ty chấm 4 lần/ngày (Đến – Ra trưa – Vào lại – Về)'],
    ['horizontal', '📊', 'Bảng công ngang', 'Ma trận ngày × NV: mỗi ô là SỐ CÔNG trong ngày + tổng công, tăng ca, trễ, sớm, vắng, nghỉ (xem số giờ ở Bảng thống kê chấm công (giờ))'],
    ['hourstat', '🕒', 'Bảng thống kê chấm công (giờ)', 'Ma trận ngày × NV theo SỐ GIỜ mỗi ngày + giờ công, tăng ca TC1–TC3, vắng, nghỉ từng loại, trễ, sớm'],
    ['symbol', '🔤', 'Bảng ký hiệu / Thống kê tháng', 'X=làm · T=trễ/sớm · P=phép · KL=không lương · CT=công tác · K=nghỉ khác · L=lễ · V=vắng · O=thiếu ra'],
    ['late', '⏰', 'Đi muộn / về sớm', 'Danh sách đi muộn, về sớm và số phút'],
    ['ot', '➕', 'Tăng ca', 'Chi tiết giờ tăng ca theo ngày'],
  ]],
  ['Tổng hợp', [
    ['summary', '👥', 'Tổng hợp nhân viên', 'Tổng công, giờ, tăng ca, trễ, sớm mỗi NV'],
    ['absence', '🚫', 'Vắng mặt / nghỉ phép', 'Số ngày làm, vắng, nghỉ phép, nghỉ lễ, thiếu ra'],
    ['leave', '🌴', 'Nghỉ phép / đơn từ', 'Tổng nghỉ phép và chi tiết theo loại'],
    ['payroll', '💰', 'Bảng lương', 'Chọn trọn tháng = theo kỳ lương đã cài; chọn từ ngày đến ngày = đúng khoảng đó'],
  ]],
  ['Công ảo 3 mức', [
    ['audit3', '🎭', 'Tổng hợp tăng ca 3 mức', 'Mỗi NV: ngày đi làm, công, tăng ca THẬT và tăng ca Ảo 1 / Ảo 2 / Ảo 3 (giờ)'],
    ['audit3day', '🎭', 'Chi tiết công ảo 3 mức theo ngày', 'Mỗi NV × ngày: giờ vào / ra + tăng ca của Thật, Ảo 1, Ảo 2, Ảo 3'],
  ]],
  ['Kiểm soát', [
    ['manualtime', '✍️', 'Giờ sửa/thêm bằng tay', 'Vết ai (quản trị/quản lý) sửa/thêm giờ, ngày giờ nào — theo thời gian sửa'],
  ]],
];

// MẪU THEO GIỜ: không có công / trễ sớm / tăng ca → ẩn báo cáo chỉ toàn những thứ đó (máy chủ cũng bỏ các cột đó ở báo cáo còn lại)
const REPORT_HOURLY_HIDE = ['late', 'ot', 'symbol', 'horizontal', 'empsheetlate', 'audit3', 'audit3day'];
// Tên + mô tả thẻ khi xem mẫu theo giờ
const REPORT_HOURLY_TEXT = {
  attendance: ['Bản ghi chấm công', 'Tất cả lần chấm: giờ vào/ra, tổng giờ, vị trí'],
  detaillist: ['Chi tiết chấm công (danh sách)', 'Danh sách mỗi NV × mỗi ngày: giờ vào/ra, tổng giờ'],
  empsheet: ['Bảng chi tiết từng nhân viên (in A4)', 'Mỗi nhân viên 1 trang A4: tổng giờ, số ngày làm, vắng + chi tiết từng ngày + dòng tổng giờ + chỗ ký tên. Bấm Xuất Excel để in'],
  detailmulti: ['Chi tiết chấm công (nhiều lần vào/ra)', 'Mỗi NV × mỗi ngày: Giờ vào 1 → Giờ ra 4 theo từng lần chấm, tổng giờ'],
  workhours: ['Giờ làm theo ngày', 'Ma trận giờ vào/ra + giờ làm mỗi ngày'],
  track6: ['Bảng theo dõi chấm công (4 lần quẹt)', 'Mỗi nhân viên 5 dòng × từng ngày: Vào 1 · Ra 1 · Vào 2 · Ra 2 · Giờ làm, kèm tổng giờ, nghỉ từng loại'],
  hourstat: ['Bảng thống kê chấm công (giờ)', 'Ma trận ngày × NV theo SỐ GIỜ mỗi ngày + tổng giờ, vắng, nghỉ từng loại'],
  daytime: ['Chi tiết giờ vào/ra', 'Giờ vào–ra thực tế từng ngày trong tháng (ma trận) + tổng giờ'],
  summary: ['Tổng hợp nhân viên', 'Tổng giờ, vắng, nghỉ mỗi NV'],
};

// KHUNG THU GỌN được: nút tam giác ▼/▶ cạnh tiêu đề; gọn = chỉ còn 1 dòng tiêu đề + tóm tắt (nhường chỗ cho lưới chính).
// Nhớ trạng thái trên máy theo `key`. summary(): chữ tóm tắt hiện khi đang gọn.
function foldPanel(panel, key, title, summary, defFolded = false) {
  const tg = el('button', { type: 'button', class: 'fold-tg', title: 'Thu gọn / mở rộng' });
  const sum = el('span', { class: 'fold-sum muted' });
  const head = el('div', { class: 'fold-head' }, tg, el('b', {}, title), sum);
  panel.prepend(head);
  let folded = defFolded; try { const v = localStorage.getItem('fold_' + key); if (v != null) folded = v === '1'; } catch {}
  const apply = () => { panel.classList.toggle('folded', folded); tg.textContent = folded ? '▶' : '▼'; sum.textContent = folded && summary ? summary() : ''; };
  head.onclick = (ev) => { if (ev.target.closest('input,select,button:not(.fold-tg)')) return; folded = !folded; try { localStorage.setItem('fold_' + key, folded ? '1' : '0'); } catch {} apply(); };
  apply();
  return { refresh: apply };
}

// CÀI ĐẶT: mỗi khung (có tiêu đề h3) thu gọn được bằng nút ▶/▼ — mặc định GỌN hết, khung nào đã mở thì nhớ trên máy
// opts.only: chỉ thu gọn đúng các khung này (không thêm nút "Mở tất cả")
function foldSettings(root, opts = {}) {
  const panels = (opts.only || [...root.querySelectorAll('.panel')]).filter((p) => p && !p.parentElement.closest('.panel') && p.querySelector(':scope > h3'));
  for (const p of panels) {
    const h = p.querySelector(':scope > h3');
    const key = 'fold_st_' + h.textContent.trim();
    const tg = el('button', { type: 'button', class: 'fold-tg', title: 'Mở / thu gọn' });
    const head = el('div', { class: 'fold-head st-head' }, tg, h);
    p.prepend(head);
    let open = false; try { open = localStorage.getItem(key) === 'open'; } catch {}
    const apply = () => { p.classList.toggle('folded', !open); tg.textContent = open ? '▼' : '▶'; };
    p._setOpen = (o) => { open = o; try { localStorage.setItem(key, open ? 'open' : 'closed'); } catch {} apply(); };
    head.onclick = (ev) => { if (ev.target.closest('input,select,a,button:not(.fold-tg)')) return; p._setOpen(!open); };
    apply();
  }
  if (opts.only) return;
  // nút "Mở tất cả / Thu gọn tất cả" ở đầu trang
  const all = el('button', { type: 'button', class: 'btn ghost sm st-all' });
  const sync = () => { all.textContent = panels.some((p) => p.classList.contains('folded')) ? '▼ Mở tất cả' : '▶ Thu gọn tất cả'; };
  all.onclick = () => { const openAll = panels.some((p) => p.classList.contains('folded')); panels.forEach((p) => p._setOpen(openAll)); sync(); };
  panels.forEach((p) => p.querySelector('.fold-head').addEventListener('click', () => setTimeout(sync, 0)));
  sync();
  const tb = root.querySelector('.page-head .toolbar'); if (tb) tb.append(all); else root.prepend(all);
}

// VẼ DẦN bảng dài (VD 650 NV × 30 ngày = hàng chục nghìn dòng — vẽ 1 lần làm trình duyệt đơ):
// vẽ 200 dòng đầu, cuộn gần cuối bảng thì vẽ tiếp 200 (dữ liệu đã tải đủ, chỉ chưa vẽ) + nút "Hiện tất cả".
// Trả start(scrollRoot) — gọi SAU khi bảng đã gắn vào trang; scrollRoot = khung cuộn chứa bảng (null = cả trang).
function lazyRows(tb, rows, mkRow, colspan) {
  const CHUNK = 200; let shown = 0, io = null, root = null;
  const txt = el('span', { class: 'muted' });
  const more = el('tr', { class: 'more-row' }, el('td', { colspan, style: 'text-align:center;padding:14px' }, txt, ' ', btnSm('Hiện tất cả', () => add(rows.length), 'ghost')));
  const near = () => more.getBoundingClientRect().top < (root ? root.getBoundingClientRect().bottom : innerHeight) + 400;
  const add = (n) => {
    const end = Math.min(rows.length, shown + n), frag = document.createDocumentFragment();
    for (; shown < end; shown++) frag.append(mkRow(rows[shown]));
    tb.insertBefore(frag, more);
    if (shown >= rows.length) { more.remove(); if (io) io.disconnect(); return; }
    txt.textContent = `Đang hiện ${shown.toLocaleString('vi')} / ${rows.length.toLocaleString('vi')} dòng — cuộn xuống để xem tiếp`;
    if (more.isConnected) requestAnimationFrame(() => { if (more.isConnected && near()) add(CHUNK); });
  };
  if (rows.length) { tb.append(more); add(CHUNK); }
  return (scrollRoot = null) => {
    if (!more.isConnected) return;
    root = scrollRoot;
    io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) add(CHUNK); }, { root, rootMargin: '400px' });
    io.observe(more);
  };
}

// PHÂN TRANG bảng dài: người dùng chọn 20 / 50 / 100 dòng mỗi trang (mặc định 20, nhớ lựa chọn theo key trên trình duyệt này).
// st = { page } giữ ngoài để tải lại (sửa giờ xong) vẫn đứng đúng trang. Trả thanh phân trang để đặt dưới bảng.
const PAGE_SIZES = [20, 50, 100];
// Tính công — Chi tiết: 'emp' = theo bộ phận → tên → mã NV, trong mỗi người theo ngày; 'date' = theo ngày rồi tên.
// Đánh dấu r._first ở dòng đầu mỗi nhân viên (chế độ 'emp') để kẻ vạch ngăn cách.
function sortDetailRows(rows, by) {
  const cmp = (a, b) => (a || '').localeCompare(b || '', 'vi');
  if (by === 'date') rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || cmp(a.name, b.name) || cmp(a.code, b.code));
  else rows.sort((a, b) => cmp(a.dept, b.dept) || cmp(a.name, b.name) || cmp(a.code, b.code) || (a.employee_id - b.employee_id) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let prev = null;
  for (const r of rows) { r._first = by !== 'date' && r.employee_id !== prev; prev = r.employee_id; }
  return rows;
}
function pagedRows(tb, rows, mkRow, colspan, st, key) {
  let size = 20;
  try { const v = +localStorage.getItem(key); if (PAGE_SIZES.includes(v)) size = v; } catch {}
  const bar = el('div', { class: 'pager', style: 'display:flex;gap:10px;align-items:center;justify-content:flex-end;flex-wrap:wrap;padding:10px 14px;border-top:1px solid var(--line);font-size:13px' });
  const sizeSel = el('select', { style: 'width:auto;padding:4px 8px' }, ...PAGE_SIZES.map((n) => el('option', { value: n, ...(n === size ? { selected: '' } : {}) }, n + ' dòng')));
  const render = () => {
    const pages = Math.max(1, Math.ceil(rows.length / size));
    st.page = Math.min(Math.max(1, st.page || 1), pages);
    const from = (st.page - 1) * size, part = rows.slice(from, from + size);
    tb.replaceChildren(...(rows.length ? part.map(mkRow) : [el('tr', {}, el('td', { colspan }, el('div', { class: 'empty' }, 'Không có dữ liệu.')))]));
    const go = (p) => { st.page = p; render(); bar.scrollIntoView({ block: 'nearest' }); };
    const prev = el('button', { class: 'btn ghost sm', ...(st.page <= 1 ? { disabled: '' } : {}), onclick: () => go(st.page - 1) }, '‹ Trước');
    const next = el('button', { class: 'btn ghost sm', ...(st.page >= pages ? { disabled: '' } : {}), onclick: () => go(st.page + 1) }, 'Sau ›');
    bar.replaceChildren(
      el('span', { style: 'color:var(--muted);margin-right:auto' }, rows.length ? `Hiện ${(from + 1).toLocaleString('vi')}–${(from + part.length).toLocaleString('vi')} / ${rows.length.toLocaleString('vi')} dòng` : ''),
      'Mỗi trang:', sizeSel, prev, el('b', {}, `Trang ${st.page}/${pages}`), next);
  };
  sizeSel.onchange = () => { size = +sizeSel.value; st.page = 1; try { localStorage.setItem(key, String(size)); } catch {} render(); };
  render();
  return bar;
}

// KHOẢNG NGÀY Từ → Đến: đổi ngày KHÔNG tự tải (tránh tải 2 lần / tải khoảng quá dài khi đang chọn dở).
// Nút "✓ Áp dụng" sáng xanh khi đã đổi mà chưa xem; bấm nút hoặc Enter trong ô ngày → run() 1 lần.
// Trả { btn, synced }: gọi synced() sau mỗi lần đã tải theo ngày đang chọn (nút mờ lại).
function dateApply(fromI, toI, run) {
  const btn = el('button', { class: 'btn sm green apply-dt', title: 'Xem theo khoảng ngày vừa chọn (hoặc nhấn Enter trong ô ngày)', disabled: '' }, '✓ Áp dụng');
  let applied = [fromI.value, toI.value];
  const dirty = () => { const d = fromI.value !== applied[0] || toI.value !== applied[1]; btn.disabled = !d; btn.classList.toggle('pending', d); };
  const synced = () => { applied = [fromI.value, toI.value]; dirty(); };
  const apply = () => {
    if (!fromI.value || !toI.value) return toast('Chọn đủ Từ ngày và Đến ngày', 'err');
    if (toI.value < fromI.value) return toast('Đến ngày phải sau Từ ngày', 'err');
    const n = Math.round((Date.parse(toI.value) - Date.parse(fromI.value)) / 86400000) + 1;
    if (n > 93 && !confirm(`Khoảng ${n} ngày khá dài, tải có thể chậm. Vẫn xem?`)) return;
    run();
  };
  for (const i of [fromI, toI]) {
    i.addEventListener('input', dirty); i.addEventListener('change', dirty);
    i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); apply(); } });
  }
  btn.onclick = apply;
  return { btn, synced };
}

