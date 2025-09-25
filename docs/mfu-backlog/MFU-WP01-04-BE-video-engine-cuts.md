---
title: "MFU-WP01-04-BE: Video Engine Cuts"
sidebar_label: "WP01-04: BE Video Cuts"
date: 2025-09-25
status: planned
version: 1.0
audience: [backend-engineers]
---

## MFU-WP01-04-BE: Video Engine Cuts

## MFU Identification

- MFU ID: MFU-WP01-04-BE
- Title: Video Engine Cuts
- Date Created: 2025-09-25
- Created By: TalkAvocado Team
- Work Package: WP01 — POC Pipeline
- Sprint: Phase 1 – Pipeline

## MFU Definition

**Functional Description**:
Apply `cut_plan.json` to source video; produce `renders/base_cuts.mp4` with frame-accurate cuts and A/V sync.

**Technical Scope**:

- Frame-accurate cuts at target fps
- A/V sync drift <= 50ms
- Manifest updated with render metadata

### Migration Notes (use existing handler)

- Use migrated `backend/services/video-render-engine/handler.js` (from `VideoRenderEngine/index.js`).
- Add explicit sync drift check: sample audio around each cut boundary; assert drift <= 50ms, otherwise fail job with diagnostic.
- Replace direct path usage with `backend/lib/storage.ts` helpers; write output to `renders/base_cuts.mp4` and update manifest via `backend/lib/manifest.ts`.

### Acceptance Criteria additions

- [ ] Sync drift measurement implemented and enforced (<= 50ms)
- [ ] Manifest updated with render metadata (`codec`, `durationSec`, `fps`)

**Business Value**  
Delivers the first usable edited video output, enabling further enhancements.

## Acceptance Criteria

- [ ] Output duration matches planned keep segments within ±1 frame
- [ ] A/V sync drift <= 50ms; manifest updated with render metadata

## Complexity Assessment

- Complexity: High
- Estimated Effort: 2 days
- Confidence: Medium

## Dependencies and Prerequisites

- Depends on: MFU-WP01-01-BE, MFU-WP01-03-BE

## Agent Execution Guide (Step-by-step)

1) Implement cut application using FFmpeg filters or timeline edits
2) Ensure frame-accurate boundaries; maintain fps/codec
3) Validate durations and sync; write to `renders/base_cuts.mp4`
4) Update manifest

## Test Plan

- Compare expected vs actual segment durations and overall length; check sync on cut boundaries

## Success Metrics

- Duration match within ±1 frame; sync drift <= 50ms

## Implementation Tracking

- Status: planned
- Assigned To: Team
- Start Date: 2025-09-25
- Target Completion: +2 days
- Actual Completion: TBC
