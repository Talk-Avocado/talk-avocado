---
title: "MFU-WP01-05-BE: Video Engine Transitions"
sidebar_label: "WP01-05: BE Transitions"
date: 2025-10-01
status: planned
version: 1.0
audience: [backend-engineers]
---

## MFU-WP01-05-BE: Video Engine Transitions

## MFU Identification

- MFU ID: MFU-WP01-05-BE
- Title: Video Engine Transitions
- Date Created: 2025-10-01
- Date Last Updated: 2025-10-01
- Created By: Radha
- Work Package: WP01 — POC Pipeline
- Sprint: Phase 1 – Pipeline

## MFU Definition

**Functional Description**  
Apply visual and audio transitions between keep segments to improve polish and watchability. Default transition is crossfade with a configurable duration, producing `renders/with_transitions.mp4`. Updates manifest with transition metadata and render entry. Behavior is deterministic given the same plan, source, and parameters.

**Technical Scope**

- Inputs:
  - `plan/cut_plan.json` with `cuts[]` timeline (keep/cut segments)
  - Source video key from `manifest.sourceVideoKey` or `input/{originalFilename}`
- Output:
  - `renders/with_transitions.mp4` encoded H.264
  - Optional: `renders/render-log.json` with timings and command line used
- Transition support (Phase 1):
  - Type: `crossfade` (video `xfade`, audio `acrossfade`)
  - Duration: `durationMs` (default 300ms); audio fade can match or be separately set
  - Applied at every join between consecutive keep segments
- Timing expectations:
  - Let `K` be keep segments and `J = max(K - 1, 0)` joins
  - Expected duration `≈ sum(keepDurations) - J * (durationMs / 1000)` within ±1 frame
- Constraints:
  - Frame accuracy at target fps (±1 frame)
  - A/V sync drift ≤ 50ms at joins after transitions
- Manifest updates:
  - Append `renders[]` entry for transitions output (`type: "preview"`, `codec: "h264"`)
  - Include transition metadata (`transition.type`, `transition.durationMs`, `transition.audioFadeMs`)
- Determinism:
  - Given identical inputs and parameters, output should be byte-identical or match probe metrics

**Business Value**  
Improves perceived quality and smoothness of edited videos, elevating the base cut to a polished preview with minimal additional complexity, and remains deterministic for CI/goldens.

### Target Service Architecture (Phase 1 WP01)

```bash
backend/
  services/
    video-render-engine/
      handler.js               # Extended to support transitions
      renderer-logic.js        # Base cut helpers (from WP01-04)
      transitions-logic.js     # Transition filtergraph builder (new)
      README.md
      package.json
backend/
  lib/
    storage.ts                 # From WP00-02
    manifest.ts                # From WP00-02
    init-observability.ts      # From WP00-03
    ffmpeg-runtime.ts          # From WP00-03
docs/
  mfu-backlog/
    MFU-WP01-04-BE-video-engine-cuts.md
    MFU-WP01-05-BE-video-engine-transitions.md
storage/
  {env}/{tenantId}/{jobId}/...
tools/
  harness/
    run-local-pipeline.js      # From WP00-05; add lane/flag to render transitions
```

### Handler Contract

- Event (from orchestrator or local harness):
  - `env: "dev" | "stage" | "prod"`
  - `tenantId: string`
  - `jobId: string`
  - `planKey?: string` (default `{env}/{tenantId}/{jobId}/plan/cut_plan.json`)
  - `sourceVideoKey?: string` (default from manifest or `input/{original}`)
  - `transitions?: { type?: "crossfade", durationMs?: number, audioFadeMs?: number }`
  - `targetFps?: number` (optional override)
  - `correlationId?: string`
- Behavior:
  - Load manifest; resolve `planKey` and `sourceVideoKey`
  - Validate plan against `docs/schemas/cut_plan.schema.json`
  - Derive keep timeline from plan (`type === "keep"`)
  - Build FFmpeg filtergraph that trims each keep segment and chains them with `xfade`/`acrossfade` at joins using configured durations
  - Write `renders/with_transitions.mp4`; probe with ffprobe for duration/fps/resolution
  - Update `manifest.renders[]` entry with transition metadata and probe results
  - Emit structured logs and EMF metrics
- Errors:
  - On failure, set manifest `status = "failed"` and push error log entry; surface error

### Migration Notes (extend existing handler)

- Extend `backend/services/video-render-engine/handler.js` to add a new code path when `transitions` is present or `TRANSITIONS_ENABLED=true`.
- Implement `backend/services/video-render-engine/transitions-logic.js`:
  - `buildTransitionGraph(keeps, opts)` → returns filtergraph and maps
  - `runTransitions(sourcePath, outputPath, opts)` → executes ffmpeg with graph
  - Reuse `probe()` from `renderer-logic.js` to capture fps/resolution/duration
