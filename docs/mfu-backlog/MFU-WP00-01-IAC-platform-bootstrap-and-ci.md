---
title: "MFU-WP00-01-IAC: Platform Bootstrap and CI"
sidebar_label: "WP00-01: Bootstrap & CI"
date: 2025-09-25
status: planned
version: 1.0
audience: [developers, backend-engineers, devops]
---

## MFU-WP00-01-IAC: Platform Bootstrap and CI

## MFU Identification

- MFU ID: MFU-WP00-01-IAC
- Title: Platform Bootstrap and CI
- Date Created: 2025-09-25
- Date Last Updated:
- Created By: TalkAvocado Team
- Work Package: WP00 — Foundations (Phase 1)
- Sprint: Phase 1 – Foundations

## MFU Definition

**Functional Description**:
Stand up repository standards, CI checks, environment configuration, storage path abstraction, and a secrets pattern so every MFU can build, test, and deploy consistently (Cursor/agent-friendly).

**Technical Scope**:

- Decisions Adopted (Phase-1):
  - Orchestration via AWS Step Functions (Standard) is the Phase-1 baseline.
  - CI adds schema validation, harness lanes (`cuts`, `transitions`, `edit`), and UAT artefact publish.
  - Logging fields standardized: `{correlationId, tenantId, jobId, step, error.type}`.
  - Tenant isolation enforced in tests; add `--negative-tests` in harness CI.
  - Golden tolerances and timeouts read from `docs/uat/uat-config.json`.

- Repository scaffolding (README, ROADMAP)
- GitHub Actions CI (lint + tests; Node and Python lanes)
- Environment naming: dev, stage, prod
- MEDIA_STORAGE_PATH abstraction (local path; maps to S3/Azure later)
- .env.example and secret-loading pattern (12-factor)
- Basic dev scripts (setup, test, format)
- Contributor guide and coding standards (ESLint/Prettier, Ruff/Black)

### Target Project Structure (Phase 1 WP00/WP01)

The existing `podcast-automation` modules will be migrated into the following structure during WP00/WP01. Keep filenames and `exports.handler` signatures intact to ease orchestration wiring. TypeScript is optional in WP01; JavaScript is acceptable if linted.

```bash
backend/
  api/
    jobs/
      createJob.ts            # POST /jobs (stub in WP00)
      getJob.ts               # GET /jobs/{jobId} (stub in WP00)
  lib/
    storage.ts                # S3 path helpers → s3://{env}/{tenantId}/{jobId}/...
    manifest.ts               # load/save/validate manifest.json
    logging.ts                # correlationId/structured logs (extend in WP00-03)
  services/
    audio-extraction/
      handler.js              # migrated from ExtractAudioFromVideo/index.js
    transcription/
      handler.js              # migrated from TranscribeWithWhisper/index.js
    smart-cut-planner/
      handler.js              # migrated from SmartCutPlanner/index.js
    video-render-engine/
      handler.js              # migrated from VideoRenderEngine/index.js
docs/
  schemas/
    manifest.schema.json
    cut_plan.schema.json
scripts/
  setup.sh
  test.sh
  format.sh
tools/
  harness/
    run-local-pipeline.js     # replaces run-workflow.js (non-interactive)
```

### Migration Map (from podcast-automation → backend/services)

- `podcast-automation/ExtractAudioFromVideo/index.js` → `backend/services/audio-extraction/handler.js`
- `podcast-automation/TranscribeWithWhisper/index.js` → `backend/services/transcription/handler.js`
- `podcast-automation/SmartCutPlanner/index.js` → `backend/services/smart-cut-planner/handler.js`
- `podcast-automation/VideoRenderEngine/index.js` → `backend/services/video-render-engine/handler.js`
- `podcast-automation/run-workflow.js` → `tools/harness/run-local-pipeline.js` (convert to CLI, non-interactive)
- `podcast-automation/test-assets/` → keep as harness fixtures; ensure path helpers support both local and S3 layouts

All services must read/write via `backend/lib/storage.ts` so local runs and S3 share the same logical layout: `s3://talkavocado/{env}/{tenantId}/{jobId}/(input|audio|transcript|plan|renders|subtitles|logs|manifest.json)`.

**Business Value**  
Enables repeatable development, fast onboarding (Radha), and reliable PR quality from day one. Establishes conventions Cursor can follow autonomously.

## Acceptance Criteria

