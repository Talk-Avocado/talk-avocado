// Detailed analysis of why 326 preserved vs 445 initial
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

const silences = detectSilence(transcript.segments || [], config);
const fillers = detectFillerWords(transcript.segments || [], config);
const merged = mergeCutRegions([...silences, ...fillers], config.mergeThresholdMs);

console.log('=== Detailed Merge Analysis ===\n');

console.log(`Initial State:`);
console.log(`  Filler cuts: ${fillers.length}`);
console.log(`  Silence cuts: ${silences.length}`);
console.log(`  Total cuts: ${fillers.length + silences.length}\n`);

console.log(`After Merging:`);
console.log(`  Total merged cuts: ${merged.length}`);
console.log(`  Reduction: ${(fillers.length + silences.length) - merged.length} cuts merged\n`);

// Categorize merged cuts
const fillerOnly = merged.filter(m => 
  m.reason?.startsWith('filler_word_') && !m.reason?.includes('silence')
);
const silenceOnly = merged.filter(m => 
  m.reason?.includes('silence') && !m.reason?.includes('filler_word')
);
const both = merged.filter(m => 
  m.reason?.includes('filler_word') && m.reason?.includes('silence')
);

console.log(`Categorization of Merged Cuts:`);
console.log(`  Filler-only cuts: ${fillerOnly.length}`);
console.log(`  Silence-only cuts: ${silenceOnly.length}`);
console.log(`  Cuts with both filler + silence: ${both.length}`);
console.log(`  Total with filler_word: ${fillerOnly.length + both.length}`);
console.log(`  Total with silence: ${silenceOnly.length + both.length}\n`);

// Count how many original fillers are represented
console.log(`=== Filler Word Representation ===\n`);

// For each merged cut with filler, count how many original fillers it represents
let fillersRepresented = 0;
const fillerRepresentation = [];

for (const m of [...fillerOnly, ...both]) {
  const mStart = parseFloat(m.start);
  const mEnd = parseFloat(m.end);
  
  // Find original fillers that overlap with this merged cut
  const overlappingFillers = fillers.filter(f => {
    // Check if filler overlaps with merged cut (with small tolerance)
    return (f.start >= mStart - 0.1 && f.start <= mEnd + 0.1) ||
           (f.end >= mStart - 0.1 && f.end <= mEnd + 0.1) ||
           (f.start <= mStart && f.end >= mEnd);
  });
  
  const fillerCount = (m.reason.match(/filler_word_/g) || []).length;
  fillersRepresented += overlappingFillers.length;
  
  fillerRepresentation.push({
    mergedCut: m,
    originalFillers: overlappingFillers.length,
    reasonFillerCount: fillerCount,
    discrepancy: overlappingFillers.length - fillerCount
  });
}

console.log(`Original fillers represented: ${fillersRepresented} / ${fillers.length}`);
console.log(`Missing: ${fillers.length - fillersRepresented}\n`);

// Find fillers that might not be represented
const allMergedRanges = [...fillerOnly, ...both].map(m => ({
  start: parseFloat(m.start),
  end: parseFloat(m.end)
}));

const unrepresentedFillers = fillers.filter(f => {
  return !allMergedRanges.some(range => {
    return (f.start >= range.start - 0.1 && f.start <= range.end + 0.1) ||
           (f.end >= range.start - 0.1 && f.end <= range.end + 0.1) ||
           (f.start <= range.start && f.end >= range.end);
  });
});

console.log(`Unrepresented fillers: ${unrepresentedFillers.length}\n`);

if (unrepresentedFillers.length > 0) {
  console.log('First 10 unrepresented fillers:');
  unrepresentedFillers.slice(0, 10).forEach((f, i) => {
    // Find nearest merged cut
    let nearest = null;
    let nearestDist = Infinity;
    for (const m of merged) {
      const mStart = parseFloat(m.start);
      const mEnd = parseFloat(m.end);
      const fMid = (f.start + f.end) / 2;
      const mMid = (mStart + mEnd) / 2;
      const dist = Math.abs(fMid - mMid);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = m;
      }
    }
    
    console.log(`  ${i + 1}. ${f.reason} at ${f.start.toFixed(2)}s - ${f.end.toFixed(2)}s`);
    if (nearest) {
      console.log(`     Nearest merged cut: ${nearest.reason} at ${nearest.start.toFixed(2)}s - ${nearest.end.toFixed(2)}s (${(nearestDist * 1000).toFixed(0)}ms away)`);
    }
  });
}

// Check for fillers that merged into silence-only cuts
console.log(`\n=== Fillers Merged into Silence-Only Cuts ===\n`);
const fillersInSilenceOnly = fillers.filter(f => {
  return silenceOnly.some(s => {
    const sStart = parseFloat(s.start);
    const sEnd = parseFloat(s.end);
    return f.start >= sStart - 0.1 && f.end <= sEnd + 0.1;
  });
});

console.log(`Fillers that merged into silence-only cuts: ${fillersInSilenceOnly.length}`);
if (fillersInSilenceOnly.length > 0) {
  console.log('\nThese fillers lost their identity because they merged with silences:');
  fillersInSilenceOnly.slice(0, 10).forEach((f, i) => {
    const mergedInto = silenceOnly.find(s => {
      const sStart = parseFloat(s.start);
      const sEnd = parseFloat(s.end);
      return f.start >= sStart - 0.1 && f.end <= sEnd + 0.1;
    });
    console.log(`  ${i + 1}. ${f.reason} at ${f.start.toFixed(2)}s → merged into ${mergedInto.reason}`);
  });
}




