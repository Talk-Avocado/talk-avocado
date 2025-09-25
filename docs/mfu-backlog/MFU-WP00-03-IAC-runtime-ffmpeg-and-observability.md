---
title: "MFU-WP00-03-IAC: Runtime FFmpeg and Observability"
sidebar_label: "WP00-03: IAC FFmpeg & Obs"
date: 2025-09-25
status: planned
version: 1.0
audience: [devops, backend-engineers]
---

## MFU-WP00-03-IAC: Runtime FFmpeg and Observability

## MFU Identification

- MFU ID: MFU-WP00-03-IAC
- Title: Runtime FFmpeg and Observability
- Date Created: 2025-09-25
- Created By: TalkAvocado Team
- Work Package: WP00 — Foundations (Phase 1)
- Sprint: Phase 1 – Foundations

## MFU Definition

**Functional Description**:
Provide FFmpeg in a Lambda-compatible runtime (layer or container), configure timeouts/memory, and implement structured logging, metrics, retries, and DLQs.

**Technical Scope**:

- FFmpeg Lambda layer or container image; validation function to probe/transcode
- Memory/timeouts configured for media workloads
- CorrelationId logging and structured logs
- Metrics emitted (invocations, errors, duration)
- DLQs wired for failed executions

### Migration Notes (tie into existing services)

- Package FFmpeg as a Lambda layer or container and verify it supports commands used in:
  - `backend/services/audio-extraction/handler.js`
  - `backend/services/transcription/handler.js` (ffprobe/split)
  - `backend/services/video-render-engine/handler.js`
- Add `backend/lib/logging.ts` to emit structured logs with `correlationId`, `tenantId`, `jobId`, and `step` fields; replace console.log in handlers with logger.
- Emit basic metrics (invocations, errors, duration) using CloudWatch EMF or a lightweight wrapper; add DLQ (SQS) per Lambda.

### Acceptance Criteria additions

- [ ] Handlers run unchanged inside the provided runtime (ffmpeg, ffprobe available on PATH)
- [ ] Structured logs include `correlationId`, `tenantId`, `jobId`, `step`
- [ ] DLQ receives forced failure from one handler and is visible in console

**Business Value**  
Unblocks all media processing MFUs and ensures reliability and observability from the start.

## Acceptance Criteria

- [ ] Lambda test function executes FFmpeg within configured limits
- [ ] CorrelationId present in logs; metrics emitted
- [ ] DLQ receives failed events from sample failure

## Complexity Assessment

- Complexity: Medium
- Estimated Effort: 1 day
- Confidence: Medium

## Dependencies and Prerequisites

- Depends on: MFU-WP00-01-IAC

## Agent Execution Guide (Step-by-step)

1) Build/publish FFmpeg layer or container image; attach to test function
2) Configure memory=2048MB+ and timeout=60–120s for dev
3) Implement structured logging with correlationId; emit basic metrics
4) Attach DLQ (SQS) and force a failure to validate
5) Document runtime constraints and tuning guidelines

## Test Plan

- Invoke test function in dev; verify FFmpeg probe/transcode output
- Confirm CloudWatch logs include correlationId and emitted metrics
- Force failure → confirm message in DLQ

## Success Metrics

- P95 media function duration within configured timeout
- Zero cold-start failures due to missing binaries

## Implementation Tracking

- Status: planned
- Assigned To: Team
- Start Date: 2025-09-25
- Target Completion: +1 day
- Actual Completion: TBC
