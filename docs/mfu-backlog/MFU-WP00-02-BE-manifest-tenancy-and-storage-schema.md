---
title: "MFU-WP00-02-BE: Manifest, Tenancy, and Storage Schema"
sidebar_label: "WP00-02: BE Manifest & Storage"
date: 2025-09-30
status: planned
version: 1.0
audience: [developers, backend-engineers]
---

## MFU-WP00-02-BE: Manifest, Tenancy, and Storage Schema

## MFU Identification

- MFU ID: MFU-WP00-02-BE
- Title: Manifest, Tenancy, and Storage Schema
- Date Created: 2025-09-30
- Date Last Updated:
- Created By: Radha
- Work Package: WP00 — Foundations (Phase 1)
- Sprint: Phase 1 – Foundations

## MFU Definition

**Functional Description**  
Define the canonical job manifest JSON (including `tenantId`), the Jobs record in DynamoDB, and the tenant-safe artifact layout so all services read/write consistently. Phase 1 implements local filesystem with S3-compatible keys; S3 bindings land in MFU‑WP00‑03.

**Technical Scope**
- JSON Schema for `manifest.json` with `schemaVersion = "1.0.0"`
- DynamoDB Jobs table: tenant-scoped primary key model (see below)
- Canonical layout (logical keys): `{env}/{tenantId}/{jobId}/(input|audio|transcripts|plan|renders|subtitles|logs|manifest.json)`
- TypeScript interfaces and schema validation (Ajv)
- Storage abstraction with local mode now; S3 mode deferred to WP00‑03
- Tenant-aware path helpers and manifest CRUD utilities
- Compatibility shim: optionally mirror writes to legacy prefixes used by existing handlers during migration
- Migration notes for `podcast-automation` handlers

### Target Storage Structure (Phase 1: Local mode; S3 later)

Local and S3 use the same logical keys; in Phase 1, keys are rooted at `./storage/`.

```bash
# Logical keys (Phase 1 materialize under ./storage/)
{env}/                          # dev, stage, prod
  {tenantId}/                   # [a-z0-9-_] (1-64 chars)
    {jobId}/                    # UUID for this processing job
      manifest.json             # canonical job state and artifact registry
      input/
        {originalFilename}
        metadata.json
      audio/
        {jobId}.mp3
        extraction-log.json
      transcripts/
        transcript.json
        captions.source.srt
        analysis.json
      plan/
        cut_plan.json
        planner-config.json
        analysis-log.json
      renders/
        preview.mp4
        final.mp4
        render-log.json
      subtitles/
        final.srt
        style.json
      logs/
        pipeline.log
        errors.json
```

Notes:
- Folder name standardized as `transcripts/` (plural) to match existing code usage.
- Phase 1 is local-only; S3 paths will be `s3://{bucket}/{env}/{tenantId}/{jobId}/...` in WP00‑03.
- Choose one strategy for env separation. Recommended: single bucket `talkavocado-media` (or org-standard) with env in key prefix (as above).

### Manifest Schema (v1.0.0)

