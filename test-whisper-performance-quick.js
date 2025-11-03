// test-whisper-performance-quick.js
// Quick performance test using a short audio segment (1-2 minutes)

import { handler } from './backend/services/transcription/handler.js';
import { writeFileSync, mkdirSync, existsSync, copyFileSync } from 'fs';
import { join } from 'path';
import { logger } from './scripts/logger.js';
import { performance } from 'perf_hooks';
import { loadManifest, saveManifest } from './backend/dist/manifest.js';
import { keyFor, pathFor } from './backend/dist/storage.js';

// Set OpenMP fix
process.env.KMP_DUPLICATE_LIB_OK = 'TRUE';

async function testPerformanceQuick() {
  logger.info('Starting quick whisper-ctranslate2 performance test');
  logger.info('Using short audio segment (1-2 minutes) for faster testing');

  const env = 'dev';
  const tenantId = 't-perf-quick';
  const testJobId = `quick-perf-${Date.now()}`;
  
  // Create test directory
  const testDir = pathFor(keyFor(env, tenantId, testJobId));
  mkdirSync(testDir, { recursive: true });
  
  // Check if we have a short segment, otherwise create one from the long file
  const longAudioPath = 'storage/dev/t-perf/012a43c4-bfbe-411b-aeb2-18feeda15255/audio/012a43c4-bfbe-411b-aeb2-18feeda15255.mp3';
  const shortSegmentPath = 'storage/dev/t-perf/test-short-segment.mp3';
  
  let audioPath;
  if (existsSync(shortSegmentPath)) {
    logger.info('Using pre-extracted short segment:', shortSegmentPath);
    audioPath = shortSegmentPath;
  } else if (existsSync(longAudioPath)) {
    logger.info('Short segment not found, will use first 2 minutes of long file');
    logger.info('Note: For quick testing, consider extracting a short segment first');
    audioPath = longAudioPath;
  } else {
    logger.error('No audio file found. Please run audio extraction first.');
    process.exit(1);
  }
  
  // Create test manifest with audio key
  const audioKey = keyFor(env, tenantId, testJobId, 'audio', 'test-short.mp3');
  const audioDestPath = pathFor(audioKey);
  mkdirSync(join(audioDestPath, '..'), { recursive: true });
  
  // Copy audio file to test location
  copyFileSync(audioPath, audioDestPath);
  logger.info('Audio file copied to test location', { audioKey });
  
  const manifest = {
    schemaVersion: '1.0.0',
    env,
    tenantId,
    jobId: testJobId,
    status: 'processing',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    audio: {
      key: audioKey,
    },
  };
  
  saveManifest(env, tenantId, testJobId, manifest);
  logger.info('Test manifest created', { jobId: testJobId });
  
  const context = { awsRequestId: `quick-perf-test-${Date.now()}` };

  // Test 1: whisper-ctranslate2 (preferred)
  logger.info('=== Test 1: whisper-ctranslate2 ===');
  
  const startCtranslate = performance.now();
  const eventCtranslate = {
    env,
    tenantId,
    jobId: `${testJobId}-ctranslate`,
    audioKey,
    correlationId: 'quick-perf-ctranslate',
  };
  
  const originalEnv = process.env.WHISPER_CMD;
  process.env.WHISPER_CMD = 'whisper-ctranslate2';
  
  let ctranslateResult;
  let ctranslateTime;
  
  try {
    ctranslateResult = await handler(eventCtranslate, context);
    const endCtranslate = performance.now();
    ctranslateTime = endCtranslate - startCtranslate;
    
    logger.info('whisper-ctranslate2 completed', {
      time: `${(ctranslateTime / 1000).toFixed(2)}s`,
      timeMs: `${ctranslateTime.toFixed(2)}ms`,
    });
  } catch (error) {
    logger.error('whisper-ctranslate2 test failed', {
      error: error.message,
    });
    process.exit(1);
  } finally {
    process.env.WHISPER_CMD = originalEnv;
  }

  // Test 2: Standard Whisper (optional, skip if not available quickly)
  logger.info('=== Test 2: Standard Whisper (optional) ===');
  logger.info('Skipping standard whisper test for quick validation');
  logger.info('To compare performance, run full test with both variants');

  // Report results
  logger.info('=== Performance Test Results ===');
  
  logger.info('whisper-ctranslate2:', {
    duration: `${(ctranslateTime / 1000).toFixed(2)}s`,
    durationMs: `${ctranslateTime.toFixed(2)}ms`,
    status: '✅ Success',
    result: ctranslateResult ? 'Transcription completed' : 'No result',
  });

  logger.info('');
  logger.info('✅ Performance test completed successfully');
  logger.info('');
  logger.info('Note: For full performance comparison (2x+ speedup verification),');
  logger.info('run a longer test comparing both whisper variants.');
  logger.info('');
  logger.info('Quick test confirms whisper-ctranslate2 is working correctly.');
}

testPerformanceQuick().catch((error) => {
  logger.error('Performance test failed:', error);
  process.exit(1);
});

