---
title: "MFU-WP01-03-BE: Smart Cut Planner"
sidebar_label: "WP01-03: BE Smart Cut Planner"
date: 2025-10-01
status: planned
version: 1.0
audience: [backend-engineers]
---

## MFU-WP01-03-BE: Smart Cut Planner

## MFU Identification

- MFU ID: MFU-WP01-03-BE
- Title: Smart Cut Planner
- Date Created: 2025-10-01
- Date Last Updated:
- Created By: Radha
- Work Package: WP01 — POC Pipeline
- Sprint: Phase 1 – Pipeline

## MFU Definition

**Functional Description**  
Analyze the transcript to produce a `cut_plan.json` with keep/cut segment decisions based on configurable rules (silence detection, filler word removal, length constraints). Output is deterministic, validated against schema, and includes reasons for each decision. Updates the job manifest with plan metadata.

**Technical Scope**

- Inputs: `transcripts/transcript.json` with word/segment-level timestamps
- Output: `plan/cut_plan.json` with keep/cut segments and reasons
- Analysis rules:
  - Silence detection: configurable `minPauseMs` threshold
  - Filler word removal: configurable `fillerWords[]` list
  - Length constraints: `minSegmentDurationSec`, `maxSegmentDurationSec`
  - Optional: GPT-based enhancement (disabled in deterministic mode)
- Schema validation: `docs/schemas/cut_plan.schema.json` (from WP00-02)
- Manifest updates: `manifest.plan.*` (key, schemaVersion, algorithm, totalCuts, plannedAt)
- Deterministic mode: `DETERMINISTIC=true` disables non-deterministic steps
- Idempotency for same `{env}/{tenantId}/{jobId}`; safe overwrite behavior
- Structured logs with `correlationId`, `tenantId`, `jobId`, `step`

**Business Value**  
Automates editing decisions to accelerate video rendering while keeping results reproducible and auditable, enabling fast iteration and CI-friendly golden sample testing.

### Target Service Architecture (Phase 1 WP01)

```bash
backend/
  services/
    smart-cut-planner/
      handler.js               # Lambda/worker handler
      planner-logic.js         # Core planning algorithm
      README.md                # Service-specific notes (optional)
      package.json             # If service-local deps are used
backend/
  lib/
    storage.ts                 # From WP00-02
    manifest.ts                # From WP00-02
    init-observability.ts      # From WP00-03
docs/
  schemas/
    cut_plan.schema.json       # From WP00-02
  mfu-backlog/
    MFU-WP01-03-BE-smart-cut-planner.md
storage/
  {env}/{tenantId}/{jobId}/...
tools/
  harness/
    run-local-pipeline.js      # From WP00-05, invokes this handler locally
```

### Handler Contract

- Event (from orchestrator or local harness):
  - `env: "dev" | "stage" | "prod"`
  - `tenantId: string`
  - `jobId: string`
  - `transcriptKey: string` (e.g., `{env}/{tenantId}/{jobId}/transcripts/transcript.json`)
  - `correlationId?: string`
- Behavior:
  - Read transcript via `transcriptKey`
  - Apply planning rules (silence, fillers, length constraints)
  - Produce `plan/cut_plan.json` with keep/cut segments
  - Validate against schema before writing
  - Update `manifest.plan.*` and persist
  - Emit structured logs and EMF metrics
- Errors:
  - On failure, set manifest `status = "failed"` (if applicable in step) and surface error

### Planning Algorithm (Phase 1)

**Rule-Based Approach** (deterministic):
1. Parse transcript segments and word timestamps
2. Detect long pauses (silence > `minPauseMs`) → mark as potential cuts
3. Detect filler words/phrases → mark surrounding context for removal
4. Merge adjacent cut regions within `mergeThresholdMs`
5. Filter out cuts shorter than `minCutDurationSec`
6. Ensure keep segments are within `minSegmentDurationSec` to `maxSegmentDurationSec`
7. Generate `cut_plan.json` with `start`, `end`, `type` (keep/cut), `reason`, `confidence`

