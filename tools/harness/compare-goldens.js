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
    
    // For nested objects, check that expected fields are present and match
    if (typeof expectedValue === 'object' && expectedValue !== null && !Array.isArray(expectedValue)) {
      if (typeof actualValue !== 'object' || actualValue === null) {
        failures.push(`manifest.${key}: expected object, got ${typeof actualValue}`);
        continue;
      }
      
      // Check each field in the expected object
      for (const [nestedKey, nestedExpectedValue] of Object.entries(expectedValue)) {
        if (actualValue[nestedKey] !== nestedExpectedValue) {
          failures.push(`manifest.${key}.${nestedKey}: expected ${JSON.stringify(nestedExpectedValue)}, got ${JSON.stringify(actualValue[nestedKey])}`);
        }
      }
    }
    // For arrays, do a more sophisticated comparison
    else if (Array.isArray(expectedValue)) {
      if (!Array.isArray(actualValue)) {
        failures.push(`manifest.${key}: expected array, got ${typeof actualValue}`);
        continue;
      }
      
      // For each expected item, find a matching actual item
      for (let i = 0; i < expectedValue.length; i++) {
        const expectedItem = expectedValue[i];
        const actualItem = actualValue[i];
        
        if (typeof expectedItem === 'object' && expectedItem !== null) {
          // Check that expected fields are present in the actual item
          for (const [itemKey, itemExpectedValue] of Object.entries(expectedItem)) {
            if (actualItem[itemKey] !== itemExpectedValue) {
              failures.push(`manifest.${key}[${i}].${itemKey}: expected ${JSON.stringify(itemExpectedValue)}, got ${JSON.stringify(actualItem[itemKey])}`);
            }
          }
        } else if (actualItem !== expectedItem) {
          failures.push(`manifest.${key}[${i}]: expected ${JSON.stringify(expectedItem)}, got ${JSON.stringify(actualItem)}`);
        }
      }
    }
    // For primitive values, direct comparison
    else if (actualValue !== expectedValue) {
      failures.push(`manifest.${key}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`);
    }
  }
  
  return failures;
}

function compareTranscriptPreview(actualPath, goldenPath) {
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
