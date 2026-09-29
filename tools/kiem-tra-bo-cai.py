# -*- coding: utf-8 -*-
"""
KIỂM TRA BỘ CÀI TRƯỚC KHI GIAO KHÁCH — chạy sau MỖI lần đóng gói lại.

Bắt các lỗi từng xảy ra (29/09/2026): bộ cài bị lẫn config/token/THONG-TIN của khách khác.
Soát thêm: mật khẩu master dạng chữ, khóa ký bản quyền (private.pem), token Cloudflare (cf.env),
file cấm (.env, master.env, license.key, *.db, data/, backups/, logs/, PASS_*), khóa PRIVATE KEY lạ.

Quy ước tên file trong dist-khach:
  lan-*.zip            -> bản LAN nội bộ: CUSTOMER rỗng, TUNNEL_TOKEN rỗng, không THONG-TIN.txt, không hd-worker.js
  <khach>-*.zip        -> bản riêng khách <khach>: config.txt phải GIỐNG HỆT tools/customers/<khach>/config.txt
Thư mục staging dist-khach/DigiplusChamCong phải luôn TRUNG TÍNH (không token, không THONG-TIN.txt).

Chạy:  python tools/kiem-tra-bo-cai.py      (hoặc bấm tools/KiemTra-BoCai.bat)
Kết quả: in OK / LỖI từng file, exit code 1 nếu có lỗi.
"""
import os, re, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DIST = os.path.join(ROOT, 'dist-khach')
CUSTOMERS = os.path.join(HERE, 'customers')
STAGING = os.path.join(DIST, 'DigiplusChamCong')
BS = chr(92)

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass


def parse_cfg(text):
    cfg = {}
    for line in text.replace('\r', '').split('\n'):
        if '=' in line:
            k, v = line.split('=', 1)
            cfg[k.strip()] = v.strip()
    return cfg


def load_customers():
    out = {}
    if os.path.isdir(CUSTOMERS):
        for slug in os.listdir(CUSTOMERS):
            p = os.path.join(CUSTOMERS, slug, 'config.txt')
            if os.path.isfile(p):
                out[slug] = parse_cfg(open(p, encoding='utf-8').read())
    return out


def load_secrets():
    """Đọc các bí mật trên máy để ĐỐI CHIẾU (không bao giờ in giá trị ra)."""
    sec = {}
    skip = {'sadmin', 'password', 'master', 'username', 'matkhau', 'digiplus'}
    d = os.path.join(ROOT, 'PASS_DIGIPLUSCHAMCONG_MASTER')
    if os.path.isdir(d):
        for f in os.listdir(d):
            try:
                t = open(os.path.join(d, f), encoding='utf-8', errors='ignore').read()
            except Exception:
                continue
            for w in re.split(r'[\s:=,;|"\']+', t):
                if len(w) >= 6 and w.lower() not in skip:
                    sec[w] = 'MẬT KHẨU MASTER (dạng chữ thô, chưa mã hóa)'
    p = os.path.join(HERE, 'keys', 'private.pem')
    if os.path.isfile(p):
        body = ''.join(l for l in open(p, encoding='utf-8', errors='ignore').read().splitlines() if '-----' not in l)
        if len(body) > 30:
            sec[body[:40]] = 'KHÓA KÝ BẢN QUYỀN (private.pem)'
    p = os.path.join(HERE, 'cf.env')
    if os.path.isfile(p):
        for line in open(p, encoding='utf-8', errors='ignore').read().splitlines():
            if '=' in line:
                k, v = line.split('=', 1)
                k, v = k.strip(), v.strip().strip('"\'')
                # chỉ biến bí mật thật (ZONE = tên miền, không phải bí mật)
                if len(v) >= 20 and re.search(r'TOKEN|KEY|SECRET|PASS', k, re.I):
                    sec[v] = f'{k} (cf.env)'
    return sec


FORBIDDEN = re.compile(
    r'(^|/)(\.env[^/]*|cf\.env|master\.env|license\.key|private\.pem|cloudflared\.log|server\.log)$'
    r'|(^|/)PASS_[^/]*(/|$)|(^|/)(data|backups|logs|\.git|tools)/'
    r'|\.(db|db-wal|db-shm|sqlite|sqlite3)$', re.I)


def check_secrets(z, secrets):
    errs, warns = [], []
    for r in z.namelist():
        n = r.replace(BS, '/')
        if 'node_modules/' in n:
            continue
        if FORBIDDEN.search(n):
            errs.append('file cấm có trong bộ cài: ' + n)
    for n, t in text_files(z):
        for s, label in secrets.items():
            if s in t:
                errs.append(f'LỘ {label} trong {n}')
        if 'PRIVATE KEY' in t and not n.endswith('app/certs/key.pem'):
            errs.append('có khóa riêng (PRIVATE KEY) lạ trong ' + n)
        if n.endswith('DigiplusChamCong/config.txt') and re.search(r'^\s*MASTER_(PASS|HASH|USER)\s*=', t, re.M):
            errs.append('config.txt có dòng MASTER_* (mật khẩu master không được đi theo bộ cài)')
        if n.endswith('server/auth.js') and 'DEFAULT_MASTER_HASH' in t:
            warns.append('auth.js có mã băm master mặc định (đã công khai trên GitHub; không phải mật khẩu thô — mật khẩu master phải đủ mạnh)')
    return errs, warns


