#!/usr/bin/env bash
# =====================================================================
#  DIGIPLUS CHẤM CÔNG — BỘ CÀI LINUX (Ubuntu / Debian x64)
#  Làm đúng việc của Setup.exe bên Windows: lấy cấu hình khách từ máy chủ
#  Digiplus (tên miền + token tunnel), cài phần mềm, tự chạy khi bật máy.
#
#  Cách dùng trên VPS (quyền root):
#     curl -fsSL https://huongdan.maychamcongcloud.com/cai-linux | sudo bash
#  hoặc giải nén DigiplusChamCong-linux.tar.gz rồi:  sudo ./DigiplusChamCong/cai-dat.sh
#
#  Tuỳ chọn (bỏ trống thì script hỏi):
#     --slug <tenkhach>  khách trên trang Tạo khách (<tenkhach>.maychamcongcloud.com)
#     --port <cổng>      cổng app (khách mới / bản LAN)
#     --lan              bản KHÔNG tên miền, dùng trong mạng nội bộ
#     --may-chu <tên>    MÁY CHỦ NHIỀU CÔNG TY (vd vps1): 1 phần mềm + 1 tunnel cho mọi công ty tạo bằng
#                        link "Tạo công ty" trên điện thoại (cấu hình lấy từ trang nội bộ /may-chu)
#     --file <tar.gz>    dùng bộ cài có sẵn thay vì tải từ GitHub
#     --yes              tự đồng ý các câu hỏi Có/Không (dùng mặc định)
#  Mật khẩu cấp domain: script hỏi (gõ không hiện), hoặc đặt biến DIGIPLUS_PASS.
#  Nhiều khách trên 1 VPS: chạy lại script cho từng khách, mỗi khách 1 cổng + 1 thư mục.
# =====================================================================
set -euo pipefail

API_BASE="https://huongdan.maychamcongcloud.com"
PKG_URL="${DIGIPLUS_PKG_URL:-https://github.com/a1nhtu/chamcongcloud/releases/download/base/DigiplusChamCong-linux.tar.gz}"
ZONE="maychamcongcloud.com"
BASE_DIR="/opt/digiplus"
RUN_USER="digiplus"

SLUG=""; PORT=""; LAN=0; FILE=""; YES=0; HOST=""
while [ $# -gt 0 ]; do
  case "$1" in
    --slug) SLUG="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --lan)  LAN=1; shift ;;
    --may-chu) HOST="${2:-}"; shift 2 ;;
    --file) FILE="${2:-}"; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    -h|--help) sed -n '2,23p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "Tuỳ chọn không hiểu: $1"; exit 1 ;;
  esac
done

say()  { printf '%s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n  \033[31m✗ %s\033[0m\n\n' "$*" >&2; exit 1; }

# Đọc từ bàn phím kể cả khi script chạy kiểu "curl ... | bash" (stdin là nội dung script)
TTY=/dev/tty
has_tty() { [ -r "$TTY" ] && { : < "$TTY"; } 2>/dev/null; }
ask() {   # ask <biến> <câu hỏi> [mặc định]
  local __v="$1" __q="$2" __d="${3:-}" __a=""
  has_tty || { [ -n "$__d" ] && { printf -v "$__v" '%s' "$__d"; return; }; die "Thiếu thông tin: $__q (chạy có bàn phím hoặc truyền tuỳ chọn)"; }
  if [ -n "$__d" ]; then printf '  %s [%s]: ' "$__q" "$__d" > "$TTY"; else printf '  %s: ' "$__q" > "$TTY"; fi
  IFS= read -r __a < "$TTY" || true
  printf -v "$__v" '%s' "${__a:-$__d}"
}
ask_secret() {
  local __v="$1" __q="$2" __a=""
  has_tty || die "Thiếu $__q (đặt biến DIGIPLUS_PASS)"
  printf '  %s: ' "$__q" > "$TTY"; IFS= read -rs __a < "$TTY" || true; printf '\n' > "$TTY"
  printf -v "$__v" '%s' "$__a"
}
confirm() {   # confirm <câu hỏi> [c|k] (mặc định có)
  local d="${2:-c}" a=""
  [ "$YES" = 1 ] && { [ "$d" = c ]; return; }
  has_tty || { [ "$d" = c ]; return; }
  ask a "$1 (c/k)" "$d"
  case "${a,,}" in c|co|có|y|yes) return 0 ;; *) return 1 ;; esac
}

