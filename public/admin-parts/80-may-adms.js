/* ---------- MÁY CHẤM CÔNG (ZKTeco ADMS push) ---------- */
async function pageDevices() {
  setMain(head('Máy chấm công'), loading());
  let d;
  try { d = await api('/admin/devices'); } catch (e) { setMain(head('Máy chấm công'), el('div', { class: 'empty' }, e.message)); return; }

  // Công tắc máy chấm công. Dùng máy / Bắt buộc key / máy AI / Hikvision: CHỈ tài khoản tổng; còn lại (kể cả TCP/IP, Union) admin có quyền Máy chấm công đổi được
  const lockMaster = isMaster() ? {} : { disabled: '' };
  const enChk = el('input', { type: 'checkbox', class: 'sw', ...lockMaster, ...(d.enabled ? { checked: '' } : {}) });
  const autoChk = el('input', { type: 'checkbox', class: 'sw', ...(d.autocreate ? { checked: '' } : {}) });
  const keyReqChk = el('input', { type: 'checkbox', class: 'sw', ...lockMaster, ...(d.key_required ? { checked: '' } : {}) });
  const tcpChk = el('input', { type: 'checkbox', class: 'sw', ...(d.tcp_enabled ? { checked: '' } : {}) });
  const unionChk = el('input', { type: 'checkbox', class: 'sw', ...(d.union_enabled ? { checked: '' } : {}) });
  const unionPortI = el('input', { type: 'number', min: '1', max: '65535', value: String(d.union_port || 9870), style: 'width:90px;margin:0' });
  const aiChk = el('input', { type: 'checkbox', class: 'sw', ...lockMaster, ...(d.ai_enabled ? { checked: '' } : {}) });
  const hikChk = el('input', { type: 'checkbox', class: 'sw', ...lockMaster, ...(d.hik_enabled ? { checked: '' } : {}) });
  const guardChk = el('input', { type: 'checkbox', class: 'sw', ...(d.pin_guard ? { checked: '' } : {}) });
  const asciiChk = el('input', { type: 'checkbox', class: 'sw sm', ...(d.name_ascii ? { checked: '' } : {}) });
  const autoPushChk = el('input', { type: 'checkbox', class: 'sw', ...(d.auto_push ? { checked: '' } : {}) });
  const saveEn = el('button', { class: 'btn sm' }, 'Lưu');
  saveEn.onclick = async () => {
    try {
      if (!isMaster()) {   // admin: chỉ lưu các công tắc vận hành
        await api('/admin/device-options', { method: 'PUT', body: { device_autocreate: autoChk.checked, device_pin_guard: guardChk.checked,
          device_name_ascii: asciiChk.checked, device_auto_push_emp: autoPushChk.checked, tcp_device_enabled: tcpChk.checked, union_device_enabled: unionChk.checked, union_port: unionPortI.value } });
        SETTINGS.tcp_device_enabled = tcpChk.checked ? '1' : '0'; SETTINGS.union_device_enabled = unionChk.checked ? '1' : '0';
        toast('Đã lưu', 'ok'); setTimeout(pageDevices, 800); return;
      }
      await api('/admin/settings', { method: 'PUT', body: { device_enabled: enChk.checked, device_autocreate: autoChk.checked, device_key_required: keyReqChk.checked, tcp_device_enabled: tcpChk.checked,
        ai_device_enabled: aiChk.checked, hik_device_enabled: hikChk.checked, union_device_enabled: unionChk.checked, union_port: unionPortI.value,
        device_pin_guard: guardChk.checked, device_name_ascii: asciiChk.checked, device_auto_push_emp: autoPushChk.checked } });
      SETTINGS.device_enabled = enChk.checked ? '1' : '0'; SETTINGS.tcp_device_enabled = tcpChk.checked ? '1' : '0';
      SETTINGS.ai_device_enabled = aiChk.checked ? '1' : '0'; SETTINGS.hik_device_enabled = hikChk.checked ? '1' : '0';
      toast('Đã lưu. Đang tải lại…', 'ok'); setTimeout(() => location.reload(), 600);
    } catch (e) { toast(e.message, 'err'); }
  };
  const togglePanel = hasPerm('devices')
    ? el('div', { class: 'panel', style: 'padding:16px 18px;margin-bottom:14px;max-width:1100px' },
        el('div', { class: 'dfx-grid' },
          devGroup('Chung',
            devToggle(enChk, 'Dùng máy chấm công', 'Tắt = chỉ chấm bằng điện thoại', 'Nhận dữ liệu chấm công máy tự đẩy về (ZKTeco ADMS). Tắt = chỉ chấm bằng điện thoại (dùng song song được).'),
            devToggle(keyReqChk, 'Bắt buộc KEY theo máy', 'Có key Digiplus mới duyệt được máy', 'Máy phải có key Digiplus cấp (theo Serial) mới DUYỆT được — máy khách tự mua nơi khác không chạy. Máy đang chạy không ảnh hưởng.')),
          devGroup('Loại máy',
            devToggle(tcpChk, 'TCP/IP (ZKTeco đời cũ)', 'Thêm máy theo IP · cổng 4370', 'Thêm máy theo IP trong LAN — phần mềm chủ động tải NV, tải chấm công, xoá dữ liệu. Cho máy đời cũ không có ADMS; cần cài trên máy tính Windows cùng mạng.'),
            devToggle(unionChk, 'Union (Virdi)', 'Máy tự kết nối về · Windows, cùng LAN', 'Máy Union / Virdi tự kết nối về phần mềm: trên máy đặt Server IP = IP máy tính cài phần mềm + cổng nhận máy. Nhận lượt chấm ngay khi chấm, tải NV / chấm công, xoá NV trên máy. Cần cài trên máy tính Windows cùng mạng LAN với máy.',
              el('label', { class: 'dfx-sub' }, 'Cổng nhận máy', unionPortI, el('span', { class: 'muted' }, 'mặc định 9870'))),
            devToggle(aiChk, 'Máy AI', 'Máy tự kết nối về · chạy qua Internet', 'Máy khuôn mặt / vân tay dòng "AI": trên máy điền IP / tên miền + cổng của phần mềm, máy tự kết nối về (chạy được cả qua Internet, khỏi mở port modem). Đồng bộ NV + vân tay / khuôn mặt giữa các máy AI cùng nhóm.'),
            devToggle(hikChk, 'Hikvision', 'Thêm máy theo IP + tài khoản máy', 'Thêm máy theo IP + tài khoản đăng nhập máy — phần mềm kết nối vào máy để tải NV, tải chấm công (tự tải theo lịch), ghi / xoá NV trên máy. Phần mềm phải cùng mạng LAN với máy (hoặc máy được mở port).')),
          devGroup('Nhân viên & đồng bộ',
            devToggle(autoChk, 'Tự tạo NV từ máy', 'Số ID mới trên máy → NV nháp', 'Số ID mới đăng ký trên máy → tự tạo NV nháp (Số ID + tên máy gửi), admin bổ sung sau. Tắt: chờ admin gán tay.'),
            devToggle(guardChk, 'Cảnh báo trùng Số ID', 'Giữ lượt quẹt tới khi xử lý', 'Máy đăng ký người mới vào Số ID đã có chủ → cảnh báo, tạm dừng đồng bộ và GIỮ lượt quẹt tới khi xử lý: "Cùng 1 người" hoặc "Người khác" (tự cấp Số ID mới, giữ nguyên vân tay/thẻ).'),
            devToggle(autoPushChk, 'Đồng bộ NV xuống máy', 'Khai / sửa NV → tự đẩy xuống máy', 'Khai / sửa / nhập Excel NV có Số ID → tự đẩy Số ID + tên xuống máy; máy luôn dùng tên trong phần mềm. Vân tay / mặt / thẻ đăng ký ở 1 máy tự sang máy cùng nhóm + về phần mềm.',
              el('label', { class: 'dfx-sub' }, asciiChk, 'Ghi tên không dấu (tối đa 24 ký tự)')))),
        el('div', { style: 'margin-top:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap' }, saveEn,
          isMaster() ? '' : el('span', { class: 'map-hint', style: 'margin:0' }, '🔒 = chỉ tài khoản tổng (Digiplus) đổi được')))
    : el('div', { class: 'panel', style: 'padding:14px 18px;margin-bottom:14px;max-width:1100px' },
        el('div', { class: 'dev-st-grid' },
          ...[['Máy chấm công', d.enabled], ['Tự tạo NV từ máy', d.autocreate], ['Bắt buộc key theo máy', d.key_required],
            ['Máy TCP/IP (cổng 4370)', d.tcp_enabled], ['Máy Union', d.union_enabled], ['Máy AI', d.ai_enabled], ['Máy Hikvision', d.hik_enabled], ['Cảnh báo trùng Số ID', d.pin_guard], ['Đồng bộ NV xuống máy', d.auto_push]]
            .map(([t, on]) => el('div', { class: 'dev-st' }, el('span', {}, t), el('span', { class: 'pill ' + (on ? 'ok' : 'muted') }, on ? 'Bật' : 'Tắt')))),
        el('div', { class: 'map-hint', style: 'margin:8px 0 0' }, '🔒 Chỉ tài khoản tổng (Digiplus) bật/tắt được.'));

  // Hướng dẫn cấu hình máy + nút Refresh mạng (đổi mạng xong bấm để lấy IP mới)
  const ipVal = el('b', { style: 'color:var(--brand-ink,#c0392b);font-size:16px;font-family:monospace' }, d.server_ips[0] || '(IP máy chủ)');
  const portVal = el('b', {}, String(d.port));
  const ipsHint = el('div', { class: 'map-hint', style: 'margin-top:8px' });
  const renderIPs = (ips, port) => {
    ipVal.textContent = ips[0] || '(IP máy chủ)';
    if (port != null) portVal.textContent = String(port);
    ipsHint.innerHTML = '';
    if (ips.length > 1) {
      ipsHint.append('⚠️ Máy tính có nhiều mạng — chọn IP cùng lớp mạng với máy chấm công: ');
      ips.forEach((x, i) => ipsHint.append(i ? '  ·  ' : '', el('b', { style: 'font-family:monospace' }, x)));
    } else if (!ips.length) {
      ipsHint.textContent = 'Chưa thấy IP LAN — kiểm tra dây mạng / Wi-Fi rồi bấm Refresh mạng.';
    }
  };
  const refreshNet = el('button', { class: 'btn sm ghost' }, '🔄 Refresh mạng');
  refreshNet.onclick = async () => {
    refreshNet.disabled = true; const t = refreshNet.textContent; refreshNet.textContent = 'Đang kiểm tra…';
    try { const r = await api('/admin/server-ips'); renderIPs(r.ips, r.port); toast('IP máy chủ hiện tại: ' + (r.ips[0] || 'không thấy'), 'ok'); }
    catch (e) { toast(e.message, 'err'); }
    finally { refreshNet.disabled = false; refreshNet.textContent = t; }
  };
  renderIPs(d.server_ips, d.port);
  // Tên miền cho máy ở chi nhánh khác: ưu tiên đúng tên miền đang mở trang này; không có thì lấy theo cấu hình cài đặt
  const hostNow = location.hostname;
  const isDomain = /[a-z]/i.test(hostNow) && hostNow.includes('.') && hostNow !== 'localhost';
  const domain = isDomain ? hostNow : (d.domain || '');
  const domVal = el('b', { style: 'color:var(--brand-ink,#c0392b);font-size:16px;font-family:monospace' }, domain || '(tên miền của công ty)');
  const domCopy = domain ? el('button', { class: 'btn ghost sm', title: 'Copy tên miền', style: 'padding:2px 6px', onclick: () => copySerial(domain) }, '📋') : '';
  const domNote = domain ? '' : el('div', { style: 'font-size:12px;color:var(--muted);margin-top:4px' }, 'Bản LAN chưa có tên miền — liên hệ Digiplus nếu cần dùng qua Internet.');
  const guide = el('div', { class: 'panel', style: 'padding:14px 18px;margin-bottom:14px;max-width:1100px' },
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin:8px 0 10px' },
      el('div', { style: 'font-size:13.5px;color:var(--muted)', html: 'Trên máy: <b style="color:var(--ink)">Menu → Comm → Cloud Server (ADMS)</b>, điền theo 1 trong 2 cách:' }), refreshNet),
    el('div', { class: 'dev-tg-grid' },
      el('div', { class: 'dev-tg' },
        el('b', {}, 'Cách A · Cùng mạng LAN'),
        el('div', { style: 'margin-top:6px' }, 'IP: ', ipVal, ' · Port: ', portVal),
        el('div', { style: 'font-size:12.5px;color:var(--muted);margin-top:4px' }, 'HTTP · không bật tên miền')),
      el('div', { class: 'dev-tg' },
        el('b', {}, 'Cách B · Qua Internet / chi nhánh khác'),
        el('div', { style: 'margin-top:6px' }, 'Tên miền: ', domVal, ' ', domCopy, ' · Port: ', el('b', {}, '443')),
        el('div', { style: 'font-size:12.5px;color:var(--muted);margin-top:4px' }, 'Bật Domain + HTTPS · máy cần có Internet'),
        domNote,
        d.tcp_supported && d.domain ? el('div', { style: 'margin-top:8px' }, btnSm('🔍 Khỏi gõ tay: tìm máy trong LAN & tự trỏ về', lanScanModal, 'ghost')) : ''),
      // Máy AI: giao thức WebSocket (ws://, không mã hoá) — vào CÙNG cổng web; qua tên miền thì cổng 80
      d.ai_enabled ? el('div', { class: 'dev-tg' },
        el('b', {}, 'Máy AI (khuôn mặt / vân tay)'),
        el('div', { style: 'margin-top:6px' }, 'Server: ', el('b', { style: 'font-family:monospace' }, d.server_ips[0] || '(IP máy chủ)'), ' · Port: ', el('b', {}, String(d.port))),
        domain ? el('div', { style: 'margin-top:4px' }, 'Qua Internet: ', el('b', { style: 'font-family:monospace' }, domain), ' · Port: ', el('b', {}, '80')) : '',
        el('div', { style: 'font-size:12.5px;color:var(--muted);margin-top:4px' }, 'Trên máy: Menu → Network / Cloud Server, điền như trên. Máy tự kết nối về rồi hiện ở danh sách (Chờ duyệt).')) : '',
      // Máy Union / Virdi: máy tự kết nối về cổng riêng (SDK UCS) — chỉ trong mạng LAN
      d.union_enabled ? el('div', { class: 'dev-tg' },
        el('b', {}, 'Máy Union (Virdi)'),
        el('div', { style: 'margin-top:6px' }, 'Server IP: ', el('b', { style: 'font-family:monospace' }, d.server_ips[0] || '(IP máy chủ)'), ' · Port: ', el('b', {}, String(d.union_port || 9870))),
        el('div', { style: 'font-size:12.5px;color:var(--muted);margin-top:4px' }, 'Trên máy: Menu → Network → Server, điền như trên (Terminal ID mỗi máy 1 số khác nhau). Máy tự kết nối về rồi hiện ở danh sách (Chờ duyệt).'),
        d.union_status && !d.union_status.running
          ? el('div', { class: 'dv-warn', style: 'margin-top:6px' }, '⚠️ Chưa mở được cổng nhận máy' + (d.union_status.error ? ': ' + d.union_status.error : ' — đang khởi động, bấm Làm mới sau ít giây.'))
          : el('div', { style: 'font-size:12.5px;color:#15803d;margin-top:6px' }, `✓ Đang chờ máy kết nối ở cổng ${d.union_status ? d.union_status.port : d.union_port}. Máy không vào được: mở cổng này trên tường lửa Windows.`)) : ''),
    el('div', { style: 'font-size:13.5px;margin-top:10px', html: 'Lưu, khởi động lại máy → máy hiện ở danh sách bên dưới (<b>Chờ duyệt</b>) → bấm <b>Duyệt</b>.' }),
    ipsHint);

  // Bảng danh sách máy
  const tbl = el('table', { class: 'data dev-tbl' });
  tbl.innerHTML = `<thead><tr><th>Máy</th><th>Trạng thái</th><th class="c" title="Như Ronald Jack: ID lẻ (1, 3, 5…) = máy VÀO, ID chẵn (2, 4, 6…) = máy RA, 0 = máy chấm cả vào lẫn ra. Dùng khi chọn lịch trình vào ra &quot;Theo ID máy&quot;.">ID máy</th><th class="c">Nhân viên</th><th class="c">Vân tay</th><th class="c">Khuôn mặt</th><th class="c">Thẻ</th><th>Kết nối gần nhất</th><th class="c">Số quẹt</th><th></th></tr></thead>`;
  const tb = el('tbody');
  const countCells = {};   // serial -> {nv,fp,face,card} để tự làm mới số liệu
  const statusCells = {};  // serial -> {tr,st,ip,seen} để trạng thái Online/Offline + kết nối gần nhất tự làm mới cùng số liệu
  const seenText = (iso) => iso ? isoToHMS(iso) + ' · ' + iso.slice(8, 10) + '/' + iso.slice(5, 7) : '';
  const onlineTitle = (on) => on ? 'Máy đang kết nối' : 'Máy không gọi về trong 2,5 phút gần đây';
  // Copy serial máy (để dán vào trang cấp key, khỏi gõ tay). Bản LAN chạy http → không có navigator.clipboard nên có dự phòng execCommand.
  const copySerial = async (serial, quiet) => {
    let ok = false;
    try { await navigator.clipboard.writeText(serial); ok = true; } catch {}
    if (!ok) {
      const ta = el('textarea', { style: 'position:fixed;left:-9999px;top:0' });
      ta.value = serial; document.body.append(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch {}
      ta.remove();
    }
    if (!quiet) toast(ok ? 'Đã copy ' + serial : 'Không copy tự động được — bôi đen để copy tay', ok ? 'ok' : 'err');
    return ok;
  };
  // Dán KEY bản quyền cho 1 máy (Digiplus cấp theo Serial)
  const pasteDeviceKey = async (m) => {
    copySerial(m.serial, true);   // copy sẵn serial để dán sang trang cấp key
    // Hộp thoại riêng (không dùng prompt của trình duyệt) để serial BÔI ĐEN được + có nút copy lại bất cứ lúc nào
    const serialI = el('input', { readonly: '', value: m.serial, style: 'font-family:monospace;font-weight:700;flex:1' });
    serialI.onclick = () => serialI.select();
    const copyBtn = el('button', { class: 'btn ghost', onclick: () => copySerial(m.serial) }, '📋 Copy serial');
    const keyT = el('textarea', { rows: 4, placeholder: 'Dán key Digiplus cấp cho serial này…', style: 'width:100%;font-family:monospace' });
    const save = el('button', { class: 'btn' }, 'Lưu key');
    save.onclick = async () => {
      const k = keyT.value.trim();
      if (!k) return toast('Chưa dán key', 'err');
      save.disabled = true;
      try { await api('/admin/devices/' + m.id + '/key', { method: 'POST', body: { key: k } }); toast('Đã lưu key máy ✔', 'ok'); closeModal(); pageDevices(); }
      catch (e) { toast(e.message, 'err'); save.disabled = false; }
    };
    openModal('Key bản quyền máy · ' + (m.name || m.serial), [
      el('label', {}, 'Serial máy (đã copy sẵn — dán sang trang cấp key để lấy key)'),
      el('div', { style: 'display:flex;gap:8px;margin:4px 0 14px' }, serialI, copyBtn),
      el('label', {}, 'Key máy chấm công'),
      keyT,
    ], [el('button', { class: 'btn ghost', onclick: closeModal }, 'Huỷ'), save]);
    setTimeout(() => keyT.focus(), 50);
  };
  if (!d.rows.length) tb.append(el('tr', {}, el('td', { colspan: 9 }, el('div', { class: 'empty' }, 'Chưa có máy nào kết nối. Cấu hình máy theo hướng dẫn trên, máy sẽ tự hiện ở đây.'))));
  for (const m of d.rows) {
    // Nút hay dùng để NGOÀI: Duyệt (khi đang chờ), Mở cửa, Xem quẹt; còn lại gom vào "⋯ Thêm"
    const approveInline = !m.active
      ? btnSm('✅ Duyệt', async () => {
          // Bắt buộc key mà máy chưa có key → báo rõ + mở luôn ô dán key (trước đây bấm không thấy gì)
          if (d.key_required && !m.key_ok) {
            toast('Máy ' + m.serial + ' chưa có KEY bản quyền — dán key Digiplus cấp rồi mới duyệt được.', 'err');
            return pasteDeviceKey(m);
          }
          try { const r = await api('/admin/devices/' + m.id, { method: 'PUT', body: { active: true } }); toast('Đã duyệt máy ' + m.serial + (r.rebooting ? ' — máy sẽ tự khởi động lại để nhận cấu hình và giờ đúng.' : ''), 'ok'); pageDevices(); }
          catch (e) { toast(e.message || 'Không duyệt được máy', 'err'); }
        })
      : null;
    const doorBtn = (m.access_control && hasPerm('door_open'))
      ? btnSm('🔓 Mở cửa', async () => { if (!confirm(`Mở cửa tại máy "${m.name || m.serial}" ngay?`)) return; try { const r = await api('/admin/devices/' + m.id + '/open-door', { method: 'POST' }); toast(r.msg || 'Đã gửi lệnh mở cửa', 'ok'); } catch (e) { toast(e.message, 'err'); } })
      : null;
    const logBtn = btnSm('Xem quẹt', () => devicePunchesModal(m), 'ghost');
    const isTcp = m.conn_type === 'tcp', isAi = m.conn_type === 'ai', isHik = m.conn_type === 'hik', isUnion = m.conn_type === 'union';
    // Đồng bộ giờ = ra lệnh máy khởi động lại để lấy lại giờ máy chủ + múi giờ (chỉ máy đã duyệt). Máy AI: đặt giờ thẳng, không khởi động lại.
    const timeBtn = (m.active && hasPerm('devices') && isAi)
      ? btnSm('🕒 Đồng bộ giờ', () => aiCall(m, 'set-time', {}, `Đặt giờ máy "${m.name || m.serial}" theo giờ máy chủ?\nKiểm tra đồng hồ máy tính cài phần mềm đúng trước.`), 'ghost')
      : (m.active && hasPerm('devices') && !isUnion)   // máy Union tự lấy giờ máy tính mỗi lần kết nối
      ? btnSm('🕒 Đồng bộ giờ', async () => {
          if (!confirm(`Đồng bộ giờ máy "${m.name || m.serial}" theo máy chủ?\n\nMáy sẽ KHỞI ĐỘNG LẠI (khoảng 30 giây) rồi tự lấy giờ đúng. Trong lúc đó chưa chấm công được.\nLưu ý: giờ lấy theo đồng hồ của máy tính cài phần mềm — kiểm tra đồng hồ máy tính đúng trước.`)) return;
          try { const r = await api('/admin/devices/' + m.id + '/sync-time', { method: 'POST' }); toast(r.msg || 'Đã gửi lệnh đồng bộ giờ', 'ok'); }
          catch (e) { toast(e.message, 'err'); }
        }, 'ghost')
      : null;
    const keyBtn = (d.key_required && !m.key_ok) ? btnSm('🔑 Dán key', () => pasteDeviceKey(m)) : null;
    const putDev = (body) => api('/admin/devices/' + m.id, { method: 'PUT', body });
    const renameItem = { group: 'Cài đặt máy', label: '✏️ Đổi tên máy', fn: async () => { const name = prompt('Tên máy:', m.name || ''); if (name != null) { await putDev({ name }); pageDevices(); } } };
    const keyItem = hasPerm('devices') ? { group: 'Bản quyền & quản trị', label: m.key_ok ? '🔑 Đổi key bản quyền máy' : '🔑 Dán key bản quyền máy', fn: () => pasteDeviceKey(m) } : null;
    const doorItem = hasPerm('devices') ? { group: 'Cài đặt máy', label: m.access_control ? '🚪 Tắt kiểm soát cửa' : '🚪 Bật kiểm soát cửa', fn: async () => { await putDev({ access_control: !m.access_control }); toast(m.access_control ? 'Đã tắt kiểm soát cửa' : 'Đã bật kiểm soát cửa', 'ok'); pageDevices(); } } : null;
    const pauseItem = m.active ? { group: 'Xóa / tạm dừng', label: '⏸ Tạm dừng máy', fn: async () => { await putDev({ active: false }); pageDevices(); } } : null;
    const schedItem = hasPerm('devices') ? { group: 'Cài đặt máy', hint: 'Máy dùng lâu dễ đơ — phần mềm tự khởi động lại máy theo giờ hẹn', label: '⏰ Hẹn giờ khởi động lại' + (m.reboot_sched ? ': ' + rebootSchedLabel(m.reboot_sched) : ''), fn: () => rebootSchedModal(m, d.rows) } : null;
    const removeItem = { danger: true, group: 'Xóa / tạm dừng', label: '❌ Xóa máy khỏi danh sách', fn: async () => { if (confirm('Xoá máy này khỏi danh sách? (Dữ liệu trên máy chấm công không bị ảnh hưởng)')) { await api('/admin/devices/' + m.id, { method: 'DELETE' }); pageDevices(); } } };
    const moreBtn = isHik ? rowMenu([   // máy Hikvision: phần mềm kết nối vào máy (giống TCP/IP)
      { group: 'Dữ liệu từ máy', label: '📊 Thông tin & dung lượng máy', fn: () => tcpJob(m, 'info', {}, pageDevices, 'hik') },
      m.active ? { group: 'Dữ liệu từ máy', label: '⬇ Tải nhân viên từ máy', fn: () => { if (confirm(`Tải danh sách nhân viên TỪ máy "${m.name || m.serial}" về phần mềm?`)) tcpJob(m, 'users', {}, pageDevices, 'hik'); } } : null,
      m.active ? { group: 'Dữ liệu từ máy', label: '⬇ Tải dữ liệu chấm công (từ ngày – đến ngày)', fn: () => tcpLogsModal(m, 'hik') } : null,
      renameItem,
      { group: 'Cài đặt máy', label: '🔌 Sửa kết nối (IP / cổng / tài khoản)', fn: () => hikAddModal(m) },
      { group: 'Cài đặt máy', hint: 'Các máy Hikvision CÙNG nhóm tự chép cho nhau người + thẻ + khuôn mặt + vân tay', label: '🔁 Nhóm đồng bộ' + (m.sync_group ? ': ' + m.sync_group : ''), fn: async () => {
        const g = prompt('Nhóm đồng bộ: các máy Hikvision CÙNG nhóm tự chép cho nhau người + thẻ + ảnh khuôn mặt + vân tay (chỉ thêm, không xoá).\nĐể trống = không đồng bộ:', m.sync_group || '');
        if (g == null) return;
        try { await putDev({ sync_group: g }); } catch (e) { return toast(e.message, 'err'); }
        const peers = d.rows.filter((x) => x.conn_type === 'hik' && x.active && x.id !== m.id && g.trim() && x.sync_group === g.trim()).length;
        if (m.active && peers) tcpJob({ ...m, sync_group: g.trim() }, 'sync', {}, pageDevices, 'hik');
        else { toast(g.trim() ? 'Đã đặt nhóm. Đặt cùng nhóm cho máy Hikvision thứ 2 là tự đồng bộ.' : 'Đã bỏ nhóm đồng bộ', 'ok'); pageDevices(); }
      } },
      m.active && m.sync_group ? { group: 'Cài đặt máy', hint: 'Chép ngay người / thẻ / mặt / vân tay còn thiếu giữa các máy cùng nhóm', label: '🔁 Đồng bộ nhóm ngay', fn: () => tcpJob(m, 'sync', {}, pageDevices, 'hik') } : null,
      m.active ? { group: 'Cài đặt máy', label: m.tcp_auto ? '⏱ Tắt tự động tải máy này' : '⏱ Bật tự động tải máy này', fn: async () => { try { await api(`/admin/hik-devices/${m.id}/auto`, { method: 'PUT', body: { on: !m.tcp_auto } }); toast(m.tcp_auto ? 'Đã tắt tự động tải cho máy này' : 'Đã bật tự động tải cho máy này', 'ok'); pageDevices(); } catch (e) { toast(e.message, 'err'); } } } : null,
      m.active ? { group: 'Cài đặt máy', hint: 'Mỗi lần chấm, máy gửi ngay lượt chấm về phần mềm (HTTP Listening)', label: m.hik_push_url ? '📡 Máy tự gửi lượt chấm: ĐÃ CÀI (xem / cài lại)' : '📡 Cài máy tự gửi lượt chấm về phần mềm', fn: () => hikPushModal(m, d) } : null,
      m.active ? { group: 'Cài đặt máy', label: '🕒 Đặt giờ máy theo máy chủ', fn: () => { if (confirm(`Đặt giờ máy "${m.name || m.serial}" theo đồng hồ máy chủ (múi giờ Việt Nam)?\nKiểm tra đồng hồ máy tính cài phần mềm đúng trước.`)) tcpJob(m, 'set-time', {}, null, 'hik'); } } : null,
      m.active ? { group: 'Cài đặt máy', label: '🔄 Khởi động lại máy', fn: () => { if (confirm(`Khởi động lại máy "${m.name || m.serial}"?`)) tcpJob(m, 'restart', {}, null, 'hik'); } } : null,
      schedItem, doorItem, keyItem, pauseItem, removeItem,
    ]) : isUnion ? rowMenu([   // máy Union: máy tự kết nối về, phần mềm ra lệnh khi máy đang kết nối
      { group: 'Dữ liệu từ máy', label: '📊 Thông tin & dung lượng máy', fn: () => tcpJob(m, 'info', {}, pageDevices, 'union') },
      m.active ? { group: 'Dữ liệu từ máy', label: '⬇ Tải nhân viên từ máy', fn: () => { if (confirm(`Tải danh sách nhân viên TỪ máy "${m.name || m.serial}" về phần mềm?`)) tcpJob(m, 'users', {}, pageDevices, 'union'); } } : null,
      m.active ? { group: 'Dữ liệu từ máy', label: '⬇ Tải dữ liệu chấm công (từ ngày – đến ngày)', fn: () => tcpLogsModal(m, 'union') } : null,
      m.active ? { group: 'Dữ liệu từ máy', hint: 'Các lượt chấm máy chưa gửi về (VD lúc máy tính tắt)', label: '⬇ Tải lượt chấm mới', fn: () => tcpJob(m, 'new-logs', {}, pageDevices, 'union') } : null,
      renameItem,
      m.active ? { group: 'Cài đặt máy', label: '🔄 Khởi động lại máy', fn: () => { if (confirm(`Khởi động lại máy "${m.name || m.serial}"?`)) tcpJob(m, 'restart', {}, null, 'union'); } } : null,
      schedItem, doorItem, keyItem,
      m.active ? { group: 'Xóa / tạm dừng', label: '🗑 Xóa toàn bộ nhân viên trên máy', fn: () => {
        if (!confirm(`Xóa TOÀN BỘ nhân viên + vân tay / thẻ trên máy "${m.name || m.serial}"?

Máy không còn ai chấm được cho tới khi đăng ký lại. Lượt chấm đã tải về phần mềm giữ nguyên.`)) return;
        if (prompt('Gõ chữ XOA để xác nhận:') !== 'XOA') return toast('Chưa xác nhận — không xóa gì', 'err');
        tcpJob(m, 'clear-users', {}, pageDevices, 'union');
      } } : null,
      pauseItem, removeItem,
    ]) : isAi ? rowMenu([   // máy AI: gửi lệnh, máy làm khi đang kết nối
      m.active ? { group: 'Dữ liệu từ máy', label: '📊 Đọc thông tin máy', fn: () => aiCall(m, 'info') } : null,
      m.active ? { group: 'Dữ liệu từ máy', label: '⬇ Tải nhân viên + vân tay / khuôn mặt từ máy', fn: () => aiCall(m, 'users', {}, `Tải danh sách nhân viên + vân tay / khuôn mặt TỪ máy "${m.name || m.serial}" về phần mềm?\nMáy gửi dần lên; chờ chút rồi bấm Làm mới.`) } : null,
      m.active ? { group: 'Dữ liệu từ máy', label: '⬇ Tải lại log chấm công', fn: () => aiLogsModal(m) } : null,
      renameItem,
      { group: 'Cài đặt máy', label: '🔁 Nhóm đồng bộ', fn: async () => { const g = prompt('Nhóm đồng bộ (các máy AI CÙNG nhóm tự đồng bộ NV / vân tay / khuôn mặt / thẻ / mật mã cho nhau).\nĐể trống = không đồng bộ:', m.sync_group || ''); if (g != null) { const r = await putDev({ sync_group: g }); toast(r && r.synced ? `Đã đặt nhóm + tự đồng bộ ${r.synced} máy. Chờ ít giây rồi Làm mới.` : 'Đã đặt nhóm đồng bộ', 'ok'); pageDevices(); } } },
      { group: 'Cài đặt máy', hint: 'Bật: NV mới khai trên phần mềm tự đẩy xuống máy này (khi bật Tự động đẩy NV)', label: (m.recv_new ?? 1) ? '📥 Nhận NV mới từ phần mềm: BẬT' : '📥 Nhận NV mới từ phần mềm: TẮT', fn: async () => {
        try { await putDev({ recv_new: !(m.recv_new ?? 1) }); toast((m.recv_new ?? 1) ? 'Máy này sẽ KHÔNG nhận NV mới từ phần mềm' : 'Máy này sẽ nhận NV mới từ phần mềm', 'ok'); pageDevices(); } catch (e) { toast(e.message, 'err'); } } },
      m.active ? { group: 'Cài đặt máy', label: '🔄 Khởi động lại máy', fn: () => aiCall(m, 'restart', {}, `Khởi động lại máy "${m.name || m.serial}"?`) } : null,
      schedItem, doorItem, keyItem,
      m.active ? { group: 'Bản quyền & quản trị', label: '👤 Xóa quyền quản trị', fn: () => aiCall(m, 'clear-admins', {}, `Hạ TẤT CẢ quản trị trên máy "${m.name || m.serial}" về nhân viên thường?\n\nSau đó ai cũng vào được menu máy (cho tới khi đặt quản trị mới trên máy).`) } : null,
      m.active ? { group: 'Xóa / tạm dừng', label: '🗑 Xóa dữ liệu trên máy', fn: () => aiClearModal(m) } : null,
      pauseItem, removeItem,
    ]) : isTcp ? rowMenu([
      { group: 'Dữ liệu từ máy', label: '📊 Thông tin & dung lượng máy', fn: () => tcpInfoModal(m) },
      m.active ? { group: 'Dữ liệu từ máy', label: '⬇ Tải nhân viên từ máy', fn: () => { if (confirm(`Tải danh sách nhân viên TỪ máy "${m.name || m.serial}" về phần mềm?`)) tcpJob(m, 'users', {}, pageDevices); } } : null,
      m.active ? { group: 'Dữ liệu từ máy', label: '⬇ Tải dữ liệu chấm công (từ ngày – đến ngày)', fn: () => tcpLogsModal(m) } : null,
      { group: 'Cài đặt máy', label: '✏️ Đổi tên máy', fn: async () => { const name = prompt('Tên máy:', m.name || ''); if (name != null) { await putDev({ name }); pageDevices(); } } },
      { group: 'Cài đặt máy', label: '🔌 Sửa kết nối (IP / cổng / mật mã)', fn: () => tcpAddModal(m) },
      m.active ? { group: 'Cài đặt máy', label: m.tcp_auto ? '⏱ Tắt tự động tải máy này' : '⏱ Bật tự động tải máy này', fn: async () => { try { await api(`/admin/tcp-devices/${m.id}/auto`, { method: 'PUT', body: { on: !m.tcp_auto } }); toast(m.tcp_auto ? 'Đã tắt tự động tải cho máy này' : 'Đã bật tự động tải cho máy này', 'ok'); pageDevices(); } catch (e) { toast(e.message, 'err'); } } } : null,
      m.active ? { group: 'Cài đặt máy', label: '🕒 Đặt giờ máy theo máy tính', fn: () => { if (confirm(`Đặt giờ máy "${m.name || m.serial}" theo đồng hồ của máy tính cài phần mềm?\nKiểm tra đồng hồ máy tính đúng trước.`)) tcpJob(m, 'set-time', {}); } } : null,
      m.active ? { group: 'Cài đặt máy', label: '🔄 Khởi động lại máy', fn: () => { if (confirm(`Khởi động lại máy "${m.name || m.serial}"?`)) tcpJob(m, 'restart', {}); } } : null,
      schedItem,
      hasPerm('devices') ? { group: 'Bản quyền & quản trị', label: m.key_ok ? '🔑 Đổi key bản quyền máy' : '🔑 Dán key bản quyền máy', fn: () => pasteDeviceKey(m) } : null,
      m.active ? { group: 'Bản quyền & quản trị', label: '👤 Xóa quyền quản trị', fn: () => { if (confirm(`Hạ TẤT CẢ quản trị trên máy "${m.name || m.serial}" về nhân viên thường?\n\nSau đó ai cũng vào được menu máy (cho tới khi đặt quản trị mới trên máy).`)) tcpJob(m, 'clear-admins', {}, pageDevices); } } : null,
      m.active ? { group: 'Xóa / tạm dừng', label: '🗑 Xóa dữ liệu trên máy', fn: () => tcpClearModal(m) } : null,
      m.active ? { group: 'Xóa / tạm dừng', label: '⏸ Tạm dừng máy', fn: async () => { await putDev({ active: false }); pageDevices(); } } : null,
      { danger: true, group: 'Xóa / tạm dừng', label: '❌ Xóa máy khỏi danh sách', fn: async () => { if (confirm('Xoá máy này khỏi danh sách? (Dữ liệu trên máy chấm công không bị ảnh hưởng)')) { await api('/admin/devices/' + m.id, { method: 'DELETE' }); pageDevices(); } } },
    ]) : rowMenu([
      m.active ? { group: 'Dữ liệu từ máy', label: '🕒 Xem giờ trên máy', fn: () => deviceClockModal(m) } : null,
      { group: 'Dữ liệu từ máy', label: '⬇ Tải nhân viên từ máy', fn: async () => { if (!confirm(`Tải danh sách nhân viên + vân tay TỪ máy "${m.name || m.serial}" về phần mềm?\nMáy sẽ đẩy lên khi có kết nối; chờ chút rồi bấm Làm mới.`)) return; try { const r = await api('/admin/devices/' + m.id + '/query-users', { method: 'POST' }); toast(r.msg || 'Đã gửi lệnh tải nhân viên', 'ok'); cmdTrack('Tải NV từ máy ' + (m.name || m.serial), r.track, { counts: true, after: pageDevices }); } catch (e) { toast(e.message, 'err'); } } },
      { group: 'Dữ liệu từ máy', label: '⬇ Tải lại log chấm công', fn: () => deviceAttlogModal(m) },
      { group: 'Dữ liệu từ máy', label: '🧹 Đọc lại thông tin từ máy', fn: async () => { if (!confirm(`Xóa số hiển thị (NV/vân tay/thẻ) của máy "${m.name || m.serial}" rồi ĐỌC LẠI thực tế từ máy?\n\nDùng khi số hiển thị KHÔNG đúng thực tế (VD đồng bộ lỗi). Máy phải đang ONLINE; chờ chút rồi bấm Làm mới.`)) return; try { const r = await api('/admin/devices/' + m.id + '/relearn', { method: 'POST' }); toast('Đã xóa số cũ + yêu cầu máy đẩy lại.', 'ok'); pageDevices(); cmdTrack('Đọc lại máy ' + (m.name || m.serial), r.track, { counts: true, after: pageDevices }); } catch (e) { toast(e.message, 'err'); } } },
      { group: 'Cài đặt máy', label: '✏️ Đổi tên máy', fn: async () => { const name = prompt('Tên máy:', m.name || ''); if (name != null) { await putDev({ name }); pageDevices(); } } },
      { group: 'Cài đặt máy', label: '🔁 Nhóm đồng bộ', fn: async () => { const g = prompt('Nhóm đồng bộ (các máy CÙNG nhóm sẽ tự đồng bộ NV/vân tay/thẻ/mật mã/khuôn mặt cho nhau).\nĐể trống = không đồng bộ:', m.sync_group || ''); if (g != null) { const r = await putDev({ sync_group: g }); toast(r && r.synced ? `Đã đặt nhóm + tự đồng bộ ${r.synced} máy. Chờ ít giây rồi Làm mới.` : 'Đã đặt nhóm đồng bộ', 'ok'); pageDevices(); } } },
      { group: 'Cài đặt máy', hint: 'Bật: NV mới khai trên phần mềm tự đẩy xuống máy này (khi bật Tự động đẩy NV)', label: (m.recv_new ?? 1) ? '📥 Nhận NV mới từ phần mềm: BẬT' : '📥 Nhận NV mới từ phần mềm: TẮT', fn: async () => {
        try { await putDev({ recv_new: !(m.recv_new ?? 1) }); toast((m.recv_new ?? 1) ? 'Máy này sẽ KHÔNG nhận NV mới từ phần mềm' : 'Máy này sẽ nhận NV mới từ phần mềm', 'ok'); pageDevices(); } catch (e) { toast(e.message, 'err'); } } },
      { group: 'Cài đặt máy', hint: 'Máy này chỉ được đăng ký Số ID trong dải — ngoài dải sẽ cảnh báo (cần bật Cảnh báo trùng Số ID)', label: '🔢 Dải Số ID của máy', fn: async () => {
        const v = prompt('Dải Số ID cho máy "' + (m.name || m.serial) + '" (VD 1001-1999). Đăng ký số ngoài dải → cảnh báo; cấp số mới sẽ lấy trong dải.\nĐể trống = không giới hạn:', m.pin_range || '');
        if (v == null) return;
        try { await putDev({ pin_range: v.trim() }); toast(v.trim() ? 'Đã đặt dải Số ID ' + v.trim() : 'Đã bỏ dải Số ID', 'ok'); pageDevices(); } catch (e) { toast(e.message, 'err'); } } },
      false && { group: 'Cài đặt máy', hint: 'Ghép log kiểu IDM: máy số lẻ = VÀO, máy chẵn = RA', label: '🔢 Số máy (ghép log)', fn: async () => { const n = prompt('Số máy (quy tắc ghép log IDM: máy số LẺ = chấm VÀO, máy CHẴN = chấm RA).\n0 = không dùng:', m.machine_number || 0); if (n != null) { await putDev({ machine_number: parseInt(n, 10) || 0 }); toast('Đã đặt số máy', 'ok'); pageDevices(); } } },
      hasPerm('devices') ? { group: 'Cài đặt máy', label: m.access_control ? '🚪 Tắt kiểm soát cửa' : '🚪 Bật kiểm soát cửa', fn: async () => { await putDev({ access_control: !m.access_control }); toast(m.access_control ? 'Đã tắt kiểm soát cửa' : 'Đã bật kiểm soát cửa', 'ok'); pageDevices(); } } : null,
      schedItem,
      hasPerm('devices') ? { group: 'Bản quyền & quản trị', label: m.key_ok ? '🔑 Đổi key bản quyền máy' : '🔑 Dán key bản quyền máy', fn: () => pasteDeviceKey(m) } : null,
      (hasPerm('devices') && m.key_ok) ? { group: 'Bản quyền & quản trị', label: '🔑 Gỡ key bản quyền máy', fn: async () => { if (confirm('Gỡ key bản quyền khỏi máy này?')) { await api('/admin/devices/' + m.id + '/key', { method: 'DELETE' }); toast('Đã gỡ key', 'ok'); pageDevices(); } } } : null,
      // Hạ quản trị trên máy về nhân viên (vd quản trị được đồng bộ từ cơ sở khác → không ai ở đây vào được menu máy)
      hasPerm('devices') ? { group: 'Bản quyền & quản trị', label: '👤 Xóa quyền quản trị', fn: async () => {
        if (!confirm(`Hạ TẤT CẢ quản trị trên máy "${m.name || m.serial}" về nhân viên thường?\n\nSau đó ai cũng vào được menu máy (cho tới khi đặt quản trị mới trên máy). Máy phải đang Online để nhận lệnh.`)) return;
        try { const r = await api('/admin/devices/' + m.id + '/clear-admins', { method: 'POST' }); toast(r.msg || 'Đã gửi lệnh', r.count ? 'ok' : 'err'); }
        catch (e) { toast(e.message, 'err'); }
      } } : null,
      { group: 'Xóa / tạm dừng', label: '🗑 Xóa dữ liệu máy', fn: () => deviceClearModal(m) },
      m.active ? { group: 'Xóa / tạm dừng', label: '⏸ Tạm dừng máy', fn: async () => { await putDev({ active: false }); pageDevices(); } } : null,
      { danger: true, group: 'Xóa / tạm dừng', label: '❌ Xóa máy khỏi danh sách', fn: async () => { if (confirm('Xoá máy này khỏi danh sách?')) { await api('/admin/devices/' + m.id, { method: 'DELETE' }); pageDevices(); } } },
    ]);
    const numTd = (v, bold) => el('td', { class: 'num' + (bold ? ' b' : '') + (v ? '' : ' zero') }, String(v));
    // máy TCP/IP / Hikvision (phần mềm kết nối vào máy): số liệu lấy từ lần đọc thông tin máy gần nhất (kèm sức chứa)
    const direct = isTcp || isHik, autoMin = isHik ? d.hik_auto_min : d.tcp_auto_min;
    // máy Union: có số liệu đọc từ máy (📊 Thông tin) thì hiện kèm sức chứa
    const useInfo = direct || (isUnion && m.tcp_info && m.tcp_info.users != null);
    const ti = useInfo ? (m.tcp_info || {}) : null;
    const capTd = (v, cap, bold) => { const td = numTd(v ?? 0, bold); if (cap > 0) { td.append(el('div', { class: 'dv-sub' }, '/ ' + Number(cap).toLocaleString('vi'))); td.title = `Đang dùng ${v ?? 0} / sức chứa ${cap}`; } return td; };
    const cNV = useInfo ? capTd(ti.users, ti.user_cap, true) : numTd(m.emp_count ?? 0, true);
    const cFP = useInfo ? capTd(ti.fps, ti.fp_cap) : numTd(m.fp_count ?? 0);
    const cFace = useInfo ? capTd(ti.faces > 0 ? ti.faces : 0, ti.face_cap) : numTd(m.face_count ?? 0);
    const cCard = numTd(isHik && ti.cards >= 0 ? ti.cards : (m.card_count ?? 0));
    if (!useInfo) countCells[m.serial] = { cNV, cFP, cFace, cCard };
    // Online = máy có gọi server trong vòng 2,5 phút gần đây (máy ADMS gọi ~mỗi 10s); máy AI = đang giữ kết nối WebSocket
    const online = !!m.online;   // máy chủ tính bằng giờ của nó — không dùng đồng hồ máy đang xem (máy lệch giờ sẽ báo Offline sai)
    const chips = [
      isTcp ? el('span', { class: 'chip', title: 'Máy kết nối trực tiếp TCP/IP — phần mềm chủ động kết nối khi bấm tải' }, '🔌 TCP/IP') : '',
      isHik ? el('span', { class: 'chip', title: 'Máy Hikvision — phần mềm kết nối vào máy (ISAPI) khi bấm tải / theo lịch tự tải' }, '📷 Hikvision') : '',
      isHik && m.hik_push_url ? el('span', { class: 'chip g', title: m.hik_push_at ? `Máy tự gửi lượt chấm về ngay lúc chấm — tin gần nhất ${isoToHMS(m.hik_push_at)} ngày ${m.hik_push_at.slice(8, 10)}/${m.hik_push_at.slice(5, 7)}` : 'Đã cài máy tự gửi lượt chấm, chưa nhận tin nào từ máy' }, '📡 tự gửi') : '',
      isAi ? el('span', { class: 'chip', title: 'Máy AI — máy tự kết nối về phần mềm (WebSocket)' }, '🤖 Máy AI') : '',
      isUnion ? el('span', { class: 'chip', title: `Máy Union / Virdi — máy tự kết nối về cổng ${d.union_port || 9870} (Terminal ID ${parseInt(m.serial.slice(6), 10)})` }, '🧬 Union') : '',
      direct && m.active && autoMin > 0 ? el('span', { class: 'chip' + (m.tcp_auto ? ' g' : ''), title: m.tcp_auto ? `Tự động tải ${autoMin} phút / lần` : 'Máy này đang TẮT tự động tải (bật ở ⋯ Thêm)' }, m.tcp_auto ? `⏱ tự tải ${autoMin}'` : '⏱ tắt tự tải') : '',
      m.sync_group ? el('span', { class: 'chip g', title: 'Nhóm đồng bộ' }, '🔁 ' + m.sync_group) : '',
      m.pin_range ? el('span', { class: 'chip', title: 'Dải Số ID của máy' }, '🔢 ' + m.pin_range) : '',
      m.access_control ? el('span', { class: 'chip o' }, '🚪 Kiểm soát cửa') : '',
      // Đời máy ADMS (máy tự khai lúc bắt tay): đời cũ không hiểu lệnh hỏi danh sách NV → phần mềm tải theo cách khác
      !direct && !isAi && !isUnion && m.push_ver ? el('span', { class: 'chip', title: (m.push_ver === '-' ? 'Máy đời cũ (không khai phiên bản giao thức đẩy)' : 'Máy đời mới — giao thức đẩy ' + m.push_ver) + (m.firmware ? ' · ' + m.firmware : '') }, m.push_ver === '-' ? '🕰 Đời cũ' : '✨ Đời mới') : '',
      // Chưa bắt tay lại từ khi phần mềm biết phân biệt đời máy (máy nối liên tục từ trước khi cập nhật)
      !direct && !isAi && !isUnion && !m.push_ver && m.active ? el('span', { class: 'chip', title: 'Máy chưa kết nối lại từ khi cập nhật phần mềm nên chưa biết đời cũ hay đời mới. Bấm "🕒 Đồng bộ giờ" (máy khởi động lại ~30 giây) rồi Làm mới để biết. Tải nhân viên vẫn làm được: phần mềm dùng cả hai cách.' + (m.firmware ? ' · ' + m.firmware : '') }, '❔ Chưa rõ đời') : '',
      m.reboot_sched ? el('span', { class: 'chip', title: 'Tự khởi động lại theo giờ hẹn' + (m.reboot_note ? ' — lần gần nhất: ' + m.reboot_note : '') }, '⏰ ' + rebootSchedLabel(m.reboot_sched)) : '',
    ].filter(Boolean);
    const seenEl = el('div', { class: 'dv-sub' }, seenText(m.last_seen));
    const ipEl = el('div', { class: 'dv-ip' }, direct ? `${m.tcp_ip}:${m.tcp_port}` : (m.last_ip || '—'));
    const stEl = el('span', { class: 'st ' + (online ? 'on' : 'offl'), title: onlineTitle(online) }, el('i', {}), online ? 'Online' : 'Offline');
    const tr = el('tr', { class: online || direct ? '' : 'off' },
      el('td', {},
        el('div', { class: 'dv-name' }, m.name || el('span', { style: 'color:#9ca3af;font-weight:500' }, 'Chưa đặt tên')),
        el('div', { class: 'dv-serial' }, m.serial,
          el('button', { class: 'cp', title: 'Copy serial', onclick: () => copySerial(m.serial) }, '📋')),
        chips.length ? el('div', { class: 'dv-chips' }, ...chips) : ''),
      el('td', {}, el('div', { class: 'dv-st' },
        direct ? (m.tcp_auto_at && m.tcp_auto && autoMin > 0
            ? el('span', { class: 'st ' + (m.tcp_auto_ok ? 'on' : 'offl'), title: `Lần tự tải gần nhất ${isoToHMS(m.tcp_auto_at)}: ${m.tcp_auto_msg || ''}` }, el('i', {}), m.tcp_auto_ok ? 'Kết nối tốt' : 'Không kết nối được')
            : el('span', { class: 'st', title: (isHik ? 'Máy Hikvision' : 'Máy TCP/IP') + ' không tự gọi về — phần mềm kết nối khi bấm tải hoặc theo lịch tự tải' }, 'Kết nối khi tải'))
          : stEl,
        m.active ? el('span', { class: 'pill ok' }, 'Đã duyệt') : el('span', { class: 'pill warn' }, 'Chờ duyệt'),
        // Máy đã có key thì ẩn nhãn cho đỡ rối; chỉ cảnh báo khi CHƯA có key
        (d.key_required && !m.key_ok) ? el('span', { class: 'pill warn' }, '🔑 Chưa có key') : '')),
      idCell(m),
      cNV, cFP, cFace, cCard,
      el('td', {}, ipEl, seenEl,
        direct && m.tcp_auto_at && m.tcp_auto && autoMin > 0 ? el('div', { class: m.tcp_auto_ok ? 'dv-sub' : 'dv-warn', title: 'Kết quả lần tự động tải gần nhất' }, `⏱ ${isoToHMS(m.tcp_auto_at).slice(0, 5)} · ${m.tcp_auto_msg || ''}`) : ''),
      el('td', { class: 'num b' + (m.punch_count ? '' : ' zero') }, String(m.punch_count),
        m.unmatched ? el('div', { class: 'dv-warn', style: 'cursor:pointer;text-decoration:underline dotted', title: 'Bấm để xem Số ID nào chưa khớp nhân viên', onclick: () => unmatchedModal(m) }, m.unmatched + ' mã chưa khớp') : '',
        m.pending_del ? el('div', { class: 'dv-warn', title: 'Máy đang tắt khi xoá nhân viên. Máy bật lại là phần mềm tự xoá.' }, `⏳ Chờ xoá ${m.pending_del} NV`) : ''),
      el('td', {}, el('div', { class: 'dv-act' }, approveInline, keyBtn, ...(isTcp ? [m.active ? btnSm('⬇ Tải chấm công', () => tcpLogsModal(m)) : null] : isHik || isUnion ? [m.active ? btnSm('⬇ Tải chấm công', () => tcpLogsModal(m, m.conn_type)) : null, doorBtn] : [doorBtn, timeBtn]), logBtn, moreBtn)),
    );
    tb.append(tr);
    if (!direct) statusCells[m.serial] = { tr, st: stEl, ip: ipEl, seen: seenEl };
  }
  tbl.append(tb);
  // Tự làm mới số NV/vân tay/mặt/thẻ + trạng thái Online/Offline mỗi 10s (tự dừng khi rời trang Máy chấm công)
  const tickCounts = async () => {
    if (!document.body.contains(tbl)) return;          // đã rời trang → dừng hẳn
    try {
      const dd = await api('/admin/devices');
      for (const m of dd.rows) {
        const sc = statusCells[m.serial];
        if (sc) {
          const on = !!m.online;
          sc.st.className = 'st ' + (on ? 'on' : 'offl'); sc.st.title = onlineTitle(on); sc.st.lastChild.textContent = on ? 'Online' : 'Offline';
          sc.tr.classList.toggle('off', !on);
          sc.ip.textContent = m.last_ip || '—'; sc.seen.textContent = seenText(m.last_seen);
        }
        const cc = countCells[m.serial]; if (!cc) continue;
        for (const [cell, v] of [[cc.cNV, m.emp_count], [cc.cFP, m.fp_count], [cc.cFace, m.face_count], [cc.cCard, m.card_count]]) {
          cell.textContent = String(v ?? 0); cell.classList.toggle('zero', !v);
        }
      }
    } catch { /* bỏ qua, thử lại lần sau */ }
    if (document.body.contains(tbl)) setTimeout(tickCounts, 10000);
  };
  setTimeout(tickCounts, 10000);
  // 1 nút "Đồng bộ" gộp: bấm ra menu chọn Đồng bộ thường (mặc định) hoặc Ép toàn bộ.
  const doResync = async (force) => {
    const msg = force
      ? 'ÉP ĐỒNG BỘ LẠI TOÀN BỘ giữa các máy cùng nhóm — đẩy lại HẾT nhân viên/vân tay/khuôn mặt/thẻ (kể cả cái máy tưởng đã có).\n\nDùng khi lần trước bị lỗi/thiếu. Xếp nhiều lệnh hơn, máy nhận dần trong ít phút. Tiếp tục?'
      : 'Đồng bộ giữa các máy cùng nhóm — đẩy nhân viên/vân tay/khuôn mặt/thẻ/ảnh mà máy còn THIẾU sang mọi máy trong nhóm ngay bây giờ?';
    if (!confirm(msg)) return;
    try {
      const r = await api('/admin/devices/resync', { method: 'POST', body: force ? { force: true } : undefined });
      if (!r.devices) toast('Chưa có nhóm nào ≥2 máy để đồng bộ. Hãy đặt "Nhóm ĐB" giống nhau cho các máy.', 'err');
      else { toast(`Đã xếp ${r.queued} lệnh đồng bộ cho ${r.devices} máy (${r.groups} nhóm). Máy nhận dần trong ít ${force ? 'phút' : 'giây'}.`, 'ok'); cmdTrack(force ? 'Ép đồng bộ toàn bộ' : 'Đồng bộ các máy', r.track, { after: pageDevices }); }
    } catch (e) { toast(e.message, 'err'); }
  };
  const resyncBtn = rowMenu([
    { label: '🔁 Đồng bộ thường (đẩy cái còn thiếu)', fn: () => doResync(false) },
    { label: '🔁 Ép đồng bộ lại TOÀN BỘ (khi lỗi/thiếu)', fn: () => doResync(true) },
    { label: '⬇ Đẩy NV từ phần mềm xuống máy…', hint: 'Chọn máy + chọn NV, kèm vân tay/khuôn mặt phần mềm đang có', fn: () => pushEmpModal(d.rows, pageDevices) },
  ], '🔁 Đồng bộ');
  resyncBtn.className = 'btn';   // nút chính (không phải kiểu mờ)
  const usbBtn = el('button', { class: 'btn' }, '⬆ Nhập từ USB');
  usbBtn.onclick = usbImportModal;
  const legacyBtn = el('button', { class: 'btn', title: 'Lấy bộ phận + nhân viên + dữ liệu chấm công từ Wise Eye On39 / Wise Eye V5.1 / Ronald Jack Pro (file .mdb)' }, '⇄ Chuyển từ Wise Eye / Ronald Jack');
  legacyBtn.onclick = legacyImportModal;
  const delAllBtn = el('button', { class: 'btn ghost', title: 'Xoá nhân viên nghỉ việc trên tất cả máy chấm công 1 lần' }, '🗑 Xóa NV trên tất cả máy');
  delAllBtn.onclick = () => deleteUsersAllModal(pageDevices);
  const tcpBtn = d.tcp_enabled ? el('button', { class: 'btn' }, '＋ Thêm máy TCP/IP') : null;
  if (tcpBtn) tcpBtn.onclick = () => tcpAddModal(null);
  const hikBtn = d.hik_enabled ? el('button', { class: 'btn' }, '＋ Thêm máy Hikvision') : null;
  if (hikBtn) hikBtn.onclick = () => hikAddModal(null);
  const lanBtn = d.tcp_supported ? el('button', { class: 'btn', title: 'Dò máy chấm công trong mạng LAN và tự trỏ Cloud Server về tên miền phần mềm này' }, '🔍 Tìm máy trong LAN') : null;
  if (lanBtn) lanBtn.onclick = lanScanModal;
  // Thanh TỰ ĐỘNG TẢI máy TCP/IP (kind 'tcp') / Hikvision (kind 'hik'): chọn chu kỳ (lưu ngay) + nút tải ngay tất cả
  const autoBarOf = (kind, label, minutes, choices) => {
    const sel = el('select', { style: 'width:auto;margin:0' }, ...(choices || [0]).map((n) => el('option', { value: n, ...(n === minutes ? { selected: '' } : {}) }, !n ? 'Tắt (chỉ tải khi bấm)' : n < 60 ? `${n} phút / lần` : `${n / 60} giờ / lần`)));
    sel.onchange = async () => {
      try { await api(`/admin/${kind}-devices/auto`, { method: 'PUT', body: { minutes: +sel.value } }); toast(+sel.value ? `Đã bật tự động tải ${sel.options[sel.selectedIndex].text}` : 'Đã tắt tự động tải', 'ok'); pageDevices(); }
      catch (e) { toast(e.message, 'err'); sel.value = minutes; }
    };
    const runAll = btnSm('⬇ Tải ngay tất cả máy', () => tcpAutoRun(kind), 'ghost');
    return el('div', { class: 'panel', style: 'padding:10px 14px;margin-bottom:10px;display:flex;gap:10px 14px;align-items:center;flex-wrap:wrap' },
      el('b', {}, '⏱ Tự động tải ' + label), sel, runAll,
      el('span', { class: 'map-hint', style: 'margin:0;flex:1;min-width:260px' }, minutes
        ? (kind === 'hik' ? 'Đến giờ phần mềm tự hỏi từng máy; máy có lượt chấm mới mới tải về. Máy tắt / mất mạng thì lượt sau thử lại. Phần mềm phải đang chạy.'
          : 'Đến giờ phần mềm tự hỏi từng máy; máy có lượt chấm mới mới tải về (lúc tải máy tạm khoá vài giây). Máy tắt / mất mạng thì lượt sau thử lại. Phần mềm phải đang chạy.')
        : 'Đang tắt: dữ liệu chỉ về khi bấm "⬇ Tải chấm công". Chọn chu kỳ để phần mềm tự tải.'));
  };
  const autoBar = d.tcp_enabled && d.rows.some((m) => m.conn_type === 'tcp') ? autoBarOf('tcp', 'máy TCP/IP', d.tcp_auto_min, d.tcp_auto_choices) : null;
  const hikAutoBar = d.hik_enabled && d.rows.some((m) => m.conn_type === 'hik') ? autoBarOf('hik', 'máy Hikvision', d.hik_auto_min, d.hik_auto_choices) : null;
  // 2 khung trên cùng: mặc định THU GỌN (chỉ 1 dòng tóm tắt), bấm ▶ để mở — nhớ trên máy
  const FEAT = [['Máy chấm công', d.enabled], ['Tự tạo NV', d.autocreate], ['Bắt buộc key', d.key_required], ['TCP/IP', d.tcp_enabled], ['Union', d.union_enabled], ['Máy AI', d.ai_enabled], ['Hikvision', d.hik_enabled],
    ['Cảnh báo trùng Số ID', d.pin_guard], ['Đồng bộ NV xuống máy', d.auto_push]];
  foldPanel(togglePanel, 'dev_features', '⚙️ Tính năng máy chấm công', () => {
    const on = FEAT.filter((f) => f[1]).map((f) => f[0]);
    return on.length ? '— Bật: ' + on.join(' · ') : '— Đang tắt hết';
  }, true);
  foldPanel(guide, 'dev_guide', '🔧 Cách kết nối máy chấm công', () => '— IP ' + ipVal.textContent + ' · Port ' + portVal.textContent + (domain ? ' · ' + domain : ''), true);
  setMain(head('Máy chấm công', lanBtn, tcpBtn, hikBtn, usbBtn, legacyBtn, resyncBtn, d.rows.length ? delAllBtn : null), pinConflictBar(d.pin_conflicts, pageDevices), togglePanel, guide, autoBar, hikAutoBar, el('div', { class: 'panel tbl-scroll' }, tbl));
}