def text_files(z):
    for r in z.namelist():
        n = r.replace(BS, '/')
        if 'node_modules/' in n or n.endswith(('.exe', '.dll', '.node', '.png', '.jpg', '.ico', '.woff', '.woff2', '.ttf')):
            continue
        try:
            yield n, z.read(r).decode('utf-8', 'ignore')
        except Exception:
            continue


def check_zip(path, customers, secrets=None):
    name = os.path.basename(path)
    errs = []
    z = zipfile.ZipFile(path)
    if z.testzip() is not None:
        errs.append('file zip bị hỏng')
    names = [r.replace(BS, '/') for r in z.namelist()]
    cfg_entries = [r for r in z.namelist() if r.replace(BS, '/').endswith('DigiplusChamCong/config.txt')]
    if not cfg_entries:
        return name, ['không có DigiplusChamCong/config.txt'], None, []
    cfg = parse_cfg(z.read(cfg_entries[0]).decode('utf-8', 'ignore'))
    has_info = any(n.endswith('DigiplusChamCong/THONG-TIN.txt') for n in names)

    if name.lower().startswith('lan-'):
        expect = '(bản LAN)'
        if cfg.get('CUSTOMER'):
            errs.append('bản LAN nhưng CUSTOMER=' + cfg['CUSTOMER'])
        if cfg.get('TUNNEL_TOKEN'):
            errs.append('bản LAN nhưng CÓ TUNNEL_TOKEN (lộ token!)')
        if has_info:
            errs.append('bản LAN nhưng có THONG-TIN.txt (thông tin khách khác)')
        if any(n.endswith('app/public/hd-worker.js') for n in names):
            errs.append('bản LAN còn hd-worker.js (danh sách đại lý)')
        if any(n.endswith(('cloudflared.exe', 'KiemTra-Tunnel.bat')) for n in names):
            errs.append('bản LAN còn file tunnel (cloudflared/KiemTra-Tunnel)')
        own = None
    else:
        own = name.split('-')[0].lower()
        expect = own
        if own not in customers:
            errs.append(f'không thấy hồ sơ tools/customers/{own}/config.txt để đối chiếu')
        else:
            want = customers[own]
            for k in ('PORT', 'CUSTOMER', 'TUNNEL_TOKEN'):
                if cfg.get(k, '') != want.get(k, ''):
                    shown = '(token khác)' if k == 'TUNNEL_TOKEN' else f"{cfg.get(k, '')} ≠ {want.get(k, '')}"
                    errs.append(f'config.txt sai {k}: {shown}')
        # token của khách khác lọt vào?
        for slug, c in customers.items():
            if slug != own and c.get('TUNNEL_TOKEN') and c['TUNNEL_TOKEN'] == cfg.get('TUNNEL_TOKEN'):
                errs.append(f'TUNNEL_TOKEN là của khách "{slug}" !!!')

    # tên khách khác xuất hiện trong file chữ
    others = [s for s in customers if s != own]
    for n, t in text_files(z):
        low = t.lower()
        for s in others:
            if s.lower() in low:
                errs.append(f'nhắc tên khách "{s}" trong {n}')
        for slug, c in customers.items():
            tok = c.get('TUNNEL_TOKEN')
            if slug != own and tok and len(tok) > 20 and tok in t:
                errs.append(f'chứa TOKEN của khách "{slug}" trong {n}')
    se, sw = check_secrets(z, secrets or {})
    errs += se
    return name, sorted(set(errs)), expect, sorted(set(sw))


def check_staging():
    errs = []
    p = os.path.join(STAGING, 'config.txt')
    if os.path.isfile(p):
        cfg = parse_cfg(open(p, encoding='utf-8').read())
        if cfg.get('TUNNEL_TOKEN'):
            errs.append('staging config.txt đang CÓ TUNNEL_TOKEN (của khách ' + (cfg.get('CUSTOMER') or '?') + ')')
        if cfg.get('CUSTOMER'):
            errs.append('staging config.txt đang đặt CUSTOMER=' + cfg['CUSTOMER'])
    if os.path.isfile(os.path.join(STAGING, 'THONG-TIN.txt')):
        errs.append('staging còn THONG-TIN.txt của khách')
    return errs


def main():
    customers = load_customers()
    secrets = load_secrets()
    bad = 0
    print('=== KIỂM TRA BỘ CÀI trong', DIST)
    print('Hồ sơ khách:', ', '.join(sorted(customers)) or '(trống)', '| số bí mật dùng để đối chiếu:', len(secrets))
    st = check_staging()
    print(('[LỖI] ' if st else '[OK]  ') + 'Thư mục staging DigiplusChamCong')
    for e in st:
        print('       - ' + e)
    bad += bool(st)
    for f in sorted(os.listdir(DIST)):
        p = os.path.join(DIST, f)
        if f.lower().endswith('.zip'):
            name, errs, expect, warns = check_zip(p, customers, secrets)
            print(('[LỖI] ' if errs else '[OK]  ') + f'{name}  → dành cho: {expect}')
            for e in errs:
                print('       - ' + e)
            for w in warns:
                print('       (lưu ý) ' + w)
            bad += bool(errs)
        elif f.lower().endswith(('.rar', '.7z')):
            print(f'[??]  {f}  → không đọc được định dạng này, tự mở kiểm tra config.txt bằng tay')
    print('=== KẾT QUẢ:', 'CÓ LỖI — KHÔNG GỬI KHÁCH!' if bad else 'TẤT CẢ OK, gửi khách được.')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
