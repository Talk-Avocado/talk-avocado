// backend/services/smart-cut-planner/planner-logic.js
export function getDefaultConfig() {
  return {
    minPauseMs: Number(process.env.PLANNER_MIN_PAUSE_MS || 200), // Lowered to 200ms to catch more gaps including ums/uhs
    fillerWords: String(process.env.PLANNER_FILLER_WORDS || 'um,uh,like,you know,so,actually,well,er,ah,hmm,kind of,sort of,i mean,you see,right,okay,ok')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean),
    minCutDurationSec: Number(process.env.PLANNER_MIN_CUT_DURATION_SEC || 0.2), // Lowered to 0.2s to catch very short filler words like um/uh
    minSegmentDurationSec: Number(process.env.PLANNER_MIN_SEGMENT_DURATION_SEC || 1.0),
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
    // If word-level timestamps are available, use them (more precise)
    if (seg.words && Array.isArray(seg.words) && seg.words.length > 0) {
      for (const w of seg.words) {
        // Handle both formats: whisper uses "word" field, some variants use "text" field
        const wordText = (w.word || w.text || '').toLowerCase().replace(/[^\p{L}\p{N}'-]+/gu, '');
        if (config.fillerWords.includes(wordText)) {
          // More aggressive cutting: 1.0s before and after to catch surrounding ums/uhs
          // Increased buffer to catch untranscribed filler sounds around detected filler words
          cuts.push({ 
            start: Math.max(0, w.start - 1.0), 
            end: w.end + 1.0, 
            reason: `filler_word_${wordText}` 
          });
        }
      }
    } else {
      // Fallback: detect filler words from segment text when word-level timestamps are not available
      // This is a limitation of whisper-ctranslate2 which doesn't provide word-level timestamps
      const segmentText = (seg.text || '').toLowerCase();
      const segmentStart = parseFloat(seg.start || 0);
      const segmentEnd = parseFloat(seg.end || 0);
      const segmentDuration = segmentEnd - segmentStart;
      
      // Check each filler word in the segment text
      for (const fillerWord of config.fillerWords) {
        // Create regex to match the filler word as a whole word
        const fillerRegex = new RegExp(`\\b${fillerWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        const matches = [...segmentText.matchAll(fillerRegex)];
        
        for (const match of matches) {
          // Estimate position of filler word within segment based on text position
          const textPosition = match.index / segmentText.length;
          const estimatedStart = segmentStart + (textPosition * segmentDuration);
          // Estimate duration: assume filler words are ~0.8 seconds (longer to catch more context)
          const estimatedEnd = estimatedStart + 0.8;
          
          // More aggressive cutting: cut 0.8s before and 0.8s after to catch surrounding pauses/hesitations
          // This ensures we catch the filler word plus any surrounding ums/uhs that might not be in transcript
          cuts.push({ 
            start: Math.max(0, estimatedStart - 0.8), 
            end: Math.min(segmentEnd, estimatedEnd + 0.8), 
            reason: `filler_word_${fillerWord}` 
          });
        }
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
      
      // No adjacent keep segments to merge with - try to merge across cut segments
      // Look ahead to find the next keep segment and merge across any intervening cuts
      if (!merged) {
        let j = i + 1;
        
        // Collect all cut segments until we find the next keep segment
        while (j < segments.length && segments[j].type === 'cut') {
          j++;
        }
        
        // If we found a next keep segment, merge the short keep with it across the cuts
        if (j < segments.length && segments[j].type === 'keep') {
          const nextKeep = { ...segments[j] };
          // Start from the short keep segment
          nextKeep.start = seg.start;
          
          // If there was a previous keep segment in result, merge with that instead
          // First, remove any cuts that were added between the previous keep and now
          if (result.length > 0 && result[result.length - 1].type === 'keep') {
            const prev = result[result.length - 1];
            // Remove any cuts that were added after the previous keep
            while (result.length > 0 && result[result.length - 1].type === 'cut') {
              result.pop();
            }
            // Now extend previous keep to include short keep and next keep, skipping cuts
            prev.end = nextKeep.end;
            prev.reason = prev.reason === 'content' ? 'content' : `${prev.reason}+merged`;
            // Skip the short keep, all cuts, and the next keep
            i = j + 1;
            continue;
          } else {
            // Add the merged keep segment that spans across cuts
            result.push(nextKeep);
            // Skip the short keep, all cuts, and the next keep
            i = j + 1;
            continue;
          }
        }
      }
      
      // If still not merged, keep the segment anyway (better than removing valid content)
      // Only mark as cut if it's extremely short (< 0.1s) to avoid removing tiny valid segments
      if (!merged) {
        if (duration < 0.1) {
          // Extremely short - mark as cut
          result.push({
            ...seg,
            type: 'cut',
            reason: `too_short_${duration.toFixed(2)}s`,
            confidence: 1.0
          });
        } else {
          // Keep it - short segments are better than removing valid content
          result.push(seg);
        }
      }
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

export async function detectSilenceFromAudio(audioPath, config) {
  const cuts = [];
  try {
    const cp = await import('child_process');
    const { spawnSync } = cp;
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    
    // Use FFmpeg silencedetect to find silence periods in audio
    // More aggressive: noise=-40dB (quieter threshold) and d=0.15s (shorter duration) to catch ums/uhs
    // Lower threshold catches low-volume filler sounds that might not be transcribed
    const args = [
      '-i', audioPath,
      '-af', `silencedetect=noise=-40dB:d=0.15`,
      '-f', 'null',
      '-'
    ];
    
    // FFmpeg outputs silence detection to stderr, so we need to capture stderr
    const result = spawnSync(ffmpegPath, args, { 
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    });
    
    // FFmpeg outputs silence detection info to stderr
    const output = result.stderr || result.stdout || '';
    
    // Parse silence_start and silence_end from FFmpeg output
    const silenceStartRegex = /silence_start:\s*([\d.]+)/g;
    const silenceEndRegex = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g;
    
    const starts = [];
    const ends = [];
    
    let match;
    while ((match = silenceStartRegex.exec(output)) !== null) {
      starts.push(parseFloat(match[1]));
    }
    
    while ((match = silenceEndRegex.exec(output)) !== null) {
      const end = parseFloat(match[1]);
      const duration = parseFloat(match[2]);
      ends.push({ end, duration });
    }
    
    // Match silence periods and create cuts for those >= minPauseMs
    // Be very aggressive: catch silences >= 150ms to catch ums/uhs that aren't in transcript
    // Lower threshold catches very brief filler sounds and hesitations
    const minSilenceMs = Math.min(config.minPauseMs, 150); // Catch shorter gaps (very aggressive)
    for (let i = 0; i < starts.length && i < ends.length; i++) {
      const start = starts[i];
      const end = ends[i].end;
      const durationMs = (end - start) * 1000;
      
      // Be very aggressive: catch silences >= 150ms (filler words like um/uh often have very short pauses)
      // Expand cuts by 0.5s before and after to catch surrounding ums/uhs and hesitations
      if (durationMs >= minSilenceMs) {
        cuts.push({ 
          start: Math.max(0, start - 0.5), 
          end: end + 0.5, 
          reason: `silence_${Math.round(durationMs)}ms` 
        });
      }
    }
    
  } catch (err) {
    // If audio silence detection fails, fall back to transcript-based detection
    // Error is handled silently - transcript-based detection will be used instead
  }
  
  return cuts;
}

export async function planCuts(transcriptData, userConfig, audioPath = null) {
  const config = { ...getDefaultConfig(), ...(userConfig || {}) };
  
  // Try to detect silence from audio if audio path is provided
  let silences = [];
  if (audioPath) {
    silences = await detectSilenceFromAudio(audioPath, config);
  }
  
  // Also use transcript-based silence detection to catch gaps between segments
  const transcriptSilences = detectSilence(transcriptData.segments || [], config);
  
  // Combine both audio-based and transcript-based silence detection
  silences = [...silences, ...transcriptSilences];
  
  const fillers = detectFillerWords(transcriptData.segments || [], config);
  
  const merged = mergeCutRegions([...silences, ...fillers], config.mergeThresholdMs);
  
  const filtered = filterShortCuts(merged, config.minCutDurationSec);
  
  return generateCutPlan(transcriptData, filtered, config);
}