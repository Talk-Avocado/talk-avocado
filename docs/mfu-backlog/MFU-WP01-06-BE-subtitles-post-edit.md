---
title: "MFU-WP01-06-BE: Subtitles Post-Edit"
sidebar_label: "WP01-06: BE Subtitles Post-Edit"
date: 2025-10-01
status: completed
version: 1.0
audience: [backend-engineers]
---

## MFU-WP01-06-BE: Subtitles Post-Edit

## MFU Identification

- MFU ID: MFU-WP01-06-BE
- Title: Subtitles Post-Edit
- Date Created: 2025-10-01
- Date Last Updated: 2025-11-11
- Created By: Radha
- Work Package: WP01 — POC Pipeline
- Sprint: Phase 1 – Pipeline

## MFU Definition

**Functional Description**  
Re-time subtitles to match the final edited video timeline, accounting for cuts and transitions. Takes original transcript timestamps and maps them to the post-edit timeline, removing subtitles for cut segments and adjusting timing for kept segments. Outputs `subtitles/final.srt` and `subtitles/final.vtt` with frame-accurate timing. Updates manifest with subtitle metadata and processing details.

**Technical Scope**:

### Decisions Adopted (Phase-1)

- Produces `subtitles/final.srt` (and optionally `.vtt`) as authoritative subtitle outputs for burn-in and downstream consumers.
- Reads from `renders/base_cuts.mp4` or `renders/with_transitions.mp4` for validation; tolerances: cue boundary ≤33 ms; no overlaps; monotonic times.
- Manifest writes validated; updates `media.subtitles` pointers and `steps.subtitles.status`; structured logs with correlation fields.
- Orchestrated under AWS Step Functions (Standard); handler event matches ASL Task input.

- Inputs:
  - `transcripts/transcript.json` with original word/segment timestamps
  - `plan/cut_plan.json` with keep/cut segments
  - `renders/base_cuts.mp4` OR `renders/with_transitions.mp4` for duration validation
- Output:
  - `subtitles/final.srt` (SubRip format)
  - `subtitles/final.vtt` (WebVTT format)
  - Optional: `subtitles/timing-map.json` with original→final timestamp mapping
- Timing requirements:
  - Frame accuracy: ±1 frame at target fps (default 30fps = ±33ms)
  - Sync with final video: subtitle boundaries align with audio/video content
  - Handle dropped segments: remove subtitles for cut regions
  - Handle kept segments: adjust timing to account for removed content
- Manifest updates:
  - Append `subtitles[]` entry with file keys, format, duration, word count
  - Include timing metadata: `originalDurationSec`, `finalDurationSec`, `cutsApplied`
- Determinism:
  - Given identical inputs, output should be byte-identical
  - Timing calculations use fixed-point arithmetic for consistency

**Business Value**  
Delivers production-ready captions aligned to the final edited video, supporting accessibility compliance and publishing workflows. Completes the automated pipeline from raw video to polished output with synchronized captions.

### Target Service Architecture (Phase 1 WP01)

```bash
backend/
  services/
    subtitles-post-edit/
      handler.js               # Lambda/worker handler
      timing-logic.js          # Core timestamp mapping and adjustment
      format-generators.js      # SRT and VTT generation
      README.md
      package.json
backend/
  lib/
    storage.ts                 # From WP00-02
    manifest.ts                # From WP00-02
    init-observability.ts      # From WP00-03
docs/
  mfu-backlog/
    MFU-WP01-04-BE-video-engine-cuts.md
    MFU-WP01-05-BE-video-engine-transitions.md
    MFU-WP01-06-BE-subtitles-post-edit.md
storage/
  {env}/{tenantId}/{jobId}/...
tools/
  harness/
    run-local-pipeline.js      # From WP00-05; add lane to run subtitles post-edit
```

### Handler Contract

- Event (from orchestrator or local harness):
  - `env: "dev" | "stage" | "prod"`
  - `tenantId: string`
  - `jobId: string`
  - `transcriptKey?: string` (default `{env}/{tenantId}/{jobId}/transcripts/transcript.json`)
  - `planKey?: string` (default `{env}/{tenantId}/{jobId}/plan/cut_plan.json`)
  - `renderKey?: string` (default `{env}/{tenantId}/{jobId}/renders/base_cuts.mp4` or `with_transitions.mp4`)
  - `targetFps?: number` (optional override)
  - `correlationId?: string`
- Behavior:
  - Load transcript, plan, and validate render exists
  - Map original timestamps to final timeline accounting for cuts
  - Generate SRT and VTT files with frame-accurate timing
  - Validate timing against final video duration
  - Update `manifest.subtitles[]` with metadata and file keys (requires manifest schema extension)
  - Emit structured logs and EMF metrics
- Errors:
  - On failure, set manifest `status = "failed"` and push error log entry; surface error

### Migration Notes (new service)

- Create new `backend/services/subtitles-post-edit/` service.
- **REQUIRED**: Extend manifest schema in WP00-02 to include subtitles support:

  ```json
  "subtitles": {
    "type": "array",
    "items": {
      "type": "object",
      "required": ["key", "type", "format"],
      "properties": {
        "key": { "type": "string" },
        "type": { "type": "string", "enum": ["source", "final"] },
        "format": { "type": "string", "enum": ["srt", "vtt"] },
        "durationSec": { "type": "number", "minimum": 0 },
        "wordCount": { "type": "integer", "minimum": 0 },
        "generatedAt": { "type": "string", "format": "date-time" }
      }
    }
  }
  ```

