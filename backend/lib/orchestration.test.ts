import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { startStateMachine } from "./orchestration.js";
import { saveManifest, loadManifest } from "./manifest.js";
import { Manifest } from "./types.js";

describe("orchestration starter", () => {
  const originalEnv = process.env.TALKAVOCADO_ENV;
  const originalStoragePath = process.env.MEDIA_STORAGE_PATH;

  beforeEach(() => {
    process.env.TALKAVOCADO_ENV = "test";
    process.env.MEDIA_STORAGE_PATH = "./test-storage-orchestration";
    if (fs.existsSync(process.env.MEDIA_STORAGE_PATH)) {
      fs.rmSync(process.env.MEDIA_STORAGE_PATH, {
        recursive: true,
        force: true,
      });
    }
  });

  afterEach(() => {
    try {
      if (fs.existsSync(process.env.MEDIA_STORAGE_PATH!)) {
        fs.rmSync(process.env.MEDIA_STORAGE_PATH!, {
          recursive: true,
          force: true,
        });
      }
    } catch {}
    process.env.TALKAVOCADO_ENV = originalEnv;
    process.env.MEDIA_STORAGE_PATH = originalStoragePath;
  });

  test("invokes mark-processing and updates manifest to processing", async () => {
    const env = "test";
    const tenantId = "tenant-orch";
    const jobId = "11111111-1111-1111-1111-111111111111";

    const manifest: Manifest = {
      schemaVersion: "1.0.0",
      env,
      tenantId,
      jobId,
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    saveManifest(env, tenantId, jobId, manifest);

    await startStateMachine({ tenantId, jobId, correlationId: "corr-test" });

    // wait a tick for setImmediate callback
    await new Promise(r => setTimeout(r, 25));

    const updated = loadManifest(env, tenantId, jobId);
    assert.strictEqual(updated.status, "processing");
  });
});
