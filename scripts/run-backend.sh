#!/usr/bin/env bash
# Starts the backend on port 8787 (override with HIANIME_PORT).
set -euo pipefail
cd "$(dirname "$0")/../backend"
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo "HiAnime backend: enter ${IP:-<this computer's IP>}:${HIANIME_PORT:-8787} in the TV app's Settings."
echo "Browser preview: http://localhost:${HIANIME_PORT:-8787}/app/"
exec ../.venv/bin/python -m hianime_backend
