// tools/harness/compare-goldens.js
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function loadJSON(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function compareWithTolerance(actual, expected, tolerance, strict) {
  if (strict || tolerance === undefined) {
    return actual === expected;
  }
  return Math.abs(actual - expected) <= tolerance;
}

function compareMetrics(actualManifest, goldenMetrics, strict) {
  const failures = [];

  // Audio duration
  if (goldenMetrics.audio) {
    const actual = actualManifest.audio?.durationSec;
    const expected = goldenMetrics.audio.durationSec;
    const tolerance = strict ? 0 : (goldenMetrics.audio._tolerance || parseFloat(process.env.GOLDEN_TOLERANCE_SEC || '0.1'));
    if (!compareWithTolerance(actual, expected, tolerance, strict)) {
      failures.push(`audio.durationSec: expected ${expected} (±${tolerance}), got ${actual}`);
    }
  }

  // Transcript word count (derive from actual transcript file)
  if (goldenMetrics.transcript) {
    const actual = actualManifest.transcript?.wordCount || 0;
    const expected = goldenMetrics.transcript.wordCount;
    const tolerance = strict ? 0 : (goldenMetrics.transcript._tolerance || parseFloat(process.env.GOLDEN_TOLERANCE_WORDCOUNT || '5'));
    if (!compareWithTolerance(actual, expected, tolerance, strict)) {
      failures.push(`transcript.wordCount: expected ${expected} (±${tolerance}), got ${actual}`);
    }
  }

  // Plan cuts count
  if (goldenMetrics.plan) {
    const actual = actualManifest.plan?.totalCuts || 0;
    const expected = goldenMetrics.plan.cutsCount;
    const tolerance = strict ? 0 : (goldenMetrics.plan._exact ? 0 : 0);
    if (!compareWithTolerance(actual, expected, tolerance, strict)) {
      failures.push(`plan.cutsCount: expected ${expected} (±${tolerance}), got ${actual}`);
    }
  }

  // Render duration
  if (goldenMetrics.render) {
    const actual = actualManifest.renders?.[0]?.durationSec || 0;
    const expected = goldenMetrics.render.durationSec;
    const tolerance = strict ? 0 : (goldenMetrics.render._tolerance || parseFloat(process.env.GOLDEN_TOLERANCE_SEC || '0.1'));
    if (!compareWithTolerance(actual, expected, tolerance, strict)) {
      failures.push(`render.durationSec: expected ${expected} (±${tolerance}), got ${actual}`);
    }
  }

  return failures;
}

function compareManifestSubset(actual, golden) {
  const failures = [];
  
  for (const [key, expectedValue] of Object.entries(golden)) {
    // Skip jobId, timestamps
    if (['jobId', 'createdAt', 'updatedAt'].includes(key)) continue;
    
    const actualValue = actual[key];
    if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
      failures.push(`manifest.${key}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`);
    }
  }

  return failures;
}

function compareTranscriptPreview(actualPath, goldenPath, strict) {
  const failures = [];
  
  if (!existsSync(goldenPath)) {
    return failures; // No golden transcript to compare
  }
  
  const actualTranscriptPath = join(actualPath, 'transcripts', 'transcript.json');
  if (!existsSync(actualTranscriptPath)) {
    failures.push('transcript.preview: actual transcript not found');
    return failures;
  }
  
  try {
    const actualTranscript = JSON.parse(readFileSync(actualTranscriptPath, 'utf-8'));
    const goldenPreview = readFileSync(goldenPath, 'utf-8').trim();
    
    // Extract first 200 chars from actual transcript
    const actualText = actualTranscript.segments?.map(s => s.text).join(' ') || '';
    const actualPreview = actualText.substring(0, 200).trim();
    
    // Normalize whitespace for comparison
    const normalizedActual = actualPreview.replace(/\s+/g, ' ').trim();
    const normalizedGolden = goldenPreview.replace(/\s+/g, ' ').trim();
    
    if (normalizedActual !== normalizedGolden) {
      failures.push(`transcript.preview: expected "${normalizedGolden}", got "${normalizedActual}"`);
    }
  } catch (error) {
    failures.push(`transcript.preview: error comparing - ${error.message}`);
  }
  
  return failures;
}

async function compareGoldens({ actualPath, goldensPath, strict }) {
  console.log('[compare] Loading actuals and goldens...');

  const actualManifest = loadJSON(join(actualPath, 'manifest.json'));
  const goldenManifest = loadJSON(join(goldensPath, 'manifest.json'));
  const goldenMetrics = loadJSON(join(goldensPath, 'metrics.json'));

  if (!actualManifest) {
    console.error('[compare] Actual manifest not found');
    return false;
  }

  let allFailures = [];

  if (goldenMetrics) {
    const metricFailures = compareMetrics(actualManifest, goldenMetrics, strict);
    allFailures = allFailures.concat(metricFailures);
  }

  if (goldenManifest) {
    const manifestFailures = compareManifestSubset(actualManifest, goldenManifest);
    allFailures = allFailures.concat(manifestFailures);
  }

  // Compare transcript preview
  const transcriptFailures = compareTranscriptPreview(actualPath, join(goldensPath, 'transcript.preview.txt'), strict);
  allFailures = allFailures.concat(transcriptFailures);

  if (allFailures.length > 0) {
    console.error('[compare] Mismatches found:');
    allFailures.forEach(f => console.error(`  - ${f}`));
    return false;
  }

  console.log('[compare] All checks passed');
  return true;
}

export { compareGoldens };
