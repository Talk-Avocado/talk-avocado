---
title: "MFU-WP00-04-MW: Orchestration Skeleton and Job Status API"
sidebar_label: "WP00-04: MW Orchestration & API"
date: 2025-09-30
status: planned
version: 1.0
audience: [backend-engineers]
---

## MFU-WP00-04-MW: Orchestration Skeleton and Job Status API

## MFU Identification

- MFU ID: MFU-WP00-04-MW
- Title: Orchestration Skeleton and Job Status API
- Date Created: 2025-09-30
- Date Last Updated:
- Created By: Radha
- Work Package: WP00 — Foundations (Phase 1)
- Sprint: Phase 1 – Foundations

## MFU Definition

**Functional Description**:
Provide an orchestration skeleton (AWS Step Functions preferred; EventBridge + SQS acceptable) and a minimal Job Create/Status REST API. Orchestration will pass tenant-aware context, mutate the manifest and job record, and drive a no-op (or stubbed) pipeline path to COMPLETE in Phase 1. Storage remains local filesystem using canonical keys from WP00-02; S3 bindings are deferred to WP01.

**Technical Scope**:

- API: `POST /jobs` (create `jobId`, create DynamoDB record, write initial manifest under `./storage/{env}/{tenantId}/{jobId}/manifest.json`)
- API: `GET /jobs/{jobId}` (return job status and artifact pointers derived from manifest)
- Orchestration: state machine skeleton that updates status through PENDING → PROCESSING → COMPLETED; integrates with handlers in later MFUs
- Correlation: propagate `correlationId`, `tenantId`, `jobId` across API → orchestration → handlers
- Local-first: all I/O via `backend/lib/storage.ts` and `backend/lib/manifest.ts`; S3/IAM deferred

### Target Architecture (Phase 1 WP00/WP01)

```bash
backend/
  api/
    jobs/
      createJob.ts            # POST /jobs
      getJob.ts               # GET /jobs/{jobId}
  lib/
    manifest.ts               # from WP00-02
    storage.ts                # from WP00-02
    logging.ts                # upgraded in WP00-03
orchestration/
  state-machines/
    pipeline.asl.json         # Step Functions ASL skeleton (local-compatible shape)
infra/
  dynamodb-jobs.json          # from WP00-02
tools/
  harness/
    run-local-pipeline.js     # from WP00-01
storage/                      # local root for keys {env}/{tenantId}/{jobId}/...
```

### API Contracts (Phase 1)

- POST `/jobs`
  - Request (JSON):
    ```json
    {
      "tenantId": "demo-tenant",
      "input": {
        "originalFilename": "sample.mp4",
        "bytes": 123456,
        "mimeType": "video/mp4"
      }
    }
    ```
  - Response 201:
    ```json
    {
      "jobId": "<uuid>",
      "status": "pending",
      "env": "dev",
      "tenantId": "demo-tenant",
      "manifestKey": "dev/demo-tenant/<uuid>/manifest.json"
    }
    ```
  - Side effects: creates Jobs item in DynamoDB with `tenantId` + `jobSort`, writes initial `manifest.json`, optionally starts state machine (configurable)

- GET `/jobs/{jobId}?tenantId=...`
  - Response 200:
    ```json
    {
      "jobId": "<uuid>",
      "tenantId": "demo-tenant",
      "status": "processing",
      "artifacts": {
        "audio": "dev/demo-tenant/<uuid>/audio/<uuid>.mp3",
        "transcript": "dev/demo-tenant/<uuid>/transcripts/transcript.json",
        "plan": "dev/demo-tenant/<uuid>/plan/cut_plan.json",
        "renders": [
          "dev/demo-tenant/<uuid>/renders/preview.mp4"
        ]
      },
      "manifestKey": "dev/demo-tenant/<uuid>/manifest.json",
      "updatedAt": "2025-09-25T12:34:56Z"
    }
    ```
  - Error 404: not found (jobId not found for provided tenantId)

### Migration Notes (use existing handlers)

- Keep each step as a Lambda with `exports.handler(event)` signature as migrated under `backend/services/*/handler.js`.
- Define an initial state machine with placeholders calling the steps in sequence with tenant/job context:
  1) audio-extraction → writes `audio/{jobId}.mp3` and updates manifest
  2) transcription → writes transcript JSON + SRT and updates manifest
  3) smart-cut-planner → writes `plan/cut_plan.json` and updates manifest
  4) video-render-engine → writes `renders/base_cuts.mp4` and updates manifest
- Implement `backend/api/jobs/createJob.ts` to create `jobId`, write initial manifest at `{env}/{tenantId}/{jobId}/manifest.json`, create DynamoDB record, and (optionally) start the state machine.
- Implement `backend/api/jobs/getJob.ts` to read job status from DynamoDB + derive artifact pointers from manifest.

### State Machine Skeleton (ASL - high level)

```json
{
  "Comment": "TalkAvocado Pipeline (Phase 1 skeleton)",
  "StartAt": "MarkProcessing",
  "States": {
    "MarkProcessing": { "Type": "Task", "Resource": "arn:aws:lambda:...:markProcessing", "Next": "NoopOrSteps" },
    "NoopOrSteps": {
      "Type": "Pass",
      "Result": { "message": "stubbed in Phase 1" },
      "Next": "MarkCompleted"
    },
    "MarkCompleted": { "Type": "Task", "Resource": "arn:aws:lambda:...:markCompleted", "End": true }
  }
}
```

### Acceptance Criteria additions