**Future Enhancement** (non-deterministic, opt-in):
- GPT-based analysis for nuanced decisions (e.g., "remove repetitive content", "keep key points")
- Controlled via `ENABLE_GPT_PLANNER=true` and excluded when `DETERMINISTIC=true`

### Migration Notes (use existing handler)

- Migrate logic from `podcast-automation/SmartCutPlanner/index.js` into `backend/services/smart-cut-planner/handler.js`.
- Replace direct paths with `backend/lib/storage.ts` (`keyFor`, `pathFor`, `writeFileAtKey`).
- Use `backend/lib/manifest.ts` (`loadManifest`, `saveManifest`) for manifest updates.
- Validate output against `docs/schemas/cut_plan.schema.json` before writing.
- Add deterministic mode toggle: when `DETERMINISTIC=true`, disable GPT and use only rule-based logic.
- Accept event with `env`, `tenantId`, `jobId`, `transcriptKey`.

## Acceptance Criteria

- [ ] Reads `transcripts/transcript.json` with segments and word timestamps
- [ ] Writes `plan/cut_plan.json` validated against schema
- [ ] Plan includes:
  - [ ] `cuts[]` with `start`, `end`, `type` (keep/cut), `reason`, optional `confidence`
  - [ ] `schemaVersion = "1.0.0"`
  - [ ] `metadata` with processing time and parameters
- [ ] Manifest updated:
  - [ ] `plan.key`, `plan.schemaVersion`, `plan.algorithm`, `plan.totalCuts`, `plan.plannedAt`
- [ ] Configurable thresholds via env vars:
  - [ ] `minPauseMs` (default 1500)
  - [ ] `fillerWords[]` (default: ["um", "uh", "like", "you know"])
  - [ ] `minCutDurationSec` (default 0.5)
  - [ ] `minSegmentDurationSec`, `maxSegmentDurationSec`
- [ ] Deterministic mode: `DETERMINISTIC=true` produces identical output across runs
- [ ] Logs include `correlationId`, `tenantId`, `jobId`, `step = "smart-cut-planner"`
- [ ] Idempotent for same `{env}/{tenantId}/{jobId}` (safe overwrite)
- [ ] Schema validation errors surface clearly with line/field details

## Complexity Assessment

- Complexity: Medium
- Estimated Effort: 1 day
- Confidence: Medium

## Dependencies and Prerequisites

- Hard dependencies:
  - MFU‑WP01‑02‑BE (transcription - provides input transcript JSON)
  - MFU‑WP00‑02‑BE (manifest, storage, tenancy, cut_plan schema)
  - MFU‑WP00‑03‑IAC (observability wrappers)
- Recommended:
  - MFU‑WP00‑04‑MW (orchestration skeleton)
  - MFU‑WP00‑05‑TG (harness/goldens integration)

**Environment Variables** (extend `.env.example`):
```env
# Smart Cut Planner (WP01-03)
PLANNER_MIN_PAUSE_MS=1500
PLANNER_FILLER_WORDS=um,uh,like,you know,so,actually
PLANNER_MIN_CUT_DURATION_SEC=0.5
PLANNER_MIN_SEGMENT_DURATION_SEC=3.0
PLANNER_MAX_SEGMENT_DURATION_SEC=300.0
PLANNER_MERGE_THRESHOLD_MS=500
DETERMINISTIC=true
ENABLE_GPT_PLANNER=false
```

## Agent Execution Guide (Step-by-step)

Follow these steps exactly. All paths are repo‑relative.



1) Ensure directories exist
- Create or verify:
  - `backend/services/smart-cut-planner/`
  - `docs/schemas/` (should exist from WP00-02)

2) Implement core planning logic module
- Create `backend/services/smart-cut-planner/planner-logic.js` with:
  - `getDefaultConfig()` - loads config from env vars
  - `detectSilence(segments, config)` - identifies pauses between segments
  - `detectFillerWords(segments, config)` - finds filler words with context
  - `mergeCutRegions(regions, mergeThresholdMs)` - combines adjacent cuts
  - `filterShortCuts(cutRegions, minDurationSec)` - removes tiny cuts
  - `generateCutPlan(transcriptData, cutRegions, config)` - produces final timeline
  - `planCuts(transcriptData, userConfig)` - main entry point combining all steps
  - Export: `module.exports = { planCuts, getDefaultConfig };`

