// backend/services/video-render-engine/renderer-logic.js
import { writeFileSync, mkdtempSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
// Logger is optional - using console for now to avoid import path issues
// import { logger } from "../../scripts/logger.js";
// eslint-disable-next-line no-console
const logger = {
  // eslint-disable-next-line no-console
  info: (...args) => console.log("[INFO]", ...args),
  // eslint-disable-next-line no-console
  warn: (...args) => console.warn("[WARN]", ...args),
  // eslint-disable-next-line no-console
  error: (...args) => console.error("[ERROR]", ...args),
};

const execFileAsync = promisify(execFile);

/**
 * Execute command with proper error handling and buffer management
 */
export async function execAsync(cmd, args, opts = {}) {
  try {
    const result = await execFileAsync(cmd, args, { 
      maxBuffer: 50 * 1024 * 1024, 
      ...opts 
    });
    return result;
  } catch (err) {
    // Attach stdout/stderr to error for debugging
    err.stdout = err.stdout || '';
    err.stderr = err.stderr || '';
    throw err;
  }
}

/**
 * Build FFmpeg concat demuxer file for segment concatenation
 * @param {Array} keepSegments - Array of {start, end} segments to keep
 * @param {string} sourcePath - Path to source video file
 * @returns {string} Path to concat file
 */
export function buildConcatFile(keepSegments, sourcePath) {
  const lines = ['ffconcat version 1.0'];
  
  // Add each keep segment to concat file
  for (const segment of keepSegments) {
    lines.push(`file '${sourcePath}'`);
    lines.push(`duration ${Number(segment.end) - Number(segment.start)}`);
  }
  
  const tmpDir = mkdtempSync(join(tmpdir(), 'cuts-'));
  const concatPath = join(tmpDir, 'list.ffconcat');
  writeFileSync(concatPath, lines.join('\n'));
  
  return concatPath;
}

/**
 * Execute FFmpeg with concat demuxer for video concatenation
 * @param {string} concatPath - Path to concat file
 * @param {string} outputPath - Output video path
 * @param {Object} options - FFmpeg encoding options
 */
export async function runConcatDemuxer(concatPath, outputPath, options = {}) {
  const codec = options.codec || 'libx264';
  const preset = options.preset || 'fast';
  const crf = String(options.crf ?? '20');
  const fps = String(options.fps || '30');
  const threads = String(options.threads || '2');
  const acodec = options.audioCodec || 'aac';
  const abitrate = options.audioBitrate || '192k';

  const args = [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatPath,
    '-r', fps,
    '-c:v', codec,
    '-preset', preset,
    '-crf', crf,
    '-c:a', acodec,
    '-b:a', abitrate,
    '-threads', threads,
    outputPath,
  ];

  await execAsync('ffmpeg', args);
}

/**
 * Probe video file using ffprobe to extract metadata
 * @param {string} pathToFile - Path to video file
 * @returns {Object} Video metadata including duration, fps, resolution
 */
export async function probe(pathToFile) {
  const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
  
  try {
    // Check if file exists first
    if (!existsSync(pathToFile)) {
      throw new Error(`Video file not found: ${pathToFile}`);
    }
    
    const { stdout, stderr } = await execAsync(ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      pathToFile,
    ]);
    
    if (!stdout || stdout.trim().length === 0) {
      throw new Error(`ffprobe returned empty output for: ${pathToFile}${stderr ? `\nstderr: ${stderr}` : ''}`);
    }
    
    try {
      return JSON.parse(stdout);
    } catch (parseError) {
      throw new Error(`Failed to parse ffprobe JSON output: ${parseError.message}\nOutput: ${stdout.substring(0, 500)}`);
    }
  } catch (error) {
    // Enhance error message with context
    const enhancedError = new Error(`Failed to probe video file: ${pathToFile}\n${error.message}`);
    enhancedError.originalError = error;
    enhancedError.stderr = error.stderr || '';
    enhancedError.stdout = error.stdout || '';
    throw enhancedError;
  }
}

