#!/usr/bin/env node
// Test error paths for subtitles-post-edit handler
import { keyFor, pathFor, writeFileAtKey, ensureDirForFile } from '../../dist/storage.js';
import { saveManifest } from '../../dist/manifest.js';
import { readFileSync, copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import { handler } from './handler.js';

const TEST_ENV = 'dev';
const TEST_TENANT = 't-local';

async function testMissingTranscript() {
  console.log('\n[TEST] Testing: Missing transcript file...');
  const jobId = uuidv4();
  
  try {
    const manifest = {
      schemaVersion: '1.0.0',
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId,
      status: 'processing',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    saveManifest(TEST_ENV, TEST_TENANT, jobId, manifest);
    
    const event = {
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId,
      transcriptKey: keyFor(TEST_ENV, TEST_TENANT, jobId, 'transcripts', 'nonexistent.json'),
      planKey: keyFor(TEST_ENV, TEST_TENANT, jobId, 'plan', 'cut_plan.json'),
      renderKey: keyFor(TEST_ENV, TEST_TENANT, jobId, 'renders', 'base_cuts.mp4')
    };
    
    await handler(event, { awsRequestId: `test-${Date.now()}` });
    console.log('[TEST] ✗ Should have thrown error');
    return false;
  } catch (error) {
    if (error.type === 'INVALID_TRANSCRIPT') {
      console.log('[TEST] ✓ Correctly threw INVALID_TRANSCRIPT error');
      return true;
    }
    console.log(`[TEST] ✗ Wrong error type: ${error.type}`);
    return false;
  }
}

async function testMissingCutPlan() {
  console.log('\n[TEST] Testing: Missing cut plan file...');
  const jobId = uuidv4();
  
  try {
    // Setup transcript
    const transcriptSource = 'podcast-automation/test-assets/transcripts/sample-short.json';
    const transcriptKey = keyFor(TEST_ENV, TEST_TENANT, jobId, 'transcripts', 'transcript.json');
    const transcriptPath = pathFor(transcriptKey);
    ensureDirForFile(transcriptPath);
    copyFileSync(transcriptSource, transcriptPath);
    
    const manifest = {
      schemaVersion: '1.0.0',
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId,
      status: 'processing',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    saveManifest(TEST_ENV, TEST_TENANT, jobId, manifest);
    
    const event = {
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId,
      transcriptKey,
      planKey: keyFor(TEST_ENV, TEST_TENANT, jobId, 'plan', 'nonexistent.json'),
      renderKey: keyFor(TEST_ENV, TEST_TENANT, jobId, 'renders', 'base_cuts.mp4')
    };
    
    await handler(event, { awsRequestId: `test-${Date.now()}` });
    console.log('[TEST] ✗ Should have thrown error');
    return false;
  } catch (error) {
    if (error.type === 'INVALID_PLAN') {
      console.log('[TEST] ✓ Correctly threw INVALID_PLAN error');
      return true;
    }
    console.log(`[TEST] ✗ Wrong error type: ${error.type}`);
    return false;
  }
}

async function testMissingRender() {
  console.log('\n[TEST] Testing: Missing render file...');
  const jobId = uuidv4();
  
  try {
    // Setup transcript and plan
    const transcriptSource = 'podcast-automation/test-assets/transcripts/sample-short.json';
    const transcriptKey = keyFor(TEST_ENV, TEST_TENANT, jobId, 'transcripts', 'transcript.json');
    const transcriptPath = pathFor(transcriptKey);
    ensureDirForFile(transcriptPath);
    copyFileSync(transcriptSource, transcriptPath);
    
    const planSource = 'podcast-automation/test-assets/plans/sample-short-cut-plan.json';
    const planKey = keyFor(TEST_ENV, TEST_TENANT, jobId, 'plan', 'cut_plan.json');
    const planPath = pathFor(planKey);
    ensureDirForFile(planPath);
    copyFileSync(planSource, planPath);
    
    const manifest = {
      schemaVersion: '1.0.0',
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId,
      status: 'processing',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    saveManifest(TEST_ENV, TEST_TENANT, jobId, manifest);
    
    const event = {
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId,
      transcriptKey,
      planKey,
      renderKey: keyFor(TEST_ENV, TEST_TENANT, jobId, 'renders', 'nonexistent.mp4')
    };
    
    await handler(event, { awsRequestId: `test-${Date.now()}` });
    console.log('[TEST] ✗ Should have thrown error');
    return false;
  } catch (error) {
    if (error.type === 'INVALID_PLAN') {
      console.log('[TEST] ✓ Correctly threw INVALID_PLAN error for missing render');
      return true;
    }
    console.log(`[TEST] ✗ Wrong error type: ${error.type}`);
    return false;
  }
}

async function runErrorTests() {
  console.log('[TEST] Starting error path tests...');
  
  const results = await Promise.all([
    testMissingTranscript(),
    testMissingCutPlan(),
    testMissingRender()
  ]);
  
  const allPassed = results.every(r => r);
  console.log(`\n[TEST] Error path tests: ${allPassed ? '✓ ALL PASSED' : '✗ SOME FAILED'}`);
  return allPassed;
}

runErrorTests().then(success => {
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('[TEST] Fatal error:', err);
  process.exit(1);
});



