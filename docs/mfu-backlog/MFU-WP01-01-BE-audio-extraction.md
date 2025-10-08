---
title: "MFU-WP01-01-BE: Audio Extraction"
sidebar_label: "WP01-01: BE Audio Extraction"
date: 2025-10-01
status: planned
version: 1.0
audience: [backend-engineers]
---

## MFU-WP01-01-BE: Audio Extraction

## MFU Identification

- MFU ID: MFU-WP01-01-BE
- Title: Audio Extraction
- Date Created:2025-10-01
- Date Last Updated:
- Created By: Radha
- Work Package: WP01 — POC Pipeline
- Sprint: Phase 1 – Pipeline

## MFU Definition

**Functional Description**  
Extract audio (mp3) from an uploaded video and update the job manifest with audio metadata (codec, duration, bitrate, sample rate). Outputs are tenant-scoped and compatible with local-first storage, enabling downstream transcription.

**Technical Scope**:

### Decisions Adopted (Phase-1)

- Writes `media.sourceKey` in manifest when normalizing source video; structured logs include correlation fields.
- Tenant paths follow `{env}/{tenantId}/{jobId}/…`; IAM/DDB isolation per ADR-004.
- Error taxonomy standardized; metrics emitted for success and errors; retries only for transient errors.
- Orchestrated under AWS Step Functions (Standard); event shape matches ASL Task input.

- Inputs: `.mp4`, `.mov` under `input/`
- Output: `audio/{jobId}.mp3`
- ffprobe-based metadata capture:
  - `audio.durationSec`, `audio.bitrateKbps`, `audio.sampleRate`, `audio.codec`
- Manifest updates: `manifest.audio.*` and `manifest.updatedAt`
- Idempotency for same `{env}/{tenantId}/{jobId}`; safe overwrite behavior
- Structured logs with `correlationId`, `tenantId`, `jobId`, `step`
- Deterministic behavior given same input and parameters

**Business Value**  
Provides a reliable, tenant-safe audio source for transcription, aligning artifacts with the canonical storage and manifest contract to unblock downstream steps.

### Target Service Architecture (Phase 1 WP01)