Key changes:
- `language` accepts `en` or locales like `pt-BR`.
- Added `sourceVideoKey`.
- Kept `transcripts/` naming.
- Optional fields support progressive enrichment.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "TalkAvocado Job Manifest",
  "description": "Canonical job state and artifact registry for video processing pipeline",
  "type": "object",
  "required": ["schemaVersion", "env", "tenantId", "jobId", "createdAt", "updatedAt", "status"],
  "properties": {
    "schemaVersion": { "type": "string", "const": "1.0.0" },
    "env": { "type": "string", "enum": ["dev", "stage", "prod"] },
    "tenantId": {
      "type": "string",
      "pattern": "^[a-z0-9](?:[a-z0-9-_]{0,62}[a-z0-9])?$",
      "description": "Alphanumeric with -/_ between, 1-64 chars"
    },
    "jobId": { "type": "string", "format": "uuid" },
    "status": { "type": "string", "enum": ["pending", "processing", "completed", "failed", "cancelled"] },
    "createdAt": { "type": "string", "format": "date-time" },
    "updatedAt": { "type": "string", "format": "date-time" },

    "sourceVideoKey": {
      "type": "string",
      "description": "Storage key to the normalized MP4 (if normalized)"
    },

    "input": {
      "type": "object",
      "required": ["sourceKey", "originalFilename", "bytes", "mimeType"],
      "properties": {
        "sourceKey": { "type": "string" },
        "originalFilename": { "type": "string" },
        "bytes": { "type": "integer", "minimum": 0 },
        "mimeType": { "type": "string", "pattern": "^(video|audio)/.*" },
        "checksum": { "type": "string" },
        "uploadedAt": { "type": "string", "format": "date-time" }
      }
    },

    "audio": {
      "type": "object",
      "properties": {
        "key": { "type": "string" },
        "codec": { "type": "string", "enum": ["mp3", "wav", "aac"] },
        "durationSec": { "type": "number", "minimum": 0 },
        "bitrateKbps": { "type": "integer", "minimum": 0 },
        "sampleRate": { "type": "integer", "enum": [16000, 22050, 44100, 48000] },
        "extractedAt": { "type": "string", "format": "date-time" }
      }
    },

    "transcript": {
      "type": "object",
      "properties": {
        "jsonKey": { "type": "string" },
        "srtKey": { "type": "string" },
        "language": { "type": "string", "pattern": "^[a-z]{2}(-[A-Z]{2})?$" },
        "model": { "type": "string", "enum": ["tiny", "base", "small", "medium", "large"] },
        "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
        "transcribedAt": { "type": "string", "format": "date-time" }
      }
    },

    "plan": {
      "type": "object",
      "properties": {
        "key": { "type": "string" },
        "schemaVersion": { "type": "string" },
        "algorithm": { "type": "string" },
        "totalCuts": { "type": "integer", "minimum": 0 },
        "plannedAt": { "type": "string", "format": "date-time" }
      }
    },

    "renders": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["key", "type", "codec"],
        "properties": {
          "key": { "type": "string" },
          "type": { "type": "string", "enum": ["preview", "final", "thumbnail"] },
          "codec": { "type": "string", "enum": ["h264", "h265", "vp9"] },
          "durationSec": { "type": "number", "minimum": 0 },
          "resolution": { "type": "string", "pattern": "^\\d+x\\d+$" },
          "notes": { "type": "string" },
          "renderedAt": { "type": "string", "format": "date-time" }
        }
      }
    },

    "logs": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "key": { "type": "string" },
          "type": { "type": "string", "enum": ["pipeline", "error", "debug"] },
          "createdAt": { "type": "string", "format": "date-time" }
        }
      }
    },

    "metadata": {
      "type": "object",
      "properties": {
        "clientVersion": { "type": "string" },
        "processingTimeMs": { "type": "integer", "minimum": 0 },
        "tags": { "type": "array", "items": { "type": "string" } }
      }
    }
  }
}
```

### Cut Plan Schema (Phase 1 compatible)

Compat with current planner output (`start`/`end` as strings, `reason`, optional `confidence`). We’ll formalize numeric seconds and `type` in WP01 once planner/renderer are migrated.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "TalkAvocado Cut Plan",
  "description": "Smart cut planning output",
  "type": "object",
  "required": ["cuts"],
  "properties": {
    "schemaVersion": { "type": "string", "const": "1.0.0" },
    "source": { "type": "string" },
    "output": { "type": "string" },
    "cuts": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["start", "end"],
        "properties": {
          "start": { "type": "string", "description": "SS.SS | mm:ss(.sss) | hh:mm:ss(.sss)" },
          "end": { "type": "string", "description": "SS.SS | mm:ss(.sss) | hh:mm:ss(.sss)" },
          "reason": { "type": "string" },
          "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
        }
      }
    },
    "metadata": {
      "type": "object",
      "properties": {
        "processingTimeMs": { "type": "integer", "minimum": 0 },
        "parameters": { "type": "object" }
      }
    }
  }
}
```

### DynamoDB Jobs Table Design (tenant-scoped keys)

Rationale: default tenant isolation, simpler IAM scoping, efficient queries without GSI for basic lists.