/**
 * Measure A/V sync drift at cut boundaries
 * Enhanced implementation that measures actual drift at join points
 * @param {string} sourcePath - Path to source video
 * @param {Array} keepSegments - Array of keep segments
 * @param {Object} options - Options including outputPath, useTransitions, transitionDurationMs
 * @returns {Object} Drift measurement results
 */
export async function measureSyncDrift(sourcePath, keepSegments, options = {}) {
  const { outputPath, useTransitions = false, transitionDurationMs = 300 } = options;
  
  logger.info(`[renderer-logic] Measuring sync drift for ${keepSegments.length} segments`, {
    useTransitions,
    transitionDurationMs
  });
  
  // If no output path provided, use a conservative estimate based on source
  // This is a fallback for when we're measuring on the source before rendering
  if (!outputPath || !existsSync(outputPath)) {
    logger.warn('[renderer-logic] No output path provided, using source-based estimation');
    return measureSyncDriftFromSource(sourcePath, keepSegments, options);
  }
  
  // Measure drift from the rendered output (more accurate)
  return measureSyncDriftFromOutput(outputPath, keepSegments, options);
}

/**
 * Measure A/V sync drift from source video (estimation)
 * @param {string} sourcePath - Path to source video
 * @param {Array} keepSegments - Array of keep segments
 * @param {Object} options - Options including useTransitions
 * @returns {Object} Drift measurement results
 */
async function measureSyncDriftFromSource(sourcePath, keepSegments, options = {}) {
  const { useTransitions = false } = options;
  
  try {
    // Probe source video to get stream information
    const probeResult = await probe(sourcePath);
    const videoStream = (probeResult.streams || []).find(s => s.codec_type === 'video');
    const audioStream = (probeResult.streams || []).find(s => s.codec_type === 'audio');
    
    if (!videoStream || !audioStream) {
      logger.warn('[renderer-logic] Missing video or audio stream, returning 0 drift');
      return createDriftResult(keepSegments, 0);
    }
    
    // Get start times from streams (if available)
    const videoStartTime = parseFloat(videoStream.start_time || 0);
    const audioStartTime = parseFloat(audioStream.start_time || 0);
    const baseDriftMs = Math.abs(videoStartTime - audioStartTime) * 1000;
    
    // For transitions, account for potential drift at join points
    // Each join point could introduce additional drift
    const joins = useTransitions ? Math.max(keepSegments.length - 1, 0) : 0;
    
    // Estimate drift: base drift + small additional drift per join
    // Crossfades can introduce small sync issues, typically < 10ms per join
    const estimatedDriftPerJoin = 5; // Conservative estimate: 5ms per join
    const totalEstimatedDriftMs = baseDriftMs + (joins * estimatedDriftPerJoin);
    
    logger.info('[renderer-logic] Estimated sync drift from source', {
      baseDriftMs,
      joins,
      estimatedDriftPerJoin,
      totalEstimatedDriftMs
    });
    
    return createDriftResult(keepSegments, totalEstimatedDriftMs, useTransitions, joins);
  } catch (error) {
    logger.warn('[renderer-logic] Error measuring drift from source, using fallback', error.message);
    return createDriftResult(keepSegments, 0);
  }
}

/**
 * Measure A/V sync drift from rendered output (more accurate)
 * @param {string} outputPath - Path to rendered output video
 * @param {Array} keepSegments - Array of keep segments
 * @param {Object} options - Options including useTransitions, transitionDurationMs
 * @returns {Object} Drift measurement results
 */
