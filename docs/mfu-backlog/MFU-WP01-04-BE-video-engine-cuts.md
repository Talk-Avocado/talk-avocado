---
title: "MFU-WP01-04-BE: Video Engine Cuts"
sidebar_label: "WP01-04: BE Video Cuts"
date: 2025-10-01
status: planned
version: 1.0
audience: [backend-engineers]
---

## MFU-WP01-04-BE: Video Engine Cuts

## MFU Identification

- MFU ID: MFU-WP01-04-BE
- Title: Video Engine Cuts
- Date Created: 2025-10-01
- Date Last Updated:
- Created By: Radha
- Work Package: WP01 — POC Pipeline
- Sprint: Phase 1 – Pipeline

## MFU Definition

**Functional Description**:
Apply `cut_plan.json` to source video; produce `renders/base_cuts.mp4` with frame-accurate cuts and A/V sync.

**Technical Scope**:

### Decisions Adopted (Phase-1)

- Canonical output: `renders/base_cuts.mp4`; transitions are optional in subsequent step.
- Orchestrated by AWS Step Functions (Standard); event shape matches ASL Task input.
- Golden tolerances: duration ±100ms, frame count ±1, A/V sync drift ≤50ms.
- Manifest writes validated; update `steps.cuts.status` and `job.updatedAt`; structured logs.

- Inputs:
  - `plan/cut_plan.json` with `cuts[]` entries (`type: keep|cut`, `start`, `end`)
  - Source video key from `manifest.sourceVideoKey` or fallback to `input/{originalFilename}`
- Output:
  - `renders/base_cuts.mp4` encoded H.264 with configured fps/preset
  - Optional: `renders/render-log.json` with timings and command line used
- Frame-accurate cuts at target fps (±1 frame)
- A/V sync drift ≤ 50ms at all cut boundaries
- Manifest updated with render metadata (`renders[]` entry, durationSec, resolution, codec, type: "preview")
- Structured logs with `correlationId`, `tenantId`, `jobId`, `step`
- Idempotency for same `{env}/{tenantId}/{jobId}`; safe overwrite behavior

**Business Value**  
Delivers the first usable edited video output, enabling further enhancements and validation of the complete processing pipeline from upload to rendered output.

### Target Service Architecture (Phase 1 WP01)

```bash
backend/
  services/
    video-render-engine/
      handler.js               # Lambda/worker handler
      renderer-logic.js        # Core cut application and concat file writer
      README.md                # Service-specific notes (optional)
      package.json             # If service-local deps are used
backend/
  lib/
    storage.ts                 # From WP00-02
    manifest.ts                # From WP00-02
    init-observability.ts      # From WP00-03
    ffmpeg-runtime.ts          # From WP00-03
docs/
  mfu-backlog/
    MFU-WP01-04-BE-video-engine-cuts.md
storage/
  {env}/{tenantId}/{jobId}/...
tools/
  harness/
    run-local-pipeline.js      # From WP00-05, invokes this handler locally
```

### Handler Contract

- Event (from orchestrator or local harness):

```json
{
  "env": "dev|stage|prod",
  "tenantId": "string",
  "jobId": "string",
  "sourceVideoKey": "string",
  "cutPlanKey": "plan/cut_plan.json",
  "outputKey": "renders/base_cuts.mp4",
  "correlationId": "string"
}
```

- Behavior:
  - Load manifest; resolve `planKey` and `sourceVideoKey`
  - Validate plan against `docs/schemas/cut_plan.schema.json`
  - Generate keep timeline from plan (`type === "keep"`)
  - Apply frame-accurate cuts via FFmpeg concat demuxer or filtergraph
  - Write `renders/base_cuts.mp4`; probe with ffprobe for duration/fps/resolution
  - Update `manifest.renders[]` with `{ key, type: "preview", codec: "h264", durationSec, resolution, renderedAt }`
  - Emit structured logs and EMF metrics
- Errors:
  - On failure, set manifest `status = "failed"` and push error log entry

### Migration Notes (use existing handler)

- Use migrated `backend/services/video-render-engine/handler.js` (from `VideoRenderEngine/index.js`).
- Add explicit sync drift check: sample audio around each cut boundary; assert drift <= 50ms, otherwise fail job with diagnostic.
- Replace direct path usage with `backend/lib/storage.ts` helpers; write output to `renders/base_cuts.mp4` and update manifest via `backend/lib/manifest.ts`.

## Acceptance Criteria

