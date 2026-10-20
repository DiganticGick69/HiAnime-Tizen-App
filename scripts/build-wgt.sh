#!/usr/bin/env bash
# Package the Tizen app and (optionally) install it on the TV.
#
#   ./scripts/build-wgt.sh                    # build HiAnime.wgt
#   ./scripts/build-wgt.sh 192.168.1.40       # build, then install on the TV at that IP
#   APP_DIR=tv-playback-test ./scripts/build-wgt.sh 192.168.1.40   # the playback test app
#
# Needs Tizen Studio's CLI (`tizen`, `sdb`) on PATH and a Samsung certificate
# profile created in Tizen Studio's Certificate Manager (TV apps must be signed
# with a Samsung distributor certificate that lists your TV's DUID).
set -euo pipefail
cd "$(dirname "$0")/.."

PROFILE="${TIZEN_PROFILE:-HiAnime}"
APP_DIR="${APP_DIR:-tizen-app}"
NAME=$( [ "$APP_DIR" = tizen-app ] && echo HiAnime || echo "$(basename "$APP_DIR")" )
TV_IP="${1:-}"
OUT=build

command -v tizen >/dev/null || { echo "tizen CLI not found. Add ~/tizen-studio/tools/ide/bin to PATH." >&2; exit 1; }

rm -rf "$OUT" && mkdir -p "$OUT"
cp -r "$APP_DIR"/. "$OUT/"
tizen package -t wgt -s "$PROFILE" -- "$OUT"
WGT=$(ls "$OUT"/*.wgt | head -1)
mv "$WGT" "$NAME.wgt"
echo "Built $NAME.wgt"

if [ -n "$TV_IP" ]; then
    command -v sdb >/dev/null || PATH="$PATH:$HOME/tizen-studio/tools"
    sdb connect "$TV_IP:26101"
    DEVICE=$(sdb devices | awk 'NR>1 && /device/ {print $3; exit}')
    tizen install -n "$NAME.wgt" -t "$DEVICE"
    echo "Installed on $DEVICE. Launch it from the TV's Apps screen."
fi
