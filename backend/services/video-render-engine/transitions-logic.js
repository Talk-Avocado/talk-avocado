// backend/services/video-render-engine/transitions-logic.js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Custom error class for transition errors
 */
export class TransitionError extends Error {
  constructor(message, type, details = {}) {
    super(message);
    this.name = 'TransitionError';
    this.type = type;
    this.details = details;
  }
}

/**
 * Error types for transition operations
 */
export const ERROR_TYPES = {
  INVALID_KEEPS: 'INVALID_KEEPS',
  INVALID_DURATION: 'INVALID_DURATION',
  FFMPEG_EXECUTION: 'FFMPEG_EXECUTION'
};

/**
 * Execute command with proper error handling and buffer management
 * @param {string} cmd - Command to execute
 * @param {Array} args - Command arguments
 * @param {Object} opts - Additional options
 * @returns {Promise<Object>} Promise resolving to {stdout, stderr}
 */
async function execAsync(cmd, args, opts = {}) {
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
 * Convert seconds to SS.FF format for FFmpeg
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time string
 */
function toSSFF(seconds) {
  return Number(seconds).toFixed(2);
}

/**
 * Build FFmpeg trim nodes for video and audio streams
 * @param {Array} keeps - Array of {start, end} keep segments
 * @returns {Array} Array of filtergraph trim node strings
 */
export function buildTrimNodes(keeps) {
  if (!Array.isArray(keeps) || keeps.length === 0) {
    throw new TransitionError(
      'Invalid keeps array: must be non-empty array',
      ERROR_TYPES.INVALID_KEEPS,
      { keeps }
    );
  }

  const parts = [];
  for (let i = 0; i < keeps.length; i++) {
    const s = toSSFF(keeps[i].start);
    const e = toSSFF(keeps[i].end);
    parts.push(`[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[v${i}]`);
    parts.push(`[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${i}]`);
  }
  return parts;
}

/**
 * Build crossfade chain for video and audio transitions
 * @param {Array} keeps - Array of {start, end} keep segments
 * @param {Object} opts - Options including durationMs and audioFadeMs
 * @returns {Object} Object with chain array and output labels {chain, vOut, aOut}
 */
export function buildCrossfadeChain(keeps, opts = {}) {
  const n = keeps.length;
  if (n === 0) return { chain: [], vOut: null, aOut: null };
  if (n === 1) return { chain: [], vOut: '[v0]', aOut: '[a0]' };

  const durationMs = Number(opts.durationMs || 300);
  if (!(durationMs > 0 && durationMs <= 5000)) {
    throw new TransitionError(
      `Invalid transition duration: ${durationMs}ms (must be 1-5000ms)`,
      ERROR_TYPES.INVALID_DURATION,
      { durationMs }
    );
  }
  const d = durationMs / 1000;

  const audioFadeMs = Number(opts.audioFadeMs || durationMs);
  const audioD = audioFadeMs / 1000;

  const chain = [];
  let curV = '[v0]';
  let curA = '[a0]';

  // Cumulative offset: total emitted timeline length so far (accounting for overlaps)
  let offset = keeps[0].end - keeps[0].start;

  for (let i = 1; i < n; i++) {
    const nextV = `[v${i}]`;
    const nextA = `[a${i}]`;
    const vOut = `[vx${i}]`;
    const aOut = `[ax${i}]`;

    const fadeOffset = offset - d;

    // Video xfade (label outputs explicitly)
    // Note: xfade is crossfade by default, no transition parameter needed
    chain.push(
      `${curV}${nextV}xfade=duration=${d.toFixed(2)}:offset=${fadeOffset.toFixed(2)} ${vOut}`
    );

    // Audio acrossfade with two inputs and labeled output
    chain.push(`${curA}${nextA}acrossfade=d=${audioD.toFixed(2)} ${aOut}`);

    offset += (keeps[i].end - keeps[i].start) - d;
    curV = vOut;
    curA = aOut;
  }

  return { chain, vOut: curV, aOut: curA };
}

/**
 * Build complete transition filtergraph
 * @param {Array} keeps - Array of {start, end} keep segments
 * @param {Object} opts - Options including durationMs and audioFadeMs
 * @returns {Object} Object with filtergraph string and output labels {filtergraph, vOut, aOut}
 */
export function buildTransitionGraph(keeps, opts = {}) {
  const trim = buildTrimNodes(keeps);
  const { chain, vOut, aOut } = buildCrossfadeChain(keeps, opts);
  const filtergraph = [...trim, ...chain].join(';');
  return { filtergraph, vOut, aOut };
}

/**
 * Execute FFmpeg with transition filtergraph
 * @param {string} sourcePath - Path to source video file
 * @param {string} outputPath - Path to output video file
 * @param {Object} opts - Options including keeps, durationMs, audioFadeMs, fps
 * @returns {Promise<void>} Promise that resolves when FFmpeg completes
 */
export async function runTransitions(sourcePath, outputPath, opts = {}) {
  const codec = 'libx264';
  const preset = process.env.RENDER_PRESET || 'fast';
  const crf = String(process.env.RENDER_CRF ?? '20');
  const fps = String(opts.fps || process.env.RENDER_FPS || '30');
  const aCodec = process.env.RENDER_AUDIO_CODEC || 'aac';
  const aBitrate = process.env.RENDER_AUDIO_BITRATE || '192k';
  const threads = String(process.env.RENDER_THREADS || '2');

  try {
    const { filtergraph, vOut, aOut } = buildTransitionGraph(opts.keeps, {
      durationMs: opts.durationMs,
      audioFadeMs: opts.audioFadeMs
    });

    const args = [
      '-y',
      '-i', sourcePath,
      '-filter_complex', filtergraph,
      '-map', vOut || '[v0]',
      '-map', aOut || '[a0]',
      '-r', fps,
      '-c:v', codec,
      '-preset', preset,
      '-crf', crf,
      '-c:a', aCodec,
      '-b:a', aBitrate,
      '-threads', threads,
      outputPath,
    ];

    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    await execAsync(ffmpegPath, args);
  } catch (err) {
    throw new TransitionError(
      `FFmpeg execution failed: ${err.message}`,
      ERROR_TYPES.FFMPEG_EXECUTION,
      {
        sourcePath,
        outputPath,
        ffmpegError: err.message,
        stderr: err.stderr
      }
    );
  }
}

