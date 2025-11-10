// backend/services/video-render-engine/handler.js
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { initObservability } from '../../dist/init-observability.js';
import { keyFor, pathFor } from '../../dist/storage.js';
import { loadManifest, saveManifest } from '../../dist/manifest.js';
import { 
  probe, 
  measureSyncDrift, 
  buildFilterGraph, 
  runFilterGraph,
} from './renderer-logic.js';
import {
  runTransitions,
  TransitionError,
} from './transitions-logic.js';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

// Initialize Ajv with formats support
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

// Load cut plan schema for validation
const cutPlanSchemaPath = resolve('docs/schemas/cut_plan.schema.json');
const cutPlanSchema = JSON.parse(readFileSync(cutPlanSchemaPath, 'utf-8'));
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

  // Check if transitions are enabled
  const transitionsEnabled = event.transitions === true || process.env.TRANSITIONS_ENABLED === 'true';
  const transitionsDurationMs = Number(process.env.TRANSITIONS_DURATION_MS || 300);
  const transitionsAudioFadeMs = Number(process.env.TRANSITIONS_AUDIO_FADE_MS || transitionsDurationMs);

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

    // Get source video duration for filtergraph building
    let sourceDuration = null;
    try {
      const probeResult = await probe(sourcePath);
      sourceDuration = Number(probeResult.format?.duration || 0);
      if (sourceDuration > 0) {
        logger.info('Source video duration', { sourceDurationSec: sourceDuration });
      }
    } catch (err) {
      logger.warn('Could not probe source video duration', { error: err.message });
    }

    logger.info('Processing keep segments', { 
      keepSegments: keeps.length,
      totalDuration: keeps.reduce((sum, seg) => sum + (seg.end - seg.start), 0),
      transitionsEnabled
    });

    // Determine if we should use transitions
    const useTransitions = transitionsEnabled && keeps.length >= 2;
    
    // Set up output path
    const outputKey = useTransitions
      ? keyFor(env, tenantId, jobId, 'renders', 'with_transitions.mp4')
      : keyFor(env, tenantId, jobId, 'renders', 'base_cuts.mp4');
    const outputPath = pathFor(outputKey);

    // Ensure output directory exists
    const outputDir = dirname(outputPath);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    if (useTransitions) {
      logger.info('Starting transitions processing', { 
        outputKey,
        durationMs: transitionsDurationMs,
        audioFadeMs: transitionsAudioFadeMs,
        joins: keeps.length - 1
      });

      // Execute transitions
      await runTransitions(sourcePath, outputPath, {
        keeps,
        durationMs: transitionsDurationMs,
        audioFadeMs: transitionsAudioFadeMs,
        fps: renderFps
      });

      logger.info('Transitions processing completed', { outputKey });
    } else {
      logger.info('Starting base cuts processing', { 
        outputKey,
        useTransitions: false,
        reason: transitionsEnabled ? 'less than 2 keep segments' : 'transitions disabled'
      });

      // Build filtergraph for precise cuts
      const filterGraph = buildFilterGraph(keeps);

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

      logger.info('Base cuts processing completed', { outputKey });
    }

    // Probe output video for metadata
    const probeResult = await probe(outputPath);
    const videoStream = (probeResult.streams || []).find(s => s.codec_type === 'video');
    const audioStream = (probeResult.streams || []).find(s => s.codec_type === 'audio');
    
    const durationSec = Number(probeResult.format?.duration || videoStream?.duration || 0);
    const resolution = videoStream ? `${videoStream.width}x${videoStream.height}` : undefined;
    // Parse fps from format like "30/1" or use renderFps
    const rawFps = videoStream?.r_frame_rate || renderFps;
    const fpsString = rawFps.includes('/') ? rawFps : `${rawFps}/1`;

    logger.info('Video metadata extracted', { 
      durationSec, 
      resolution, 
      fps: fpsString,
      hasVideo: !!videoStream,
      hasAudio: !!audioStream
    });

    // Validate duration within tolerance
    // For transitions: expected = sum(keeps) - joins * transitionDurationSec
    // For base cuts: expected = sum(keeps)
    const joins = useTransitions ? Math.max(keeps.length - 1, 0) : 0;
    const transitionOverlapSec = useTransitions ? (transitionsDurationMs / 1000) * joins : 0;
    const expectedDurationSec = keeps.reduce((sum, seg) => sum + (seg.end - seg.start), 0) - transitionOverlapSec;
    
    const fpsNumber = parseFloat(fpsString.split('/')[0]) / (fpsString.includes('/') ? parseFloat(fpsString.split('/')[1]) : 1);
    const frameDurationSec = 1 / fpsNumber;
    
    // Tolerance: ±1 frame for base cuts, ±2% or ±5 seconds (whichever is larger) for transitions
    // Transitions can introduce timing differences due to crossfade processing
    let toleranceSec;
    if (useTransitions) {
      // For transitions, use a more lenient tolerance: 2% of expected duration or 5 seconds, whichever is larger
      // But at least 1 frame
      const percentTolerance = expectedDurationSec * 0.02; // 2%
      const fixedTolerance = 5.0; // 5 seconds
      toleranceSec = Math.max(percentTolerance, fixedTolerance, frameDurationSec);
    } else {
      toleranceSec = frameDurationSec; // ±1 frame for base cuts
    }
    
    const durationDiffSec = Math.abs(durationSec - expectedDurationSec);
    
    if (durationDiffSec > toleranceSec) {
      throw new VideoRenderError(
        `Output duration mismatch: expected ${expectedDurationSec.toFixed(3)}s, got ${durationSec.toFixed(3)}s (diff: ${durationDiffSec.toFixed(3)}s, tolerance: ±${toleranceSec.toFixed(3)}s)`,
        'DURATION_MISMATCH',
        { 
          expectedDurationSec, 
          actualDurationSec: durationSec, 
          durationDiffSec, 
          toleranceSec,
          fps: fpsNumber,
          frameDurationSec,
          useTransitions,
          joins,
          transitionOverlapSec
        }
      );
    }

    logger.info('Duration validation passed', { 
      expectedDurationSec, 
      actualDurationSec: durationSec, 
      durationDiffSec,
      toleranceSec,
      fps: fpsNumber
    });

    // Measure A/V sync drift (enhanced for transitions)
    const driftResult = await measureSyncDrift(sourcePath, keeps, {
      outputPath,
      useTransitions,
      transitionDurationMs: useTransitions ? transitionsDurationMs : 0
    });
    if (driftResult.maxDriftMs > 50) {
      throw new VideoRenderError(
        `A/V sync drift exceeded threshold: ${driftResult.maxDriftMs}ms (max: 50ms)`, 
        'SYNC_DRIFT_EXCEEDED',
        { 
          maxDriftMs: driftResult.maxDriftMs, 
          measurements: driftResult.measurements,
          useTransitions: driftResult.useTransitions,
          joins: driftResult.joins
        }
      );
    }

    logger.info('A/V sync drift check passed', { 
      maxDriftMs: driftResult.maxDriftMs,
      useTransitions: driftResult.useTransitions,
      joins: driftResult.joins,
      source: driftResult.source
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
      fps: fpsString,
      notes: `preset=${renderPreset},crf=${renderCrf}`,
      renderedAt: new Date().toISOString(),
    };

    // Add transition metadata if transitions were used
    if (useTransitions) {
      renderEntry.transition = {
        type: 'crossfade',
        durationMs: transitionsDurationMs,
        audioFadeMs: transitionsAudioFadeMs
      };
    }

    updatedManifest.renders.push(renderEntry);
    updatedManifest.updatedAt = new Date().toISOString();
    
    // Add render log entry
    updatedManifest.logs = updatedManifest.logs || [];
    updatedManifest.logs.push({
      key: outputKey,
      type: 'pipeline',
      createdAt: new Date().toISOString(),
      summary: useTransitions 
        ? `Transitions applied: ${joins} joins, ${transitionsDurationMs}ms crossfade`
        : 'Base cuts rendered'
    });

    saveManifest(env, tenantId, jobId, updatedManifest);

    // Emit success metrics
    if (useTransitions) {
      metrics.addMetric('RenderTransitionsSuccess', 'Count', 1);
      metrics.addMetric('TransitionsJoins', 'Count', joins);
      metrics.addMetric('TransitionsDurationDeltaMs', 'Milliseconds', Math.abs(durationDiffSec * 1000));
    } else {
      metrics.addMetric('RenderSuccess', 'Count', 1);
    }
    metrics.addMetric('RenderDurationSec', 'Milliseconds', durationSec * 1000);
    metrics.addMetric('KeepSegments', 'Count', keeps.length);
    metrics.addMetric('SyncDriftMs', 'Milliseconds', driftResult.maxDriftMs);

    logger.info('Video render completed successfully', { 
      outputKey, 
      durationSec, 
      resolution, 
      fps: fpsString,
      keepSegments: keeps.length,
      maxDriftMs: driftResult.maxDriftMs,
      useTransitions,
      joins: useTransitions ? joins : 0
    });

    return { 
      ok: true, 
      outputKey, 
      correlationId,
      durationSec,
      resolution,
      fps: fpsString,
      keepSegments: keeps.length,
      useTransitions,
      joins: useTransitions ? joins : 0
    };

  } catch (error) {
    // Handle errors and update manifest
    // Convert TransitionError to VideoRenderError for consistent handling
    let renderError = error;
    if (error instanceof TransitionError) {
      renderError = new VideoRenderError(
        error.message,
        error.type || 'TRANSITION_ERROR',
        error.details
      );
    }
    const errorType = renderError.type || 'UNKNOWN_ERROR';
    const errorMessage = renderError.message || 'Unknown error occurred';

    logger.error('Video render failed', { 
      error: errorMessage,
      errorType,
      details: renderError.details
    });

    // Update manifest with error status
    try {
      const manifest = loadManifest(env, tenantId, jobId);
      manifest.status = 'failed';
      manifest.updatedAt = new Date().toISOString();
      manifest.logs = manifest.logs || [];
      manifest.logs.push({
        key: `error-${Date.now()}`,
        type: 'error',
        message: errorMessage,
        errorType,
        details: renderError.details || {},
        createdAt: new Date().toISOString()
      });
      saveManifest(env, tenantId, jobId, manifest);
    } catch (manifestError) {
      logger.error('Failed to update manifest with error', { 
        manifestError: manifestError.message 
      });
    }

    // Emit error metrics
    if (transitionsEnabled) {
      metrics.addMetric('RenderTransitionsError', 'Count', 1);
      metrics.addMetric(`RenderTransitionsError_${errorType}`, 'Count', 1);
    } else {
      metrics.addMetric('RenderError', 'Count', 1);
      metrics.addMetric(`RenderError_${errorType}`, 'Count', 1);
    }

    // Re-throw the error
    throw renderError;
  }
};