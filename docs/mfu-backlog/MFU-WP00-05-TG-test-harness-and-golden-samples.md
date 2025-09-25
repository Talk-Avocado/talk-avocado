---
title: "MFU-WP00-05-TG: Test Harness and Golden Samples"
sidebar_label: "WP00-05: TG Harness & Goldens"
date: 2025-09-25
status: planned
version: 1.0
audience: [developers, qa]
---

## MFU-WP00-05-TG: Test Harness and Golden Samples

## MFU Identification

- MFU ID: MFU-WP00-05-TG
- Title: Test Harness and Golden Samples
- Date Created: 2025-09-25
- Created By: TalkAvocado Team
- Work Package: WP00 — Foundations (Phase 1)
- Sprint: Phase 1 – Foundations

## MFU Definition

**Functional Description**:
Provide a curated media set with expected outputs (goldens) and a small e2e smoke test runner to validate the pipeline.

**Technical Scope**:

- Curate short media samples (mp4/mov)
- Expected outputs: durations, basic transcripts, cut plans
- CLI runner to execute pipeline on samples and compare key metrics

**Business Value**  
Gives fast feedback on regressions and validates MFUs end-to-end with minimal runtime.

### Migration Notes (replace interactive runner)

- Replace `podcast-automation/run-workflow.js` with `tools/harness/run-local-pipeline.js`:
  - Non-interactive CLI flags: `--env dev --tenant t-LOCAL --job j-<auto> --input <path>`
  - Seeds `./storage/{env}/{tenant}/{job}/input/` and invokes handlers via their module paths:
    - `backend/services/audio-extraction/handler.js`
    - `backend/services/transcription/handler.js`
    - `backend/services/smart-cut-planner/handler.js`
    - `backend/services/video-render-engine/handler.js`
  - Runs to completion with exit code 0/1 and concise stdout summary
- Goldens live under `podcast-automation/test-assets` during WP01, but compare against outputs in `./storage/{env}/{tenant}/{job}/...` so pathing matches production layout.

### Goldens Format

- `goldens/<sample>/manifest.json`: selected fields only (deep-compare subset)
- `goldens/<sample>/metrics.json`:
  - `audio.durationSec`
  - `transcript.wordCount`
  - `plan.cutsCount`
  - `render.durationSec`
- `goldens/<sample>/transcript.preview.txt`: first 200 chars, normalized whitespace

### Acceptance Criteria

- [ ] Runner executes migrated handlers end-to-end without prompts
- [ ] Produces pass/fail summary comparing actual outputs to goldens
- [ ] Exit code reflects result; suitable for CI lane usage

## Complexity Assessment

- Complexity: Medium
- Estimated Effort: 1 day
- Confidence: Medium

## Dependencies and Prerequisites

- Optional start after: MFU-WP00-02-BE

## Agent Execution Guide (Step-by-step)

1) Place samples under `podcast-automation/test-assets/raw/` (temporary during WP01)
2) Create `tools/harness/run-local-pipeline.js` (non-interactive) with flags above; default `--env dev --tenant t-local`
3) Define goldens under `podcast-automation/test-assets/goldens/<sample>/...`
4) Implement comparison logic: numeric tolerances (±0.1s durations), subset JSON equality, normalized text
5) Make CLI return non-zero on any mismatch; print diff summary

## Test Plan

- Run the harness on 1–2 short samples; expect pass/fail summary

## Success Metrics

- Harness runtime < 5 minutes per sample
- Deterministic pass/fail across runs

## Implementation Tracking

- Status: planned
- Assigned To: Team
- Start Date: 2025-09-25
- Target Completion: +1 day
- Actual Completion: TBC
