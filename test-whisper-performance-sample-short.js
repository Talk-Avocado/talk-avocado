// test-whisper-performance-sample-short.js
// Performance comparison test using sample-short audio (43.9 seconds)
// Compares standard whisper vs whisper-ctranslate2

import { handler } from "./backend/services/transcription/handler.js";
import { logger } from "./scripts/logger.js";
import { performance } from "perf_hooks";

// Set OpenMP fix
process.env.KMP_DUPLICATE_LIB_OK = "TRUE";

async function testPerformance() {
  logger.info("=== whisper-ctranslate2 Performance Test ===");
  logger.info("Using sample-short audio (43.9 seconds)");
  logger.info("");

  const env = "dev";
  const tenantId = "t-perf";
  const jobId = "f0284511-c163-476d-ada1-e7ed2b105e45"; // From harness run

  // Construct audio key directly (pattern from harness)
  const { keyFor, pathFor } = await import("./backend/dist/storage.js");
  const { saveManifest } = await import("./backend/dist/manifest.js");
  const { mkdirSync, existsSync } = await import("fs");
  const { dirname } = await import("path");

  const audioKey = keyFor(env, tenantId, jobId, "audio", `${jobId}.mp3`);

  logger.info("Using audio key:", audioKey);

  // Create minimal manifest for performance test jobs
  const createTestManifest = testJobId => {
    const manifestPath = pathFor(
      keyFor(env, tenantId, testJobId, "manifest.json")
    );
    if (!existsSync(manifestPath)) {
      mkdirSync(dirname(manifestPath), { recursive: true });
      saveManifest(env, tenantId, testJobId, {
        schemaVersion: "1.0.0",
        env,
        tenantId,
        jobId: testJobId,
        status: "processing",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        audio: {
          key: audioKey,
        },
      });
    }
  };

  const context = { awsRequestId: `perf-test-${Date.now()}` };
  const originalEnv = process.env.WHISPER_CMD;

  // Test 1: whisper-ctranslate2 (preferred, faster)
  logger.info("=== Test 1: whisper-ctranslate2 ===");

  const testJobIdCtranslate = `${jobId}-perf-ctranslate`;
  createTestManifest(testJobIdCtranslate);

  const startCtranslate = performance.now();
  const eventCtranslate = {
    env,
    tenantId,
    jobId: testJobIdCtranslate,
    audioKey,
    correlationId: "perf-test-ctranslate",
  };

  process.env.WHISPER_CMD = "whisper-ctranslate2";

  let ctranslateTime;

  try {
    logger.info("Running transcription with whisper-ctranslate2...");
    await handler(eventCtranslate, context);
    const endCtranslate = performance.now();
    ctranslateTime = endCtranslate - startCtranslate;

    logger.info("✅ whisper-ctranslate2 completed", {
      duration: `${(ctranslateTime / 1000).toFixed(2)}s`,
      durationMs: `${ctranslateTime.toFixed(2)}ms`,
    });
  } catch (error) {
    logger.error("❌ whisper-ctranslate2 test failed:", error.message);
    process.exit(1);
  }

  // Test 2: Standard Whisper (baseline)
  logger.info("");
  logger.info("=== Test 2: Standard Whisper (baseline) ===");
  logger.info("Note: This may take longer. Standard whisper is slower.");

  const testJobIdStandard = `${jobId}-perf-standard`;
  createTestManifest(testJobIdStandard);

  const startStandard = performance.now();
  const eventStandard = {
    env,
    tenantId,
    jobId: testJobIdStandard,
    audioKey,
    correlationId: "perf-test-standard",
  };

  process.env.WHISPER_CMD = "whisper";

  let standardTime = null;

  try {
    logger.info("Running transcription with standard whisper...");
    await handler(eventStandard, context);
    const endStandard = performance.now();
    standardTime = endStandard - startStandard;

    logger.info("✅ Standard Whisper completed", {
      duration: `${(standardTime / 1000).toFixed(2)}s`,
      durationMs: `${standardTime.toFixed(2)}ms`,
    });
  } catch (error) {
    logger.warn("⚠️ Standard Whisper test skipped (may not be installed)", {
      error: error.message,
    });
    logger.info("");
    logger.info(
      "Note: For full comparison, ensure standard whisper is installed:"
    );
    logger.info("  pip install openai-whisper");
  } finally {
    process.env.WHISPER_CMD = originalEnv;
  }

  // Compare results
  logger.info("");
  logger.info("=== Performance Comparison Results ===");
  logger.info("");

  logger.info("whisper-ctranslate2:", {
    duration: `${(ctranslateTime / 1000).toFixed(2)}s`,
    durationMs: `${ctranslateTime.toFixed(2)}ms`,
    status: "✅ Success",
  });

  if (standardTime) {
    logger.info("Standard Whisper:", {
      duration: `${(standardTime / 1000).toFixed(2)}s`,
      durationMs: `${standardTime.toFixed(2)}ms`,
      status: "✅ Success",
    });

    logger.info("");
    logger.info("=== Performance Analysis ===");

    const speedup = standardTime / ctranslateTime;
    const timeSaved = standardTime - ctranslateTime;
    const percentFaster =
      ((standardTime - ctranslateTime) / standardTime) * 100;

    logger.info("Results:", {
      "Standard Whisper": `${(standardTime / 1000).toFixed(2)}s`,
      "whisper-ctranslate2": `${(ctranslateTime / 1000).toFixed(2)}s`,
      Speedup: `${speedup.toFixed(2)}x`,
      "Time Saved": `${(timeSaved / 1000).toFixed(2)}s`,
      "Percent Faster": `${percentFaster.toFixed(1)}%`,
    });

    logger.info("");

    if (speedup >= 2.0) {
      logger.info("✅ Performance target MET: 2x+ speedup achieved");
      logger.info(
        `   Speedup: ${speedup.toFixed(2)}x (${percentFaster.toFixed(1)}% faster)`
      );
    } else {
      logger.warn(
        `⚠️ Performance target NOT met: Expected 2x+ speedup, got ${speedup.toFixed(2)}x`
      );
      logger.warn(
        `   Improvement: ${percentFaster.toFixed(1)}% faster (need 100%+ for 2x)`
      );
    }
  } else {
    logger.info("Standard Whisper: Not available for comparison");
    logger.info("");
    logger.info(
      "whisper-ctranslate2 performance:",
      `${(ctranslateTime / 1000).toFixed(2)}s`
    );
    logger.info("");
    logger.info("Note: To verify 2x+ speedup, install standard whisper:");
    logger.info("  pip install openai-whisper");
    logger.info("Then re-run this test.");
  }

  logger.info("");
  logger.info("=== Test Complete ===");
}

testPerformance().catch(error => {
  logger.error("Performance test failed:", error);
  process.exit(1);
});
