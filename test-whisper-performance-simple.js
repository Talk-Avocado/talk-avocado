// test-whisper-performance-simple.js
// Simple performance test using extracted MP3 from the harness run

import { handler } from "./backend/services/transcription/handler.js";
import { loadManifest } from "./backend/dist/manifest.js";
import { logger } from "./scripts/logger.js";
import { performance } from "perf_hooks";

// Set OpenMP fix
process.env.KMP_DUPLICATE_LIB_OK = "TRUE";

async function testPerformance() {
  logger.info("Starting whisper-ctranslate2 performance test");
  logger.info("Using extracted MP3 from harness run");

  // Use the job ID from the harness run (the one that extracted audio)
  const env = "dev";
  const tenantId = "t-perf";

  // Find the most recent job with audio extracted
  // For now, let's check if we can find the job from the harness output
  // The job ID was: 012a43c4-bfbe-411b-aeb2-18feeda15255

  const testJobId = process.argv[2] || "012a43c4-bfbe-411b-aeb2-18feeda15255";

  try {
    const manifest = loadManifest(env, tenantId, testJobId);
    const audioKey = manifest.audio?.key;

    if (!audioKey) {
      logger.error(
        "Audio key not found in manifest. Please run audio extraction first."
      );
      process.exit(1);
    }

    logger.info("Found audio key in manifest", { audioKey, jobId: testJobId });

    const context = { awsRequestId: `perf-test-${Date.now()}` };

    // Test 1: whisper-ctranslate2 (preferred)
    logger.info("=== Test 1: whisper-ctranslate2 ===");

    const startCtranslate = performance.now();
    const eventCtranslate = {
      env,
      tenantId,
      jobId: `${testJobId}-perf-ctranslate`,
      audioKey,
      correlationId: "perf-test-ctranslate",
    };

    // Set WHISPER_CMD to whisper-ctranslate2
    const originalEnv = process.env.WHISPER_CMD;
    process.env.WHISPER_CMD = "whisper-ctranslate2";

    let ctranslateResult;
    try {
      ctranslateResult = await handler(eventCtranslate, context);
    } finally {
      process.env.WHISPER_CMD = originalEnv;
    }

    const endCtranslate = performance.now();
    const ctranslateTime = endCtranslate - startCtranslate;

    logger.info("whisper-ctranslate2 completed", {
      time: `${(ctranslateTime / 1000).toFixed(2)}s`,
      timeMs: `${ctranslateTime.toFixed(2)}ms`,
      result: ctranslateResult,
    });

    // Test 2: Standard Whisper (if available, optional)
    logger.info("=== Test 2: Standard Whisper (optional) ===");

    const startStandard = performance.now();
    const eventStandard = {
      env,
      tenantId,
      jobId: `${testJobId}-perf-standard`,
      audioKey,
      correlationId: "perf-test-standard",
    };

    process.env.WHISPER_CMD = "whisper";

    let standardResult;
    let standardTime = null;

    try {
      standardResult = await handler(eventStandard, context);
      const endStandard = performance.now();
      standardTime = endStandard - startStandard;

      logger.info("Standard Whisper completed", {
        time: `${(standardTime / 1000).toFixed(2)}s`,
        timeMs: `${standardTime.toFixed(2)}ms`,
        result: standardResult,
      });
    } catch (error) {
      logger.warn("Standard Whisper test skipped (may not be installed)", {
        error: error.message,
      });
    } finally {
      process.env.WHISPER_CMD = originalEnv;
    }

    // Compare results
    logger.info("=== Performance Results ===");

    logger.info("whisper-ctranslate2:", {
      duration: `${(ctranslateTime / 1000).toFixed(2)}s`,
      status: "✅ Success",
    });

    if (standardTime) {
      logger.info("Standard Whisper:", {
        duration: `${(standardTime / 1000).toFixed(2)}s`,
        status: "✅ Success",
      });

      const speedup = standardTime / ctranslateTime;
      const timeSaved = standardTime - ctranslateTime;
      const percentFaster =
        ((standardTime - ctranslateTime) / standardTime) * 100;

      logger.info("=== Performance Comparison ===");
      logger.info("Results:", {
        "Standard Whisper": `${(standardTime / 1000).toFixed(2)}s`,
        "whisper-ctranslate2": `${(ctranslateTime / 1000).toFixed(2)}s`,
        Speedup: `${speedup.toFixed(2)}x`,
        "Time Saved": `${(timeSaved / 1000).toFixed(2)}s`,
        "Percent Faster": `${percentFaster.toFixed(1)}%`,
      });

      if (speedup >= 2.0) {
        logger.info("✅ Performance target met: 2x+ speedup achieved");
      } else {
        logger.warn(
          `⚠️ Performance target not met: Expected 2x+ speedup, got ${speedup.toFixed(2)}x`
        );
      }
    } else {
      logger.info("Standard Whisper: Not available for comparison");
      logger.info(
        "whisper-ctranslate2 performance:",
        `${(ctranslateTime / 1000).toFixed(2)}s`
      );
    }

    logger.info("Performance test completed");
  } catch (error) {
    logger.error("Performance test failed:", error);
    logger.error("Error details:", error.details || error.message);
    process.exit(1);
  }
}

testPerformance().catch(error => {
  logger.error("Performance test failed:", error);
  process.exit(1);
});
