/* ---------- 7) CÀI ĐẶT ---------- */
/* ---------- Sao lưu / phục hồi (tải & nạp file nhị phân) ---------- */
// CHUYỂN PHẦN MỀM SANG MÁY TÍNH KHÁC (server/chuyen-may.js): đóng 1 file → tải về → tắt máy cũ.
// Máy mới: bộ cài Setup.exe › "Chuyển từ máy cũ" › chọn file → tự nhận dữ liệu + tự chuyển bản quyền (giữ hạn + số NV).
function moveBox() {
  const box = el('div', { style: 'margin-top:18px;padding:14px 16px;border:1px solid #f0dcb4;background:#fffaf0;border-radius:12px' });
  const line = (...k) => el('div', { style: 'font-size:14px;line-height:1.7' }, ...k);
  const setupHint = 'Trên máy mới: tải bộ cài ở huongdan.maychamcongcloud.com/tai-bo-cai → chạy → chọn "Chuyển từ máy cũ" → chọn file chuyển máy. Phần mềm tự nhận dữ liệu và bản quyền (máy mới cần Internet).';
  let timer = null;
  const render = async () => {
    clearTimeout(timer);
    let d;
    try { d = await api('/admin/backup/chuyen-may'); } catch { box.remove(); return; }
    if (!box.isConnected && box.dataset.shown) return;   // đã rời trang
    box.dataset.shown = '1';
    box.innerHTML = '';
    box.append(el('div', { style: 'font-weight:700;margin-bottom:6px' }, '🚚 Chuyển phần mềm sang máy tính khác'));
    if (!d.available) { box.append(el('div', { class: 'map-hint' }, d.reason)); return; }
    if (d.busy) {
      box.append(el('div', { class: 'pill warn', style: 'display:inline-block' }, '⏳ Đang đóng file chuyển máy (nhiều ảnh có thể mất vài phút)…'));
      timer = setTimeout(render, 3000);
      return;
    }
    if (!d.pending) {
      const go = el('button', { class: 'btn' }, '🚚 Chuyển sang máy khác');
      box.append(el('div', { class: 'map-hint', style: 'margin-bottom:10px' },
        'Đổi máy tính chạy phần mềm: bấm nút dưới → tải 1 file về → chép sang máy mới → chạy bộ cài trên máy mới, chọn "Chuyển từ máy cũ". ' +
        'Dữ liệu, ảnh chấm công, cài đặt, tên miền chuyển theo; bản quyền tự chuyển sang máy mới, giữ nguyên hạn dùng + số nhân viên.'));
      if (d.error) box.append(el('div', { class: 'pill bad', style: 'display:inline-block;margin-bottom:10px' }, d.error));
      box.append(go);
      go.onclick = async () => {
        if (!confirm('Chuyển phần mềm sang máy tính khác?\n\n• Từ bây giờ tới lúc tắt máy này, phần mềm TẠM KHÔNG NHẬN lượt chấm mới: máy chấm công tự giữ lại và gửi sang máy mới; điện thoại tạm chưa chấm được.\n• Tải file xong thì bấm "Tắt phần mềm trên máy này".\n\nTiếp tục?')) return;
        go.disabled = true; go.textContent = 'Đang bắt đầu…';
        try { await api('/admin/backup/chuyen-may/tao', { method: 'POST' }); } catch (e) { toast(e.message, 'err'); }
        render();
      };
      return;
    }
    const p = d.pending;
    const dl = el('a', { class: 'btn', href: '/api/chuyen-may/tai?k=' + encodeURIComponent(p.token), download: p.name }, `⬇ Tải file chuyển máy (${fmtSize(p.size)})`);
    const off = el('button', { class: 'btn', style: 'background:#c0392b' }, '⏻ Đã có file — tắt phần mềm trên máy này');
    const cancel = el('button', { class: 'btn ghost' }, 'Huỷ, dùng tiếp máy này');
    box.append(
      el('div', { class: 'pill warn', style: 'display:inline-block;margin-bottom:8px' }, 'Đang chuyển máy — tạm không nhận lượt chấm mới'),
      line('1. Tải file về. Hoặc lấy thẳng trên máy tính đang chạy phần mềm: ', el('b', { style: 'font-family:monospace;word-break:break-all' }, p.path)),
      line('2. Chép file sang máy mới (USB, Zalo, mạng nội bộ…).'),
      line('3. Bấm "Tắt phần mềm trên máy này" — phần mềm + tên miền trên máy này tắt hẳn, không tự bật lại.'),
      line('4. ' + setupHint),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px' }, dl, off, cancel));
    if (!d.domain) box.append(el('div', { class: 'map-hint', style: 'margin-top:8px' }, 'Bản LAN: máy chấm công đang gửi về địa chỉ IP của máy này — đặt máy mới đúng IP này, hoặc sửa địa chỉ máy chủ trên máy chấm công sang IP máy mới.'));
    off.onclick = async () => {
      if (!confirm('Đã lấy được file chuyển máy chưa?\n\nPhần mềm và tên miền trên máy này sẽ TẮT HẲN, không tự bật lại.')) return;
      off.disabled = true; cancel.disabled = true;
      try {
        await api('/admin/backup/chuyen-may/tat', { method: 'POST' });
        box.innerHTML = '';
        box.append(el('div', { style: 'font-weight:700;color:#1e7e34;margin-bottom:6px' }, '✅ Đã tắt phần mềm trên máy này.'),
          line('File chuyển máy: ', el('b', {}, p.name)), line(setupHint));
      } catch (e) { toast(e.message, 'err'); off.disabled = false; cancel.disabled = false; }
    };
    cancel.onclick = async () => {
      if (!confirm('Huỷ chuyển máy, dùng tiếp máy này?')) return;
      try { await api('/admin/backup/chuyen-may/huy', { method: 'POST' }); toast('Đã huỷ — phần mềm nhận dữ liệu lại như thường', 'ok'); } catch (e) { toast(e.message, 'err'); }
      render();
    };
  };
  render();
  return box;
}
async function downloadBackup(name) {
  try {
    const res = await fetch('/api/admin/backup/download?name=' + encodeURIComponent(name), { headers: { Authorization: 'Bearer ' + getToken() } });
    if (!res.ok) { toast('Lỗi tải bản sao lưu', 'err'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (e) { toast(e.message, 'err'); }
}
async function restoreBackup(file) {
  const buf = await file.arrayBuffer();
  const res = await fetch('/api/admin/backup/restore', { method: 'POST', headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'application/octet-stream' }, body: buf });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { toast(j.error || 'Lỗi phục hồi', 'err'); return; }
  if (j.applied) { alert('✅ Đã phục hồi dữ liệu. Trang sẽ tải lại.'); location.reload(); return; }   // máy chủ Digiplus: áp ngay
  alert('✅ Đã nạp bản sao lưu.\n\nBây giờ hãy KHỞI ĐỘNG LẠI MÁY TÍNH để hoàn tất phục hồi dữ liệu.');
}
async function restoreFullBackup(file) {
  const buf = await file.arrayBuffer();
  const res = await fetch('/api/admin/backup/full-restore', { method: 'POST', headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'application/octet-stream' }, body: buf });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { toast(j.error || 'Lỗi phục hồi', 'err'); return; }
  if (j.applied) { alert('✅ Đã phục hồi TOÀN BỘ (dữ liệu + ảnh + logo). Trang sẽ tải lại.'); location.reload(); return; }
  alert('✅ Đã nạp bản sao lưu TOÀN BỘ (dữ liệu + ảnh + logo).\n\nBây giờ hãy KHỞI ĐỘNG LẠI MÁY TÍNH để hoàn tất.');
}
const fmtSize = (b) => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

/* ---------- Thông báo đẩy (Web Push) cho quản lý ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
function urlB64ToU8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s); const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
async function pushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try { const reg = await navigator.serviceWorker.ready; return (await reg.pushManager.getSubscription()) ? 'on' : 'off'; } catch { return 'off'; }
}
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Trình duyệt này không hỗ trợ thông báo đẩy.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Bạn chưa cho phép hiện thông báo (kiểm tra quyền của trình duyệt).');
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api('/admin/push/vapid');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToU8(publicKey) });
  await api('/admin/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
}
async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) { try { await api('/admin/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }); } catch {} try { await sub.unsubscribe(); } catch {} }
}
// Đảm bảo server có đăng ký của trình duyệt này (đồng bộ lại, không hỏi quyền)
async function ensureSubscribed() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await api('/admin/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
    return !!sub;
  } catch { return false; }
}

/* ---------- Cài app vào máy (PWA install) ---------- */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

// CẤU HÌNH HIỂN THỊ — mỗi khách 1 bản cài, tài khoản tổng bật đúng phân hệ khách dùng:
//   🕐 Chấm công (mặc định bật) · 🍱 Suất ăn (+ 3 công tắc cách đăng ký, mặc định bật = như cũ) · 📇 Nhân sự
// Người khác (admin công ty) chỉ xem đang bật gì.
function displayPanel(s) {
  if (!hasPerm('settings') && !isMaster()) return null;
  const on = { att: s.att_enabled !== '0', meal: s.meal_enabled === '1', hr: s.hr_enabled === '1', self: s.meal_self_order !== '0', dish: s.meal_dish_choice !== '0', head: s.meal_dept_head !== '0', inv: s.meal_ingredient === '1', pay: s.pay_pro === '1', mach: s.meal_machine_signup === '1' };
  // mach = báo cơm bằng quẹt máy chấm công (chỉ ở chế độ không chọn món)
  const mealWay = (o) => {
    const mach = o.mach && !o.dish;
    const self = o.self ? (o.dish ? 'NV tự chọn món trên app' : mach ? 'NV bấm Có ăn trên app hoặc quẹt máy chấm công trong giờ đăng ký' : 'NV tự bấm Có ăn / Không ăn trên app (không chọn món)')
      : mach ? 'NV quẹt máy chấm công trong giờ đăng ký để báo ăn' : null;
    return !self && !o.head ? 'HR tự nhập (không có ai đăng ký trên app)' : [self, o.head ? 'trưởng bộ phận báo số' : null].filter(Boolean).join(' + ');
  };
  const box = el('div', { class: 'panel', style: 'padding:20px;max-width:600px;margin-bottom:16px' }, el('h3', { style: 'margin-top:0' }, 'Cấu hình hiển thị'));
  if (!isMaster()) {
    const st = (b) => el('b', { style: `color:${b ? 'var(--ok,#16a34a)' : 'var(--muted)'}` }, b ? 'BẬT' : 'TẮT');
    box.append(el('div', { style: 'display:flex;flex-direction:column;gap:8px;font-size:14px' },
      el('div', {}, '🕐 Chấm công: ', st(on.att)),
      el('div', {}, '🍱 Suất ăn: ', st(on.meal), on.meal ? el('span', { style: 'color:var(--muted)' }, ' — ' + mealWay(on)) : null),
      on.meal ? el('div', { style: 'margin-left:22px' }, '🥕 Định lượng nguyên liệu & kho bếp: ', st(on.inv)) : null,
      el('div', {}, '📇 Nhân sự: ', st(on.hr)),
      el('div', {}, '💰 Tiền lương nâng cao: ', st(on.pay)),
      el('div', { class: 'map-hint' }, '🔒 Chỉ tài khoản tổng bật / tắt được các phân hệ này.')));
    return box;
  }
  const cb = (v) => el('input', { type: 'checkbox', style: 'width:auto;transform:scale(1.15)', ...(v ? { checked: '' } : {}) });
  const c = { att: cb(on.att), meal: cb(on.meal), hr: cb(on.hr), self: cb(on.self), dish: cb(on.dish), head: cb(on.head), inv: cb(on.inv), pay: cb(on.pay) };
  // Cách NV báo ăn khi KHÔNG chọn món: chỉ app · chỉ quẹt máy · cả hai · không (trưởng BP / HR báo) = 2 công tắc meal_self_order + meal_machine_signup
  const how = el('select', { style: 'width:auto;max-width:100%' },
    el('option', { value: 'app' }, '📱 Chỉ trên app (bấm Có ăn / Không ăn)'), el('option', { value: 'may' }, '🖐️ Chỉ quẹt máy chấm công'),
    el('option', { value: 'both' }, '📱 + 🖐️ Cả app lẫn quẹt máy'), el('option', { value: 'none' }, '— Không (trưởng bộ phận / HR báo giúp)'));
  how.value = on.self ? (on.mach ? 'both' : 'app') : on.mach ? 'may' : 'none';
  const howRow = el('div', { style: 'display:flex;flex-direction:column;gap:4px;font-size:13px' }, el('b', {}, '🙋 Nhân viên báo ăn bằng'), how,
    el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Quẹt máy = quẹt vân tay / khuôn mặt / thẻ trong giờ mở đăng ký của bữa (giờ mở → giờ khoá ở Cấu hình suất ăn) là đã báo ăn bữa đó; huỷ thì bấm Không ăn trên app hoặc báo HR. Chọn máy dùng để báo cơm ở Cấu hình suất ăn.'));
  const row = (chk, title, desc, sub = false) => el('label', { style: `display:flex;gap:10px;align-items:flex-start;cursor:pointer${sub ? '' : ';padding:10px;border:1px solid var(--line,#eee);border-radius:10px'}` },
    chk, el('div', {}, el('b', {}, title), el('div', { style: 'font-size:13px;color:var(--muted)' }, desc)));
  const way = el('div', { class: 'map-hint', style: 'margin-top:2px' });
  const selfRow = row(c.self, '📱 Nhân viên tự đăng ký trên app', 'Tắt: nhân viên thường không thấy tab Suất ăn; số suất do trưởng bộ phận báo / HR nhập.', true);
  const sub = el('div', { style: 'margin:-4px 0 0 26px;padding:10px 12px;border-left:3px solid var(--line,#e5e7eb);display:flex;flex-direction:column;gap:9px' },
    el('div', { style: 'font-size:13px;font-weight:700' }, 'Cách đăng ký suất ăn (mặc định bật cả 3 = như cũ):'),
    row(c.dish, '🍽️ Có chọn món', 'Bật: HR nhập thực đơn, nhân viên chọn món từng bữa, màn hình bếp hiện món. Tắt: KHÔNG có thực đơn — nhân viên chỉ bấm "Có ăn / Không ăn"; menu Suất ăn có trang "Đăng ký ăn".', true),
    selfRow, howRow,
    row(c.head, '📋 Trưởng bộ phận báo số', 'Bật: trưởng bộ phận nhập số suất của bộ phận, HR đối chiếu & chốt (trang Đối chiếu & chốt). Tắt: ẩn phần này.', true),
    way,
    el('div', { style: 'font-size:13px;font-weight:700;margin-top:4px' }, 'Thêm (mặc định tắt):'),
    row(c.inv, '🥕 Định lượng nguyên liệu & kho bếp', 'Danh mục nguyên liệu, định lượng 1 suất cho từng món, tính nguyên liệu cần nấu theo số suất, nhập / xuất / kiểm kê kho, cảnh báo sắp hết, báo cáo chi phí nguyên liệu mỗi suất. Tắt: menu ẩn, dữ liệu kho giữ nguyên.', true));
  const sync = () => {
    sub.style.opacity = c.meal.checked ? '' : '.45';
    for (const k of ['self', 'dish', 'head', 'inv']) c[k].disabled = !c.meal.checked;
    how.disabled = !c.meal.checked;
    // không chọn món → ô chọn "báo ăn bằng" thay cho công tắc tự đăng ký trên app
    selfRow.style.display = c.dish.checked ? 'flex' : 'none'; howRow.style.display = c.dish.checked ? 'none' : 'flex';
    if (!c.dish.checked) c.self.checked = how.value === 'app' || how.value === 'both';
    way.textContent = '→ ' + mealWay({ self: c.self.checked, dish: c.dish.checked, head: c.head.checked, mach: !c.dish.checked && (how.value === 'may' || how.value === 'both') });
  };
  for (const k of ['meal', 'self', 'dish', 'head']) c[k].addEventListener('change', sync);
  how.addEventListener('change', sync);
  sync();
  const save = el('button', { class: 'btn' }, 'Lưu cấu hình hiển thị');
  save.onclick = async () => {
    if (!c.att.checked && !c.meal.checked && !c.hr.checked) return toast('Phải bật ít nhất 1 phân hệ (Chấm công / Suất ăn / Nhân sự)', 'err');
    try {
      await api('/admin/settings', { method: 'PUT', body: { att_enabled: c.att.checked, meal_enabled: c.meal.checked, hr_enabled: c.hr.checked,
        meal_self_order: c.self.checked, meal_dish_choice: c.dish.checked, meal_dept_head: c.head.checked, meal_ingredient: c.inv.checked, pay_pro: c.pay.checked,
        ...(c.dish.checked ? {} : { meal_machine_signup: how.value === 'may' || how.value === 'both' }) } });
      toast('Đã lưu. Đang tải lại…', 'ok'); setTimeout(() => location.reload(), 700);
    } catch (e) { toast(e.message, 'err'); }
  };
  box.append(el('div', { class: 'map-hint', style: 'margin-bottom:10px' }, 'Bật phân hệ nào thì menu + app nhân viên hiện phân hệ đó. Tắt chỉ ẩn đi — dữ liệu đã nhập vẫn giữ nguyên, bật lại là thấy. 🔒 Chỉ tài khoản tổng thấy khung này.'),
    el('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      row(c.att, '🕐 Chấm công', 'Ca, phân ca, tính công, đơn từ, lương, báo cáo, công ảo; app nhân viên có Chấm công / Bảng công / Báo cáo / Đơn từ. Tắt khi khách chỉ dùng suất ăn — máy chấm công vẫn nhận lượt quẹt để đếm suất ăn.'),
      row(c.meal, '🍱 Suất ăn', 'Đếm suất ăn theo máy chấm ăn, đăng ký ăn / chọn món trên app, màn hình bếp, nhiều bếp, báo cáo suất ăn. Quản lý cần được tích quyền "Quản lý suất ăn".'),
      sub,
      row(c.hr, '📇 Nhân sự', 'Hồ sơ nhân sự, hợp đồng lao động, thuyên chuyển / nghỉ việc, mẫu giấy tờ. Quản lý cần được tích quyền "Nhân sự".'),
      row(c.pay, '💰 Tiền lương nâng cao (kiểu AMIS)', 'Mặc định TẮT. Bật: trang Lương có bảo hiểm (BHXH/BHYT/BHTN), thuế TNCN, thành phần lương (phụ cấp, thưởng, khấu trừ, công thức), dữ liệu theo kỳ, tạm ứng, mẫu bảng lương, bảng lương chốt / duyệt / khoá, file chuyển khoản, báo cáo + quyết toán thuế, phiếu lương trên app. Tắt: trang Lương y như cũ (dữ liệu lương nâng cao giữ nguyên). Chỉ hiện khi bật Chấm công.'),
      el('div', {}, save)));
  return box;
}

// CHẾ ĐỘ TÍNH CÔNG (gói cài đặt) — tài khoản tổng chọn 1 gói = bật cả bộ công tắc có sẵn cho kiểu khách đó, xem trước từng ô, trả về được.
// Admin công ty chỉ thấy dòng "Đang dùng: …" khi công ty đã áp gói; chưa áp gói → không hiện gì (như cũ).
function profilePanel(s) {
  if (!isMaster()) {
    if (!s.profile || !hasPerm('settings')) return null;
    return el('div', { class: 'panel', style: 'padding:14px 20px;max-width:600px;margin-bottom:16px' },
      el('b', {}, '🧩 Chế độ tính công: '), s.profile_name || s.profile,
      el('div', { class: 'map-hint', style: 'margin-top:4px' }, '🔒 Chỉ tài khoản tổng đổi được chế độ tính công.'));
  }
  // nội dung nạp sau vào `body` (giữ nguyên h3 của khung — trang Cài đặt dời h3 vào thanh thu gọn)
  const body = el('div', {}, loading());
  const box = el('div', { class: 'panel', style: 'padding:20px;max-width:600px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, '🧩 Chế độ tính công (gói cài đặt)'), body);
  const yesNo = (v) => (v === '1' ? 'Bật' : 'Tắt');
  const draw = (d) => {
    body.replaceChildren();
    const cur = d.list.find((p) => p.id === d.active);
    body.append(el('div', { class: 'map-hint', style: 'margin-bottom:10px' },
      'Bấm 1 lần là bật cả bộ công tắc tính công cho kiểu khách đó (thay vì tích từng ô). Gói chỉ đổi các ô có sẵn ở Quy tắc tính công — không thêm cách tính mới. Chưa áp gói nào thì mọi thứ như cũ. 🔒 Chỉ tài khoản tổng thấy mục này.'));
    body.append(el('div', { style: 'margin-bottom:10px;font-size:14px' }, 'Đang dùng: ', cur ? el('b', { style: 'color:var(--ok,#16a34a)' }, cur.name) : el('b', { style: 'color:var(--muted)' }, 'Chung (chưa áp gói nào)')));
    const sel = el('select', { style: 'width:auto;max-width:100%' }, ...d.list.map((p) => el('option', { value: p.id }, p.name)));
    if (cur) sel.value = cur.id;
    const detail = el('div', { style: 'display:flex;flex-direction:column;gap:8px;margin:10px 0' });
    const applyBtn = el('button', { class: 'btn' }, 'Áp dụng gói');
    const showDetail = () => {
      const p = d.list.find((x) => x.id === sel.value);
      const rows = p.preview.map((c) => el('tr', {},
        el('td', { style: 'padding:4px 6px' }, c.label),
        el('td', { style: 'padding:4px 6px;white-space:nowrap;text-align:center' }, yesNo(c.from), ' → ', el('b', { style: c.change ? 'color:#b45309' : '' }, yesNo(c.to)))));
      const nChange = p.preview.filter((c) => c.change).length;
      detail.replaceChildren(
        el('div', { style: 'font-size:13px;color:var(--muted)' }, p.desc),
        el('table', { style: 'width:100%;border-collapse:collapse;font-size:13px' },
          el('tr', {}, el('th', { style: 'text-align:left;padding:4px 6px' }, 'Ô cài đặt'), el('th', { style: 'padding:4px 6px' }, 'Đang → Sẽ thành')), ...rows),
        el('div', { style: 'font-size:13px' }, el('b', {}, 'Làm tay thêm sau khi áp:'), el('ul', { style: 'margin:4px 0 0 18px;padding:0' }, ...p.manual.map((m) => el('li', {}, m)))),
        p.reports?.length ? el('div', { class: 'map-hint' }, 'Báo cáo hay dùng của gói được ghim lên đầu trang Báo cáo.') : null);
      applyBtn.disabled = p.id === d.active && !nChange;
      applyBtn.textContent = p.id === d.active ? (nChange ? `Áp lại gói (${nChange} ô đã bị đổi tay)` : 'Đang dùng gói này') : `Áp dụng gói (đổi ${nChange} ô)`;
    };
    sel.addEventListener('change', showDetail);
    applyBtn.onclick = async () => {
      const p = d.list.find((x) => x.id === sel.value);
      if (!confirm(`Áp gói "${p.name}" cho công ty này?

Các ô cài đặt ở bảng sẽ được đổi. Bấm "Trả về như trước" để khôi phục.`)) return;
      try {
        await api('/admin/settings/profile', { method: 'POST', body: { id: p.id } });
        toast('Đã áp gói. Bấm "↻ Tính lại công tất cả" để áp cho dữ liệu cũ. Đang tải lại…', 'ok'); setTimeout(() => location.reload(), 900);
      } catch (e) { toast(e.message, 'err'); }
    };
    const revertBtn = cur ? el('button', { class: 'btn ghost' }, '↩ Trả về như trước') : null;
    if (revertBtn) revertBtn.onclick = async () => {
      if (!confirm('Trả các ô cài đặt về đúng như trước khi áp gói?')) return;
      try {
        await api('/admin/settings/profile', { method: 'DELETE' });
        toast('Đã trả về như trước. Bấm "↻ Tính lại công tất cả" nếu cần. Đang tải lại…', 'ok'); setTimeout(() => location.reload(), 900);
      } catch (e) { toast(e.message, 'err'); }
    };
    body.append(el('div', {}, el('label', {}, 'Gói'), sel), detail, el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, applyBtn, revertBtn));
    showDetail();
  };
  api('/admin/settings/profiles').then(draw).catch((e) => body.replaceChildren(el('div', { class: 'map-hint' }, e.message)));
  return box;
}

async function pageSettings() {
  if (!DEPARTMENTS.length) { try { await loadRefs(); } catch {} }   // cần danh sách phòng ban cho mục đặt kiểu chấm công riêng
  setMain(head('Cài đặt'), loading());
  const s = await api('/admin/settings');
  const nameI = input('st-name', { value: s.company_name });
  const addrI = input('st-addr', { value: s.company_address || '', placeholder: 'Địa chỉ công ty (hiện trên đầu báo cáo)' });
  const saveName = el('button', { class: 'btn' }, 'Lưu tên & địa chỉ');
  saveName.onclick = async () => { try { await api('/admin/settings', { method: 'PUT', body: { company_name: nameI.value, company_address: addrI.value } }); toast('Đã lưu', 'ok'); applyBrand(); } catch (e) { toast(e.message, 'err'); } };

  // Logo công ty
  const logoImg = el('img', { src: s.company_logo || '/icons/logo.png', alt: 'logo', style: 'height:56px;max-width:220px;object-fit:contain;background:#fff;border:1px solid var(--line,#eee);border-radius:10px;padding:6px' });
  const logoFile = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml', style: 'font-size:13px' });
  const upLogo = el('button', { class: 'btn sm' }, 'Tải logo lên');
  const rmLogo = el('button', { class: 'btn sm ghost' }, 'Dùng logo mặc định');
  upLogo.onclick = async () => {
    const f = logoFile.files?.[0];
    if (!f) return toast('Chọn file ảnh logo (PNG/JPG/WebP/SVG)', 'err');
    if (f.size > 2 * 1024 * 1024) return toast('Logo tối đa 2MB', 'err');
    upLogo.disabled = true;
    try {
      const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
      const r = await api('/admin/branding', { method: 'POST', body: { logo: dataUrl } });
      logoImg.src = r.logo; toast('Đã cập nhật logo', 'ok'); applyBrand();
    } catch (e) { toast(e.message, 'err'); }
    finally { upLogo.disabled = false; }
  };
  rmLogo.onclick = async () => {
    if (!confirm('Xoá logo, dùng lại logo mặc định?')) return;
    try { await api('/admin/branding', { method: 'POST', body: { remove: true } }); logoImg.src = '/icons/logo.png'; toast('Đã xoá logo', 'ok'); applyBrand(); }
    catch (e) { toast(e.message, 'err'); }
  };

  const oldP = input('st-old', { type: 'password' });
  const newP = input('st-new', { type: 'password' });
  const savePw = el('button', { class: 'btn' }, 'Đổi mật khẩu');
  savePw.onclick = async () => {
    try { const r = await api('/auth/change-password', { method: 'POST', body: { oldPassword: oldP.value, newPassword: newP.value } }); if (r && r.token) setToken(r.token, rememberLogin());   // đổi mật khẩu → phiên cũ hết hiệu lực, dùng phiên mới máy chủ vừa cấp
      toast('Đã đổi mật khẩu — các máy khác đang đăng nhập tài khoản này phải đăng nhập lại', 'ok'); oldP.value = newP.value = ''; }
    catch (e) { toast(e.message, 'err'); }
  };

  const panel1 = el('div', { class: 'panel', style: 'padding:20px;max-width:520px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, 'Thông tin công ty'),
    hasPerm('settings') ? el('div', { style: 'display:flex;flex-direction:column;gap:14px' },
      field('Tên công ty (hiển thị trên app)', nameI),
      field('Địa chỉ công ty (hiện trên đầu báo cáo)', addrI), saveName,
      el('hr', { style: 'border:none;border-top:1px solid var(--line,#eee);margin:2px 0' }),
      el('div', {},
        el('label', {}, 'Logo công ty (hiện ở màn đăng nhập & app nhân viên)'),
        el('div', { style: 'display:flex;align-items:center;gap:14px;margin-top:8px;flex-wrap:wrap' },
          logoImg,
          el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, logoFile, el('div', { style: 'display:flex;gap:8px' }, upLogo, rmLogo)))),
      el('div', { class: 'map-hint' }, 'PNG / JPG / WebP / SVG, tối đa 2MB. Đổi xong tải lại trang (F5) để thấy ở màn đăng nhập.'))
      : el('p', { style: 'color:var(--muted)' }, 'Bạn không có quyền sửa mục này.'));

  // ----- Kiểu chấm công + Phạm vi chấm công -----
  const modeShift = el('input', { type: 'radio', name: 'att-mode', value: 'shift', style: 'width:auto', ...(s.attendance_mode !== 'hourly' ? { checked: '' } : {}) });
  const modeHourly = el('input', { type: 'radio', name: 'att-mode', value: 'hourly', style: 'width:auto', ...(s.attendance_mode === 'hourly' ? { checked: '' } : {}) });
  const stRule = hourlyRulePicker('att-hrule', s.hourly_merge_rule, modeHourly, [modeShift, modeHourly], s.hourly_overnight, !!s.any_hourly);
  const geoChk = el('input', { type: 'checkbox', id: 'st-geo', style: 'width:auto', ...(s.geofence_enforce === '1' ? { checked: '' } : {}) });
  const devChk = el('input', { type: 'checkbox', id: 'st-dev', style: 'width:auto', ...(s.device_enabled === '1' ? { checked: '' } : {}) });
  const phoneChk = el('input', { type: 'checkbox', id: 'st-phone', style: 'width:auto', ...(s.phone_enabled !== '0' ? { checked: '' } : {}) });
  const tcpDevChk = el('input', { type: 'checkbox', id: 'st-tcpdev', style: 'width:auto', ...(s.tcp_device_enabled === '1' ? { checked: '' } : {}) });
  const aiDevChk = el('input', { type: 'checkbox', id: 'st-aidev', style: 'width:auto', ...(s.ai_device_enabled === '1' ? { checked: '' } : {}) });
  const hikDevChk = el('input', { type: 'checkbox', id: 'st-hikdev', style: 'width:auto', ...(s.hik_device_enabled === '1' ? { checked: '' } : {}) });
  const unionDevChk = el('input', { type: 'checkbox', id: 'st-uniondev', style: 'width:auto', ...(s.union_device_enabled === '1' ? { checked: '' } : {}) });
  const auditChk = el('input', { type: 'checkbox', id: 'st-audit', style: 'width:auto', ...(s.audit_enabled === '1' ? { checked: '' } : {}) });
  const inclAdminChk = el('input', { type: 'checkbox', id: 'st-incladmin', style: 'width:auto', ...(s.payroll_include_admin === '1' ? { checked: '' } : {}) });
  const lockChk = el('input', { type: 'checkbox', id: 'st-lock', style: 'width:auto', ...(s.device_lock_enabled === '1' ? { checked: '' } : {}) });
  const selfChk = el('input', { type: 'checkbox', id: 'st-self', style: 'width:auto', ...(s.self_shift_enabled === '1' ? { checked: '' } : {}) });
  const apprChk = el('input', { type: 'checkbox', id: 'st-appr', style: 'width:auto', ...(s.self_shift_approve !== '0' ? { checked: '' } : {}) });
  const dedupI = el('input', { type: 'number', min: '0', style: 'width:70px', value: s.punch_dedup_min ?? '15' });
  const saveMode = el('button', { class: 'btn' }, 'Lưu cấu hình chấm công');
  saveMode.onclick = async () => {
    const attendance_mode = document.querySelector('input[name=att-mode]:checked')?.value === 'hourly' ? 'hourly' : 'shift';
    const hourly_merge_rule = stRule.value();
    try {
      const body = { attendance_mode, hourly_merge_rule, hourly_overnight: stRule.overnight(), geofence_enforce: geoChk.checked, device_lock_enabled: lockChk.checked, payroll_include_admin: inclAdminChk.checked, self_shift_enabled: selfChk.checked, self_shift_approve: apprChk.checked, punch_dedup_min: dedupI.value };
      if (isMaster() || s.device_enabled === '1') {   // máy TCP/IP + máy Union: admin cũng bật được (khi đã dùng máy chấm công)
        body.tcp_device_enabled = tcpDevChk.checked;
        body.union_device_enabled = unionDevChk.checked;
      }
      if (isMaster()) {   // chỉ tài khoản tổng đổi được máy chấm công / chấm điện thoại
        body.device_enabled = devChk.checked;
        body.ai_device_enabled = aiDevChk.checked;
        body.hik_device_enabled = hikDevChk.checked;
        body.phone_enabled = phoneChk.checked;
        body.audit_enabled = auditChk.checked;
      }
      await api('/admin/settings', { method: 'PUT', body });
      toast('Đã lưu. Đang tải lại…', 'ok'); setTimeout(() => location.reload(), 700);
    } catch (e) { toast(e.message, 'err'); }
  };
  // Công ty có cả 2 kiểu: đặt kiểu chấm công RIÊNG cho từng phòng ban (hoặc từng người ở hồ sơ nhân viên)
  const mixDept = el('select', { style: 'width:auto;min-width:150px' }, el('option', { value: '*' }, 'Tất cả nhân viên'), ...(DEPARTMENTS || []).map((d) => el('option', { value: d.name }, d.name)));
  const mixMode = el('select', { style: 'width:auto' }, ...['', 'shift', 'hourly'].map((v) => el('option', { value: v }, ATT_MODE_LABEL[v])));
  const mixBtn = btnSm('Áp dụng', async () => {
    const who = mixDept.value === '*' ? 'TẤT CẢ nhân viên' : `phòng "${mixDept.value}"`;
    if (!confirm(`Đặt kiểu chấm công "${ATT_MODE_LABEL[mixMode.value]}" cho ${who}?`)) return;
    try { const r = await api('/admin/employees/att-mode', { method: 'POST', body: { department: mixDept.value, mode: mixMode.value } }); toast(`Đã đặt cho ${r.count} nhân viên. Đang tải lại…`, 'ok'); setTimeout(() => location.reload(), 800); }
    catch (e) { toast(e.message, 'err'); }
  });
  const mixBox = el('div', { style: 'padding:10px;border:1px dashed var(--line,#ddd);border-radius:10px' },
    el('b', {}, 'Công ty vừa có người chấm theo ca, vừa có người chấm theo giờ?'),
    el('div', { style: 'font-size:13px;color:var(--muted);margin:4px 0 8px' }, 'Lựa chọn ở trên là kiểu CHUNG. Nhóm nào khác thì đặt riêng tại đây theo phòng ban, hoặc đặt cho từng người ở Nhân viên → Sửa → "Kiểu chấm công". '
      + (SETTINGS.any_shift && SETTINGS.any_hourly ? 'Hiện công ty đang có CẢ HAI kiểu.' : SETTINGS.any_hourly ? 'Hiện tất cả đang chấm theo giờ.' : 'Hiện tất cả đang chấm theo ca.')),
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, mixDept, mixMode, mixBtn));
  const modeRow = (radio, title, desc) => el('label', { style: 'display:flex;gap:10px;align-items:flex-start;padding:10px;border:1px solid var(--line,#eee);border-radius:10px;cursor:pointer' },
    radio, el('div', {}, el('b', {}, title), el('div', { style: 'font-size:13px;color:var(--muted)' }, desc)));
  // Máy chấm công (ZKTeco) / máy TCP-IP / chấm điện thoại — dùng chung cho khung Kiểu chấm công và khung rút gọn khi TẮT chấm công
  const devRow =
      isMaster()
        ? el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer' }, devChk,
            el('div', {}, el('b', {}, '📟 Dùng máy chấm công (ZKTeco)'),
              el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Nhận dữ liệu vân tay/khuôn mặt/thẻ đẩy về từ máy. Cấu hình & duyệt máy ở menu “Máy chấm công”.'
                + (s.use_device_cfg ? ' (Lúc cài đặt chọn: ' + (s.use_device_cfg === '1' ? 'BẬT' : 'TẮT') + ' — đổi ở đây là được, không cần sửa config.txt.)' : ''))))
        : el('div', { style: 'font-size:13px;color:var(--muted)' }, el('b', { style: 'color:var(--ink)' }, s.device_enabled === '1' ? '📟 Máy chấm công đang BẬT. ' : '📟 Máy chấm công đang TẮT. '), '🔒 Chỉ tài khoản tổng bật/tắt được.');
  const tcpRow =
      isMaster() || s.device_enabled === '1'
        ? el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer;margin-left:26px' }, tcpDevChk,
            el('div', {}, el('b', {}, '🔌 Dùng máy chấm công kết nối TCP/IP (cổng 4370)'),
              el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Cho máy đời cũ không có Cloud Server (ADMS): thêm máy theo địa chỉ IP trong mạng LAN, bấm tải nhân viên / dữ liệu chấm công theo khoảng ngày, xem dung lượng, xóa dữ liệu, xóa quản trị. Cần bật "Dùng máy chấm công" ở trên và phần mềm cài trên máy tính Windows cùng mạng với máy.')))
        : (s.tcp_device_enabled === '1' ? el('div', { style: 'font-size:13px;color:var(--muted);margin-left:26px' }, el('b', { style: 'color:var(--ink)' }, '🔌 Máy kết nối TCP/IP đang BẬT.')) : null);
  const unionRow =
      isMaster() || s.device_enabled === '1'
        ? el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer;margin-left:26px' }, unionDevChk,
            el('div', {}, el('b', {}, '🧬 Dùng máy Union (Virdi)'),
              el('div', { style: 'font-size:13px;color:var(--muted)' }, `Máy Union / Virdi tự kết nối về phần mềm: trên máy đặt Server IP = IP máy tính cài phần mềm, cổng ${s.union_port || 9870} (đổi cổng ở trang Máy chấm công). Nhận lượt chấm ngay khi chấm, tải nhân viên / chấm công, xoá nhân viên trên máy. Cần bật "Dùng máy chấm công" ở trên và phần mềm cài trên máy tính Windows cùng mạng với máy.`)))
        : null;
  // Máy hãng khác: máy AI (tự nối về qua WebSocket) · máy Hikvision (phần mềm gọi ISAPI vào máy)
  const aiRow =
      isMaster()
        ? el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer;margin-left:26px' }, aiDevChk,
            el('div', {}, el('b', {}, '🤖 Dùng máy AI (máy tự kết nối về)'),
              el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Máy khuôn mặt / vân tay dòng "AI": trên máy điền IP / tên miền + cổng của phần mềm, máy tự kết nối về như máy ZKTeco — chạy được cả qua Internet. Cần bật "Dùng máy chấm công" ở trên.')))
        : (s.ai_device_enabled === '1' ? el('div', { style: 'font-size:13px;color:var(--muted);margin-left:26px' }, el('b', { style: 'color:var(--ink)' }, '🤖 Máy AI đang BẬT.')) : null);
  const hikRow =
      isMaster()
        ? el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer;margin-left:26px' }, hikDevChk,
            el('div', {}, el('b', {}, '📷 Dùng máy Hikvision'),
              el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Thêm máy theo IP + tài khoản đăng nhập máy — phần mềm kết nối vào máy để tải nhân viên, tải chấm công (tự tải theo lịch), ghi / xoá nhân viên trên máy. Phần mềm phải cùng mạng LAN với máy (hoặc máy được mở port). Cần bật "Dùng máy chấm công" ở trên.')))
        : (s.hik_device_enabled === '1' ? el('div', { style: 'font-size:13px;color:var(--muted);margin-left:26px' }, el('b', { style: 'color:var(--ink)' }, '📷 Máy Hikvision đang BẬT.')) : null);
  const phoneRow =
      isMaster()
        ? el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer' }, phoneChk,
            el('div', {}, el('b', {}, '📱 Dùng chấm công điện thoại (ảnh + định vị)'),
              el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Tắt nếu công ty chỉ dùng máy chấm công — nhân viên sẽ không thấy nút chấm công trên app điện thoại.'
                + (s.use_phone_cfg ? ' (Lúc cài đặt chọn: ' + (s.use_phone_cfg === '1' ? 'BẬT' : 'TẮT') + ' — đổi ở đây là được.)' : ''))))
        : el('div', { style: 'font-size:13px;color:var(--muted)' }, el('b', { style: 'color:var(--ink)' }, s.phone_enabled !== '0' ? '📱 Chấm điện thoại đang BẬT. ' : '📱 Chấm điện thoại đang TẮT. '), '🔒 Chỉ tài khoản tổng bật/tắt được.');
  const dedupRow =
      el('label', { style: 'display:flex;gap:10px;align-items:center' },
        el('div', {}, el('b', {}, 'Bỏ qua lần chấm trùng trong '), dedupI, el('b', {}, ' phút'),
          el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Lượt quẹt/chấm của cùng một người cách lượt trước dưới số phút này chỉ tính 1 lần (giờ VÀO lấy lượt đầu, giờ RA lấy lượt cuối của cụm quẹt lặp) — chống bấm 2 lần trên app, quẹt máy liên tiếp, và không để lượt lặp làm lệch các cặp vào/ra. Mặc định 15. Nếu nhân viên có nghỉ giữa giờ ngắn hơn số này (và có quẹt) thì giảm xuống. Đặt 0 = lưu đủ mọi lượt quẹt (khi ghép cặp vào/ra vẫn tự bỏ lượt lặp dưới 5 phút).')));
  // Công ty TẮT chấm công (Cấu hình hiển thị): chỉ còn phần máy chấm công (máy chấm ăn vẫn đẩy dữ liệu về) + chống quẹt trùng
  const panelMode = !hasPerm('settings') ? null : attOff() ? el('div', { class: 'panel', style: 'padding:20px;max-width:520px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, 'Máy chấm công (máy chấm ăn)'),
    el('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      el('div', { class: 'map-hint' }, 'Công ty đang TẮT chấm công (Cấu hình hiển thị) — máy chấm công chỉ dùng để quẹt thẻ ăn. Các cài đặt tính công đang ẩn.'),
      devRow, tcpRow, unionRow, aiRow, hikRow, dedupRow, saveMode)) : el('div', { class: 'panel', style: 'padding:20px;max-width:520px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, 'Kiểu chấm công'),
    el('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      modeRow(modeShift, '🕐 Theo ca làm việc', 'Có ca, tính đi muộn / về sớm / tăng ca, báo cáo đầy đủ. Phù hợp văn phòng, nhà máy.'),
      modeRow(modeHourly, '⏱️ Chỉ tính công theo giờ', 'Không cần khai báo ca, chỉ tính tổng giờ làm để trả lương theo giờ. Đơn giản cho cửa hàng, quán.'),
      stRule.box,
      mixBox,
      el('hr', { style: 'border:none;border-top:1px solid var(--line,#eee);margin:6px 0' }),
      el('h3', { style: 'margin:0;font-size:15px' }, 'Phạm vi chấm công (GPS)'),
      el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer' }, geoChk,
        el('div', {}, el('b', {}, 'Chỉ cho chấm trong bán kính chi nhánh'),
          el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Bật: nhân viên phải ở trong bán kính (đặt riêng từng chi nhánh, mục Chi nhánh) mới chấm được. Tắt: chấm tự do ở bất kỳ đâu, hệ thống vẫn ghi lại khoảng cách.'))),
      el('hr', { style: 'border:none;border-top:1px solid var(--line,#eee);margin:6px 0' }),
      el('h3', { style: 'margin:0;font-size:15px' }, 'Chống chấm hộ (khoá thiết bị)'),
      el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer' }, lockChk,
        el('div', {}, el('b', {}, 'Mỗi tài khoản chỉ chấm trên 1 điện thoại'),
          el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Bật: điện thoại đầu tiên nhân viên chấm sẽ được gắn cho tài khoản; đăng nhập máy khác sẽ KHÔNG chấm được (chống mượn tài khoản, chấm hộ). Đổi điện thoại phải admin duyệt ở menu “Duyệt đổi thiết bị”. Ảnh chấm công luôn được đóng dấu giờ + tên + GPS.'))),
      el('hr', { style: 'border:none;border-top:1px solid var(--line,#eee);margin:6px 0' }),
      el('h3', { style: 'margin:0;font-size:15px' }, 'Chống chấm trùng liên tiếp'),
      dedupRow,
      el('hr', { style: 'border:none;border-top:1px solid var(--line,#eee);margin:6px 0' }),
      el('h3', { style: 'margin:0;font-size:15px' }, 'Hình thức chấm công'),
      devRow, tcpRow, unionRow, aiRow, hikRow, phoneRow,
      // Công ảo / lương ảo: CHỈ tài khoản tổng thấy và bật/tắt (tắt thì người khác không biết có tính năng này)
      isMaster() ? el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer' }, auditChk,
        el('div', {}, el('b', {}, '🎭 Cho hiển thị công ảo / lương ảo (audit)'),
          el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Bật: Admin (và người được cấp quyền "Xem công ảo") thấy nút "🎭 Công ảo" ở Tính công / Báo cáo / Lương và mục cài đặt hạn mức tăng ca. Công thật không thay đổi. Tắt: ẩn hoàn toàn.'))) : null,
      el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer;margin-top:4px' }, inclAdminChk,
        el('div', {}, el('b', {}, '👑 Tính công cho cả tài khoản Admin'),
          el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Mặc định người quyền Admin (chủ/quản trị) KHÔNG hiện ở Tính công / Báo cáo / Lương / Phân ca. Bật nếu Admin cũng là người đi làm cần chấm công.'))),
      el('hr', { style: 'border:none;border-top:1px solid var(--line,#eee);margin:6px 0' }),
      el('h3', { style: 'margin:0;font-size:15px' }, 'Nhân viên tự chọn ca'),
      el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer' }, selfChk,
        el('div', {}, el('b', {}, 'Cho phép nhân viên tự đăng ký ca'),
          el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Bật: trên app nhân viên có mục “Chọn ca” để tự đăng ký ca cho từng ngày. Tắt: mục này ẩn đi. (Chỉ áp dụng khi chấm theo ca.)'))),
      el('label', { style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer' }, apprChk,
        el('div', {}, el('b', {}, 'Yêu cầu quản lý duyệt'),
          el('div', { style: 'font-size:13px;color:var(--muted)' }, 'Bật: ca nhân viên đăng ký phải được duyệt ở menu “Duyệt chọn ca” mới vào lịch. Tắt: đăng ký xong tự áp dụng ngay.'))),
      saveMode));

  // ----- CẤU HÌNH HIỂN THỊ: bật phân hệ nào thì menu + app nhân viên hiện phân hệ đó (chỉ tài khoản tổng đổi) -----
  const panelDisplay = displayPanel(s);
  const panelProfile = (hasPerm('settings') || isMaster()) && !attOff() ? profilePanel(s) : null;   // chế độ tính công (gói cài đặt)

  // ----- Quy tắc tính công -----
  const wkDays = new Set(String(s.weekend_days ?? '7').split(',').map(x => x.trim()).filter(Boolean));
  const wkBoxes = [1, 2, 3, 4, 5, 6, 7].map(d => el('label', { style: 'display:flex;align-items:center;gap:5px;font-weight:600;color:var(--ink)' },
    el('input', { type: 'checkbox', class: 'wk-day', value: d, style: 'width:auto', ...(wkDays.has(String(d)) ? { checked: '' } : {}) }),
    { 1: 'T2', 2: 'T3', 3: 'T4', 4: 'T5', 5: 'T6', 6: 'T7', 7: 'CN' }[d]));
  const wkOtChk = el('input', { type: 'checkbox', style: 'width:auto', ...(String(s.weekend_work_as_ot ?? '1') === '1' ? { checked: '' } : {}) });
  const wkBeforeChk = el('input', { type: 'checkbox', style: 'width:auto', ...(String(s.weekend_ot_before ?? '0') === '1' ? { checked: '' } : {}) });
  const wkExactChk = el('input', { type: 'checkbox', style: 'width:auto', ...(String(s.weekend_work_exact ?? '0') === '1' ? { checked: '' } : {}) });
  const wkNeedChk = el('input', { type: 'checkbox', style: 'width:auto', ...(String(s.weekend_need_pairs ?? '0') === '1' ? { checked: '' } : {}) });
  const pfbChk = el('input', { type: 'checkbox', style: 'width:auto', ...(String(s.pairs_fixed_break ?? '0') === '1' ? { checked: '' } : {}) });
  const msaChk = el('input', { type: 'checkbox', style: 'width:auto', ...(String(s.multi_shift_assist ?? '0') === '1' ? { checked: '' } : {}) });
  // Phòng ban đi làm cuối tuần vẫn tính như NGÀY THƯỜNG (VD bảo vệ trực CN) — ngoại lệ của quy tắc trên
  const wkNormal = new Set((s.weekend_normal_depts || []).map(String));
  const wkNormBox = el('div', { style: 'display:flex;gap:6px 14px;flex-wrap:wrap;max-height:140px;overflow:auto' }, el('span', { class: 'map-hint' }, 'Đang tải phòng ban…'));
  api('/admin/departments').then(({ rows }) => {
    wkNormBox.innerHTML = '';
    const names = [...new Set([...(rows || []).map((d) => d.name), ...wkNormal])].filter(Boolean).sort((a, b) => a.localeCompare(b, 'vi'));
    if (!names.length) { wkNormBox.append(el('span', { class: 'map-hint' }, 'Chưa có phòng ban.')); return; }
    for (const n of names) wkNormBox.append(el('label', { style: 'display:flex;align-items:center;gap:5px;font-weight:500;color:var(--ink)' },
      el('input', { type: 'checkbox', class: 'wk-norm', value: n, style: 'width:auto', ...(wkNormal.has(n) ? { checked: '' } : {}) }), n));
  }).catch(() => { wkNormBox.innerHTML = ''; });
  // Làm tròn (áp chung cả công ty): số chữ số thập phân + lùi / tới
  const decSel = (v) => el('select', {}, ...[0, 1, 2, 3].map((d) => el('option', { value: d, ...(String(v ?? 2) === String(d) ? { selected: '' } : {}) }, d === 0 ? '0 (số nguyên)' : d + ' số lẻ')));
  const modeSel = (v) => el('select', {}, ...[['0', 'Lùi (xuống)'], ['1', 'Tới (lên)']].map(([k, t]) => el('option', { value: k, ...(String(v ?? '0') === k ? { selected: '' } : {}) }, t)));
  const roundI = decSel(s.workunit_rounding), roundM = modeSel(s.workunit_rounding_mode);
  const otRoundI = decSel(s.ot_rounding), otRoundM = modeSel(s.ot_rounding_mode);
  // Tăng ca: làm tròn theo số lẻ của giờ HOẶC theo khối phút (VD 15 / 30 phút)
  const otTypeSel = el('select', {}, el('option', { value: 'hour' }, 'Theo số lẻ của giờ'), el('option', { value: 'block' }, 'Theo khối phút'));
  otTypeSel.value = s.ot_rounding_type === 'block' ? 'block' : 'hour';
  const otBlockI = el('input', { type: 'number', min: 1, max: 240, step: 1, value: s.ot_rounding_block ?? 15, style: 'width:80px' });
  const otBlockBox = el('div', { style: 'display:flex;align-items:center;gap:6px' }, otBlockI, el('span', {}, 'phút'));
  const otLevel = el('div', {}, otRoundI, otBlockBox);
  const syncOtType = () => { const b = otTypeSel.value === 'block'; otRoundI.style.display = b ? 'none' : ''; otBlockBox.style.display = b ? 'flex' : 'none'; };
  otTypeSel.onchange = syncOtType; syncOtType();
  // Đi trễ / về sớm: làm tròn LÊN theo khối phút (0 = tính đúng số phút) — giờ công cũng trừ theo số đã làm tròn
  const lateBlockI = el('input', { type: 'number', min: 0, max: 120, step: 1, value: s.late_round_block ?? 0, style: 'width:80px' });
  const payStartI = input('st-paystart', { type: 'number', min: 1, max: 28, value: s.pay_period_start_day ?? 1 });
  const otWdI = input('st-otwd', { type: 'number', min: 0.1, max: 10, step: 0.1, value: s.ot_rate_weekday ?? 1.5 });
  const otWkI = input('st-otwk', { type: 'number', min: 0.1, max: 10, step: 0.1, value: s.ot_rate_weekend ?? 2 });
  const otHoI = input('st-otho', { type: 'number', min: 0.1, max: 10, step: 0.1, value: s.ot_rate_holiday ?? 3 });
  const nightChk = el('input', { type: 'checkbox', id: 'st-night', style: 'width:auto', ...(s.night_pay === '1' ? { checked: '' } : {}) });
  const nightPctI = input('st-nightpct', { type: 'number', min: 0, max: 300, step: 1, value: s.night_pct ?? 30, style: 'width:80px' });
  const nightOtPctI = input('st-nightotpct', { type: 'number', min: 0, max: 300, step: 1, value: s.night_ot_pct ?? 20, style: 'width:80px' });
  const hpdI = input('st-hpd', { type: 'number', min: 1, max: 24, step: 0.5, value: s.pay_hours_per_day ?? 8, style: 'width:90px' });
  const saveCalc = el('button', { class: 'btn' }, 'Lưu quy tắc');
  saveCalc.onclick = async () => {
    const weekend_days = [...document.querySelectorAll('.wk-day:checked')].map(x => x.value).join(',');
    try { await api('/admin/settings', { method: 'PUT', body: { weekend_days, weekend_work_as_ot: wkOtChk.checked, weekend_ot_before: wkBeforeChk.checked, weekend_work_exact: wkExactChk.checked, weekend_need_pairs: wkNeedChk.checked, pairs_fixed_break: pfbChk.checked, multi_shift_assist: msaChk.checked, workunit_rounding: roundI.value, workunit_rounding_mode: roundM.value, ot_rounding: otRoundI.value, ot_rounding_mode: otRoundM.value, ot_rounding_type: otTypeSel.value, ot_rounding_block: otBlockI.value, late_round_block: lateBlockI.value, weekend_normal_depts: [...document.querySelectorAll('.wk-norm:checked')].map((x) => x.value), pay_period_start_day: payStartI.value, ot_rate_weekday: otWdI.value, ot_rate_weekend: otWkI.value, ot_rate_holiday: otHoI.value, pay_hours_per_day: hpdI.value, night_pay: nightChk.checked, night_pct: nightPctI.value, night_ot_pct: nightOtPctI.value } }); toast('Đã lưu quy tắc. Bấm "↻ Tính lại công tất cả" để áp cho dữ liệu cũ', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  };
  const recalcBtn = el('button', { class: 'btn ghost' }, '↻ Tính lại công tất cả');
  recalcBtn.onclick = async () => {
    if (!confirm('Tính lại số công/OT cho toàn bộ bản ghi chấm công theo cấu hình hiện tại?')) return;
    recalcBtn.disabled = true; recalcBtn.textContent = 'Đang tính…';
    try { const r = await api('/admin/recompute', { method: 'POST' }); toast(`Đã tính lại ${r.updated} bản ghi`, 'ok'); }
    catch (e) { toast(e.message, 'err'); }
    finally { recalcBtn.disabled = false; recalcBtn.textContent = '↻ Tính lại công tất cả'; }
  };
  const panelCalc = (hasPerm('settings') && !hourlyMode() && !attOff()) ? el('div', { class: 'panel', style: 'padding:20px;max-width:600px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, 'Quy tắc tính công'),
    el('div', { style: 'display:flex;flex-direction:column;gap:12px' },
      el('div', {}, el('label', {}, 'Ngày cuối tuần'), el('div', { style: 'display:flex;gap:12px;flex-wrap:wrap' }, ...wkBoxes),
        el('div', { style: 'margin-top:12px;padding:10px 12px;border:1px dashed var(--line, #d8dee6);border-radius:8px' },
          el('div', { style: 'font-weight:700;color:var(--ink)' }, 'Kiểu HR-ERP: 4 lần quẹt / ngày (Đến – Ra – Vào – Về)'),
          el('div', { style: 'font-size:12.5px;color:var(--muted);margin:2px 0 6px' }, 'Chỉ bật cho công ty đang dùng HR-ERP kiểu này. Cần thêm: ca có "Nghỉ giữa ca bắt đầu lúc" và chọn quy tắc "Nhiều lần vào/ra". Mặc định TẮT — công ty khác không bị ảnh hưởng.'),
          el('label', { style: 'display:flex;gap:8px;align-items:flex-start;cursor:pointer;font-weight:600;color:var(--ink)' }, pfbChk,
            el('div', {}, 'Ca nghỉ trưa cố định + nhiều lần vào/ra: mỗi cặp quẹt TRỪ giờ nghỉ trưa',
              el('div', { style: 'font-size:12.5px;color:var(--muted);font-weight:400' }, 'Giờ làm = phần của từng cặp nằm ngoài giờ nghỉ (vào lại sau giờ nghỉ thì mất phần chưa có mặt). Số lần quẹt lẻ (3, 5…): lấy lần đầu → cuối trừ giờ nghỉ.')))),
        el('div', { style: 'margin-top:12px;padding:10px 12px;border:1px dashed var(--line, #d8dee6);border-radius:8px' },
          el('div', { style: 'font-weight:700;color:var(--ink)' }, 'Nhân viên làm nhiều ca trong 1 ngày (ca gãy)'),
          el('div', { style: 'font-size:12.5px;color:var(--muted);margin:2px 0 6px' }, 'Chỉ thêm phần HIỂN THỊ ở Bảng phân ca, KHÔNG đổi cách tính công. Mặc định TẮT — tắt thì mọi thứ y như cũ.'),
          el('label', { style: 'display:flex;gap:8px;align-items:flex-start;cursor:pointer;font-weight:600;color:var(--ink)' }, msaChk,
            el('div', {}, 'Bảng phân ca: đánh dấu ca đủ / thiếu / chồng giờ + Ctrl + bấm mã ca để cộng thêm ca',
              el('div', { style: 'font-size:12.5px;color:var(--muted);font-weight:400' }, 'Ô gán từ 2 ca có dấu ✓ (đủ ca), ✗ (ngày đã chấm mà thiếu công của ca đó), ⚠ (ca chồng giờ). Rê chuột vào ô xem chi tiết. Nhập Excel báo thêm ca chồng giờ.')))),
        el('label', { style: 'display:flex;gap:8px;align-items:flex-start;margin-top:10px;cursor:pointer;font-weight:600;color:var(--ink)' }, wkOtChk,
          el('div', {}, 'Đi làm vào ngày cuối tuần tính là TĂNG CA',
            el('div', { style: 'font-size:12.5px;color:var(--muted);font-weight:400' }, 'Cả thời gian làm ngày đã tích ở trên thành tăng ca cuối tuần (không tính công thường). Báo cáo quy đổi 8 giờ = 1 công ở cột "Công TC cuối tuần". VD tích T7 → đi làm thứ 7 là tăng ca.'))),
        el('label', { style: 'display:flex;gap:8px;align-items:flex-start;margin-top:8px;cursor:pointer;font-weight:600;color:var(--ink)' }, wkBeforeChk,
          el('div', {}, 'Ngày nghỉ: tính cả giờ ĐẾN SỚM trước giờ vào ca là tăng ca',
            el('div', { style: 'font-size:12.5px;color:var(--muted);font-weight:400' }, 'Ngày thường đến sớm không tính tăng ca (nếu ca không bật), nhưng ngày nghỉ hằng tuần thì phần đến sớm (từ ngưỡng "Tăng ca trước ca" của ca) cũng là tăng ca — giống HR-ERP của Hoa Hồng.'))),
        el('label', { style: 'display:flex;gap:8px;align-items:flex-start;margin-top:8px;cursor:pointer;font-weight:600;color:var(--ink)' }, wkExactChk,
          el('div', {}, 'Ngày nghỉ: giờ làm TRONG ca giữ đúng số phút',
            el('div', { style: 'font-size:12.5px;color:var(--muted);font-weight:400' }, 'Chỉ làm tròn (theo khối phút ở dưới) phần tăng ca NGOÀI giờ ca (trước / sau ca); phần làm trong ca ngày nghỉ không bị làm tròn xuống. VD làm 7h10 (430 phút) → 430 phút, không phải 420.'))),
        el('label', { style: 'display:flex;gap:8px;align-items:flex-start;margin-top:8px;cursor:pointer;font-weight:600;color:var(--ink)' }, wkNeedChk,
          el('div', {}, 'Ngày nghỉ: chỉ có 2 lần quẹt thì KHÔNG tính giờ làm trong ca',
            el('div', { style: 'font-size:12.5px;color:var(--muted);font-weight:400' }, 'Áp cho ca có nghỉ trưa cố định và chọn quy tắc "nhiều lần vào/ra". Ngày nghỉ chỉ quẹt 1 cặp (vào + ra) thì giờ làm trong ca không thành tăng ca; phần tăng ca trước / sau ca vẫn tính. Giống HR-ERP của Hoa Hồng.'))),
        el('div', { style: 'margin-top:10px' }, el('div', { style: 'font-weight:600;color:var(--ink);margin-bottom:4px' }, 'Phòng ban đi làm cuối tuần vẫn tính như ngày thường'),
          el('div', { style: 'font-size:12.5px;color:var(--muted);margin-bottom:6px' }, 'VD bảo vệ trực Chủ nhật: tích phòng ban đó → ngày cuối tuần tính công + đi trễ/về sớm/tăng ca như ngày thường, không chuyển thành tăng ca.'),
          wkNormBox)),
      el('div', {}, el('label', {}, 'Hệ số tăng ca (nhân với đơn giá giờ khi tính lương)'),
        el('div', { style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:10px' }, field('Ngày thường', otWdI), field('Ngày cuối tuần', otWkI), field('Ngày lễ', otHoI)),
        el('div', { class: 'map-hint', style: 'margin-top:4px' }, 'Áp cho mọi nhân viên. Ai cần hệ số khác thì đặt riêng ở trang Lương (đặt riêng thì đổi ở đây không ảnh hưởng người đó).'),
        el('div', { style: 'display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap' }, el('span', {}, 'Số giờ chuẩn của 1 ngày công'), hpdI, el('span', { style: 'color:var(--muted);font-size:12.5px' }, 'giờ — đơn giá giờ = đơn giá ngày ÷ số này (mặc định 8; công ty làm ca 7,5 hoặc 12 giờ thì đổi cho đúng)')),
        el('div', { class: 'map-hint', style: 'margin-top:4px' }, 'Số giờ này cũng là mốc 1 công của ngày không có ca và của nhân viên chấm công theo giờ (làm đủ chừng này giờ = 1 công, ít hơn thì chia theo tỉ lệ). Đổi xong phải bấm "↻ Tính lại công tất cả" thì ngày cũ mới theo số mới.'),
        el('label', { style: 'display:flex;gap:8px;align-items:center;margin-top:10px;font-weight:600;color:var(--ink)' }, nightChk, 'Tính phụ cấp làm đêm (giờ làm từ 22:00 đến 06:00)'),
        el('div', { style: 'display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap' }, el('span', {}, 'Giờ làm đêm trả thêm'), nightPctI, el('span', {}, '% đơn giá giờ · tăng ca vào ban đêm trả thêm nữa'), nightOtPctI, el('span', {}, '%')),
        el('div', { class: 'map-hint', style: 'margin-top:4px' }, 'Mặc định TẮT (bảng lương như cũ). Bật thì bảng lương có thêm cột Giờ đêm và Phụ cấp đêm, tính từ giờ chấm vào / ra thật — không cần Tính lại công. Theo Điều 98 Bộ luật Lao động: làm đêm thêm ít nhất 30%; tăng ca ban đêm thêm 20% lương giờ ban ngày của ngày đó (ngày thường 200%, ngày nghỉ 270%, ngày lễ 390% khi hệ số tăng ca là 1,5 / 2 / 3). Ngày thường đã tăng ca ban ngày rồi tăng ca tiếp sang đêm thì luật tính 210% — phần mềm tính 200%, phần chênh cộng tay.')),
      el('div', {}, el('label', {}, 'Làm tròn (áp cho cả công ty)'),
        el('div', { style: 'display:grid;grid-template-columns:80px 1.3fr 1fr 1fr;gap:8px;align-items:center' },
          ...['', 'Kiểu', 'Mức', 'Làm tròn'].map((t) => el('span', { style: 'color:var(--muted);font-size:12px' }, t)),
          el('b', {}, 'Công'), el('span', { style: 'color:var(--muted);font-size:13px' }, 'Theo số lẻ'), roundI, roundM,
          el('b', {}, 'Tăng ca'), otTypeSel, otLevel, otRoundM,
          el('b', {}, 'Trễ / sớm'), el('span', { style: 'color:var(--muted);font-size:13px' }, 'Theo khối phút'),
          el('div', { style: 'display:flex;align-items:center;gap:6px' }, lateBlockI, el('span', {}, 'phút')), el('span', { style: 'color:var(--muted);font-size:13px' }, 'Tới (lên)')),
        el('div', { class: 'map-hint', style: 'margin-top:4px' }, 'VD công 0,866 → 2 số lẻ: lùi = 0,86 · tới = 0,87. Tăng ca 40 phút = 0,666 giờ → 2 số lẻ: lùi 0,66 giờ · tới 0,67 giờ. Theo khối 15 phút: tăng ca 47 phút → lùi 45 phút · tới 60 phút. Trễ / sớm khối 15 phút: đi trễ 1 phút tính 15 phút (trừ công 15 phút), trễ 16 phút tính 30 phút; để 0 = tính đúng số phút.')),
      field('Ngày bắt đầu kỳ lương (1 = theo tháng dương lịch; VD 5 = 05 tháng trước→04 tháng này; 26 = 26 tháng trước→25 tháng này)', payStartI),
      el('div', { style: 'display:flex;gap:10px' }, saveCalc, ...(hasPerm('recompute') ? [recalcBtn] : [])),
      el('div', { class: 'map-hint' }, 'Đổi cấu hình ca/quy tắc xong nên bấm "Tính lại công" để áp cho dữ liệu cũ.'))) : null;

  // ----- Ngày lễ -----
  const holBox = el('div', { id: 'hol-box' }, loading());
  const holDate = input('hol-date', { type: 'date' });
  const holName = input('hol-name', { placeholder: 'VD: Quốc khánh 2/9' });
  const holKind = el('select', {}, el('option', { value: 'le' }, 'Ngày lễ, tết (đi làm: tăng ca ngày lễ)'), el('option', { value: 'bu' }, 'Nghỉ bù lễ (đi làm: tăng ca ngày nghỉ)'));
  const addHol = el('button', { class: 'btn' }, 'Thêm ngày lễ');
  const loadHols = async () => {
    const { rows } = await api('/admin/holidays');
    holBox.innerHTML = '';
    if (!rows.length) { holBox.append(el('div', { class: 'map-hint' }, 'Chưa có ngày lễ nào.')); return; }
    for (const h of rows) {
      const del = btnSm('Xoá', async () => { await api('/admin/holidays/' + h.id, { method: 'DELETE' }); loadHols(); }, 'ghost');
      holBox.append(el('div', { style: 'display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #f1efec' },
        el('b', {}, fmtD(h.holiday_date) + '/' + h.holiday_date.slice(0, 4)), el('span', { style: 'flex:1' }, h.name || '', h.kind === 'bu' ? el('span', { class: 'pill warn', style: 'margin-left:8px' }, 'Nghỉ bù lễ') : ''), del));
    }
  };
  addHol.onclick = async () => {
    if (!holDate.value) return toast('Chọn ngày', 'err');
    try { await api('/admin/holidays', { method: 'POST', body: { holiday_date: holDate.value, name: holName.value, kind: holKind.value } }); toast('Đã thêm', 'ok'); holName.value = ''; loadHols(); }
    catch (e) { toast(e.message, 'err'); }
  };
  const panelHol = (hasPerm('holidays') && !hourlyMode() && !attOff()) ? el('div', { class: 'panel', style: 'padding:20px;max-width:520px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, 'Ngày lễ'),
    el('div', { style: 'display:flex;flex-direction:column;gap:12px' },
      el('div', { class: 'two-col' }, field('Ngày', holDate), field('Tên', holName)),
      field('Loại', holKind),
      el('div', { class: 'map-hint' }, 'Nghỉ bù lễ: khi ngày lễ trùng ngày nghỉ hằng tuần, người lao động được nghỉ bù vào ngày làm việc kế tiếp. Nghỉ đúng ngày đó thì hiện như nghỉ lễ (L); nếu đi làm thì tính tăng ca ngày nghỉ hằng tuần (hệ số ngày nghỉ, ký hiệu NN), không tính hệ số ngày lễ. Thêm / xoá ngày lễ xong bấm "Tính lại công" cho các ngày đã có giờ chấm.'),
      addHol, holBox)) : null;

  // ----- Sao lưu & phục hồi dữ liệu -----
  const bkBox = el('div', { id: 'bk-box' }, loading());
  let bkShow = 3;   // số bản sao lưu hiển thị (mặc định 3), 0 = tất cả
  const loadBackups = async () => {
    let d;
    try { d = await api('/admin/backup'); } catch (e) { bkBox.innerHTML = ''; bkBox.append(el('div', { class: 'map-hint' }, e.message)); return; }
    bkBox.innerHTML = '';
    // Cấu hình auto-backup
    const enChk = el('input', { type: 'checkbox', style: 'width:auto', ...(d.config.enabled ? { checked: '' } : {}) });
    const hourI = input('bk-hour', { type: 'number', min: 0, max: 23, value: d.config.hour, style: 'width:80px' });
    const keepI = input('bk-keep', { type: 'number', min: 1, max: 90, value: d.config.keep_days, style: 'width:80px' });
    const saveCfg = el('button', { class: 'btn sm' }, 'Lưu lịch sao lưu');
    saveCfg.onclick = async () => {
      try { await api('/admin/backup/config', { method: 'PUT', body: { enabled: enChk.checked, hour: +hourI.value, keep_days: +keepI.value } }); toast('Đã lưu lịch sao lưu', 'ok'); loadBackups(); }
      catch (e) { toast(e.message, 'err'); }
    };
    bkBox.append(el('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      el('label', { style: 'display:flex;gap:8px;align-items:center' }, enChk, el('b', {}, 'Tự động sao lưu hằng ngày')),
      el('div', { style: 'display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end' },
        field('Vào lúc (giờ, 0–23)', hourI), field('Giữ lại (bản gần nhất)', keepI), saveCfg)));

    // Sao lưu ngay
    const nowBtn = el('button', { class: 'btn' }, '⬇ Sao lưu ngay & tải về');
    nowBtn.onclick = async () => {
      nowBtn.disabled = true; nowBtn.textContent = 'Đang sao lưu…';
      try { const r = await api('/admin/backup/now', { method: 'POST' }); toast('Đã tạo bản sao lưu', 'ok'); await downloadBackup(r.name); loadBackups(); }
      catch (e) { toast(e.message, 'err'); }
      finally { nowBtn.disabled = false; nowBtn.textContent = '⬇ Sao lưu ngay & tải về'; }
    };
    const fullBtn = el('button', { class: 'btn' }, '⬇ Sao lưu TOÀN BỘ (.zip)');
    fullBtn.onclick = async () => {
      fullBtn.disabled = true; fullBtn.textContent = 'Đang nén…';
      try { const r = await api('/admin/backup/full', { method: 'POST' }); toast('Đã tạo bản sao lưu toàn bộ', 'ok'); await downloadBackup(r.name); loadBackups(); }
      catch (e) { toast(e.message, 'err'); }
      finally { fullBtn.disabled = false; fullBtn.textContent = '⬇ Sao lưu TOÀN BỘ (.zip)'; }
    };
    bkBox.append(el('div', { style: 'margin-top:14px;display:flex;gap:8px;flex-wrap:wrap' }, nowBtn, fullBtn));
    bkBox.append(el('div', { class: 'map-hint', style: 'margin-top:6px' }, '"Sao lưu ngày" (.db) = chỉ dữ liệu. "Sao lưu TOÀN BỘ" (.zip) = dữ liệu + ảnh chấm công + logo — dùng khi chuyển máy / lên VPS.'));
    bkBox.append(moveBox());   // chuyển phần mềm sang máy tính khác (bản cài Windows tại máy khách)

    // Danh sách bản sao lưu — mặc định hiện 3 bản gần nhất
    const showSel = el('select', { style: 'width:auto;padding:2px 6px;font-size:13px' },
      ...[['3', '3 bản'], ['5', '5 bản'], ['10', '10 bản'], ['0', 'Tất cả']].map(([v, t]) => {
        const o = el('option', { value: v }, t); if (+v === bkShow) o.selected = true; return o;
      }));
    showSel.onchange = () => { bkShow = +showSel.value; loadBackups(); };
    bkBox.append(el('div', { style: 'display:flex;align-items:center;gap:10px;margin:16px 0 6px;flex-wrap:wrap' },
      el('div', { class: 'sec-title', style: 'font-weight:700;flex:1' }, `Các bản sao lưu (${d.list.length})`),
      el('span', { style: 'color:var(--muted);font-size:13px' }, 'Hiện:'), showSel));
    if (!d.list.length) bkBox.append(el('div', { class: 'map-hint' }, 'Chưa có bản sao lưu nào.'));
    const shown = bkShow > 0 ? d.list.slice(0, bkShow) : d.list;
    for (const b of shown) {
      const dl = btnSm('Tải', () => downloadBackup(b.name));
      const del = btnSm('Xoá', async () => { if (confirm('Xoá bản sao lưu này?')) { await api('/admin/backup?name=' + encodeURIComponent(b.name), { method: 'DELETE' }); loadBackups(); } }, 'ghost');
      bkBox.append(el('div', { style: 'display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f1efec' },
        el('span', { style: 'flex:1;font-family:monospace;font-size:13px' }, (b.full ? '📦 ' : '🗃 ') + b.name),
        el('span', { style: 'color:var(--muted);font-size:12px' }, (b.full ? 'toàn bộ · ' : '') + fmtSize(b.size)), dl, del));
    }
    if (bkShow > 0 && d.list.length > bkShow)
      bkBox.append(el('div', { class: 'map-hint', style: 'margin-top:6px' }, `Đang hiện ${bkShow}/${d.list.length} bản. Chọn "Tất cả" ở trên để xem hết.`));

    // Phục hồi (nhận cả .db lẫn .zip toàn bộ)
    const fileI = el('input', { type: 'file', accept: '.db,.zip', style: 'font-size:13px' });
    const restoreBtn = el('button', { class: 'btn ghost' }, '⬆ Phục hồi từ file (.db / .zip)');
    restoreBtn.onclick = async () => {
      const f = fileI.files?.[0];
      if (!f) return toast('Chọn file sao lưu (.db hoặc .zip)', 'err');
      const isZip = /\.zip$/i.test(f.name);
      if (!confirm((isZip ? 'PHỤC HỒI TOÀN BỘ (dữ liệu + ảnh + logo)' : 'PHỤC HỒI dữ liệu') + ' sẽ thay toàn bộ hiện tại bằng file này. Tiếp tục?')) return;
      restoreBtn.disabled = true; restoreBtn.textContent = 'Đang nạp…';
      try { await (isZip ? restoreFullBackup(f) : restoreBackup(f)); }
      finally { restoreBtn.disabled = false; restoreBtn.textContent = '⬆ Phục hồi từ file (.db / .zip)'; }
    };
    bkBox.append(el('div', { style: 'margin-top:16px;padding-top:14px;border-top:1px solid #eee' },
      el('div', { style: 'font-weight:700;margin-bottom:8px' }, 'Phục hồi dữ liệu (khi cài lại máy / chuyển VPS)'),
      el('div', { class: 'map-hint', style: 'margin-bottom:8px' }, 'Chọn file .db (chỉ dữ liệu) hoặc .zip (toàn bộ: dữ liệu + ảnh + logo) rồi bấm Phục hồi. Sau đó khởi động lại máy tính.'),
      el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, fileI, restoreBtn)));
  };
  const panelBackup = hasPerm('backup') ? el('div', { class: 'panel', style: 'padding:20px;max-width:560px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, '💾 Sao lưu & phục hồi dữ liệu'), bkBox) : null;

  // ----- Cập nhật phần mềm (từ GitHub) -----
  const updStatus = el('div', { style: 'margin-top:6px;font-size:14px' });
  const checkBtn = el('button', { class: 'btn' }, '🔎 Kiểm tra cập nhật');
  const applyBtn = el('button', { class: 'btn', style: 'display:none' }, '⬇ Cập nhật ngay');
  let seenLatest = '';

  applyBtn.onclick = async () => {
    if (!confirm('Cập nhật phần mềm lên bản mới nhất? App sẽ tự khởi động lại (khoảng 1 phút). Dữ liệu được giữ nguyên và tự sao lưu trước.')) return;
    applyBtn.disabled = checkBtn.disabled = true; applyBtn.style.display = 'none';
    await runUpdateProgress(updStatus, {
      target: seenLatest,
      onLatest: () => { updStatus.innerHTML = ''; updStatus.append(el('b', { style: 'color:#1a7f37' }, '✓ Đang dùng bản mới nhất — tải lại trang (F5).')); checkBtn.disabled = false; },
      onFail: (msg) => { toast(msg, 'err'); updStatus.innerHTML = ''; updStatus.append(el('span', { style: 'color:#c0392b' }, '⚠️ ' + msg)); applyBtn.disabled = checkBtn.disabled = false; applyBtn.style.display = ''; },
    });
  };
  checkBtn.onclick = async () => {
    checkBtn.disabled = true; checkBtn.textContent = 'Đang kiểm tra…'; applyBtn.style.display = 'none';
    updStatus.innerHTML = '';
    try {
      const r = await api('/admin/update/check');
      if (r.hasUpdate) {
        seenLatest = r.latest;
        updStatus.append(el('b', { style: 'color:#1a7f37' }, `Có bản mới: ${r.latest}`), el('span', { style: 'color:var(--muted)' }, ` (đang dùng ${r.current})`));
        applyBtn.style.display = '';
      } else {
        updStatus.append(el('b', { style: 'color:#1a7f37' }, `✓ Đang dùng bản mới nhất (${r.current})`));
      }
    } catch (e) { updStatus.append(el('span', { style: 'color:#c0392b' }, e.message)); }
    finally { checkBtn.disabled = false; checkBtn.textContent = '🔎 Kiểm tra cập nhật'; }
  };
  const logBtn = el('button', { class: 'btn sm ghost' }, '📄 Tải file log lỗi');
  logBtn.onclick = async () => {
    logBtn.disabled = true;
    try {
      const res = await api('/admin/logs/server/download', { raw: true });
      const blob = await res.blob(); const u = URL.createObjectURL(blob);
      const a = el('a', { href: u, download: 'digiplus-server-log.txt' });
      document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(u);
    } catch (e) { toast(e.message || 'Không tải được file log', 'err'); }
    logBtn.disabled = false;
  };
  // Tự cập nhật (bản cài 1 công ty): phần mềm tự hỏi bản mới 15 phút/lần, có là tự cập nhật — khách không phải bấm
  const autoChk = el('input', { type: 'checkbox', class: 'sw sm', ...(s.auto_update !== '0' ? { checked: '' } : {}) });
  autoChk.onchange = async () => {
    try { await api('/admin/settings', { method: 'PUT', body: { auto_update: autoChk.checked } }); s.auto_update = autoChk.checked ? '1' : '0'; toast(autoChk.checked ? 'Đã bật tự cập nhật' : 'Đã tắt tự cập nhật — có bản mới thì bấm Kiểm tra cập nhật', 'ok'); }
    catch (e) { autoChk.checked = !autoChk.checked; toast(e.message, 'err'); }
  };
  const panelUpdate = hasPerm('settings') ? el('div', { class: 'panel', style: 'padding:20px;max-width:520px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, '⬆ Cập nhật phần mềm'),
    el('div', { style: 'display:flex;flex-direction:column;gap:12px' },
      el('div', {}, el('span', { style: 'color:var(--muted)' }, 'Phiên bản đang dùng: '), el('b', {}, s.app_version || '—')),
      s.host_managed === '1'   // chạy trên máy chủ của Digiplus: Digiplus cập nhật chung, khách không cần bấm
        ? el('div', { class: 'map-hint' }, 'Phần mềm đang chạy trên máy chủ của Digiplus — Digiplus tự cập nhật bản mới, không cần làm gì.')
        : el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, checkBtn, applyBtn),
      s.host_managed === '1' ? '' : el('label', { style: 'display:flex;gap:8px;align-items:center;margin:0;font-weight:500;color:var(--ink)' }, autoChk,
        el('span', {}, 'Tự cập nhật khi có bản mới ', el('span', { class: 'map-hint', style: 'margin:0' }, '(15 phút kiểm tra 1 lần, tự sao lưu trước, phần mềm khởi động lại khoảng 15 giây)'))),
      updStatus,
      el('div', {}, logBtn, el('span', { class: 'map-hint', style: 'margin-left:8px' }, 'Khi gặp lỗi, tải file này gửi cho Digiplus để được hỗ trợ nhanh.')),
      el('div', { class: 'map-hint' }, 'Máy phải có Internet. Bấm “Kiểm tra cập nhật”: đã mới nhất sẽ báo xanh; có bản mới sẽ hiện nút “Cập nhật ngay”. Cập nhật xong app tự khởi động lại, dữ liệu giữ nguyên (tự sao lưu trước khi cập nhật).'))) : null;

  // ----- Bản quyền / Gia hạn -----
  const licBox = el('div', {}, loading());
  const loadLic = async () => {
    let s2; try { s2 = await fetch('/api/license/status').then((r) => r.json()); }
    catch { licBox.innerHTML = ''; licBox.append(el('div', { class: 'map-hint' }, 'Không đọc được trạng thái bản quyền.')); return; }
    licBox.innerHTML = '';
    const row = (k, v, color) => el('div', { style: 'display:flex;gap:8px;padding:3px 0' }, el('span', { style: 'color:var(--muted);min-width:130px' }, k), el('b', color ? { style: 'color:' + color } : {}, v));
    const days = s2.exp ? (s2.daysLeft > 0 ? `còn ${s2.daysLeft} ngày` : 'ĐÃ HẾT HẠN') : '';
    licBox.append(
      row('Trạng thái:', s2.activated ? '✅ Đã kích hoạt' : '❌ Chưa kích hoạt / hết hạn', s2.activated ? '#1a7f37' : '#c0392b'),
      s2.company ? row('Công ty:', s2.company) : '',
      row('Hạn dùng:', s2.exp ? s2.exp + '  (' + days + ')' : 'Vĩnh viễn', s2.exp && s2.daysLeft <= 0 ? '#c0392b' : (s2.exp && s2.daysLeft <= 15 ? '#b45309' : '')),
      row('Số NV tối đa:', s2.maxEmp || 'Không giới hạn'),
      row('Mã máy:', s2.machineIdFmt || '—'));
    const copyBtn = el('button', { class: 'btn sm ghost' }, '📋 Copy Mã máy');
    copyBtn.onclick = () => { try { navigator.clipboard.writeText(s2.machineIdFmt || ''); toast('Đã copy Mã máy', 'ok'); } catch { toast('Copy thủ công giúp em', 'err'); } };
    licBox.append(el('div', { style: 'margin-top:8px' }, copyBtn));
    const licI = el('textarea', { rows: 3, placeholder: 'Dán license mới (gia hạn) do Digiplus cấp...', style: 'width:100%;font-family:monospace;font-size:12px;padding:10px;border:1px solid var(--line,#e7e3df);border-radius:10px' });
    const actBtn = el('button', { class: 'btn' }, '🔑 Gia hạn / Kích hoạt');
    actBtn.onclick = async () => {
      const key = licI.value.trim(); if (!key) return toast('Dán license vào ô', 'err');
      actBtn.disabled = true;
      try {
        const res = await fetch('/api/license/activate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
        const d = await res.json(); if (!res.ok) throw new Error(d.error || 'Lỗi kích hoạt');
        toast('✅ Đã cập nhật bản quyền', 'ok'); licI.value = ''; loadLic();
      } catch (e) { toast(e.message, 'err'); } finally { actBtn.disabled = false; }
    };
    licBox.append(el('div', { style: 'margin-top:14px;padding-top:12px;border-top:1px solid #eee' },
      el('div', { style: 'font-weight:700;margin-bottom:6px' }, 'Gia hạn / nhập license mới'),
      el('div', { class: 'map-hint', style: 'margin-bottom:8px' }, 'Gửi Mã máy ở trên cho Digiplus để lấy license, rồi dán vào đây và bấm. Dùng được cả khi CHƯA hết hạn (gia hạn sớm) — hạn mới sẽ thay hạn cũ.'),
      licI, el('div', { style: 'margin-top:8px' }, actBtn)));
  };
  const panelLicense = el('div', { class: 'panel', style: 'padding:20px;max-width:520px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, '🔑 Bản quyền'), licBox);

  // ----- Cài app vào máy (PWA) -----
  const installBox = el('div', {});
  const renderInstall = () => {
    installBox.innerHTML = '';
    if (isStandalone()) { installBox.append(el('div', { style: 'color:#1a7f37;font-weight:600' }, '✅ App đã được cài trên thiết bị này.')); return; }
    if (deferredPrompt) {
      const b = el('button', { class: 'btn' }, '📲 Cài app vào máy');
      b.onclick = async () => { try { deferredPrompt.prompt(); await deferredPrompt.userChoice; } catch {} deferredPrompt = null; setTimeout(renderInstall, 400); };
      installBox.append(b, el('div', { class: 'map-hint', style: 'margin-top:8px' }, 'Bấm để cài như ứng dụng thật (mở nhanh + nhận thông báo).'));
      return;
    }
    if (isIOS()) {
      installBox.append(el('ol', { style: 'margin:0;padding-left:18px;font-size:14px;line-height:1.9' },
        el('li', { html: 'Mở trang này bằng <b>Safari</b>.' }),
        el('li', { html: 'Bấm nút <b>Chia sẻ</b> (ô vuông có mũi tên ↑ ở thanh dưới); nếu đang ở menu thì bấm dòng <b>“Chia sẻ”</b>.' }),
        el('li', { html: 'Vuốt xuống → chọn <b>“Thêm vào Màn hình chính”</b> → <b>Thêm</b>.' }),
        el('li', { html: 'Mở app từ <b>icon</b> vừa tạo, rồi bật 🔔 Thông báo bên dưới.' })));
      return;
    }
    installBox.append(el('div', { class: 'map-hint' }, 'Mở menu trình duyệt (⋮) → chọn “Thêm vào Màn hình chính” / “Cài đặt ứng dụng”.'));
  };
  const panelInstall = el('div', { class: 'panel', style: 'padding:20px;max-width:520px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, '📲 Cài app vào máy'),
    el('div', { class: 'map-hint', style: 'margin-bottom:10px' }, 'Cài để mở nhanh như ứng dụng thật và nhận thông báo chấm công (iPhone bắt buộc cài mới nhận được thông báo).'),
    installBox);

  // ----- Thông báo đẩy khi có người chấm công -----
  const notifyBox = el('div', {}, loading());
  const renderNotify = async () => {
    const st = await pushState();
    notifyBox.innerHTML = '';
    if (st === 'unsupported') { notifyBox.append(el('div', { class: 'map-hint' }, 'Thiết bị/trình duyệt này không hỗ trợ thông báo đẩy. Dùng Chrome/Edge trên Android, hoặc trên iPhone hãy “Thêm vào màn hình chính” rồi mở từ đó (iOS 16.4+). Cần mở qua HTTPS/domain.')); return; }
    if (st === 'denied') { notifyBox.append(el('div', { class: 'map-hint' }, '⚠️ Bạn đã CHẶN quyền thông báo cho trang này. Vào cài đặt trình duyệt (biểu tượng ổ khoá cạnh địa chỉ) → cho phép Thông báo → tải lại trang.')); return; }
    const on = st === 'on';
    const toggle = el('button', { class: 'btn' }, on ? 'Tắt thông báo trên máy này' : '🔔 Bật thông báo chấm công');
    toggle.onclick = async () => {
      toggle.disabled = true;
      try { if (on) { await disablePush(); toast('Đã tắt', 'ok'); } else { await enablePush(); toast('Đã bật thông báo trên thiết bị này', 'ok'); } renderNotify(); }
      catch (e) { toast(e.message, 'err'); toggle.disabled = false; }
    };
    const testBtn = el('button', { class: 'btn ghost' }, 'Gửi thử');
    testBtn.onclick = async () => {
      testBtn.disabled = true;
      try {
        const okSub = await ensureSubscribed();   // đồng bộ đăng ký lên server trước
        if (!okSub) { toast('Thiết bị chưa đăng ký. Bấm "Bật thông báo" lại giúp em.', 'err'); return; }
        const r = await api('/admin/push/test', { method: 'POST' });
        if (!r.total) toast('Server chưa có thiết bị nào đăng ký — thử Tắt rồi Bật lại thông báo.', 'err');
        else if (r.sent) toast(`✅ Đã gửi tới ${r.sent}/${r.total} thiết bị. Chờ thông báo hiện ra (kiểm tra cả cài đặt Thông báo của máy).`, 'ok');
        else toast(`Gửi không thành công (mã: ${(r.statuses || []).join(', ') || '?'}). `, 'err');
      } catch (e) { toast(e.message, 'err'); }
      finally { testBtn.disabled = false; }
    };
    if (on) ensureSubscribed();   // vào trang mà đang bật → đồng bộ đăng ký để server luôn có
    notifyBox.append(
      el('div', {}, el('b', { style: 'color:' + (on ? '#1a7f37' : '#7a808c') }, on ? '✅ Đang BẬT trên thiết bị này' : '⚪ Đang TẮT trên thiết bị này')),
      el('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' }, toggle, ...(on ? [testBtn] : [])));
  };
  const panelNotify = el('div', { class: 'panel', style: 'padding:20px;max-width:520px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, '🔔 Thông báo khi có người chấm công'),
    el('div', { class: 'map-hint', style: 'margin-bottom:10px' }, 'Bật để điện thoại/máy này nhận thông báo mỗi khi nhân viên chấm vào/ra (kèm tên, giờ, vị trí) — kể cả khi không mở app. Mỗi quản lý bật riêng trên thiết bị của mình.'),
    notifyBox);

  const panel2 = el('div', { class: 'panel', style: 'padding:20px;max-width:520px' },
    el('h3', { style: 'margin-top:0' }, 'Đổi mật khẩu của tôi'),
    el('div', { style: 'display:flex;flex-direction:column;gap:12px' }, field('Mật khẩu hiện tại', oldP), field('Mật khẩu mới', newP), savePw));
  // ----- Phép năm -----
  const lvNum = (v, min, max, step = 1) => el('input', { type: 'number', min, max, step, value: v, style: 'width:90px' });
  const lvPer = lvNum(s.leave_days_per_year ?? 12, 0, 60, 0.5), lvSenY = lvNum(s.leave_seniority_years ?? 5, 0, 50), lvSenA = lvNum(s.leave_seniority_add ?? 1, 0, 30, 0.5);
  const lvAcc = el('select', { style: 'width:auto' }, el('option', { value: 'year' }, 'Cấp đủ số ngày ngay từ đầu năm'), el('option', { value: 'month' }, 'Cộng dồn theo tháng (mỗi tháng 1/12)'));
  lvAcc.value = s.leave_accrual === 'month' ? 'month' : 'year';
  const lvPro = el('input', { type: 'checkbox', style: 'width:auto', ...(String(s.leave_prorate_new ?? '1') === '1' ? { checked: '' } : {}) });
  const lvCar = lvNum(s.leave_carry_max ?? 0, 0, 60, 0.5), lvCarU = lvNum(s.leave_carry_until_month ?? 3, 0, 12);
  const lvOver = el('input', { type: 'checkbox', style: 'width:auto', ...(String(s.leave_allow_over ?? '0') === '1' ? { checked: '' } : {}) });
  // 1 hàng: nhãn trái | các ô + chữ đơn vị | (chuỗi cuối dài = ghi chú nhỏ bên dưới)
  const lvRow = (label, ...ctl) => {
    const hint = typeof ctl[ctl.length - 1] === 'string' && ctl[ctl.length - 1].length > 24 ? ctl.pop() : '';
    return el('div', { class: 'lv-row' }, el('span', { class: 'lv-lab' }, label),
      el('div', {}, el('div', { class: 'lv-ctl' }, ...ctl.map((c) => (typeof c === 'string' ? el('span', {}, c) : c))), hint ? el('div', { class: 'map-hint', style: 'margin-top:3px' }, hint) : ''));
  };
  const lvSave = el('button', { class: 'btn' }, 'Lưu phép năm');
  lvSave.onclick = async () => {
    try { await api('/admin/settings', { method: 'PUT', body: { leave_days_per_year: lvPer.value, leave_seniority_years: lvSenY.value, leave_seniority_add: lvSenA.value, leave_accrual: lvAcc.value, leave_prorate_new: lvPro.checked, leave_carry_max: lvCar.value, leave_carry_until_month: lvCarU.value, leave_allow_over: lvOver.checked } }); toast('Đã lưu cài đặt phép năm', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  };
  const panelLeave = hasPerm('settings') && !attOff() ? el('div', { class: 'panel', style: 'padding:20px;max-width:600px;margin-bottom:16px' },
    el('h3', { style: 'margin-top:0' }, 'Phép năm'),
    el('div', { class: 'lv-form' },
      lvRow('Số ngày phép năm', lvPer, 'ngày / năm', 'Luật: 12 ngày; công việc nặng nhọc 14; đặc biệt nặng nhọc 16.'),
      lvRow('Thâm niên', el('span', {}, 'cứ đủ'), lvSenY, 'năm làm việc cộng thêm', lvSenA, 'ngày', 'Luật: đủ 5 năm +1 ngày. Để 0 = không cộng thâm niên.'),
      lvRow('Cách cấp phép trong năm', lvAcc),
      lvRow('Phép dư chuyển sang năm sau', el('span', {}, 'tối đa'), lvCar, 'ngày, dùng đến hết tháng', lvCarU, 'Để 0 ngày = không chuyển; tháng 0 = dùng cả năm.'),
      el('label', { class: 'lv-chk' }, lvPro, el('span', {}, el('b', {}, 'Năm đầu vào làm: tính phép theo số tháng làm việc'), el('span', { class: 'map-hint', style: 'display:block' }, 'VD vào làm 01/07 → năm đó được 12 × 6/12 = 6 ngày. Vào từ ngày 16 trở đi thì tháng đó không tính.'))),
      el('label', { class: 'lv-chk' }, lvOver, el('span', {}, el('b', {}, 'Cho nhân viên xin nghỉ phép năm vượt số ngày còn lại'), el('span', { class: 'map-hint', style: 'display:block' }, 'Không tích: nhân viên không gửi được đơn vượt phép (phải chọn Nghỉ không lương); quản lý vẫn duyệt / thêm được sau khi xác nhận.'))),
      el('div', { class: 'map-hint' }, 'Ngày vào làm và mức phép riêng khai ở hồ sơ từng nhân viên (mức riêng chưa gồm thâm niên). Xem số phép từng người ở Đơn từ › Quỹ phép năm. Nghỉ phép năm và Nghỉ có lương được tính lương; Nghỉ không lương thì không.'),
      el('div', {}, lvSave))) : null;
  // ----- Công ảo / lương ảo (audit) — hạn mức tăng ca -----
  const panelAudit = auditOn() && hasPerm('settings') && !attOff() ? auditPanelEl(s) : null;
  setMain(head('Cài đặt'), panel1, panelDisplay, panelProfile, panelLicense, panelInstall, panelNotify, panelMode, panelCalc, panelLeave, panelAudit, panelHol, panelBackup, panelUpdate, panel2);
  foldSettings($('#main'));   // mặc định thu gọn mọi khung, bấm tiêu đề / ▶ để mở
  if (hasPerm('holidays') && !hourlyMode() && !attOff()) loadHols();
  if (hasPerm('backup')) loadBackups();
  loadLic();
  renderInstall();
  renderNotify();
}