// Thanh vàng "Số ID nghi trùng" (null nếu không có)
function pinConflictBar(count, after) {
  if (!count) return null;
  const b = el('button', { class: 'btn sm' }, 'Xem và xử lý');
  b.onclick = () => pinConflictModal(after);
  return el('div', { class: 'panel', style: 'padding:10px 14px;margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:#fff7e0;border:1px solid #f1c46b' },
    el('span', { style: 'font-size:18px' }, '⚠️'),
    el('span', { style: 'flex:1;min-width:220px;color:#7a4b00;font-weight:600' }, `${count} Số ID nghi trùng giữa các máy — đã tạm dừng đồng bộ và giữ lượt quẹt ở máy đó (chưa tính công) chờ xử lý.`), b);
}

// Hộp xử lý cảnh báo trùng Số ID: so 2 người, chọn "Người khác" (cấp Số ID mới) / "Cùng 1 người" / "Để sau"
async function pinConflictModal(after) {
  const box = el('div', {}, loading());
  const fmt = (iso) => { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }); };
  const REASON = { enroll: 'vừa ĐĂNG KÝ MỚI Số ID này, trong khi Số ID đã thuộc người khác', name: 'gửi lên tên khác hẳn tên đang dùng Số ID này', range: 'vừa đăng ký Số ID nằm NGOÀI dải đã khai cho máy' };
  const initials = (n) => String(n || '?').trim().split(/\s+/).slice(-2).map((x) => x[0] || '').join('').toUpperCase() || '?';
  const avatar = (src, name, warn) => src ? el('img', { src, style: 'width:56px;height:56px;border-radius:50%;object-fit:cover;flex:none' })
    : el('div', { style: `width:56px;height:56px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-weight:700;${warn ? 'background:#fdecc8;color:#8a5300' : 'background:#e6effa;color:#1d4f91'}` }, initials(name));
  const line = (t) => el('div', { style: 'font-size:12.5px;color:var(--muted);line-height:1.6' }, t);
  const load = async () => {
    let r; try { r = await api('/admin/devices/pin-conflicts'); } catch (e) { box.innerHTML = ''; box.append(el('div', { class: 'dv-warn' }, e.message)); return; }
    box.innerHTML = '';
    if (!r.rows.length) { box.append(el('div', { class: 'empty' }, '✅ Không còn Số ID nghi trùng nào.')); return; }
    for (const c of r.rows) {
      const ref = c.ref, dv = c.dev;
      const left = el('div', { style: 'border:1px solid var(--line,#e5e5e5);border-radius:10px;padding:12px;flex:1;min-width:230px' },
        el('div', { style: 'font-size:12px;color:var(--muted);margin-bottom:6px' }, 'Đang dùng Số ID ' + c.pin),
        el('div', { style: 'display:flex;gap:10px;align-items:center;margin-bottom:8px' },
          avatar(ref.photo, ref.name, false),
          el('div', {}, el('b', {}, ref.name || '(chưa có tên)'), ref.department ? line(ref.department) : '', ref.code ? line('Mã NV: ' + ref.code) : '')),
        line('Có trên: ' + (ref.devices.length ? ref.devices.join(', ') : '(chỉ có trong phần mềm)')),
        line(`${ref.fp} vân tay${ref.card ? ', có thẻ' : ''}`),
        line('Quẹt gần nhất: ' + (ref.last_at ? fmt(ref.last_at) + ' · ' + ref.last_dev : '—')));
      const right = el('div', { style: 'border:1px solid #f1c46b;border-radius:10px;padding:12px;flex:1;min-width:230px;background:#fffbf0' },
        el('div', { style: 'font-size:12px;color:#8a5300;margin-bottom:6px' }, `${c.status === 'open' ? 'Vừa đăng ký' : 'Đang chuyển'} ở ${c.dev_label}`),
        el('div', { style: 'display:flex;gap:10px;align-items:center;margin-bottom:8px' }, avatar(dv.photo, dv.name, true),
          el('div', {}, el('b', {}, dv.name || '(máy không gửi tên)'), line(dv.name ? 'Tên gõ trên máy' : ''))),
        line('Lúc: ' + fmt(c.since)),
        line(`${dv.fp} vân tay${dv.face ? ', ' + dv.face + ' khuôn mặt' : ''}${dv.card ? ', có thẻ' : ''}${dv.passwd ? ', có mật mã' : ''}`),
        line(c.status === 'open' ? `Đã quẹt ${dv.held} lần — đang giữ, chưa tính công` : `Số ID mới: ${c.new_pin}`));
      const card = el('div', { class: 'panel', style: 'padding:14px;margin-bottom:12px' },
        el('div', { style: 'font-weight:700;margin-bottom:4px' }, `Số ID ${c.pin} đang được dùng cho 2 người?`),
        el('div', { class: 'map-hint', style: 'margin:0 0 10px' }, `Máy "${c.dev_label}" ${REASON[c.reason] || 'gửi dữ liệu nghi trùng'}.`),
        el('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px' }, left, right));
      if (c.status === 'open') {
        const pinI = el('input', { value: c.suggest_pin || '', style: 'width:110px;margin:0', inputmode: 'numeric' });
        const otherB = el('button', { class: 'btn' }, 'Người khác: cấp Số ID mới');
        otherB.onclick = async () => {
          const np = pinI.value.trim();
          if (!/^\d{1,9}$/.test(np)) return toast('Nhập Số ID mới (chỉ gồm chữ số)', 'err');
          if (!confirm(`Cấp Số ID ${np} cho "${dv.name || 'người vừa đăng ký'}" ở ${c.dev_label}?\n\n• Giữ nguyên vân tay / khuôn mặt / thẻ / mật mã — KHÔNG cần đăng ký lại\n• Tạo NV nháp Số ID ${np}, chuyển ${dv.held} lượt quẹt đang giữ sang người này\n• Máy xác nhận tạo số mới xong mới xoá Số ID ${c.pin} trên máy đó, rồi trả "${ref.name || 'người cũ'}" về lại máy\n${dv.passwd ? '\nNgười này bấm MẬT MÃ thì phải gõ Số ID mới ' + np + '.' : ''}`)) return;
          otherB.disabled = true;
          try { const x = await api('/admin/devices/pin-conflicts/' + c.id + '/resolve', { method: 'POST', body: { action: 'other', new_pin: np } }); toast(`Đã cấp Số ID ${x.new_pin}, chuyển ${x.moved} lượt quẹt. Chờ máy xác nhận.`, 'ok'); load(); }
          catch (e) { otherB.disabled = false; toast(e.message, 'err'); }
        };
        const sameB = el('button', { class: 'btn ghost' }, 'Cùng 1 người');
        sameB.onclick = async () => {
          if (!confirm(`Xác nhận người ở ${c.dev_label} CHÍNH LÀ "${ref.name || 'Số ID ' + c.pin}"?\n\n${dv.held} lượt quẹt đang giữ sẽ tính cho người này, đồng bộ lại bình thường.`)) return;
          try { await api('/admin/devices/pin-conflicts/' + c.id + '/resolve', { method: 'POST', body: { action: 'same' } }); toast('Đã xác nhận cùng 1 người', 'ok'); load(); }
          catch (e) { toast(e.message, 'err'); }
        };
        card.append(el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' },
          c.tcp ? el('span', { class: 'map-hint', style: 'margin:0' }, 'Máy TCP/IP: muốn đổi số thì đổi trên máy rồi tải lại nhân viên.') : el('span', { style: 'display:flex;gap:6px;align-items:center' }, otherB, el('span', { class: 'muted' }, 'Số mới:'), pinI),
          sameB, el('span', { class: 'map-hint', style: 'margin:0' }, 'Chưa chắc → bấm Đóng (để sau), lượt quẹt vẫn được giữ.')));
      } else if (c.status === 'failed') {
        const retryB = el('button', { class: 'btn' }, 'Gửi lại');
        retryB.onclick = async () => { try { await api('/admin/devices/pin-conflicts/' + c.id + '/resolve', { method: 'POST', body: { action: 'retry' } }); toast('Đã gửi lại lệnh', 'ok'); load(); } catch (e) { toast(e.message, 'err'); } };
        card.append(el('div', { class: 'dv-warn' }, c.note), el('div', { style: 'margin-top:8px' }, retryB));
      } else card.append(el('div', { class: 'map-hint', style: 'margin:0' }, '⏳ ' + (c.note || 'Đang chờ máy xác nhận…')));
      box.append(card);
    }
    if (!r.enabled) box.append(el('div', { class: 'map-hint' }, 'Công tắc "Cảnh báo trùng Số ID" đang TẮT: không phát hiện thêm, nhưng các cảnh báo cũ vẫn cần xử lý.'));
  };
  openModal('Số ID nghi trùng giữa các máy', [box], [el('button', { class: 'btn ghost', onclick: () => { closeModal(); after && after(); } }, 'Đóng')]);
  load();
}

