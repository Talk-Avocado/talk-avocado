// backend/services/video-render-engine/handler.js
import { readFileSync, existsSync } from 'node:fs';
import { initObservability } from '../../dist/init-observability.js';
import { keyFor, pathFor } from '../../dist/storage.js';
import { loadManifest, saveManifest } from '../../dist/manifest.js';
import { 
  probe, 
  measureSyncDrift, 
  buildFilterGraph, 
  runFilterGraph,
} from './renderer-logic.js';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

// Initialize Ajv with formats support
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

// Load cut plan schema for validation
const cutPlanSchema = JSON.parse(readFileSync('docs/schemas/cut_plan.schema.json', 'utf-8'));
const validateCutPlan = ajv.compile(cutPlanSchema);

/**
 * Custom error class for video render engine errors
 */
class VideoRenderError extends Error {
  constructor(message, type, details = {}) {
    super(message);
    this.name = 'VideoRenderError';
    this.type = type;
    this.details = details;
  }
}

/**
 * Convert seconds to SS.FF format for FFmpeg
 * Currently unused but kept for potential future use
 */
// function toSSFF(seconds) {
//   return Number(seconds).toFixed(2);
// }

/**
 * Main Lambda handler for video render engine
 */
export const handler = async (event, context) => {
  const { env, tenantId, jobId } = event;
  const correlationId = event.correlationId || context?.awsRequestId || `local-${Date.now()}`;
  
  // Initialize observability
  const { logger, metrics } = initObservability({
    serviceName: 'VideoRenderEngine',
    correlationId, 
    tenantId, 
    jobId, 
    step: 'video-render-engine',
  });

  logger.info('Starting video render engine', { 
    env, 
    tenantId, 
    jobId, 
    correlationId 
  });

  // Load configuration from environment variables
  const renderPreset = process.env.RENDER_PRESET || 'fast';
  const renderCrf = String(process.env.RENDER_CRF ?? '20');
  const renderFps = String(event.targetFps || process.env.RENDER_FPS || '30');
  const threads = String(process.env.RENDER_THREADS || '2');
  const aCodec = process.env.RENDER_AUDIO_CODEC || 'aac';
  const aBitrate = process.env.RENDER_AUDIO_BITRATE || '192k';

  try {
    // Resolve plan key and load cut plan
    const planKey = event.planKey || keyFor(env, tenantId, jobId, 'plan', 'cut_plan.json');
    const planPath = pathFor(planKey);
    
    if (!existsSync(planPath)) {
      throw new VideoRenderError(
        `Cut plan not found: ${planKey}`, 
        'INPUT_NOT_FOUND',
        { planKey, planPath }
      );
    }

    logger.info('Loading cut plan', { planKey });
    const planData = readFileSync(planPath, 'utf-8');
    const plan = JSON.parse(planData);

    // Validate cut plan against schema
    const isValid = validateCutPlan(plan);
    if (!isValid) {
      const errors = validateCutPlan.errors.map(err => 
        `${err.instancePath || 'root'}: ${err.message}`
      ).join(', ');
      
      throw new VideoRenderError(
        `Cut plan validation failed: ${errors}`, 
        'SCHEMA_VALIDATION',
        { errors: validateCutPlan.errors }
      );
    }

    logger.info('Cut plan validated successfully', { 
      cutsCount: plan.cuts?.length || 0,
      schemaVersion: plan.schemaVersion 
    });

    // Load manifest and resolve source video
    const manifest = loadManifest(env, tenantId, jobId);
    const sourceKey = event.sourceVideoKey
      || manifest.sourceVideoKey
      || keyFor(env, tenantId, jobId, 'input', manifest.input?.originalFilename || '');
    
    const sourcePath = pathFor(sourceKey);
    if (!existsSync(sourcePath)) {
      throw new VideoRenderError(
        `Source video not found: ${sourceKey}`, 
        'INPUT_NOT_FOUND',
        { sourceKey, sourcePath }
      );
    }

    logger.info('Source video resolved', { sourceKey });

    // Extract keep segments from cut plan
    const keeps = (plan.cuts || [])
      .filter(cut => cut.type === 'keep')
      .map(cut => ({
        start: Number(cut.start),
        end: Number(cut.end),
      }));

    if (keeps.length === 0) {
      throw new VideoRenderError(
        'No keep segments found in cut plan', 
        'INVALID_PLAN',
        { totalCuts: plan.cuts?.length || 0 }
      );
    }

    logger.info('Processing keep segments', { 
      keepSegments: keeps.length,
      totalDuration: keeps.reduce((sum, seg) => sum + (seg.end - seg.start), 0)
    });

    // Build filtergraph for precise cuts
    const filterGraph = buildFilterGraph(keeps);
    
    // Set up output path
    const outputKey = keyFor(env, tenantId, jobId, 'renders', 'base_cuts.mp4');
    const outputPath = pathFor(outputKey);

    logger.info('Starting FFmpeg processing', { 
      outputKey,
      filterGraphLength: filterGraph.length 
    });

    // Execute FFmpeg with filtergraph
    const encodingOptions = {
      preset: renderPreset,
      crf: renderCrf,
      fps: renderFps,
      threads,
      audioCodec: aCodec,
      audioBitrate: aBitrate
    };

    await runFilterGraph(sourcePath, outputPath, filterGraph, encodingOptions);

    logger.info('FFmpeg processing completed', { outputKey });

    // Probe output video for metadata
    const probeResult = await probe(outputPath);
    const videoStream = (probeResult.streams || []).find(s => s.codec_type === 'video');
    const audioStream = (probeResult.streams || []).find(s => s.codec_type === 'audio');
    
    const durationSec = Number(probeResult.format?.duration || videoStream?.duration || 0);
    const resolution = videoStream ? `${videoStream.width}x${videoStream.height}` : undefined;
    const fps = videoStream?.r_frame_rate || renderFps;

    logger.info('Video metadata extracted', { 
      durationSec, 
      resolution, 
      fps,
      hasVideo: !!videoStream,
      hasAudio: !!audioStream
    });

    // Measure A/V sync drift
    const driftResult = await measureSyncDrift(sourcePath, keeps);
    if (driftResult.maxDriftMs > 50) {
      throw new VideoRenderError(
        `A/V sync drift exceeded threshold: ${driftResult.maxDriftMs}ms (max: 50ms)`, 
        'SYNC_DRIFT_EXCEEDED',
        { maxDriftMs: driftResult.maxDriftMs, measurements: driftResult.measurements }
      );
    }

    logger.info('A/V sync drift check passed', { 
      maxDriftMs: driftResult.maxDriftMs 
    });

    // Update manifest with render information
    const updatedManifest = loadManifest(env, tenantId, jobId);
    updatedManifest.renders = updatedManifest.renders || [];
    
    const renderEntry = {
      key: outputKey,
      type: 'preview',
      codec: 'h264',
      durationSec,
      resolution,
      fps,
      notes: `preset=${renderPreset},crf=${renderCrf}`,
      renderedAt: new Date().toISOString(),
    };

    updatedManifest.renders.push(renderEntry);
    updatedManifest.updatedAt = new Date().toISOString();
    
    // Add render log entry
    updatedManifest.logs = updatedManifest.logs || [];
    updatedManifest.logs.push({
      type: 'info',
      message: `Video render completed: ${outputKey}`,
      details: {
        durationSec,
        resolution,
        fps,
        keepSegments: keeps.length,
        maxDriftMs: driftResult.maxDriftMs
      },
      createdAt: new Date().toISOString()
    });

    saveManifest(env, tenantId, jobId, updatedManifest);

    // Emit success metrics
    metrics.addMetric('RenderSuccess', 'Count', 1);
    metrics.addMetric('RenderDurationSec', 'Milliseconds', durationSec * 1000);
    metrics.addMetric('KeepSegments', 'Count', keeps.length);
    metrics.addMetric('SyncDriftMs', 'Milliseconds', driftResult.maxDriftMs);

    logger.info('Video render completed successfully', { 
      outputKey, 
      durationSec, 
      resolution, 
      fps,
      keepSegments: keeps.length,
      maxDriftMs: driftResult.maxDriftMs
    });

    return { 
      ok: true, 
      outputKey, 
      correlationId,
      durationSec,
      resolution,
      fps,
      keepSegments: keeps.length
    };

  } catch (error) {
    // Handle errors and update manifest
    const errorType = error.type || 'UNKNOWN_ERROR';
    const errorMessage = error.message || 'Unknown error occurred';

    logger.error('Video render failed', { 
      error: errorMessage,
      errorType,
      details: error.details
    });

    // Update manifest with error status
    try {
      const manifest = loadManifest(env, tenantId, jobId);
      manifest.status = 'failed';
      manifest.updatedAt = new Date().toISOString();
      manifest.logs = manifest.logs || [];
      manifest.logs.push({
        type: 'error',
        message: `Video render failed: ${errorMessage}`,
        details: {
          errorType,
          ...error.details
        },
        createdAt: new Date().toISOString()
      });
      saveManifest(env, tenantId, jobId, manifest);
    } catch (manifestError) {
      logger.error('Failed to update manifest with error', { 
        manifestError: manifestError.message 
      });
    }

    // Emit error metrics
    metrics.addMetric('RenderError', 'Count', 1);
    metrics.addMetric(`RenderError_${errorType}`, 'Count', 1);

    // Re-throw the error
    throw error;
  }
};