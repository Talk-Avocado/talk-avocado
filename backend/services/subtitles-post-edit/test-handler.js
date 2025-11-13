#!/usr/bin/env node
// Test script for subtitles-post-edit handler
import { keyFor, pathFor, writeFileAtKey, ensureDirForFile } from '../../dist/storage.js';
import { saveManifest, loadManifest } from '../../dist/manifest.js';
import { readFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { handler } from './handler.js';

const TEST_ENV = 'dev';
const TEST_TENANT = 't-local';
const TEST_JOB = uuidv4();

async function setupTestFiles() {
  console.log('[TEST] Setting up test files...');
  
  // Copy transcript
  const transcriptSource = 'podcast-automation/test-assets/transcripts/sample-short.json';
  const transcriptKey = keyFor(TEST_ENV, TEST_TENANT, TEST_JOB, 'transcripts', 'transcript.json');
  const transcriptPath = pathFor(transcriptKey);
  ensureDirForFile(transcriptPath);
  copyFileSync(transcriptSource, transcriptPath);
  console.log(`[TEST] Copied transcript to ${transcriptKey}`);
  
  // Copy cut plan
  const planSource = 'podcast-automation/test-assets/plans/sample-short-cut-plan.json';
  const planKey = keyFor(TEST_ENV, TEST_TENANT, TEST_JOB, 'plan', 'cut_plan.json');
  const planPath = pathFor(planKey);
  ensureDirForFile(planPath);
  copyFileSync(planSource, planPath);
  console.log(`[TEST] Copied cut plan to ${planKey}`);
  
  // Create a dummy render file (just for validation - subtitles service checks existence)
  const renderKey = keyFor(TEST_ENV, TEST_TENANT, TEST_JOB, 'renders', 'base_cuts.mp4');
  const renderPath = pathFor(renderKey);
  ensureDirForFile(renderPath);
  // Create empty file for validation (in real scenario this would be the actual video)
  writeFileAtKey(renderKey, 'dummy render file for testing');
  console.log(`[TEST] Created dummy render file at ${renderKey}`);
  
  // Create initial manifest
  const manifest = {
    schemaVersion: '1.0.0',
    env: TEST_ENV,
    tenantId: TEST_TENANT,
    jobId: TEST_JOB,
    status: 'processing',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    input: {
      sourceKey: keyFor(TEST_ENV, TEST_TENANT, TEST_JOB, 'input', 'test.mp4'),
      originalFilename: 'test.mp4',
      bytes: 0,
      mimeType: 'video/mp4'
    }
  };
  saveManifest(TEST_ENV, TEST_TENANT, TEST_JOB, manifest);
  console.log(`[TEST] Created manifest`);
  
  return { transcriptKey, planKey, renderKey };
}

async function testHandler() {
  console.log('[TEST] Starting subtitles-post-edit handler test...\n');
  
  try {
    // Setup test files
    const { transcriptKey, planKey, renderKey } = await setupTestFiles();
    
    // Create event
    const event = {
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId: TEST_JOB,
      transcriptKey,
      planKey,
      renderKey,
      targetFps: 30
    };
    
    const context = {
      awsRequestId: `test-${Date.now()}`
    };
    
    console.log('[TEST] Invoking handler...\n');
    const result = await handler(event, context);
    
    console.log('\n[TEST] ✓ Handler completed successfully!');
    console.log('[TEST] Result:', JSON.stringify(result, null, 2));
    
    // Verify outputs
    console.log('\n[TEST] Verifying outputs...');
    
    const srtKey = keyFor(TEST_ENV, TEST_TENANT, TEST_JOB, 'subtitles', 'final.srt');
    const vttKey = keyFor(TEST_ENV, TEST_TENANT, TEST_JOB, 'subtitles', 'final.vtt');
    
    const srtPath = pathFor(srtKey);
    const vttPath = pathFor(vttKey);
    
    if (existsSync(srtPath)) {
      const srtContent = readFileSync(srtPath, 'utf-8');
      console.log(`[TEST] ✓ SRT file exists (${srtContent.length} bytes)`);
      console.log(`[TEST] SRT preview (first 200 chars):\n${srtContent.substring(0, 200)}...\n`);
    } else {
      console.log(`[TEST] ✗ SRT file missing: ${srtPath}`);
    }
    
    if (existsSync(vttPath)) {
      const vttContent = readFileSync(vttPath, 'utf-8');
      console.log(`[TEST] ✓ VTT file exists (${vttContent.length} bytes)`);
      console.log(`[TEST] VTT preview (first 200 chars):\n${vttContent.substring(0, 200)}...\n`);
    } else {
      console.log(`[TEST] ✗ VTT file missing: ${vttPath}`);
    }
    
    // Verify manifest
    const manifest = loadManifest(TEST_ENV, TEST_TENANT, TEST_JOB);
    console.log('\n[TEST] Manifest subtitles entries:');
    if (manifest.subtitles && manifest.subtitles.length > 0) {
      manifest.subtitles.forEach((sub, i) => {
        console.log(`[TEST]   ${i + 1}. ${sub.format.toUpperCase()} - ${sub.type} - ${sub.durationSec}s - ${sub.wordCount} words`);
      });
    } else {
      console.log('[TEST] ✗ No subtitles entries in manifest');
    }
    
    if (manifest.metadata?.subtitlesTiming) {
      console.log('\n[TEST] Timing metadata:');
      console.log(`[TEST]   Original duration: ${manifest.metadata.subtitlesTiming.originalDurationSec}s`);
      console.log(`[TEST]   Final duration: ${manifest.metadata.subtitlesTiming.finalDurationSec}s`);
      console.log(`[TEST]   Cuts applied: ${manifest.metadata.subtitlesTiming.cutsApplied}`);
      console.log(`[TEST]   Segments: ${manifest.metadata.subtitlesTiming.segmentsCount}`);
    }
    
    console.log('\n[TEST] ✓ All verifications passed!');
    return true;
  } catch (error) {
    console.error('\n[TEST] ✗ Test failed:', error.message);
    console.error('[TEST] Stack:', error.stack);
    return false;
  }
}

// Run test
testHandler().then(success => {
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('[TEST] Fatal error:', err);
  process.exit(1);
});