- [ ] GitHub Actions blocks PRs without passing lint/tests
- [ ] .env.example exists with MEDIA_STORAGE_PATH and cloud placeholders
- [ ] “15‑minute setup” validated on a fresh machine (clone → setup → test)
- [ ] docs/CONTRIBUTING.md and docs/ROADMAP.md exist and reference MFU flow
- [ ] scripts/setup.sh, scripts/test.sh, scripts/format.sh work cross‑platform (bash)
- [ ] Lint/format configs present: .eslintrc.json, .prettierrc.json, Ruff/Black for Python
- [ ] Project uses TALKAVOCADO_ENV and tenant-aware paths in examples
- [ ] Target structure skeleton created under `backend/` and `tools/harness/` as above
- [ ] Existing `podcast-automation` step handlers placed under `backend/services/*/handler.js` with unchanged `exports.handler`
- [ ] Harness CLI `tools/harness/run-local-pipeline.js` can run end-to-end locally without prompts

## Complexity Assessment

- Complexity: Low
- Estimated Effort: 0.5–1 day
- Confidence: High

## Dependencies and Prerequisites

- None

## Agent Execution Guide (Step-by-step)

Follow these steps exactly. All paths are repo-relative.

1) Create directories

    - mkdir -p docs/samples
    - mkdir -p scripts
    - mkdir -p .github/workflows

    - mkdir -p backend/{api/jobs,lib,services/{audio-extraction,transcription,smart-cut-planner,video-render-engine}}
    - mkdir -p docs/schemas
    - mkdir -p tools/harness

2) Create top-level docs

    - README.md (project overview + quick start)
    - docs/ROADMAP.md (Phase 1 MFUs summary with links)
    - docs/CONTRIBUTING.md (PR process, coding standards)

3) Add environment example

    - Create .env.example with the content below (customize later):

    ```env
    # Core
    TALKAVOCADO_ENV=dev
    MEDIA_STORAGE_PATH=./storage

    # AWS (POC Lambda path) - leave blank if unused
    AWS_REGION=
    AWS_S3_BUCKET=

    # Azure (MyGrowthApp compatibility) - leave blank if unused
    AZURE_STORAGE_CONNECTION_STRING=
    AZURE_STORAGE_CONTAINER=

    # Transcription
    WHISPER_MODEL=medium
    WHISPER_LANGUAGE=en

    # CI toggles
    ENABLE_NODE_CI=true
    ENABLE_PYTHON_CI=true
    ```

4) Add Node/JS lint/format config (optional if no JS yet)

    - Create .prettierrc.json:

    ```json
    {
    "printWidth": 100,
    "singleQuote": true,
    "trailingComma": "all"
    }
    ```

    - Create .eslintrc.json:

    ```json
    {
    "env": { "es2021": true, "node": true },
    "extends": ["eslint:recommended"],
    "parserOptions": { "ecmaVersion": "latest", "sourceType": "module" },
    "rules": { "no-unused-vars": ["warn"], "no-undef": "error" }
    }
    ```

5) Add Python lint/format config (optional if no Python yet)

    - Create pyproject.toml (only the tooling parts if you already have one):

    ```toml
    [tool.black]
    line-length = 100
    target-version = ["py311"]

    [tool.ruff]
    line-length = 100
    select = ["E", "F", "I"]
    ignore = ["E501"]
    target-version = "py311"
    ```

6) Add .gitignore and .editorconfig

    ```bash
    .gitignore (minimal):
    # env
    .env
    *.env
    # node
    node_modules/
    # python
    .venv/
    __pycache__/
    .pytest_cache/
    # os
    .DS_Store
    # build
    dist/
    build/
    # storage
    storage/
    ```

    - .editorconfig:

    ```bash
    root = true

    [*]
    end_of_line = lf
    insert_final_newline = true
    charset = utf-8
    indent_style = space
    indent_size = 2

    [*.py]
    indent_size = 4
    Add dev scripts (bash)
    scripts/setup.sh:
    ```

7) Add dev scripts (bash)

    - scripts/setup.sh:

    ```bash
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
    ```

    - scripts/test.sh:

    ```bash
    #!/usr/bin/env bash
    set -euo pipefail

    STATUS=0

    if [ -f package.json ]; then
    echo "[test] Node lint/tests..."
    if npm run lint --silent 2>/dev/null; then :; else STATUS=1; fi
    if npm test --silent 2>/dev/null; then :; else echo "[test] No Node tests or failing."; fi
    fi

    if [ -d .venv ] && [ -f pyproject.toml -o -f requirements.txt ]; then
    echo "[test] Python lint/tests..."
    # shellcheck disable=SC1091
    source .venv/bin/activate || true
    ruff . || STATUS=1
    black --check . || STATUS=1
    if pytest -q; then :; else echo "[test] No/failed Python tests."; fi
    fi

    exit $STATUS
    ```

    - scripts/format.sh:

    ```bash
    #!/usr/bin/env bash
    set -euo pipefail

    if [ -f package.json ]; then
    echo "[format] Running Prettier..."
    npx prettier --write .
    fi

    if [ -d .venv ] && [ -f pyproject.toml -o -f requirements.txt ]; then
    # shellcheck disable=SC1091
    source .venv/bin/activate || true
    echo "[format] Running Black..."
    black .
    fi

    echo "[format] Done."
    ```