- Prefer a single-pass render: trim all keep segments and fold them pairwise with `xfade`/`acrossfade`.
- Update manifest via `backend/lib/manifest.ts`; include transition metadata on the render entry.

## Acceptance Criteria

- [ ] Reads `plan/cut_plan.json` and validates against schema (WP00‑02)
- [ ] Resolves source video from manifest or `input/` folder
- [ ] Applies transitions at all joins:
  - [ ] Default type `crossfade` with `durationMs` (default 300ms)
  - [ ] Audio uses `acrossfade`; `audioFadeMs` matches `durationMs` unless overridden
- [ ] Output `renders/with_transitions.mp4` is produced
- [ ] Duration delta respects overlap: `sum(keeps) - joins * durationSec`, within ±1 frame
- [ ] A/V sync drift ≤ 50ms at each join; failure surfaces clear diagnostics
- [ ] ffprobe metrics captured: `duration`, `fps`, `resolution`
- [ ] Deterministic output for same input/config (byte‑identical or matching probe metrics)
- [ ] If fewer than 2 keep segments, produce output without transitions and succeed
- [ ] Manifest updated:
  - [ ] Appends `renders[]` entry with `type = "preview"`, `codec = h264`
  - [ ] Includes transition metadata: `{ type, durationMs, audioFadeMs }`
  - [ ] Updates `updatedAt` and `logs[]` with summary
- [ ] Logs include `correlationId`, `tenantId`, `jobId`, `step = "video-render-engine"`
- [ ] Idempotent for same `{env}/{tenantId}/{jobId}` (safe overwrite)
- [ ] Harness (WP00‑05) can invoke transitions lane locally end-to-end
- [ ] Non-zero exit on error when run via harness; manifest status updated appropriately

## Complexity Assessment

- Complexity: Medium
- Estimated Effort: 1–2 days
- Confidence: Medium

## Dependencies and Prerequisites

- Hard dependencies:
  - MFU‑WP01‑04‑BE (base cuts flow and renderer foundation)
  - MFU‑WP00‑02‑BE (manifest, storage, tenancy helpers, schemas)
  - MFU‑WP00‑03‑IAC (FFmpeg runtime, observability wrappers)
- Recommended:
  - MFU‑WP00‑04‑MW (orchestration skeleton)
  - MFU‑WP00‑05‑TG (harness/goldens integration)

**Environment Variables** (extend `.env.example`):
```env
# Video Transitions (WP01-05)
TRANSITIONS_ENABLED=true
TRANSITIONS_TYPE=crossfade
TRANSITIONS_DURATION_MS=300
TRANSITIONS_AUDIO_FADE_MS=300
RENDER_FPS=30                     # Reuse from WP01-04
FFMPEG_PATH=                      # From WP00-03; optional if ffmpeg on PATH
FFPROBE_PATH=                     # From WP00-03; optional if ffprobe on PATH
# Reuses from WP01-04: RENDER_PRESET, RENDER_CRF, RENDER_AUDIO_CODEC, RENDER_AUDIO_BITRATE, RENDER_THREADS
```

## Agent Execution Guide (Step-by-step)

Follow these steps exactly. All paths are repo‑relative.

1) Ensure directories exist
- Create or verify:
  - `backend/services/video-render-engine/`

2) Implement transitions logic module
- Create `backend/services/video-render-engine/transitions-logic.js` with:
  - `buildTrimNodes(keeps)` → returns filtergraph trim nodes `[vN]`, `[aN]`
  - `buildCrossfadeChain(keeps, opts)` → pairwise `xfade`/`acrossfade` folding into `[vout]`, `[aout]`
  - `buildTransitionGraph(keeps, opts)` → combine trims + chain into final graph + output labels
  - `runTransitions(sourcePath, outputPath, opts)` → execute ffmpeg with graph and encoding params
- Notes:
  - Use `xfade=transition=crossfade:duration={d}:offset={t}` for video
  - Use `[aA][aB]acrossfade=d={d} [aOut]` for audio
  - `offset` for join `i` equals cumulative duration of prior segments minus transition overlap

