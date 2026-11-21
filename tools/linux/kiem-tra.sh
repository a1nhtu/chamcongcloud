#!/usr/bin/env bash
# DIGIPLUS — XEM TÌNH TRẠNG 1 khách trên Linux: dịch vụ có chạy không, phiên bản, tunnel, log lỗi gần nhất.
#   sudo ./kiem-tra.sh
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="$(basename "$DIR")"
SVC="digiplus-$NAME"; SVC_TUN="digiplus-$NAME-tunnel"
CFG="$(tr -d '\r' < "$DIR/config.txt" 2>/dev/null)"
PORT="$(printf '%s\n' "$CFG" | sed -n 's/^PORT=//p' | head -n1)"

echo "=== Digiplus — $NAME (cổng ${PORT:-?}) ==="
printf 'Phần mềm : %s\n' "$(systemctl is-active "$SVC" 2>/dev/null)"
if systemctl cat "$SVC_TUN" >/dev/null 2>&1; then printf 'Tunnel   : %s\n' "$(systemctl is-active "$SVC_TUN" 2>/dev/null)"; else echo "Tunnel   : (bản LAN — không có)"; fi
if printf '%s\n' "$CFG" | grep -q '^MULTI_TENANT=1'; then
  # Máy chủ nhiều công ty: /api/version cần tên miền công ty (127.0.0.1 → 404) → hỏi /_host/ping bằng HOST_TOKEN
  # (token đưa qua stdin, không lộ trên danh sách tiến trình)
  tok="$(printf '%s\n' "$CFG" | sed -n 's/^HOST_TOKEN=//p' | head -n1)"
  v="$(printf 'Authorization: Bearer %s\n' "$tok" | curl -fsS -m 3 -H @- "http://127.0.0.1:${PORT:-8686}/_host/ping" 2>/dev/null)"
else
  v="$(curl -fsS -m 3 "http://127.0.0.1:${PORT:-8686}/api/version" 2>/dev/null)"
fi
echo "Phiên bản: ${v:-không trả lời trên cổng ${PORT:-?}}"
echo
echo "--- Log hệ thống phần mềm (20 dòng cuối) ---"
journalctl -u "$SVC" -n 20 --no-pager 2>/dev/null
if systemctl cat "$SVC_TUN" >/dev/null 2>&1; then
  echo; echo "--- Log tunnel (10 dòng cuối; thấy \"Registered tunnel connection\" = OK) ---"
  journalctl -u "$SVC_TUN" -n 10 --no-pager 2>/dev/null
fi
if [ -f "$DIR/app/data/logs/server.log" ]; then
  echo; echo "--- app/data/logs/server.log (20 dòng cuối) ---"
  tail -n 20 "$DIR/app/data/logs/server.log"
fi
echo
echo "Khởi động lại:  sudo systemctl restart $SVC"
