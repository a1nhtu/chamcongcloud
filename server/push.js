// Web Push (thông báo đẩy) — tự cài bằng node:crypto, KHÔNG cần thư viện ngoài.
// Chuẩn: VAPID (RFC 8292) + mã hoá payload aes128gcm (RFC 8291/8188).
import crypto from 'node:crypto';
import { db, getSetting, setSetting } from './db.js';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDec = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// --- Khoá VAPID (tạo 1 lần, lưu trong settings) ---
export function getVapid() {
  let publicKey = getSetting('vapid_public');
  let privateKey = getSetting('vapid_private');
  if (!publicKey || !privateKey) {
    const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = kp.publicKey.export({ format: 'jwk' });
    publicKey = b64url(Buffer.concat([Buffer.from([4]), b64urlDec(jwk.x), b64urlDec(jwk.y)]));  // raw uncompressed
    privateKey = kp.privateKey.export({ type: 'pkcs8', format: 'pem' });
    setSetting('vapid_public', publicKey);
    setSetting('vapid_private', privateKey);
  }
  return { publicKey, privateKey };
}

// Header Authorization: vapid t=<JWT ES256>, k=<public key>
function vapidAuth(endpoint) {
  const { publicKey, privateKey } = getVapid();
  const aud = new URL(endpoint).origin;
  const head = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64url(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:support@digiplus' }));
  const unsigned = `${head}.${body}`;
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key: crypto.createPrivateKey(privateKey), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${b64url(sig)}, k=${publicKey}`;
}

// Mã hoá 1 bản ghi aes128gcm cho 1 subscription
export function encryptPayload(payload, p256dh, auth) {
  const uaPub = b64urlDec(p256dh);            // 65 bytes (client public key)
  const authSecret = b64urlDec(auth);         // 16 bytes
  const salt = crypto.randomBytes(16);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const serverPub = ecdh.getPublicKey();      // 65 bytes
  const shared = ecdh.computeSecret(uaPub);
  // IKM = HKDF(authSecret, shared, "WebPush: info\0"||uaPub||serverPub, 32)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'binary'), uaPub, serverPub]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'binary'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'binary'), 12));
  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([2])]);  // 0x02 = delimiter bản ghi cuối
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const enc = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096, 0);
  const header = Buffer.concat([salt, rs, Buffer.from([serverPub.length]), serverPub]);
  return Buffer.concat([header, enc]);
}

// Gửi 1 thông báo tới 1 subscription. Trả HTTP status.
async function sendOne(sub, payloadObj) {
  const body = encryptPayload(JSON.stringify(payloadObj), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidAuth(sub.endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
    },
    body,
  });
  return res.status;
}

/* ------------------------- Lưu / gửi subscription ------------------------- */
export function saveSubscription(employeeId, sub) {
  if (!sub || !sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('Subscription không hợp lệ');
  db.prepare(`INSERT INTO push_subscriptions(employee_id, endpoint, p256dh, auth) VALUES(?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET employee_id=excluded.employee_id, p256dh=excluded.p256dh, auth=excluded.auth`)
    .run(employeeId || null, sub.endpoint, sub.keys.p256dh, sub.keys.auth);
}
export function removeSubscription(endpoint) {
  if (endpoint) db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(endpoint);
}

// Gửi cho MỌI quản lý (admin/manager) đang bật thông báo. Bỏ qua người tự chấm (excludeId).
export async function notifyManagers(payloadObj, excludeId = null) {
  let subs;
  try {
    subs = db.prepare(`SELECT s.* FROM push_subscriptions s JOIN employees e ON e.id = s.employee_id
      WHERE e.active = 1 AND e.role IN ('admin','manager')`).all();
  } catch { return; }
  for (const s of subs) {
    if (excludeId && s.employee_id === excludeId) continue;
    try { const code = await sendOne(s, payloadObj); if (code === 404 || code === 410) removeSubscription(s.endpoint); }
    catch { /* bỏ qua lỗi mạng của 1 thiết bị */ }
  }
}
