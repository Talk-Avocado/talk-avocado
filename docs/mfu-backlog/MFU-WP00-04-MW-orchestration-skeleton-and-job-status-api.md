---
title: "MFU-WP00-04-MW: Orchestration Skeleton and Job Status API"
sidebar_label: "WP00-04: MW Orchestration & API"
date: 2025-09-25
status: planned
version: 1.0
audience: [backend-engineers]
---

## MFU-WP00-04-MW: Orchestration Skeleton and Job Status API

## MFU Identification

- MFU ID: MFU-WP00-04-MW
- Title: Orchestration Skeleton and Job Status API
- Date Created: 2025-09-25
- Created By: TalkAvocado Team
- Work Package: WP00 — Foundations (Phase 1)
- Sprint: Phase 1 – Foundations

## MFU Definition

**Functional Description**:
Stand up Step Functions (or EventBridge + SQS) skeleton and Job Create/Status API; write/update manifest and job status during a no-op pipeline.

**Technical Scope**:

- API: `POST /jobs` (create jobId, DynamoDB record, write initial manifest to S3)
- API: `GET /jobs/{jobId}` (return status and artifact pointers)
- Orchestration: no-op state machine that updates status to COMPLETE

### Migration Notes (use existing handlers)

- Keep each step as a Lambda with `exports.handler(event)` signature as migrated under `backend/services/*/handler.js`.
- Define an initial state machine with placeholders calling the steps in sequence with tenant/job context:
  1) audio-extraction → writes `audio/{jobId}.mp3` and updates manifest
  2) transcription → writes transcript JSON + SRT and updates manifest
  3) smart-cut-planner → writes `plan/cut_plan.json` and updates manifest
  4) video-render-engine → writes `renders/base_cuts.mp4` and updates manifest
- Implement `backend/api/jobs/createJob.ts` to create `jobId`, write initial manifest at `{env}/{tenant}/{job}/manifest.json`, and start the state machine.
- Implement `backend/api/jobs/getJob.ts` to read job status from DynamoDB + manifest pointers.

### Acceptance Criteria additions

- [ ] State machine integrates the four migrated handlers with correct event shapes
- [ ] `POST /jobs` seeds manifest and triggers state machine with `tenantId`
- [ ] `GET /jobs/{jobId}` returns manifest-derived artifact pointers

**Business Value**  
Provides the unified entry point and control-plane for all pipeline MFUs.

## Acceptance Criteria

- [ ] `POST /jobs` creates jobId, DynamoDB record, initial manifest in S3 (with tenantId)
- [ ] Orchestration runs no-op pipeline and marks job COMPLETE
- [ ] `GET /jobs/{jobId}` returns status and artifact pointers

## Complexity Assessment

- Complexity: Medium
- Estimated Effort: 1–2 days
- Confidence: Medium

## Dependencies and Prerequisites

- Depends on: MFU-WP00-02-BE, MFU-WP00-03-IAC

## Agent Execution Guide (Step-by-step)

1) Define DynamoDB integration and S3 manifest writes in the API
2) Implement Step Functions skeleton (or EventBridge+SQS) with no-op tasks
3) Wire correlationId across request → orchestration → logs
4) Provide IaC for API + state machine; deploy to dev
5) Smoke test job create → COMPLETE and status retrieval

## Test Plan

- Create a job via API; verify DynamoDB record and S3 manifest
- Observe state machine reach COMPLETE; query status endpoint

## Success Metrics

- Job creation latency < 500ms P95
- Orchestration reliability 99.9% over test runs

## Implementation Tracking

- Status: planned
- Assigned To: Team
- Start Date: 2025-09-25
- Target Completion: +2 days
- Actual Completion: TBC
