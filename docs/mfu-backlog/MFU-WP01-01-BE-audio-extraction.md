---
title: "MFU-WP01-01-BE: Audio Extraction"
sidebar_label: "WP01-01: BE Audio Extraction"
date: 2025-09-25
status: planned
version: 1.0
audience: [backend-engineers]
---

## MFU-WP01-01-BE: Audio Extraction

## MFU Identification

- MFU ID: MFU-WP01-01-BE
- Title: Audio Extraction
- Date Created: 2025-09-25
- Created By: TalkAvocado Team
- Work Package: WP01 — POC Pipeline
- Sprint: Phase 1 – Pipeline

## MFU Definition

**Functional Description**:
Extract audio (mp3) from uploaded video; update manifest with codec/duration/bitrate.

**Technical Scope**:

- Support .mp4 and .mov
- Output `audio/{jobId}.mp3`
- Update manifest with audio metadata; log correlationId
- Ensure tenant-scoped output path

### Migration Notes (use existing handler)

- Use migrated `backend/services/audio-extraction/handler.js` (from `ExtractAudioFromVideo/index.js`).
- Replace hard-coded S3/local paths with `backend/lib/storage.ts` helpers and set keys under `{env}/{tenantId}/{jobId}/audio/{jobId}.mp3` and `mp4/{jobId}.mp4`.
- After extract, run `ffprobe` to capture: `durationSec`, `codec`, `bitrateKbps`; call `backend/lib/manifest.ts` to update manifest.
- Accept event shape from orchestrator including `env`, `tenantId`, `jobId`, and `inputKey` under `input/`.

### Acceptance Criteria additions

- [ ] Handler writes to tenant path `{env}/{tenantId}/{jobId}/audio/{jobId}.mp3`
- [ ] Manifest updated with audio metadata fields
- [ ] Logs include `correlationId`, `tenantId`, `jobId`

**Business Value**  
Creates the audio input required for transcription with consistent metadata and storage.

## Acceptance Criteria

- [ ] Supports .mp4 and .mov; outputs `audio/{jobId}.mp3`
- [ ] Manifest updated with audio metadata
- [ ] Output path tenant-scoped

## Complexity Assessment

- Complexity: Medium
- Estimated Effort: 1 day
- Confidence: Medium

## Dependencies and Prerequisites

- Depends on: MFU-WP00-04-MW, MFU-WP00-02-BE

## Agent Execution Guide (Step-by-step)

1) Implement Lambda/container to extract audio via FFmpeg
2) Resolve input from `input/` path; write to `audio/{jobId}.mp3`
3) Probe metadata; update manifest
4) Integrate into orchestration path via Job API

## Test Plan

- Input: `sample_10s.mov` → mp3; check duration ±100ms at `env/tenantId/jobId/audio/`

## Success Metrics

- Duration accuracy within ±100ms; zero cross-tenant collisions

## Implementation Tracking

- Status: planned
- Assigned To: Team
- Start Date: 2025-09-25
- Target Completion: +1 day
- Actual Completion: TBC
