---
title: "MFU-WP01-02-BE: Transcription"
sidebar_label: "WP01-02: BE Transcription"
date: 2025-10-01
status: planned
version: 1.0
audience: [backend-engineers]
---

## MFU-WP01-02-BE: Transcription

## MFU Identification

- MFU ID: MFU-WP01-02-BE
- Title: Transcription
- Date Created: 2025-10-01
- Date Last Updated:
- Created By: Radha
- Work Package: WP01 — POC Pipeline
- Sprint: Phase 1 – Pipeline

## MFU Definition

**Functional Description**  
Transcribe MP3 with Whisper to produce a JSON transcript (word/segment-level timestamps) and a deterministic `.srt` captions file. Update the job manifest with transcript pointers, language, model, and confidence. Outputs are tenant-scoped and compatible with the canonical storage layout.

**Technical Scope**

- Inputs: `audio/{jobId}.mp3`
- Outputs:
  - `transcripts/transcript.json` with word-level timestamps and segment grouping
  - `transcripts/captions.source.srt` derived deterministically from transcript
- Manifest updates: `manifest.transcript.*` (jsonKey, srtKey, language, model, confidence, transcribedAt)
- Idempotency for same `{env}/{tenantId}/{jobId}`; safe overwrite behavior
- Structured logs with `correlationId`, `tenantId`, `jobId`, `step`
- Deterministic behavior given same input and parameters

**Business Value**  
Enables downstream planning, subtitles, and editing via accurate, tenant-safe transcripts and captions aligned to the canonical storage and manifest schema.

### Target Service Architecture (Phase 1 WP01)

```bash
backend/
  services/
    transcription/
      handler.js               # Lambda/worker handler
      README.md                # Service-specific notes (optional)
      package.json             # If service-local deps are used
backend/
  lib/
    storage.ts                 # From WP00-02
    manifest.ts                # From WP00-02
    init-observability.ts      # From WP00-03
docs/
  mfu-backlog/
    MFU-WP01-02-BE-transcription.md
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
  - `audioKey: string` (e.g., `{env}/{tenantId}/{jobId}/audio/{jobId}.mp3`)
  - `correlationId?: string`
- Behavior:
  - Read audio via `audioKey`
  - Run Whisper with configured `model`/`language`
  - Produce `transcripts/transcript.json` and `transcripts/captions.source.srt`
  - Update `manifest.transcript.*` and persist
  - Emit structured logs and EMF metrics
- Errors:
  - On failure, set manifest `status = "failed"` (if applicable in step) and surface error

### Migration Notes (use existing handler)

- Migrate logic from `podcast-automation/TranscribeWithWhisper/index.js` into `backend/services/transcription/handler.js`.
- Replace direct paths with `backend/lib/storage.ts` (`keyFor`, `pathFor`, `writeFileAtKey`).
- Use `backend/lib/manifest.ts` (`loadManifest`, `saveManifest`) for manifest updates.
- Ensure transcript folder name is `transcripts/` (plural) to match canonical layout.
- Accept event with `env`, `tenantId`, `jobId`, `audioKey`.

## Acceptance Criteria

- [ ] Writes `transcripts/transcript.json` with word-level timestamps and segments
- [ ] Writes `transcripts/captions.source.srt` deterministically derived from JSON
- [ ] Manifest updated:
  - [ ] `transcript.jsonKey`, `transcript.srtKey`
  - [ ] `transcript.language` (BCP‑47 like `en` or `pt-BR`)
  - [ ] `transcript.model` ∈ {tiny, base, small, medium, large}
  - [ ] `transcript.confidence` (0..1)
  - [ ] `transcript.transcribedAt` (ISO timestamp)
- [ ] Logs include `correlationId`, `tenantId`, `jobId`, `step = "transcription"`
- [ ] Deterministic output with same input and parameters
- [ ] Idempotent for same `{env}/{tenantId}/{jobId}` (safe overwrite)

## Complexity Assessment

- Complexity: Medium
- Estimated Effort: 1 day
- Confidence: Medium

## Dependencies and Prerequisites

- Hard dependencies:
  - MFU‑WP01‑01‑BE (audio extraction - provides input MP3)
  - MFU‑WP00‑02‑BE (manifest, storage, tenancy)
  - MFU‑WP00‑03‑IAC (observability wrappers)
- Recommended:
  - MFU‑WP00‑04‑MW (orchestration skeleton)
  - MFU‑WP00‑05‑TG (harness/goldens integration)

**Environment Variables** (extend `.env.example`):
```env
# Transcription (WP01-02)
WHISPER_MODEL=medium
WHISPER_LANGUAGE=en
WHISPER_DEVICE=cpu
TRANSCRIPT_SRT_MAX_LINE_CHARS=42
TRANSCRIPT_SRT_MAX_LINES=2
```

## Agent Execution Guide (Step-by-step)

Follow these steps exactly. All paths are repo‑relative.

1) Ensure directories exist
- Create or verify:
  - `backend/services/transcription/`

2) Implement handler
- Create `backend/services/transcription/handler.js`:

```javascript
// backend/services/transcription/handler.js
const { initObservability } = require('../../lib/init-observability');
const { keyFor, pathFor, writeFileAtKey, readFileAtKey } = require('../../lib/storage');
const { loadManifest, saveManifest } = require('../../lib/manifest');
const { execFileSync } = require('node:child_process');
const { existsSync, writeFileSync } = require('node:fs');
const { basename } = require('node:path');