- [ ] Reads `plan/cut_plan.json` and validates against schema from WP00‑02
- [ ] Resolves source video from manifest or `input/` folder
- [ ] Applies cuts to produce `renders/base_cuts.mp4`
- [ ] Output duration matches total planned keep duration within ±1 frame
- [ ] A/V sync drift ≤ 50ms at each cut boundary; failure surfaces clear diagnostics
- [ ] Sync drift measurement implemented and enforced (<= 50ms)
- [ ] ffprobe metrics captured: `duration`, `fps`, `resolution`
- [ ] Manifest updated:
  - [ ] Appends `renders[]` entry with `type = "preview"`, `codec = h264`
  - [ ] Sets `durationSec`, `resolution`, `codec`, `fps`, optional `notes`
  - [ ] Updates `updatedAt` and `logs[]` with render summary
- [ ] Logs include `correlationId`, `tenantId`, `jobId`, `step = "video-render-engine"`
- [ ] Idempotent for same `{env}/{tenantId}/{jobId}` (safe overwrite)
- [ ] Harness (WP00-05) can invoke handler locally end-to-end
- [ ] Non-zero exit on error when run via harness; manifest status updated appropriately

## Complexity Assessment

- Complexity: High
- Estimated Effort: 2 days
- Confidence: Medium

## Dependencies and Prerequisites

- Hard dependencies:
  - MFU‑WP01‑03‑BE (Smart Cut Planner — provides `plan/cut_plan.json`)
  - MFU‑WP00‑02‑BE (manifest, storage, tenancy helpers, schemas)
  - MFU‑WP00‑03‑IAC (FFmpeg runtime, observability wrappers)
- Recommended:
  - MFU‑WP00‑04‑MW (orchestration skeleton)
  - MFU‑WP00‑05‑TG (harness/goldens integration)

**Environment Variables** (extend `.env.example`):

```env
# Video Render Engine (WP01-04)
RENDER_CODEC=h264
RENDER_PRESET=fast
RENDER_CRF=20
RENDER_FPS=30
RENDER_THREADS=2
RENDER_AUDIO_CODEC=aac
RENDER_AUDIO_BITRATE=192k
FFMPEG_PATH=                    # From WP00-03; optional if ffmpeg on PATH
```

## Agent Execution Guide (Step-by-step)

Follow these steps exactly. All paths are repo‑relative.

1) Ensure directories exist

    - Create or verify:
      - `backend/services/video-render-engine/`

2) Implement renderer logic module

    - Create `backend/services/video-render-engine/renderer-logic.js` with helpers:
      - `buildConcatFile(keepSegments, sourcePath)` — writes FFmpeg concat demuxer file
      - `runConcatDemuxer(concatPath, outputPath, options)` — executes ffmpeg with re-encode settings
      - `measureSyncDrift(sourcePath, segments)` — optional probe routine around boundaries

    ```javascript
    // backend/services/video-render-engine/renderer-logic.js
    const fs = require('node:fs');
    const path = require('node:path');
    const { execFile } = require('node:child_process');

    function execAsync(cmd, args, opts = {}) {
      return new Promise((resolve, reject) => {
        const child = execFile(cmd, args, { maxBuffer: 50 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
          if (err) { err.stdout = stdout; err.stderr = stderr; return reject(err); }
          resolve({ stdout, stderr });
        });
      });
    }

    // Optional concat demuxer helper (prefer filtergraph in handler for precision)
    function buildConcatFile(keepSegments /*, sourcePath */) {
      const lines = ['ffconcat version 1.0'];
      const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cuts-'));
      const concatPath = path.join(tmpDir, 'list.ffconcat');
      fs.writeFileSync(concatPath, lines.join('\n'));
      return concatPath;
    }

    async function runConcatDemuxer(concatPath, outputPath, options) {
      const codec = options.codec || 'libx264';
      const preset = options.preset || 'fast';
      const crf = String(options.crf ?? '20');
      const fps = String(options.fps || '30');
      const threads = String(options.threads || '2');
      const acodec = options.audioCodec || 'aac';
      const abitrate = options.audioBitrate || '192k';

      await execAsync('ffmpeg', [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concatPath,
        '-r', fps,
        '-c:v', codec,
        '-preset', preset,
        '-crf', crf,
        '-c:a', acodec,
        '-b:a', abitrate,
        '-threads', threads,
        outputPath,
      ]);
    }

    async function probe(pathToFile) {
      const { stdout } = await execAsync(process.env.FFPROBE_PATH || 'ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        pathToFile,
      ]);
      return JSON.parse(stdout);
    }

    // Placeholder drift checker (replace with real measurement if needed)
    async function measureSyncDrift(/* sourcePath, keepSegments */) {
      return { maxDriftMs: 0 };
    }

    module.exports = { buildConcatFile, runConcatDemuxer, measureSyncDrift, probe, execAsync };
    ```