```json
{
  "TableName": "talkavocado-{env}-jobs",
  "KeySchema": [
    { "AttributeName": "tenantId", "KeyType": "HASH" },
    { "AttributeName": "jobSort", "KeyType": "RANGE" }
  ],
  "AttributeDefinitions": [
    { "AttributeName": "tenantId", "AttributeType": "S" },
    { "AttributeName": "jobSort", "AttributeType": "S" },
    { "AttributeName": "status", "AttributeType": "S" },
    { "AttributeName": "createdAt", "AttributeType": "S" }
  ],
  "GlobalSecondaryIndexes": [
    {
      "IndexName": "tenant-status-index",
      "KeySchema": [
        { "AttributeName": "tenantId", "KeyType": "HASH" },
        { "AttributeName": "status", "KeyType": "RANGE" }
      ],
      "Projection": { "ProjectionType": "ALL" }
    },
    {
      "IndexName": "tenant-created-index",
      "KeySchema": [
        { "AttributeName": "tenantId", "KeyType": "HASH" },
        { "AttributeName": "createdAt", "KeyType": "RANGE" }
      ],
      "Projection": { "ProjectionType": "ALL" }
    }
  ],
  "BillingMode": "PAY_PER_REQUEST",
  "StreamSpecification": { "StreamEnabled": true, "StreamViewType": "NEW_AND_OLD_IMAGES" }
}
```

Conventions:
- `jobSort = {createdAt}#{jobId}` to support listing newest first per tenant.
- Store `status`, `createdAt`, `env` as attributes; use GSIs above for filtering.

### Migration Map (podcast-automation → backend/services)

During migration, use storage helpers to generate canonical keys. Add a compatibility toggle to also write legacy keys (`mp4/`, `mp3/`, `transcripts/`, `plans/`, `polished/`, `review/`) until all services are ported.

- `ExtractAudioFromVideo/index.js` → update to write `audio/{jobId}.mp3`, set `manifest.audio.*`, and set `sourceVideoKey` when normalizing MP4
- `TranscribeWithWhisper/index.js` → write `transcripts/transcript.json` and optional `captions.source.srt`, update `manifest.transcript.*`
- `SmartCutPlanner/index.js` → write `plan/cut_plan.json` (compat with current shape), update `manifest.plan.*`
- `VideoRenderEngine/index.js` → read from `plan/cut_plan.json`, write `renders/preview.mp4` or `renders/final.mp4`, append to `manifest.renders[]`

### Business Value
- Shared manifest contract, tenant isolation by construction, discoverable artifacts, and readiness for cloud deployment without breaking local workflows.

## Acceptance Criteria

- [ ] `docs/schemas/manifest.schema.json` (v1.0.0) created and validated
- [ ] `docs/schemas/cut_plan.schema.json` (Phase 1 compatible) created
- [ ] `backend/lib/storage.ts` with path helpers (local mode implemented; S3 mode explicitly deferred)
- [ ] `backend/lib/manifest.ts` with CRUD + Ajv validation and helpful error messages
- [ ] `backend/lib/types.ts` matches schemas
- [ ] `infra/dynamodb-jobs.json` uses tenant-scoped PK/SK as above
- [ ] `docs/CONVENTIONS.md` documents canonical layout, envs, and tenancy
- [ ] Unit tests for storage/manifest utilities; coverage target ≥80% for these libs
- [ ] Integration test: create job → write manifest → validate → read back (local mode)
- [ ] Handlers migrated to use helpers OR a compatibility shim writes both canonical and legacy keys (toggle)
- [ ] Local Mode writes under `./storage/{env}/{tenantId}/{jobId}/...` and mirrors logical keys
- [ ] Sample data generator creates a complete sample job with manifest and transcript

## Complexity Assessment
- Complexity: Low–Medium
- Estimated Effort: 1–1.5 days
- Confidence: High

## Dependencies and Prerequisites
- Depends on: MFU‑WP00‑01‑IAC (repo scaffolding, env conventions)

## Agent Execution Guide (Step-by-step)

Follow these steps exactly. All paths are repo‑relative.

1) Ensure directories exist

- Create or verify:
  - `docs/schemas/`
  - `backend/lib/`
  - `infra/`
  - `tools/harness/`

2) Materialize schemas from this doc

- Create `docs/schemas/manifest.schema.json` with the Manifest Schema (v1.0.0) JSON block from this document, unmodified.
- Create `docs/schemas/cut_plan.schema.json` with the Cut Plan Schema JSON block from this document, unmodified.

3) Add types matching schemas

