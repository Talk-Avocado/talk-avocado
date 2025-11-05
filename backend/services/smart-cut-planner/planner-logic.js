// backend/services/smart-cut-planner/planner-logic.js
export function getDefaultConfig() {
  return {
    minPauseMs: Number(process.env.PLANNER_MIN_PAUSE_MS || 1500),
    fillerWords: String(process.env.PLANNER_FILLER_WORDS || 'um,uh,like,you know,so,actually')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean),
    minCutDurationSec: Number(process.env.PLANNER_MIN_CUT_DURATION_SEC || 0.5),
    minSegmentDurationSec: Number(process.env.PLANNER_MIN_SEGMENT_DURATION_SEC || 3.0),
    maxSegmentDurationSec: Number(process.env.PLANNER_MAX_SEGMENT_DURATION_SEC || 300.0),
    mergeThresholdMs: Number(process.env.PLANNER_MERGE_THRESHOLD_MS || 500),
    deterministic: String(process.env.DETERMINISTIC || 'true') === 'true',
  };
}

export function detectSilence(segments, config) {
  const cuts = [];
  for (let i = 0; i < segments.length - 1; i++) {
    const pauseMs = (segments[i + 1].start - segments[i].end) * 1000;
    if (pauseMs >= config.minPauseMs) {
      cuts.push({ start: segments[i].end, end: segments[i + 1].start, reason: `silence_${Math.round(pauseMs)}ms` });
    }
  }
  return cuts;
}

