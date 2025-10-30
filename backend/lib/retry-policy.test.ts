import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import {
  RetryPolicy,
  RetryConfigs,
  createRetryableError,
  createNonRetryableError,
} from "./retry-policy.js";

describe("RetryPolicy", () => {
  let retryPolicy: RetryPolicy;

  beforeEach(() => {
    retryPolicy = new RetryPolicy();
  });

  describe("execute", () => {
    it("should succeed on first attempt", async () => {
      const result = await retryPolicy.execute(async () => "success");
      assert.equal(result, "success");
    });

    it("should retry on retryable errors", async () => {
      let attempts = 0;
      const result = await retryPolicy.execute(async () => {
        attempts++;
        if (attempts < 3) {
          throw createRetryableError("Temporary failure");
        }
        return "success";
      });

      assert.equal(result, "success");
      assert.equal(attempts, 3);
    });

    it("should not retry on non-retryable errors", async () => {
      let attempts = 0;
      try {
        await retryPolicy.execute(async () => {
          attempts++;
          throw createNonRetryableError("Permanent failure");
        });
        assert.fail("Should have thrown");
      } catch (error) {
        assert.equal(attempts, 1);
        assert.equal((error as Error).message, "Permanent failure");
      }
    });

    it("should respect max attempts", async () => {
      const config = { maxAttempts: 2 };
      const policy = new RetryPolicy(config);
      let attempts = 0;

      try {
        await policy.execute(async () => {
          attempts++;
          throw createRetryableError("Always fails");
        });
        assert.fail("Should have thrown");
      } catch (error) {
        assert.equal(attempts, 2);
      }
    });

    it("should use exponential backoff", async () => {
      const config = {
        maxAttempts: 3,
        baseDelayMs: 100,
        backoffMultiplier: 2,
      };
      const policy = new RetryPolicy(config);
      const startTime = Date.now();
      let attempts = 0;

      try {
        await policy.execute(async () => {
          attempts++;
          throw createRetryableError("Always fails");
        });
        assert.fail("Should have thrown");
      } catch (error) {
        const elapsed = Date.now() - startTime;
        // Should have waited at least 100ms + 200ms = 300ms
        assert(elapsed >= 300, `Expected at least 300ms, got ${elapsed}ms`);
        assert.equal(attempts, 3);
      }
    });
  });

  describe("RetryConfigs", () => {
    it("should have valid configurations", () => {
      assert(RetryConfigs.mediaProcessing.maxAttempts > 0);
      assert(RetryConfigs.transcription.maxAttempts > 0);
      assert(RetryConfigs.storage.maxAttempts > 0);
      assert(RetryConfigs.api.maxAttempts > 0);
    });
  });

  describe("Error utilities", () => {
    it("should create retryable errors", () => {
      const error = createRetryableError("Test error", 5000);
      assert(error.isRetryable === true);
      assert(error.retryAfterMs === 5000);
    });

    it("should create non-retryable errors", () => {
      const error = createNonRetryableError("Test error");
      assert((error as any).isRetryable === false);
    });
  });
});
