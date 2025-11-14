#!/usr/bin/env node
// Test idempotency for subtitles-post-edit handler
import { keyFor, pathFor, writeFileAtKey, ensureDirForFile, readFileAtKey } from '../../dist/storage.js';
import { saveManifest, loadManifest } from '../../dist/manifest.js';
import { readFileSync, copyFileSync, existsSync } from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import { handler } from './handler.js';

const TEST_ENV = 'dev';
const TEST_TENANT = 't-local';
const TEST_JOB = uuidv4();

async function setupTestFiles() {
  // Copy transcript
  const transcriptSource = 'podcast-automation/test-assets/transcripts/sample-short.json';
  const transcriptKey = keyFor(TEST_ENV, TEST_TENANT, TEST_JOB, 'transcripts', 'transcript.json');
  const transcriptPath = pathFor(transcriptKey);
  ensureDirForFile(transcriptPath);
  copyFileSync(transcriptSource, transcriptPath);
  
  // Copy cut plan
  const planSource = 'podcast-automation/test-assets/plans/sample-short-cut-plan.json';
  const planKey = keyFor(TEST_ENV, TEST_TENANT, TEST_JOB, 'plan', 'cut_plan.json');
  const planPath = pathFor(planKey);
  ensureDirForFile(planPath);
  copyFileSync(planSource, planPath);
  
  // Create dummy render
  const renderKey = keyFor(TEST_ENV, TEST_TENANT, TEST_JOB, 'renders', 'base_cuts.mp4');
  writeFileAtKey(renderKey, 'dummy render');
  
  // Create manifest
  const manifest = {
    schemaVersion: '1.0.0',
    env: TEST_ENV,
    tenantId: TEST_TENANT,
    jobId: TEST_JOB,
    status: 'processing',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  saveManifest(TEST_ENV, TEST_TENANT, TEST_JOB, manifest);
  
  return { transcriptKey, planKey, renderKey };
}

async function testIdempotency() {
  console.log('[TEST] Testing idempotency (running handler twice)...\n');
  
  const { transcriptKey, planKey, renderKey } = await setupTestFiles();
  
  const event = {
    env: TEST_ENV,
    tenantId: TEST_TENANT,
    jobId: TEST_JOB,
    transcriptKey,
    planKey,
    renderKey
  };
  
  const context = { awsRequestId: `test-${Date.now()}` };
  
  // First run
  console.log('[TEST] First run...');
  const result1 = await handler(event, context);
  console.log(`[TEST] ✓ First run completed: ${result1.segments} segments, ${result1.wordCount} words\n`);
  
  // Get first run outputs
  const srtKey = keyFor(TEST_ENV, TEST_TENANT, TEST_JOB, 'subtitles', 'final.srt');
  const vttKey = keyFor(TEST_ENV, TEST_TENANT, TEST_JOB, 'subtitles', 'final.vtt');
  const srtContent1 = readFileSync(pathFor(srtKey), 'utf-8');
  const vttContent1 = readFileSync(pathFor(vttKey), 'utf-8');
  const manifest1 = loadManifest(TEST_ENV, TEST_TENANT, TEST_JOB);
  const subtitleCount1 = manifest1.subtitles?.length || 0;
  
  // Wait a moment to ensure timestamps differ
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Second run
  console.log('[TEST] Second run (should overwrite)...');
  const result2 = await handler(event, { awsRequestId: `test-${Date.now()}` });
  console.log(`[TEST] ✓ Second run completed: ${result2.segments} segments, ${result2.wordCount} words\n`);
  
  // Get second run outputs
  const srtContent2 = readFileSync(pathFor(srtKey), 'utf-8');
  const vttContent2 = readFileSync(pathFor(vttKey), 'utf-8');
  const manifest2 = loadManifest(TEST_ENV, TEST_TENANT, TEST_JOB);
  const subtitleCount2 = manifest2.subtitles?.length || 0;
  
  // Verify results are identical
  console.log('[TEST] Verifying idempotency...');
  
  let allPassed = true;
  
  // Check SRT content is identical
  if (srtContent1 === srtContent2) {
    console.log('[TEST] ✓ SRT content is identical');
  } else {
    console.log('[TEST] ✗ SRT content differs');
    allPassed = false;
  }
  
  // Check VTT content is identical
  if (vttContent1 === vttContent2) {
    console.log('[TEST] ✓ VTT content is identical');
  } else {
    console.log('[TEST] ✗ VTT content differs');
    allPassed = false;
  }
  
  // Check subtitle count (should be 2 - one SRT, one VTT, not duplicated)
  if (subtitleCount2 === 2) {
    console.log(`[TEST] ✓ Manifest has correct subtitle count (${subtitleCount2}) - not duplicated`);
  } else {
    console.log(`[TEST] ✗ Manifest subtitle count incorrect: ${subtitleCount2} (expected 2)`);
    allPassed = false;
  }
  
  // Check results are identical
  if (result1.segments === result2.segments && 
      result1.wordCount === result2.wordCount &&
      result1.originalDuration === result2.originalDuration &&
      result1.finalDuration === result2.finalDuration) {
    console.log('[TEST] ✓ Handler results are identical');
  } else {
    console.log('[TEST] ✗ Handler results differ');
    allPassed = false;
  }
  
  // Check that old entries were removed (idempotency)
  const finalSubtitleTypes = manifest2.subtitles?.map(s => s.type).filter(t => t === 'final') || [];
  if (finalSubtitleTypes.length === 2) {
    console.log('[TEST] ✓ Only 2 final subtitle entries (old ones removed)');
  } else {
    console.log(`[TEST] ✗ Wrong number of final entries: ${finalSubtitleTypes.length}`);
    allPassed = false;
  }
  
  console.log(`\n[TEST] Idempotency test: ${allPassed ? '✓ PASSED' : '✗ FAILED'}`);
  return allPassed;
}

testIdempotency().then(success => {
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('[TEST] Fatal error:', err);
  process.exit(1);
});





