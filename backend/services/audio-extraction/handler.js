// backend/services/audio-extraction/handler.js
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { initObservability } from '../../dist/init-observability.js';
import { keyFor, pathFor, writeFileAtKey } from '../../dist/storage.js';
import { loadManifest, saveManifest } from '../../dist/manifest.js';
import { FFmpegRuntime } from '../../dist/ffmpeg-runtime.js';

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

export const handler = async (event, context) => {

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
      ].join(' '), 'AudioExtraction');
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