// test-whisper-ctranslate2-benchmark.js
// Detailed benchmarking test for whisper-ctranslate2 performance

import { handler } from './backend/services/transcription/handler.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from './scripts/logger.js';
import { performance } from 'perf_hooks';

async function runBenchmark(variant, jobIdSuffix, audioKey) {
  const startTime = performance.now();
  const event = {
    env: 'dev',
    tenantId: 't-benchmark',
    jobId: `benchmark-${jobIdSuffix}-${Date.now()}`,
    audioKey,
    correlationId: `benchmark-${variant}`,
  };

  const context = { awsRequestId: `benchmark-${variant}-${Date.now()}` };

  // Set WHISPER_CMD for this test
  const originalEnv = process.env.WHISPER_CMD;
  process.env.WHISPER_CMD = variant;

  try {
    const result = await handler(event, context);
    const endTime = performance.now();
    const duration = endTime - startTime;

    process.env.WHISPER_CMD = originalEnv;

    return {
      success: true,
      duration,
      result,
      variant,
    };
  } catch (error) {
    process.env.WHISPER_CMD = originalEnv;
    return {
      success: false,
      error: error.message,
      variant,
    };
  }
}

async function benchmark() {
  logger.info('Starting whisper-ctranslate2 benchmark test');

  // Setup test environment
  const testDir = 'storage/dev/t-benchmark';
  mkdirSync(testDir, { recursive: true });

  // Create test manifest
  const testJobId = 'benchmark-job';
  const manifest = {
    schemaVersion: '1.0.0',
    env: 'dev',
    tenantId: 't-benchmark',
    jobId: testJobId,
    status: 'processing',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    audio: {
      key: `dev/t-benchmark/${testJobId}/audio/${testJobId}.mp3`,
    },
  };

  writeFileSync(
    join(testDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  const audioKey = manifest.audio.key;
  const audioPath = 'podcast-automation/test-assets/raw/sample-short.mp4';
  
  if (!existsSync(audioPath)) {
    logger.error('Test audio file not found:', audioPath);
    process.exit(1);
  }

  // Run benchmarks
  const results = [];

  // Benchmark whisper-ctranslate2
  logger.info('Running benchmark: whisper-ctranslate2');
  const ctranslateResult = await runBenchmark('whisper-ctranslate2', 'ctranslate', audioKey);
  results.push(ctranslateResult);

  // Benchmark standard whisper (if available)
  logger.info('Running benchmark: standard whisper');
  const standardResult = await runBenchmark('whisper', 'standard', audioKey);
  results.push(standardResult);

  // Report results
  logger.info('=== Benchmark Results ===');
  
  const ctranslate = results.find((r) => r.variant === 'whisper-ctranslate2');
  const standard = results.find((r) => r.variant === 'whisper');

  if (ctranslate && ctranslate.success) {
    logger.info('whisper-ctranslate2:', {
      duration: `${ctranslate.duration.toFixed(2)}ms`,
      status: '✅ Success',
    });
  } else {
    logger.error('whisper-ctranslate2:', {
      status: '❌ Failed',
      error: ctranslate?.error,
    });
  }

  if (standard && standard.success) {
    logger.info('Standard Whisper:', {
      duration: `${standard.duration.toFixed(2)}ms`,
      status: '✅ Success',
    });
  } else {
    logger.warn('Standard Whisper:', {
      status: '⚠️ Not available or failed',
      error: standard?.error,
    });
  }

  // Calculate speedup if both succeeded
  if (ctranslate?.success && standard?.success) {
    const speedup = standard.duration / ctranslate.duration;
    const improvement = ((standard.duration - ctranslate.duration) / standard.duration) * 100;

    logger.info('=== Performance Analysis ===');
    logger.info('Speedup:', `${speedup.toFixed(2)}x`);
    logger.info('Improvement:', `${improvement.toFixed(1)}% faster`);
    logger.info('Time Saved:', `${(standard.duration - ctranslate.duration).toFixed(2)}ms`);

    if (speedup >= 2.0) {
      logger.info('✅ Performance target met: 2x+ speedup achieved');
    } else {
      logger.warn('⚠️ Performance target not met: Expected 2x+ speedup');
    }
  }

  logger.info('Benchmark test completed');
}

benchmark().catch((error) => {
  logger.error('Benchmark test failed:', error);
  process.exit(1);
});