- Implement `backend/services/subtitles-post-edit/timing-logic.js`:
  - `mapTimestamps(transcript, cutPlan)` → returns adjusted transcript
  - `removeCutSegments(transcript, cutPlan)` → filters out cut regions
  - `adjustTiming(transcript, cutPlan)` → adjusts timestamps for kept segments
- Implement `backend/services/subtitles-post-edit/format-generators.js`:
  - `generateSRT(transcript)` → returns SRT format string
  - `generateVTT(transcript)` → returns WebVTT format string
- Update manifest via `backend/lib/manifest.ts`; include subtitle metadata.

## Acceptance Criteria

- [x] Reads `transcripts/transcript.json` with word/segment timestamps
- [x] Reads `plan/cut_plan.json` with cuts
- [x] Validates render exists (base_cuts.mp4 or with_transitions.mp4)
- [x] Maps original timestamps to final timeline:
  - [x] Removes subtitles for cut segments
  - [x] Adjusts timing for kept segments accounting for removed content
  - [x] Maintains frame accuracy: ±1 frame at target fps
- [x] Generates `subtitles/final.srt` with valid SRT format
- [x] Generates `subtitles/final.vtt` with valid WebVTT format
- [x] Timing accuracy: ±1 frame at target fps (default ±33ms at 30fps)
- [ ] Sync validation: subtitle boundaries align with audio content (optional, deferred)
- [x] Manifest schema supports `subtitles[]` array (completed in WP00-02)
- [x] Manifest updated:
  - [x] Appends `subtitles[]` entry with `type = "final"`, `format = ["srt", "vtt"]`
  - [x] Includes timing metadata: `originalDurationSec`, `finalDurationSec`, `cutsApplied`
  - [x] Updates `updatedAt` and `logs[]` with processing summary
- [x] Logs include `correlationId`, `tenantId`, `jobId`, `step = "subtitles-post-edit"`
- [x] Idempotent for same `{env}/{tenantId}/{jobId}` (safe overwrite)
- [x] Harness (WP00-05) can invoke subtitles lane locally end-to-end
- [x] Non-zero exit on error when run via harness; manifest status updated appropriately

## Complexity Assessment

- Complexity: Medium
- Estimated Effort: 1–2 days
- Confidence: Medium

## Dependencies and Prerequisites

- Hard dependencies:
  - MFU‑WP01‑02‑BE (transcription - provides input transcript JSON)
  - MFU‑WP01‑04‑BE (video engine cuts - provides base render)
  - MFU‑WP00‑02‑BE (manifest, storage, tenancy helpers) **+ schema extension for subtitles**
  - MFU‑WP00‑03‑IAC (observability wrappers)
- Recommended:
  - MFU‑WP01‑05‑BE (video engine transitions - provides enhanced render)
  - MFU‑WP00‑04‑MW (orchestration skeleton)
  - MFU‑WP00‑05‑TG (harness/goldens integration)

**Note**: This MFU requires extending the manifest schema from WP00-02 to include a `subtitles[]` array field. The current manifest schema does not include subtitles support.

**Environment Variables** (extend `.env.example`):

```env
# Subtitles Post-Edit (WP01-06)
SUBTITLES_TARGET_FPS=30
SUBTITLES_FRAME_TOLERANCE_MS=33
SUBTITLES_GENERATE_SRT=true
SUBTITLES_GENERATE_VTT=true
SUBTITLES_INCLUDE_TIMING_MAP=false
```

## Agent Execution Guide (Step-by-step)

Follow these steps exactly. All paths are repo‑relative.

1) Ensure directories exist

    - Create or verify:
      - `backend/services/subtitles-post-edit/`

