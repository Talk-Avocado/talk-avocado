---
title: "MFU-WP01-05-BE: Video Engine Transitions"
sidebar_label: "WP01-05: BE Transitions"
date: 2025-09-25
status: planned
version: 1.0
audience: [backend-engineers]
---

## MFU-WP01-05-BE: Video Engine Transitions

## MFU Identification

- MFU ID: MFU-WP01-05-BE
- Title: Video Engine Transitions
- Date Created: 2025-09-25
- Created By: TalkAvocado Team
- Work Package: WP01 — POC Pipeline
- Sprint: Phase 1 – Pipeline

## MFU Definition

**Functional Description**:
Add transitions (default crossfade, configurable duration/type) between segments; output `renders/with_transitions.mp4`.

**Technical Scope**:

- Transitions applied per plan or default; fps/codec maintained
- No additional audio drift; manifest updated

### Migration Notes (extend existing handler)

- Extend `backend/services/video-render-engine/handler.js` to apply transitions at joins:
  - Default crossfade (configurable duration, e.g., 300ms) using FFmpeg filtergraph
  - Maintain fps/codec; ensure audio/video transition alignment
- Add config surface in manifest (e.g., `transitions: { type: "crossfade", durationMs: 300 }`).
- Write output to `renders/with_transitions.mp4`; update manifest.

### Acceptance Criteria additions

- [ ] Crossfade transitions applied at segment joins with configured duration
- [ ] No added audio drift after transitions (validate against base cut)

**Business Value**  
Improves watchability and polish for the edited video.

## Acceptance Criteria

- [ ] Transitions applied per plan or default; fps/codec maintained
- [ ] No additional audio drift; manifest updated

## Complexity Assessment

- Complexity: Medium
- Estimated Effort: 1–2 days
- Confidence: Medium

## Dependencies and Prerequisites

- Depends on: MFU-WP01-04-BE

## Agent Execution Guide (Step-by-step)

1) Implement transitions (e.g., crossfade) at segment joins
2) Maintain fps/codec; write to `renders/with_transitions.mp4`
3) Update manifest; verify no new drift

## Test Plan

- Visual inspection + automated probe of joins; confirm total duration accounts for overlaps

## Success Metrics

- Smooth transitions without added drift; duration matches expectations

## Implementation Tracking

- Status: planned
- Assigned To: Team
- Start Date: 2025-09-25
- Target Completion: +2 days
- Actual Completion: TBC