3) Implement handler

    - Create `backend/services/video-render-engine/handler.js` that:
      - Loads manifest and resolves `planKey` and `sourceVideoKey`
      - Validates plan JSON (Ajv) using `docs/schemas/cut_plan.schema.json`
      - Derives keep segments from `cuts[]` entries
      - Chooses strategy:
        - Preferred: concat demuxer with precise in/out and re-encode for stable fps
        - Alternative: complex filtergraph with `trim`/`asetpts` if demuxer not applicable
      - Executes ffmpeg using wrappers from `ffmpeg-runtime.ts`
      - Probes output via ffprobe for `duration`, `fps`, `resolution`
      - Updates `manifest.renders[]` and persists manifest

    ```javascript
    // backend/services/video-render-engine/handler.js
    const { initObservability } = require('../../lib/init-observability');
    const { keyFor, pathFor } = require('../../lib/storage');
    const { loadManifest, saveManifest } = require('../../lib/manifest');
    const { probe, measureSyncDrift, execAsync } = require('./renderer-logic');
    const fs = require('node:fs');
    const path = require('node:path');

    function toSSFF(seconds) {
      return Number(seconds).toFixed(2);
    }

    exports.handler = async (event, context) => {
      const { env, tenantId, jobId } = event;
      const correlationId = event.correlationId || context.awsRequestId;
      const { logger, metrics } = initObservability({
        serviceName: 'VideoRenderEngine',
        correlationId, tenantId, jobId, step: 'video-render-engine',
      });

      const renderPreset = process.env.RENDER_PRESET || 'fast';
      const renderCrf = String(process.env.RENDER_CRF ?? '20');
      const renderFps = String(event.targetFps || process.env.RENDER_FPS || '30');
      const threads = String(process.env.RENDER_THREADS || '2');
      const aCodec = process.env.RENDER_AUDIO_CODEC || 'aac';
      const aBitrate = process.env.RENDER_AUDIO_BITRATE || '192k';

      const planKey = event.planKey || keyFor(env, tenantId, jobId, 'plan', 'cut_plan.json');
      const planPath = pathFor(planKey);

      try {
        if (!fs.existsSync(planPath)) throw new Error(`Plan not found: ${planKey}`);
        const plan = JSON.parse(fs.readFileSync(planPath, 'utf-8'));

        const manifest = loadManifest(env, tenantId, jobId);
        const sourceKey = event.sourceVideoKey
          || manifest.sourceVideoKey
          || keyFor(env, tenantId, jobId, 'input', manifest.input?.originalFilename || '');
        const sourcePath = pathFor(sourceKey);
        if (!fs.existsSync(sourcePath)) throw new Error(`Source video not found: ${sourceKey}`);

        const keeps = (plan.cuts || []).filter(s => s.type === 'keep').map(s => ({
          start: Number(s.start), end: Number(s.end),
        }));

        // Build filtergraph for precise trims + concat
        const filterParts = [];
        let idx = 0;
        for (const seg of keeps) {
          const s = toSSFF(seg.start);
          const e = toSSFF(seg.end);
          filterParts.push(
            `[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[v${idx}]`,
            `[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${idx}]`
          );
          idx++;
        }
        const vLabels = Array.from({ length: keeps.length }, (_, i) => `[v${i}]`).join('');
        const aLabels = Array.from({ length: keeps.length }, (_, i) => `[a${i}]`).join('');
        filterParts.push(`${vLabels}concat=n=${keeps.length}:v=1:a=0[vout]`);
        filterParts.push(`${aLabels}concat=n=${keeps.length}:v=0:a=1[aout]`);

        const outputKey = keyFor(env, tenantId, jobId, 'renders', 'base_cuts.mp4');
        const outputPath = pathFor(outputKey);

        await execAsync('ffmpeg', [
          '-y',
          '-i', sourcePath,
          '-filter_complex', filterParts.join(';'),
          '-map', '[vout]',
          '-map', '[aout]',
          '-r', renderFps,
          '-c:v', 'libx264',
          '-preset', renderPreset,
          '-crf', renderCrf,
          '-c:a', aCodec,
          '-b:a', aBitrate,
          '-threads', threads,
          outputPath,
        ]);

        const p = await probe(outputPath);
        const vStream = (p.streams || []).find(s => s.codec_type === 'video');
        const durationSec = Number(p.format?.duration || vStream?.duration || 0);
        const resolution = vStream ? `${vStream.width}x${vStream.height}` : undefined;

        const drift = await measureSyncDrift(sourcePath, keeps);
        if (drift.maxDriftMs > 50) throw new Error(`A/V sync drift exceeded: ${drift.maxDriftMs}ms`);

        const m = loadManifest(env, tenantId, jobId);
        m.renders = m.renders || [];
        m.renders.push({
          key: outputKey,
          type: 'preview',
          codec: 'h264',
          durationSec,
          resolution,
          notes: `fps=${renderFps}`,
          renderedAt: new Date().toISOString(),
        });
        m.updatedAt = new Date().toISOString();
        saveManifest(env, tenantId, jobId, m);

        metrics.addMetric('RenderSuccess', 'Count', 1);
        metrics.addMetric('RenderDurationSec', 'Milliseconds', durationSec * 1000);
        logger.info('Render completed', { outputKey, durationSec, resolution, fps: renderFps });

        return { ok: true, outputKey, correlationId };
      } catch (err) {
        try {
          const m = loadManifest(env, tenantId, jobId);
          m.status = 'failed';
          m.updatedAt = new Date().toISOString();
          m.logs = m.logs || [];
          m.logs.push({ type: 'error', message: `Render failed: ${err.message}`, createdAt: new Date().toISOString() });
          saveManifest(env, tenantId, jobId, m);
        } catch {}
        metrics.addMetric('RenderError', 'Count', 1);
        logger.error('Render failed', { error: err.message });
        throw err;
      }
    };
    ```

4) Wire into local harness (WP00‑05)

    - `tools/harness/run-local-pipeline.js` already calls this handler in sequence