```bash
backend/
  services/
    audio-extraction/
      handler.js               # Lambda/worker handler
      README.md                # Service-specific notes (optional)
      package.json             # If service-local deps are used
backend/
  lib/
    storage.ts                 # From WP00-02
    manifest.ts                # From WP00-02
    init-observability.ts      # From WP00-03
    ffmpeg-runtime.ts          # From WP00-03 (exec helpers)
docs/
  mfu-backlog/
    MFU-WP01-01-BE-audio-extraction.md
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
  - `inputKey: string` (e.g., `{env}/{tenantId}/{jobId}/input/<filename>`)
  - `correlationId?: string`
- Behavior:
  - Derive `outputKey = {env}/{tenantId}/{jobId}/audio/{jobId}.mp3`
  - Execute FFmpeg to extract MP3 from input video
  - Probe output with ffprobe and update `manifest.audio` fields
  - Persist manifest
  - Emit structured logs and EMF metrics
- Errors:
  - On failure, set manifest `status = "failed"` (if applicable in step) and surface error

### Migration Notes (use existing logic and wrappers)

- Migrate logic from `podcast-automation/ExtractAudioFromVideo/index.js` into `backend/services/audio-extraction/handler.js`
- Replace direct paths with `backend/lib/storage.ts` (`keyFor`, `pathFor`, `writeFileAtKey`)
- Use `backend/lib/manifest.ts` (`loadManifest`, `saveManifest`) for manifest updates
- Use observability and FFmpeg helpers from WP00-03 (`init-observability.ts`, `ffmpeg-runtime.ts`)
- Ensure output key is tenant-scoped: `{env}/{tenantId}/{jobId}/audio/{jobId}.mp3`

## Acceptance Criteria

- [ ] Supports `.mp4` and `.mov` inputs under `input/`
- [ ] Writes `audio/{jobId}.mp3` at `{env}/{tenantId}/{jobId}/audio/{jobId}.mp3`
- [ ] Probes and updates manifest:
  - [ ] `audio.key`, `audio.codec` ∈ {mp3}
  - [ ] `audio.durationSec` (±0.1s vs ffprobe format.duration)
  - [ ] `audio.bitrateKbps`
  - [ ] `audio.sampleRate` ∈ {16000, 22050, 44100, 48000}
  - [ ] `audio.extractedAt` (ISO timestamp)
- [ ] Logs include `correlationId`, `tenantId`, `jobId`, `step = "audio-extraction"`
- [ ] Deterministic output with same input and parameters
- [ ] Idempotent for same `{env}/{tenantId}/{jobId}` (safe overwrite)
- [ ] Harness (WP00-05) can invoke handler locally end-to-end
- [ ] Non-zero exit on error when run via harness; manifest status updated appropriately

## Complexity Assessment

- Complexity: Medium
- Estimated Effort: 1 day
- Confidence: Medium

## Dependencies and Prerequisites

- Hard dependencies:
  - MFU‑WP00‑02‑BE (manifest, storage, tenancy)
  - MFU‑WP00‑03‑IAC (FFmpeg runtime, observability wrappers)
- Recommended:
  - MFU‑WP00‑04‑MW (orchestration skeleton)
  - MFU‑WP00‑05‑TG (harness/goldens integration)

**Environment Variables** (extend `.env.example`):

```env
# Audio Extraction (WP01-01)
AUDIO_OUTPUT_CODEC=mp3
AUDIO_BITRATE=192k
AUDIO_SAMPLE_RATE=44100
FFMPEG_PATH=                    # From WP00-03; optional if ffmpeg on PATH
```

## Agent Execution Guide (Step-by-step)

Follow these steps exactly. All paths are repo‑relative.

1) Ensure directories exist

    - Create or verify:
      - `backend/services/audio-extraction/`

2) Implement handler

    - Create `backend/services/audio-extraction/handler.js`:

    ```javascript
    // backend/services/audio-extraction/handler.js
    const { initObservability } = require('../../lib/init-observability');
    const { keyFor, pathFor, writeFileAtKey } = require('../../lib/storage');
    const { loadManifest, saveManifest } = require('../../lib/manifest');
    const { FFmpegRuntime } = require('../../lib/ffmpeg-runtime');
    const { execFileSync } = require('node:child_process');
    const { existsSync, readFileSync } = require('node:fs');
    const { basename } = require('node:path');

    // Error types for better error handling
    class AudioExtractionError extends Error {
      constructor(message, type, details = {}) {
        super(message);
        this.name = 'AudioExtractionError';
        this.type = type;
        this.details = details;
      }
    }

    const ERROR_TYPES = {
      INPUT_NOT_FOUND: 'INPUT_NOT_FOUND',
      INPUT_INVALID: 'INPUT_INVALID',
      FFMPEG_EXECUTION: 'FFMPEG_EXECUTION',
      FFPROBE_FAILED: 'FFPROBE_FAILED',
      MANIFEST_UPDATE: 'MANIFEST_UPDATE',
      STORAGE_ERROR: 'STORAGE_ERROR'
    };

    exports.handler = async (event, context) => {
      const { env, tenantId, jobId, inputKey } = event;
      const correlationId = event.correlationId || context.awsRequestId;

      const { logger, metrics, tracer } = initObservability({
        serviceName: 'AudioExtraction',
        correlationId,
        tenantId,
        jobId,
        step: 'audio-extraction',
      });

      const ffmpeg = new FFmpegRuntime(logger, metrics, tracer);

      try {
        // Validate input exists
        const inputPath = pathFor(inputKey);
        if (!existsSync(inputPath)) {
          throw new AudioExtractionError(
            `Input not found: ${inputKey}`,
            ERROR_TYPES.INPUT_NOT_FOUND,
            { inputKey, inputPath }
          );
        }

        // Validate input file type
        const inputExt = inputPath.toLowerCase().split('.').pop();
        if (!['mp4', 'mov'].includes(inputExt)) {
          throw new AudioExtractionError(
            `Unsupported input format: ${inputExt}. Expected mp4 or mov`,
            ERROR_TYPES.INPUT_INVALID,
            { inputExt, supportedFormats: ['mp4', 'mov'] }
          );
        }

        const outputKey = keyFor(env, tenantId, jobId, 'audio', `${jobId}.mp3`);
        const outputPath = pathFor(outputKey);

        const bitrate = process.env.AUDIO_BITRATE || '192k';
        const sampleRate = String(process.env.AUDIO_SAMPLE_RATE || '44100');

        // Extract audio (mp3)
        try {
          await ffmpeg.executeCommand([
            'ffmpeg', '-y',
            '-i', inputPath,
            '-vn', '-acodec', 'libmp3lame',
            '-b:a', bitrate,
            '-ar', sampleRate,
            outputPath,
          ], 'AudioExtraction');
        } catch (ffmpegErr) {
          throw new AudioExtractionError(
            `FFmpeg execution failed: ${ffmpegErr.message}`,
            ERROR_TYPES.FFMPEG_EXECUTION,
            { 
              inputPath, 
              outputPath, 
              bitrate, 
              sampleRate,
              ffmpegError: ffmpegErr.message 
            }
          );
        }

        // Probe output with error handling
        let probe;
        try {
          const probeJson = execFileSync(
            process.env.FFPROBE_PATH || 'ffprobe',
            ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', outputPath],
            { encoding: 'utf8' }
          );
          probe = JSON.parse(probeJson);
        } catch (probeErr) {
          throw new AudioExtractionError(
            `ffprobe failed: ${probeErr.message}`,
            ERROR_TYPES.FFPROBE_FAILED,
            { outputPath, probeError: probeErr.message }
          );
        }

        const aStream = (probe.streams || []).find(s => s.codec_type === 'audio') || {};
        const durationSec = Number(probe.format?.duration || aStream.duration || 0);
        const bitrateKbps = Math.round(Number(probe.format?.bit_rate || 0) / 1000);
        const sampleRateHz = Number(aStream.sample_rate || sampleRate);
        const codec = (aStream.codec_name || 'mp3').toLowerCase();

        // Update manifest with error handling
        try {
          const manifest = loadManifest(env, tenantId, jobId);
          manifest.audio = manifest.audio || {};
          manifest.audio.key = outputKey;
          manifest.audio.codec = 'mp3'; // Fixed: removed redundant ternary
          manifest.audio.durationSec = durationSec;
          manifest.audio.bitrateKbps = Number.isFinite(bitrateKbps) ? bitrateKbps : undefined;
          manifest.audio.sampleRate = Number(sampleRateHz);
          manifest.audio.extractedAt = new Date().toISOString();
          manifest.updatedAt = new Date().toISOString();
          saveManifest(env, tenantId, jobId, manifest);
        } catch (manifestErr) {
          throw new AudioExtractionError(
            `Manifest update failed: ${manifestErr.message}`,
            ERROR_TYPES.MANIFEST_UPDATE,
            { 
              env, 
              tenantId, 
              jobId, 
              outputKey,
              manifestError: manifestErr.message 
            }
          );
        }

        logger.info('Audio extraction completed', {
          input: basename(inputPath),
          output: outputKey,
          durationSec,
          bitrateKbps,
          sampleRate: sampleRateHz
        });
        metrics.addMetric('AudioExtractionSuccess', 'Count', 1);
        metrics.publishStoredMetrics();

        return { ok: true, outputKey, correlationId };
      } catch (err) {
        // Enhanced error handling with specific error types
        const errorType = err.type || 'UNKNOWN_ERROR';
        const errorDetails = err.details || {};
        
        logger.error('Audio extraction failed', { 
          error: err.message,
          errorType,
          errorDetails,
          inputKey: event.inputKey,
          tenantId,
          jobId
        });
        
        metrics.addMetric('AudioExtractionError', 'Count', 1);
        metrics.addMetric(`AudioExtractionError_${errorType}`, 'Count', 1);
        metrics.publishStoredMetrics();
        
        // Update manifest status on failure if possible
        try {
          const manifest = loadManifest(env, tenantId, jobId);
          manifest.status = 'failed';
          manifest.updatedAt = new Date().toISOString();
          if (!manifest.logs) manifest.logs = [];
          manifest.logs.push({
            type: 'error',
            message: `Audio extraction failed: ${err.message}`,
            errorType,
            createdAt: new Date().toISOString()
          });
          saveManifest(env, tenantId, jobId, manifest);
        } catch (manifestErr) {
          logger.error('Failed to update manifest with error status', { manifestError: manifestErr.message });
        }
        
        throw err;
      }
    };
    ```

3) Wire into local harness (WP00‑05)

    - `tools/harness/run-local-pipeline.js` already calls `backend/services/audio-extraction/handler.js`

4) Validate manifest updates

    - Ensure `manifest.audio.*` fields align with WP00‑02 schema

5) Logging and metrics

    - Confirm logs contain `correlationId`, `tenantId`, `jobId`, `step`
    - Confirm EMF metrics published

6) Idempotency check

    - Re-run with same job; output overwritten safely; manifest updated

## Test Plan

### Local

- Run harness on a short `.mov` and `.mp4`:
  - Expect `audio/{jobId}.mp3` present
  - Verify `durationSec` within ±0.1s vs ffprobe
  - Verify `sampleRate` and `codec=mp3`
- Corrupt input: expect failure and clear error logs
- Repeat runs for same `{jobId}`: no errors; output overwritten

### CI (optional if harness lane exists)

- Add a tiny sample input
- Run extraction via harness; assert manifest fields and file presence

## Success Metrics

- **Correctness**: Duration within ±0.1s; expected sample rate and codec
- **Reliability**: 0 intermittent failures across 20 consecutive runs on same input
- **Observability**: 100% operations logged with required fields; EMF metrics present
- **Determinism**: Same input/config produces identical MP3 bytes or matching probe metrics

## Dependencies

- MFU‑WP00‑02‑BE: Manifest, Tenancy, and Storage Schema  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-02-BE-manifest-tenancy-and-storage-schema.md>
- MFU‑WP00‑03‑IAC: Runtime FFmpeg and Observability  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-03-IAC-runtime-ffmpeg-and-observability.md>
- MFU‑WP00‑05‑TG: Test Harness and Golden Samples  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-05-TG-test-harness-and-golden-samples.md>

## Risks / Open Questions

- FFmpeg availability/version differences (local vs container)
- Bitrate/sample rate selection and consistency across inputs
- Large/long inputs may exceed local disk or time budgets (mitigate with WP00‑03 presets)
- Normalization of source MP4s (tracked via `manifest.sourceVideoKey` if introduced upstream)

## Related MFUs

- MFU‑WP01‑02‑BE: Transcription  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-02-BE-transcription.md>

## Implementation Tracking

- Status: planned
- Assigned To: Team
- Start Date: 2025-09-25
- Target Completion: +1 day
- Actual Completion: TBC
