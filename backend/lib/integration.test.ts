import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
// path import removed as it's not used
import { 
  keyFor, 
  writeFileAtKey, 
  readFileAtKey,
  pathFor 
} from './storage.js';
import { 
  saveManifest, 
  loadManifest 
} from './manifest.js';
import { Manifest } from './types.js';

describe('Integration: End-to-end local flow', () => {
  const originalEnv = process.env.TALKAVOCADO_ENV;
  const originalStoragePath = process.env.MEDIA_STORAGE_PATH;

  beforeEach(() => {
    // Set test environment
    process.env.TALKAVOCADO_ENV = 'test';
    process.env.MEDIA_STORAGE_PATH = './test-storage';
  });

  afterEach(() => {
    // Clean up test storage - use a more robust method for Windows
    try {
      if (fs.existsSync('./test-storage')) {
        fs.rmSync('./test-storage', { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      }
    } catch (error) {
      // Ignore cleanup errors on Windows
      console.warn('Cleanup warning:', error);
    }
    // Restore original env
    process.env.TALKAVOCADO_ENV = originalEnv;
    process.env.MEDIA_STORAGE_PATH = originalStoragePath;
  });

  test('Complete job workflow: create job → write artifacts → update manifest → read back', () => {
    const env = 'test';
    const tenantId = 'test-tenant';
    const jobId = '00000000-0000-0000-0000-000000000000';

    // Step 1: Create initial manifest
    const initialManifest: Manifest = {
      schemaVersion: '1.0.0',
      env,
      tenantId,
      jobId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    saveManifest(env, tenantId, jobId, initialManifest);
    console.log('✓ Created initial manifest');

    // Step 2: Simulate audio extraction - write audio file
    const audioKey = keyFor(env, tenantId, jobId, 'audio', `${jobId}.mp3`);
    const audioContent = 'fake audio content';
    writeFileAtKey(audioKey, audioContent);
    console.log('✓ Wrote audio file');

    // Step 3: Update manifest with audio info
    const updatedManifest: Manifest = {
      ...initialManifest,
      status: 'processing',
      updatedAt: new Date().toISOString(),
      audio: {
        key: audioKey,
        codec: 'mp3',
        durationSec: 120.5,
        bitrateKbps: 128,
        sampleRate: 44100,
        extractedAt: new Date().toISOString()
      }
    };

    saveManifest(env, tenantId, jobId, updatedManifest);
    console.log('✓ Updated manifest with audio info');

    // Step 4: Simulate transcription - write transcript
    const transcriptKey = keyFor(env, tenantId, jobId, 'transcripts', 'transcript.json');
    const transcriptContent = JSON.stringify({
      text: 'Hello world, this is a test transcript.',
      segments: [
        { start: 0, end: 2, text: 'Hello world' },
        { start: 2, end: 5, text: 'this is a test transcript' }
      ]
    }, null, 2);
    writeFileAtKey(transcriptKey, transcriptContent);
    console.log('✓ Wrote transcript file');

    // Step 5: Update manifest with transcript info
    const finalManifest: Manifest = {
      ...updatedManifest,
      status: 'completed',
      updatedAt: new Date().toISOString(),
      transcript: {
        jsonKey: transcriptKey,
        language: 'en',
        model: 'base',
        confidence: 0.95,
        transcribedAt: new Date().toISOString()
      }
    };

    saveManifest(env, tenantId, jobId, finalManifest);
    console.log('✓ Updated manifest with transcript info');

    // Step 6: Verify everything can be read back
    const loadedManifest = loadManifest(env, tenantId, jobId);
    const loadedAudio = readFileAtKey(audioKey).toString();
    const loadedTranscript = JSON.parse(readFileAtKey(transcriptKey).toString());

    // Assertions
    assert.strictEqual(loadedManifest.status, 'completed');
    assert.strictEqual(loadedManifest.audio?.codec, 'mp3');
    assert.strictEqual(loadedManifest.transcript?.language, 'en');
    assert.strictEqual(loadedAudio, audioContent);
    assert.strictEqual(loadedTranscript.text, 'Hello world, this is a test transcript.');

    console.log('✓ All artifacts read back successfully');

    // Step 7: Verify file structure
    const expectedPaths = [
      pathFor(keyFor(env, tenantId, jobId, 'manifest.json')),
      pathFor(audioKey),
      pathFor(transcriptKey)
    ];

    for (const expectedPath of expectedPaths) {
      assert(fs.existsSync(expectedPath), `Expected file to exist: ${expectedPath}`);
    }

    console.log('✓ File structure verified');
  });

  test('Tenant isolation: cross-tenant access prevention', () => {
    const env = 'test';
    const tenant1 = 'tenant-1';
    const tenant2 = 'tenant-2';
    const jobId = '00000000-0000-0000-0000-000000000000';

    // Create manifest for tenant1
    const manifest1: Manifest = {
      schemaVersion: '1.0.0',
      env,
      tenantId: tenant1,
      jobId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    saveManifest(env, tenant1, jobId, manifest1);

    // Create manifest for tenant2
    const manifest2: Manifest = {
      schemaVersion: '1.0.0',
      env,
      tenantId: tenant2,
      jobId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    saveManifest(env, tenant2, jobId, manifest2);

    // Verify tenant isolation - each tenant has separate paths
    const path1 = pathFor(keyFor(env, tenant1, jobId, 'manifest.json'));
    const path2 = pathFor(keyFor(env, tenant2, jobId, 'manifest.json'));

    assert.notStrictEqual(path1, path2);
    assert(fs.existsSync(path1));
    assert(fs.existsSync(path2));

    // Verify each tenant can only access their own manifest
    const loaded1 = loadManifest(env, tenant1, jobId);
    const loaded2 = loadManifest(env, tenant2, jobId);

    assert.strictEqual(loaded1.tenantId, tenant1);
    assert.strictEqual(loaded2.tenantId, tenant2);

    console.log('✓ Tenant isolation verified');
  });
});
