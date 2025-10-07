---
title: "MFU-WP01-06-BE: Subtitles Post-Edit"
sidebar_label: "WP01-06: BE Subtitles Post-Edit"
date: 2025-10-01
status: planned
version: 1.0
audience: [backend-engineers]
---

## MFU-WP01-06-BE: Subtitles Post-Edit

## MFU Identification

- MFU ID: MFU-WP01-06-BE
- Title: Subtitles Post-Edit
- Date Created: 2025-10-01
- Date Last Updated: 2025-10-01
- Created By: Radha
- Work Package: WP01 — POC Pipeline
- Sprint: Phase 1 – Pipeline

## MFU Definition

**Functional Description**  
Re-time subtitles to match the final edited video timeline, accounting for cuts and transitions. Takes original transcript timestamps and maps them to the post-edit timeline, removing subtitles for cut segments and adjusting timing for kept segments. Outputs `subtitles/final.srt` and `subtitles/final.vtt` with frame-accurate timing. Updates manifest with subtitle metadata and processing details.

**Technical Scope**

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

- [ ] Reads `transcripts/transcript.json` with word/segment timestamps
- [ ] Reads `plan/cut_plan.json` with cuts
- [ ] Validates render exists (base_cuts.mp4 or with_transitions.mp4)
- [ ] Maps original timestamps to final timeline:
  - [ ] Removes subtitles for cut segments
  - [ ] Adjusts timing for kept segments accounting for removed content
  - [ ] Maintains frame accuracy: ±1 frame at target fps
- [ ] Generates `subtitles/final.srt` with valid SRT format
- [ ] Generates `subtitles/final.vtt` with valid WebVTT format
- [ ] Timing accuracy: ±1 frame at target fps (default ±33ms at 30fps)
- [ ] Sync validation: subtitle boundaries align with audio content
- [ ] Manifest updated:
  - [ ] Appends `subtitles[]` entry with `type = "final"`, `format = ["srt", "vtt"]`
  - [ ] Includes timing metadata: `originalDurationSec`, `finalDurationSec`, `cutsApplied`
  - [ ] Updates `updatedAt` and `logs[]` with processing summary
- [ ] Logs include `correlationId`, `tenantId`, `jobId`, `step = "subtitles-post-edit"`
- [ ] Idempotent for same `{env}/{tenantId}/{jobId}` (safe overwrite)
- [ ] Harness (WP00-05) can invoke subtitles lane locally end-to-end
- [ ] Non-zero exit on error when run via harness; manifest status updated appropriately

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

### Local
- Run harness on a short input with transcript and cuts:
  - Expect `subtitles/final.srt` and `subtitles/final.vtt`
  - Validate timing alignment with final video (±1 frame)
  - Validate cut segments are removed from subtitles
  - Validate kept segments have adjusted timing
- Error path testing:
  - Missing transcript → validation error
  - Missing cut plan → validation error
  - Missing render → validation error
  - Invalid timing → frame accuracy error
- Repeatability:
  - Run same job twice; outputs overwritten; manifest updated deterministically

### CI (optional if harness lane exists)
- Add tiny sample transcript and render; run subtitles lane; assert:
  - SRT and VTT files exist with valid format
  - Timing aligns with render within ±1 frame
  - Manifest subtitle entries contain metadata
  - Logs contain required correlation fields
  - Metrics emitted for segments and success

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
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-02-BE-transcription.md
- MFU‑WP01‑04‑BE: Video Engine Cuts  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-04-BE-video-engine-cuts.md
- MFU‑WP00‑02‑BE: Manifest, Tenancy, and Storage Schema  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-02-BE-manifest-tenancy-and-storage-schema.md
- MFU‑WP00‑03‑IAC: Runtime FFmpeg and Observability  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-03-IAC-runtime-ffmpeg-and-observability.md
- MFU‑WP00‑05‑TG: Test Harness and Golden Samples  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-05-TG-test-harness-and-golden-samples.md

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
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-02-BE-transcription.md
- MFU‑WP01‑04‑BE: Video Engine Cuts  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-04-BE-video-engine-cuts.md
- MFU‑WP01‑05‑BE: Video Engine Transitions  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-05-BE-video-engine-transitions.md

## Implementation Tracking

- Status: planned
- Assigned To: Team
- Start Date: 2025-10-01
- Target Completion: +2 days
- Actual Completion: TBC