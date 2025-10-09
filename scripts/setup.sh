#!/usr/bin/env bash
set -euo pipefail

# Node setup (optional)
if [ -f package.json ]; then
  echo "[setup] Installing Node deps..."
  npm ci || npm install
fi

# Python setup (optional)
if [ -f requirements.txt ] || [ -f pyproject.toml ]; then
  echo "[setup] Creating Python venv..."
  python3 -m venv .venv
  # shellcheck disable=SC1091
  source .venv/bin/activate
  pip install --upgrade pip
  if [ -f requirements.txt ]; then pip install -r requirements.txt || true; fi
  pip install black ruff pytest || true
fi

echo "[setup] Creating local storage path..."
mkdir -p storage
echo "[setup] Done."
