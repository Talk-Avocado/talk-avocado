#!/usr/bin/env node
// tools/harness/run-local-pipeline.js
const { parseArgs } = require('node:util');
const { readFileSync, copyFileSync } = require('node:fs');
const { v4: uuidv4 } = require('uuid');
const path = require('node:path');

// Import storage and manifest helpers
const { keyFor, pathFor, writeFileAtKey, ensureDirForFile } = require('../../backend/dist/storage');
const { saveManifest, loadManifest } = require('../../backend/dist/manifest');

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
    console.error('Error: --input is required');
    process.exit(1);
  }

  const jobId = values.job === 'auto' ? uuidv4() : (values.job.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) ? values.job : uuidv4());
  const env = values.env;
  const tenantId = values.tenant;

  console.log(`[harness] Starting pipeline: env=${env}, tenant=${tenantId}, job=${jobId}`);

  // 1. Seed input
  const inputKey = keyFor(env, tenantId, jobId, 'input', path.basename(values.input));
  const inputPath = pathFor(inputKey);
  ensureDirForFile(inputPath);
  copyFileSync(values.input, inputPath);
  console.log(`[harness] Input seeded: ${inputKey}`);

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
  console.log(`[harness] Manifest created`);

  // 3. Invoke handlers in sequence
  const handlers = [
    { name: 'audio-extraction', path: '../../backend/services/audio-extraction/handler.cjs' },
    { name: 'transcription', path: '../../backend/services/transcription/handler' },
    { name: 'smart-cut-planner', path: '../../backend/services/smart-cut-planner/handler-simple.js' },
    { name: 'video-render-engine', path: '../../backend/services/video-render-engine/handler' }
  ];

  for (const handler of handlers) {
    try {
      console.log(`[harness] Running ${handler.name}...`);
      const { handler: fn } = require(handler.path);
      
      // Build event based on handler requirements
      let event = { env, tenantId, jobId, inputKey };
      
      // Smart cut planner needs transcriptKey
      if (handler.name === 'smart-cut-planner') {
        const transcriptKey = keyFor(env, tenantId, jobId, 'transcripts', 'transcript.json');
        event = { env, tenantId, jobId, transcriptKey };
      }
      
      const context = { awsRequestId: `local-${Date.now()}` };
      await fn(event, context);
      console.log(`[harness] ✓ ${handler.name} completed`);
    } catch (error) {
      console.error(`[harness] ✗ ${handler.name} failed:`, error.message);
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

  console.log(`[harness] Pipeline completed successfully`);

  // 5. Compare goldens if provided
  if (values.goldens) {
    console.log(`[harness] Comparing against goldens: ${values.goldens}`);
    const { compareGoldens } = require('./compare-goldens');
    const passed = await compareGoldens({
      actualPath: pathFor(keyFor(env, tenantId, jobId)),
      goldensPath: values.goldens,
      strict: values.strict
    });
    if (!passed) {
      console.error('[harness] Golden comparison FAILED');
      process.exit(1);
    }
    console.log('[harness] Golden comparison PASSED');
  }

  console.log(`[harness] Job complete: ${jobId}`);
}

main().catch(err => {
  console.error('[harness] Fatal error:', err);
  process.exit(1);
});