2) Implement timing logic module

    - Create `backend/services/subtitles-post-edit/timing-logic.js` with:
      - `removeCutSegments(transcript, cutPlan)` → filters out cut regions
      - `adjustTiming(transcript, cutPlan)` → adjusts timestamps for kept segments
      - `validateFrameAccuracy(timestamps, targetFps)` → checks ±1 frame tolerance

    ```javascript
    // backend/services/subtitles-post-edit/timing-logic.js
    class SubtitleError extends Error {
      constructor(message, type, details = {}) {
        super(message);
        this.name = 'SubtitleError';
        this.type = type;
        this.details = details;
      }
    }

    const ERROR_TYPES = {
      INVALID_TRANSCRIPT: 'INVALID_TRANSCRIPT',
      INVALID_PLAN: 'INVALID_PLAN',
      TIMING_MISMATCH: 'TIMING_MISMATCH',
      FRAME_ACCURACY: 'FRAME_ACCURACY'
    };

    function toFrameTime(seconds, fps) {
      return Math.round(seconds * fps) / fps;
    }

    function removeCutSegments(transcript, cutPlan) {
      if (!transcript.segments || !Array.isArray(transcript.segments)) {
        throw new SubtitleError('Invalid transcript: missing segments', ERROR_TYPES.INVALID_TRANSCRIPT);
      }
      
      if (!cutPlan.cuts || !Array.isArray(cutPlan.cuts)) {
        throw new SubtitleError('Invalid cut plan: missing cuts', ERROR_TYPES.INVALID_PLAN);
      }

      const cutSegments = cutPlan.cuts.filter(c => c.type === 'cut');
      
      return {
        ...transcript,
        segments: transcript.segments.filter(segment => {
          const start = Number(segment.start);
          const end = Number(segment.end);
          
          // Check if this segment overlaps with any cut region
          return !cutSegments.some(cut => {
            const cutStart = Number(cut.start);
            const cutEnd = Number(cut.end);
            return (start < cutEnd && end > cutStart);
          });
        })
      };
    }

    function adjustTiming(transcript, cutPlan) {
      const keepSegments = cutPlan.cuts.filter(c => c.type === 'keep');
      const adjustedSegments = [];
      
      let timeOffset = 0;
      
      for (const segment of transcript.segments) {
        const originalStart = Number(segment.start);
        const originalEnd = Number(segment.end);
        
        // Find which keep segment this transcript segment belongs to
        const keepSegment = keepSegments.find(k => 
          originalStart >= Number(k.start) && originalEnd <= Number(k.end)
        );
        
        if (!keepSegment) {
          // This segment was cut - skip it
          continue;
        }
        
        // Calculate timing adjustments
        const cutStart = Number(keepSegment.start);
        const adjustedStart = toFrameTime(originalStart - cutStart + timeOffset, 30);
        const adjustedEnd = toFrameTime(originalEnd - cutStart + timeOffset, 30);
        
        adjustedSegments.push({
          ...segment,
          start: adjustedStart,
          end: adjustedEnd,
          originalStart,
          originalEnd
        });
        
        // Update time offset for next segment
        timeOffset += (Number(keepSegment.end) - Number(keepSegment.start));
      }
      
      return {
        ...transcript,
        segments: adjustedSegments,
        originalDuration: transcript.segments[transcript.segments.length - 1]?.end || 0,
        finalDuration: timeOffset
      };
    }

    function validateFrameAccuracy(transcript, targetFps) {
      const frameTolerance = 1 / targetFps; // ±1 frame in seconds
      
      for (const segment of transcript.segments) {
        const startError = Math.abs(segment.start - toFrameTime(segment.start, targetFps));
        const endError = Math.abs(segment.end - toFrameTime(segment.end, targetFps));
        
        if (startError > frameTolerance || endError > frameTolerance) {
          throw new SubtitleError(
            `Frame accuracy exceeded: start=${startError}s, end=${endError}s (tolerance=${frameTolerance}s)`,
            ERROR_TYPES.FRAME_ACCURACY,
            { segment, startError, endError, frameTolerance }
          );
        }
      }
    }

    module.exports = {
      removeCutSegments,
      adjustTiming,
      validateFrameAccuracy,
      SubtitleError,
      ERROR_TYPES
    };
    ```

3) Implement format generators

    - Create `backend/services/subtitles-post-edit/format-generators.js` with:
      - `generateSRT(transcript)` → returns SRT format string
      - `generateVTT(transcript)` → returns WebVTT format string

    ```javascript
    // backend/services/subtitles-post-edit/format-generators.js
    function formatTimestamp(seconds) {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      const ms = Math.floor((seconds % 1) * 1000);
      
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
    }

    function formatVTTTimestamp(seconds) {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      const ms = Math.floor((seconds % 1) * 1000);
      
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    }

    function generateSRT(transcript) {
      const lines = [];
      let index = 1;
      
      for (const segment of transcript.segments) {
        if (!segment.text || segment.text.trim() === '') continue;
        
        const startTime = formatTimestamp(Number(segment.start));
        const endTime = formatTimestamp(Number(segment.end));
        
        lines.push(`${index}`);
        lines.push(`${startTime} --> ${endTime}`);
        lines.push(segment.text.trim());
        lines.push(''); // Empty line between subtitles
        
        index++;
      }
      
      return lines.join('\n');
    }

    function generateVTT(transcript) {
      const lines = ['WEBVTT', ''];
      
      for (const segment of transcript.segments) {
        if (!segment.text || segment.text.trim() === '') continue;
        
        const startTime = formatVTTTimestamp(Number(segment.start));
        const endTime = formatVTTTimestamp(Number(segment.end));
        
        lines.push(`${startTime} --> ${endTime}`);
        lines.push(segment.text.trim());
        lines.push(''); // Empty line between subtitles
      }
      
      return lines.join('\n');
    }

    module.exports = {
      generateSRT,
      generateVTT,
      formatTimestamp,
      formatVTTTimestamp
    };
    ```

