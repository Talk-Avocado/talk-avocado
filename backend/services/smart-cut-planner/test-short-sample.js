// Test filler word detection on short sample
import { planCuts, getDefaultConfig } from './planner-logic.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workspaceRoot = join(__dirname, '../../..');

// Use test transcript with fillers, or fall back to sample-short
const testFillerPath = join(__dirname, 'test-with-fillers.json');
const sampleShortPath = join(workspaceRoot, 'podcast-automation/test-assets/transcripts/sample-short.json');
const transcriptPath = existsSync(testFillerPath) ? testFillerPath : sampleShortPath;
const outputPath = join(workspaceRoot, 'storage/dev/t-test/test-sample-short-filler/plan/cut_plan.json');

console.log('Testing filler word detection on short sample...\n');

const transcript = JSON.parse(readFileSync(transcriptPath, 'utf-8'));
const config = getDefaultConfig();

console.log('Sample Info:');
console.log(`  Duration: ${transcript.segments?.[transcript.segments.length - 1]?.end || 0}s`);
console.log(`  Segments: ${transcript.segments?.length || 0}`);
console.log(`  Filler words configured: ${config.fillerWords.join(', ')}\n`);

// Create mock logger
const mockLogger = {
  info: (msg, data) => {
    console.log(`[INFO] ${msg}`);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
    console.log();
  }
};

// Run planning
console.log('=== Running Smart Cut Planner ===\n');
const cutPlan = await planCuts(transcript, null, null, mockLogger);

// Save output
const outputDir = join(outputPath, '..');
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}
writeFileSync(outputPath, JSON.stringify(cutPlan, null, 2));
console.log(`Cut plan saved to: ${outputPath}\n`);

// Analyze results
console.log('=== Results Analysis ===\n');

const allCuts = cutPlan.cuts.filter(c => c.type === 'cut');
const fillerCuts = allCuts.filter(c => c.reason?.includes('filler_word'));
const silenceCuts = allCuts.filter(c => c.reason?.includes('silence') && !c.reason?.includes('filler_word'));
const bothCuts = allCuts.filter(c => c.reason?.includes('filler_word') && c.reason?.includes('silence'));
const keepSegments = cutPlan.cuts.filter(c => c.type === 'keep');

console.log(`Total segments: ${cutPlan.cuts.length}`);
console.log(`  Keep segments: ${keepSegments.length}`);
console.log(`  Cut segments: ${allCuts.length}`);
console.log(`    Filler-only cuts: ${fillerCuts.length}`);
console.log(`    Silence-only cuts: ${silenceCuts.length}`);
console.log(`    Cuts with both filler + silence: ${bothCuts.length}\n`);

// Show filler word breakdown
if (fillerCuts.length > 0 || bothCuts.length > 0) {
  console.log('=== Filler Word Cuts Detected ===\n');
  
  const allFillerCuts = [...fillerCuts, ...bothCuts].sort((a, b) => 
    parseFloat(a.start) - parseFloat(b.start)
  );
  
  allFillerCuts.forEach((cut, i) => {
    const duration = (parseFloat(cut.end) - parseFloat(cut.start)).toFixed(2);
    console.log(`${i + 1}. ${cut.reason}`);
    console.log(`   Time: ${cut.start}s - ${cut.end}s (${duration}s)`);
    
    // Find matching transcript segment
    const cutStart = parseFloat(cut.start);
    const cutEnd = parseFloat(cut.end);
    const matchingSegments = transcript.segments.filter(seg => {
      const segStart = parseFloat(seg.start);
      const segEnd = parseFloat(seg.end);
      return (segStart >= cutStart - 1 && segStart <= cutEnd + 1) ||
             (segEnd >= cutStart - 1 && segEnd <= cutEnd + 1) ||
             (segStart <= cutStart && segEnd >= cutEnd);
    });
    
    if (matchingSegments.length > 0) {
      matchingSegments.forEach(seg => {
        console.log(`   Text: "${seg.text}"`);
      });
    }
    console.log();
  });
} else {
  console.log('⚠️  No filler word cuts detected in this sample.\n');
}

// Show silence cuts
if (silenceCuts.length > 0) {
  console.log(`=== Silence Cuts (${silenceCuts.length}) ===\n`);
  silenceCuts.slice(0, 5).forEach((cut, i) => {
    const duration = (parseFloat(cut.end) - parseFloat(cut.start)).toFixed(2);
    console.log(`${i + 1}. ${cut.reason}: ${cut.start}s - ${cut.end}s (${duration}s)`);
  });
  if (silenceCuts.length > 5) {
    console.log(`   ... and ${silenceCuts.length - 5} more\n`);
  } else {
    console.log();
  }
}

// Show summary
console.log('=== Summary ===');
console.log(`✅ Filler word detection: ${fillerCuts.length + bothCuts.length > 0 ? 'WORKING' : 'NO FILLERS FOUND'}`);
console.log(`   - ${fillerCuts.length} filler-only cuts`);
console.log(`   - ${bothCuts.length} cuts with filler + silence`);
console.log(`   - ${silenceCuts.length} silence-only cuts`);
console.log(`   - Total cuts: ${allCuts.length}`);
console.log(`   - Total keeps: ${keepSegments.length}`);

const totalDuration = parseFloat(cutPlan.cuts[cutPlan.cuts.length - 1]?.end || 0);
const cutDuration = allCuts.reduce((sum, c) => sum + (parseFloat(c.end) - parseFloat(c.start)), 0);
const keepDuration = totalDuration - cutDuration;

console.log(`\nDuration breakdown:`);
console.log(`   Total: ${totalDuration.toFixed(2)}s`);
console.log(`   Kept: ${keepDuration.toFixed(2)}s (${((keepDuration / totalDuration) * 100).toFixed(1)}%)`);
console.log(`   Cut: ${cutDuration.toFixed(2)}s (${((cutDuration / totalDuration) * 100).toFixed(1)}%)`);

console.log(`\n✅ Cut plan saved to: ${outputPath}`);