**Key Implementation Points**:
- Use word-level timestamps from transcript for precise cut boundaries
- Format times as `SS.SS` strings for compatibility with video renderer
- Include `reason` field for each cut (e.g., `"silence_1700ms"`, `"filler_word_um"`)
- Set `confidence: 1.0` for rule-based decisions (vs 0.0-1.0 for ML-based future)
- Ensure pure functions for testability and determinism

```javascript
// backend/services/smart-cut-planner/planner-logic.js
function getDefaultConfig() {
  return {
    minPauseMs: Number(process.env.PLANNER_MIN_PAUSE_MS || 1500),
    fillerWords: String(process.env.PLANNER_FILLER_WORDS || 'um,uh,like,you know,so,actually')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean),
    minCutDurationSec: Number(process.env.PLANNER_MIN_CUT_DURATION_SEC || 0.5),
    minSegmentDurationSec: Number(process.env.PLANNER_MIN_SEGMENT_DURATION_SEC || 3.0),
    maxSegmentDurationSec: Number(process.env.PLANNER_MAX_SEGMENT_DURATION_SEC || 300.0),
    mergeThresholdMs: Number(process.env.PLANNER_MERGE_THRESHOLD_MS || 500),
    deterministic: String(process.env.DETERMINISTIC || 'true') === 'true',
  };
}

function detectSilence(segments, config) {
  const cuts = [];
  for (let i = 0; i < segments.length - 1; i++) {
    const pauseMs = (segments[i + 1].start - segments[i].end) * 1000;
    if (pauseMs >= config.minPauseMs) {
      cuts.push({ start: segments[i].end, end: segments[i + 1].start, reason: `silence_${Math.round(pauseMs)}ms` });
    }
  }
  return cuts;
}

function detectFillerWords(segments, config) {
  const cuts = [];
  for (const seg of segments) {
    for (const w of seg.words || []) {
      const t = (w.text || '').toLowerCase().replace(/[^\p{L}\p{N}'-]+/gu, '');
      if (config.fillerWords.includes(t)) {
        cuts.push({ start: Math.max(0, w.start - 0.3), end: w.end + 0.3, reason: `filler_word_${t}` });
      }
    }
  }
  return cuts;
}

function mergeCutRegions(regions, mergeThresholdMs) {
  if (!regions.length) return [];
  const sorted = regions.map(r => ({ ...r })).sort((a, b) => a.start - b.start);
  const out = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = out[out.length - 1];
    const cur = sorted[i];
    const gapMs = (cur.start - prev.end) * 1000;
    if (gapMs <= mergeThresholdMs) {
      prev.end = Math.max(prev.end, cur.end);
      prev.reason = `${prev.reason}+${cur.reason}`;
    } else {
      out.push(cur);
    }
  }
  return out;
}

function filterShortCuts(regions, minDurationSec) {
  return regions.filter(r => (r.end - r.start) >= minDurationSec);
}

function generateCutPlan(transcriptData, cutRegions, config) {
  const segments = [];
  let t = 0;
  const endT = transcriptData.segments?.[transcriptData.segments.length - 1]?.end || 0;

  const sorted = [...cutRegions].sort((a, b) => a.start - b.start);
  for (const c of sorted) {
    if (t < c.start) {
      segments.push({ start: t.toFixed(2), end: c.start.toFixed(2), type: 'keep', reason: 'content', confidence: 1.0 });
    }
    segments.push({ start: c.start.toFixed(2), end: c.end.toFixed(2), type: 'cut', reason: c.reason, confidence: 1.0 });
    t = c.end;
  }
  if (t < endT) {
    segments.push({ start: t.toFixed(2), end: endT.toFixed(2), type: 'keep', reason: 'content', confidence: 1.0 });
  }

  return {
    schemaVersion: '1.0.0',
    source: 'transcripts/transcript.json',
    output: 'plan/cut_plan.json',
    cuts: segments,
    metadata: {
      processingTimeMs: 0,
      parameters: {
        minPauseMs: config.minPauseMs,
        minCutDurationSec: config.minCutDurationSec,
        mergeThresholdMs: config.mergeThresholdMs,
        deterministic: config.deterministic,
      },
    },
  };
}

function planCuts(transcriptData, userConfig) {
  const config = { ...getDefaultConfig(), ...(userConfig || {}) };
  const silences = detectSilence(transcriptData.segments || [], config);
  const fillers = detectFillerWords(transcriptData.segments || [], config);
  const merged = mergeCutRegions([...silences, ...fillers], config.mergeThresholdMs);
  const filtered = filterShortCuts(merged, config.minCutDurationSec);
  return generateCutPlan(transcriptData, filtered, config);
}

module.exports = {
  planCuts,
  getDefaultConfig,
  detectSilence,
  detectFillerWords,
  mergeCutRegions,
  filterShortCuts,
  generateCutPlan
};
```