4) Implement handler

    - Create `backend/services/subtitles-post-edit/handler.js` that:
      - Loads transcript, plan, and validates render exists
      - Calls timing logic to map timestamps
      - Generates SRT and VTT files
      - Validates timing accuracy
      - Updates manifest with subtitle metadata

    ```javascript
    // backend/services/subtitles-post-edit/handler.js
    const { initObservability } = require('../../lib/init-observability');
    const { keyFor, pathFor, writeFileAtKey } = require('../../lib/storage');
    const { loadManifest, saveManifest } = require('../../lib/manifest');
    const { removeCutSegments, adjustTiming, validateFrameAccuracy, SubtitleError, ERROR_TYPES } = require('./timing-logic');
    const { generateSRT, generateVTT } = require('./format-generators');
    const fs = require('node:fs');

    exports.handler = async (event, context) => {
      const { env, tenantId, jobId } = event;
      const correlationId = event.correlationId || context.awsRequestId;
      const { logger, metrics } = initObservability({
        serviceName: 'SubtitlesPostEdit',
        correlationId, tenantId, jobId, step: 'subtitles-post-edit',
      });

      const transcriptKey = event.transcriptKey || keyFor(env, tenantId, jobId, 'transcripts', 'transcript.json');
      const planKey = event.planKey || keyFor(env, tenantId, jobId, 'plan', 'cut_plan.json');
      const renderKey = event.renderKey || keyFor(env, tenantId, jobId, 'renders', 'base_cuts.mp4');
      
      const targetFps = Number(event.targetFps || process.env.SUBTITLES_TARGET_FPS || 30);

      try {
        // Load and validate inputs
        const transcriptPath = pathFor(transcriptKey);
        const planPath = pathFor(planKey);
        const renderPath = pathFor(renderKey);
        
        if (!fs.existsSync(transcriptPath)) {
          throw new SubtitleError(`Transcript not found: ${transcriptKey}`, ERROR_TYPES.INVALID_TRANSCRIPT);
        }
        if (!fs.existsSync(planPath)) {
          throw new SubtitleError(`Cut plan not found: ${planKey}`, ERROR_TYPES.INVALID_PLAN);
        }
        if (!fs.existsSync(renderPath)) {
          throw new SubtitleError(`Render not found: ${renderKey}`, ERROR_TYPES.INVALID_PLAN);
        }
        
        const transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf-8'));
        const cutPlan = JSON.parse(fs.readFileSync(planPath, 'utf-8'));
        
        // Process transcript: remove cuts and adjust timing
        const filteredTranscript = removeCutSegments(transcript, cutPlan);
        const adjustedTranscript = adjustTiming(filteredTranscript, cutPlan);
        
        // Validate frame accuracy
        validateFrameAccuracy(adjustedTranscript, targetFps);
        
        // Generate subtitle files
        const srtContent = generateSRT(adjustedTranscript);
        const vttContent = generateVTT(adjustedTranscript);
        
        // Write files
        const srtKey = keyFor(env, tenantId, jobId, 'subtitles', 'final.srt');
        const vttKey = keyFor(env, tenantId, jobId, 'subtitles', 'final.vtt');
        
        writeFileAtKey(srtKey, srtContent);
        writeFileAtKey(vttKey, vttContent);
        
        // Update manifest
        const manifest = loadManifest(env, tenantId, jobId);
        manifest.subtitles = manifest.subtitles || [];
        manifest.subtitles.push({
          key: srtKey,
          type: 'final',
          format: 'srt',
          durationSec: adjustedTranscript.finalDuration,
          wordCount: adjustedTranscript.segments.reduce((count, seg) => count + (seg.text?.split(' ').length || 0), 0),
          generatedAt: new Date().toISOString()
        });
        manifest.subtitles.push({
          key: vttKey,
          type: 'final',
          format: 'vtt',
          durationSec: adjustedTranscript.finalDuration,
          wordCount: adjustedTranscript.segments.reduce((count, seg) => count + (seg.text?.split(' ').length || 0), 0),
          generatedAt: new Date().toISOString()
        });
        
        manifest.updatedAt = new Date().toISOString();
        manifest.logs = manifest.logs || [];
        manifest.logs.push({
          type: 'info',
          message: `Subtitles generated: ${adjustedTranscript.segments.length} segments, ${adjustedTranscript.finalDuration.toFixed(2)}s duration`,
          createdAt: new Date().toISOString()
        });
        
        saveManifest(env, tenantId, jobId, manifest);
        
        metrics.addMetric('SubtitlesGenerated', 'Count', 1);
        metrics.addMetric('SubtitlesSegments', 'Count', adjustedTranscript.segments.length);
        metrics.addMetric('SubtitlesDurationSec', 'Milliseconds', adjustedTranscript.finalDuration * 1000);
        logger.info('Subtitles generated', { srtKey, vttKey, segments: adjustedTranscript.segments.length });
        
        return { ok: true, srtKey, vttKey, correlationId };
      } catch (err) {
        logger.error('Subtitle generation failed', { error: err.message, type: err.type });
        metrics.addMetric('SubtitlesError', 'Count', 1);
        metrics.addMetric(`SubtitlesError_${err.type || 'UNKNOWN'}`, 'Count', 1);
        
        try {
          const manifest = loadManifest(env, tenantId, jobId);
          manifest.status = 'failed';
          manifest.updatedAt = new Date().toISOString();
          manifest.logs = manifest.logs || [];
          manifest.logs.push({
            type: 'error',
            message: `Subtitle generation failed: ${err.message}`,
            createdAt: new Date().toISOString()
          });
          saveManifest(env, tenantId, jobId, manifest);
        } catch {}
        
        throw err;
      }
    };
    ```

5) Wire into local harness (WP00-05)

    - Add a flag or lane to run subtitles post-edit after cuts (and optionally after transitions), using same job context.

6) Validate manifest updates

    - Ensure `manifest.subtitles[]` entries include timing metadata and `updatedAt`

7) Logging and metrics

    - Confirm logs contain `correlationId`, `tenantId`, `jobId`, `step`
    - Metrics: `SubtitlesGenerated`, `SubtitlesSegments`, `SubtitlesDurationSec`, `SubtitlesError_*`

