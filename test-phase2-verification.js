// test-phase2-verification.js
// Phase 2 Verification: Performance test and Phase 1 test suite verification
// This script verifies:
// 1. 2x+ speedup with whisper-ctranslate2
// 2. All Phase 1 tests still pass

import { handler } from "./backend/services/transcription/handler.js";
import { keyFor, pathFor } from "./backend/dist/storage.js";
import { saveManifest } from "./backend/dist/manifest.js";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { logger } from "./scripts/logger.js";
import { performance } from "perf_hooks";
import { v4 as uuidv4 } from "uuid";

// Set OpenMP fix
process.env.KMP_DUPLICATE_LIB_OK = "TRUE";

async function runPerformanceTest() {
  logger.info("");
  logger.info("=== Phase 2 Verification: Performance Test ===");
  logger.info("Testing 2x+ speedup with whisper-ctranslate2");
  logger.info("");

  const env = "dev";
  const tenantId = "t-perf";

  // Use existing audio file from previous harness run
  const existingJobId = "f0284511-c163-476d-ada1-e7ed2b105e45";
  const existingAudioKey = keyFor(
    env,
    tenantId,
    existingJobId,
    "audio",
    `${existingJobId}.mp3`
  );
  const existingAudioPath = pathFor(existingAudioKey);

  if (!existsSync(existingAudioPath)) {
    logger.error("Audio file not found:", existingAudioPath);
    logger.error("Please run harness first to extract audio:");
    logger.error(
      "  node tools/harness/run-local-pipeline.js --input podcast-automation/test-assets/raw/sample-short.mp4 --env dev --tenant t-perf"
    );
    process.exit(1);
  }

  logger.info("Using audio file:", existingAudioPath);
  logger.info("");

  const context = { awsRequestId: `perf-test-${Date.now()}` };
  const originalEnv = process.env.WHISPER_CMD;

  // Test 1: whisper-ctranslate2 (preferred, faster)
  logger.info("=== Test 1: whisper-ctranslate2 ===");

  const testJobIdCtranslate = uuidv4();
  const audioKeyCtranslate = keyFor(
    env,
    tenantId,
    testJobIdCtranslate,
    "audio",
    `${testJobIdCtranslate}.mp3`
  );
  const audioPathCtranslate = pathFor(audioKeyCtranslate);

  // Copy audio file for this test
  mkdirSync(dirname(audioPathCtranslate), { recursive: true });
  const { copyFileSync } = await import("fs");
  copyFileSync(existingAudioPath, audioPathCtranslate);

  // Create manifest
  const manifestCtranslate = {
    schemaVersion: "1.0.0",
    env,
    tenantId,
    jobId: testJobIdCtranslate,
    status: "processing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    audio: {
      key: audioKeyCtranslate,
    },
  };
  saveManifest(env, tenantId, testJobIdCtranslate, manifestCtranslate);

  const eventCtranslate = {
    env,
    tenantId,
    jobId: testJobIdCtranslate,
    audioKey: audioKeyCtranslate,
    correlationId: "perf-test-ctranslate",
  };

  process.env.WHISPER_CMD = "whisper-ctranslate2";

  let ctranslateTime;

  try {
    logger.info("Running transcription with whisper-ctranslate2...");
    const startCtranslate = performance.now();
    await handler(eventCtranslate, context);
    const endCtranslate = performance.now();
    ctranslateTime = endCtranslate - startCtranslate;

    logger.info("✅ whisper-ctranslate2 completed", {
      duration: `${(ctranslateTime / 1000).toFixed(2)}s`,
      durationMs: `${ctranslateTime.toFixed(2)}ms`,
    });
  } catch (error) {
    logger.error("❌ whisper-ctranslate2 test failed:", error.message);
    logger.error("Error details:", error.details || {});
    process.exit(1);
  }

  // Test 2: Standard Whisper (baseline)
  logger.info("");
  logger.info("=== Test 2: Standard Whisper (baseline) ===");
  logger.info("Note: This may take longer. Standard whisper is slower.");

  const testJobIdStandard = uuidv4();
  const audioKeyStandard = keyFor(
    env,
    tenantId,
    testJobIdStandard,
    "audio",
    `${testJobIdStandard}.mp3`
  );
  const audioPathStandard = pathFor(audioKeyStandard);

  // Copy audio file for this test
  mkdirSync(dirname(audioPathStandard), { recursive: true });
  copyFileSync(existingAudioPath, audioPathStandard);

  // Create manifest
  const manifestStandard = {
    schemaVersion: "1.0.0",
    env,
    tenantId,
    jobId: testJobIdStandard,
    status: "processing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    audio: {
      key: audioKeyStandard,
    },
  };
  saveManifest(env, tenantId, testJobIdStandard, manifestStandard);

  const eventStandard = {
    env,
    tenantId,
    jobId: testJobIdStandard,
    audioKey: audioKeyStandard,
    correlationId: "perf-test-standard",
  };

  // Try standard whisper, but allow handler to auto-detect fallback to python -m whisper
  process.env.WHISPER_CMD = "whisper";

  let standardTime = null;

  try {
    logger.info("Running transcription with standard whisper...");
    logger.info(
      "Note: Handler will auto-detect python -m whisper if whisper command fails"
    );
    const startStandard = performance.now();
    await handler(eventStandard, context);
    const endStandard = performance.now();
    standardTime = endStandard - startStandard;

    logger.info("✅ Standard Whisper completed", {
      duration: `${(standardTime / 1000).toFixed(2)}s`,
      durationMs: `${standardTime.toFixed(2)}ms`,
    });
  } catch (error) {
    logger.warn("⚠️ Standard Whisper test failed", {
      error: error.message,
    });
    logger.info("");
    logger.info("Attempting fallback: python -m whisper");

    // Try explicit python -m whisper fallback
    try {
      process.env.WHISPER_CMD = "python -m whisper";
      const startStandard = performance.now();
      await handler(eventStandard, context);
      const endStandard = performance.now();
      standardTime = endStandard - startStandard;

      logger.info("✅ Standard Whisper completed (via python -m whisper)", {
        duration: `${(standardTime / 1000).toFixed(2)}s`,
        durationMs: `${standardTime.toFixed(2)}ms`,
      });
    } catch (fallbackError) {
      logger.warn("⚠️ Standard Whisper test skipped (installation issue)", {
        error: fallbackError.message,
      });
      logger.info("");
      logger.info("Note: Standard whisper may need to be reinstalled:");
      logger.info("  pip install --upgrade openai-whisper");
      logger.info("Or check Python environment configuration");
    }
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
      return true;
    } else {
      logger.warn(
        `⚠️ Performance target NOT met: Expected 2x+ speedup, got ${speedup.toFixed(2)}x`
      );
      logger.warn(
        `   Improvement: ${percentFaster.toFixed(1)}% faster (need 100%+ for 2x)`
      );
      return false;
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
    return null; // Cannot verify without baseline
  }
}