// "N mã chưa khớp": liệt kê Số ID có lượt quẹt mà chưa khớp NV nào (kèm tên trên máy nếu đã tải NV) → biết điền "Số ID máy" cho ai
function unmatchedModal(m) {
  const rows = m.unmatched_pins || [];
  const d = (t) => t ? isoToHMS(t) + ' ' + t.slice(8, 10) + '/' + t.slice(5, 7) + '/' + t.slice(0, 4) : '';
  openModal('Mã chưa khớp · ' + (m.name || m.serial), [
    el('div', { class: 'map-hint' }, 'Các Số ID dưới đây có lượt quẹt trên máy nhưng chưa thuộc nhân viên nào trong phần mềm. Vào Nhân viên → sửa người đó → điền ô "Số ID máy chấm công" đúng số này, lượt quẹt cũ tự khớp và tính công lại.'),
    el('div', { class: 'table-wrap', style: 'margin-top:10px' }, el('table', { class: 'data' },
      el('thead', {}, el('tr', {}, ...['Số ID', 'Tên trên máy', 'Số lượt quẹt', 'Lần đầu', 'Lần cuối'].map((h) => el('th', {}, h)))),
      el('tbody', {}, ...rows.map((x) => el('tr', {}, el('td', {}, el('b', {}, x.pin)), el('td', {}, x.name || el('span', { class: 'muted' }, '(máy không có tên / đã xoá trên máy)')),
        el('td', {}, String(x.n)), el('td', {}, d(x.first)), el('td', {}, d(x.last))))))),
  ], [el('button', { class: 'btn', onclick: closeModal }, 'Đóng')]);
}

