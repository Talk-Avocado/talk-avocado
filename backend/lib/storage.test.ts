import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import {
  storageRoot,
  key,
  keyFor,
  pathFor,
  ensureDirForFile,
  writeFileAtKey,
  readFileAtKey,
  currentEnv,
} from "./storage.js";

describe("Storage utilities", () => {
  const originalEnv = process.env.TALKAVOCADO_ENV;
  const originalStoragePath = process.env.MEDIA_STORAGE_PATH;

  beforeEach(() => {
    // Set test environment
    process.env.TALKAVOCADO_ENV = "test";
    process.env.MEDIA_STORAGE_PATH = "./test-storage";
  });

  afterEach(() => {
    // Clean up test storage - use a more robust method for Windows
    try {
      if (fs.existsSync("./test-storage")) {
        fs.rmSync("./test-storage", {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
      }
    } catch (error) {
      // Ignore cleanup errors on Windows
      console.warn("Cleanup warning:", error);
    }
    // Restore original env
    process.env.TALKAVOCADO_ENV = originalEnv;
    process.env.MEDIA_STORAGE_PATH = originalStoragePath;
  });

  test("key() joins parts with forward slashes", () => {
    assert.strictEqual(key("a", "b", "c"), "a/b/c");
    assert.strictEqual(
      key("env", "tenant", "job", "file.txt"),
      "env/tenant/job/file.txt"
    );
  });

  test("keyFor() creates tenant-scoped keys", () => {
    assert.strictEqual(
      keyFor("dev", "tenant1", "job1", "manifest.json"),
      "dev/tenant1/job1/manifest.json"
    );
    assert.strictEqual(
      keyFor("prod", "tenant2", "job2", "audio", "file.mp3"),
      "prod/tenant2/job2/audio/file.mp3"
    );
  });

  test("pathFor() creates absolute paths", () => {
    const key = "dev/tenant1/job1/manifest.json";
    const expected = path.resolve("./test-storage", key);
    assert.strictEqual(pathFor(key), expected);
  });

  test("storageRoot() returns resolved path", () => {
    const root = storageRoot();
    assert.strictEqual(root, path.resolve("./test-storage"));
  });

  test("currentEnv() returns environment", () => {
    assert.strictEqual(currentEnv(), "test");
  });

  test("ensureDirForFile() creates directories", () => {
    const filePath = "./test-storage/test/dir/file.txt";
    ensureDirForFile(filePath);
    assert(fs.existsSync("./test-storage/test/dir"));
  });

  test("writeFileAtKey() and readFileAtKey() work together", () => {
    const key = "test/tenant/job/file.txt";
    const content = "Hello, World!";

    writeFileAtKey(key, content);
    const readContent = readFileAtKey(key).toString();

    assert.strictEqual(readContent, content);
    assert(fs.existsSync(pathFor(key)));
  });

  test("writeFileAtKey() with Buffer", () => {
    const key = "test/tenant/job/binary.bin";
    const content = Buffer.from([1, 2, 3, 4]);

    writeFileAtKey(key, content);
    const readContent = readFileAtKey(key);

    assert(Buffer.isBuffer(readContent));
    assert.deepStrictEqual(readContent, content);
  });
});