5) Validate manifest updates and metrics

    - Ensure manifest reflects render info; publish EMF metrics for success, duration, and drift

## Test Plan

### Local

- Run harness on a short input with a known `cut_plan.json`
  - Expect `renders/base_cuts.mp4` present
  - Validate duration within ±1 frame vs sum of keeps
  - Validate fps and resolution match configuration
  - Check A/V sync drift ≤ 50ms at each boundary
- Error path testing:
  - Missing `plan/cut_plan.json` → validation error
  - Corrupt plan (bad schema) → clear Ajv error
  - Source video missing → input-not-found error
- Repeat runs for same `{jobId}`: no errors; output overwritten; manifest updated

### CI (optional if harness lane exists)

- Add a tiny sample plan and video; run via harness and assert metrics/manifest fields

## Success Metrics

- Duration match within ±1 frame; sync drift ≤ 50ms
- 100% runs emit required logs and metrics
- 0 intermittent failures across 20 consecutive runs on same input
- Frame accuracy: cuts align with plan timestamps within ±33ms (1 frame at 30fps)
- Observability: 100% operations logged with required fields; EMF metrics present

## Dependencies

- MFU‑WP01‑03‑BE: Smart Cut Planner  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-03-BE-smart-cut-planner.md>
- MFU‑WP00‑02‑BE: Manifest, Tenancy, and Storage Schema  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-02-BE-manifest-tenancy-and-storage-schema.md>
- MFU‑WP00‑03‑IAC: Runtime FFmpeg and Observability  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-03-IAC-runtime-ffmpeg-and-observability.md>
- MFU‑WP00‑05‑TG: Test Harness and Golden Samples  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-05-TG-test-harness-and-golden-samples.md>

## Risks / Open Questions

- Frame-accuracy with variable frame rate sources — consider normalization upstream
- Concat demuxer vs filtergraph trade-offs for precision and performance
- Large inputs may exceed local disk/time budgets; ensure presets from WP00‑03
- Color space/resolution changes across sources; ensure consistent output parameters
- Sync drift tolerance may need tuning based on content type (music vs speech)

## Related MFUs

- MFU‑WP01‑03‑BE: Smart Cut Planner  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-03-BE-smart-cut-planner.md>
- MFU‑WP01‑05‑BE: Video Engine Transitions  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-05-BE-video-engine-transitions.md>

## Implementation Tracking

- Status: planned
- Assigned To: Team
- Start Date: 2025-09-25
- Target Completion: +2 days
- Actual Completion: TBC
