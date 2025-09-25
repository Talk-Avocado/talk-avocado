---
title: "MFU-WP01-02-BE: Transcription"
sidebar_label: "WP01-02: BE Transcription"
date: 2025-09-25
status: planned
version: 1.0
audience: [backend-engineers]
---

## MFU-WP01-02-BE: Transcription

## MFU Identification

- MFU ID: MFU-WP01-02-BE
- Title: Transcription
- Date Created: 2025-09-25
- Created By: TalkAvocado Team
- Work Package: WP01 — POC Pipeline
- Sprint: Phase 1 – Pipeline

## MFU Definition

**Functional Description**:
Transcribe mp3 with Whisper; produce transcript JSON (word-level timestamps) and initial .srt.

**Technical Scope**:

- Input: `audio/{jobId}.mp3`
- Output: `transcript/transcript.json` with per-word timestamps and segment grouping
- Output: `transcript/captions.source.srt`
- Manifest updated with transcript pointers; tenant-safe

### Migration Notes (use existing handler)

- Use migrated `backend/services/transcription/handler.js` (from `TranscribeWithWhisper/index.js`).
- Add `.srt` generation at `transcript/captions.source.srt` (derive from words[] and segments[]).
- Replace any direct path usage with `backend/lib/storage.ts` helpers and update manifest via `backend/lib/manifest.ts` with pointers and `language/model` used.
- Accept event with `env`, `tenantId`, `jobId`, `audioKey`.

### Acceptance Criteria additions

- [ ] SRT file created deterministically from JSON transcript
- [ ] Manifest updated with `transcript.jsonKey` and `transcript.srtKey`

**Business Value**  
Provides accurate transcripts and captions for planning and editing while keeping outputs tenant-isolated.

## Acceptance Criteria

- [ ] `transcript/transcript.json` with per-word timestamps and segments
- [ ] `transcript/captions.source.srt`
- [ ] Manifest updated with transcript pointers; no tenant collisions

## Complexity Assessment

- Complexity: Medium
- Estimated Effort: 1 day
- Confidence: Medium

## Dependencies and Prerequisites

- Depends on: MFU-WP01-01-BE

## Agent Execution Guide (Step-by-step)

1) Implement Whisper-based transcription step
2) Generate JSON + SRT; ensure deterministic language/model settings
3) Update manifest with transcript paths
4) Integrate with orchestration

## Test Plan

- Input: sample mp3 → transcript.json + captions.source.srt; spot-check timestamps align ±300ms

## Success Metrics

- Timestamp alignment within ±300ms on spot checks

## Implementation Tracking

- Status: planned
- Assigned To: Team
- Start Date: 2025-09-25
- Target Completion: +1 day
- Actual Completion: TBC