say ""
say "============================================"
say "   DIGIPLUS CHẤM CÔNG — CÀI ĐẶT TRÊN LINUX"
say "============================================"

# ---------- 0) Kiểm tra máy ----------
[ "$(id -u)" = 0 ] || die "Cần quyền root: chạy lại bằng sudo."
[ "$(uname -m)" = x86_64 ] || die "Bộ cài chỉ hỗ trợ máy 64-bit x86_64 (máy này là $(uname -m))."
command -v systemctl >/dev/null || die "Máy không có systemd — cần Ubuntu 20.04+ / Debian 11+."

# ---------- 1) Gói cần thiết: curl, bsdtar (đọc/ghi .zip cho sao lưu + cập nhật) ----------
need=()
command -v curl   >/dev/null || need+=(curl ca-certificates)
command -v bsdtar >/dev/null || need+=(libarchive-tools)
command -v ss     >/dev/null || need+=(iproute2)
if [ ${#need[@]} -gt 0 ]; then
  say "Đang cài gói hệ thống: ${need[*]} ..."
  if command -v apt-get >/dev/null; then
    apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${need[@]}" >/dev/null
  elif command -v dnf >/dev/null; then
    dnf install -y -q curl bsdtar iproute >/dev/null
  else die "Không tự cài được: ${need[*]}. Cài tay rồi chạy lại."; fi
fi
ok "Gói hệ thống đủ"

TMP="$(mktemp -d)"; chmod 700 "$TMP"
trap 'rm -rf "$TMP"' EXIT

# ---------- 2) Lấy bộ cài ----------
SELF_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; fi
if [ -n "$FILE" ]; then
  [ -f "$FILE" ] || die "Không thấy file $FILE"
  tar -xzf "$FILE" -C "$TMP"; SRC="$TMP/DigiplusChamCong"
elif [ -n "$SELF_DIR" ] && [[ "$SELF_DIR" != "$BASE_DIR"/* ]] && [ -x "$SELF_DIR/runtime/node" ] && [ -f "$SELF_DIR/app/server/index.js" ]; then
  # chạy từ thư mục bộ cài đã giải nén (KHÔNG phải thư mục đã cài trong /opt/digiplus — chạy lại từ đó thì tải bộ cài mới)
  SRC="$SELF_DIR"
else
  say "Đang tải bộ cài từ GitHub (khoảng 60 MB)..."
  curl -fL --retry 3 -o "$TMP/pkg.tar.gz" "$PKG_URL" || die "Tải bộ cài lỗi. Kiểm tra Internet của VPS rồi chạy lại."
  tar -xzf "$TMP/pkg.tar.gz" -C "$TMP"; SRC="$TMP/DigiplusChamCong"
fi
[ -f "$SRC/app/server/index.js" ] || die "Bộ cài hỏng (thiếu app/server/index.js)."
NODE="$SRC/runtime/node"
"$NODE" -v >/dev/null 2>&1 || die "Không chạy được Node trong bộ cài."
PKG_VER="$("$NODE" -p "require('$SRC/app/package.json').version")"
ok "Bộ cài phiên bản $PKG_VER"

# ---------- tiện ích ----------
cfg_val() { printf '%s\n' "$2" | tr -d '\r' | sed -n "s/^$1=//p" | head -n1; }
port_listening() { ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$1\$"; }
# Bản Digiplus KHÁC trên máy này đang ghi cổng $1 trong config.txt (bỏ qua thư mục $2)
port_owner_local() {
  local f d
  for f in "$BASE_DIR"/*/config.txt; do
    [ -f "$f" ] || continue; d="$(dirname "$f")"; [ "$d" = "${2:-}" ] && continue
    [ "$(tr -d '\r' < "$f" | sed -n 's/^PORT=//p' | head -n1)" = "$1" ] && { basename "$d"; return 0; }
  done; return 1
}
VPS_LIST=""   # "cổng slug" các khách VPS khác (theo máy chủ Digiplus)
port_owner_server() { printf '%s\n' "$VPS_LIST" | awk -v p="$1" '$1==p {print $2; exit}'; }
port_problem() {   # port_problem <cổng> <thư mục của chính khách này> → in lý do nếu không dùng được
  local o
  if ! [[ "$1" =~ ^[0-9]+$ ]] || [ "$1" -lt 1024 ] || [ "$1" -gt 65000 ]; then echo "cổng phải là số từ 1024 đến 65000"; return; fi
  if o="$(port_owner_local "$1" "$2")"; then echo "đã dùng cho bản Digiplus khác trên máy này ($o)"; return; fi
  o="$(port_owner_server "$1")"; [ -n "$o" ] && { echo "máy chủ Digiplus đã cấp cho khách VPS \"$o\""; return; }
  local own=""; [ -f "$2/config.txt" ] && own="$(tr -d '\r' < "$2/config.txt" | sed -n 's/^PORT=//p' | head -n1)"
  if [ "$1" != "$own" ] && port_listening "$1"; then echo "đang có chương trình khác dùng cổng này"; fi
}
next_free_port() { local p=8686; while [ -n "$(port_problem "$p" "${1:-}")" ]; do p=$((p+1)); done; echo "$p"; }

# Gọi API máy chủ Digiplus. Mật khẩu lấy từ biến DP_PASS, ghi body ra file (không lộ trên danh sách tiến trình)
HTTP=""; RESP=""
api() {   # api <đường dẫn> <json không có pass>
  DP_JSON="$2" "$NODE" -e 'const o=JSON.parse(process.env.DP_JSON);o.pass=process.env.DP_PASS||"";process.stdout.write(JSON.stringify(o))' > "$TMP/body.json"
  HTTP="$(curl -sS -m 60 -o "$TMP/resp" -w '%{http_code}' -H 'Content-Type: application/json' --data-binary @"$TMP/body.json" "$API_BASE$1" 2>/dev/null)" || HTTP="000"
  RESP="$(cat "$TMP/resp" 2>/dev/null || true)"; rm -f "$TMP/body.json"
}
json_num() { printf '%s' "$RESP" | sed -n "s/.*\"$1\":\([0-9]*\).*/\1/p" | head -n1; }
api_err() {
  case "$HTTP" in
    401) echo "Sai mật khẩu cấp domain." ;;
    403) echo "Đã hết hạn mức số tên miền. Liên hệ quản trị Digiplus." ;;
    400) echo "Tên khách không hợp lệ (chỉ chữ thường, số, gạch ngang)." ;;
    409) echo "Cổng đã cấp cho khách khác trên máy chủ Digiplus (gợi ý: $(json_num nextPort))." ;;
    000) echo "Không kết nối được máy chủ Digiplus — kiểm tra Internet của VPS." ;;
    *)   echo "Máy chủ báo lỗi (mã $HTTP). Thử lại sau ít phút." ;;
  esac
}

