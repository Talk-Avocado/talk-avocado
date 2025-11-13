// Test script to debug filler word detection
import { detectFillerWords, planCuts, getDefaultConfig } from './planner-logic.js';
import { readFileSync } from 'node:fs';

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workspaceRoot = join(__dirname, '../../..');

const transcriptPath = join(workspaceRoot, 'storage/dev/t-test/872d6765-2d60-4806-aa8f-b9df56f74c03/transcripts/transcript.json');
const cutPlanPath = join(workspaceRoot, 'storage/dev/t-test/872d6765-2d60-4806-aa8f-b9df56f74c03/plan/cut_plan.json');

console.log('Testing filler word detection improvements...\n');

const transcript = JSON.parse(readFileSync(transcriptPath, 'utf-8'));
const config = getDefaultConfig();

console.log('Configuration:');
console.log(`  Filler words: ${config.fillerWords.join(', ')}`);
console.log(`  Min cut duration: ${config.minCutDurationSec}s`);
console.log(`  Merge threshold: ${config.mergeThresholdMs}ms\n`);

// Test 1: Direct filler word detection
console.log('=== Test 1: Direct Filler Word Detection ===');
const fillers = detectFillerWords(transcript.segments, config);
console.log(`Found ${fillers.length} filler word cuts\n`);

if (fillers.length > 0) {
  console.log('First 20 filler word cuts:');
  fillers.slice(0, 20).forEach((f, i) => {
    console.log(`  ${i + 1}. ${f.reason}: ${f.start.toFixed(2)}s - ${f.end.toFixed(2)}s (${(f.end - f.start).toFixed(2)}s)`);
    if (f.fillerWord) {
      console.log(`      Filler word: ${f.fillerWord}`);
    }
  });
  console.log();
} else {
  console.log('⚠️  No filler words detected!\n');
}

// Test 2: Check specific segments with known filler words
console.log('=== Test 2: Checking Segments with Known Filler Words ===');
const knownFillerSegments = transcript.segments.filter(seg => {
  const text = (seg.text || '').toLowerCase();
  return config.fillerWords.some(fw => text.includes(fw));
});

console.log(`Found ${knownFillerSegments.length} segments containing filler words\n`);

if (knownFillerSegments.length > 0) {
  console.log('First 10 segments with filler words:');
  knownFillerSegments.slice(0, 10).forEach((seg, i) => {
    const fillersInSeg = fillers.filter(f => 
      f.start >= parseFloat(seg.start) - 2 && f.end <= parseFloat(seg.end) + 2
    );
    console.log(`  ${i + 1}. ${seg.start.toFixed(2)}s - ${seg.end.toFixed(2)}s: "${seg.text}"`);
    if (fillersInSeg.length > 0) {
      fillersInSeg.forEach(f => {
        console.log(`      ✓ Detected: ${f.reason} at ${f.start.toFixed(2)}s - ${f.end.toFixed(2)}s`);
      });
    } else {
      console.log(`      ✗ No filler cut detected for this segment`);
    }
  });
  console.log();
}

// Test 3: Full planning pipeline
console.log('=== Test 3: Full Planning Pipeline ===');
const mockLogger = {
  info: (msg, data) => {
    console.log(`[INFO] ${msg}:`, JSON.stringify(data, null, 2));
  }
};

const cutPlan = await planCuts(transcript, null, null, mockLogger);

// Check final cut plan for filler word reasons
const fillerCuts = cutPlan.cuts.filter(c => 
  c.type === 'cut' && c.reason?.includes('filler_word')
);

console.log(`\nFinal cut plan contains ${fillerCuts.length} cuts with filler_word reasons\n`);

if (fillerCuts.length > 0) {
  console.log('First 20 filler word cuts in final plan:');
  fillerCuts.slice(0, 20).forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.reason}: ${c.start}s - ${c.end}s`);
  });
  console.log();
} else {
  console.log('⚠️  No filler_word reasons found in final cut plan!\n');
  
  // Check if there are any cuts that might have merged with fillers
  const mergedCuts = cutPlan.cuts.filter(c => 
    c.type === 'cut' && c.reason?.includes('+')
  );
  console.log(`Found ${mergedCuts.length} cuts with merged reasons (might include fillers):`);
  mergedCuts.slice(0, 10).forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.reason}: ${c.start}s - ${c.end}s`);
  });
  console.log();
}

// Test 4: Compare with existing cut plan
console.log('=== Test 4: Comparison with Existing Cut Plan ===');
try {
  const existingPlan = JSON.parse(readFileSync(cutPlanPath, 'utf-8'));
  const existingFillerCuts = existingPlan.cuts.filter(c => 
    c.type === 'cut' && c.reason?.includes('filler_word')
  );
  
  console.log(`Existing cut plan has ${existingFillerCuts.length} filler_word cuts`);
  console.log(`New cut plan has ${fillerCuts.length} filler_word cuts`);
  
  if (fillerCuts.length > existingFillerCuts.length) {
    console.log(`✓ Improvement: ${fillerCuts.length - existingFillerCuts.length} more filler cuts detected!`);
  } else if (fillerCuts.length === existingFillerCuts.length && fillerCuts.length > 0) {
    console.log(`✓ Same number of filler cuts detected`);
  } else if (fillerCuts.length > 0) {
    console.log(`⚠️  Fewer filler cuts, but some are detected`);
  } else {
    console.log(`✗ Still no filler cuts detected`);
  }
} catch (e) {
  console.log('Could not load existing cut plan for comparison');
}

console.log('\n=== Test Complete ===');

