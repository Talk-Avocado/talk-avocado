// backend/services/smart-cut-planner/planner-logic.js
export function getDefaultConfig() {
  return {
    minPauseMs: Number(process.env.PLANNER_MIN_PAUSE_MS || 200), // Lowered to 200ms to catch more gaps including ums/uhs
    fillerWords: String(process.env.PLANNER_FILLER_WORDS || 'um,uh,like,you know,so,actually,well,er,ah,hmm,kind of,sort of,i mean,you see,right,okay,ok,basically')
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
  
  // Detect gaps BETWEEN segments
  for (let i = 0; i < segments.length - 1; i++) {
    const pauseMs = (segments[i + 1].start - segments[i].end) * 1000;
    if (pauseMs >= config.minPauseMs) {
      cuts.push({ start: segments[i].end, end: segments[i + 1].start, reason: `silence_${Math.round(pauseMs)}ms` });
    }
  }
  
  // ALSO detect gaps WITHIN segments (based on word timestamps)
  // This catches long pauses within a single segment that Whisper grouped together
  for (const seg of segments) {
    if (seg.words && Array.isArray(seg.words) && seg.words.length > 1) {
      for (let i = 0; i < seg.words.length - 1; i++) {
        const currentWord = seg.words[i];
        const nextWord = seg.words[i + 1];
        const wordEnd = parseFloat(currentWord.end || 0);
        const nextWordStart = parseFloat(nextWord.start || 0);
        const gapMs = (nextWordStart - wordEnd) * 1000;
        
        // Detect gaps >= minPauseMs within segments
        // This catches long pauses like the 5.58s gap between "avocado." (22.26s) and "It's" (24.02s)
        if (gapMs >= config.minPauseMs) {
          cuts.push({ 
            start: wordEnd, 
            end: nextWordStart, 
            reason: `silence_${Math.round(gapMs)}ms` 
          });
        }
      }
    }
  }
  
  return cuts;
}

/**
 * Determine if "so" is likely a filler word based on context
 * @param {Object} word - Word object with start/end timestamps
 * @param {Array} words - Array of all words in the segment
 * @param {number} wordIndex - Index of the current word in the segment
 * @param {Object} segment - Segment object
 * @returns {boolean} True if "so" is likely a filler word
 */
function isFillerSo(word, words, wordIndex, segment) {
  // "So" at the very beginning of a segment is likely a filler
  if (wordIndex === 0 || wordIndex === 1) {
    return true;
  }
  
  // Check if "so" is followed by a pause (gap to next word > 300ms)
  if (wordIndex < words.length - 1) {
    const nextWord = words[wordIndex + 1];
    const gapMs = (nextWord.start - word.end) * 1000;
    if (gapMs > 300) {
      return true; // Pause after "so" suggests it's a filler
    }
  }
  
  // Check if "so" is at the start of a sentence (preceded by punctuation)
  if (wordIndex > 0) {
    const prevWord = words[wordIndex - 1];
    const prevWordText = (prevWord.word || prevWord.text || '').trim();
    // If previous word ends with punctuation, "so" is likely starting a new sentence (filler)
    if (/[.!?]$/.test(prevWordText)) {
      return true;
    }
  }
  
  // If "so" is in the middle of a sentence without pause, it's likely a conjunction (not filler)
  return false;
}

export function detectFillerWords(segments, config) {
  const cuts = [];
  
  for (const seg of segments) {
    // If word-level timestamps are available, use them (more precise)
    if (seg.words && Array.isArray(seg.words) && seg.words.length > 0) {
      for (let i = 0; i < seg.words.length; i++) {
        const w = seg.words[i];
        // Handle both formats: whisper uses "word" field, some variants use "text" field
        const wordText = (w.word || w.text || '').toLowerCase().replace(/[^\p{L}\p{N}'-]+/gu, '');
        
        if (config.fillerWords.includes(wordText)) {
          // CONTEXT-AWARE: For "so", check if it's likely a filler or legitimate conjunction
          let shouldCut = true;
          if (wordText === 'so') {
            shouldCut = isFillerSo(w, seg.words, i, seg);
          }
          
          if (shouldCut) {
            // PRECISE cutting: only cut the filler word itself with minimal buffer
            // Small buffer (0.2s) to catch the word and immediate pause, but not cut into other words
            const buffer = 0.2;
            cuts.push({ 
              start: Math.max(0, w.start - buffer), 
              end: Math.min(seg.end || Infinity, w.end + buffer), 
              reason: `filler_word_${wordText}`,
              fillerWord: wordText,
              isContextAware: wordText === 'so' // Flag for logging
            });
          }
        }
      }
    } else {
      // Fallback: detect filler words from segment text when word-level timestamps are not available
      // This is a limitation of whisper-ctranslate2 which doesn't provide word-level timestamps
      const segmentText = (seg.text || '').trim();
      if (!segmentText) continue;
      
      const segmentStart = parseFloat(seg.start || 0);
      const segmentEnd = parseFloat(seg.end || 0);
      const segmentDuration = segmentEnd - segmentStart;
      
      // IMPROVEMENT: Split text into words for better position estimation
      const words = segmentText.split(/\s+/).filter(w => w.length > 0);
      if (words.length === 0) continue;
      
      // Build word positions map for more accurate estimation
      let currentPos = 0;
      const wordPositions = words.map(word => {
        const wordStart = currentPos;
        // Clean word for comparison (remove punctuation)
        const cleanWord = word.toLowerCase().replace(/[^\p{L}\p{N}'-]+/gu, '');
        currentPos += word.length + 1; // +1 for space
        return { 
          word: cleanWord, 
          originalWord: word,
          start: wordStart, 
          end: currentPos,
          charIndex: wordStart
        };
      });
      
      // Check each filler word against word positions
      for (const fillerWord of config.fillerWords) {
        const cleanFiller = fillerWord.toLowerCase().replace(/[^\p{L}\p{N}'-]+/gu, '');
        
        for (let i = 0; i < wordPositions.length; i++) {
          const wp = wordPositions[i];
          if (wp.word === cleanFiller) {
            // CONTEXT-AWARE: For "so", check if it's likely a filler or legitimate conjunction
            let shouldCut = true;
            if (cleanFiller === 'so') {
              // "So" at the beginning of segment is likely a filler
              if (i === 0 || i === 1) {
                shouldCut = true;
              } else {
                // Check if previous word ends with punctuation (sentence start)
                if (i > 0) {
                  const prevWord = wordPositions[i - 1];
                  const prevOriginalWord = words[i - 1];
                  if (/[.!?]$/.test(prevOriginalWord)) {
                    shouldCut = true; // "So" starting a new sentence is likely filler
                  } else {
                    // Estimate gap to next word - if > 300ms, likely filler
                    if (i < wordPositions.length - 1) {
                      const wordIndexRatio = i / words.length;
                      const nextWordIndexRatio = (i + 1) / words.length;
                      const estimatedStart = segmentStart + (wordIndexRatio * segmentDuration);
                      const estimatedNextStart = segmentStart + (nextWordIndexRatio * segmentDuration);
                      const estimatedGap = (estimatedNextStart - estimatedStart - 0.3) * 1000; // 0.3s is word duration
                      if (estimatedGap > 300) {
                        shouldCut = true; // Pause after "so" suggests filler
                      } else {
                        shouldCut = false; // No pause, likely conjunction
                      }
                    }
                  }
                }
              }
            }
            
            if (shouldCut) {
              // Calculate position based on word position in segment
              // Use word index to estimate timing (more accurate than character position)
              const wordIndexRatio = i / words.length;
              const estimatedStart = segmentStart + (wordIndexRatio * segmentDuration);
              
              // Estimate word duration: average speaking rate ~150 words/min = 0.4s per word
              // Filler words are typically shorter, so use 0.3s
              const wordDuration = 0.3;
              const estimatedEnd = estimatedStart + wordDuration;
              
              // PRECISE cutting: only cut the filler word itself with minimal buffer
              // Small buffer (0.2s) to catch the word and immediate pause, but not cut into other words
              const buffer = 0.2;
              const cutStart = Math.max(0, estimatedStart - buffer);
              const cutEnd = Math.min(segmentEnd, estimatedEnd + buffer);
              const cutDuration = cutEnd - cutStart;
              
              // Ensure minimum cut duration of 0.3s for filler words (just the word + small buffer)
              if (cutDuration >= 0.3) {
                cuts.push({ 
                  start: cutStart, 
                  end: cutEnd, 
                  reason: `filler_word_${fillerWord}`,
                  fillerWord: fillerWord,
                  estimatedPosition: estimatedStart,
                  isContextAware: cleanFiller === 'so' // Flag for logging
                });
              }
            }
          }
        }
      }
    }
  }
  
  return cuts;
}

export function mergeCutRegions(regions, mergeThresholdMs) {
  if (!regions.length) return [];
  
  // IMPROVEMENT: Sort with filler words first (higher priority) to preserve their identity
  const sorted = regions.map(r => ({ 
    ...r, 
    priority: r.reason?.startsWith('filler_word_') ? 1 : 0 
  })).sort((a, b) => {
    // Sort by start time first, then by priority (fillers first when times are close)
    if (Math.abs(a.start - b.start) < 0.01) {
      return b.priority - a.priority; // Fillers first
    }
    return a.start - b.start;
  });
  
  const out = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = out[out.length - 1];
    const cur = sorted[i];
    const gapMs = (cur.start - prev.end) * 1000;
    if (gapMs <= mergeThresholdMs) {
      prev.end = Math.max(prev.end, cur.end);
      
      // IMPROVEMENT: Preserve filler word information in merged cuts
      const prevIsFiller = prev.reason?.startsWith('filler_word_');
      const curIsFiller = cur.reason?.startsWith('filler_word_');
      
      if (prevIsFiller && curIsFiller) {
        // Both are fillers - combine reasons, keep filler_word prefix
        prev.reason = `${prev.reason}+${cur.reason}`;
      } else if (prevIsFiller || curIsFiller) {
        // One is filler - prioritize filler in reason to make it visible
        const fillerReason = prevIsFiller ? prev.reason : cur.reason;
        const otherReason = prevIsFiller ? cur.reason : prev.reason;
        prev.reason = `${fillerReason}+${otherReason}`;
      } else {
        // Neither is filler - combine normally
        prev.reason = `${prev.reason}+${cur.reason}`;
      }
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
 * Determine if a word is at the start of a sentence
 * Checks for punctuation, capitalization, and segment boundaries
 */
function isSentenceStart(word, wordIdx, segment, allSegments) {
  // At the very beginning of a segment
  if (wordIdx === 0) {
    return true;
  }
  
  // Second word in segment (first might be "you" or similar)
  if (wordIdx === 1) {
    const firstWord = segment.words[0];
    const firstWordText = (firstWord.word || firstWord.text || '').trim();
    // If first word is very short or common, second word might be sentence start
    if (firstWordText.length <= 3 || ['you', 'i', 'we', 'it', 'the', 'a'].includes(firstWordText.toLowerCase())) {
      return true;
    }
  }
  
  // Check if previous word ends with punctuation
  if (wordIdx > 0 && segment.words[wordIdx - 1]) {
    const prevWord = segment.words[wordIdx - 1];
    const prevWordText = (prevWord.word || prevWord.text || '').trim();
    if (/[.!?]$/.test(prevWordText)) {
      return true;
    }
  }
  
  // Check if word starts with capital letter (sentence start indicator)
  const wordText = (word.word || word.text || '').trim();
  if (wordText.length > 0 && /^[A-Z]/.test(wordText)) {
    // But not if it's a proper noun in the middle (heuristic: check if previous word is lowercase)
    if (wordIdx > 0 && segment.words[wordIdx - 1]) {
      const prevWordText = (segment.words[wordIdx - 1].word || segment.words[wordIdx - 1].text || '').trim();
      if (/^[a-z]/.test(prevWordText)) {
        return true; // Previous word was lowercase, this is capitalized - likely sentence start
      }
    } else {
      return true; // First word in segment and capitalized
    }
  }
  
  return false;
}

/**
 * Determine if "so" is clearly a filler (not a conjunction)
 * Based on context: sentence start, following pause, etc.
 */
function isClearFillerSo(word, wordIdx, segment, allSegments) {
  // At sentence start - always a filler
  if (isSentenceStart(word, wordIdx, segment, allSegments)) {
    return true;
  }
  
  // Check if followed by pause (>300ms gap)
  if (wordIdx < segment.words.length - 1) {
    const nextWord = segment.words[wordIdx + 1];
    const gapMs = (nextWord.start - word.end) * 1000;
    if (gapMs > 300) {
      return true; // Pause after "so" suggests filler
    }
  }
  
  return false;
}

/**
 * Filter out any cuts that overlap with transcribed words (non-filler words)
 * This is a final safety check to ensure we never cut actual speech content
 * For filler word cuts, we allow cutting the filler word itself but trim the cut to avoid adjacent words
 * IMPROVED: More aggressive overlap handling with context-based rules
 */
export function filterCutsOverlappingWords(cuts, transcriptData, logger = null) {
  if (!transcriptData?.segments) return cuts;
  
  // Build a map of all word timestamps (excluding filler words)
  const wordTimestamps = [];
  const fillerWords = ['um', 'uh', 'ah', 'er', 'mm', 'like', 'well', 'so', 'actually', 'basically', 'right', 'okay', 'you know', 'i mean'];
  
  for (const seg of transcriptData.segments) {
    if (seg.words && Array.isArray(seg.words)) {
      for (const word of seg.words) {
        const wordText = (word.word || word.text || '').toLowerCase().replace(/[^\p{L}\p{N}'-]+/gu, '');
        // Only include non-filler words for protection
        if (!fillerWords.includes(wordText)) {
          wordTimestamps.push({
            start: parseFloat(word.start || 0),
            end: parseFloat(word.end || 0),
            word: word.word || word.text || ''
          });
        }
      }
    }
  }
  
  // Track statistics for logging
  const stats = {
    totalFillerCuts: 0,
    cutFillerCuts: 0,
    rejectedFillerCuts: [],
    reasons: {}
  };
  
  // Process cuts: either reject them or trim them to avoid non-filler words
  const protectedCuts = [];
  
  for (const cut of cuts) {
    // Check if this is a filler word cut
    const isFillerWordCut = cut.reason?.startsWith('filler_word_');
    // Check if this is an early "um" cut (low_volume_um or low_volume_filler)
    const isEarlyUmCut = cut.reason?.startsWith('low_volume_um_') || cut.reason?.startsWith('low_volume_filler_');
    // Check if this is in the very early part (first 0.6s) - these are likely untranscribed "um" sounds
    const isVeryEarlyCut = cut.start < 0.6;
    
    // Find overlapping non-filler words
    const overlappingWords = [];
    for (const word of wordTimestamps) {
      if (cut.start < word.end && cut.end > word.start) {
        overlappingWords.push(word);
      }
    }
    
    if (overlappingWords.length === 0) {
      // No overlap with non-filler words - KEEP the cut as-is
      protectedCuts.push(cut);
      if (isFillerWordCut) {
        stats.cutFillerCuts++;
      }
    } else if (isEarlyUmCut && isVeryEarlyCut) {
      // For very early "um" cuts (first 0.6s), allow them even if they overlap with first word
      // These are almost certainly untranscribed "um" sounds before actual speech
      // BUT: Trim them to ensure we don't cut too much into the first word
      // Only allow cutting up to 30% into the first word
      let trimmedCut = { ...cut };
      for (const word of overlappingWords) {
        if (word.start === 0 || Math.abs(word.start - 0) < 0.1) {
          // This is likely the first word - limit cut to 30% of word duration
          const wordDuration = word.end - word.start;
          const maxCutEnd = word.start + (wordDuration * 0.3);
          if (trimmedCut.end > maxCutEnd) {
            trimmedCut.end = maxCutEnd;
          }
        }
      }
      // Only add if trimmed cut is still valid (>= 0.05s)
      if (trimmedCut.end - trimmedCut.start >= 0.05) {
        protectedCuts.push(trimmedCut);
      }
    } else if (isFillerWordCut) {
      stats.totalFillerCuts++;
      // For filler word cuts, we MUST cut the filler word itself, even if it overlaps with adjacent words
      // Find the actual filler word in the transcript to get its exact timestamps
      const fillerWordName = cut.reason?.replace('filler_word_', '').split('+')[0].split('_')[0];
      let fillerWordFound = false;
      let rejectionReason = null;
      
      if (transcriptData?.segments) {
        // CRITICAL FIX: Find the filler word that matches THIS specific cut's time range
        // Don't just find the first matching filler word - find the one that's actually in this cut's range
        for (const seg of transcriptData.segments) {
          if (seg.words && Array.isArray(seg.words)) {
            for (let wordIdx = 0; wordIdx < seg.words.length; wordIdx++) {
              const word = seg.words[wordIdx];
              const wordText = (word.word || word.text || '').toLowerCase().replace(/[^\p{L}\p{N}'-]+/gu, '');
              if (wordText === fillerWordName) {
                const wordStart = parseFloat(word.start || 0);
                const wordEnd = parseFloat(word.end || 0);
                
                // CRITICAL FIX: Only process this word if it's within the cut's time range
                // The cut was created for a specific filler word at a specific time
                // We need to match the word that's actually in this cut's range, not just any matching word
                const cutStart = parseFloat(cut.start || 0);
                const cutEnd = parseFloat(cut.end || 0);
                
                // Check if this word is within the cut's time range (with some tolerance for buffer)
                const tolerance = 1.0; // Allow 1s tolerance for buffer/estimation differences
                const wordIsInCutRange = (wordStart >= cutStart - tolerance && wordStart <= cutEnd + tolerance) ||
                                       (wordEnd >= cutStart - tolerance && wordEnd <= cutEnd + tolerance) ||
                                       (wordStart <= cutStart && wordEnd >= cutEnd); // Word spans the cut
                
                if (!wordIsInCutRange) {
                  continue; // This is not the filler word for this cut, skip it
                }
                
                // IMPROVEMENT: Better sentence start detection
                const isAtSentenceStart = isSentenceStart(word, wordIdx, seg, transcriptData.segments);
                const isClearFiller = fillerWordName === 'so' ? isClearFillerSo(word, wordIdx, seg, transcriptData.segments) : true;
                
                // IMPROVEMENT: "So" at segment start is always a filler, regardless of overlap
                const isSoAtSegmentStart = fillerWordName === 'so' && wordIdx <= 1;
                
                // Check if this filler word overlaps with any non-filler words
                let overlapsWithOtherWords = false;
                let overlappingWords = [];
                for (const w of wordTimestamps) {
                  // Skip if this is the same word (same start time)
                  if (Math.abs(w.start - wordStart) < 0.01 && Math.abs(w.end - wordEnd) < 0.01) {
                    continue; // This is the filler word itself, skip
                  }
                  // Check if the filler word overlaps with this other word
                  if (wordStart < w.end && wordEnd > w.start) {
                    overlapsWithOtherWords = true;
                    overlappingWords.push(w);
                  }
                }
                
                // If the filler word doesn't overlap with other words, cut it with a small buffer
                if (!overlapsWithOtherWords) {
                  const buffer = 0.15; // Small buffer to catch the word cleanly
                  protectedCuts.push({
                    ...cut,
                    start: Math.max(0, wordStart - buffer),
                    end: wordEnd + buffer,
                    reason: cut.reason
                  });
                  stats.cutFillerCuts++;
                  fillerWordFound = true;
                  break;
                } else {
                  // The filler word overlaps with another word
                  // IMPROVEMENT: Context-based overlap rules
                  
                  // For "so" at sentence/segment start - be VERY aggressive (70% overlap allowed)
                  if ((isSoAtSegmentStart || (fillerWordName === 'so' && isAtSentenceStart)) && overlappingWords.length > 0) {
                    const overlappingWord = overlappingWords[0];
                    const wordDuration = overlappingWord.end - overlappingWord.start;
                    const maxAllowedOverlap = wordDuration * 0.7; // Allow up to 70% overlap
                    const cutEnd = Math.min(wordEnd + 0.2, overlappingWord.start + maxAllowedOverlap);
                    
                    if (cutEnd > wordStart + 0.2) { // Ensure minimum cut duration
                      protectedCuts.push({
                        ...cut,
                        start: Math.max(0, wordStart - 0.1),
                        end: cutEnd,
                        reason: `${cut.reason}_aggressive`
                      });
                      stats.cutFillerCuts++;
                      fillerWordFound = true;
                      break;
                    } else {
                      rejectionReason = `cut too short after 70% overlap limit (${((cutEnd - wordStart) * 1000).toFixed(0)}ms)`;
                    }
                  }
                  // For clear fillers (sentence start, followed by pause) - allow 50% overlap
                  else if (isClearFiller && overlappingWords.length > 0) {
                    const overlappingWord = overlappingWords[0];
                    const wordDuration = overlappingWord.end - overlappingWord.start;
                    const maxAllowedOverlap = wordDuration * 0.5; // Allow up to 50% overlap
                    const cutEnd = Math.min(wordEnd + 0.2, overlappingWord.start + maxAllowedOverlap);
                    
                    if (cutEnd > wordStart + 0.2) { // Ensure minimum cut duration
                      protectedCuts.push({
                        ...cut,
                        start: Math.max(0, wordStart - 0.1),
                        end: cutEnd,
                        reason: `${cut.reason}_moderate`
                      });
                      stats.cutFillerCuts++;
                      fillerWordFound = true;
                      break;
                    } else {
                      rejectionReason = `cut too short after 50% overlap limit (${((cutEnd - wordStart) * 1000).toFixed(0)}ms)`;
                    }
                  }
                  // For "so" in middle of sentence without pause - be conservative (30% overlap)
                  else if (fillerWordName === 'so' && !isClearFiller && overlappingWords.length > 0) {
                    const overlappingWord = overlappingWords[0];
                    const wordDuration = overlappingWord.end - overlappingWord.start;
                    const maxAllowedOverlap = wordDuration * 0.3; // Only 30% overlap for mid-sentence "so"
                    const cutEnd = Math.min(wordEnd + 0.15, overlappingWord.start + maxAllowedOverlap);
                    
                    if (cutEnd > wordStart + 0.2) {
                      protectedCuts.push({
                        ...cut,
                        start: Math.max(0, wordStart - 0.05),
                        end: cutEnd,
                        reason: `${cut.reason}_conservative`
                      });
                      stats.cutFillerCuts++;
                      fillerWordFound = true;
                      break;
                    } else {
                      rejectionReason = `mid-sentence "so" - cut too short after 30% overlap limit (${((cutEnd - wordStart) * 1000).toFixed(0)}ms)`;
                    }
                  }
                  // For other filler words with overlap - allow 50% overlap
                  else if (overlappingWords.length > 0) {
                    const overlappingWord = overlappingWords[0];
                    const wordDuration = overlappingWord.end - overlappingWord.start;
                    const maxAllowedOverlap = wordDuration * 0.5; // Allow up to 50% overlap
                    const cutEnd = Math.min(wordEnd + 0.2, overlappingWord.start + maxAllowedOverlap);
                    
                    if (cutEnd > wordStart + 0.2) {
                      protectedCuts.push({
                        ...cut,
                        start: Math.max(0, wordStart - 0.1),
                        end: cutEnd,
                        reason: `${cut.reason}_standard`
                      });
                      stats.cutFillerCuts++;
                      fillerWordFound = true;
                      break;
                    } else {
                      rejectionReason = `cut too short after 50% overlap limit (${((cutEnd - wordStart) * 1000).toFixed(0)}ms)`;
                    }
                  }
                  
                  // If we couldn't create a valid cut, reject it
                  if (!fillerWordFound) {
                    rejectionReason = rejectionReason || `overlap with word "${overlappingWords[0]?.word}" too large`;
                  }
                }
              }
            }
            if (fillerWordFound) break;
          }
        }
      }
      
      // If we couldn't find the filler word in the transcript, keep the original cut
      // This handles cases where the filler word was detected but not in word timestamps
      if (!fillerWordFound) {
        // Check if original cut overlaps with words
        const originalOverlaps = wordTimestamps.filter(w => cut.start < w.end && cut.end > w.start);
        if (originalOverlaps.length === 0) {
          protectedCuts.push(cut);
          stats.cutFillerCuts++;
        } else {
          rejectionReason = `filler word not found in transcript, cut overlaps with "${originalOverlaps[0]?.word}"`;
        }
      }
      
      // Track rejection for logging
      if (!fillerWordFound || rejectionReason) {
        stats.rejectedFillerCuts.push({
          word: fillerWordName,
          start: cut.start,
          end: cut.end,
          reason: rejectionReason || 'unknown'
        });
        const reasonKey = rejectionReason || 'unknown';
        stats.reasons[reasonKey] = (stats.reasons[reasonKey] || 0) + 1;
      }
    } else {
      // Not a filler word cut and overlaps with words - REJECT it
      // This ensures we never cut actual speech content
    }
  }
  
  // IMPROVEMENT: Log detailed statistics
  if (logger && stats.totalFillerCuts > 0) {
    const removalRate = ((stats.cutFillerCuts / stats.totalFillerCuts) * 100).toFixed(1);
    logger.info('Filler word removal statistics', {
      totalDetected: stats.totalFillerCuts,
      successfullyCut: stats.cutFillerCuts,
      rejected: stats.rejectedFillerCuts.length,
      removalRate: `${removalRate}%`,
      rejectionReasons: stats.reasons,
      rejectedDetails: stats.rejectedFillerCuts.slice(0, 10) // Limit to first 10 for brevity
    });
  }
  
  return protectedCuts;
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

export function generateCutPlan(transcriptData, cutRegions, config, logger = null) {
  const segments = [];
  let t = 0;
  const endT = transcriptData.segments?.[transcriptData.segments.length - 1]?.end || 0;

  const sorted = [...cutRegions].sort((a, b) => a.start - b.start);
  
  // IMPROVEMENT: Track filler word cuts in cut plan generation
  const fillerCutsInPlan = [];
  
  for (const c of sorted) {
    if (t < c.start) {
      segments.push({ start: t.toFixed(2), end: c.start.toFixed(2), type: 'keep', reason: 'content', confidence: 1.0 });
    }
    segments.push({ start: c.start.toFixed(2), end: c.end.toFixed(2), type: 'cut', reason: c.reason, confidence: 1.0 });
    
    // Track filler word cuts
    if (c.reason?.includes('filler_word')) {
      fillerCutsInPlan.push({
        start: c.start.toFixed(2),
        end: c.end.toFixed(2),
        reason: c.reason
      });
    }
    
    t = c.end;
  }
  if (t < endT) {
    segments.push({ start: t.toFixed(2), end: endT.toFixed(2), type: 'keep', reason: 'content', confidence: 1.0 });
  }

  // Enforce segment duration constraints on keep segments
  const constrainedSegments = enforceSegmentDurationConstraints(segments, config, transcriptData);
  
  // IMPROVEMENT: Log filler word cuts in final plan
  if (logger) {
    const finalFillerCuts = constrainedSegments.filter(s => 
      s.type === 'cut' && s.reason?.includes('filler_word')
    );
    logger.info('After generateCutPlan', {
      totalSegments: constrainedSegments.length,
      fillerCutsInPlan: fillerCutsInPlan.length,
      finalFillerCuts: finalFillerCuts.length,
      finalFillerCutsDetails: finalFillerCuts.map(f => ({
        start: f.start,
        end: f.end,
        reason: f.reason
      })),
      note: finalFillerCuts.length < fillerCutsInPlan.length ? 
        'Some filler cuts may have been merged or filtered during constraint enforcement' : 
        'All filler cuts preserved'
    });
  }

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

export async function detectSilenceFromAudio(audioPath, config, transcriptData = null) {
  const cuts = [];
  try {
    const cp = await import('child_process');
    const { spawnSync } = cp;
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    
    // Use FFmpeg silencedetect to find silence periods in audio
    // VERY aggressive: noise=-50dB (very quiet threshold) and d=0.05s (very short duration) to catch ums/uhs
    // Reduced from 0.1s to 0.05s to catch very brief "um" sounds (50ms)
    // This catches low-volume filler sounds like "um" and "uh" that Whisper doesn't transcribe
    const args = [
      '-i', audioPath,
      '-af', `silencedetect=noise=-50dB:d=0.05`,
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
    // VERY aggressive: catch silences >= 50ms to catch ums/uhs that aren't in transcript
    // Lower threshold catches very brief filler sounds and hesitations
    // For the very beginning (first 2 seconds), be even more aggressive (30ms) to catch quick "um" sounds
    const minSilenceMs = Math.min(config.minPauseMs, 100); // Catch shorter gaps (very aggressive)
    const veryEarlyMinSilenceMs = 30; // Even more aggressive for first 2 seconds
    
    // Build a map of all word timestamps to avoid cutting within speech
    const wordTimestamps = [];
    if (transcriptData?.segments) {
      for (const seg of transcriptData.segments) {
        if (seg.words && Array.isArray(seg.words)) {
          for (const word of seg.words) {
            wordTimestamps.push({
              start: parseFloat(word.start || 0),
              end: parseFloat(word.end || 0),
              word: word.word || word.text || ''
            });
          }
        }
      }
    }
    
    // Find the first speech start time from transcript to avoid cutting before actual content
    const firstSpeechStart = transcriptData?.segments?.[0]?.start || 0;
    const firstSpeechWordStart = transcriptData?.segments?.[0]?.words?.[0]?.start || firstSpeechStart;
    
    for (let i = 0; i < starts.length && i < ends.length; i++) {
      const start = starts[i];
      const end = ends[i].end;
      const durationMs = (end - start) * 1000;
      
      // VERY aggressive: catch silences >= 50ms (filler words like um/uh often have very short pauses)
      // For the very beginning (first 2 seconds), catch even shorter silences (30ms) to catch quick "um" sounds
      // For the first 1 second, catch extremely short silences (15ms) to catch untranscribed "like" and "um" sounds
      // BUT: Only cut if the silence doesn't overlap with any transcribed words
      const effectiveMinSilence = (start < 1.0) ? firstSecondMinSilenceMs : (start < 2.0) ? veryEarlyMinSilenceMs : minSilenceMs;
      if (durationMs >= effectiveMinSilence) {
        // Check if this silence overlaps with any transcribed words
        // Skip if silence overlaps with any word (start, end, or midpoint within word)
        // EXCEPTION: Allow cutting short silences at the very start (0s) even if they overlap with first word
        // These are likely untranscribed "um" sounds before actual speech
        let overlapsWithWords = false;
        const isAtVeryStart = start < 0.1; // Silence starts within first 100ms
        const isShortSilence = durationMs < 1000; // Silence is less than 1 second
        let allowEarlyCut = false; // Flag to allow cutting early silences
        
        for (const word of wordTimestamps) {
          // Check if silence overlaps with word using standard interval overlap check
          // Two intervals overlap if: start1 < end2 && end1 > start2
          if (start < word.end && end > word.start) {
            // Special case: if silence is at very start and short, and it's the first word,
            // allow cutting it (these are likely "um" sounds before actual speech)
            if (isAtVeryStart && isShortSilence && word.start === firstSpeechWordStart) {
              // Check if the word is long enough that cutting the silence won't remove all of it
              const wordDuration = word.end - word.start;
              // More lenient: Allow if word is long enough (>0.4s) and silence ends before 85% of the word
              // This catches more early "um" sounds
              if (wordDuration > 0.4 && end < word.start + (wordDuration * 0.85)) {
                // Allow this cut - it's a short silence at start before the main part of the word
                allowEarlyCut = true;
                break; // Skip this word check, allow the cut
              }
            }
            overlapsWithWords = true;
            break;
          }
        }
        
        // Skip silences that are actually during transcribed words (unless it's the special case above)
        if (overlapsWithWords && !allowEarlyCut) {
          continue;
        }
        
        // Check if silence is BEFORE the first word (these are likely untranscribed "um" sounds)
        const isBeforeFirstWord = end < firstSpeechWordStart;
        
        // Only cut silences that are BETWEEN segments or outside speech
        // Check if silence is between transcript segments (gaps between segments)
        let isBetweenSegments = false;
        if (transcriptData?.segments) {
          for (let j = 0; j < transcriptData.segments.length - 1; j++) {
            const segEnd = parseFloat(transcriptData.segments[j].end || 0);
            const nextSegStart = parseFloat(transcriptData.segments[j + 1].start || 0);
            // Check if silence is in the gap between segments
            if (start >= segEnd - 0.2 && end <= nextSegStart + 0.2) {
              isBetweenSegments = true;
              break;
            }
          }
        }
        
        // Only cut if it's between segments OR if it's a longer silence (likely filler word)
        // OR if it's before the first word (untranscribed "um" sounds)
        // Reduce buffer expansion to avoid cutting into speech
        // For very early silences (first 2 seconds), use smaller buffer to be more precise
        const isVeryEarly = start < 2.0;
        const buffer = isVeryEarly ? 0.2 : (durationMs > 300 ? 0.5 : 0.3); // Smaller buffer for early silences
        
        let expandedStart, expandedEnd;
        if (isBeforeFirstWord) {
          // For silences before first word, allow cutting from the start (but ensure we don't go negative)
          // Use smaller buffer for precision
          expandedStart = Math.max(0, start - buffer);
          expandedEnd = Math.min(firstSpeechWordStart, end + buffer); // Don't cut into first word
        } else if (isVeryEarly && allowEarlyCut) {
          // For very early silences that overlap with first word, be very precise
          // Cut only the silence portion, with minimal buffer
          expandedStart = Math.max(0, start - 0.1); // Very small buffer
          expandedEnd = Math.min(firstSpeechWordStart, end + 0.1); // Very small buffer, don't cut into first word
        } else {
          // For other silences, use normal expansion
          expandedStart = Math.max(0, start - buffer);
          expandedEnd = end + buffer;
        }
        
        // Skip very long cuts at the start (likely merged initial silences that are false positives)
        // But allow shorter cuts before first word (these are likely "um" sounds)
        if (expandedStart < 2.0 && (expandedEnd - expandedStart) > 5.0 && !isBeforeFirstWord) {
          continue;
        }
        
        // Only add cut if it's between segments, before first word, or if it's a significant silence
        // For the very beginning (first 2 seconds), also allow very short silences (>=30ms) to catch quick "um" sounds
        // ALSO: For very early brief silences (first 0.5s, 20-150ms), these might be untranscribed filler words like "like"
        // EXTENDED: For the first 1 second, catch even shorter silences (15-200ms) to catch untranscribed "like" and "um" sounds
        const allowVeryShortEarly = (start < 2.0 && durationMs >= veryEarlyMinSilenceMs);
        const isVeryEarlyBriefFiller = (start < 0.5 && durationMs >= 20 && durationMs < 150);
        const isFirstSecondBriefFiller = (start < 1.0 && durationMs >= 15 && durationMs < 200);
        if (isBetweenSegments || isBeforeFirstWord || durationMs >= 200 || allowVeryShortEarly || isVeryEarlyBriefFiller || isFirstSecondBriefFiller) {
          cuts.push({ 
            start: expandedStart, 
            end: expandedEnd, 
            reason: `silence_${Math.round(durationMs)}ms` 
          });
        }
      }
    }
    
  } catch (err) {
    // If audio silence detection fails, fall back to transcript-based detection
    // Error is handled silently - transcript-based detection will be used instead
  }
  
  return cuts;
}

/**
 * Detect low-volume filler sounds (like "um") using audio energy analysis
 * Uses FFmpeg's silencedetect with very aggressive settings to catch brief low-volume "um" sounds
 * This is more reliable than astats parsing and catches sounds that are audible but very quiet
 */
export async function detectLowVolumeFillerSounds(audioPath, config, transcriptData = null) {
  const cuts = [];
  try {
    const cp = await import('child_process');
    const { spawnSync } = cp;
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    
    // Use a SECOND pass of silencedetect with even MORE aggressive settings
    // This catches very brief, low-volume "um" sounds that the first pass might miss
    // noise=-55dB (extremely quiet) and d=0.03s (very short, 30ms) to catch brief "um" sounds
    const args = [
      '-i', audioPath,
      '-af', `silencedetect=noise=-55dB:d=0.03`,
      '-f', 'null',
      '-'
    ];
    
    const result = spawnSync(ffmpegPath, args, { 
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    });
    
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
    
    // Build word timestamps map to avoid cutting within speech
    const wordTimestamps = [];
    if (transcriptData?.segments) {
      for (const seg of transcriptData.segments) {
        if (seg.words && Array.isArray(seg.words)) {
          for (const word of seg.words) {
            wordTimestamps.push({
              start: parseFloat(word.start || 0),
              end: parseFloat(word.end || 0),
              word: word.word || word.text || ''
            });
          }
        }
      }
    }
    
    const firstSpeechWordStart = transcriptData?.segments?.[0]?.words?.[0]?.start || 0;
    
    // For the very beginning (first 2 seconds), catch even shorter silences (20ms)
    // These are likely brief "um" sounds
    const veryEarlyMinSilenceMs = 20; // 20ms for very early sounds
    
    for (let i = 0; i < starts.length && i < ends.length; i++) {
      const start = starts[i];
      const end = ends[i].end;
      const durationMs = (end - start) * 1000;
      
      // For the very beginning, catch silences as short as 20ms
      const effectiveMinSilence = (start < 2.0) ? veryEarlyMinSilenceMs : 30;
      
      if (durationMs >= effectiveMinSilence) {
        // Check if this silence overlaps with any transcribed words
        let overlapsWithWords = false;
        let allowEarlyCut = false;
        const isAtVeryStart = start < 0.3; // Silence starts within first 300ms
        const isShortSilence = durationMs < 200; // Silence is less than 200ms
        
        for (const word of wordTimestamps) {
          if (start < word.end && end > word.start) {
            // Special case: if silence is at very start and short, and it's the first word,
            // allow cutting it (these are likely untranscribed "um" sounds before actual speech)
            if (isAtVeryStart && isShortSilence && word.start === firstSpeechWordStart) {
              const wordDuration = word.end - word.start;
              // Allow if word is long enough (>0.5s) and silence ends before 80% of the word
              // This is more lenient to catch early "um" sounds
              if (wordDuration > 0.5 && end < word.start + (wordDuration * 0.8)) {
                allowEarlyCut = true;
                break; // Skip this word check, allow the cut
              }
            }
            overlapsWithWords = true;
            break;
          }
        }
        
        // For very early silences (first 0.3s), be more lenient - allow cutting even if they overlap
        // These are almost certainly untranscribed "um" sounds
        if (isAtVeryStart && isShortSilence && durationMs >= 20) {
          allowEarlyCut = true;
        }
        
        // EXTRA AGGRESSIVE: For the very first 0.5 seconds, allow cutting ANY short silence (>=20ms)
        // even if it overlaps with the first word - these are definitely untranscribed "um" sounds
        // BUT: Only if the silence is very short (<200ms) and starts very early (<0.2s)
        // OR if it ends early enough in the word (<50% of word duration, more lenient for very early starts)
        const isInFirstHalfSecond = start < 0.5;
        if (isInFirstHalfSecond && durationMs >= 20 && durationMs < 200) {
          // Check if silence starts very early (<0.2s) - these are almost certainly "um" sounds
          const startsVeryEarly = start < 0.2;
          if (startsVeryEarly) {
            // If it starts very early (<0.2s), allow it even if it extends into the word
            // But limit to 50% of word duration to be safe (more lenient for very early starts)
            for (const word of wordTimestamps) {
              if (word.start === firstSpeechWordStart) {
                const wordDuration = word.end - word.start;
                const maxSafeEnd = word.start + (wordDuration * 0.5); // 50% threshold for very early starts
                // Allow if silence ends before 50% of word, or if it's very short (<100ms)
                if (end < maxSafeEnd || durationMs < 100) {
                  allowEarlyCut = true;
                  break;
                }
              }
            }
          } else {
            // If it doesn't start very early, be more conservative (30% threshold)
            for (const word of wordTimestamps) {
              if (word.start === firstSpeechWordStart) {
                const wordDuration = word.end - word.start;
                if (end < word.start + (wordDuration * 0.3)) {
                  allowEarlyCut = true;
                  break;
                }
              }
            }
          }
        }
        
        // Skip silences that overlap with transcribed words (unless it's the special case above)
        if (overlapsWithWords && !allowEarlyCut) {
          continue;
        }
        
        // Check if silence is BEFORE the first word (these are likely untranscribed "um" sounds)
        const isBeforeFirstWord = end < firstSpeechWordStart;
        const isVeryEarly = start < 2.0;
        
        // Use very small buffer for early silences to be precise
        // For silences that overlap with first word but are allowed, use minimal buffer
        const buffer = (isVeryEarly && allowEarlyCut) ? 0.1 : (isVeryEarly ? 0.15 : 0.2);
        let expandedStart = Math.max(0, start - buffer);
        let expandedEnd;
        
        if (isBeforeFirstWord) {
          expandedEnd = Math.min(firstSpeechWordStart, end + buffer);
        } else if (allowEarlyCut) {
          // For early cuts that overlap with first word, be very precise
          // Don't cut beyond the silence end + small buffer, and don't cut into the word
          // But for the very first 0.5s, allow cutting up to the silence end + small buffer
          if (isInFirstHalfSecond) {
            expandedEnd = end + 0.1; // Small buffer, but don't limit to firstSpeechWordStart
          } else {
            expandedEnd = Math.min(firstSpeechWordStart, end + 0.1);
          }
        } else {
          expandedEnd = end + buffer;
        }
        
        // Only add cut if it's before first word, or in the very early part (first 2 seconds), or allowed early cut
        // ALSO: For silences in the first 0.5 seconds that are very short (20-150ms), these are likely untranscribed filler words
        // like "um", "uh", or brief "like" sounds that Whisper missed
        const isVeryEarlyBrief = start < 0.5 && durationMs >= 20 && durationMs < 150;
        if (isBeforeFirstWord || (isVeryEarly && durationMs >= 20) || allowEarlyCut || isVeryEarlyBrief) {
          cuts.push({
            start: expandedStart,
            end: expandedEnd,
            reason: `low_volume_filler_${Math.round(durationMs)}ms`
          });
        }
      }
    }
    
  } catch (err) {
    // If volume analysis fails, continue without it
    // Error is handled silently - silence detection will still work
  }
  
  return cuts;
}

export async function planCuts(transcriptData, userConfig, audioPath = null, logger = null) {
  const config = { ...getDefaultConfig(), ...(userConfig || {}) };
  
  // Try to detect silence from audio if audio path is provided
  let silences = [];
  if (audioPath) {
    silences = await detectSilenceFromAudio(audioPath, config, transcriptData);
    
    // Also detect low-volume filler sounds (like "um") using energy analysis
    // This catches sounds that aren't complete silences but are low-energy filler sounds
    const lowVolumeCuts = await detectLowVolumeFillerSounds(audioPath, config, transcriptData);
    silences = [...silences, ...lowVolumeCuts];
  }
  
  // Also use transcript-based silence detection to catch gaps between segments
  const transcriptSilences = detectSilence(transcriptData.segments || [], config);
  
  // Combine all silence detection methods
  silences = [...silences, ...transcriptSilences];
  
  const fillers = detectFillerWords(transcriptData.segments || [], config);
  
  // IMPROVEMENT: Log filler word detection results for debugging
  if (logger) {
    // Map detected fillers to actual word positions for detailed tracking
    const fillerDetails = fillers.map(f => {
      const fillerWordName = f.reason?.replace('filler_word_', '').split('+')[0].split('_')[0];
      // Find the actual word in transcript to get precise position
      let actualWordTime = null;
      if (transcriptData?.segments) {
        for (const seg of transcriptData.segments) {
          if (seg.words && Array.isArray(seg.words)) {
            for (const word of seg.words) {
              const wordText = (word.word || word.text || '').toLowerCase().replace(/[^\p{L}\p{N}'-]+/gu, '');
              if (wordText === fillerWordName) {
                const wordStart = parseFloat(word.start || 0);
                // Check if this word is within the cut range
                if (wordStart >= f.start - 0.5 && wordStart <= f.end + 0.5) {
                  actualWordTime = wordStart;
                  break;
                }
              }
            }
            if (actualWordTime !== null) break;
          }
        }
      }
      return {
        start: f.start.toFixed(2),
        end: f.end.toFixed(2),
        duration: (f.end - f.start).toFixed(2),
        reason: f.reason,
        word: fillerWordName,
        actualWordTime: actualWordTime !== null ? actualWordTime.toFixed(2) : 'unknown'
      };
    });
    
    logger.info('Filler word detection', {
      fillerCutsCount: fillers.length,
      fillerWordsDetected: fillers.map(f => f.fillerWord || f.reason?.replace('filler_word_', '')).filter(Boolean),
      fillerDetails: fillerDetails
    });
  }
  
  const merged = mergeCutRegions([...silences, ...fillers], config.mergeThresholdMs);
  
  // IMPROVEMENT: Log merged results to see if fillers are preserved
  if (logger) {
    const mergedFillers = merged.filter(m => m.reason?.includes('filler_word'));
    // Track which original fillers are covered by merged cuts
    const fillerCoverage = fillers.map(f => {
      const coveredBy = merged.filter(m => 
        m.start <= f.start + 0.1 && m.end >= f.end - 0.1 && m.reason?.includes('filler_word')
      );
      return {
        original: `${f.start.toFixed(2)}s-${f.end.toFixed(2)}s (${f.reason})`,
        covered: coveredBy.length > 0 ? `${coveredBy[0].start.toFixed(2)}s-${coveredBy[0].end.toFixed(2)}s` : 'NOT COVERED',
        mergedReason: coveredBy.length > 0 ? coveredBy[0].reason : null
      };
    });
    
    logger.info('After merging cut regions', {
      totalSilences: silences.length,
      totalFillers: fillers.length,
      totalMerged: merged.length,
      fillerCutsPreserved: mergedFillers.length,
      fillerCoverage: fillerCoverage,
      sampleMergedFillers: mergedFillers.slice(0, 10).map(f => ({
        start: f.start.toFixed(2),
        end: f.end.toFixed(2),
        reason: f.reason
      }))
    });
  }
  
  const filtered = filterShortCuts(merged, config.minCutDurationSec);
  
  // IMPROVEMENT: Log filtered results
  if (logger) {
    const filteredFillers = filtered.filter(f => f.reason?.includes('filler_word'));
    // Track which merged fillers were filtered out
    const mergedFillers = merged.filter(m => m.reason?.includes('filler_word'));
    const filteredOut = mergedFillers.filter(m => !filtered.includes(m));
    
    logger.info('After filtering short cuts', {
      totalAfterFilter: filtered.length,
      fillerCutsRemaining: filteredFillers.length,
      filteredOutFillers: filteredOut.map(f => ({
        start: f.start.toFixed(2),
        end: f.end.toFixed(2),
        duration: (f.end - f.start).toFixed(2),
        reason: f.reason,
        whyFiltered: `duration ${(f.end - f.start).toFixed(2)}s < minCutDurationSec ${config.minCutDurationSec}`
      }))
    });
  }
  
  // FINAL PROTECTION: Remove any cuts that overlap with transcribed non-filler words
  // This ensures we NEVER cut actual speech content, only filler words and silences
  const protectedCuts = filterCutsOverlappingWords(filtered, transcriptData, logger);
  
  if (logger) {
    const removedCount = filtered.length - protectedCuts.length;
    const filteredFillers = filtered.filter(f => f.reason?.includes('filler_word'));
    const protectedFillers = protectedCuts.filter(f => f.reason?.includes('filler_word'));
    const removedFillers = filteredFillers.filter(f => !protectedCuts.includes(f));
    
    if (removedCount > 0 || removedFillers.length > 0) {
      logger.info('Word protection filter', {
        cutsBeforeProtection: filtered.length,
        cutsAfterProtection: protectedCuts.length,
        removedCuts: removedCount,
        fillerCutsBefore: filteredFillers.length,
        fillerCutsAfter: protectedFillers.length,
        removedFillerCuts: removedFillers.map(f => ({
          start: f.start.toFixed(2),
          end: f.end.toFixed(2),
          reason: f.reason
        })),
        note: 'Removed cuts that would overlap with transcribed words'
      });
    }
  }
  
  // IMPROVEMENT: Log final cut plan generation
  if (logger) {
    const finalFillers = protectedCuts.filter(f => f.reason?.includes('filler_word'));
    logger.info('Before generateCutPlan', {
      protectedCutsCount: protectedCuts.length,
      protectedFillerCuts: finalFillers.length,
      protectedFillerCutsDetails: finalFillers.map(f => ({
        start: f.start.toFixed(2),
        end: f.end.toFixed(2),
        reason: f.reason
      }))
    });
  }
  
  return generateCutPlan(transcriptData, protectedCuts, config, logger);
}