# ---------- 3) Chọn kiểu cài ----------
if [ "$LAN" = 0 ] && [ -z "$SLUG" ] && [ -z "$HOST" ]; then
  say ""
  say "  Kiểu cài:"
  say "    1) Có TÊN MIỀN <khách>.$ZONE  (khách đã tạo trên trang Tạo khách — dùng cho VPS)"
  say "    2) Bản LAN, không tên miền   (chỉ dùng trong mạng nội bộ)"
  say "    3) MÁY CHỦ NHIỀU CÔNG TY      (1 phần mềm cho nhiều công ty, tạo công ty bằng điện thoại)"
  ask kieu "Chọn" "1"
  [ "$kieu" = 2 ] && LAN=1
  [ "$kieu" = 3 ] && ask HOST "Tên máy chủ (vd: vps1)" "vps1"
fi

CFG=""
if [ -n "$HOST" ]; then
  # ----- Máy chủ nhiều công ty -----
  HOST="$(printf '%s' "$HOST" | tr 'A-Z' 'a-z' | tr -d ' ')"
  [[ "$HOST" =~ ^[a-z0-9]{1,20}$ ]] || die "Tên máy chủ chỉ gồm chữ thường không dấu + số (vd: vps1)."
  NAME="may-chu-$HOST"; DIR="$BASE_DIR/$NAME"
  OWN=""; [ -f "$DIR/config.txt" ] && OWN="$(tr -d '\r' < "$DIR/config.txt" | sed -n 's/^PORT=//p' | head -n1)"
  while :; do
    [ -n "$PORT" ] || ask PORT "Cổng phần mềm máy chủ" "${OWN:-$(next_free_port "$DIR")}"
    pp="$(port_problem "$PORT" "$DIR")"; [ -z "$pp" ] && break
    warn "Cổng $PORT $pp."; PORT=""; has_tty || exit 1
  done
  export DP_PASS="${DIGIPLUS_PASS:-}"
  for i in 1 2 3; do
    [ -n "$DP_PASS" ] || { ask_secret DP_PASS "Mật khẩu cấp domain"; export DP_PASS; }
    api /api/may-chu "{\"action\":\"host-config\",\"name\":\"$HOST\",\"port\":$PORT,\"plain\":true}"
    [ "$HTTP" = 200 ] && break
    warn "$(api_err)"; [ "$HTTP" = 401 ] && has_tty && [ -z "${DIGIPLUS_PASS:-}" ] && { DP_PASS=""; continue; }
    exit 1
  done
  [ "$HTTP" = 200 ] || die "Không lấy được cấu hình máy chủ."
  CFG="$RESP"
  printf '%s' "$CFG" | grep -q '^MULTI_TENANT=1' && printf '%s' "$CFG" | grep -q '^TUNNEL_TOKEN=.' || die "Máy chủ Digiplus trả cấu hình không hợp lệ."
  ok "Máy chủ $HOST — cổng $PORT"