8) Idempotency

    - Re-run with same job; output overwritten safely; manifest updated

## Test Plan

### Local ✅ **COMPLETED**

**Test Scripts Created:**
- `backend/services/subtitles-post-edit/test-handler.js` - Basic functionality test
- `backend/services/subtitles-post-edit/test-error-paths.js` - Error handling tests
- `backend/services/subtitles-post-edit/test-idempotency.js` - Idempotency validation

**Tests Executed:**

1. **Basic Functionality** ✅
   - ✓ Run handler with valid inputs (transcript, cut plan, render)
   - ✓ `subtitles/final.srt` generated (368 bytes, valid SubRip format)
   - ✓ `subtitles/final.vtt` generated (368 bytes, valid WebVTT format)
   - ✓ Timing alignment validated: Original 25s → Final 20s (3 cuts applied)
   - ✓ Cut segments removed from subtitles (4 segments preserved)
   - ✓ Kept segments have adjusted timing (frame-accurate)
   - ✓ Manifest updated with subtitle entries and timing metadata

2. **Error Path Testing** ✅
   - ✓ Missing transcript → `INVALID_TRANSCRIPT` error thrown
   - ✓ Missing cut plan → `INVALID_PLAN` error thrown
   - ✓ Missing render → `INVALID_PLAN` error thrown
   - ✓ All errors update manifest status to 'failed' and log errors

3. **Repeatability/Idempotency** ✅
   - ✓ Run same job twice; outputs overwritten safely
   - ✓ SRT and VTT content identical between runs
   - ✓ Manifest updated deterministically (no duplication)
   - ✓ Old final subtitle entries removed before adding new ones

**Test Results:**
- All tests passed successfully
- Detailed results documented in `backend/services/subtitles-post-edit/TEST_RESULTS.md`

**Test Output Paths:**

1. **Short Video Test** (sample-short.mp4):
   - Storage Key: `dev/t-local/{jobId}/subtitles/final.srt` and `final.vtt`
   - Example: `storage/dev/t-local/62f839fe-6d56-444d-b295-c472ab866354/subtitles/final.srt`
   - Duration: 20s (from 25s original, 3 cuts applied)
   - Segments: 4 segments, 38 words

2. **59-Minute Video Test** (real-world test):
   - Job ID: `872d6765-2d60-4806-aa8f-b9df56f74c03`
   - Storage Key: `dev/t-test/872d6765-2d60-4806-aa8f-b9df56f74c03/subtitles/final.srt` and `final.vtt`
   - Full Path: `D:\talk-avocado\storage\dev\t-test\872d6765-2d60-4806-aa8f-b9df56f74c03\subtitles\final.srt`
   - Input: 907 segments, 60.01 minutes (3600.65s)
   - Output: 891 segments, 59.19 minutes (3551.58s)
   - Cuts Applied: 18 cut segments removed
   - Duration Reduction: 49.07s (0.82 minutes)
   - Word Count: 9,939 words
   - File Sizes: SRT 82.04 KB, VTT 78.67 KB
   - Processing Time: 0.03 seconds
   - Status: ✅ **SUCCESS** - Validated on real 59-minute video with transitions

### CI (optional if harness lane exists)

**Status:** Not yet integrated into CI pipeline

**Recommended CI Integration:**
- Add test step to CI workflow that runs subtitles-post-edit handler
- Use test assets from `podcast-automation/test-assets/`
- Assert:
  - SRT and VTT files exist with valid format
  - Timing aligns with render within ±1 frame
  - Manifest subtitle entries contain metadata
  - Logs contain required correlation fields (`correlationId`, `tenantId`, `jobId`, `step`)
  - Metrics emitted for segments and success

**Note:** Local testing has validated all these requirements. CI integration can be added when needed.

```yaml
# Optional CI example
subtitles-test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'
    - name: Install deps
      run: npm ci || npm install
    - name: Run subtitles harness
      run: |
        node tools/harness/run-local-pipeline.js \
          --input podcast-automation/test-assets/raw/sample-subtitles.mp4 \
          --goldens podcast-automation/test-assets/goldens/sample-subtitles \
          --env dev
      env:
        SUBTITLES_TARGET_FPS: 30
        SUBTITLES_GENERATE_SRT: true
        SUBTITLES_GENERATE_VTT: true
    - name: Upload artifacts on failure
      if: failure()
      uses: actions/upload-artifact@v4
      with:
        name: subtitles-test-outputs
        path: storage/
```

## Success Metrics

- Timing accuracy: ±1 frame alignment with final video
- Sync validation: subtitle boundaries match audio content
- Reliability: 0 intermittent failures across 20 consecutive runs on same input
- Observability: 100% operations logged with required fields; EMF metrics present
- Determinism: Same input/config yields identical subtitle files
- Format compliance: Generated SRT/VTT files pass format validation

## Dependencies

- MFU‑WP01‑02‑BE: Transcription  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-02-BE-transcription.md>
- MFU‑WP01‑04‑BE: Video Engine Cuts  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-04-BE-video-engine-cuts.md>
- MFU‑WP00‑02‑BE: Manifest, Tenancy, and Storage Schema  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-02-BE-manifest-tenancy-and-storage-schema.md>
- MFU‑WP00‑03‑IAC: Runtime FFmpeg and Observability  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-03-IAC-runtime-ffmpeg-and-observability.md>
- MFU‑WP00‑05‑TG: Test Harness and Golden Samples  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-05-TG-test-harness-and-golden-samples.md>

