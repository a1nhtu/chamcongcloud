// Tool cấp license (giao diện) — chạy cục bộ, dùng khoá riêng tools/keys/private.pem.
import crypto from 'node:crypto';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { licList, licAdd, historyReady } from './lich-su.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const PRIV = join(DIR, '..', 'keys', 'private.pem');
const PORT = 39217;

if (!existsSync(PRIV)) {
  console.error('KHÔNG tìm thấy khoá riêng:', PRIV);
  console.error('Đặt file private.pem vào thư mục tools/keys/ rồi chạy lại.');
  process.exit(1);
}
const PRIV_PEM = readFileSync(PRIV, 'utf8');
const privateKey = crypto.createPrivateKey(PRIV_PEM);

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

// Key theo MÁY (bản quyền từng máy chấm công) — gắn theo serial.
function genDeviceKey({ serial, company, exp }) {
  const payload = {
    t: 'dev',
    s: (serial || '').replace(/\s/g, '').toUpperCase(),
    c: company || '',
    e: exp || null,
    i: new Date().toISOString().slice(0, 10),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  const sig = crypto.sign(null, Buffer.from(payloadB64), privateKey).toString('base64');
  return { key: payloadB64 + '.' + sig, payload };
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
.hit{border:1px solid #e7e3df;border-radius:12px;padding:10px 12px;margin-top:8px;background:#fdfaf8}
.hit b{display:block}.sm{font-size:12.5px;color:#7a808c}
.mini{background:#E8541E;color:#fff;border:none;border-radius:9px;padding:7px 12px;font-weight:700;cursor:pointer;margin:8px 8px 0 0}
.mini.g{background:#fff;color:#1f2430;border:1px solid #e7e3df}
.hist{display:none;font-size:12.5px;border-top:1px dashed #e7e3df;margin-top:6px;padding-top:6px}
.re{display:none;background:#fcebe2;border:1px solid #E8541E;border-radius:11px;padding:10px 12px;font-size:13.5px;margin-top:10px}
.tag{display:inline-block;border:1px solid #e7e3df;border-radius:6px;padding:0 6px;font-size:11.5px;font-weight:700;margin-right:4px}
.err{color:#c62828;font-size:13px;margin-top:6px}
</style></head><body>
<div class="top"><h1>🔑 Digiplus — Cấp License</h1><p>Công cụ nội bộ của Digiplus. Không chia sẻ ra ngoài.</p></div>
<div class="wrap">
 <div class="card">
  <h2 style="margin:0 0 4px;font-size:18px">🔁 Cấp lại cho khách cũ</h2>
  <div class="hint">Khách cài lại Win / đổi máy → Mã máy đổi. Gõ tên khách, bấm <b>Cấp lại</b>: hạn + số NV cũ tự điền, chỉ cần dán Mã máy mới. Dùng chung lịch sử với trang online /cap-license.</div>
  <label>Người cấp (ghi vào lịch sử)</label>
  <input id="by" placeholder="VD: Anh Tú" maxlength="30">
  <label>Tìm khách</label>
  <input id="q" placeholder="Gõ tên khách (có dấu hay không đều được) hoặc mã máy cũ" autocomplete="off">
  <div class="err" id="qerr"></div>
  <div id="hits"></div>
 </div>
 <div class="card" id="lcard">
  <div class="re" id="re"></div>
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
  <div class="hint" id="log"></div>
  <label>Chuỗi license — gửi cho khách dán vào app</label>
  <textarea id="lic" rows="5" readonly></textarea>
  <button class="copy" id="copy">📋 Copy license</button>
 </div>
 <div class="card">
  <h2 style="margin:0 0 4px;font-size:18px">🖥️ Cấp KEY MÁY CHẤM CÔNG</h2>
  <div class="hint">Gắn theo <b>Serial máy</b>. Khách lấy Serial trong phần mềm (mục Máy chấm công, cột Serial) gửi cho Anh.</div>
  <label>Serial máy (khách gửi)</label>
  <input id="dserial" placeholder="VD: CJHK230160XXXX" style="font-family:monospace;font-weight:700">
  <label>Tên công ty khách (tuỳ chọn)</label>
  <input id="dcompany" placeholder="VD: Công ty TNHH ABC">
  <div class="row">
   <div><label>Loại key</label>
    <select id="dtype"><option value="perm">Vĩnh viễn</option><option value="exp">Có hạn</option></select></div>
   <div><label>Ngày hết hạn</label><input id="dexp" type="date" disabled></div>
  </div>
  <button class="btn" id="dgo">Tạo key máy</button>
 </div>
 <div class="card out" id="dout">
  <span class="pill">✓ Đã tạo key máy</span>
  <div class="hint" id="dmeta"></div>
  <label>Chuỗi key — gửi khách dán vào ĐÚNG máy đó</label>
  <textarea id="dkey" rows="5" readonly></textarea>
  <button class="copy" id="dcopy">📋 Copy key</button>
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
  if(re&&nm(machine)===nm(re.last.m)&&!confirm('Mã máy này GIỐNG mã máy lần cấp trước. Khách cài lại Win / đổi máy thì Mã máy phải khác.\\nVẫn cấp?'))return;
  const r=await fetch('/gen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({machine,company,exp,max:$('max').value,rid:re?re.id:'',by:$('by').value.trim()})});
  const d=await r.json();
  if(!r.ok){alert(d.error||'Lỗi');return;}
  $('lic').value=d.license;
  $('meta').textContent='Công ty: '+d.payload.c+' · Máy: '+d.payload.m+' · Hạn: '+(d.payload.e?vn(d.payload.e):'vĩnh viễn')+' · Tối đa NV: '+(d.payload.n||'không giới hạn');
  $('log').textContent=d.logged?'✓ Đã ghi vào lịch sử cấp ('+(re?'cấp lại':'cấp mới')+')':'⚠ Chưa ghi được lịch sử: '+(d.logError||'?');
  $('out').style.display='block';$('out').scrollIntoView({behavior:'smooth'});
  setRe(null);hist=null;
};
// ---- Lịch sử cấp + cấp lại khách cũ ----
try{$('by').value=localStorage.getItem('dp_lic_by')||'';}catch(e){}
$('by').onchange=()=>{try{localStorage.setItem('dp_lic_by',$('by').value.trim());}catch(e){}};
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const norm=s=>String(s||'').toLowerCase().replace(/đ/g,'d').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const nm=s=>String(s||'').replace(/[-\\s]/g,'').toUpperCase();
const fm=s=>(s&&s!=='*')?(nm(s).match(/.{1,4}/g)||[]).join('-'):'không gắn máy';
const vn=d=>d?d.split('-').reverse().join('/'):'';
const today=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
const KIND={'moi':'Cấp mới','cap-lai':'Cấp lại','nhap-bu':'Nhập bù','quet':'Quét'};
let hist=null,re=null,qt=null;
async function loadHist(){
  if(hist)return hist;
  $('qerr').textContent='';
  try{const r=await fetch('/lich-su');const d=await r.json();if(!r.ok){$('qerr').textContent=d.error||'Lỗi';return null;}return(hist=d.items||[]);}
  catch(e){$('qerr').textContent='Lỗi: '+e.message;return null;}
}
const line=x=>'<span class="tag">'+esc(KIND[x.t]||x.t||'')+'</span>'+(x.i?'Cấp '+vn(x.i):'Không rõ ngày cấp')+' · Máy '+esc(fm(x.m))+' · Hạn '+(x.e?vn(x.e):'vĩnh viễn')+' · '+(x.n?x.n+' NV':'không giới hạn NV')+(x.by?' · '+(x.t==='quet'?'từ ':'bởi ')+esc(x.by):'');
async function search(){
  const q=norm($('q').value),qm=nm($('q').value);
  if(!q){$('hits').innerHTML='';return;}
  const items=await loadHist();if(!items)return;
  const w=q.split(' ');
  const f=items.filter(it=>{const n=norm(it.c);return w.every(x=>n.includes(x))||(qm.length>=4&&it.h.some(x=>nm(x.m).includes(qm)));})
    .sort((a,b)=>String((b.h[0]||{}).i||'').localeCompare(String((a.h[0]||{}).i||''))).slice(0,20);
  $('hits').innerHTML=f.length?f.map(it=>{const L=it.h[0]||{};return '<div class="hit"><b>'+esc(it.c)+'</b><div class="sm">Lần gần nhất: '+line(L)+(L.e&&L.e<today()?' <b style="display:inline;color:#c62828">(đã hết hạn)</b>':'')+'</div>'+
    '<button class="mini" data-re="'+it.id+'">Cấp lại</button><button class="mini g" data-h="'+it.id+'">Xem '+it.h.length+' lần cấp</button>'+
    '<div class="hist" id="h-'+it.id+'">'+it.h.map(x=>'<div>'+line(x)+'</div>').join('')+'</div></div>';}).join('')
    :'<div class="hint">Không thấy khách nào khớp. Khách cấp trước khi có lịch sử thì nhập bù ở trang online /cap-license (mục 📥).</div>';
}
$('q').oninput=()=>{clearTimeout(qt);qt=setTimeout(search,200);};
$('q').onfocus=()=>loadHist();
$('hits').onclick=ev=>{
  const b=ev.target.closest('button');if(!b)return;
  if(b.dataset.h){const el=$('h-'+b.dataset.h);el.style.display=el.style.display==='block'?'none':'block';return;}
  const it=(hist||[]).find(x=>x.id===b.dataset.re);if(it)setRe(it);
};
function setRe(it){
  re=it?{id:it.id,c:it.c,last:it.h[0]||{}}:null;
  if(!re){$('re').style.display='none';$('re').innerHTML='';return;}
  const L=re.last;
  $('company').value=it.c;$('ltype').value=L.e?'exp':'perm';$('exp').disabled=!L.e;$('exp').value=L.e||'';$('max').value=L.n||'';$('machine').value='';
  $('out').style.display='none';
  $('re').innerHTML='🔁 Đang <b>cấp lại</b> cho <b>'+esc(it.c)+'</b> — giữ nguyên hạn <b>'+(L.e?vn(L.e):'vĩnh viễn')+'</b>, <b>'+(L.n?L.n+' NV':'không giới hạn NV')+'</b> như lần trước. Mã máy cũ: '+esc(fm(L.m))+'. '+
    (L.e&&L.e<today()?'<br><b style="color:#c62828">Hạn cũ đã qua — khách gia hạn thì sửa lại ngày.</b> ':'')+'<br>Dán <b>Mã máy MỚI</b> rồi bấm Tạo License. <a href="#" id="rex">Bỏ chọn</a>';
  $('re').style.display='block';
  $('rex').onclick=e=>{e.preventDefault();setRe(null);};
  $('lcard').scrollIntoView({behavior:'smooth'});setTimeout(()=>$('machine').focus(),300);
}
$('copy').onclick=()=>{$('lic').select();document.execCommand('copy');navigator.clipboard&&navigator.clipboard.writeText($('lic').value);$('copy').textContent='✓ Đã copy';setTimeout(()=>$('copy').textContent='📋 Copy license',1500);};
$('dtype').onchange=()=>{$('dexp').disabled=$('dtype').value!=='exp';};
$('dgo').onclick=async()=>{
  const serial=$('dserial').value.trim();
  if(!serial){alert('Nhập Serial máy');return;}
  const exp=$('dtype').value==='exp'?$('dexp').value:'';
  if($('dtype').value==='exp'&&!exp){alert('Chọn ngày hết hạn');return;}
  const r=await fetch('/gen-device',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({serial,company:$('dcompany').value.trim(),exp})});
  const d=await r.json();
  if(!r.ok){alert(d.error||'Lỗi');return;}
  $('dkey').value=d.key;
  $('dmeta').textContent='Serial: '+d.payload.s+' · Công ty: '+(d.payload.c||'-')+' · Hạn: '+(d.payload.e||'vĩnh viễn');
  $('dout').style.display='block';$('dout').scrollIntoView({behavior:'smooth'});
};
$('dcopy').onclick=()=>{$('dkey').select();document.execCommand('copy');navigator.clipboard&&navigator.clipboard.writeText($('dkey').value);$('dcopy').textContent='✓ Đã copy';setTimeout(()=>$('dcopy').textContent='📋 Copy key',1500);};
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
        // Ghi lịch sử (dùng chung trang online). Lỗi ghi KHÔNG chặn việc cấp.
        const p = out.payload;
        licAdd(PRIV_PEM, { rid: b.rid, company: p.c, entry: { m: p.m, e: p.e, n: p.n, i: p.i, t: b.rid ? 'cap-lai' : 'moi', by: String(b.by || '').trim().slice(0, 30) || 'tool' } })
          .then(() => ({ logged: true }), (e) => ({ logged: false, logError: e.message }))
          .then((lg) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ...out, ...lg })); });
      } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/lich-su') {
    if (!historyReady()) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Thiếu tools/cf.env — chưa đọc được lịch sử. Dùng trang online /cap-license.' })); return; }
    licList(PRIV_PEM).then(
      (all) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, items: all.map(({ dnsId, ...x }) => x) })); },
      (e) => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); });
    return;
  }
  if (req.method === 'POST' && req.url === '/gen-device') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const b = JSON.parse(body || '{}');
        if (!b.serial) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Thiếu Serial máy' })); return; }
        const out = genDeviceKey(b);
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