elif [ "$LAN" = 1 ]; then
  # ----- Bản LAN -----
  [ -n "$PORT" ] || ask PORT "Cổng app" "$(next_free_port)"
  NAME="lan-$PORT"; DIR="$BASE_DIR/$NAME"
  pp="$(port_problem "$PORT" "$DIR")"; [ -z "$pp" ] || die "Cổng $PORT $pp."
  CFG="$(printf 'PORT=%s\nCUSTOMER=\nTUNNEL_TOKEN=\nUSE_DEVICE=1\nUSE_PHONE=1\n' "$PORT")"
else
  # ----- Bản có tên miền -----
  while :; do
    [ -n "$SLUG" ] || ask SLUG "Tên khách (vd: congtyabc)"
    SLUG="$(printf '%s' "$SLUG" | tr 'A-Z' 'a-z' | tr -d ' ')"
    [[ "$SLUG" =~ ^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?$ ]] && break
    warn "Tên khách chỉ gồm chữ thường, số, gạch ngang."; SLUG=""
    has_tty || exit 1
  done
  DIR="$BASE_DIR/$SLUG"; NAME="$SLUG"
  export DP_PASS="${DIGIPLUS_PASS:-}"
  for i in 1 2 3; do
    [ -n "$DP_PASS" ] || { ask_secret DP_PASS "Mật khẩu cấp domain"; export DP_PASS; }
    api /api/ds-khach "{\"slug\":\"$SLUG\",\"vpsPorts\":true}"
    [ "$HTTP" = 200 ] && { VPS_LIST="$RESP"; break; }
    warn "$(api_err)"; [ "$HTTP" = 401 ] && has_tty && [ -z "${DIGIPLUS_PASS:-}" ] && { DP_PASS=""; continue; }
    exit 1
  done
  [ "$HTTP" = 200 ] || die "Không xác thực được với máy chủ Digiplus."

  say "Đang lấy cấu hình khách $SLUG.$ZONE ..."
  api /api/tao-domain "{\"slug\":\"$SLUG\",\"plain\":true,\"vps\":true,\"onlyExisting\":true}"
  if [ "$HTTP" = 404 ]; then
    say ""
    say "  Chưa có khách \"$SLUG\" trên máy chủ Digiplus."
    confirm "Tạo MỚI tên miền $SLUG.$ZONE cho khách này?" c || die "Đã huỷ. Tạo khách trên trang Tạo khách rồi chạy lại."
    while :; do
      [ -n "$PORT" ] || ask PORT "Cổng app cho khách mới" "$(next_free_port "$DIR")"
      pp="$(port_problem "$PORT" "$DIR")"; [ -z "$pp" ] && break
      warn "Cổng $PORT $pp."; PORT=""; has_tty || exit 1
    done
    dev=true; phone=true
    confirm "Dùng MÁY CHẤM CÔNG (vân tay/khuôn mặt)?" c || dev=false
    confirm "Dùng chấm công bằng ĐIỆN THOẠI (ảnh + GPS)?" c || phone=false
    [ "$dev" = false ] && [ "$phone" = false ] && die "Phải chọn ít nhất 1 hình thức chấm công."
    api /api/tao-domain "{\"slug\":\"$SLUG\",\"plain\":true,\"vps\":true,\"mode\":\"vps\",\"port\":$PORT,\"localPort\":true,\"useDevice\":$dev,\"usePhone\":$phone}"
    [ "$HTTP" = 200 ] || die "$(api_err)"
    CFG="$RESP"
    [ "$(cfg_val PORT "$CFG")" = "$PORT" ] || die "Máy chủ chưa nhận cổng $PORT. Thử lại sau vài phút."
  elif [ "$HTTP" = 200 ]; then
    CFG="$RESP"; PORT="$(cfg_val PORT "$CFG")"
    pp="$(port_problem "$PORT" "$DIR")"
    if [ -n "$pp" ]; then
      warn "Khách $SLUG đang dùng cổng $PORT nhưng cổng này $pp."
      say  "  Đổi cổng thì tên miền $SLUG.$ZONE sẽ trỏ về cổng mới (máy khác đang chạy khách này sẽ mất tên miền)."
      confirm "Đổi sang cổng khác?" c || die "Đã huỷ."
      PORT=""
      while :; do
        ask PORT "Cổng mới" "$(next_free_port "$DIR")"
        pp="$(port_problem "$PORT" "$DIR")"; [ -z "$pp" ] && break
        warn "Cổng $PORT $pp."; has_tty || exit 1
      done
      api /api/tao-domain "{\"slug\":\"$SLUG\",\"plain\":true,\"vps\":true,\"onlyExisting\":true,\"setPort\":true,\"port\":$PORT}"
      [ "$HTTP" = 200 ] || die "$(api_err)"
      CFG="$RESP"
      [ "$(cfg_val PORT "$CFG")" = "$PORT" ] || die "Máy chủ chưa nhận cổng $PORT. Thử lại sau vài phút."
    fi
  else
    die "$(api_err)"
  fi
  printf '%s' "$CFG" | grep -q '^TUNNEL_TOKEN=.' || die "Máy chủ trả cấu hình không hợp lệ. Thử lại sau ít phút."
  ok "Khách $SLUG.$ZONE — cổng $PORT"