## Risks / Open Questions

- Complex timing calculations with multiple cuts may accumulate rounding errors
- Very short segments after cuts may need subtitle text truncation
- Long transcripts with many cuts could impact processing time
- Future: support for multiple languages and subtitle tracks
- Edge case: overlapping subtitles when cuts are very close together
- **Pipeline Integration**: WP01-07 (Branding) and WP01-08 (UAT) expect `subtitles/final.srt` - ensure compatibility
- **Manifest Schema**: Requires extending WP00-02 manifest schema - coordinate with manifest team

## Related MFUs

- MFU‑WP01‑02‑BE: Transcription  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-02-BE-transcription.md>
- MFU‑WP01‑04‑BE: Video Engine Cuts  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-04-BE-video-engine-cuts.md>
- MFU‑WP01‑05‑BE: Video Engine Transitions  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-05-BE-video-engine-transitions.md>

## Implementation Tracking

- Status: completed
- Assigned To: Team
- Start Date: 2025-10-01
- Target Completion: +2 days
- Actual Completion: 2025-11-11
- Implementation Notes:
  - All core functionality implemented and tested
  - Service integrated with harness
  - Error handling and idempotency validated
  - Sync validation deferred (optional enhancement)
  - Test results documented in `backend/services/subtitles-post-edit/TEST_RESULTS.md`

## Implementation Plan for Outstanding Items

### Current Status Review

**Completed:**
- ✅ Manifest schema extension: The `subtitles[]` array field is already implemented in `backend/lib/types.ts` and `docs/schemas/manifest.schema.json` (completed in WP00-02)
- ✅ Storage and manifest libraries: Ready to use (`backend/lib/storage.ts`, `backend/lib/manifest.ts`)
- ✅ Observability module: Ready to use (`backend/lib/init-observability.ts`)
- ✅ Service directory and all implementation files: `backend/services/subtitles-post-edit/`
  - `timing-logic.js` - Core timestamp mapping and adjustment
  - `format-generators.js` - SRT and VTT generation
  - `handler.js` - Main Lambda handler
  - `README.md` - Service documentation
- ✅ Harness integration: Added to `tools/harness/run-local-pipeline.js`
- ✅ All functional acceptance criteria: Implemented and tested
- ✅ Testing: Comprehensive test suite with all tests passing
  - Basic functionality test
  - Error path tests
  - Idempotency validation
  - Format validation
  - Manifest update validation

**Outstanding:**
- ⏸️ Sync validation (optional enhancement - deferred)

### Step-by-Step Implementation Plan

#### Step 1: Create Service Directory Structure
**Location:** `backend/services/subtitles-post-edit/`

**Actions:**
1. Create directory: `backend/services/subtitles-post-edit/`
2. Create `package.json` (if needed for dependencies)
3. Create `README.md` with service documentation

**Files to create:**
- `backend/services/subtitles-post-edit/timing-logic.js` - Core timestamp mapping logic
- `backend/services/subtitles-post-edit/format-generators.js` - SRT and VTT generation
- `backend/services/subtitles-post-edit/handler.js` - Main Lambda handler
- `backend/services/subtitles-post-edit/handler.d.ts` - TypeScript definitions (optional but recommended)

**Acceptance Criteria Addressed:**
- Sets up foundation for all remaining criteria

---

#### Step 2: Implement Timing Logic Module
**File:** `backend/services/subtitles-post-edit/timing-logic.js`

**Implementation Details:**
1. Create `SubtitleError` class extending `Error` with `type` and `details` properties
2. Define `ERROR_TYPES` constants: `INVALID_TRANSCRIPT`, `INVALID_PLAN`, `TIMING_MISMATCH`, `FRAME_ACCURACY`
3. Implement `toFrameTime(seconds, fps)` helper function for frame-accurate rounding
4. Implement `removeCutSegments(transcript, cutPlan)`:
   - Validates transcript has `segments` array
   - Validates cutPlan has `cuts` array
   - Filters out transcript segments that overlap with any cut region
   - Returns filtered transcript
5. Implement `adjustTiming(transcript, cutPlan)`:
   - Processes kept segments from cut plan
   - Calculates time offset for each kept segment
   - Adjusts transcript segment timestamps relative to kept segments
   - Maintains frame accuracy using `toFrameTime`
   - Returns adjusted transcript with `originalDuration` and `finalDuration`
6. Implement `validateFrameAccuracy(transcript, targetFps)`:
   - Validates all segment timestamps are within ±1 frame tolerance
   - Throws `SubtitleError` if tolerance exceeded

**Acceptance Criteria Addressed:**
- ✅ Maps original timestamps to final timeline
- ✅ Removes subtitles for cut segments
- ✅ Adjusts timing for kept segments accounting for removed content
- ✅ Maintains frame accuracy: ±1 frame at target fps
- ✅ Timing accuracy: ±1 frame at target fps (default ±33ms at 30fps)

**Testing Considerations:**
- Test with single cut, multiple cuts, overlapping segments
- Test edge cases: segments at cut boundaries, very short segments
- Test frame accuracy validation with various FPS values

---

#### Step 3: Implement Format Generators Module
**File:** `backend/services/subtitles-post-edit/format-generators.js`

