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

  return {
    schemaVersion: '1.0.0',
    source: 'transcripts/transcript.json',
    output: 'plan/cut_plan.json',
    cuts: segments,
    metadata: {
      processingTimeMs: 0,
      parameters: {
        minPauseMs: config.minPauseMs,
        minCutDurationSec: config.minCutDurationSec,
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