```javascript
// backend/services/video-render-engine/transitions-logic.js
const { execFile } = require('node:child_process');

class TransitionError extends Error {
  constructor(message, type, details = {}) {
    super(message);
    this.name = 'TransitionError';
    this.type = type;
    this.details = details;
  }
}

const ERROR_TYPES = {
  INVALID_KEEPS: 'INVALID_KEEPS',
  INVALID_DURATION: 'INVALID_DURATION',
  FFMPEG_EXECUTION: 'FFMPEG_EXECUTION'
};

function execAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 50 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) { err.stdout = stdout; err.stderr = stderr; return reject(err); }
      resolve({ stdout, stderr });
    });
  });
}

function toSSFF(s) { return Number(s).toFixed(2); }

function buildTrimNodes(keeps) {
  if (!Array.isArray(keeps) || keeps.length === 0) {
    throw new TransitionError('Invalid keeps array: must be non-empty array', ERROR_TYPES.INVALID_KEEPS, { keeps });
  }
  const parts = [];
  for (let i = 0; i < keeps.length; i++) {
    const s = toSSFF(keeps[i].start);
    const e = toSSFF(keeps[i].end);
    parts.push(`[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[v${i}]`);
    parts.push(`[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${i}]`);
  }
  return parts;
}

function buildCrossfadeChain(keeps, opts = {}) {
  const n = keeps.length;
  if (n === 0) return { chain: [], vOut: null, aOut: null };
  if (n === 1) return { chain: [], vOut: '[v0]', aOut: '[a0]' };

  const durationMs = Number(opts.durationMs || 300);
  if (!(durationMs > 0 && durationMs <= 5000)) {
    throw new TransitionError(`Invalid transition duration: ${durationMs}ms (must be 1-5000ms)`, ERROR_TYPES.INVALID_DURATION, { durationMs });
  }
  const d = durationMs / 1000;

  const audioFadeMs = Number(opts.audioFadeMs || durationMs);
  const audioD = audioFadeMs / 1000;

  const chain = [];
  let curV = '[v0]';
  let curA = '[a0]';

  // Cumulative offset: total emitted timeline length so far (accounting for overlaps)
  let offset = keeps[0].end - keeps[0].start;

  for (let i = 1; i < n; i++) {
    const nextV = `[v${i}]`;
    const nextA = `[a${i}]`;
    const vOut = `[vx${i}]`;
    const aOut = `[ax${i}]`;

    const fadeOffset = offset - d;

    // Video xfade (label outputs explicitly)
    chain.push(`${curV}${nextV}xfade=transition=crossfade:duration=${d.toFixed(2)}:offset=${fadeOffset.toFixed(2)} ${vOut}`);

    // Audio acrossfade with two inputs and labeled output
    chain.push(`${curA}${nextA}acrossfade=d=${audioD.toFixed(2)} ${aOut}`);

    offset += (keeps[i].end - keeps[i].start) - d;
    curV = vOut;
    curA = aOut;
  }

  return { chain, vOut: curV, aOut: curA };
}

function buildTransitionGraph(keeps, opts = {}) {
  const trim = buildTrimNodes(keeps);
  const { chain, vOut, aOut } = buildCrossfadeChain(keeps, opts);
  const filtergraph = [...trim, ...chain].join(';');
  return { filtergraph, vOut, aOut };
}

async function runTransitions(sourcePath, outputPath, opts = {}) {
  const codec = 'libx264';
  const preset = process.env.RENDER_PRESET || 'fast';
  const crf = String(process.env.RENDER_CRF ?? '20');
  const fps = String(opts.fps || process.env.RENDER_FPS || '30');
  const aCodec = process.env.RENDER_AUDIO_CODEC || 'aac';
  const aBitrate = process.env.RENDER_AUDIO_BITRATE || '192k';
  const threads = String(process.env.RENDER_THREADS || '2');

  try {
    const { filtergraph, vOut, aOut } = buildTransitionGraph(opts.keeps, {
      durationMs: opts.durationMs,
      audioFadeMs: opts.audioFadeMs
    });

    const args = [
      '-y',
      '-i', sourcePath,
      '-filter_complex', filtergraph,
      '-map', vOut || '[v0]',
      '-map', aOut || '[a0]',
      '-r', fps,
      '-c:v', codec,
      '-preset', preset,
      '-crf', crf,
      '-c:a', aCodec,
      '-b:a', aBitrate,
      '-threads', threads,
      outputPath,
    ];

    await execAsync(process.env.FFMPEG_PATH || 'ffmpeg', args);
  } catch (err) {
    throw new TransitionError(`FFmpeg execution failed: ${err.message}`, ERROR_TYPES.FFMPEG_EXECUTION, {
      sourcePath,
      outputPath,
      ffmpegError: err.message,
      stderr: err.stderr
    });
  }
}

module.exports = { runTransitions, buildTransitionGraph, TransitionError, ERROR_TYPES };
```

3) Update handler
- In `backend/services/video-render-engine/handler.js` add a new branch to produce `with_transitions.mp4` when `event.transitions` or `TRANSITIONS_ENABLED=true`:
  - Derive keep segments from plan (reuse from WP01‑04)
  - Call `runTransitions(sourcePath, outputPath, { keeps, durationMs, audioFadeMs, fps })`
  - Probe output; validate duration vs expected (±1 frame)
  - Save render entry with transition metadata and update manifest