// Error types for better error handling
class TranscriptionError extends Error {
  constructor(message, type, details = {}) {
    super(message);
    this.name = 'TranscriptionError';
    this.type = type;
    this.details = details;
  }
}

const ERROR_TYPES = {
  INPUT_NOT_FOUND: 'INPUT_NOT_FOUND',
  WHISPER_EXECUTION: 'WHISPER_EXECUTION',
  WHISPER_NOT_AVAILABLE: 'WHISPER_NOT_AVAILABLE',
  TRANSCRIPT_PARSE: 'TRANSCRIPT_PARSE',
  SRT_GENERATION: 'SRT_GENERATION',
  MANIFEST_UPDATE: 'MANIFEST_UPDATE',
  STORAGE_ERROR: 'STORAGE_ERROR'
};

/**
 * Convert Whisper JSON output to SRT format
 * @param {Object} transcriptData - Whisper JSON output with segments
 * @param {Object} options - Formatting options
 * @returns {string} SRT formatted text
 */
function generateSRT(transcriptData, options = {}) {
  const maxLineChars = Number(options.maxLineChars || process.env.TRANSCRIPT_SRT_MAX_LINE_CHARS || 42);
  const maxLines = Number(options.maxLines || process.env.TRANSCRIPT_SRT_MAX_LINES || 2);
  
  if (!transcriptData.segments || transcriptData.segments.length === 0) {
    throw new TranscriptionError(
      'No segments found in transcript data',
      ERROR_TYPES.SRT_GENERATION,
      { segmentCount: 0 }
    );
  }

  const srtLines = [];
  let index = 1;

  for (const segment of transcriptData.segments) {
    const text = (segment.text || '').trim();
    if (!text) continue;

    // Format timestamps: HH:MM:SS,mmm
    const startTime = formatSRTTimestamp(segment.start);
    const endTime = formatSRTTimestamp(segment.end);

    // Word wrap text if needed
    const wrappedLines = wordWrap(text, maxLineChars, maxLines);

    srtLines.push(index);
    srtLines.push(`${startTime} --> ${endTime}`);
    srtLines.push(wrappedLines);
    srtLines.push(''); // Blank line between entries
    index++;
  }

  return srtLines.join('\n');
}

/**
 * Format seconds to SRT timestamp format (HH:MM:SS,mmm)
 */
function formatSRTTimestamp(seconds) {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * Word wrap text to fit line constraints
 */
function wordWrap(text, maxChars, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    
    if (testLine.length <= maxChars) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
      
      if (lines.length >= maxLines) {
        break;
      }
    }
  }
  
  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  return lines.slice(0, maxLines).join('\n');
}

/**
 * Calculate average confidence from Whisper segments
 */
function calculateConfidence(transcriptData) {
  if (!transcriptData.segments || transcriptData.segments.length === 0) {
    return 0;
  }

  let totalConfidence = 0;
  let count = 0;

  for (const segment of transcriptData.segments) {
    // Whisper segments may have 'no_speech_prob' (invert for confidence)
    // or direct confidence scores depending on implementation
    if (typeof segment.confidence === 'number') {
      totalConfidence += segment.confidence;
      count++;
    } else if (typeof segment.no_speech_prob === 'number') {
      totalConfidence += (1 - segment.no_speech_prob);
      count++;
    }
  }

  return count > 0 ? totalConfidence / count : 0;
}