// ẢNH KHUÔN MẶT từ máy tính: thu nhỏ ngay trên trình duyệt (cạnh dài ≤ 640 px) → JPG ≤ 150 KB (máy Hikvision nhận ≤ 200 KB). Trả base64.
async function faceJpeg(file) {
  const url = URL.createObjectURL(file);
  try {
    const heic = /\.hei[cf]$/i.test(file.name || '') || /hei[cf]/i.test(file.type || '');
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error(heic ? 'ảnh iPhone dạng HEIC trình duyệt không đọc được — gửi ảnh qua Zalo/Gmail sang máy tính (tự thành JPG) hoặc trên iPhone chọn Cài đặt → Camera → Định dạng → Tương thích nhất' : 'không đọc được ảnh')); i.src = url; });
    const W = img.naturalWidth, H = img.naturalHeight;
    if (Math.min(W, H) < 120) throw new Error(`ảnh nhỏ quá (${W}×${H})`);
    const k = Math.min(1, 640 / Math.max(W, H));
    const c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.9, 0.82, 0.74, 0.66, 0.58, 0.5]) {
      const b64 = c.toDataURL('image/jpeg', q).split(',')[1];
      if (b64.length * 0.75 <= 150 * 1024) return b64;
    }
    throw new Error('ảnh quá nặng');
  } finally { URL.revokeObjectURL(url); }
}
// Khối "Tải ảnh khuôn mặt" (hộp Đẩy NV xuống máy): chọn nhiều ảnh / cả thư mục, tên file = Mã NV (hoặc Số ID máy).
// Lưu xong gọi onSaved(danh sách NV đã có ảnh) để hộp đẩy chọn sẵn những người này + bật "kèm khuôn mặt".
function faceUploadBox(onSaved) {
  const pick = el('input', { type: 'file', accept: 'image/*', multiple: '', style: 'display:none' });
  const pickDir = el('input', { type: 'file', multiple: '', webkitdirectory: '', style: 'display:none' });
  const out = el('div');
  const b1 = el('button', { class: 'btn sm' }, '📸 Chọn ảnh…'), b2 = el('button', { class: 'btn ghost sm' }, '📁 Chọn cả thư mục…');
  b1.onclick = () => pick.click(); b2.onclick = () => pickDir.click();
  const run = async (fileList) => {
    const files = [...fileList].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|bmp|webp)$/i.test(f.name));
    pick.value = ''; pickDir.value = '';
    if (!files.length) return toast('Không có file ảnh nào', 'err');
    b1.disabled = b2.disabled = true;
    out.innerHTML = '';
    const st = el('div', { style: 'font-weight:600;margin-top:6px' }); out.append(st);
    const res = { saved: [], unmatched: [], nopin: [], bad: [] };
    let batch = [];
    const flush = async () => {
      if (!batch.length) return;
      const r = await api('/admin/employees/face-photos', { method: 'POST', body: { items: batch } });
      for (const k of Object.keys(res)) res[k].push(...(r[k] || []));
      batch = [];
    };
    try {
      for (let i = 0; i < files.length; i++) {
        st.textContent = `⏳ Đang thu nhỏ + lưu ảnh ${i + 1} / ${files.length}…`;
        const key = files[i].name.replace(/\.[^.]+$/, '');
        try { batch.push({ key, photo: await faceJpeg(files[i]) }); } catch (e) { res.bad.push({ key, error: e.message }); }
        if (batch.length >= 10) await flush();
      }
      await flush();
    } catch (e) { st.textContent = '❌ ' + e.message; b1.disabled = b2.disabled = false; return; }
    b1.disabled = b2.disabled = false;
    st.textContent = `✅ Đã lưu ảnh khuôn mặt cho ${res.saved.length} / ${files.length} ảnh.` + (res.saved.length ? ' Những NV này đã được chọn sẵn bên dưới — chọn máy rồi bấm Đẩy.' : '');
    const list = (a, f) => a.slice(0, 40).map(f).join(', ') + (a.length > 40 ? ` … (+${a.length - 40})` : '');
    if (res.unmatched.length) out.append(el('div', { class: 'dv-warn' }, `${res.unmatched.length} ảnh không khớp Mã NV / Số ID nào (đặt tên file đúng Mã NV, VD TB035294.jpg): ${list(res.unmatched, (x) => x)}`));
    if (res.nopin.length) out.append(el('div', { class: 'dv-warn' }, `${res.nopin.length} NV chưa có Số ID máy chấm công — sửa NV điền Số ID rồi tải lại ảnh: ${list(res.nopin, (x) => x.code + ' ' + x.name)}`));
    if (res.bad.length) out.append(el('div', { class: 'dv-warn' }, `${res.bad.length} ảnh không dùng được: ${list(res.bad, (x) => x.key + ' (' + x.error + ')')}`));
    const off = res.saved.filter((x) => !x.active).length;
    if (off) out.append(el('div', { class: 'map-hint' }, `${off} NV đã khoá (nghỉ việc): ảnh vẫn lưu nhưng không đẩy xuống máy.`));
    if (res.saved.length) onSaved(res.saved);
  };
  pick.onchange = () => run(pick.files); pickDir.onchange = () => run(pickDir.files);
  return el('div', { style: 'border:1px dashed #f2cdb8;background:var(--soft,#fff3ec);border-radius:10px;padding:10px 12px;margin:0 0 10px' },
    el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, el('b', {}, 'Ảnh khuôn mặt từ máy tính'), b1, b2, pick, pickDir),
    el('div', { class: 'map-hint', style: 'margin:4px 0 0' }, 'Ảnh chân dung chính diện, rõ mặt, không đội mũ/đeo kính râm. Đặt tên file = Mã NV (VD TB035294.jpg) hoặc Số ID máy. Phần mềm tự thu nhỏ ảnh; đẩy xuống máy là chấm bằng khuôn mặt được (máy Hikvision, máy ZKTeco nhận diện mặt ánh sáng thường).'),
    out);
}

