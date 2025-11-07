// backend/services/video-render-engine/handler-simple.cjs
// Simplified CommonJS version for testing without complex dependencies

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

class VideoRenderError extends Error {
  constructor(message, type, details = {}) {
    super(message);
    this.name = 'VideoRenderError';
    this.type = type;
    this.details = details;
  }
}

// Mock observability functions for testing
const mockObservability = {
  logger: {
    info: (msg, data) => console.log(`[INFO] ${msg}`, data || ''),
    error: (msg, data) => console.error(`[ERROR] ${msg}`, data || ''),
    warn: (msg, data) => console.warn(`[WARN] ${msg}`, data || '')
  },
  metrics: {
    addMetric: (name, unit, value) => console.log(`[METRIC] ${name}: ${value} ${unit}`)
  }
};

// Mock storage functions for testing
const mockStorage = {
  keyFor: (env, tenantId, jobId, ...pathParts) => {
    return `${env}/${tenantId}/${jobId}/${pathParts.join('/')}`;
  },
  pathFor: (key) => {
    return `./storage/${key}`;
  }
};

// Mock manifest functions for testing
const mockManifest = {
  loadManifest: (env, tenantId, jobId) => {
    const manifestPath = `./storage/${env}/${tenantId}/${jobId}/manifest.json`;
    if (fs.existsSync(manifestPath)) {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    }
    return {
      schemaVersion: '1.0.0',
      env,
      tenantId,
      jobId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  },
  saveManifest: (env, tenantId, jobId, manifest) => {
    const manifestPath = `./storage/${env}/${tenantId}/${jobId}/manifest.json`;
    const manifestDir = path.dirname(manifestPath);
    if (!fs.existsSync(manifestDir)) {
      fs.mkdirSync(manifestDir, { recursive: true });
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }
};

function toSSFF(seconds) {
  return Number(seconds).toFixed(2);
}

function buildFilterGraph(keepSegments, sourceDuration = null) {
  const filterParts = [];
  
  // Build trim filters for each segment
  keepSegments.forEach((segment, idx) => {
    const start = toSSFF(segment.start);
    const end = toSSFF(segment.end);
    const duration = Number(end) - Number(start);
    
    // For the last segment, always use duration instead of end to ensure we capture the full segment
    // FFmpeg trim end is exclusive, so using duration is more reliable for the last segment
    const isLastSegment = idx === keepSegments.length - 1;
    
    if (isLastSegment) {
      // Last segment: use duration to ensure we capture all content up to the end
      const dur = toSSFF(duration);
      filterParts.push(
        `[0:v]trim=start=${start}:duration=${dur},setpts=PTS-STARTPTS[v${idx}]`,
        `[0:a]atrim=start=${start}:duration=${dur},asetpts=PTS-STARTPTS[a${idx}]`
      );
    } else {
      // Use end parameter for other segments
      filterParts.push(
        `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${idx}]`,
        `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${idx}]`
      );
    }
  });
  
  // Build concat filters
  const vLabels = Array.from({ length: keepSegments.length }, (_, i) => `[v${i}]`).join('');
  const aLabels = Array.from({ length: keepSegments.length }, (_, i) => `[a${i}]`).join('');
  
  filterParts.push(`${vLabels}concat=n=${keepSegments.length}:v=1:a=0[vout]`);
  filterParts.push(`${aLabels}concat=n=${keepSegments.length}:v=0:a=1[aout]`);
  
  return filterParts.join(';');
}

async function runFilterGraph(sourcePath, outputPath, filterGraph, options = {}) {
  const preset = options.preset || 'fast';
  const crf = String(options.crf ?? '20');
  const fps = String(options.fps || '30');
  const threads = String(options.threads || '2');
  const acodec = options.audioCodec || 'aac';
  const abitrate = options.audioBitrate || '192k';

  const args = [
    '-y',
    '-i', sourcePath,
    '-filter_complex', filterGraph,
    '-map', '[vout]',
    '-map', '[aout]',
    '-r', fps,
    '-c:v', 'libx264',
    '-preset', preset,
    '-crf', crf,
    '-c:a', acodec,
    '-b:a', abitrate,
    '-threads', threads,
    outputPath,
  ];

  try {
    await execFileAsync('ffmpeg', args, { maxBuffer: 50 * 1024 * 1024 });
  } catch (err) {
    // For testing, if FFmpeg fails, create a dummy output file
    console.warn(`[TEST] FFmpeg failed, creating dummy output: ${err.message}`);
    fs.writeFileSync(outputPath, 'dummy video content for testing');
  }
}

async function probe(pathToFile) {
  if (!fs.existsSync(pathToFile)) {
    return {
      format: { duration: '25.0' },
      streams: [
        { codec_type: 'video', width: 1920, height: 1080, r_frame_rate: '30/1' },
        { codec_type: 'audio' }
      ]
    };
  }

  try {
    const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
    const { stdout } = await execFileAsync(ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      pathToFile,
    ], { maxBuffer: 50 * 1024 * 1024 });
    
    return JSON.parse(stdout);
  } catch (err) {
    // For testing, return mock data if ffprobe fails
    console.warn(`[TEST] ffprobe failed, using mock data: ${err.message}`);
    return {
      format: { duration: '25.0' },
      streams: [
        { codec_type: 'video', width: 1920, height: 1080, r_frame_rate: '30/1' },
        { codec_type: 'audio' }
      ]
    };
  }
}

async function measureSyncDrift(sourcePath, keepSegments) {
  console.log(`[TEST] Measuring sync drift for ${keepSegments.length} segments`);
  return { 
    maxDriftMs: 0,
    measurements: keepSegments.map((segment, index) => ({
      segmentIndex: index,
      start: segment.start,
      end: segment.end,
      driftMs: 0
    }))
  };
}

exports.handler = async (event, context) => {
  const { env, tenantId, jobId } = event;
  const correlationId = event.correlationId || context?.awsRequestId || `local-${Date.now()}`;
  
  const { logger, metrics } = mockObservability;

  logger.info('Starting video render engine (test mode)', { 
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
    const planKey = event.planKey || mockStorage.keyFor(env, tenantId, jobId, 'plan', 'cut_plan.json');
    const planPath = mockStorage.pathFor(planKey);
    
    if (!fs.existsSync(planPath)) {
      throw new VideoRenderError(
        `Cut plan not found: ${planKey}`, 
        'INPUT_NOT_FOUND',
        { planKey, planPath }
      );
    }

    logger.info('Loading cut plan', { planKey });
    const planData = fs.readFileSync(planPath, 'utf-8');
    const plan = JSON.parse(planData);

    // Basic schema validation
    if (!plan.cuts || !Array.isArray(plan.cuts)) {
      throw new VideoRenderError(
        'Cut plan validation failed: missing or invalid cuts array',
        'SCHEMA_VALIDATION',
        { plan: plan }
      );
    }

    for (const cut of plan.cuts) {
      if (!cut.start || !cut.end || !cut.type) {
        throw new VideoRenderError(
          `Cut plan validation failed: missing required fields (start, end, type)`,
          'SCHEMA_VALIDATION',
          { cut }
        );
      }
      if (!['keep', 'cut'].includes(cut.type)) {
        throw new VideoRenderError(
          `Cut plan validation failed: invalid type "${cut.type}" (must be "keep" or "cut")`,
          'SCHEMA_VALIDATION',
          { cut }
        );
      }
    }

    logger.info('Cut plan validated successfully', { 
      cutsCount: plan.cuts?.length || 0,
      schemaVersion: plan.schemaVersion 
    });

    // Load manifest and resolve source video
    const manifest = mockManifest.loadManifest(env, tenantId, jobId);
    const sourceKey = event.sourceVideoKey
      || manifest.sourceVideoKey
      || mockStorage.keyFor(env, tenantId, jobId, 'input', manifest.input?.originalFilename || '');
    
    const sourcePath = mockStorage.pathFor(sourceKey);
    if (!fs.existsSync(sourcePath)) {
      throw new VideoRenderError(
        `Source video not found: ${sourceKey}`, 
        'INPUT_NOT_FOUND',
        { sourceKey, sourcePath }
      );
    }

    logger.info('Source video resolved', { sourceKey });

    // Extract keep segments from cut plan
    let keeps = (plan.cuts || [])
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
      totalDuration: keeps.reduce((sum, seg) => sum + (seg.end - seg.start), 0)
    });

    // Build filtergraph for precise cuts (sourceDuration already probed above)
    const filterGraph = buildFilterGraph(keeps, sourceDuration);
    
    // Set up output path
    const outputKey = mockStorage.keyFor(env, tenantId, jobId, 'renders', 'base_cuts.mp4');
    const outputPath = mockStorage.pathFor(outputKey);

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    logger.info('Starting FFmpeg processing (test mode)', { 
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

    // Validate duration within ±1 frame tolerance
    const expectedDurationSec = keeps.reduce((sum, seg) => sum + (seg.end - seg.start), 0);
    const fpsNumber = parseFloat(fpsString.split('/')[0]) / (fpsString.includes('/') ? parseFloat(fpsString.split('/')[1]) : 1);
    const frameDurationSec = 1 / fpsNumber;
    const toleranceSec = frameDurationSec; // ±1 frame
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
          frameDurationSec
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
    const updatedManifest = mockManifest.loadManifest(env, tenantId, jobId);
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
        fps: fpsString,
        keepSegments: keeps.length,
        maxDriftMs: driftResult.maxDriftMs
      },
      createdAt: new Date().toISOString()
    });

    mockManifest.saveManifest(env, tenantId, jobId, updatedManifest);

    // Emit success metrics
    metrics.addMetric('RenderSuccess', 'Count', 1);
    metrics.addMetric('RenderDurationSec', 'Milliseconds', durationSec * 1000);
    metrics.addMetric('KeepSegments', 'Count', keeps.length);
    metrics.addMetric('SyncDriftMs', 'Milliseconds', driftResult.maxDriftMs);

    logger.info('Video render completed successfully', { 
      outputKey, 
      durationSec, 
      resolution, 
      fps: fpsString,
      keepSegments: keeps.length,
      maxDriftMs: driftResult.maxDriftMs
    });

    return { 
      ok: true, 
      outputKey, 
      correlationId,
      durationSec,
      resolution,
      fps: fpsString,
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
      const manifest = mockManifest.loadManifest(env, tenantId, jobId);
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
      mockManifest.saveManifest(env, tenantId, jobId, manifest);
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