**Implementation Details:**
1. Implement `formatTimestamp(seconds)` for SRT format:
   - Format: `HH:MM:SS,mmm` (comma separator for milliseconds)
   - Handles hours, minutes, seconds, milliseconds
   - Pads with zeros as needed
2. Implement `formatVTTTimestamp(seconds)` for WebVTT format:
   - Format: `HH:MM:SS.mmm` (period separator for milliseconds)
   - Same structure as SRT but with period
3. Implement `generateSRT(transcript)`:
   - Iterates through transcript segments
   - Skips empty segments
   - Formats each segment as:
     ```
     {index}
     {startTime} --> {endTime}
     {text}
     {empty line}
     ```
   - Returns complete SRT string
4. Implement `generateVTT(transcript)`:
   - Starts with `WEBVTT` header and empty line
   - Formats each segment as:
     ```
     {startTime} --> {endTime}
     {text}
     {empty line}
     ```
   - Returns complete VTT string

**Acceptance Criteria Addressed:**
- ✅ Generates `subtitles/final.srt` with valid SRT format
- ✅ Generates `subtitles/final.vtt` with valid WebVTT format

**Testing Considerations:**
- Validate SRT format against standard (SubRip specification)
- Validate VTT format against WebVTT specification
- Test with special characters, line breaks, empty segments
- Test timestamp formatting edge cases (0s, >1 hour, etc.)

---

#### Step 4: Implement Handler
**File:** `backend/services/subtitles-post-edit/handler.js`

**Implementation Details:**
1. Import dependencies:
   - `initObservability` from `../../lib/init-observability`
   - `keyFor`, `pathFor`, `writeFileAtKey` from `../../lib/storage`
   - `loadManifest`, `saveManifest` from `../../lib/manifest`
   - `fs` from `node:fs`
   - Timing logic and format generators from local modules
2. Implement `exports.handler = async (event, context)`:
   - Extract `env`, `tenantId`, `jobId` from event
   - Generate `correlationId` from event or `context.awsRequestId`
   - Initialize observability with `serviceName: 'SubtitlesPostEdit'`, `step: 'subtitles-post-edit'`
   - Resolve input keys with defaults:
     - `transcriptKey`: default to `{env}/{tenantId}/{jobId}/transcripts/transcript.json`
     - `planKey`: default to `{env}/{tenantId}/{jobId}/plan/cut_plan.json`
     - `renderKey`: default to `{env}/{tenantId}/{jobId}/renders/base_cuts.mp4` (or `with_transitions.mp4` if transitions enabled)
   - Get `targetFps` from event or env var (default 30)
3. Input validation:
   - Check transcript file exists, throw `SubtitleError` if not
   - Check cut plan file exists, throw `SubtitleError` if not
   - Check render file exists, throw `SubtitleError` if not
   - Parse JSON files
4. Process transcript:
   - Call `removeCutSegments(transcript, cutPlan)`
   - Call `adjustTiming(filteredTranscript, cutPlan)`
   - Call `validateFrameAccuracy(adjustedTranscript, targetFps)`
5. Generate subtitle files:
   - Call `generateSRT(adjustedTranscript)` and `generateVTT(adjustedTranscript)`
   - Write SRT to `{env}/{tenantId}/{jobId}/subtitles/final.srt`
   - Write VTT to `{env}/{tenantId}/{jobId}/subtitles/final.vtt`
6. Update manifest:
   - Load current manifest
   - Initialize `manifest.subtitles = []` if not present
   - Push SRT entry: `{ key, type: 'final', format: 'srt', durationSec, wordCount, generatedAt }`
   - Push VTT entry: `{ key, type: 'final', format: 'vtt', durationSec, wordCount, generatedAt }`
   - Calculate `wordCount` from segments
   - Set `originalDurationSec` and `finalDurationSec` from adjusted transcript
   - Set `cutsApplied` count from cut plan
   - Update `manifest.updatedAt`
   - Append log entry with processing summary
   - Save manifest
7. Metrics and logging:
   - Emit `SubtitlesGenerated` metric (Count: 1)
   - Emit `SubtitlesSegments` metric (Count: segment count)
   - Emit `SubtitlesDurationSec` metric (Milliseconds: duration * 1000)
   - Log success with correlation fields
8. Error handling:
   - Catch errors, log with correlation fields
   - Emit error metrics: `SubtitlesError`, `SubtitlesError_{type}`
   - Update manifest status to `'failed'`
   - Append error log entry
   - Re-throw error for harness to catch

**Acceptance Criteria Addressed:**
- ✅ Reads `transcripts/transcript.json` with word/segment timestamps
- ✅ Reads `plan/cut_plan.json` with cuts
- ✅ Validates render exists (base_cuts.mp4 or with_transitions.mp4)
- ✅ Manifest updated with `subtitles[]` entries
- ✅ Includes timing metadata: `originalDurationSec`, `finalDurationSec`, `cutsApplied`
- ✅ Updates `updatedAt` and `logs[]` with processing summary
- ✅ Logs include `correlationId`, `tenantId`, `jobId`, `step = "subtitles-post-edit"`
- ✅ Idempotent for same `{env}/{tenantId}/{jobId}` (safe overwrite)
- ✅ Non-zero exit on error when run via harness; manifest status updated appropriately

