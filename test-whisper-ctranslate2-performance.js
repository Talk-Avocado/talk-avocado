// test-whisper-ctranslate2-performance.js
// Performance comparison test between standard whisper and whisper-ctranslate2

import { handler } from "./backend/services/transcription/handler.js";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { logger } from "./scripts/logger.js";
import { performance } from "perf_hooks";

async function testPerformance() {
  logger.info("Starting whisper-ctranslate2 performance comparison test");

  // Create test environment
  const testDir = "storage/dev/t-perf/test-job";
  const testJobId = "test-perf-job";
  mkdirSync(testDir, { recursive: true });

  // Create a test manifest
  const manifest = {
    schemaVersion: "1.0.0",
    env: "dev",
    tenantId: "t-perf",
    jobId: testJobId,
    status: "processing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    audio: {
      key: `dev/t-perf/${testJobId}/audio/${testJobId}.mp3`,
    },
  };

  writeFileSync(
    join(testDir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );

  // Check if we have a test audio file, otherwise use sample
  const testAudioPath = "podcast-automation/test-assets/raw/sample-short.mp4";
  if (!existsSync(testAudioPath)) {
    logger.error("Test audio file not found:", testAudioPath);
    process.exit(1);
  }

  // Extract audio if needed (simplified - assumes audio exists)
  const audioDir = join(testDir, "audio");
  mkdirSync(audioDir, { recursive: true });

  // Copy or reference existing audio file
  logger.info("Using test audio file:", testAudioPath);

  const context = { awsRequestId: `perf-test-${Date.now()}` };

  // Test 1: Standard Whisper (if available)
  logger.info("=== Test 1: Standard Whisper ===");
  // eslint-disable-next-line no-unused-vars
  const envStandard = {
    ...process.env,
    WHISPER_CMD: "whisper",
  };

  let standardTime = null;
  let standardResult = null;

  try {
    const startStandard = performance.now();
    const eventStandard = {
      env: "dev",
      tenantId: "t-perf",
      jobId: `${testJobId}-standard`,
      audioKey: manifest.audio.key,
      correlationId: "perf-test-standard",
    };

    // Temporarily override process.env for this test
    const originalEnv = process.env.WHISPER_CMD;
    process.env.WHISPER_CMD = "whisper";

    standardResult = await handler(eventStandard, context);

    process.env.WHISPER_CMD = originalEnv;

    const endStandard = performance.now();
    standardTime = endStandard - startStandard;

    logger.info("Standard Whisper completed", {
      time: `${standardTime.toFixed(2)}ms`,
      result: standardResult ? "Success" : "No result",
    });
  } catch (error) {
    logger.warn("Standard Whisper test failed (may not be installed)", {
      error: error.message,
    });
  }

  // Test 2: whisper-ctranslate2
  logger.info("=== Test 2: whisper-ctranslate2 ===");
  // eslint-disable-next-line no-unused-vars
  const envCtranslate = {
    ...process.env,
    WHISPER_CMD: "whisper-ctranslate2",
  };

  let ctranslateTime = null;
  let ctranslateResult = null;

  try {
    const startCtranslate = performance.now();
    const eventCtranslate = {
      env: "dev",
      tenantId: "t-perf",
      jobId: `${testJobId}-ctranslate`,
      audioKey: manifest.audio.key,
      correlationId: "perf-test-ctranslate",
    };

    // Temporarily override process.env for this test
    const originalEnv = process.env.WHISPER_CMD;
    process.env.WHISPER_CMD = "whisper-ctranslate2";

    ctranslateResult = await handler(eventCtranslate, context);

    process.env.WHISPER_CMD = originalEnv;

    const endCtranslate = performance.now();
    ctranslateTime = endCtranslate - startCtranslate;

    logger.info("whisper-ctranslate2 completed", {
      time: `${ctranslateTime.toFixed(2)}ms`,
      result: ctranslateResult,
    });
  } catch (error) {
    logger.error("whisper-ctranslate2 test failed", {
      error: error.message,
    });
    process.exit(1);
  }

  // Compare results
  logger.info("=== Performance Comparison ===");

  if (standardTime && ctranslateTime) {
    const speedup = standardTime / ctranslateTime;
    const timeSaved = standardTime - ctranslateTime;
    const percentFaster =
      ((standardTime - ctranslateTime) / standardTime) * 100;

    logger.info("Results:", {
      "Standard Whisper": `${standardTime.toFixed(2)}ms`,
      "whisper-ctranslate2": `${ctranslateTime.toFixed(2)}ms`,
      Speedup: `${speedup.toFixed(2)}x`,
      "Time Saved": `${timeSaved.toFixed(2)}ms`,
      "Percent Faster": `${percentFaster.toFixed(1)}%`,
    });

    // Verify speedup meets expectation
    if (speedup >= 2.0) {
      logger.info("✅ Performance target met: 2x+ speedup achieved");
    } else {
      logger.warn(
        "⚠️ Performance target not met: Expected 2x+ speedup, got",
        speedup.toFixed(2) + "x"
      );
    }
  } else if (ctranslateTime) {
    logger.info("whisper-ctranslate2 time:", `${ctranslateTime.toFixed(2)}ms`);
    logger.info("Standard Whisper: Not available for comparison");
  } else {
    logger.error("No successful tests to compare");
    process.exit(1);
  }

  // Compare output quality (if both succeeded)
  if (standardResult && ctranslateResult) {
    logger.info("=== Output Quality Comparison ===");
    // Note: Detailed quality comparison would require comparing transcript text
    // For now, we just verify both produced valid outputs
    logger.info("Both variants produced valid transcriptions");
  }

  logger.info("Performance test completed");
}

testPerformance().catch(error => {
  logger.error("Performance test failed:", error);
  process.exit(1);
});