fi

SVC="digiplus-$NAME"; SVC_TUN="digiplus-$NAME-tunnel"

# ---------- 4) Cài file ----------
say "Đang cài vào $DIR ..."
for s in "$SVC" "$SVC_TUN"; do systemctl stop "$s" 2>/dev/null || true; done
mkdir -p "$DIR/app" "$DIR/runtime"
cp -f "$SRC/runtime/node" "$DIR/runtime/node"
cp -f "$SRC/cloudflared" "$DIR/cloudflared" 2>/dev/null || true
for f in chay-app.mjs cai-dat.sh go-cai-dat.sh kiem-tra.sh HUONG-DAN.txt; do [ -f "$SRC/$f" ] && cp -f "$SRC/$f" "$DIR/$f"; done
chmod 755 "$DIR/runtime/node" "$DIR"/*.sh "$DIR/cloudflared" 2>/dev/null || true

# Code app: nếu máy đang chạy bản MỚI hơn bộ cài (đã bấm Cập nhật) thì giữ code đang có
OLD_VER=""; [ -f "$DIR/app/package.json" ] && OLD_VER="$("$NODE" -p "require('$DIR/app/package.json').version" 2>/dev/null || true)"
newer() { "$NODE" -e 'const [a,b]=process.argv.slice(1).map(v=>v.split(".").map(Number));for(let i=0;i<3;i++){if((a[i]||0)!==(b[i]||0))process.exit((a[i]||0)>(b[i]||0)?0:1)}process.exit(1)' "$1" "$2"; }
if [ -n "$OLD_VER" ] && newer "$OLD_VER" "$PKG_VER"; then
  ok "Giữ code đang chạy bản $OLD_VER (mới hơn bộ cài $PKG_VER)"
else
  rm -rf "$DIR/app/server" "$DIR/app/public"
  cp -a "$SRC/app/server" "$SRC/app/public" "$SRC/app/package.json" "$DIR/app/"
  cp -a "$SRC/app/node_modules" "$DIR/app/"
  ok "Đã chép phần mềm bản $PKG_VER"
fi
# Dữ liệu cũ (app/data, app/uploads, app/certs) KHÔNG bị đụng tới

# config.txt: cấu hình mới; giữ các dòng riêng của bản cũ mà cấu hình mới không có (vd MASTER_USER, HTTPS_PORT)
printf '%s\n' "$CFG" | tr -d '\r' > "$TMP/config.new"
if [ -f "$DIR/config.txt" ]; then
  tr -d '\r' < "$DIR/config.txt" | while IFS= read -r line; do
    k="${line%%=*}"
    case "$line" in ''|\#*|\;*) continue ;; esac
    [[ "$line" == *=* ]] || continue
    grep -q "^$k=" "$TMP/config.new" || printf '%s\n' "$line" >> "$TMP/config.new"
  done
fi
install -m 600 "$TMP/config.new" "$DIR/config.txt"

# Tài khoản hệ thống riêng chạy app (không chạy bằng root)
id "$RUN_USER" >/dev/null 2>&1 || useradd --system --home-dir "$BASE_DIR" --no-create-home --shell /usr/sbin/nologin "$RUN_USER"
chown -R "$RUN_USER:$RUN_USER" "$DIR"
chmod 755 "$BASE_DIR"

# ---------- 5) Tự chạy khi bật máy (systemd) ----------
cat > "/etc/systemd/system/$SVC.service" <<EOF
[Unit]
Description=Digiplus Cham Cong - $NAME (cong $PORT)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_USER
WorkingDirectory=$DIR
ExecStart=$DIR/runtime/node --no-warnings $DIR/chay-app.mjs
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

HAS_TOKEN=0; printf '%s' "$CFG" | grep -q '^TUNNEL_TOKEN=.' && HAS_TOKEN=1
if [ "$HAS_TOKEN" = 1 ]; then
cat > "/etc/systemd/system/$SVC_TUN.service" <<EOF
[Unit]
Description=Digiplus Tunnel - $NAME ($NAME.$ZONE)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_USER
WorkingDirectory=$DIR
ExecStart=$DIR/runtime/node --no-warnings $DIR/chay-app.mjs --tunnel
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
else
  systemctl disable --now "$SVC_TUN" 2>/dev/null || true
  rm -f "/etc/systemd/system/$SVC_TUN.service"
fi

systemctl daemon-reload
systemctl enable --now "$SVC" >/dev/null 2>&1
[ "$HAS_TOKEN" = 1 ] && systemctl enable --now "$SVC_TUN" >/dev/null 2>&1
ok "Đã bật dịch vụ $SVC$([ "$HAS_TOKEN" = 1 ] && echo " + $SVC_TUN")"

# ---------- 6) Chờ app sẵn sàng ----------
say "Đang chờ phần mềm khởi động (lần đầu có thể mất 1 phút)..."
up=0
for i in $(seq 1 90); do
  if curl -fsS -m 3 "http://127.0.0.1:$PORT/api/version" >/dev/null 2>&1; then up=1; break; fi
  sleep 1
done
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

say ""
say "============================================"
if [ "$up" = 1 ]; then say "   CÀI ĐẶT XONG!"; else say "   ĐÃ CÀI — nhưng phần mềm chưa lên sau 90 giây"; fi
say "============================================"
if [ -n "$HOST" ]; then
  say "  Máy chủ nhiều công ty: $HOST  (cổng $PORT)"
  say "  Thư mục cài:  $DIR   — dữ liệu từng công ty: $DIR/app/data/tenants/<mã>"
  say "  Tạo công ty:  gửi link trên trang https://huongdan.$ZONE/may-chu (mục Link tạo công ty)"
  say "  Chuyển khách cũ trên VPS này vào: cùng trang, mục \"Chuyển khách cũ vào máy chủ\"."
else
[ "$HAS_TOKEN" = 1 ] && say "  Tên miền:     https://$NAME.$ZONE/admin   (đợi 1-2 phút để tunnel kết nối)"
say "  Trên VPS:     http://${IP:-<IP-VPS>}:$PORT/admin"
say "  Thư mục cài:  $DIR"
say "  Đăng nhập lần đầu: admin / admin123 → đổi mật khẩu ngay."
say "  Lần đầu mở trang quản lý sẽ hiện MÃ MÁY → gửi Digiplus cấp license."
fi
say ""
say "  Xem tình trạng / log:  sudo $DIR/kiem-tra.sh"
say "  Gỡ cài đặt:            sudo $DIR/go-cai-dat.sh"
if [ "$HAS_TOKEN" = 0 ] && command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
  say ""; warn "Tường lửa ufw đang bật: muốn vào từ máy khác trong mạng thì mở cổng:  sudo ufw allow $PORT/tcp"
fi
[ "$up" = 1 ] || { say ""; warn "Xem lỗi: sudo $DIR/kiem-tra.sh"; exit 1; }
say ""
