#!/usr/bin/env bash
# DIGIPLUS — GỠ CÀI ĐẶT 1 khách trên Linux (chỉ khách của THƯ MỤC NÀY, khách khác trên VPS không bị ảnh hưởng).
#   sudo ./go-cai-dat.sh              → tắt + bỏ tự chạy, GIỮ NGUYÊN dữ liệu (app/data, app/uploads)
#   sudo ./go-cai-dat.sh --xoa-het    → tắt + XOÁ LUÔN thư mục cài (mất hết dữ liệu khách này)
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Cần quyền root: chạy lại bằng sudo."; exit 1; }
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="$(basename "$DIR")"
SVC="digiplus-$NAME"; SVC_TUN="digiplus-$NAME-tunnel"

for s in "$SVC_TUN" "$SVC"; do
  systemctl disable --now "$s" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/$s.service"
done
systemctl daemon-reload
echo "Đã tắt và bỏ tự chạy: $SVC"

if [ "${1:-}" = "--xoa-het" ]; then
  printf 'XOÁ HẾT thư mục %s (mất toàn bộ dữ liệu khách này)? Gõ XOA để xác nhận: ' "$DIR"
  read -r a < /dev/tty || a=""
  if [ "$a" = "XOA" ]; then rm -rf "$DIR"; echo "Đã xoá $DIR"; else echo "Không xoá. Dữ liệu vẫn ở $DIR"; fi
else
  echo "Dữ liệu vẫn còn trong $DIR/app/data và $DIR/app/uploads."
  echo "Cài lại: chạy lại bộ cài với đúng tên khách → dữ liệu cũ được giữ."
fi