3) Implement handler
- Create `backend/services/smart-cut-planner/handler.js` with:
  - Error classes: `PlannerError`, `ERROR_TYPES` (INPUT_NOT_FOUND, TRANSCRIPT_PARSE, TRANSCRIPT_INVALID, PLANNING_FAILED, SCHEMA_VALIDATION, MANIFEST_UPDATE)
  - `validateCutPlan(cutPlanData)` - uses Ajv to validate against `docs/schemas/cut_plan.schema.json`
  - `exports.handler` - async Lambda handler following observability pattern from WP00-03
  - Read transcript JSON from transcriptKey
  - Call `planCuts()` from planner-logic module
  - Build `cut_plan.json` object with `schemaVersion`, `source`, `output`, `cuts[]`, `metadata`
  - Validate before writing
  - Update manifest via `saveManifest`
  - Emit metrics: `PlanningSuccess`, `TotalCuts`, `TotalKeeps`, `PlanningDuration`
  - Error handling: catch, log, update manifest status, rethrow

```javascript
// backend/services/smart-cut-planner/handler.js
const { initObservability } = require('../../lib/init-observability');
const { keyFor, pathFor, writeFileAtKey } = require('../../lib/storage');
const { loadManifest, saveManifest } = require('../../lib/manifest');
const { planCuts } = require('./planner-logic');
const fs = require('node:fs');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const path = require('node:path');

class PlannerError extends Error {
  constructor(message, type, details = {}) {
    super(message);
    this.name = 'PlannerError';
    this.type = type;
    this.details = details;
  }
}

const ERROR_TYPES = {
  INPUT_NOT_FOUND: 'INPUT_NOT_FOUND',
  TRANSCRIPT_PARSE: 'TRANSCRIPT_PARSE',
  TRANSCRIPT_INVALID: 'TRANSCRIPT_INVALID',
  PLANNING_FAILED: 'PLANNING_FAILED',
  SCHEMA_VALIDATION: 'SCHEMA_VALIDATION',
  MANIFEST_UPDATE: 'MANIFEST_UPDATE',
};

function getCutPlanValidator() {
  const schemaPath = path.resolve('docs/schemas/cut_plan.schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

exports.handler = async (event, context) => {
  const { env, tenantId, jobId, transcriptKey } = event;
  const correlationId = event.correlationId || context.awsRequestId;
  const { logger, metrics } = initObservability({
    serviceName: 'SmartCutPlanner',
    correlationId, tenantId, jobId, step: 'smart-cut-planner',
  });

  const validator = getCutPlanValidator();
  const transcriptPath = pathFor(transcriptKey);

  try {
    if (!fs.existsSync(transcriptPath)) {
      throw new PlannerError(`Transcript not found: ${transcriptKey}`, ERROR_TYPES.INPUT_NOT_FOUND, { transcriptKey });
    }
    let transcriptData;
    try {
      transcriptData = JSON.parse(fs.readFileSync(transcriptPath, 'utf-8'));
    } catch (e) {
      throw new PlannerError(`Transcript parse failed: ${e.message}`, ERROR_TYPES.TRANSCRIPT_PARSE);
    }
    if (!Array.isArray(transcriptData.segments) || transcriptData.segments.length === 0) {
      throw new PlannerError(`Transcript invalid: missing segments`, ERROR_TYPES.TRANSCRIPT_INVALID);
    }

    const start = Date.now();
    const cutPlan = planCuts(transcriptData);
    cutPlan.metadata.processingTimeMs = Date.now() - start;

    const valid = validator(cutPlan);
    if (!valid) {
      const msg = (validator.errors || []).map(e => `${e.instancePath} ${e.message}`).join('; ');
      throw new PlannerError(`Cut plan schema invalid: ${msg}`, ERROR_TYPES.SCHEMA_VALIDATION);
    }

    const planKey = keyFor(env, tenantId, jobId, 'plan', 'cut_plan.json');
    writeFileAtKey(planKey, JSON.stringify(cutPlan, null, 2));

    try {
      const manifest = loadManifest(env, tenantId, jobId);
      manifest.plan = {
        ...(manifest.plan || {}),
        key: planKey,
        schemaVersion: cutPlan.schemaVersion,
        algorithm: 'rule-based',
        totalCuts: cutPlan.cuts?.length || 0,
        plannedAt: new Date().toISOString(),
      };
      manifest.updatedAt = new Date().toISOString();
      saveManifest(env, tenantId, jobId, manifest);
    } catch (e) {
      throw new PlannerError(`Manifest update failed: ${e.message}`, ERROR_TYPES.MANIFEST_UPDATE);
    }

    metrics.addMetric('PlanningSuccess', 'Count', 1);
    metrics.addMetric('TotalSegments', 'Count', transcriptData.segments.length);
    metrics.addMetric('TotalCuts', 'Count', cutPlan.cuts?.length || 0);
    logger.info('Planning completed', { planKey, totalCuts: cutPlan.cuts?.length || 0 });

    return { ok: true, planKey, correlationId };
  } catch (err) {
    logger.error('Planning failed', { error: err.message, type: err.type, details: err.details });
    metrics.addMetric('PlanningError', 'Count', 1);
    metrics.addMetric(`PlanningError_${err.type || 'UNKNOWN'}`, 'Count', 1);
    try {
      const manifest = loadManifest(env, tenantId, jobId);
      manifest.status = 'failed';
      manifest.updatedAt = new Date().toISOString();
      manifest.logs = manifest.logs || [];
      manifest.logs.push({ type: 'error', message: `Planner failed: ${err.message}`, createdAt: new Date().toISOString() });
      saveManifest(env, tenantId, jobId, manifest);
    } catch {}
    throw err;
  }
};
```

