#!/usr/bin/env bash
set -euo pipefail

if [ -f package.json ]; then
  echo "[format] Running Prettier..."
  npx prettier --write .
fi

if [ -d .venv ] && { [ -f pyproject.toml ] || [ -f requirements.txt ]; }; then
  # shellcheck disable=SC1091
  source .venv/bin/activate || true
  # Only run black if there are Python files
  if find . -name "*.py" -not -path "./.venv/*" | grep -q .; then
    echo "[format] Running Black..."
    black .
  else
    echo "[format] No Python files found, skipping Black"
  fi
fi

echo "[format] Done."