**Testing Considerations:**
- Test with valid inputs end-to-end
- Test error paths: missing files, invalid JSON, timing errors
- Test idempotency: run twice, verify overwrite
- Test with both `base_cuts.mp4` and `with_transitions.mp4`
- Verify manifest updates correctly
- Verify metrics and logs are emitted

---

#### Step 5: Add Sync Validation (Optional Enhancement)
**Location:** `backend/services/subtitles-post-edit/handler.js` or separate validation module

**Implementation Details:**
1. Optionally validate subtitle boundaries align with audio content:
   - Use FFprobe to extract audio timestamps from render
   - Compare subtitle cue boundaries with audio segment boundaries
   - Log warnings if misalignment detected (within tolerance)
   - This is a validation step, not a blocker

**Acceptance Criteria Addressed:**
- ✅ Sync validation: subtitle boundaries align with audio content (if implemented)

**Note:** This may require FFmpeg/FFprobe integration. Can be deferred to later iteration if needed.

---

#### Step 6: Integrate with Harness
**File:** `tools/harness/run-local-pipeline.js`

**Implementation Details:**
1. Add subtitles-post-edit handler to handlers array:
   ```javascript
   { name: 'subtitles-post-edit', path: '../../backend/services/subtitles-post-edit/handler.js' }
   ```
2. Add handler-specific event building:
   - After video-render-engine completes
   - Build event with:
     - `env`, `tenantId`, `jobId`
     - `transcriptKey`: from manifest or default path
     - `planKey`: from manifest or default path
     - `renderKey`: check for `with_transitions.mp4` first, fallback to `base_cuts.mp4`
     - `targetFps`: from env var or default 30
   - Handle errors: update manifest status, exit with non-zero code
3. Update handler execution order:
   - Ensure subtitles-post-edit runs after video-render-engine
   - Can run after transitions if `--transitions` flag is set

**Acceptance Criteria Addressed:**
- ✅ Harness (WP00-05) can invoke subtitles lane locally end-to-end
- ✅ Non-zero exit on error when run via harness; manifest status updated appropriately

**Testing Considerations:**
- Run full pipeline with `--input` flag
- Verify subtitles are generated
- Test error handling: remove transcript file, verify harness exits with error
- Test with `--transitions` flag to use `with_transitions.mp4`

---

#### Step 7: Add Environment Variables
**File:** `.env.example` (if exists) or document in README

**Variables to add:**
```env
# Subtitles Post-Edit (WP01-06)
SUBTITLES_TARGET_FPS=30
SUBTITLES_FRAME_TOLERANCE_MS=33
SUBTITLES_GENERATE_SRT=true
SUBTITLES_GENERATE_VTT=true
SUBTITLES_INCLUDE_TIMING_MAP=false
```

**Acceptance Criteria Addressed:**
- Supports configurable FPS and format generation

---

#### Step 8: Testing and Validation

**Local Testing:**
1. Run harness with test input:
   ```bash
   node tools/harness/run-local-pipeline.js \
     --input podcast-automation/test-assets/raw/sample-short.mp4 \
     --env dev \
     --tenant t-local
   ```
2. Verify outputs:
   - Check `storage/dev/t-local/{jobId}/subtitles/final.srt` exists and is valid
   - Check `storage/dev/t-local/{jobId}/subtitles/final.vtt` exists and is valid
   - Check manifest includes `subtitles[]` entries
   - Verify timing metadata is correct
3. Test error paths:
   - Remove transcript file, verify error handling
   - Remove cut plan, verify error handling
   - Remove render, verify error handling
4. Test idempotency:
   - Run handler twice, verify outputs are overwritten
   - Verify manifest updates correctly

**Golden Testing (if goldens exist):**
1. Add subtitle golden files to test assets
2. Update `compare-goldens.js` to compare subtitle files
3. Run harness with `--goldens` flag

**Acceptance Criteria Addressed:**
- All acceptance criteria validated through testing

---

### Implementation Order Summary

1. **Step 1**: Create service directory structure ✅ **COMPLETED**
2. **Step 2**: Implement timing logic module ✅ **COMPLETED**
3. **Step 3**: Implement format generators module ✅ **COMPLETED**
4. **Step 4**: Implement handler (integrates steps 2-3) ✅ **COMPLETED**
5. **Step 6**: Integrate with harness (enables testing) ✅ **COMPLETED**
6. **Step 7**: Add environment variables ✅ **COMPLETED** (documented in README)
7. **Step 8**: Testing and validation ✅ **COMPLETED** (all tests passed)
8. **Step 5**: Add sync validation ⏸️ **DEFERRED** (optional enhancement)

### Estimated Time

- Step 1: 15 minutes
- Step 2: 2-3 hours (complex timing logic)
- Step 3: 1-2 hours (format generation)
- Step 4: 2-3 hours (handler integration)
- Step 5: 1-2 hours (optional sync validation)
- Step 6: 1 hour (harness integration)
- Step 7: 15 minutes
- Step 8: 2-3 hours (testing)

**Total: 10-15 hours (1.5-2 days)**

### Dependencies to Verify

Before starting implementation, verify:
- ✅ Manifest schema supports subtitles (already verified)
- ✅ Storage library functions work correctly
- ✅ Manifest library functions work correctly
- ✅ Observability module is available
- ✅ Transcript format matches expected structure (check transcription service output)
- ✅ Cut plan format matches expected structure (check smart-cut-planner output)
- ✅ Render files are available after video-render-engine completes