4) Wire into local harness (WP00‑05)
- `tools/harness/run-local-pipeline.js` already calls `backend/services/smart-cut-planner/handler.js`

5) Add Node dependencies
- Update `package.json` at repo root or service level:
```json
{
  "dependencies": {
    "ajv": "^8.12.0",
    "ajv-formats": "^2.1.1"
  }
}
```

6) Validate manifest updates
- Ensure `manifest.plan.*` fields align with WP00‑02 schema
- Test with various config overrides

7) Logging and metrics
- Confirm logs contain `correlationId`, `tenantId`, `jobId`, `step`
- Confirm EMF metrics published (success, errors by type, cut/keep counts, duration)

8) Deterministic testing
- Run same transcript 10 times with `DETERMINISTIC=true`
- Assert identical `cut_plan.json` output (byte-for-byte or via checksum)

9) Schema validation testing
- Test with malformed cut plans; expect clear validation errors
- Test with valid plans; assert passes

## Test Plan

### Local
- Run harness on a short transcript:
  - Expect `plan/cut_plan.json` with `cuts[]` array
  - Verify cuts include `start`, `end`, `type`, `reason`
  - Verify manifest fields: `algorithm`, `totalCuts`, `plannedAt`
- Validate determinism:
  - Run 10 times with same input; expect identical output
  - Compare JSON byte-for-byte or via checksum
- Validate configuration:
  - Override `minPauseMs` via env var; expect different cut decisions
  - Override `fillerWords` via env; expect different cut decisions