// ĐẨY NV TỪ PHẦN MỀM XUỐNG MÁY (bấm tay): chọn máy + chọn NV (đang làm, có Số ID), tuỳ chọn kèm sinh trắc phần mềm đang có
// opt.face: mở từ "Tải ảnh khuôn mặt + đẩy xuống máy" → hiện khối tải ảnh ở đầu hộp
async function pushEmpModal(devRows, after, opt = {}) {
  const devs = (devRows || []).filter((m) => m.active && m.conn_type !== 'union');
  const devBox = el('div', { style: 'display:flex;gap:6px 14px;flex-wrap:wrap;margin:6px 0 10px' });
  const devChk = devs.map((m) => {
    const c = el('input', { type: 'checkbox', style: 'width:auto', checked: '', value: m.serial });
    devBox.append(el('label', { style: 'display:flex;gap:6px;align-items:center;margin:0;font-weight:500;color:var(--ink)' }, c, (m.name || m.serial) + (m.conn_type === 'tcp' ? ' · TCP/IP' : '') + (m.sync_group ? ' · 🔁' + m.sync_group : '')));
    return c;
  });
  if (!devs.length) devBox.append(el('div', { class: 'dv-warn' }, 'Chưa có máy nào đã duyệt.'));
  const bioChk = el('input', { type: 'checkbox', class: 'sw sm', checked: '' });
  const searchI = el('input', { type: 'search', placeholder: '🔍 Tìm Số ID, tên, mã, bộ phận…', style: 'flex:1;min-width:200px' });
  const selAll = el('input', { type: 'checkbox', style: 'width:auto' });
  const cntLbl = el('span', { class: 'map-hint', style: 'margin:0' });
  const box = el('div', { style: 'max-height:300px;overflow:auto;border:1px solid var(--line,#e5e5e5);border-radius:8px;padding:6px 10px' }, loading());
  const goBtn = el('button', { class: 'btn' }, '⬇ Đẩy xuống máy');
  const picked = new Set();
  let rows = [];
  const match = (u) => { const q = searchI.value.trim().toLowerCase(); return !q || [u.pin, u.name, u.code, u.department].some((v) => String(v || '').toLowerCase().includes(q)); };
  const upd = () => { goBtn.textContent = `⬇ Đẩy ${picked.size} NV xuống máy`; };
  const render = () => {
    const list = rows.filter(match);
    box.innerHTML = '';
    cntLbl.textContent = `${list.length} / ${rows.length} NV`;
    selAll.checked = list.length > 0 && list.every((u) => picked.has(u.pin));
    if (!list.length) { box.append(el('div', { class: 'map-hint' }, rows.length ? 'Không có ai khớp.' : 'Chưa có NV đang làm nào có Số ID máy.')); return; }
    for (const u of list.slice(0, 1500)) {
      const cb = el('input', { type: 'checkbox', style: 'width:auto', ...(picked.has(u.pin) ? { checked: '' } : {}) });
      cb.onchange = () => { cb.checked ? picked.add(u.pin) : picked.delete(u.pin); upd(); };
      box.append(el('label', { style: 'display:flex;gap:8px;align-items:center;padding:3px 0;margin:0;font-weight:500;color:var(--ink)' }, cb,
        el('span', {}, el('b', {}, '🔌' + u.pin), ' · ' + (u.name || ''), u.code && u.code !== u.pin ? el('span', { class: 'muted' }, ' · ' + u.code) : '', u.department ? el('span', { class: 'muted' }, ' · ' + u.department) : '', u.face ? el('span', { title: 'Có ảnh khuôn mặt — đẩy kèm khi tích "kèm khuôn mặt"' }, ' 📸') : ''),
        el('span', { class: 'map-hint', style: 'margin:0 0 0 auto' }, u.devices.length ? 'Có trên ' + u.devices.length + ' máy' : 'Chưa có trên máy')));
    }
  };
  searchI.oninput = render;
  selAll.onchange = () => { for (const u of rows.filter(match)) selAll.checked ? picked.add(u.pin) : picked.delete(u.pin); render(); upd(); };
  const faceBox = faceUploadBox((saved) => {
    const pins = new Set(saved.filter((x) => x.active).map((x) => String(x.pin)));
    for (const u of rows) if (pins.has(u.pin)) { u.face = true; picked.add(u.pin); }
    bioChk.checked = true; searchI.value = ''; render(); upd();
  });
  const faceBtn = el('button', { class: 'btn ghost sm' }, '📸 Tải ảnh khuôn mặt…');
  if (!opt.face) faceBox.style.display = 'none';
  faceBtn.onclick = () => { faceBox.style.display = ''; faceBtn.style.display = 'none'; };
  if (opt.face) faceBtn.style.display = 'none';
  goBtn.onclick = async () => {
    const serials = devChk.filter((c) => c.checked).map((c) => c.value);
    if (!picked.size) return toast('Chưa chọn nhân viên', 'err');
    if (!serials.length) return toast('Chưa chọn máy', 'err');
    if (!confirm(`Đẩy ${picked.size} nhân viên (Số ID + tên${bioChk.checked ? ' + vân tay/khuôn mặt phần mềm đang có' : ''}) xuống ${serials.length} máy?`)) return;
    try {
      const r = await api('/admin/devices/push-employees', { method: 'POST', body: { pins: [...picked], serials, with_bio: bioChk.checked } });
      toast(r.msg, r.users || r.job ? 'ok' : 'err');
      if (r.users) cmdTrack(`Đẩy ${picked.size} NV${bioChk.checked ? ' + vân tay/khuôn mặt' : ''} xuống máy`, r.track);
      if (r.job) { closeModal(); hikPushJobModal(r.job, bioChk.checked, after); } else if (r.users) { closeModal(); after && after(); }
    }
    catch (e) { toast(e.message, 'err'); }
  };
  upd();
  openModal(opt.face ? 'Tải ảnh khuôn mặt + đẩy xuống máy' : 'Đẩy nhân viên từ phần mềm xuống máy', [
    el('div', { class: 'map-hint', style: 'margin:0 0 6px' }, 'Ghi Số ID + tên trong phần mềm xuống máy. Sau đó đăng ký vân tay / mặt / thẻ ở 1 máy → tự sang các máy cùng nhóm đồng bộ và về phần mềm. Hoặc tải ảnh khuôn mặt từ máy tính rồi đẩy kèm.', ' ', faceBtn),
    faceBox,
    el('b', {}, 'Máy nhận'), devBox,
    el('label', { style: 'display:flex;gap:8px;align-items:center;margin:0 0 10px;font-weight:500;color:var(--ink)' }, bioChk, 'Kèm vân tay / khuôn mặt (nếu phần mềm đã có từ máy khác)' + (devs.some((m) => m.conn_type === 'hik') ? ' · máy Hikvision: kèm ảnh khuôn mặt' : '')),
    el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:6px' }, searchI,
      el('label', { style: 'display:flex;align-items:center;gap:6px;margin:0;font-weight:600;color:var(--ink)' }, selAll, 'Chọn tất cả (theo lọc)'), cntLbl),
    box,
  ], [goBtn, el('button', { class: 'btn ghost', onclick: closeModal }, 'Đóng')]);
  try { rows = (await api('/admin/devices/all-users')).rows.filter((u) => u.emp_id && u.active); } catch (e) { box.innerHTML = ''; box.append(el('div', { class: 'dv-warn' }, e.message)); return; }
  render();
}

