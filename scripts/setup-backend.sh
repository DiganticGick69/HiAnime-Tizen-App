#!/usr/bin/env bash
# One-time setup: Python venv, dependencies and the Playwright build of Firefox.
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v uv >/dev/null 2>&1; then
    uv venv .venv
    uv pip install --python .venv/bin/python -r backend/requirements.txt
else
    python3 -m venv .venv || {
        echo "python3-venv is missing. Install it (sudo apt install python3-venv) or install uv." >&2
        exit 1
    }
    .venv/bin/pip install -r backend/requirements.txt
fi

# Headless Firefox used to open episode players. On a fresh Debian/Ubuntu/Raspberry Pi OS
# install, run `sudo .venv/bin/python -m playwright install-deps firefox` once as well.
.venv/bin/python -m playwright install firefox
echo "Done. Start the backend with ./scripts/run-backend.sh"
