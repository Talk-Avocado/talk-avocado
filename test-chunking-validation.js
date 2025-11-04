// test-chunking-validation.js
// Validate chunking functionality with actual long audio files

import { handler } from './backend/services/transcription/handler.js';
import { keyFor, pathFor } from './backend/dist/storage.js';
import { saveManifest, loadManifest } from './backend/dist/manifest.js';
import { mkdirSync, existsSync, copyFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { logger } from './scripts/logger.js';
import { v4 as uuidv4 } from 'uuid';

// Set OpenMP fix
process.env.KMP_DUPLICATE_LIB_OK = 'TRUE';

async function testChunkingValidation() {
  logger.info('=== Test: Large File Chunking Validation ===');
  logger.info('Testing chunking functionality with actual long audio files');
  logger.info('');

  const env = 'dev';
  const tenantId = 't-test';

  // Test files
  const testFiles = [
    {
      name: '30-minute file',
      path: 'podcast-automation/test-assets/audio/test-30min.mp3',
      duration: 1800, // 30 minutes
      shouldChunk: false // If threshold is 1800, this should NOT chunk (it's exactly 30 min)
    },
    {
      name: '60-minute file',
      path: 'podcast-automation/test-assets/audio/test-60min.mp3',
      duration: 3600, // 60 minutes
      shouldChunk: true // Should definitely chunk
    }
  ];

  // Set chunk threshold to 30 minutes (1800 seconds) for testing
  const originalThreshold = process.env.TRANSCRIPT_CHUNK_THRESHOLD;
  const originalWhisperCmd = process.env.WHISPER_CMD;
  process.env.TRANSCRIPT_CHUNK_THRESHOLD = '1800';
  process.env.TRANSCRIPT_CHUNK_DURATION = '300'; // 5-minute chunks
  // Force whisper-ctranslate2 for faster processing
  process.env.WHISPER_CMD = 'whisper-ctranslate2';

  const context = { awsRequestId: `test-chunking-validation-${Date.now()}` };
  const results = [];

  for (const testFile of testFiles) {
    logger.info(`=== Testing: ${testFile.name} ===`);
    logger.info(`Duration: ${testFile.duration} seconds (${(testFile.duration / 60).toFixed(2)} minutes)`);
    logger.info(`Expected to chunk: ${testFile.shouldChunk}`);
    logger.info('');

    if (!existsSync(testFile.path)) {
      logger.warn(`⚠️  Test file not found: ${testFile.path}`);
      logger.info('Skipping this test...');
      logger.info('');
      continue;
    }

    const testJobId = uuidv4();
    const audioKey = keyFor(env, tenantId, testJobId, 'audio', `${testJobId}.mp3`);
    const audioPath = pathFor(audioKey);

    try {
      // Copy test file to storage location
      mkdirSync(dirname(audioPath), { recursive: true });
      copyFileSync(testFile.path, audioPath);
      logger.info(`Copied test file to: ${audioKey}`);

      // Create manifest
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

      // Run transcription
      const event = {
        env,
        tenantId,
        jobId: testJobId,
        audioKey: audioKey,
        correlationId: `test-chunking-${testJobId}`,
      };

      logger.info('Starting transcription...');
      const startTime = Date.now();
      
      const result = await handler(event, context);
      
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;

      logger.info(`✅ Transcription completed in ${duration.toFixed(2)} seconds`);
      logger.info(`Result: ${result.ok ? 'SUCCESS' : 'FAILED'}`);
      logger.info('');

      // Load manifest to check results
      const finalManifest = loadManifest(env, tenantId, testJobId);
      
      if (finalManifest.transcript && finalManifest.transcript.key) {
        const transcriptPath = pathFor(finalManifest.transcript.key);
        if (existsSync(transcriptPath)) {
          const transcriptData = JSON.parse(readFileSync(transcriptPath, 'utf8'));
          
          logger.info('Transcript Statistics:');
          logger.info(`  - Segments: ${transcriptData.segments?.length || 0}`);
          logger.info(`  - Language: ${transcriptData.language || 'unknown'}`);
          logger.info(`  - Word count: ${transcriptData.wordCount || 'N/A'}`);
          
          if (transcriptData.segments && transcriptData.segments.length > 0) {
            const firstSegment = transcriptData.segments[0];
            const lastSegment = transcriptData.segments[transcriptData.segments.length - 1];
            
            logger.info(`  - First segment start: ${firstSegment.start.toFixed(3)}s`);
            logger.info(`  - Last segment end: ${lastSegment.end.toFixed(3)}s`);
            logger.info(`  - Total transcript duration: ${lastSegment.end.toFixed(2)}s (${(lastSegment.end / 60).toFixed(2)} min)`);
            
            // Validate timestamp continuity
            let gaps = 0;
            let overlaps = 0;
            let maxGap = 0;
            let maxOverlap = 0;
            
            for (let i = 1; i < transcriptData.segments.length; i++) {
              const prevEnd = transcriptData.segments[i - 1].end;
              const currStart = transcriptData.segments[i].start;
              const gap = currStart - prevEnd;
              
              if (gap > 0.3) { // Gap > 300ms
                gaps++;
                maxGap = Math.max(maxGap, gap);
              } else if (gap < -0.3) { // Overlap > 300ms
                overlaps++;
                maxOverlap = Math.max(maxOverlap, Math.abs(gap));
              }
            }
            
            logger.info('');
            logger.info('Timestamp Validation:');
            logger.info(`  - Gaps >300ms: ${gaps}`);
            logger.info(`  - Overlaps >300ms: ${overlaps}`);
            if (gaps > 0) {
              logger.warn(`  - Max gap: ${maxGap.toFixed(3)}s`);
            }
            if (overlaps > 0) {
              logger.warn(`  - Max overlap: ${maxOverlap.toFixed(3)}s`);
            }
            
            // Calculate accuracy
            const expectedDuration = testFile.duration;
            const actualDuration = lastSegment.end;
            const durationDiff = Math.abs(actualDuration - expectedDuration);
            const durationAccuracy = ((1 - durationDiff / expectedDuration) * 100).toFixed(2);
            
            logger.info('');
            logger.info('Duration Validation:');
            logger.info(`  - Expected: ${expectedDuration}s`);
            logger.info(`  - Actual: ${actualDuration.toFixed(2)}s`);
            logger.info(`  - Difference: ${durationDiff.toFixed(2)}s`);
            logger.info(`  - Accuracy: ${durationAccuracy}%`);
            
            const timestampAccuracy = gaps === 0 && overlaps === 0 ? '✅ PASS' : '⚠️  WARN';
            const durationAccuracyResult = durationDiff < 5 ? '✅ PASS' : '⚠️  WARN'; // 5 second tolerance
            
            results.push({
              testFile: testFile.name,
              duration: testFile.duration,
              shouldChunk: testFile.shouldChunk,
              success: result.ok,
              transcriptionTime: duration,
              segments: transcriptData.segments?.length || 0,
              transcriptDuration: lastSegment.end,
              durationAccuracy: durationAccuracy,
              timestampAccuracy: timestampAccuracy,
              gaps: gaps,
              overlaps: overlaps,
              maxGap: maxGap,
              maxOverlap: maxOverlap,
              durationDiff: durationDiff
            });
          }
        }
      }

    } catch (error) {
      logger.error(`❌ Test failed for ${testFile.name}:`, error.message);
      logger.error('Error details:', error.details || {});
      
      results.push({
        testFile: testFile.name,
        duration: testFile.duration,
        shouldChunk: testFile.shouldChunk,
        success: false,
        error: error.message
      });
    }

    logger.info('');
    logger.info('---');
    logger.info('');
  }

  // Restore original settings
  if (originalThreshold) {
    process.env.TRANSCRIPT_CHUNK_THRESHOLD = originalThreshold;
  } else {
    delete process.env.TRANSCRIPT_CHUNK_THRESHOLD;
  }
  if (originalWhisperCmd !== undefined) {
    process.env.WHISPER_CMD = originalWhisperCmd;
  } else {
    delete process.env.WHISPER_CMD;
  }

  // Print summary
  logger.info('=== Test Summary ===');
  logger.info('');
  
  for (const result of results) {
    logger.info(`Test: ${result.testFile}`);
    logger.info(`  Duration: ${result.duration}s (${(result.duration / 60).toFixed(2)} min)`);
    logger.info(`  Should chunk: ${result.shouldChunk}`);
    logger.info(`  Success: ${result.success ? '✅ PASS' : '❌ FAIL'}`);
    
    if (result.success) {
      logger.info(`  Transcription time: ${result.transcriptionTime.toFixed(2)}s`);
      logger.info(`  Segments: ${result.segments}`);
      logger.info(`  Transcript duration: ${result.transcriptDuration.toFixed(2)}s`);
      logger.info(`  Duration accuracy: ${result.durationAccuracy}%`);
      logger.info(`  Timestamp accuracy: ${result.timestampAccuracy}`);
      if (result.gaps > 0 || result.overlaps > 0) {
        logger.info(`  Gaps >300ms: ${result.gaps}`);
        logger.info(`  Overlaps >300ms: ${result.overlaps}`);
      }
    } else {
      logger.info(`  Error: ${result.error}`);
    }
    logger.info('');
  }

  const passedTests = results.filter(r => r.success).length;
  const totalTests = results.length;
  
  logger.info(`Overall: ${passedTests}/${totalTests} tests passed`);
  
  if (passedTests === totalTests) {
    logger.info('✅ All chunking validation tests passed!');
    return 0;
  } else {
    logger.error('❌ Some tests failed');
    return 1;
  }
}

testChunkingValidation().catch((error) => {
  logger.error('Test suite failed:', error);
  process.exit(1);
});