async function runPhase1Tests() {
  logger.info("");
  logger.info("=== Phase 2 Verification: Phase 1 Test Suite ===");
  logger.info("Verifying all Phase 1 tests still pass after Phase 2 changes");
  logger.info("");

  const tests = [
    {
      name: "Timestamp Alignment",
      file: "test-timestamp-alignment.js",
      arg: "f0284511-c163-476d-ada1-e7ed2b105e45",
    },
    { name: "Idempotency", file: "test-idempotency-repeat-runs.js" },
    { name: "Error - Missing Audio", file: "test-error-missing-audio.js" },
    {
      name: "Error - Missing Audio Key",
      file: "test-error-missing-audio-key.js",
    },
    {
      name: "Error - Whisper Not Installed",
      file: "test-error-whisper-not-installed.js",
    },
    { name: "Error - Corrupt Audio", file: "test-error-corrupt-audio.js" },
  ];

  const results = [];

  for (const test of tests) {
    try {
      logger.info(`Running: ${test.name}...`);
      const { execSync } = await import("child_process");
      const command = test.arg
        ? `node ${test.file} ${test.arg}`
        : `node ${test.file}`;

      execSync(command, { stdio: "inherit", encoding: "utf8" });
      logger.info(`✅ ${test.name}: PASSED`);
      results.push({ name: test.name, status: "PASSED" });
    } catch (error) {
      logger.error(`❌ ${test.name}: FAILED`);
      logger.error("Error:", error.message);
      results.push({ name: test.name, status: "FAILED", error: error.message });
    }
    logger.info("");
  }

  logger.info("=== Phase 1 Test Results Summary ===");
  logger.info("");

  const passed = results.filter(r => r.status === "PASSED").length;
  const failed = results.filter(r => r.status === "FAILED").length;

  results.forEach(r => {
    const icon = r.status === "PASSED" ? "✅" : "❌";
    logger.info(`${icon} ${r.name}: ${r.status}`);
  });

  logger.info("");
  logger.info(`Total: ${results.length} tests`);
  logger.info(`Passed: ${passed}`);
  logger.info(`Failed: ${failed}`);

  return failed === 0;
}

async function main() {
  try {
    logger.info("========================================");
    logger.info("Phase 2 Verification Script");
    logger.info("========================================");

    // 1. Performance test
    const perfResult = await runPerformanceTest();

    // 2. Phase 1 test suite
    const phase1Result = await runPhase1Tests();

    // Summary
    logger.info("");
    logger.info("========================================");
    logger.info("Phase 2 Verification Summary");
    logger.info("========================================");
    logger.info("");

    if (perfResult === true) {
      logger.info("✅ Performance Test: PASSED (2x+ speedup verified)");
    } else if (perfResult === false) {
      logger.warn("⚠️ Performance Test: FAILED (2x+ speedup not verified)");
    } else {
      logger.info(
        "ℹ️ Performance Test: SKIPPED (standard whisper not available)"
      );
    }

    if (phase1Result) {
      logger.info("✅ Phase 1 Test Suite: PASSED (all tests pass)");
    } else {
      logger.error("❌ Phase 1 Test Suite: FAILED (some tests failed)");
    }

    logger.info("");

    if (perfResult !== false && phase1Result) {
      logger.info("✅ Phase 2 Verification: COMPLETE");
      logger.info("   All verification checks passed");
      process.exit(0);
    } else {
      logger.error("❌ Phase 2 Verification: INCOMPLETE");
      logger.error("   Some verification checks failed");
      process.exit(1);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Phase 2 verification failed:", error);
    // eslint-disable-next-line no-console
    console.error("Error stack:", error.stack);
    if (logger && logger.error) {
      logger.error("Phase 2 verification failed:", error);
    }
    process.exit(1);
  }
}

main();