- Create `backend/lib/types.ts`:
```ts
export type Env = 'dev' | 'stage' | 'prod';

export interface ManifestInput {
  sourceKey: string;
  originalFilename: string;
  bytes: number;
  mimeType: string;
  checksum?: string;
  uploadedAt?: string;
}

export interface ManifestTranscript {
  jsonKey?: string;
  srtKey?: string;
  language?: string;
  model?: 'tiny' | 'base' | 'small' | 'medium' | 'large';
  confidence?: number;
  transcribedAt?: string;
}

export interface ManifestPlan {
  key?: string;
  schemaVersion?: string;
  algorithm?: string;
  totalCuts?: number;
  plannedAt?: string;
}

export interface ManifestRender {
  key: string;
  type: 'preview' | 'final' | 'thumbnail';
  codec: 'h264' | 'h265' | 'vp9';
  durationSec?: number;
  resolution?: string;
  notes?: string;
  renderedAt?: string;
}

export interface ManifestLog {
  key?: string;
  type?: 'pipeline' | 'error' | 'debug';
  createdAt?: string;
}

export interface ManifestMetadata {
  clientVersion?: string;
  processingTimeMs?: number;
  tags?: string[];
}

export interface Manifest {
  schemaVersion: '1.0.0';
  env: Env;
  tenantId: string;
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  sourceVideoKey?: string;
  input?: ManifestInput;
  audio?: {
    key?: string;
    codec?: 'mp3' | 'wav' | 'aac';
    durationSec?: number;
    bitrateKbps?: number;
    sampleRate?: 16000 | 22050 | 44100 | 48000;
    extractedAt?: string;
  };
  transcript?: ManifestTranscript;
  plan?: ManifestPlan;
  renders?: ManifestRender[];
  logs?: ManifestLog[];
  metadata?: ManifestMetadata;
}
```

4) Implement tenant-aware storage helpers (Local mode)

- Create `backend/lib/storage.ts`:
```ts
import fs from 'node:fs';
import path from 'node:path';

const ENV = (process.env.TALKAVOCADO_ENV || 'dev') as 'dev' | 'stage' | 'prod';
const MEDIA_STORAGE_PATH = process.env.MEDIA_STORAGE_PATH || './storage';
const ENABLE_LEGACY_MIRROR = String(process.env.ENABLE_LEGACY_MIRROR || 'false') === 'true';

export function storageRoot() {
  return path.resolve(MEDIA_STORAGE_PATH);
}

export function key(...parts: string[]) {
  return parts.join('/').replace(/\\/g, '/');
}

export function keyFor(env: string, tenantId: string, jobId: string, ...rest: string[]) {
  return key(env, tenantId, jobId, ...rest);
}

export function pathFor(k: string) {
  return path.join(storageRoot(), k);
}

export function ensureDirForFile(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function writeFileAtKey(k: string, data: Buffer | string) {
  const p = pathFor(k);
  ensureDirForFile(p);
  fs.writeFileSync(p, data);
  return p;
}

export function readFileAtKey(k: string) {
  return fs.readFileSync(pathFor(k));
}

export function currentEnv() {
  return ENV;
}

export function maybeMirrorLegacy(env: string, tenantId: string, jobId: string, logical: string, data: Buffer | string) {
  if (!ENABLE_LEGACY_MIRROR) return;
  if (logical.endsWith('/audio/' + jobId + '.mp3')) {
    const legacy = key(env, tenantId, jobId, 'mp3', jobId + '.mp3');
    writeFileAtKey(legacy, data);
  }
}
```

5) Implement manifest CRUD + Ajv validation

- Create `backend/lib/manifest.ts`:
```ts
import fs from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import path from 'node:path';
import { Manifest } from './types';
import { keyFor, pathFor, ensureDirForFile } from './storage';

const schemaPath = path.resolve('docs/schemas/manifest.schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile<Manifest>(schema);

export function manifestKey(env: string, tenantId: string, jobId: string) {
  return keyFor(env, tenantId, jobId, 'manifest.json');
}

export function loadManifest(env: string, tenantId: string, jobId: string): Manifest {
  const p = pathFor(manifestKey(env, tenantId, jobId));
  const obj = JSON.parse(fs.readFileSync(p, 'utf-8'));
  if (!validate(obj)) {
    const msg = ajv.errorsText(validate.errors || []);
    throw new Error('Invalid manifest: ' + msg);
  }
  return obj;
}

export function saveManifest(env: string, tenantId: string, jobId: string, m: Manifest) {
  const valid = validate(m);
  if (!valid) {
    const msg = ajv.errorsText(validate.errors || []);
    throw new Error('Invalid manifest: ' + msg);
  }
  const p = pathFor(manifestKey(env, tenantId, jobId));
  ensureDirForFile(p);
  fs.writeFileSync(p, JSON.stringify(m, null, 2));
  return p;
}
```

