// Tool cấp license (giao diện) — chạy cục bộ, dùng khoá riêng tools/keys/private.pem.
import crypto from 'node:crypto';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const DIR = dirname(fileURLToPath(import.meta.url));
const PRIV = join(DIR, '..', 'keys', 'private.pem');
const PORT = 39217;

if (!existsSync(PRIV)) {
  console.error('KHÔNG tìm thấy khoá riêng:', PRIV);
  console.error('Đặt file private.pem vào thư mục tools/keys/ rồi chạy lại.');
  process.exit(1);
}
const privateKey = crypto.createPrivateKey(readFileSync(PRIV, 'utf8'));

function genLicense({ machine, company, exp, max }) {
  const payload = {
    c: company,
    m: (machine || '').replace(/[-\s]/g, '').toUpperCase() || '*',
    e: exp || null,
    n: max ? parseInt(max, 10) : null,
    i: new Date().toISOString().slice(0, 10),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  const sig = crypto.sign(null, Buffer.from(payloadB64), privateKey).toString('base64');
  return { license: payloadB64 + '.' + sig, payload };
}

const HTML = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Digiplus — Cấp License</title><style>
*{box-sizing:border-box;font-family:'Segoe UI',system-ui,Arial,sans-serif}
body{margin:0;background:#f4f5f7;color:#1f2430}
.top{background:linear-gradient(150deg,#E8541E,#C63D0F);color:#fff;padding:22px 26px}
.top h1{margin:0;font-size:22px}.top p{margin:4px 0 0;opacity:.9;font-size:13px}
.wrap{max-width:640px;margin:22px auto;padding:0 16px}
.card{background:#fff;border-radius:16px;box-shadow:0 6px 22px rgba(0,0,0,.08);padding:22px;margin-bottom:16px}
label{display:block;font-size:13px;font-weight:600;color:#7a808c;margin:12px 0 6px}
input,select,textarea{width:100%;padding:11px 13px;border:1px solid #e7e3df;border-radius:12px;font-size:15px;outline:none}
input:focus,select:focus,textarea:focus{border-color:#E8541E}
.row{display:flex;gap:12px}.row>div{flex:1}
.btn{margin-top:18px;width:100%;background:#E8541E;color:#fff;border:none;border-radius:12px;padding:13px;font-size:16px;font-weight:700;cursor:pointer}
.btn:active{transform:translateY(1px)}
textarea{font-family:monospace;font-size:13px}
.out{display:none}.pill{display:inline-block;background:#dcfce7;color:#166534;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700}
.hint{font-size:12px;color:#7a808c;margin-top:6px}
.copy{margin-top:10px;background:#fff;border:1px solid #e7e3df;border-radius:12px;padding:10px;font-weight:700;cursor:pointer;width:100%}
</style></head><body>
<div class="top"><h1>🔑 Digiplus — Cấp License</h1><p>Công cụ nội bộ của Digiplus. Không chia sẻ ra ngoài.</p></div>
<div class="wrap">
 <div class="card">
  <label>Mã máy của khách (khách gửi)</label>
  <input id="machine" placeholder="VD: 103B-E555-114A-6CD3" style="font-family:monospace;font-weight:700">
  <label>Tên công ty khách</label>
  <input id="company" placeholder="VD: Công ty TNHH ABC">
  <div class="row">
   <div><label>Loại bản quyền</label>
    <select id="ltype"><option value="perm">Vĩnh viễn (mua đứt)</option><option value="exp">Có hạn (thuê bao)</option></select></div>
   <div><label>Ngày hết hạn</label><input id="exp" type="date" disabled></div>
  </div>
  <label>Giới hạn số nhân viên (để trống = không giới hạn)</label>
  <input id="max" type="number" min="1" placeholder="VD: 50">
  <button class="btn" id="go">Tạo License</button>
 </div>
 <div class="card out" id="out">
  <span class="pill">✓ Đã tạo license</span>
  <div class="hint" id="meta"></div>
  <label>Chuỗi license — gửi cho khách dán vào app</label>
  <textarea id="lic" rows="5" readonly></textarea>
  <button class="copy" id="copy">📋 Copy license</button>
 </div>
</div>
<script>
const $=id=>document.getElementById(id);
$('ltype').onchange=()=>{$('exp').disabled=$('ltype').value!=='exp';};
$('go').onclick=async()=>{
  const machine=$('machine').value.trim();
  const company=$('company').value.trim();
  if(!machine||!company){alert('Nhập Mã máy và Tên công ty');return;}
  const exp=$('ltype').value==='exp'?$('exp').value:'';
  if($('ltype').value==='exp'&&!exp){alert('Chọn ngày hết hạn');return;}
  const r=await fetch('/gen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({machine,company,exp,max:$('max').value})});
  const d=await r.json();
  if(!r.ok){alert(d.error||'Lỗi');return;}
  $('lic').value=d.license;
  $('meta').textContent='Công ty: '+d.payload.c+' · Máy: '+d.payload.m+' · Hạn: '+(d.payload.e||'vĩnh viễn')+' · Tối đa NV: '+(d.payload.n||'không giới hạn');
  $('out').style.display='block';$('out').scrollIntoView({behavior:'smooth'});
};
$('copy').onclick=()=>{$('lic').select();document.execCommand('copy');navigator.clipboard&&navigator.clipboard.writeText($('lic').value);$('copy').textContent='✓ Đã copy';setTimeout(()=>$('copy').textContent='📋 Copy license',1500);};
</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(HTML); return; }
  if (req.method === 'POST' && req.url === '/gen') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const b = JSON.parse(body || '{}');
        if (!b.machine || !b.company) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Thiếu Mã máy hoặc công ty' })); return; }
        const out = genLicense(b);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
      } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }
  res.writeHead(404); res.end();
});
server.listen(PORT, '127.0.0.1', () => {
  console.log('Tool cấp license đang chạy tại http://localhost:' + PORT);
  exec('start "" http://localhost:' + PORT);
});