4) Wire into local harness (WP00‑05)
- Add a flag or lane to run transitions after planning (and optionally after base cuts), using same source plan.

5) Validate manifest updates
- Ensure `manifest.renders[]` entry includes transition details and `updatedAt`

6) Logging and metrics
- Confirm logs contain `correlationId`, `tenantId`, `jobId`, `step`
- Metrics: `RenderTransitionsSuccess`, `RenderTransitionsError_*`, `TransitionsJoins`, `TransitionsDurationDeltaMs`

7) Idempotency
- Re-run with same job; output overwritten safely; manifest updated

## Test Plan

### Local
- Run harness on a short input with a known `cut_plan.json` (≥2 keep segments):
  - Expect `renders/with_transitions.mp4`
  - Validate duration within ±1 frame of `sum(keeps) - joins * durationSec`
  - Validate fps and resolution match configuration
  - Validate A/V sync drift ≤ 50ms at each join
- Configuration validation:
  - Change `TRANSITIONS_DURATION_MS`; expect predictable duration delta
  - Disable transitions; expect base cut behavior only
- Error path testing:
  - Missing `plan/cut_plan.json` → validation error
  - Source video missing → input-not-found error
  - N < 2 keeps → no transitions applied, still succeeds
- Repeatability:
  - Run same job twice; outputs overwritten; manifest updated deterministically

### CI (optional if harness lane exists)
- Add tiny sample plan and video; run transitions lane; assert:
  - Output exists; duration delta matches within ±1 frame
  - Manifest render entry contains transition metadata
  - Logs contain required correlation fields
  - Metrics emitted for joins and success

```yaml
# Optional CI example
transitions-test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'
    - name: Install deps
      run: npm ci || npm install
    - name: Install FFmpeg
      run: |
        sudo apt-get update
        sudo apt-get install -y ffmpeg
    - name: Run transitions harness
      run: |
        node tools/harness/run-local-pipeline.js \
          --input podcast-automation/test-assets/raw/sample-transitions.mp4 \
          --goldens podcast-automation/test-assets/goldens/sample-transitions \
          --env dev
      env:
        TRANSITIONS_ENABLED: true
        TRANSITIONS_DURATION_MS: 300
    - name: Upload artifacts on failure
      if: failure()
      uses: actions/upload-artifact@v4
      with:
        name: transitions-test-outputs
        path: storage/
```

## Success Metrics

- Duration correctness: expected overlap delta within ±1 frame
- A/V sync drift: ≤ 50ms across all joins
- Reliability: 0 intermittent failures across 20 consecutive runs on same input/config
- Observability: 100% operations logged with required fields; EMF metrics present
- Determinism: Same input/config yields identical bytes or matching probe metrics
- Frame accuracy: transitions align at frame boundaries within ±33ms (1 frame at 30fps)

## Dependencies

- MFU‑WP01‑04‑BE: Video Render Engine  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-04-BE-video-engine-cuts.md
- MFU‑WP00‑02‑BE: Manifest, Tenancy, and Storage Schema  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-02-BE-manifest-tenancy-and-storage-schema.md
- MFU‑WP00‑03‑IAC: Runtime FFmpeg and Observability  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-03-IAC-runtime-ffmpeg-and-observability.md
- MFU‑WP00‑05‑TG: Test Harness and Golden Samples  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-05-TG-test-harness-and-golden-samples.md

## Risks / Open Questions

- Accurate `xfade` offsets for variable segment durations; pairwise folding simplifies but requires careful graph assembly
- Audio loudness changes during `acrossfade`; may need `alimiter`/`dynaudnorm` later
- Long inputs with many joins could increase filtergraph complexity and render time
- Mixed resolution/aspect or VFR sources may require normalization upstream (WP01‑04)
- Future transition types (dip-to-black, slide) expand complexity; keep opt-in and deterministic

## Related MFUs

- MFU‑WP01‑03‑BE: Smart Cut Planner  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-03-BE-smart-cut-planner.md
- MFU‑WP01‑04‑BE: Video Render Engine  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-04-BE-video-engine-cuts.md

## Implementation Tracking

- Status: planned
- Assigned To: Team
- Start Date: 2025-10-01
- Target Completion: +2 days
- Actual Completion: TBC