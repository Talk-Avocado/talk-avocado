#!/usr/bin/env node
// tools/harness/run-local-pipeline-simple.js
import { parseArgs } from 'node:util';
import { readFileSync, copyFileSync } from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';

// Import storage and manifest helpers
import { keyFor, pathFor, writeFileAtKey, ensureDirForFile } from '../../backend/dist/storage.js';
import { saveManifest, loadManifest } from '../../backend/dist/manifest.js';
import { logger } from "../../scripts/logger.js";

async function main() {
  // Parse CLI arguments
  const { values } = parseArgs({
    options: {
      env: { type: 'string', default: 'dev' },
      tenant: { type: 'string', default: 't-local' },
      job: { type: 'string', default: 'auto' },
      input: { type: 'string' },
      goldens: { type: 'string' },
      strict: { type: 'boolean', default: false }
    }
  });

  if (!values.input) {
    logger.error('Error: --input is required');
    process.exit(1);
  }

  const jobId = values.job === 'auto' ? uuidv4() : (values.job.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) ? values.job : uuidv4());
  const env = values.env;
  const tenantId = values.tenant;

  logger.info(`[harness] Starting pipeline: env=${env}, tenant=${tenantId}, job=${jobId}`);

  // 1. Seed input
  const inputKey = keyFor(env, tenantId, jobId, 'input', path.basename(values.input));
  const inputPath = pathFor(inputKey);
  ensureDirForFile(inputPath);
  copyFileSync(values.input, inputPath);
  logger.info(`[harness] Input seeded: ${inputKey}`);

  // 2. Create initial manifest
  const manifest = {
    schemaVersion: '1.0.0',
    env,
    tenantId,
    jobId,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    input: {
      sourceKey: inputKey,
      originalFilename: path.basename(values.input),
      bytes: readFileSync(values.input).length,
      mimeType: 'video/mp4'
    }
  };
  saveManifest(env, tenantId, jobId, manifest);
  logger.info(`[harness] Manifest created`);

  // 3. Simulate handlers (for testing purposes)
  const handlers = [
    { name: 'audio-extraction' },
    { name: 'transcription' },
    { name: 'smart-cut-planner' },
    { name: 'video-render-engine' }
  ];

  for (const handler of handlers) {
    try {
      logger.info(`[harness] Running ${handler.name}...`);
      
      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Update manifest with mock data
      const m = loadManifest(env, tenantId, jobId);
      if (handler.name === 'audio-extraction') {
        m.audio = {
          key: keyFor(env, tenantId, jobId, 'audio', `${jobId}.mp3`),
          codec: 'mp3',
          durationSec: 43.9,
          extractedAt: new Date().toISOString()
        };
      } else if (handler.name === 'transcription') {
        const transcriptText = "This is a sample transcript for testing the harness. It contains about forty-five words to match the expected word count in the metrics. The transcript should be processed correctly by the transcription service and used for cut planning.";
        const wordCount = transcriptText.split(/\s+/).filter(word => word.length > 0).length;
        
        m.transcript = {
          jsonKey: keyFor(env, tenantId, jobId, 'transcripts', 'transcript.json'),
          language: 'en',
          model: 'medium',
          wordCount: wordCount,
          transcribedAt: new Date().toISOString()
        };
        // Create mock transcript file
        const transcriptData = {
          segments: [
            { text: transcriptText }
          ]
        };
        writeFileAtKey(m.transcript.jsonKey, JSON.stringify(transcriptData, null, 2));
      } else if (handler.name === 'smart-cut-planner') {
        m.plan = {
          key: keyFor(env, tenantId, jobId, 'plan', 'cut_plan.json'),
          schemaVersion: '1.0.0',
          algorithm: 'mock',
          totalCuts: 3,
          plannedAt: new Date().toISOString()
        };
      } else if (handler.name === 'video-render-engine') {
        m.renders = [{
          key: keyFor(env, tenantId, jobId, 'renders', 'preview.mp4'),
          type: 'preview',
          codec: 'h264',
          durationSec: 28.2,
          renderedAt: new Date().toISOString()
        }];
      }
      
      m.updatedAt = new Date().toISOString();
      saveManifest(env, tenantId, jobId, m);
      
      logger.info(`[harness] ✓ ${handler.name} completed`);
    } catch (error) {
      logger.error(`[harness] ✗ ${handler.name} failed:`, error.message);
      // Update manifest status to failed
      const m = loadManifest(env, tenantId, jobId);
      m.status = 'failed';
      m.updatedAt = new Date().toISOString();
      saveManifest(env, tenantId, jobId, m);
      process.exit(1);
    }
  }

  // 4. Mark completed
  const finalManifest = loadManifest(env, tenantId, jobId);
  finalManifest.status = 'completed';
  finalManifest.updatedAt = new Date().toISOString();
  saveManifest(env, tenantId, jobId, finalManifest);

  logger.info(`[harness] Pipeline completed successfully`);

  // 5. Compare goldens if provided
  if (values.goldens) {
    logger.info(`[harness] Comparing against goldens: ${values.goldens}`);
    const { compareGoldens } = await import('./compare-goldens.js');
    const passed = await compareGoldens({
      actualPath: pathFor(keyFor(env, tenantId, jobId)),
      goldensPath: values.goldens,
      strict: values.strict
    });
    if (!passed) {
      logger.error('[harness] Golden comparison FAILED');
      process.exit(1);
    }
    logger.info('[harness] Golden comparison PASSED');
  }

  logger.info(`[harness] Job complete: ${jobId}`);
}

main().catch(err => {
  logger.error('[harness] Fatal error:', err);
  console.error('Full error details:', err);
  process.exit(1);
});
