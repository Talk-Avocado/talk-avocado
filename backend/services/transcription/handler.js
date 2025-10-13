// backend/services/transcription/handler.js
import { initObservability } from '../../dist/init-observability.js';
import { keyFor, pathFor, writeFileAtKey, readFileAtKey } from '../../dist/storage.js';
import { loadManifest, saveManifest } from '../../dist/manifest.js';
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, extname } from 'node:path';

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

const handler = async (event, context) => {
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
      const outputDir = dirname(transcriptJsonPath);
      
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
      const jsonBasename = basename(inputPath, extname(inputPath)) + '.json';
      const whisperJsonPath = join(outputDir, jsonBasename);

      if (!existsSync(whisperJsonPath)) {
        throw new TranscriptionError(
          `Whisper output not found at expected path: ${whisperJsonPath}`,
          ERROR_TYPES.WHISPER_EXECUTION,
          { expectedPath: whisperJsonPath, outputDir }
        );
      }

      transcriptData = JSON.parse(readFileSync(whisperJsonPath, 'utf8'));

      // Move to canonical location if needed
      if (whisperJsonPath !== transcriptJsonPath) {
        writeFileAtKey(transcriptJsonKey, JSON.stringify(transcriptData, null, 2));
        unlinkSync(whisperJsonPath); // Clean up temp file
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

export { handler };