export function detectFillerWords(segments, config) {
  const cuts = [];
  for (const seg of segments) {
    for (const w of seg.words || []) {
      const t = (w.text || '').toLowerCase().replace(/[^\p{L}\p{N}'-]+/gu, '');
      if (config.fillerWords.includes(t)) {
        cuts.push({ start: Math.max(0, w.start - 0.3), end: w.end + 0.3, reason: `filler_word_${t}` });
      }
    }
  }
  return cuts;
}

export function mergeCutRegions(regions, mergeThresholdMs) {
  if (!regions.length) return [];
  const sorted = regions.map(r => ({ ...r })).sort((a, b) => a.start - b.start);
  const out = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = out[out.length - 1];
    const cur = sorted[i];
    const gapMs = (cur.start - prev.end) * 1000;
    if (gapMs <= mergeThresholdMs) {
      prev.end = Math.max(prev.end, cur.end);
      prev.reason = `${prev.reason}+${cur.reason}`;
    } else {
      out.push(cur);
    }
  }
  return out;
}

export function filterShortCuts(regions, minDurationSec) {
  return regions.filter(r => (r.end - r.start) >= minDurationSec);
}

/**
 * Enforces segment duration constraints on keep segments.
 * - Merges or removes keep segments shorter than minSegmentDurationSec
 * - Splits keep segments longer than maxSegmentDurationSec at natural boundaries
 */
export function enforceSegmentDurationConstraints(segments, config, transcriptData) {
  const result = [];
  let i = 0;
  
  while (i < segments.length) {
    const seg = segments[i];
    const duration = parseFloat(seg.end) - parseFloat(seg.start);
    
    if (seg.type === 'cut') {
      // Keep cuts as-is
      result.push(seg);
      i++;
      continue;
    }
    
    // Handle keep segments
    if (duration < config.minSegmentDurationSec) {
      // Segment too short - try to merge with adjacent keep segments
      let merged = false;
      
      // Try to merge with previous keep segment
      if (result.length > 0 && result[result.length - 1].type === 'keep') {
        const prev = result[result.length - 1];
        prev.end = seg.end;
        prev.reason = prev.reason === 'content' ? 'content' : `${prev.reason}+merged`;
        merged = true;
        i++;
        continue;
      }
      
      // Try to merge with next keep segment
      if (!merged && i < segments.length - 1 && segments[i + 1].type === 'keep') {
        // Expand the next segment to include this one
        const nextSeg = { ...segments[i + 1] };
        nextSeg.start = seg.start;
        result.push(nextSeg);
        // Skip both the current and next segment
        i += 2;
        continue;
      }
      
      // No adjacent keep segments to merge with - mark as cut
      result.push({
        ...seg,
        type: 'cut',
        reason: `too_short_${duration.toFixed(2)}s`,
        confidence: 1.0
      });
      i++;
    } else if (duration > config.maxSegmentDurationSec) {
      // Segment too long - split at natural boundaries
      // Find silence points within the segment from transcript data
      const startTime = parseFloat(seg.start);
      const endTime = parseFloat(seg.end);
      const splitPoints = [];
      
      // Find silence gaps within this segment that are good split points
      if (transcriptData?.segments) {
        for (const ts of transcriptData.segments) {
          if (ts.start >= startTime && ts.end <= endTime) {
            // Check gaps between segments within this keep segment
            const segIndex = transcriptData.segments.indexOf(ts);
            if (segIndex < transcriptData.segments.length - 1) {
              const nextSeg = transcriptData.segments[segIndex + 1];
              const pauseMs = (nextSeg.start - ts.end) * 1000;
              // Use pause points that are at least 500ms as split candidates
              if (pauseMs >= 500 && nextSeg.start <= endTime) {
                splitPoints.push(ts.end);
              }
            }
          }
        }
      }
      
      // If no natural split points found, split at regular intervals
      if (splitPoints.length === 0) {
        const numSplits = Math.ceil(duration / config.maxSegmentDurationSec);
        const splitInterval = duration / numSplits;
        for (let j = 1; j < numSplits; j++) {
          splitPoints.push(startTime + (splitInterval * j));
        }
      }
      
      // Create segments from split points
      let currentStart = startTime;
      for (const splitPoint of splitPoints) {
        if (splitPoint > currentStart && splitPoint < endTime) {
          result.push({
            start: currentStart.toFixed(2),
            end: splitPoint.toFixed(2),
            type: 'keep',
            reason: seg.reason,
            confidence: seg.confidence
          });
          currentStart = splitPoint;
        }
      }
      // Add final segment
      if (currentStart < endTime) {
        result.push({
          start: currentStart.toFixed(2),
          end: endTime.toFixed(2),
          type: 'keep',
          reason: seg.reason,
          confidence: seg.confidence
        });
      }
      i++;
    } else {
      // Segment within bounds - keep as-is
      result.push(seg);
      i++;
    }
  }
  
  return result;
}

export function generateCutPlan(transcriptData, cutRegions, config) {
  const segments = [];
  let t = 0;
  const endT = transcriptData.segments?.[transcriptData.segments.length - 1]?.end || 0;

  const sorted = [...cutRegions].sort((a, b) => a.start - b.start);
  for (const c of sorted) {
    if (t < c.start) {
      segments.push({ start: t.toFixed(2), end: c.start.toFixed(2), type: 'keep', reason: 'content', confidence: 1.0 });
    }
    segments.push({ start: c.start.toFixed(2), end: c.end.toFixed(2), type: 'cut', reason: c.reason, confidence: 1.0 });
    t = c.end;
  }
  if (t < endT) {
    segments.push({ start: t.toFixed(2), end: endT.toFixed(2), type: 'keep', reason: 'content', confidence: 1.0 });
  }

  // Enforce segment duration constraints on keep segments
  const constrainedSegments = enforceSegmentDurationConstraints(segments, config, transcriptData);

  return {
    schemaVersion: '1.0.0',
    source: 'transcripts/transcript.json',
    output: 'plan/cut_plan.json',
    cuts: constrainedSegments,
    metadata: {
      processingTimeMs: 0,
      parameters: {
        minPauseMs: config.minPauseMs,
        minCutDurationSec: config.minCutDurationSec,
        minSegmentDurationSec: config.minSegmentDurationSec,
        maxSegmentDurationSec: config.maxSegmentDurationSec,
        mergeThresholdMs: config.mergeThresholdMs,
        deterministic: config.deterministic,
      },
    },
  };
}

export function planCuts(transcriptData, userConfig) {
  const config = { ...getDefaultConfig(), ...(userConfig || {}) };
  const silences = detectSilence(transcriptData.segments || [], config);
  const fillers = detectFillerWords(transcriptData.segments || [], config);
  const merged = mergeCutRegions([...silences, ...fillers], config.mergeThresholdMs);
  const filtered = filterShortCuts(merged, config.minCutDurationSec);
  return generateCutPlan(transcriptData, filtered, config);
}