6) DynamoDB table definition

- Create `infra/dynamodb-jobs.json` using the “DynamoDB Jobs Table Design” JSON block from this document, unmodified.

7) Document conventions

- Create `docs/CONVENTIONS.md` summarizing:
  - Envs: `dev|stage|prod`
  - Canonical layout: `{env}/{tenantId}/{jobId}/...`
  - Standardized folder names (e.g., `transcripts/`)
  - Manifest versioning: `schemaVersion = "1.0.0"`
  - Local vs S3 mode parity (S3 added in MFU‑WP00‑03)

8) Add a minimal sample data generator

- Create `tools/harness/generate-sample-job.js`:
```js
#!/usr/bin/env node
const { writeFileSync, mkdirSync } = require('node:fs');
const { join, dirname } = require('node:path');

const ENV = process.env.TALKAVOCADO_ENV || 'dev';
const ROOT = process.env.MEDIA_STORAGE_PATH || './storage';

function p(...parts) { return join(ROOT, ...parts); }
function ensure(file) { mkdirSync(dirname(file), { recursive: true }); }

const tenantId = process.argv[2] || 'demo-tenant';
const jobId = process.argv[3] || '00000000-0000-0000-0000-000000000000';

const manifest = {
  schemaVersion: '1.0.0',
  env: ENV,
  tenantId,
  jobId,
  status: 'pending',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mk = p(ENV, tenantId, jobId, 'manifest.json');
ensure(mk);
writeFileSync(mk, JSON.stringify(manifest, null, 2));
console.log('Wrote manifest:', mk);
```

9) Unit tests (lightweight)

- Add tests for:
  - `keyFor`/`pathFor` round-trip
  - `saveManifest` then `loadManifest` with valid data
  - Invalid manifest fails validation
- Use Node’s built-in `node:test` to avoid extra dependencies.

10) Integration sanity check (local)

- Set env vars: `TALKAVOCADO_ENV=dev`, `MEDIA_STORAGE_PATH=./storage`
- Run the sample generator to create a job.
- Write a small script to append a fake audio artifact and update manifest:
  - `audio/{jobId}.mp3` written via storage helper
  - Update `manifest.audio` and persist via `saveManifest`
- Re‑load manifest and assert updated fields.

11) Migration notes for handlers

- For each handler (extraction, transcription, planner, renderer):
  - Replace hard-coded paths with `keyFor` + `pathFor`.
  - Update manifest via `saveManifest` after producing artifacts.
  - Optional: if `ENABLE_LEGACY_MIRROR=true`, also write legacy keys during transition.

12) Acceptance criteria closure

- Check off items in “Acceptance Criteria” when:
  - Schema files exist and validate
  - `backend/lib/storage.ts`, `backend/lib/manifest.ts`, `backend/lib/types.ts` implemented
  - `infra/dynamodb-jobs.json` created
  - `docs/CONVENTIONS.md` written
  - Unit/integration checks pass locally
  - Sample job manifest generated successfully

## Test Plan
- Unit: storage and manifest CRUD + validation error paths
- Schema: validate known-good and known-bad manifests/cut plans
- Integration: end-to-end local flow
- Path generation: all artifact types
- Tenant isolation: ensure cross-tenant access is impossible via helpers

## Success Metrics
- All MFUs adopt the same manifest keys and format
- No cross-tenant path collisions
- Manifest validation catches violations
- Storage abstraction behaves identically in local vs S3 once enabled
- No hard-coded paths remain after migration

## Risks / Open Questions
- Schema evolution (versioning policy and migrations)
- S3 performance and object churn for frequent manifest updates (optimize in WP00‑03)
- DynamoDB cost and index design as query needs evolve
- Backups/lifecycle policies for job artifacts

## Related MFUs
- MFU‑WP00‑01‑IAC: foundations and env standards
- MFU‑WP00‑03‑IAC: S3 bindings, runtime, and observability
- MFU‑WP01‑01‑BE / ‑02‑BE: first adopters of manifest system
