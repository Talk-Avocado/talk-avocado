import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { createJob } from "./api/jobs/createJob.js";

describe("createJob API", () => {
  const originalEnv = process.env.TALKAVOCADO_ENV;
  const originalStoragePath = process.env.MEDIA_STORAGE_PATH;
  const originalStartOnCreate = process.env.START_ON_CREATE;

  beforeEach(() => {
    process.env.TALKAVOCADO_ENV = "test";
    process.env.MEDIA_STORAGE_PATH = "./test-storage-create-job";
    process.env.START_ON_CREATE = "true";
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
    process.env.START_ON_CREATE = originalStartOnCreate;
  });

  test("returns 201 and then 409 when x-idempotency-key is reused", async () => {
    const tenantId = "demo-tenant";
    const body = JSON.stringify({
      tenantId,
      input: {
        originalFilename: "sample.mp4",
        bytes: 1,
        mimeType: "video/mp4",
      },
    });
    const headers = {
      "x-correlation-id": "test-corr",
      "x-idempotency-key": "key-123",
    } as any;

    const first = await createJob({ headers, body });
    assert.strictEqual(first.statusCode, 201);

    const second = await createJob({ headers, body });
    assert.strictEqual(second.statusCode, 409);
    const payload = JSON.parse(second.body);
    assert.strictEqual(payload.error, "Duplicate create");
    assert.ok(payload.jobId);
    assert.ok(payload.manifestKey);
  });
});