- Error path testing:
  - Missing transcript: expect `INPUT_NOT_FOUND` error
  - Corrupt transcript JSON: expect `TRANSCRIPT_PARSE` error
  - Empty segments: expect `TRANSCRIPT_INVALID` error
  - Invalid cut plan (manual test): expect `SCHEMA_VALIDATION` error with field details
- Repeat runs for same `{jobId}`: no errors; outputs overwritten; manifest updated

### CI (optional if harness lane exists)
- Add a tiny sample transcript (10-20 segments)
- Run planning via harness; assert:
  - `plan/cut_plan.json` exists and is valid JSON
  - Schema validation passes
  - Manifest fields present and non-empty
  - Deterministic flag produces identical output
  - Logs contain required correlation fields

## Success Metrics

- **Determinism**: 100% identical output across 10+ runs with same input and `DETERMINISTIC=true`
- **Correctness**: Cut boundaries align with silence/filler word positions in transcript (±0.1s tolerance)
- **Reliability**: 0 intermittent failures across 20 consecutive runs on same input
- **Observability**: 100% operations logged with required fields; EMF metrics present
- **Schema Compliance**: 100% generated plans pass schema validation

## Dependencies

- MFU‑WP01‑02‑BE: Transcription  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-02-BE-transcription.md
- MFU‑WP00‑02‑BE: Manifest, Tenancy, and Storage Schema  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-02-BE-manifest-tenancy-and-storage-schema.md
- MFU‑WP00‑03‑IAC: Runtime FFmpeg and Observability  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-03-IAC-runtime-ffmpeg-and-observability.md
- MFU‑WP00‑05‑TG: Test Harness and Golden Samples  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-05-TG-test-harness-and-golden-samples.md

## Planning Algorithm Details

### Silence Detection

**Input**: Transcript segments with `start` and `end` timestamps  
**Logic**:
- Calculate pause between consecutive segments: `pauseMs = (nextStart - currentEnd) * 1000`
- If `pauseMs >= minPauseMs` (default 1500ms), mark as silence region
- Store reason as `silence_{pauseMs}ms`

**Example**:
- Segment 1: 0.0s - 5.5s
- Segment 2: 7.2s - 12.0s
- Pause: 1700ms → mark 5.5s - 7.2s as silence cut

### Filler Word Detection

**Input**: Transcript segments with word-level timestamps  
**Logic**:
- For each word, normalize to lowercase and strip punctuation
- Check if word in `fillerWords[]` list
- If match, mark `[word.start - 0.3, word.end + 0.3]` as filler region (includes context)
- Store reason as `filler_word_{word}`

**Example**:
- Word "um" at 3.2s - 3.4s → mark 2.9s - 3.7s for removal

### Merge Strategy

**Input**: List of cut regions (may overlap)  
**Logic**:
- Sort regions by start time
- For each pair of adjacent regions:
  - If gap between them ≤ `mergeThresholdMs` (default 500ms), merge into single region
  - Combine reasons: `reason1+reason2`
- Result: non-overlapping cut regions

### Filtering

**Input**: Merged cut regions  
**Logic**:
- Remove cuts with duration < `minCutDurationSec` (default 0.5s)
- Rationale: very short cuts may be editing artifacts or hesitations worth keeping

### Timeline Generation

**Input**: Filtered cut regions  
**Logic**:
- Walk timeline from start to end
- For each cut region, emit:
  - Keep segment before cut (if any)
  - Cut segment
- Emit final keep segment after last cut
- Each segment has `type: "keep"|"cut"`, `reason`, `confidence: 1.0`

## Risks / Open Questions

- Determinism with future GPT integration: need toggle and version tracking
- Optimal thresholds vary by content type (interview vs lecture vs vlog)
- Handling overlapping speech or music (not detectable from transcript alone)
- Long-term: ML-based planner trained on editor preferences
- Performance with very long transcripts (1+ hour): may need chunking strategy

## Related MFUs

- MFU‑WP01‑02‑BE: Transcription  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-02-BE-transcription.md
- MFU‑WP01‑04‑BE: Video Render Engine  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-04-BE-video-engine-cuts.md

## Implementation Tracking

- Status: planned
- Assigned To: Team
- Start Date: 2025-09-25
- Target Completion: +1 day
- Actual Completion: TBC

