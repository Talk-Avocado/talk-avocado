#!/usr/bin/env node
// tools/harness/run-local-pipeline.js
import { parseArgs } from 'node:util';
import { readFileSync, copyFileSync } from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';

// Import storage and manifest helpers
import { keyFor, pathFor, ensureDirForFile } from '../../backend/dist/storage.js';
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

  // 3. Invoke handlers in sequence
  const handlers = [
    { name: 'audio-extraction', path: '../../backend/services/audio-extraction/handler.cjs' },
    { name: 'transcription', path: '../../backend/services/transcription/handler.js' },
    { name: 'smart-cut-planner', path: '../../backend/services/smart-cut-planner/handler.js' },
    { name: 'video-render-engine', path: '../../backend/services/video-render-engine/handler-simple.cjs' }
  ];

  for (const handler of handlers) {
    try {
      logger.info(`[harness] Running ${handler.name}...`);
      const { handler: fn } = await import(handler.path);
      
      // Build event based on handler requirements
      let event = { env, tenantId, jobId, inputKey };
      
      // Transcription needs audioKey from manifest (after audio extraction)
      if (handler.name === 'transcription') {
        const manifest = loadManifest(env, tenantId, jobId);
        const audioKey = manifest.audio?.key;
        if (!audioKey) {
          throw new Error(`Audio key not found in manifest for transcription. Audio extraction must complete first.`);
        }
        event = { env, tenantId, jobId, audioKey };
      }
      
      // Smart cut planner needs transcriptKey
      if (handler.name === 'smart-cut-planner') {
        const transcriptKey = keyFor(env, tenantId, jobId, 'transcripts', 'transcript.json');
        event = { env, tenantId, jobId, transcriptKey };
      }
      
      // Video render engine needs planKey and sourceVideoKey
      if (handler.name === 'video-render-engine') {
        const planKey = keyFor(env, tenantId, jobId, 'plan', 'cut_plan.json');
        const sourceVideoKey = keyFor(env, tenantId, jobId, 'input', path.basename(values.input));
        event = { env, tenantId, jobId, planKey, sourceVideoKey };
      }
      
      const context = { awsRequestId: `local-${Date.now()}` };
      await fn(event, context);
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
  process.exit(1);
});