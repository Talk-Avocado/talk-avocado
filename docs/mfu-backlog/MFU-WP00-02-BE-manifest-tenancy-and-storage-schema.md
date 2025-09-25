---
title: "MFU-WP00-02-BE: Manifest, Tenancy, and Storage Schema"
sidebar_label: "WP00-02: BE Manifest & Storage"
date: 2025-09-25
status: planned
version: 1.0
audience: [developers, backend-engineers]
---

## MFU-WP00-02-BE: Manifest, Tenancy, and Storage Schema

## MFU Identification

- MFU ID: MFU-WP00-02-BE
- Title: Manifest, Tenancy, and Storage Schema
- Date Created: 2025-09-25
- Created By: TalkAvocado Team
- Work Package: WP00 — Foundations (Phase 1)
- Sprint: Phase 1 – Foundations

## MFU Definition

**Functional Description**:
Define the canonical job manifest JSON (including tenantId), the DynamoDB Jobs record, and the S3 folder layout so all services read/write artifacts consistently and tenant-safely.

**Technical Scope**:

- JSON Schema for `manifest.json` with `schemaVersion = "1.0.0"`
- DynamoDB `Jobs` table (PK: jobId; tenantId attribute)
- S3 layout: `s3://talkavocado/{env}/{tenantId}/{jobId}/(input|audio|transcript|plan|renders|subtitles|logs|manifest.json)`
- Reference utilities to read/write manifest and validate schema

### Migration Notes (align existing code to schema and paths)

- Introduce `backend/lib/storage.ts` with helpers:
  - `getBasePath(env, tenantId, jobId)` → `{env}/{tenantId}/{jobId}`
  - `keyFor(kind)` where kind ∈ `input|audio|transcript|plan|renders|subtitles|logs|manifest`
  - Switch existing handlers to call these helpers for both S3 and Local Mode (map to `./storage/{env}/{tenantId}/{jobId}/...` in dev)
- Introduce `backend/lib/manifest.ts` with:
  - `loadManifest(env, tenantId, jobId)`
  - `saveManifest(manifest)` with schema validation against `docs/schemas/manifest.schema.json`
- Update migrated handlers to populate manifest fields:
  - Audio Extraction: codec, durationSec, bitrateKbps; path to `audio/{jobId}.mp3`
  - Transcription: pointers to `transcript/transcript.json` and `transcript/captions.source.srt`
  - Planner: pointer to `plan/cut_plan.json` and planner config snapshot
  - Video Engine: render metadata and final output under `renders/`

### Schema Deliverables

- `docs/schemas/manifest.schema.json` (version 1.0.0) with required fields:
  - `schemaVersion`, `env`, `tenantId`, `jobId`, `createdAt`, `updatedAt`
  - `input`: `{ sourceKey, originalFilename, bytes, mimeType }`
  - `audio`: `{ key, codec, durationSec, bitrateKbps }`
  - `transcript`: `{ jsonKey, srtKey, language, model }`
  - `plan`: `{ key, schemaVersion }`
  - `renders`: array of `{ key, type, codec, durationSec, notes }`
  - `logs`: optional array

### Acceptance Criteria additions

- [ ] `backend/lib/storage.ts` and `backend/lib/manifest.ts` implemented and unit-smoke-tested
- [ ] Migrated handlers use storage/manifest helpers (no hard-coded paths)
- [ ] Local Mode writes under `./storage/{env}/{tenantId}/{jobId}/...` and mirrors S3 keys

**Business Value**  
Eliminates ambiguity across MFUs, ensures multi-tenant isolation, and enables automation and discovery of artifacts.

## Acceptance Criteria

- [ ] `manifest.schemaVersion` is "1.0.0" and JSON schema is published in repo
- [ ] DynamoDB `Jobs` table created; CRUD smoke test passes
- [ ] S3 layout defined exactly as specified and validated

## Complexity Assessment

- Complexity: Low
- Estimated Effort: 0.5 day
- Confidence: High

## Dependencies and Prerequisites

- Depends on: MFU-WP00-01-IAC (Platform bootstrap & CI)

## Agent Execution Guide (Step-by-step)

1) Create JSON Schema under `docs/schemas/manifest.schema.json` with version field
2) Create `infra/` definitions for DynamoDB Jobs table (name: `talkavocado-{env}-jobs`)
3) Define S3 path conventions in `docs/CONVENTIONS.md`
4) Add helper in `backend/` to load/validate manifest; include tenantId/jobId
5) Provide sample script to create dummy job and write manifest

## Test Plan

- Create a dummy job via script; write `manifest.json`; read back and validate against schema
- CRUD smoke test against DynamoDB Jobs

## Success Metrics

- All MFUs adopt the same manifest path and format
- No cross-tenant path collisions detected in tests

## Implementation Tracking

- Status: planned
- Assigned To: Team
- Start Date: 2025-09-25
- Target Completion: +1 day
- Actual Completion: TBC
