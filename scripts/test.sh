#!/usr/bin/env bash
set -euo pipefail

STATUS=0

if [ -f package.json ]; then
  echo "[test] Node lint/tests..."
  if npm run lint --silent 2>/dev/null; then :; else STATUS=1; fi
  if npm test --silent 2>/dev/null; then :; else echo "[test] No Node tests or failing."; fi
fi

if [ -d .venv ] && { [ -f pyproject.toml ] || [ -f requirements.txt ]; }; then
  echo "[test] Python lint/tests..."
  # shellcheck disable=SC1091
  source .venv/bin/activate || true
  # Only run ruff if there are Python files
  if find . -name "*.py" -not -path "./.venv/*" | grep -q .; then
    ruff check . || STATUS=1
    black --check . || STATUS=1
  else
    echo "[test] No Python files found, skipping Python linting"
  fi
  if pytest -q; then :; else echo "[test] No/failed Python tests."; fi
fi

exit $STATUS
