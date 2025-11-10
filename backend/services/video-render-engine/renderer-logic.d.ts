/**
 * Execute command with proper error handling and buffer management
 */
export function execAsync(cmd: any, args: any, opts?: {}): Promise<{
    stdout: string;
    stderr: string;
}>;
/**
 * Build FFmpeg concat demuxer file for segment concatenation
 * @param {Array} keepSegments - Array of {start, end} segments to keep
 * @param {string} sourcePath - Path to source video file
 * @returns {string} Path to concat file
 */
export function buildConcatFile(keepSegments: any[], sourcePath: string): string;
/**
 * Execute FFmpeg with concat demuxer for video concatenation
 * @param {string} concatPath - Path to concat file
 * @param {string} outputPath - Output video path
 * @param {Object} options - FFmpeg encoding options
 */
export function runConcatDemuxer(concatPath: string, outputPath: string, options?: Object): Promise<void>;
/**
 * Probe video file using ffprobe to extract metadata
 * @param {string} pathToFile - Path to video file
 * @returns {Object} Video metadata including duration, fps, resolution
 */
export function probe(pathToFile: string): Object;
/**
 * Measure A/V sync drift at cut boundaries
 * This is a placeholder implementation - in production this would
 * sample audio around each cut boundary and measure drift
 * @param {string} sourcePath - Path to source video
 * @param {Array} keepSegments - Array of keep segments
 * @returns {Object} Drift measurement results
 */
export function measureSyncDrift(sourcePath: string, keepSegments: any[], options?: {
  outputPath?: string;
  useTransitions?: boolean;
  transitionDurationMs?: number;
}): Promise<{
  maxDriftMs: number;
  measurements: Array<{
    segmentIndex: number;
    start: number;
    end: number;
    driftMs: number;
    isJoin?: boolean;
    transitionOverlapSec?: number;
    effectiveStart?: number;
    effectiveEnd?: number;
  }>;
  source?: string;
  useTransitions?: boolean;
  joins?: number;
}>;
/**
 * Convert seconds to SS.FF format for FFmpeg
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time string
 */
export function toSSFF(seconds: number): string;
/**
 * Build FFmpeg filtergraph for precise video cuts
 * @param {Array} keepSegments - Array of {start, end} segments to keep
 * @returns {string} FFmpeg filtergraph string
 */
export function buildFilterGraph(keepSegments: any[]): string;
/**
 * Execute FFmpeg with filtergraph for precise cuts
 * @param {string} sourcePath - Input video path
 * @param {string} outputPath - Output video path
 * @param {string} filterGraph - FFmpeg filtergraph
 * @param {Object} options - Encoding options
 */
export function runFilterGraph(sourcePath: string, outputPath: string, filterGraph: string, options?: Object): Promise<void>;
/**
 * Clean up temporary files
 * @param {Array} filePaths - Array of file paths to clean up
 */
export function cleanupTempFiles(filePaths: any[]): void;
