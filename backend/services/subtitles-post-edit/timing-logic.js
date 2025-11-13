// backend/services/subtitles-post-edit/timing-logic.js

/**
 * Custom error class for subtitle processing errors
 */
class SubtitleError extends Error {
  constructor(message, type, details = {}) {
    super(message);
    this.name = 'SubtitleError';
    this.type = type;
    this.details = details;
  }
}

const ERROR_TYPES = {
  INVALID_TRANSCRIPT: 'INVALID_TRANSCRIPT',
  INVALID_PLAN: 'INVALID_PLAN',
  TIMING_MISMATCH: 'TIMING_MISMATCH',
  FRAME_ACCURACY: 'FRAME_ACCURACY'
};

/**
 * Parse timestamp string to seconds (number)
 * Supports formats: "SS.SS", "mm:ss", "mm:ss.sss", "hh:mm:ss", "hh:mm:ss.sss"
 * @param {string|number} timestamp - Timestamp string or number
 * @returns {number} Seconds as number
 */
function parseTimestamp(timestamp) {
  if (typeof timestamp === 'number') {
    return timestamp;
  }
  
  if (typeof timestamp !== 'string') {
    throw new SubtitleError(
      `Invalid timestamp type: ${typeof timestamp}`,
      ERROR_TYPES.INVALID_PLAN,
      { timestamp }
    );
  }

  // Try parsing as simple number first (e.g., "5.5")
  const asNumber = parseFloat(timestamp);
  if (!isNaN(asNumber) && timestamp.trim() === String(asNumber)) {
    return asNumber;
  }

  // Parse time format: hh:mm:ss or mm:ss or hh:mm:ss.sss
  const parts = timestamp.split(':');
  if (parts.length === 1) {
    // Just seconds, possibly with decimals
    return parseFloat(parts[0]) || 0;
  } else if (parts.length === 2) {
    // mm:ss format
    const minutes = parseFloat(parts[0]) || 0;
    const seconds = parseFloat(parts[1]) || 0;
    return minutes * 60 + seconds;
  } else if (parts.length === 3) {
    // hh:mm:ss format
    const hours = parseFloat(parts[0]) || 0;
    const minutes = parseFloat(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  }

  throw new SubtitleError(
    `Unable to parse timestamp: ${timestamp}`,
    ERROR_TYPES.INVALID_PLAN,
    { timestamp }
  );
}

/**
 * Round time to nearest frame boundary
 * @param {number} seconds - Time in seconds
 * @param {number} fps - Frames per second
 * @returns {number} Frame-aligned time in seconds
 */
function toFrameTime(seconds, fps) {
  return Math.round(seconds * fps) / fps;
}

/**
 * Remove transcript segments that overlap with cut regions
 * Keep segments that have any overlap with keep regions (they will be trimmed in adjustTiming)
 * @param {Object} transcript - Transcript object with segments array
 * @param {Object} cutPlan - Cut plan object with cuts array
 * @returns {Object} Filtered transcript with segments that don't overlap with any keep segment removed
 */
function removeCutSegments(transcript, cutPlan) {
  if (!transcript || !transcript.segments || !Array.isArray(transcript.segments)) {
    throw new SubtitleError(
      'Invalid transcript: missing segments array',
      ERROR_TYPES.INVALID_TRANSCRIPT,
      { hasSegments: !!transcript?.segments }
    );
  }
  
  if (!cutPlan || !cutPlan.cuts || !Array.isArray(cutPlan.cuts)) {
    throw new SubtitleError(
      'Invalid cut plan: missing cuts array',
      ERROR_TYPES.INVALID_PLAN,
      { hasCuts: !!cutPlan?.cuts }
    );
  }

  // Get all keep regions (type === 'keep')
  const keepSegments = cutPlan.cuts
    .filter(c => c.type === 'keep')
    .map(c => ({
      start: parseTimestamp(c.start),
      end: parseTimestamp(c.end)
    }));
  
  // Keep segments that overlap with ANY keep region
  // Segments that partially overlap will be trimmed in adjustTiming
  const filteredSegments = transcript.segments.filter(segment => {
    const segmentStart = Number(segment.start);
    const segmentEnd = Number(segment.end);
    
    // Check if this segment overlaps with any keep region
    return keepSegments.some(keep => {
      // Overlap check: segments overlap if start < end and end > start
      return segmentStart < keep.end && segmentEnd > keep.start;
    });
  });
  
  return {
    ...transcript,
    segments: filteredSegments
  };
}

/**
 * Adjust transcript segment timestamps to account for removed cut regions
 * Maps original timeline to final timeline by calculating offsets from kept segments
 * @param {Object} transcript - Transcript object with segments array (already filtered)
 * @param {Object} cutPlan - Cut plan object with cuts array
 * @returns {Object} Adjusted transcript with new timestamps
 */
function adjustTiming(transcript, cutPlan) {
  if (!transcript || !transcript.segments || !Array.isArray(transcript.segments)) {
    throw new SubtitleError(
      'Invalid transcript: missing segments array',
      ERROR_TYPES.INVALID_TRANSCRIPT
    );
  }
  
  if (!cutPlan || !cutPlan.cuts || !Array.isArray(cutPlan.cuts)) {
    throw new SubtitleError(
      'Invalid cut plan: missing cuts array',
      ERROR_TYPES.INVALID_PLAN
    );
  }

  // Get all keep segments, sorted by start time
  const keepSegments = cutPlan.cuts
    .filter(c => c.type === 'keep')
    .map(c => ({
      start: parseTimestamp(c.start),
      end: parseTimestamp(c.end)
    }))
    .sort((a, b) => a.start - b.start);

  if (keepSegments.length === 0) {
    // No keep segments means entire video was cut
    return {
      ...transcript,
      segments: [],
      originalDuration: transcript.segments.length > 0 
        ? Math.max(...transcript.segments.map(s => Number(s.end)))
        : 0,
      finalDuration: 0
    };
  }

  const adjustedSegments = [];
  let finalDuration = 0;

  // Calculate cumulative duration of all keep segments
  for (const keep of keepSegments) {
    finalDuration += (keep.end - keep.start);
  }

  // Process each transcript segment
  for (const segment of transcript.segments) {
    const originalStart = Number(segment.start);
    const originalEnd = Number(segment.end);
    
    // Find all keep segments that this transcript segment overlaps with
    const overlappingKeeps = keepSegments
      .map((keep, index) => ({ keep, index }))
      .filter(({ keep }) => originalStart < keep.end && originalEnd > keep.start);

    if (overlappingKeeps.length === 0) {
      // Segment doesn't overlap with any keep segment (should have been filtered, but handle gracefully)
      continue;
    }

    // If segment spans multiple keep segments, create one subtitle entry per overlapping keep segment
    const targetFps = 30; // Will be configurable via parameter in handler

    for (const { keep, index: keepIndex } of overlappingKeeps) {
      // Calculate cumulative offset up to this keep segment
      let cumulativeOffset = 0;
      for (let j = 0; j < keepIndex; j++) {
        cumulativeOffset += (keepSegments[j].end - keepSegments[j].start);
      }

      // Clamp segment start/end to keep segment boundaries
      const clampedStart = Math.max(originalStart, keep.start);
      const clampedEnd = Math.min(originalEnd, keep.end);

      // Skip if clamped segment is too short (less than 1 frame)
      if (clampedEnd <= clampedStart) {
        continue;
      }

      // Adjust timestamps: map from original timeline to final timeline
      let adjustedStart = clampedStart - keep.start + cumulativeOffset;
      let adjustedEnd = clampedEnd - keep.start + cumulativeOffset;

      // Apply frame accuracy rounding
      adjustedStart = toFrameTime(adjustedStart, targetFps);
      adjustedEnd = toFrameTime(adjustedEnd, targetFps);

      // Ensure end is after start
      if (adjustedEnd <= adjustedStart) {
        adjustedEnd = adjustedStart + (1 / targetFps); // Minimum 1 frame duration
      }

      adjustedSegments.push({
        ...segment,
        start: adjustedStart,
        end: adjustedEnd,
        originalStart: clampedStart,
        originalEnd: clampedEnd
      });
    }
  }

  // Calculate original duration from last segment
  const originalDuration = transcript.segments.length > 0
    ? Math.max(...transcript.segments.map(s => Number(s.end)))
    : 0;

  return {
    ...transcript,
    segments: adjustedSegments,
    originalDuration,
    finalDuration
  };
}

/**
 * Validate that all segment timestamps are frame-accurate
 * @param {Object} transcript - Transcript object with segments array
 * @param {number} targetFps - Target frames per second (default 30)
 * @throws {SubtitleError} If frame accuracy tolerance is exceeded
 */
function validateFrameAccuracy(transcript, targetFps = 30) {
  if (!transcript || !transcript.segments || !Array.isArray(transcript.segments)) {
    throw new SubtitleError(
      'Invalid transcript: missing segments array',
      ERROR_TYPES.INVALID_TRANSCRIPT
    );
  }

  const frameTolerance = 1 / targetFps; // ±1 frame in seconds
  
  for (const segment of transcript.segments) {
    const start = Number(segment.start);
    const end = Number(segment.end);
    
    // Check if timestamps are frame-aligned
    const startRounded = toFrameTime(start, targetFps);
    const endRounded = toFrameTime(end, targetFps);
    
    const startError = Math.abs(start - startRounded);
    const endError = Math.abs(end - endRounded);
    
    if (startError > frameTolerance || endError > frameTolerance) {
      throw new SubtitleError(
        `Frame accuracy exceeded: start error=${startError.toFixed(6)}s, end error=${endError.toFixed(6)}s (tolerance=${frameTolerance.toFixed(6)}s)`,
        ERROR_TYPES.FRAME_ACCURACY,
        { 
          segment, 
          startError, 
          endError, 
          frameTolerance,
          targetFps
        }
      );
    }
  }
}

export {
  removeCutSegments,
  adjustTiming,
  validateFrameAccuracy,
  parseTimestamp,
  toFrameTime,
  SubtitleError,
  ERROR_TYPES
};


