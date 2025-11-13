// backend/services/subtitles-post-edit/handler.js
import { initObservability } from '../../dist/init-observability.js';
import { keyFor, pathFor, writeFileAtKey } from '../../dist/storage.js';
import { loadManifest, saveManifest } from '../../dist/manifest.js';
import { existsSync, readFileSync } from 'node:fs';
import { 
  removeCutSegments, 
  adjustTiming, 
  validateFrameAccuracy, 
  SubtitleError, 
  ERROR_TYPES 
} from './timing-logic.js';
import { generateSRT as generateSRTFormat, generateVTT as generateVTTFormat } from './format-generators.js';

/**
 * Main Lambda handler for subtitles post-edit
 */
export const handler = async (event, context) => {
  const { env, tenantId, jobId } = event;
  const correlationId = event.correlationId || context?.awsRequestId || `local-${Date.now()}`;
  
  // Initialize observability
  const { logger, metrics } = initObservability({
    serviceName: 'SubtitlesPostEdit',
    correlationId,
    tenantId,
    jobId,
    step: 'subtitles-post-edit',
  });

  logger.info('Starting subtitles post-edit', { 
    env, 
    tenantId, 
    jobId, 
    correlationId 
  });

  // Resolve input keys with defaults
  const transcriptKey = event.transcriptKey || keyFor(env, tenantId, jobId, 'transcripts', 'transcript.json');
  const planKey = event.planKey || keyFor(env, tenantId, jobId, 'plan', 'cut_plan.json');
  
  // Determine render key - prefer with_transitions.mp4 if available, fallback to base_cuts.mp4
  let renderKey = event.renderKey;
  if (!renderKey) {
    const transitionsKey = keyFor(env, tenantId, jobId, 'renders', 'with_transitions.mp4');
    const baseCutsKey = keyFor(env, tenantId, jobId, 'renders', 'base_cuts.mp4');
    
    if (existsSync(pathFor(transitionsKey))) {
      renderKey = transitionsKey;
    } else if (existsSync(pathFor(baseCutsKey))) {
      renderKey = baseCutsKey;
    } else {
      renderKey = baseCutsKey; // Will fail validation below
    }
  }
  
  const targetFps = Number(event.targetFps || process.env.SUBTITLES_TARGET_FPS || 30);
  const generateSRT = event.generateSRT !== false && process.env.SUBTITLES_GENERATE_SRT !== 'false';
  const generateVTT = event.generateVTT !== false && process.env.SUBTITLES_GENERATE_VTT !== 'false';

  try {
    // Load and validate inputs
    const transcriptPath = pathFor(transcriptKey);
    const planPath = pathFor(planKey);
    const renderPath = pathFor(renderKey);
    
    if (!existsSync(transcriptPath)) {
      throw new SubtitleError(
        `Transcript not found: ${transcriptKey}`,
        ERROR_TYPES.INVALID_TRANSCRIPT,
        { transcriptKey, transcriptPath }
      );
    }
    
    if (!existsSync(planPath)) {
      throw new SubtitleError(
        `Cut plan not found: ${planKey}`,
        ERROR_TYPES.INVALID_PLAN,
        { planKey, planPath }
      );
    }
    
    if (!existsSync(renderPath)) {
      throw new SubtitleError(
        `Render not found: ${renderKey}`,
        ERROR_TYPES.INVALID_PLAN,
        { renderKey, renderPath }
      );
    }
    
    logger.info('Loading inputs', { transcriptKey, planKey, renderKey });
    
    const transcript = JSON.parse(readFileSync(transcriptPath, 'utf-8'));
    const cutPlan = JSON.parse(readFileSync(planPath, 'utf-8'));
    
    // Process transcript: remove cuts and adjust timing
    logger.info('Processing transcript', { 
      originalSegments: transcript.segments?.length || 0,
      cutsCount: cutPlan.cuts?.length || 0
    });
    
    const filteredTranscript = removeCutSegments(transcript, cutPlan);
    const adjustedTranscript = adjustTiming(filteredTranscript, cutPlan);
    
    logger.info('Timing adjusted', {
      filteredSegments: filteredTranscript.segments.length,
      adjustedSegments: adjustedTranscript.segments.length,
      originalDuration: adjustedTranscript.originalDuration,
      finalDuration: adjustedTranscript.finalDuration
    });
    
    // Validate frame accuracy
    validateFrameAccuracy(adjustedTranscript, targetFps);
    
    // Generate subtitle files
    const srtContent = generateSRT ? generateSRTFormat(adjustedTranscript) : null;
    const vttContent = generateVTT ? generateVTTFormat(adjustedTranscript) : null;
    
    if (!srtContent && !vttContent) {
      throw new SubtitleError(
        'No subtitle formats enabled (both SRT and VTT are disabled)',
        ERROR_TYPES.INVALID_PLAN,
        { generateSRT, generateVTT }
      );
    }
    
    // Write files
    const srtKey = keyFor(env, tenantId, jobId, 'subtitles', 'final.srt');
    const vttKey = keyFor(env, tenantId, jobId, 'subtitles', 'final.vtt');
    
    if (srtContent) {
      writeFileAtKey(srtKey, srtContent);
      logger.info('SRT file written', { srtKey });
    }
    
    if (vttContent) {
      writeFileAtKey(vttKey, vttContent);
      logger.info('VTT file written', { vttKey });
    }
    
    // Calculate word count from segments
    const wordCount = adjustedTranscript.segments.reduce((count, seg) => {
      if (seg.text) {
        return count + seg.text.trim().split(/\s+/).filter(w => w.length > 0).length;
      }
      return count;
    }, 0);
    
    // Update manifest
    // Handle case where manifest may have invalid log types - fix them
    let manifest;
    try {
      manifest = loadManifest(env, tenantId, jobId);
    } catch (err) {
      // If manifest has validation errors (e.g., invalid log types), try to fix them
      if (err.message && err.message.includes('logs') && err.message.includes('type')) {
        logger.warn('Manifest has invalid log types, attempting to fix...', { error: err.message });
        // Read manifest directly and fix log types
        const manifestPath = pathFor(keyFor(env, tenantId, jobId, 'manifest.json'));
        const manifestContent = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        if (manifestContent.logs && Array.isArray(manifestContent.logs)) {
          manifestContent.logs = manifestContent.logs.map(log => {
            // Fix invalid log types - map to valid types
            if (log.type && !['pipeline', 'error', 'debug'].includes(log.type)) {
              if (log.type === 'info' || log.type === 'warning') {
                log.type = 'pipeline';
              } else {
                log.type = 'error';
              }
            }
            return log;
          });
          // Write fixed manifest back
          writeFileAtKey(keyFor(env, tenantId, jobId, 'manifest.json'), JSON.stringify(manifestContent, null, 2));
          manifest = manifestContent;
        } else {
          throw err; // Re-throw if we can't fix it
        }
      } else {
        throw err; // Re-throw if it's a different error
      }
    }
    manifest.subtitles = manifest.subtitles || [];
    
    // Remove existing final subtitles entries (for idempotency)
    manifest.subtitles = manifest.subtitles.filter(s => s.type !== 'final');
    
    if (srtContent) {
      manifest.subtitles.push({
        key: srtKey,
        type: 'final',
        format: 'srt',
        durationSec: adjustedTranscript.finalDuration,
        wordCount: wordCount,
        generatedAt: new Date().toISOString()
      });
    }
    
    if (vttContent) {
      manifest.subtitles.push({
        key: vttKey,
        type: 'final',
        format: 'vtt',
        durationSec: adjustedTranscript.finalDuration,
        wordCount: wordCount,
        generatedAt: new Date().toISOString()
      });
    }
    
    // Add timing metadata to manifest (custom fields for tracking)
    manifest.metadata = manifest.metadata || {};
    manifest.metadata.subtitlesTiming = {
      originalDurationSec: adjustedTranscript.originalDuration,
      finalDurationSec: adjustedTranscript.finalDuration,
      cutsApplied: cutPlan.cuts?.filter(c => c.type === 'cut').length || 0,
      segmentsCount: adjustedTranscript.segments.length,
      targetFps: targetFps
    };
    
    manifest.updatedAt = new Date().toISOString();
    manifest.logs = manifest.logs || [];
    manifest.logs.push({
      type: 'pipeline',
      message: `Subtitles generated: ${adjustedTranscript.segments.length} segments, ${adjustedTranscript.finalDuration.toFixed(2)}s duration (from ${adjustedTranscript.originalDuration.toFixed(2)}s)`,
      createdAt: new Date().toISOString()
    });
    
    saveManifest(env, tenantId, jobId, manifest);
    
    // Emit metrics
    metrics.addMetric('SubtitlesGenerated', 'Count', 1);
    metrics.addMetric('SubtitlesSegments', 'Count', adjustedTranscript.segments.length);
    metrics.addMetric('SubtitlesDurationSec', 'Milliseconds', Math.round(adjustedTranscript.finalDuration * 1000));
    
    logger.info('Subtitles generated successfully', { 
      srtKey: srtContent ? srtKey : null, 
      vttKey: vttContent ? vttKey : null, 
      segments: adjustedTranscript.segments.length,
      wordCount,
      originalDuration: adjustedTranscript.originalDuration,
      finalDuration: adjustedTranscript.finalDuration
    });
    
    return { 
      ok: true, 
      srtKey: srtContent ? srtKey : null, 
      vttKey: vttContent ? vttKey : null, 
      correlationId,
      segments: adjustedTranscript.segments.length,
      wordCount,
      originalDuration: adjustedTranscript.originalDuration,
      finalDuration: adjustedTranscript.finalDuration
    };
  } catch (err) {
    logger.error('Subtitle generation failed', { 
      error: err.message, 
      type: err.type || 'UNKNOWN',
      stack: err.stack
    });
    
    metrics.addMetric('SubtitlesError', 'Count', 1);
    metrics.addMetric(`SubtitlesError_${err.type || 'UNKNOWN'}`, 'Count', 1);
    
    // Update manifest with error status
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
    } catch (manifestErr) {
      logger.error('Failed to update manifest with error', { error: manifestErr.message });
    }
    
    throw err;
  }
};

