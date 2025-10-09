import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { 
  manifestKey, 
  loadManifest, 
  saveManifest 
} from './manifest.js';
import { Manifest } from './types.js';

describe('Manifest utilities', () => {
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

  test('manifestKey() creates correct key', () => {
    const key = manifestKey('dev', 'tenant1', 'job1');
    assert.strictEqual(key, 'dev/tenant1/job1/manifest.json');
  });

  test('saveManifest() and loadManifest() work with valid manifest', () => {
    const manifest: Manifest = {
      schemaVersion: '1.0.0',
      env: 'test',
      tenantId: 'test-tenant',
      jobId: '00000000-0000-0000-0000-000000000000',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    saveManifest('test', 'test-tenant', '00000000-0000-0000-0000-000000000000', manifest);
    const loaded = loadManifest('test', 'test-tenant', '00000000-0000-0000-0000-000000000000');

    assert.strictEqual(loaded.schemaVersion, manifest.schemaVersion);
    assert.strictEqual(loaded.env, manifest.env);
    assert.strictEqual(loaded.tenantId, manifest.tenantId);
    assert.strictEqual(loaded.jobId, manifest.jobId);
    assert.strictEqual(loaded.status, manifest.status);
  });

  test('saveManifest() rejects invalid manifest', () => {
    const invalidManifest = {
      schemaVersion: '1.0.0',
      env: 'test',
      tenantId: 'test-tenant',
      // Missing required fields: jobId, status, createdAt, updatedAt
    } as any;

    assert.throws(() => {
      saveManifest('test', 'test-tenant', '00000000-0000-0000-0000-000000000000', invalidManifest);
    }, /Invalid manifest/);
  });

  test('loadManifest() rejects invalid manifest file', () => {
    const invalidManifest = {
      schemaVersion: '1.0.0',
      env: 'test',
      tenantId: 'test-tenant',
      // Missing required fields
    };

    // Write invalid manifest directly
    const key = manifestKey('test', 'test-tenant', '00000000-0000-0000-0000-000000000000');
    const filePath = path.resolve('./test-storage', key);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(invalidManifest, null, 2));

    assert.throws(() => {
      loadManifest('test', 'test-tenant', '00000000-0000-0000-0000-000000000000');
    }, /Invalid manifest/);
  });

  test('saveManifest() with complete manifest including optional fields', () => {
    const manifest: Manifest = {
      schemaVersion: '1.0.0',
      env: 'test',
      tenantId: 'test-tenant',
      jobId: '00000000-0000-0000-0000-000000000000',
      status: 'completed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      input: {
        sourceKey: 'input/video.mp4',
        originalFilename: 'video.mp4',
        bytes: 1024000,
        mimeType: 'video/mp4',
        checksum: 'abc123',
        uploadedAt: new Date().toISOString()
      },
      audio: {
        key: 'audio/00000000-0000-0000-0000-000000000000.mp3',
        codec: 'mp3',
        durationSec: 120.5,
        bitrateKbps: 128,
        sampleRate: 44100,
        extractedAt: new Date().toISOString()
      },
      transcript: {
        jsonKey: 'transcripts/transcript.json',
        srtKey: 'transcripts/captions.source.srt',
        language: 'en',
        model: 'base',
        confidence: 0.95,
        transcribedAt: new Date().toISOString()
      },
      plan: {
        key: 'plan/cut_plan.json',
        schemaVersion: '1.0.0',
        algorithm: 'smart-cut',
        totalCuts: 5,
        plannedAt: new Date().toISOString()
      },
      renders: [
        {
          key: 'renders/preview.mp4',
          type: 'preview',
          codec: 'h264',
          durationSec: 120.5,
          resolution: '1920x1080',
          notes: 'Preview render',
          renderedAt: new Date().toISOString()
        }
      ],
      subtitles: [
        {
          key: 'subtitles/final.srt',
          type: 'final',
          format: 'srt',
          durationSec: 120.5,
          wordCount: 500,
          generatedAt: new Date().toISOString()
        }
      ],
      logs: [
        {
          key: 'logs/pipeline.log',
          type: 'pipeline',
          createdAt: new Date().toISOString()
        }
      ],
      metadata: {
        clientVersion: '1.0.0',
        processingTimeMs: 30000,
        tags: ['test', 'sample']
      }
    };

    saveManifest('test', 'test-tenant', '00000000-0000-0000-0000-000000000000', manifest);
    const loaded = loadManifest('test', 'test-tenant', '00000000-0000-0000-0000-000000000000');

    assert.strictEqual(loaded.input?.originalFilename, 'video.mp4');
    assert.strictEqual(loaded.audio?.codec, 'mp3');
    assert.strictEqual(loaded.transcript?.language, 'en');
    assert.strictEqual(loaded.renders?.length, 1);
    assert.strictEqual(loaded.subtitles?.length, 1);
    assert.strictEqual(loaded.logs?.length, 1);
    assert.strictEqual(loaded.metadata?.tags?.length, 2);
  });
});