exports.handler = async (event, context) => {
  const { env, tenantId, jobId, audioKey } = event;
  const correlationId = event.correlationId || context.awsRequestId;

  const { logger, metrics, tracer } = initObservability({
    serviceName: 'Transcription',
    correlationId,
    tenantId,
    jobId,
    step: 'transcription',
  });

  try {
    // Validate input exists
    const inputPath = pathFor(audioKey);
    if (!existsSync(inputPath)) {
      throw new TranscriptionError(
        `Audio input not found: ${audioKey}`,
        ERROR_TYPES.INPUT_NOT_FOUND,
        { audioKey, inputPath }
      );
    }

    const model = process.env.WHISPER_MODEL || 'medium';
    const language = process.env.WHISPER_LANGUAGE || 'en';
    const device = process.env.WHISPER_DEVICE || 'cpu';

    logger.info('Starting transcription', {
      input: basename(inputPath),
      model,
      language,
      device
    });

    // Define output keys
    const transcriptJsonKey = keyFor(env, tenantId, jobId, 'transcripts', 'transcript.json');
    const transcriptSrtKey = keyFor(env, tenantId, jobId, 'transcripts', 'captions.source.srt');
    const transcriptJsonPath = pathFor(transcriptJsonKey);
    const transcriptSrtPath = pathFor(transcriptSrtKey);

    // Execute Whisper transcription
    // Note: Assumes whisper CLI is available (whisper or whisper-ctranslate2)
    let transcriptData;
    try {
      const whisperCmd = process.env.WHISPER_CMD || 'whisper';
      const outputDir = require('node:path').dirname(transcriptJsonPath);
      
      // Check if Whisper is available
      try {
        execFileSync(whisperCmd, ['--help'], { encoding: 'utf8', stdio: 'pipe' });
      } catch (checkErr) {
        throw new TranscriptionError(
          `Whisper command not found: ${whisperCmd}. Install with: pip install openai-whisper`,
          ERROR_TYPES.WHISPER_NOT_AVAILABLE,
          { whisperCmd }
        );
      }

      // Run Whisper: output JSON and SRT
      logger.info('Executing Whisper', { whisperCmd, model, language });
      
      const whisperArgs = [
        inputPath,
        '--model', model,
        '--language', language,
        '--output_format', 'json',
        '--output_dir', outputDir,
        '--device', device,
        '--verbose', 'False'
      ];

      const whisperOutput = execFileSync(whisperCmd, whisperArgs, {
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large outputs
        timeout: 600000 // 10 min timeout
      });

      logger.info('Whisper execution completed', { outputLength: whisperOutput.length });

      // Read generated JSON (Whisper writes to <basename>.json)
      const jsonBasename = basename(inputPath, require('node:path').extname(inputPath)) + '.json';
      const whisperJsonPath = require('node:path').join(outputDir, jsonBasename);

      if (!existsSync(whisperJsonPath)) {
        throw new TranscriptionError(
          `Whisper output not found at expected path: ${whisperJsonPath}`,
          ERROR_TYPES.WHISPER_EXECUTION,
          { expectedPath: whisperJsonPath, outputDir }
        );
      }

      transcriptData = JSON.parse(require('node:fs').readFileSync(whisperJsonPath, 'utf8'));

      // Move to canonical location if needed
      if (whisperJsonPath !== transcriptJsonPath) {
        writeFileAtKey(transcriptJsonKey, JSON.stringify(transcriptData, null, 2));
        require('node:fs').unlinkSync(whisperJsonPath); // Clean up temp file
      }

    } catch (whisperErr) {
      throw new TranscriptionError(
        `Whisper execution failed: ${whisperErr.message}`,
        ERROR_TYPES.WHISPER_EXECUTION,
        {
          inputPath,
          model,
          language,
          whisperError: whisperErr.message
        }
      );
    }

    // Validate transcript structure
    if (!transcriptData.segments || !Array.isArray(transcriptData.segments)) {
      throw new TranscriptionError(
        'Invalid transcript structure: missing or invalid segments array',
        ERROR_TYPES.TRANSCRIPT_PARSE,
        { hasSegments: !!transcriptData.segments, segmentsType: typeof transcriptData.segments }
      );
    }

    // Generate SRT from transcript JSON
    let srtContent;
    try {
      srtContent = generateSRT(transcriptData);
      writeFileAtKey(transcriptSrtKey, srtContent);
      logger.info('SRT generation completed', { srtKey: transcriptSrtKey });
    } catch (srtErr) {
      throw new TranscriptionError(
        `SRT generation failed: ${srtErr.message}`,
        ERROR_TYPES.SRT_GENERATION,
        {
          transcriptSrtKey,
          segmentCount: transcriptData.segments?.length || 0,
          srtError: srtErr.message
        }
      );
    }

    // Calculate confidence
    const confidence = calculateConfidence(transcriptData);

    // Update manifest with error handling
    try {
      const manifest = loadManifest(env, tenantId, jobId);
      manifest.transcript = manifest.transcript || {};
      manifest.transcript.jsonKey = transcriptJsonKey;
      manifest.transcript.srtKey = transcriptSrtKey;
      manifest.transcript.language = transcriptData.language || language;
      manifest.transcript.model = model;
      manifest.transcript.confidence = Number.isFinite(confidence) ? confidence : undefined;
      manifest.transcript.transcribedAt = new Date().toISOString();
      manifest.updatedAt = new Date().toISOString();
      saveManifest(env, tenantId, jobId, manifest);
    } catch (manifestErr) {
      throw new TranscriptionError(
        `Manifest update failed: ${manifestErr.message}`,
        ERROR_TYPES.MANIFEST_UPDATE,
        {
          env,
          tenantId,
          jobId,
          transcriptJsonKey,
          transcriptSrtKey,
          manifestError: manifestErr.message
        }
      );
    }

    logger.info('Transcription completed', {
      jsonKey: transcriptJsonKey,
      srtKey: transcriptSrtKey,
      language: transcriptData.language || language,
      model,
      confidence,
      segmentCount: transcriptData.segments.length
    });
    metrics.addMetric('TranscriptionSuccess', 'Count', 1);
    metrics.addMetric('TranscriptSegments', 'Count', transcriptData.segments.length);
    metrics.publishStoredMetrics();

    return { ok: true, transcriptJsonKey, transcriptSrtKey, correlationId };
  } catch (err) {
    // Enhanced error handling with specific error types
    const errorType = err.type || 'UNKNOWN_ERROR';
    const errorDetails = err.details || {};

    logger.error('Transcription failed', {
      error: err.message,
      errorType,
      errorDetails,
      audioKey: event.audioKey,
      tenantId,
      jobId
    });

    metrics.addMetric('TranscriptionError', 'Count', 1);
    metrics.addMetric(`TranscriptionError_${errorType}`, 'Count', 1);
    metrics.publishStoredMetrics();

    // Update manifest status on failure if possible
    try {
      const manifest = loadManifest(env, tenantId, jobId);
      manifest.status = 'failed';
      manifest.updatedAt = new Date().toISOString();
      if (!manifest.logs) manifest.logs = [];
      manifest.logs.push({
        type: 'error',
        message: `Transcription failed: ${err.message}`,
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
- `tools/harness/run-local-pipeline.js` already calls `backend/services/transcription/handler.js`

4) Add Python dependencies (if using Whisper via CLI)
- Create or update `requirements.txt` at repo root:
```txt
openai-whisper>=20230314
```

- Or for faster inference with CTranslate2:
```txt
whisper-ctranslate2>=0.4.0
```

5) Validate manifest updates
- Ensure `manifest.transcript.*` fields align with WP00‑02 schema
- Test SRT formatting with different line length constraints

6) Logging and metrics
- Confirm logs contain `correlationId`, `tenantId`, `jobId`, `step`
- Confirm EMF metrics published (success, errors by type, segment count)

7) Idempotency check
- Re-run with same job; outputs overwritten safely; manifest updated
- Verify deterministic SRT output for same transcript JSON

## Test Plan

### Local
- Run harness on a short MP3:
  - Expect `transcripts/transcript.json` with segments and word-level timestamps
  - Expect `transcripts/captions.source.srt` in valid SRT format
  - Verify first and last word timestamps map to segment boundaries (±300ms)
  - Verify manifest fields: `language`, `model`, `confidence`, `transcribedAt`
- Validate SRT formatting:
  - Line length respects `TRANSCRIPT_SRT_MAX_LINE_CHARS` (default 42)
  - Lines per cue respect `TRANSCRIPT_SRT_MAX_LINES` (default 2)
  - Timestamps formatted as `HH:MM:SS,mmm --> HH:MM:SS,mmm`
- Error path testing:
  - Missing audio input: expect `INPUT_NOT_FOUND` error and clear logs
  - Whisper not installed: expect `WHISPER_NOT_AVAILABLE` with install instructions
  - Corrupt audio: expect `WHISPER_EXECUTION` error with details
- Repeat runs for same `{jobId}`: no errors; outputs overwritten; manifest updated

### CI (optional if harness lane exists)
- Add a tiny sample MP3 (5-10 seconds)
- Run transcription via harness; assert:
  - `transcripts/transcript.json` exists and is valid JSON
  - `transcripts/captions.source.srt` exists and passes SRT validation
  - Manifest fields present and non-empty
  - Logs contain required correlation fields

## Success Metrics

- Accuracy: Timestamp alignment within ±300ms on spot checks
- Reliability: 0 intermittent failures across 20 consecutive runs on same input
- Observability: 100% operations logged with required fields; EMF metrics present
- Determinism: Same input/config produces identical JSON and SRT text or matching preview checksum

## Dependencies

- MFU‑WP01‑01‑BE: Audio Extraction  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-01-BE-audio-extraction.md
- MFU‑WP00‑02‑BE: Manifest, Tenancy, and Storage Schema  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-02-BE-manifest-tenancy-and-storage-schema.md
- MFU‑WP00‑03‑IAC: Runtime FFmpeg and Observability  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-03-IAC-runtime-ffmpeg-and-observability.md
- MFU‑WP00‑05‑TG: Test Harness and Golden Samples  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-05-TG-test-harness-and-golden-samples.md

## Whisper Runtime Architecture

### Invocation Strategy (Phase 1)

**Python CLI Subprocess** (default):
- Handler invokes `whisper` command via `execFileSync`
- Whisper installed via pip: `pip install openai-whisper`
- Alternative faster option: `whisper-ctranslate2` for CTranslate2 backend
- Model downloaded on first run (cached in `~/.cache/whisper/`)
- Output format: JSON with segments (word-level timestamps if available)

**Runtime Environment**:
- Python 3.8+ required (check with `python3 --version`)
- ffmpeg required by Whisper for audio decoding (provided by WP00-03)
- Timeout: 10 minutes (configurable via `maxBuffer` in execFileSync)
- Memory: scales with model size (medium ~5GB, large ~10GB VRAM for GPU)

**Model Management**:
- Models cached locally after first download
- Model sizes: tiny (39M), base (74M), small (244M), medium (769M), large (1550M)
- Phase 1 default: `medium` (best balance of speed/accuracy for English)
- Multi-language: automatic detection or explicit via `WHISPER_LANGUAGE`

**Alternative Approaches** (deferred to future phases):
- Native Python binding via `whisper.load_model()` (requires Python runtime in Lambda)
- Whisper.cpp for CPU-optimized C++ inference
- Hosted API (OpenAI, Deepgram, AssemblyAI) for cost/latency tradeoffs

### Lambda Considerations

For Lambda deployment (WP01 cloud phase):
- Use container image with Python + Whisper pre-installed
- Pre-download model during image build to avoid cold-start downloads
- Configure ephemeral storage ≥10GB for model + audio + outputs
- Timeout ≥600s (10 min) for medium-length audio
- Memory ≥3008MB for CPU inference; ≥5120MB for larger models

## Risks / Open Questions

- Whisper model determinism and CPU/GPU variance
- Language auto-detect vs fixed input; policy choice for Phase 1
- Large inputs runtime and memory; chunking and batching strategies
- SRT formatting rules across locales

## Related MFUs

- MFU‑WP01‑01‑BE: Audio Extraction  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-01-BE-audio-extraction.md

## Implementation Tracking

- Status: planned
- Assigned To: Team
- Start Date: 2025-09-25
- Target Completion: +1 day
- Actual Completion: TBC
