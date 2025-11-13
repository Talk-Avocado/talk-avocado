// Test script to analyze why filler words are lost during merging
import { detectFillerWords, detectSilence, mergeCutRegions, getDefaultConfig } from './planner-logic.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workspaceRoot = join(__dirname, '../../..');

const transcriptPath = join(workspaceRoot, 'storage/dev/t-test/872d6765-2d60-4806-aa8f-b9df56f74c03/transcripts/transcript.json');

const transcript = JSON.parse(readFileSync(transcriptPath, 'utf-8'));
const config = getDefaultConfig();

console.log('Analyzing filler word loss during merging...\n');

// Get initial cuts
const silences = detectSilence(transcript.segments || [], config);
const fillers = detectFillerWords(transcript.segments || [], config);

console.log(`Initial counts:`);
console.log(`  Silences: ${silences.length}`);
console.log(`  Fillers: ${fillers.length}`);
console.log(`  Total: ${silences.length + fillers.length}\n`);

// Merge them
const merged = mergeCutRegions([...silences, ...fillers], config.mergeThresholdMs);

console.log(`After merging:`);
console.log(`  Total merged: ${merged.length}`);
console.log(`  Expected reduction: ${(silences.length + fillers.length) - merged.length} cuts merged\n`);

// Analyze what happened to filler words
const mergedFillers = merged.filter(m => m.reason?.includes('filler_word'));
const mergedSilences = merged.filter(m => m.reason?.includes('silence') && !m.reason?.includes('filler_word'));
const mergedBoth = merged.filter(m => m.reason?.includes('filler_word') && m.reason?.includes('silence'));

console.log(`Breakdown of merged cuts:`);
console.log(`  Cuts with filler_word only: ${mergedFillers.length}`);
console.log(`  Cuts with silence only: ${mergedSilences.length}`);
console.log(`  Cuts with both filler_word + silence: ${mergedBoth.length}`);
console.log(`  Total with filler_word: ${mergedFillers.length + mergedBoth.length}\n`);

// Find filler words that were lost
const fillerStarts = new Set(fillers.map(f => f.start.toFixed(2)));
const preservedFillerStarts = new Set(
  [...mergedFillers, ...mergedBoth].flatMap(m => {
    // Try to find which original filler cuts contributed to this merged cut
    const start = parseFloat(m.start);
    const end = parseFloat(m.end);
    return fillers
      .filter(f => f.start >= start - 0.5 && f.end <= end + 0.5)
      .map(f => f.start.toFixed(2));
  })
);

const lostFillers = fillers.filter(f => {
  const startKey = f.start.toFixed(2);
  return !preservedFillerStarts.has(startKey);
});

console.log(`Lost filler words: ${lostFillers.length}\n`);

if (lostFillers.length > 0) {
  console.log('First 20 lost filler words:');
  lostFillers.slice(0, 20).forEach((f, i) => {
    // Find if there's a merged cut that overlaps
    const overlapping = merged.find(m => {
      const mStart = parseFloat(m.start);
      const mEnd = parseFloat(m.end);
      return f.start >= mStart - 0.1 && f.end <= mEnd + 0.1;
    });
    
    console.log(`  ${i + 1}. ${f.reason}: ${f.start.toFixed(2)}s - ${f.end.toFixed(2)}s (${(f.end - f.start).toFixed(2)}s)`);
    if (overlapping) {
      console.log(`      → Merged into: ${overlapping.reason} (${overlapping.start.toFixed(2)}s - ${overlapping.end.toFixed(2)}s)`);
    } else {
      console.log(`      → No overlapping merged cut found!`);
    }
  });
  console.log();
}

// Analyze merge patterns
console.log('=== Merge Pattern Analysis ===\n');

// Check how many fillers merged with each other
let fillersMergedWithFillers = 0;
let fillersMergedWithSilences = 0;
let fillersStandalone = 0;

for (const m of [...mergedFillers, ...mergedBoth]) {
  const reason = m.reason;
  const hasSilence = reason.includes('silence');
  const fillerCount = (reason.match(/filler_word_/g) || []).length;
  
  if (hasSilence) {
    fillersMergedWithSilences++;
  } else if (fillerCount > 1) {
    fillersMergedWithFillers++;
  } else {
    fillersStandalone++;
  }
}

console.log(`Filler word merge patterns:`);
console.log(`  Standalone (not merged): ${fillersStandalone}`);
console.log(`  Merged with other fillers: ${fillersMergedWithFillers}`);
console.log(`  Merged with silences: ${fillersMergedWithSilences}`);
console.log(`  Total preserved: ${fillersStandalone + fillersMergedWithFillers + fillersMergedWithSilences}\n`);

// Check if lost fillers are too close to silences
console.log('=== Why Fillers Were Lost ===\n');
const lostAnalysis = lostFillers.slice(0, 10).map(f => {
  // Find nearby silences
  const nearbySilences = silences.filter(s => {
    const gap = Math.abs((f.start + f.end) / 2 - (s.start + s.end) / 2) * 1000;
    return gap <= config.mergeThresholdMs;
  });
  
  // Find nearby fillers
  const nearbyFillers = fillers.filter(other => {
    if (other.start === f.start && other.end === f.end) return false; // Same cut
    const gap = Math.abs((f.start + f.end) / 2 - (other.start + other.end) / 2) * 1000;
    return gap <= config.mergeThresholdMs;
  });
  
  return {
    filler: f,
    nearbySilences: nearbySilences.length,
    nearbyFillers: nearbyFillers.length,
    mergedInto: merged.find(m => {
      const mStart = parseFloat(m.start);
      const mEnd = parseFloat(m.end);
      return f.start >= mStart - 0.1 && f.end <= mEnd + 0.1;
    })
  };
});

lostAnalysis.forEach((analysis, i) => {
  console.log(`${i + 1}. ${analysis.filler.reason} at ${analysis.filler.start.toFixed(2)}s:`);
  console.log(`   Nearby silences: ${analysis.nearbySilences}`);
  console.log(`   Nearby fillers: ${analysis.nearbyFillers}`);
  if (analysis.mergedInto) {
    console.log(`   → Merged into: ${analysis.mergedInto.reason}`);
  } else {
    console.log(`   → Not found in merged cuts (possibly filtered out)`);
  }
});


