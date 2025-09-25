---
title: "MFU-WP01-06-BE: Subtitles Post-Edit"
sidebar_label: "WP01-06: BE Subtitles Post-Edit"
date: 2025-09-25
status: planned
version: 1.0
audience: [backend-engineers]
---

## MFU-WP01-06-BE: Subtitles Post-Edit

## MFU Identification

- MFU ID: MFU-WP01-06-BE
- Title: Subtitles Post-Edit
- Date Created: 2025-09-25
- Created By: TalkAvocado Team
- Work Package: WP01 — POC Pipeline
- Sprint: Phase 1 – Pipeline

## MFU Definition

**Functional Description**:
Re-time subtitles to final edited timeline; output `subtitles/captions.final.(srt|vtt)`.

**Technical Scope**:

- Input: `renders/with_transitions.mp4`
- Output: `captions.final.srt` and `.vtt` synced within ±1 frame around cuts
- Handle dropped/merged segments cleanly; update manifest

**Business Value**  
Delivers production-ready captions aligned to the final video, supporting accessibility and publishing.

## Acceptance Criteria

- [ ] `captions.final.srt` and `.vtt` synced to final video within ±1 frame
- [ ] Handles dropped/merged segments; manifest updated

## Complexity Assessment

- Complexity: Medium
- Estimated Effort: 1 day
- Confidence: Medium

## Dependencies and Prerequisites

- Depends on: MFU-WP01-02-BE, MFU-WP01-04/05-BE

## Agent Execution Guide (Step-by-step)

1) Map original timestamps to post-transition timeline
2) Adjust word/segment timings; regenerate SRT and VTT
3) Validate alignment on cut boundaries; update manifest

## Test Plan

- Overlay captions on final video; spot-check cuts and transitions for alignment

## Success Metrics

- Alignment within ±1 frame across checks

## Implementation Tracking

- Status: planned
- Assigned To: Team
- Start Date: 2025-09-25
- Target Completion: +1 day
- Actual Completion: TBC