// Kết quả POST /devices/delete-users-all: bật hộp tiến trình máy ADMS, ghi tóm tắt vào box
function devDelSummary(r, box, n) {
  if (r.push.length) cmdTrack(`Xóa ${n} NV trên ${r.push.length} máy`, r.track);
  if (r.push.length) box.append(el('div', { class: 'map-hint', style: 'margin:0 0 6px' }, `✅ Đã gửi lệnh xoá xuống ${r.push.length} máy: ${r.push.join(', ')}. Máy đang kết nối xoá ngay, máy đang tắt sẽ xoá khi kết nối lại.`));
  if (r.tcpNote) box.append(el('div', { class: 'dv-warn' }, r.tcpNote));
  if (r.idle && r.idle.length) box.append(el('div', { class: 'dv-warn' }, `Máy đang tạm dừng / chờ duyệt chưa xoá: ${r.idle.join(', ')}. Bật lại máy rồi bấm Xóa lần nữa (hoặc xoá trên máy).`));
  if (r.waiting && r.waiting.length) box.append(el('div', { class: 'map-hint', style: 'margin:0 0 6px' }, `⏳ Máy TCP/IP đang tạm dừng: ${r.waiting.join(', ')}. Bật lại máy là phần mềm tự xoá.`));
  if (!r.push.length && !r.tcp.length && !r.job && !r.waiting?.length) box.append(el('div', { class: 'dv-warn' }, 'Chưa có máy nào đang dùng để xoá.'));
}
// Máy TCP/IP / Hikvision / Union: xoá chạy nền → theo dõi tiến độ, ghi kết quả từng máy vào box
async function devDelWatchJob(r, box) {
  if (!r.job) return null;
  const st = el('div', { style: 'font-weight:600' }, `⏳ Đang xoá trên ${(r.direct || r.tcp).length} máy kết nối trực tiếp…`);
  box.append(st);
  for (;;) {
    await new Promise((ok) => setTimeout(ok, 1000));
    let j; try { j = await api('/admin/devices/tcp-jobs/' + r.job); } catch (e) { st.textContent = '❌ ' + e.message; return null; }
    if (j.state === 'run') { st.textContent = '⏳ ' + j.msg; continue; }
    if (j.state === 'err') { st.textContent = '❌ ' + j.msg; return null; }
    st.textContent = (j.result?.devices || []).every((x) => x.ok) ? '✅ Máy kết nối trực tiếp:' : '⚠ Máy kết nối trực tiếp:';
    for (const x of (j.result?.devices || [])) box.append(el('div', { class: x.ok ? 'map-hint' : 'dv-warn', style: 'margin:2px 0' },
      x.ok ? `• ${x.device}: đã xoá ${x.deleted} người` + (x.absent != null ? ` · ${x.absent} người không có trên máy (bỏ qua)` : ' (người không có trên máy này thì bỏ qua)') + (x.failed?.length ? ` — ⚠ máy không cho xoá: ${x.failed.slice(0, 20).join(', ')} (thử lại / xoá tay trên máy)` : '') : `• ${x.device}: ${x.error}` + (x.waiting ? '. Máy bật lại là phần mềm tự xoá.' : '')));
    return j.result;
  }
}
// XÓA NV TRÊN TẤT CẢ MÁY 1 lần (NV nghỉ việc) → hỏi KHOÁ luôn để phần mềm không đồng bộ họ lại xuống máy
async function deleteUsersAllModal(after) {
  const searchI = el('input', { type: 'search', placeholder: '🔍 Tìm Số ID, tên, mã, bộ phận…', style: 'flex:1;min-width:200px' });
  const onlyLocked = el('input', { type: 'checkbox', style: 'width:auto' });
  const selAll = el('input', { type: 'checkbox', style: 'width:auto' });
  const cntLbl = el('span', { class: 'map-hint', style: 'margin:0' });
  const box = el('div', { style: 'max-height:340px;overflow:auto;border:1px solid var(--line,#e5e5e5);border-radius:8px;padding:6px 10px;margin-top:8px' }, loading());
  const goBtn = el('button', { class: 'btn', style: 'background:#c0392b;border-color:#c0392b' }, '🗑 Xóa trên tất cả máy');
  const picked = new Set();
  let rows = [], devChks = [];
  // Chọn máy để xoá: máy mất kết nối thì bỏ tích (máy đẩy / TCP/IP vẫn nhận lệnh khi kết nối lại; máy Hikvision sẽ báo lỗi)
  const devBox = el('div', { style: 'display:flex;flex-direction:column;gap:4px;margin-top:4px' }, loading());
  const devPicked = () => devChks.filter((x) => x.cb.checked);
  const upd = () => {
    const n = devPicked().length, all = n === devChks.length;
    goBtn.textContent = `🗑 Xóa trên ${all ? 'tất cả máy' : n + ' máy'} (${picked.size})`;
    goBtn.disabled = !picked.size || !n;
  };
  const offNote = (m) => m.conn_type === 'hik' || m.conn_type === 'union' ? 'phần mềm phải nối được vào máy, mất kết nối sẽ báo lỗi'
    : m.conn_type === 'tcp' ? 'nhớ lệnh, máy lên lại tự xoá' : 'máy nhận lệnh khi kết nối lại';
  // Máy Hikvision / TCP/IP: phần mềm nối vào máy theo lịch nên "lần cuối" có thể đã lâu dù máy vẫn bật → dò thẳng máy (/devices/reach)
  const isDirect = (m) => m.conn_type === 'hik' || m.conn_type === 'tcp';
  const setState = (x, on, checking) => {
    x.pill.className = 'pill ' + (checking ? 'warn' : on ? 'ok' : 'muted');
    x.pill.textContent = checking ? '⏳ Đang kiểm tra kết nối…' : on ? '🟢 Đang kết nối' : (isDirect(x.m) ? '⚪ Không kết nối được' : '⚪ Mất kết nối');
    const seen = x.m.last_seen ? new Date(x.m.last_seen).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
    x.note.textContent = checking || on ? '' : (isDirect(x.m) ? `${x.m.tcp_ip} không trả lời · ` : (seen ? 'Lần cuối ' + seen + ' · ' : '')) + 'tích vào: ' + offNote(x.m);
    x.note.style.display = x.note.textContent ? '' : 'none';
    x.cb.checked = !checking && on;
  };
  const renderDevs = (devs) => {
    devBox.innerHTML = '';
    if (!devs.length) { devBox.append(el('div', { class: 'map-hint' }, 'Chưa có máy chấm công nào đang dùng.')); return; }
    devChks = devs.map((m) => {
      const cb = el('input', { type: 'checkbox', style: 'width:auto;margin:0' });
      cb.onchange = upd;
      const pill = el('span', { class: 'pill', style: 'margin-left:4px' });
      const note = el('div', { class: 'map-hint', style: 'margin:2px 0 0' });
      devBox.append(el('label', { style: 'display:flex;align-items:flex-start;gap:8px;font-weight:500;color:var(--ink)' }, cb,
        el('div', {}, el('b', {}, m.name || m.serial), ' ', pill, note)));
      const x = { m, cb, pill, note };
      setState(x, !!m.online, isDirect(m) && !!m.tcp_ip);
      return x;
    });
    upd();
    if (devChks.some((x) => isDirect(x.m) && x.m.tcp_ip)) api('/admin/devices/reach').then((d) => {
      for (const x of devChks) if (isDirect(x.m) && x.m.tcp_ip) setState(x, !!(d.reach || {})[x.m.serial], false);
      upd();
    }).catch(() => { for (const x of devChks) if (isDirect(x.m) && x.m.tcp_ip) setState(x, !!x.m.online, false); upd(); });
  };
  const render = () => {
    const q = searchI.value.trim().toLowerCase();
    const list = rows.filter((u) => (!onlyLocked.checked || u.active === false)
      && (!q || [u.pin, u.name, u.code, u.department].some((v) => String(v || '').toLowerCase().includes(q))));
    box.innerHTML = '';
    cntLbl.textContent = `${list.length} / ${rows.length} Số ID`;
    selAll.checked = list.length > 0 && list.every((u) => picked.has(u.pin));
    if (!list.length) { box.append(el('div', { class: 'map-hint' }, rows.length ? 'Không có ai khớp bộ lọc.' : 'Chưa có Số ID nào trên máy / phần mềm.')); return; }
    for (const u of list.slice(0, 1500)) {
      const cb = el('input', { type: 'checkbox', style: 'width:auto', ...(picked.has(u.pin) ? { checked: '' } : {}) });
      cb.onchange = () => { cb.checked ? picked.add(u.pin) : picked.delete(u.pin); upd(); };
      box.append(el('label', { style: 'display:flex;align-items:flex-start;gap:8px;padding:4px 0;border-bottom:1px dashed var(--line,#eee);font-weight:500;color:var(--ink)' }, cb,
        el('div', {}, el('b', {}, '🔌' + u.pin), ' · ', u.name || el('i', { class: 'muted' }, '(chưa có tên)'),
          u.department ? el('span', { class: 'muted' }, ' · ' + u.department) : '',
          u.active === false ? el('span', { class: 'pill bad', style: 'margin-left:6px' }, 'Đã khoá') : u.emp_id ? '' : el('span', { class: 'pill warn', style: 'margin-left:6px' }, 'Chưa gắn NV'),
          el('div', { class: 'map-hint', style: 'margin:2px 0 0' }, u.devices.length ? 'Có trên: ' + u.devices.join(', ') : 'Chưa thấy trên máy nào (theo đồng bộ)'))));
    }
    if (list.length > 1500) box.append(el('div', { class: 'map-hint' }, `…còn ${list.length - 1500} người — gõ tìm để thu gọn.`));
  };
  searchI.oninput = render; onlyLocked.onchange = render;
  selAll.onchange = () => {
    const q = searchI.value.trim().toLowerCase();
    for (const u of rows) if ((!onlyLocked.checked || u.active === false) && (!q || [u.pin, u.name, u.code, u.department].some((v) => String(v || '').toLowerCase().includes(q))))
      selAll.checked ? picked.add(u.pin) : picked.delete(u.pin);
    render(); upd();
  };
  const result = el('div', { style: 'margin-top:10px' });
  goBtn.onclick = async () => {
    const pins = [...picked];
    if (!pins.length) return;
    const dsel = devPicked();
    if (!dsel.length) return toast('Chọn ít nhất 1 máy', 'err');
    const allDev = dsel.length === devChks.length;
    if (!confirm(`Xóa ${pins.length} nhân viên khỏi ${allDev ? 'TẤT CẢ máy chấm công' : dsel.length + ' máy: ' + dsel.map((x) => x.m.name || x.m.serial).join(', ')}?\n\nVân tay / thẻ / khuôn mặt của họ trên máy sẽ bị xoá. Dữ liệu công trong phần mềm GIỮ NGUYÊN.`)) return;
    goBtn.disabled = true;
    let r;
    try { r = await api('/admin/devices/delete-users-all', { method: 'POST', body: { pins, serials: dsel.map((x) => x.m.serial) } }); }
    catch (e) { goBtn.disabled = false; return toast(e.message, 'err'); }
    result.innerHTML = '';
    devDelSummary(r, result, pins.length);
    // Hỏi KHOÁ luôn những người vừa xoá (đang hoạt động) → không bị đồng bộ lại xuống máy
    const toLock = rows.filter((u) => picked.has(u.pin) && u.active === true);
    if (toLock.length && hasPerm('employees') && confirm(`Khoá luôn ${toLock.length} nhân viên vừa xoá?\n\nKhoá = cho nghỉ việc: phần mềm sẽ KHÔNG đồng bộ lại họ xuống máy nữa, lịch sử công vẫn giữ (mở khoá lại được).\n\n${toLock.slice(0, 15).map((u) => '• ' + u.pin + ' · ' + (u.name || '')).join('\n')}${toLock.length > 15 ? `\n… và ${toLock.length - 15} người nữa` : ''}`)) {
      try {
        const k = await api('/admin/employees/lock-by-pins', { method: 'POST', body: { pins: toLock.map((u) => u.pin) } });
        result.append(el('div', { class: 'map-hint', style: 'margin:0 0 6px' }, `🔒 Đã khoá ${k.locked} nhân viên.` + (k.self ? ' (Không khoá tài khoản bạn đang đăng nhập.)' : '')));
      } catch (e) { toast(e.message, 'err'); }
    } else if (toLock.length) result.append(el('div', { class: 'dv-warn' }, `${toLock.length} người chưa khoá: nếu còn trên máy khác ngoài danh sách (VD máy đang tạm dừng) thì có thể bị đồng bộ lại. Muốn chắc chắn thì Khoá họ ở trang Nhân viên.`));
    toast(allDev ? 'Đã gửi lệnh xoá trên tất cả máy' : `Đã gửi lệnh xoá trên ${dsel.length} máy đã chọn`, 'ok');
    picked.clear(); upd();
    try { rows = (await api('/admin/devices/all-users')).rows; } catch {}
    render();
    await devDelWatchJob(r, result);
  };
  upd();
  openModal('Xóa nhân viên trên máy chấm công', [
    el('div', { class: 'map-hint', style: 'margin:0 0 8px' }, 'Dùng khi nhân viên nghỉ việc: chọn máy + chọn người rồi bấm Xóa — phần mềm xoá họ trên các máy đã chọn 1 lần, khỏi vào từng máy. Sau đó phần mềm hỏi có Khoá luôn không: Khoá rồi thì không bị đồng bộ lại xuống máy.'),
    el('div', { style: 'padding:8px 10px;border:1px solid var(--line,#e5e5e5);border-radius:8px;margin-bottom:10px' },
      el('div', { style: 'font-weight:600;color:var(--ink)' }, 'Xoá trên máy (máy mất kết nối mặc định không tích)'), devBox),
    el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, searchI,
      el('label', { style: 'display:flex;align-items:center;gap:6px;font-weight:500;color:var(--ink)' }, onlyLocked, 'Chỉ NV đã khoá')),
    el('div', { style: 'display:flex;gap:10px;align-items:center;margin-top:8px' },
      el('label', { style: 'display:flex;align-items:center;gap:6px;font-weight:600;color:var(--ink)' }, selAll, 'Chọn tất cả (theo lọc)'), cntLbl),
    box, result,
  ], [goBtn, el('button', { class: 'btn ghost', onclick: () => { closeModal(); after && after(); } }, 'Đóng')]);
  api('/admin/devices').then((d) => renderDevs((d.rows || []).filter((m) => m.active))).catch((e) => { devBox.innerHTML = ''; devBox.append(el('div', { class: 'dv-warn' }, e.message)); });
  try { rows = (await api('/admin/devices/all-users')).rows; } catch (e) { box.innerHTML = ''; box.append(el('div', { class: 'dv-warn' }, e.message)); return; }
  render();
}
// Tải ngay tất cả máy TCP/IP (kind 'tcp') / Hikvision (kind 'hik') đang bật tự tải (1 lượt, tuần tự từng máy)
async function tcpAutoRun(kind = 'tcp') {
  const msg = el('div', { style: 'font-size:15px;font-weight:600' }, '⏳ Đang bắt đầu…');
  const out = el('div', { style: 'margin-top:12px' });
  const closeB = el('button', { class: 'btn', disabled: '' }, 'Đóng');
  closeB.onclick = () => { closeModal(); pageDevices(); };
  openModal(kind === 'hik' ? 'Tải ngay tất cả máy Hikvision' : 'Tải ngay tất cả máy TCP/IP', [msg, out], [closeB]);
  const fail = (t) => { msg.textContent = '❌ ' + t; msg.style.color = '#c0392b'; closeB.disabled = false; };
  let job; try { job = (await api(`/admin/${kind}-devices/auto/run`, { method: 'POST' })).job; } catch (e) { return fail(e.message); }
  for (;;) {
    await new Promise((ok) => setTimeout(ok, 1000));
    let j; try { j = await api('/admin/devices/tcp-jobs/' + job); } catch (e) { return fail(e.message); }
    if (j.state === 'run') { msg.textContent = '⏳ ' + j.msg; continue; }
    if (j.state === 'err') return fail(j.msg);
    const list = (j.result && j.result.devices) || [];
    msg.textContent = list.length ? '✅ Đã chạy xong' : 'Không có máy nào đang bật tự động tải'; msg.style.color = list.length ? '#15803d' : '';
    for (const x of list) out.append(el('div', { style: 'display:flex;justify-content:space-between;gap:16px;padding:6px 0;border-bottom:1px dashed var(--line,#eee)' }, el('b', {}, x.device), el('span', {}, x.msg)));
    closeB.disabled = false; return;
  }
}