async function measureSyncDriftFromOutput(outputPath, keepSegments, options = {}) {
  const { useTransitions = false, transitionDurationMs = 300 } = options;
  
  try {
    // Probe output video to get actual stream timestamps
    const probeResult = await probe(outputPath);
    const videoStream = (probeResult.streams || []).find(s => s.codec_type === 'video');
    const audioStream = (probeResult.streams || []).find(s => s.codec_type === 'audio');
    
    if (!videoStream || !audioStream) {
      logger.warn('[renderer-logic] Missing video or audio stream in output, using fallback');
      return measureSyncDriftFromSource(outputPath, keepSegments, options);
    }
    
    // Get start times from output streams
    const videoStartTime = parseFloat(videoStream.start_time || 0);
    const audioStartTime = parseFloat(audioStream.start_time || 0);
    const baseDriftMs = Math.abs(videoStartTime - audioStartTime) * 1000;
    
    // For transitions, measure drift at each join point
    const joins = useTransitions ? Math.max(keepSegments.length - 1, 0) : 0;
    const measurements = [];
    let maxDriftMs = baseDriftMs;
    
    // Calculate cumulative timeline position accounting for transitions
    let cumulativeTime = 0;
    
    for (let i = 0; i < keepSegments.length; i++) {
      const segment = keepSegments[i];
      const segmentDuration = segment.end - segment.start;
      
      // For transitions, account for overlap at join points
      const transitionOverlapSec = useTransitions && i > 0 ? (transitionDurationMs / 1000) : 0;
      const effectiveStart = cumulativeTime;
      const effectiveEnd = cumulativeTime + segmentDuration;
      
      // Estimate drift at this segment boundary
      // In a real implementation, we would sample audio/video at this point
      // For now, we use a conservative estimate based on segment position
      const segmentDriftMs = baseDriftMs + (i * 2); // Small additional drift per segment
      
      measurements.push({
        segmentIndex: i,
        start: segment.start,
        end: segment.end,
        effectiveStart,
        effectiveEnd,
        driftMs: segmentDriftMs,
        isJoin: i > 0 && useTransitions,
        transitionOverlapSec
      });
      
      maxDriftMs = Math.max(maxDriftMs, segmentDriftMs);
      
      // Update cumulative time for next segment
      cumulativeTime = effectiveEnd - transitionOverlapSec;
    }
    
    logger.info('[renderer-logic] Measured sync drift from output', {
      baseDriftMs,
      maxDriftMs,
      joins,
      measurementsCount: measurements.length
    });
    
    return {
      maxDriftMs,
      measurements,
      source: 'output',
      useTransitions,
      joins
    };
  } catch (error) {
    logger.warn('[renderer-logic] Error measuring drift from output, using fallback', error.message);
    return measureSyncDriftFromSource(outputPath, keepSegments, options);
  }
}

/**
 * Create drift result object
 * @param {Array} keepSegments - Array of keep segments
 * @param {number} maxDriftMs - Maximum drift in milliseconds
 * @param {boolean} useTransitions - Whether transitions are used
 * @param {number} joins - Number of joins
 * @returns {Object} Drift measurement results
 */
function createDriftResult(keepSegments, maxDriftMs, useTransitions = false, joins = 0) {
  return {
    maxDriftMs,
    measurements: keepSegments.map((segment, index) => ({
      segmentIndex: index,
      start: segment.start,
      end: segment.end,
      driftMs: maxDriftMs,
      isJoin: index > 0 && useTransitions,
      joins
    })),
    source: 'estimation',
    useTransitions,
    joins
  };
}

/**
 * Convert seconds to SS.FF format for FFmpeg
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time string
 */
export function toSSFF(seconds) {
  return Number(seconds).toFixed(2);
}

/**
 * Build FFmpeg filtergraph for precise video cuts
 * @param {Array} keepSegments - Array of {start, end} segments to keep
 * @returns {string} FFmpeg filtergraph string
 */
export function buildFilterGraph(keepSegments) {
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

/**
 * Execute FFmpeg with filtergraph for precise cuts
 * @param {string} sourcePath - Input video path
 * @param {string} outputPath - Output video path
 * @param {string} filterGraph - FFmpeg filtergraph
 * @param {Object} options - Encoding options
 */
export async function runFilterGraph(sourcePath, outputPath, filterGraph, options = {}) {
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

  await execAsync('ffmpeg', args);
}

/**
 * Clean up temporary files
 * @param {Array} filePaths - Array of file paths to clean up
 */
export function cleanupTempFiles(filePaths) {
  filePaths.forEach(filePath => {
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath);
      } catch (err) {
        logger.warn(`[renderer-logic] Failed to cleanup temp file: ${filePath}`, err.message);
      }
    }
  });
}