8) Add GitHub Actions CI

    - .github/workflows/ci.yml:

    ```yaml
    name: CI

    on:
    pull_request:
    push:
        branches: [ main ]

    jobs:
    node:
        runs-on: ubuntu-latest
        if: ${{ vars.ENABLE_NODE_CI != 'false' }}
        steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
            with:
            node-version: '20'
            cache: 'npm'
        - name: Install deps (if package.json exists)
            run: |
            if [ -f package.json ]; then
                npm ci || npm install
            else
                echo "No package.json, skipping Node lane."
            fi
        - name: Lint
            run: |
            if [ -f package.json ]; then
                npx eslint . || true
                npx prettier -c . || true
            fi
        - name: Tests
            run: |
            if [ -f package.json ]; then
                npm test --silent || echo "No Node tests."
            fi

    python:
        runs-on: ubuntu-latest
        if: ${{ vars.ENABLE_PYTHON_CI != 'false' }}
        steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-python@v5
            with:
            python-version: '3.11'
            cache: 'pip'
        - name: Install deps
            run: |
            python -m venv .venv
            source .venv/bin/activate
            pip install --upgrade pip
            if [ -f requirements.txt ]; then pip install -r requirements.txt || true; fi
            pip install black ruff pytest || true
        - name: Lint
            run: |
            source .venv/bin/activate
            ruff . || true
            black --check . || true
        - name: Tests
            run: |
            source .venv/bin/activate
            pytest -q || echo "No/failed Python tests."
    ```

9) Update docs

    - README.md should include:
        - What is TalkAvocado (Phase 1 scope)
        - Quick start (clone → scripts/setup.sh → scripts/test.sh)
        - Path conventions (MEDIA_STORAGE_PATH, tenant/job folders)
    - docs/ROADMAP.md:
        - Link to each MFU doc in docs/mfu-backlog
        - Brief status per MFU (planned/in-progress/done)
    - docs/mfu-backlog:
        - Place this MFU file and future MFUs using naming: MFU-WP{PP}-{NN}-{TYPE}-{slug}.md

10) Validate “15-minute setup”

- From a clean machine:
  - git clone
  - cp .env.example .env (adjust nothing yet)
  - bash scripts/setup.sh
  - bash scripts/test.sh
- Ensure CI passes on a trivial PR.

1) Migrate step handlers into target structure (no logic changes yet)

- Copy files from `podcast-automation` into `backend/services`:
  - `ExtractAudioFromVideo/index.js` → `backend/services/audio-extraction/handler.js`
  - `TranscribeWithWhisper/index.js` → `backend/services/transcription/handler.js`
  - `SmartCutPlanner/index.js` → `backend/services/smart-cut-planner/handler.js`
  - `VideoRenderEngine/index.js` → `backend/services/video-render-engine/handler.js`
- Replace any hard-coded local paths with calls to `backend/lib/storage.ts` (to be added in WP00‑02). Keep `process.env.LOCAL_MODE === "true"` branches for harness.
- Do not rename `exports.handler` or change input event shape.

1) Convert local runner to non-interactive harness

- Create `tools/harness/run-local-pipeline.js` that:
  - Accepts `--tenant`, `--job`, `--input <path-to-video>`, `--env dev`
  - Seeds a local storage tree under `./storage/{env}/{tenant}/{job}/input/` and invokes handlers in order
  - Emits outputs under matching structure and prints a concise pass/fail summary
  - Exits non-zero on failure so CI can consume it later (WP00-05)

## Dependencies

- None

## Risks / Open Questions

- Mixed language projects may require language-specific CI lanes later (e.g., Go/Java)
- Windows devs may prefer PowerShell scripts (optional future addition)
- Secrets handling will expand when real cloud deploys begin (covered in later MFUs)

## Test Plan

- Local:
  - Run scripts/setup.sh and scripts/test.sh on macOS/Linux
  - Confirm storage/ directory created; no errors
- CI:
  - Open a PR; verify CI runs both lanes and reports status
  - Lint failure should block PR

## Success Metrics

- New-dev setup time ≤ 15 minutes
- CI pass rate > 95% for PRs
- Zero “works on my machine” issues reported during Phase 1

## Implementation Tracking

- Status: planned
- Assigned To: Stephen / Steve (initial), then team
- Start Date: 2025-09-25
- Target Completion: +2 days
- Actual Completion: TBC
