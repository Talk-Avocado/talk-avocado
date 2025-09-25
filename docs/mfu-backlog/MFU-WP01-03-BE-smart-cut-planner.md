---
title: "MFU-WP01-03-BE: Smart Cut Planner"
sidebar_label: "WP01-03: BE Smart Cut Planner"
date: 2025-09-25
status: planned
version: 1.0
audience: [backend-engineers]
---

## MFU-WP01-03-BE: Smart Cut Planner

## MFU Identification

- MFU ID: MFU-WP01-03-BE
- Title: Smart Cut Planner
- Date Created: 2025-09-25
- Created By: TalkAvocado Team
- Work Package: WP01 — POC Pipeline
- Sprint: Phase 1 – Pipeline

## MFU Definition

**Functional Description**:
Produce `plan/cut_plan.json` from transcript using silence thresholds and filler words; deterministic output.

**Technical Scope**:

- Configurable thresholds via manifest (e.g., `minPauseMs`, `fillerWords[]`)
- Deterministic output; includes reasons and keep/cut segments
- `plan/cut_plan.json` validates against schema; manifest updated

### Migration Notes (use existing handler)

- Use migrated `backend/services/smart-cut-planner/handler.js` (from `SmartCutPlanner/index.js`).
- Publish `docs/schemas/cut_plan.schema.json` and validate output before save.
- Add deterministic mode for CI (disable non-deterministic GPT steps; rely on rule-based filters only) when `DETERMINISTIC=true`.
- Replace direct path usage with `backend/lib/storage.ts` helpers and update manifest via `backend/lib/manifest.ts`.

### Acceptance Criteria additions

- [ ] Output conforms to `cut_plan.schema.json` (schema validation step passes)
- [ ] Deterministic mode produces identical `plan/cut_plan.json` across runs

**Business Value**  
Automates editing decisions to accelerate rendering while keeping results reproducible.

## Acceptance Criteria

- [ ] Configurable thresholds via manifest
- [ ] Deterministic output; segments include reasons and keep/cut
- [ ] Schema validation on `plan/cut_plan.json`; manifest updated

## Complexity Assessment

- Complexity: Medium
- Estimated Effort: 1 day
- Confidence: Medium

## Dependencies and Prerequisites

- Depends on: MFU-WP01-02-BE

## Agent Execution Guide (Step-by-step)

1) Define plan schema and config surface in manifest
2) Implement planner logic; ensure deterministic behavior given same input/config
3) Validate `cut_plan.json` against schema; write to `plan/`
4) Update manifest and integrate into orchestration

## Test Plan

- Use transcript fixture with known pauses/fillers → expected cut plan matches goldens

## Success Metrics

- 100% deterministic for same inputs

## Implementation Tracking

- Status: planned
- Assigned To: Team
- Start Date: 2025-09-25
- Target Completion: +1 day
- Actual Completion: TBC
