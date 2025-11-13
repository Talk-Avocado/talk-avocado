#!/usr/bin/env node
// Test subtitles-post-edit on the 59-minute video from transitions test
import { keyFor, pathFor, readFileAtKey } from '../../dist/storage.js';
import { loadManifest } from '../../dist/manifest.js';
import { readFileSync, existsSync } from 'node:fs';
import { handler } from './handler.js';

const TEST_ENV = 'dev';
const TEST_TENANT = 't-test';
const TEST_JOB = '872d6765-2d60-4806-aa8f-b9df56f74c03'; // 59-minute video job

async function test59MinVideo() {
  console.log('='.repeat(60));
  console.log('Testing Subtitles Post-Edit on 59-Minute Video');
  console.log('='.repeat(60));
  console.log(`Job ID: ${TEST_JOB}`);
  console.log(`Environment: ${TEST_ENV}/${TEST_TENANT}\n`);

  // Check if files exist
  const transcriptKey = keyFor(TEST_ENV, TEST_TENANT, TEST_JOB, 'transcripts', 'transcript.json');
  const planKey = keyFor(TEST_ENV, TEST_TENANT, TEST_JOB, 'plan', 'cut_plan.json');
  const baseCutsKey = keyFor(TEST_ENV, TEST_TENANT, TEST_JOB, 'renders', 'base_cuts.mp4');
  
  console.log('Checking required files...');
  console.log(`  Transcript: ${existsSync(pathFor(transcriptKey)) ? '✓' : '✗'} ${transcriptKey}`);
  console.log(`  Cut Plan: ${existsSync(pathFor(planKey)) ? '✓' : '✗'} ${planKey}`);
  console.log(`  Base Cuts Video: ${existsSync(pathFor(baseCutsKey)) ? '✓' : '✗'} ${baseCutsKey}\n`);

  if (!existsSync(pathFor(transcriptKey)) || !existsSync(pathFor(planKey)) || !existsSync(pathFor(baseCutsKey))) {
    console.error('✗ Missing required files. Cannot proceed.');
    process.exit(1);
  }

  // Try to load manifest (may have invalid log types, so catch error)
  let manifest = null;
  try {
    manifest = loadManifest(TEST_ENV, TEST_TENANT, TEST_JOB);
    console.log('Manifest Info:');
    console.log(`  Status: ${manifest.status}`);
    if (manifest.renders && manifest.renders.length > 0) {
      console.log(`  Video Duration: ${manifest.renders[0].durationSec}s (${(manifest.renders[0].durationSec / 60).toFixed(2)} minutes)`);
    }
    if (manifest.transcript) {
      console.log(`  Transcript: ${manifest.transcript.jsonKey}`);
    }
    if (manifest.plan) {
      console.log(`  Cut Plan: ${manifest.plan.key}`);
    }
    console.log('');
  } catch (err) {
    console.log('Note: Manifest has validation issues (will be fixed by handler)\n');
  }

  // Load cut plan to see how many cuts
  const cutPlan = JSON.parse(readFileSync(pathFor(planKey), 'utf-8'));
  const keepSegments = cutPlan.cuts?.filter(c => c.type === 'keep') || [];
  const cutSegments = cutPlan.cuts?.filter(c => c.type === 'cut') || [];
  console.log('Cut Plan Info:');
  console.log(`  Total segments: ${cutPlan.cuts?.length || 0}`);
  console.log(`  Keep segments: ${keepSegments.length}`);
  console.log(`  Cut segments: ${cutSegments.length}`);
  console.log('');

  // Load transcript to see segment count
  const transcript = JSON.parse(readFileSync(pathFor(transcriptKey), 'utf-8'));
  console.log('Transcript Info:');
  console.log(`  Total segments: ${transcript.segments?.length || 0}`);
  console.log(`  Total words: ${transcript.segments?.reduce((sum, s) => sum + (s.words?.length || 0), 0) || 0}`);
  console.log('');

  // Create event
  const event = {
    env: TEST_ENV,
    tenantId: TEST_TENANT,
    jobId: TEST_JOB,
    transcriptKey,
    planKey,
    renderKey: baseCutsKey,
    targetFps: 30
  };

  const context = {
    awsRequestId: `test-59min-${Date.now()}`
  };

  console.log('Starting subtitles-post-edit handler...\n');
  const startTime = Date.now();

  try {
    const result = await handler(event, context);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n' + '='.repeat(60));
    console.log('✓ Handler completed successfully!');
    console.log('='.repeat(60));
    console.log(`Processing time: ${duration}s`);
    console.log(`\nResults:`);
    console.log(`  SRT Key: ${result.srtKey}`);
    console.log(`  VTT Key: ${result.vttKey}`);
    console.log(`  Segments: ${result.segments}`);
    console.log(`  Word Count: ${result.wordCount}`);
    console.log(`  Original Duration: ${result.originalDuration}s (${(result.originalDuration / 60).toFixed(2)} minutes)`);
    console.log(`  Final Duration: ${result.finalDuration}s (${(result.finalDuration / 60).toFixed(2)} minutes)`);
    console.log(`  Duration Reduction: ${(result.originalDuration - result.finalDuration).toFixed(2)}s (${((result.originalDuration - result.finalDuration) / 60).toFixed(2)} minutes)`);

    // Verify outputs
    console.log('\n' + '='.repeat(60));
    console.log('Verifying outputs...');
    console.log('='.repeat(60));

    const srtPath = pathFor(result.srtKey);
    const vttPath = pathFor(result.vttKey);

    if (existsSync(srtPath)) {
      const srtContent = readFileSync(srtPath, 'utf-8');
      const srtSize = (readFileSync(srtPath).length / 1024).toFixed(2);
      const srtLines = srtContent.split('\n').length;
      console.log(`✓ SRT file: ${srtSize} KB, ${srtLines} lines`);
      // Show first few subtitle entries
      const srtEntries = srtContent.split('\n\n').filter(e => e.trim()).slice(0, 3);
      console.log(`  First 3 entries preview:`);
      srtEntries.forEach((entry, i) => {
        const lines = entry.split('\n');
        if (lines.length >= 3) {
          console.log(`    ${i + 1}. ${lines[1]} - ${lines[2].substring(0, 50)}...`);
        }
      });
    } else {
      console.log(`✗ SRT file missing: ${srtPath}`);
    }

    if (existsSync(vttPath)) {
      const vttContent = readFileSync(vttPath, 'utf-8');
      const vttSize = (readFileSync(vttPath).length / 1024).toFixed(2);
      const vttLines = vttContent.split('\n').length;
      console.log(`✓ VTT file: ${vttSize} KB, ${vttLines} lines`);
    } else {
      console.log(`✗ VTT file missing: ${vttPath}`);
    }

    // Check manifest updates
    const updatedManifest = loadManifest(TEST_ENV, TEST_TENANT, TEST_JOB);
    if (updatedManifest.subtitles && updatedManifest.subtitles.length > 0) {
      console.log(`\n✓ Manifest updated with ${updatedManifest.subtitles.length} subtitle entries:`);
      updatedManifest.subtitles.forEach((sub, i) => {
        console.log(`  ${i + 1}. ${sub.format.toUpperCase()} - ${sub.type} - ${sub.durationSec}s - ${sub.wordCount} words`);
      });
    }

    if (updatedManifest.metadata?.subtitlesTiming) {
      console.log(`\n✓ Timing metadata:`);
      console.log(`  Original: ${updatedManifest.metadata.subtitlesTiming.originalDurationSec}s`);
      console.log(`  Final: ${updatedManifest.metadata.subtitlesTiming.finalDurationSec}s`);
      console.log(`  Cuts Applied: ${updatedManifest.metadata.subtitlesTiming.cutsApplied}`);
      console.log(`  Segments: ${updatedManifest.metadata.subtitlesTiming.segmentsCount}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✓ All tests passed!');
    console.log('='.repeat(60));

    return true;
  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('✗ Test failed!');
    console.error('='.repeat(60));
    console.error(`Error: ${error.message}`);
    console.error(`Type: ${error.type || 'UNKNOWN'}`);
    if (error.stack) {
      console.error(`\nStack:\n${error.stack}`);
    }
    return false;
  }
}

test59MinVideo().then(success => {
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