- [ ] State machine integrates the four migrated handlers with correct event shapes
- [ ] `POST /jobs` seeds manifest and triggers state machine with `tenantId`
- [ ] `GET /jobs/{jobId}` returns manifest-derived artifact pointers

**Business Value**  
Provides the unified entry point and control-plane for all pipeline MFUs.

## Acceptance Criteria

- [ ] `backend/api/jobs/createJob.ts` creates `jobId`, DynamoDB record (tenant-scoped keys), initial manifest under local storage, returns 201
- [ ] `backend/api/jobs/getJob.ts` returns job status and manifest-derived artifact pointers
- [ ] Orchestration state machine (skeleton) exists with MarkProcessing → Noop/Steps → MarkCompleted
- [ ] Correlation fields (`correlationId`, `tenantId`, `jobId`) flow from API → state machine → logs (Powertools wrappers from WP00-03)
- [ ] Local-first behavior verified; S3/IAM explicitly deferred to WP01
- [ ] Error handling: 400 on invalid input, 404 on missing job, 409 on duplicate create with same tenant/job

## Complexity Assessment

- Complexity: Medium
- Estimated Effort: 1–2 days
- Confidence: Medium

## Dependencies and Prerequisites

- Hard dependencies:
  - MFU‑WP00‑01‑IAC (repo scaffolding, harness, CI)  
    See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-01-IAC-platform-bootstrap-and-ci.md
  - MFU‑WP00‑02‑BE (manifest, tenancy, storage abstraction)  
    See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-02-BE-manifest-tenancy-and-storage-schema.md
  - MFU‑WP00‑03‑IAC (observability wrappers)  
    See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-03-IAC-runtime-ffmpeg-and-observability.md

## Agent Execution Guide (Step-by-step)

Follow these steps exactly. All paths are repo‑relative.

1) Ensure directories exist

- Create or verify:
  - `backend/api/jobs/`
  - `backend/lib/` (from WP00‑02 and WP00‑03)
  - `orchestration/state-machines/`
  - `infra/`

2) Implement API handlers

- `backend/api/jobs/createJob.ts`:
  - Validate body: `tenantId` (required), optional `input` metadata
  - Generate `jobId` (UUID); compute keys via `keyFor(env, tenantId, jobId, ...)`
  - Create initial manifest object (schema v1.0.0) and persist via `saveManifest`
  - Create DynamoDB record using tenant-scoped PK/SK (`talkavocado-{env}-jobs` from WP00‑02)
  - Start state machine (config flag `START_ON_CREATE=true|false`)
  - Return 201 with `jobId`, `tenantId`, `status`, `manifestKey`

- `backend/api/jobs/getJob.ts`:
  - Validate `tenantId` param for isolation
  - Read item from DynamoDB (by tenant + jobId)
  - Load manifest; derive artifact pointers (`audio`, `transcript`, `plan`, `renders[]`)
  - Return 200 with `status`, pointers, and `updatedAt`

3) Create state machine skeleton

- Author `orchestration/state-machines/pipeline.asl.json` with MarkProcessing → Noop → MarkCompleted
- Implement tiny Lambda tasks `markProcessing`, `markCompleted` that only update DynamoDB + manifest

4) Wire observability

- Use Powertools wrappers (`backend/lib/*` from WP00‑03) for structured logs and metrics; include `correlationId`, `tenantId`, `jobId`

5) Local smoke test

- With env: `TALKAVOCADO_ENV=dev`, `MEDIA_STORAGE_PATH=./storage`
- Invoke `createJob` locally; confirm manifest at `./storage/dev/{tenant}/{job}/manifest.json`
- If `START_ON_CREATE=true`, run state machine locally (or simulate by invoking mark* Lambdas)
- Invoke `getJob`; ensure artifact pointers reflect manifest

## Test Plan

- Unit:
  - API input validation, UUID generation, manifest persistence, DynamoDB put/get
  - State machine task stubs update status correctly
- Integration (local):
  - `POST /jobs` → manifest written under local storage; DynamoDB item created
  - Optional: state machine executes and marks COMPLETED
  - `GET /jobs/{jobId}` returns status and artifact pointers derived from manifest
- CI: light API handler tests and manifest validation using schema from WP00‑02

## Success Metrics

- Job creation latency < 500ms P95
- Orchestration reliability 99.9% over test runs
 - 100% requests include `correlationId`, `tenantId`, `jobId` in logs
 - 0 cross-tenant leakage (verified via negative tests)

## Implementation Tracking

- Status: planned
- Assigned To: Team
- Start Date: 2025-09-25
- Target Completion: +2 days
- Actual Completion: TBC

## Risks / Open Questions

- Step Functions vs EventBridge+SQS: choose based on handler idempotency and fanout needs
- Local parity for Step Functions (SAM/CDK emulation) vs simulating transitions in Node
- S3/IAM deferred: ensure no leakage of AWS-specific paths into Phase 1 code
- API multi-tenancy: enforce `tenantId` parameter across reads to avoid enumeration

## Related MFUs

- MFU‑WP00‑01‑IAC: Platform Bootstrap and CI  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-01-IAC-platform-bootstrap-and-ci.md
- MFU‑WP00‑02‑BE: Manifest, Tenancy, and Storage Schema  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-02-BE-manifest-tenancy-and-storage-schema.md
- MFU‑WP00‑03‑IAC: Runtime FFmpeg and Observability  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-03-IAC-runtime-ffmpeg-and-observability.md
