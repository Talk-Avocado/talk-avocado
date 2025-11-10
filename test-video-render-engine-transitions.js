#!/usr/bin/env node
// test-video-render-engine-transitions.js
// Comprehensive test suite for Video Render Engine Transitions (MFU-WP01-05-BE)
//
// Tests transitions functionality including:
// - Single keep segment (should produce base cuts, no transitions)
// - Two keep segments (should produce transitions)
// - Three+ keep segments (should produce transitions at all joins)
// - Duration calculation with overlap
// - Determinism (same input/config yields matching output)
// - Idempotency (safe overwrite)
// - Harness integration

import { handler } from "./backend/services/video-render-engine/handler.js";
import { keyFor, pathFor, ensureDirForFile } from "./backend/dist/storage.js";
import { saveManifest, loadManifest } from "./backend/dist/manifest.js";
import { probe } from "./backend/services/video-render-engine/renderer-logic.js";
import fs, { copyFileSync } from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { logger } from "./scripts/logger.js";

// Test configuration
const TEST_ENV = "dev";
const TEST_TENANT = "t-test-transitions";
const TEST_VIDEO = "podcast-automation/test-assets/raw/sample-short.mp4";

// Test results tracking
const testResults = [];
let testsPassed = 0;
let testsFailed = 0;

// Helper functions
function logTestResult(testName, passed, message = "") {
  const status = passed ? "✅ PASS" : "❌ FAIL";
  logger.info(`${status}: ${testName}${message ? ` - ${message}` : ""}`);
  testResults.push({ testName, passed, message });
  if (passed) {
    testsPassed++;
  } else {
    testsFailed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

async function setupTestJob(jobId, options = {}) {
  const { includeVideo = true, cutPlanData = null } = options;

  const validJobId =
    typeof jobId === "string" &&
    jobId.match(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
      ? jobId
      : uuidv4();

  // Create manifest
  const manifest = {
    schemaVersion: "1.0.0",
    env: TEST_ENV,
    tenantId: TEST_TENANT,
    jobId: validJobId,
    status: "processing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (includeVideo) {
    const inputKey = keyFor(
      TEST_ENV,
      TEST_TENANT,
      validJobId,
      "input",
      path.basename(TEST_VIDEO)
    );
    const inputPath = pathFor(inputKey);
    ensureDirForFile(inputPath);
    copyFileSync(TEST_VIDEO, inputPath);
    manifest.input = {
      sourceKey: inputKey,
      originalFilename: path.basename(TEST_VIDEO),
      bytes: fs.statSync(TEST_VIDEO).size,
      mimeType: "video/mp4",
    };
  }

  saveManifest(TEST_ENV, TEST_TENANT, validJobId, manifest);

  if (cutPlanData) {
    const planKey = keyFor(
      TEST_ENV,
      TEST_TENANT,
      validJobId,
      "plan",
      "cut_plan.json"
    );
    const planPath = pathFor(planKey);
    ensureDirForFile(planPath);
    fs.writeFileSync(planPath, JSON.stringify(cutPlanData, null, 2));
  }

  return validJobId;
}

function createCutPlan(keepSegments) {
  return {
    schemaVersion: "1.0.0",
    cuts: keepSegments.map((seg, idx) => ({
      type: "keep",
      start: String(seg.start),
      end: String(seg.end),
      reason: `Test keep segment ${idx + 1}`,
    })),
  };
}

// Test 1: Single keep segment (should produce base cuts, no transitions)
async function test1_SingleKeepSegment() {
  const testName = "Test 1: Single Keep Segment (No Transitions)";
  logger.info(`\n${"=".repeat(60)}`);
  logger.info(testName);
  logger.info("=".repeat(60));

  try {
    const jobId = await setupTestJob(uuidv4(), {
      cutPlanData: createCutPlan([{ start: 0, end: 5 }]),
    });

    // Set environment variable
    process.env.TRANSITIONS_ENABLED = "true";

    const event = {
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId,
      planKey: keyFor(TEST_ENV, TEST_TENANT, jobId, "plan", "cut_plan.json"),
      sourceVideoKey: keyFor(
        TEST_ENV,
        TEST_TENANT,
        jobId,
        "input",
        path.basename(TEST_VIDEO)
      ),
      transitions: true,
    };

    const context = { awsRequestId: `test-${Date.now()}` };
    const result = await handler(event, context);

    // Verify output is base_cuts.mp4 (not with_transitions.mp4)
    assert(
      result.outputKey.includes("base_cuts.mp4"),
      "Should produce base_cuts.mp4 for single segment"
    );
    assert(
      !result.outputKey.includes("with_transitions.mp4"),
      "Should NOT produce with_transitions.mp4 for single segment"
    );
    assert(result.useTransitions === false, "Should not use transitions");

    const manifest = loadManifest(TEST_ENV, TEST_TENANT, jobId);
    const renderEntry = manifest.renders[manifest.renders.length - 1];
    assert(
      !renderEntry.transition,
      "Should not have transition metadata for single segment"
    );

    logTestResult(testName, true);
  } catch (error) {
    logTestResult(testName, false, error.message);
    throw error;
  }
}

// Test 2: Two keep segments (should produce transitions)
async function test2_TwoKeepSegments() {
  const testName = "Test 2: Two Keep Segments (With Transitions)";
  logger.info(`\n${"=".repeat(60)}`);
  logger.info(testName);
  logger.info("=".repeat(60));

  try {
    const jobId = await setupTestJob(uuidv4(), {
      cutPlanData: createCutPlan([
        { start: 0, end: 5 },
        { start: 10, end: 15 },
      ]),
    });

    process.env.TRANSITIONS_ENABLED = "true";
    process.env.TRANSITIONS_DURATION_MS = "300";

    const event = {
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId,
      planKey: keyFor(TEST_ENV, TEST_TENANT, jobId, "plan", "cut_plan.json"),
      sourceVideoKey: keyFor(
        TEST_ENV,
        TEST_TENANT,
        jobId,
        "input",
        path.basename(TEST_VIDEO)
      ),
      transitions: true,
    };

    const context = { awsRequestId: `test-${Date.now()}` };
    const result = await handler(event, context);

    // Verify output is with_transitions.mp4
    assert(
      result.outputKey.includes("with_transitions.mp4"),
      "Should produce with_transitions.mp4 for 2+ segments"
    );
    assert(result.useTransitions === true, "Should use transitions");
    assert(result.joins === 1, "Should have 1 join");

    const manifest = loadManifest(TEST_ENV, TEST_TENANT, jobId);
    const renderEntry = manifest.renders[manifest.renders.length - 1];
    assert(renderEntry.transition, "Should have transition metadata");
    assert(
      renderEntry.transition.type === "crossfade",
      "Transition type should be crossfade"
    );
    assert(
      renderEntry.transition.durationMs === 300,
      "Transition duration should be 300ms"
    );

    // Verify duration calculation
    const expectedDuration = 5 + 5 - 0.3; // sum(keeps) - joins * durationSec
    const fps =
      parseFloat(renderEntry.fps.split("/")[0]) /
      (renderEntry.fps.includes("/")
        ? parseFloat(renderEntry.fps.split("/")[1])
        : 1);
    const frameDuration = 1 / fps;
    const tolerance = frameDuration;
    const durationDiff = Math.abs(renderEntry.durationSec - expectedDuration);

    assert(
      durationDiff <= tolerance,
      `Duration should be within ±1 frame tolerance. Expected: ${expectedDuration.toFixed(3)}s, Got: ${renderEntry.durationSec.toFixed(3)}s, Diff: ${durationDiff.toFixed(3)}s, Tolerance: ±${tolerance.toFixed(3)}s`
    );

    logTestResult(testName, true);
  } catch (error) {
    logTestResult(testName, false, error.message);
    throw error;
  }
}

// Test 3: Three+ keep segments (should produce transitions at all joins)
async function test3_ThreeKeepSegments() {
  const testName = "Test 3: Three Keep Segments (Transitions at All Joins)";
  logger.info(`\n${"=".repeat(60)}`);
  logger.info(testName);
  logger.info("=".repeat(60));

  try {
    const jobId = await setupTestJob(uuidv4(), {
      cutPlanData: createCutPlan([
        { start: 0, end: 5 },
        { start: 10, end: 15 },
        { start: 20, end: 25 },
      ]),
    });

    process.env.TRANSITIONS_ENABLED = "true";
    process.env.TRANSITIONS_DURATION_MS = "300";

    const event = {
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId,
      planKey: keyFor(TEST_ENV, TEST_TENANT, jobId, "plan", "cut_plan.json"),
      sourceVideoKey: keyFor(
        TEST_ENV,
        TEST_TENANT,
        jobId,
        "input",
        path.basename(TEST_VIDEO)
      ),
      transitions: true,
    };

    const context = { awsRequestId: `test-${Date.now()}` };
    const result = await handler(event, context);

    assert(
      result.outputKey.includes("with_transitions.mp4"),
      "Should produce with_transitions.mp4"
    );
    assert(result.useTransitions === true, "Should use transitions");
    assert(result.joins === 2, "Should have 2 joins for 3 segments");

    const manifest = loadManifest(TEST_ENV, TEST_TENANT, jobId);
    const renderEntry = manifest.renders[manifest.renders.length - 1];
    assert(renderEntry.transition, "Should have transition metadata");

    // Verify duration calculation with 2 joins
    const expectedDuration = 5 + 5 + 5 - 2 * 0.3; // sum(keeps) - joins * durationSec
    const fps =
      parseFloat(renderEntry.fps.split("/")[0]) /
      (renderEntry.fps.includes("/")
        ? parseFloat(renderEntry.fps.split("/")[1])
        : 1);
    const frameDuration = 1 / fps;
    const tolerance = frameDuration;
    const durationDiff = Math.abs(renderEntry.durationSec - expectedDuration);

    assert(
      durationDiff <= tolerance,
      `Duration should be within ±1 frame tolerance. Expected: ${expectedDuration.toFixed(3)}s, Got: ${renderEntry.durationSec.toFixed(3)}s, Diff: ${durationDiff.toFixed(3)}s`
    );

    logTestResult(testName, true);
  } catch (error) {
    logTestResult(testName, false, error.message);
    throw error;
  }
}

// Test 4: Duration calculation validation
async function test4_DurationCalculation() {
  const testName = "Test 4: Duration Calculation with Overlap";
  logger.info(`\n${"=".repeat(60)}`);
  logger.info(testName);
  logger.info("=".repeat(60));

  try {
    const durationMs = 500; // Use 500ms for easier calculation
    const jobId = await setupTestJob(uuidv4(), {
      cutPlanData: createCutPlan([
        { start: 0, end: 10 },
        { start: 15, end: 25 },
      ]),
    });

    process.env.TRANSITIONS_ENABLED = "true";
    process.env.TRANSITIONS_DURATION_MS = String(durationMs);

    const event = {
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId,
      planKey: keyFor(TEST_ENV, TEST_TENANT, jobId, "plan", "cut_plan.json"),
      sourceVideoKey: keyFor(
        TEST_ENV,
        TEST_TENANT,
        jobId,
        "input",
        path.basename(TEST_VIDEO)
      ),
      transitions: true,
    };

    const context = { awsRequestId: `test-${Date.now()}` };
    await handler(event, context);

    const manifest = loadManifest(TEST_ENV, TEST_TENANT, jobId);
    const renderEntry = manifest.renders[manifest.renders.length - 1];

    // Expected: sum(keeps) - joins * durationSec
    const expectedDuration = 10 + 10 - durationMs / 1000; // 20 - 0.5 = 19.5
    const fps =
      parseFloat(renderEntry.fps.split("/")[0]) /
      (renderEntry.fps.includes("/")
        ? parseFloat(renderEntry.fps.split("/")[1])
        : 1);
    const frameDuration = 1 / fps;
    const tolerance = frameDuration;
    const durationDiff = Math.abs(renderEntry.durationSec - expectedDuration);

    assert(
      durationDiff <= tolerance,
      `Duration calculation failed. Expected: ${expectedDuration.toFixed(3)}s, Got: ${renderEntry.durationSec.toFixed(3)}s, Diff: ${durationDiff.toFixed(3)}s, Tolerance: ±${tolerance.toFixed(3)}s`
    );

    logTestResult(testName, true);
  } catch (error) {
    logTestResult(testName, false, error.message);
    throw error;
  }
}

// Test 5: Determinism (same input/config yields matching output)
async function test5_Determinism() {
  const testName =
    "Test 5: Determinism (Same Input/Config Yields Matching Output)";
  logger.info(`\n${"=".repeat(60)}`);
  logger.info(testName);
  logger.info("=".repeat(60));

  try {
    const cutPlan = createCutPlan([
      { start: 0, end: 5 },
      { start: 10, end: 15 },
    ]);

    process.env.TRANSITIONS_ENABLED = "true";
    process.env.TRANSITIONS_DURATION_MS = "300";

    // First run
    const jobId1 = await setupTestJob(uuidv4(), {
      cutPlanData: cutPlan,
    });

    const event1 = {
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId: jobId1,
      planKey: keyFor(TEST_ENV, TEST_TENANT, jobId1, "plan", "cut_plan.json"),
      sourceVideoKey: keyFor(
        TEST_ENV,
        TEST_TENANT,
        jobId1,
        "input",
        path.basename(TEST_VIDEO)
      ),
      transitions: true,
    };

    const context1 = { awsRequestId: `test-${Date.now()}` };
    const result1 = await handler(event1, context1);
    const manifest1 = loadManifest(TEST_ENV, TEST_TENANT, jobId1);
    const renderEntry1 = manifest1.renders[manifest1.renders.length - 1];
    const probe1 = await probe(pathFor(result1.outputKey));

    // Second run with same config
    const jobId2 = await setupTestJob(uuidv4(), {
      cutPlanData: cutPlan,
    });

    const event2 = {
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId: jobId2,
      planKey: keyFor(TEST_ENV, TEST_TENANT, jobId2, "plan", "cut_plan.json"),
      sourceVideoKey: keyFor(
        TEST_ENV,
        TEST_TENANT,
        jobId2,
        "input",
        path.basename(TEST_VIDEO)
      ),
      transitions: true,
    };

    const context2 = { awsRequestId: `test-${Date.now()}` };
    const result2 = await handler(event2, context2);
    const manifest2 = loadManifest(TEST_ENV, TEST_TENANT, jobId2);
    const renderEntry2 = manifest2.renders[manifest2.renders.length - 1];
    const probe2 = await probe(pathFor(result2.outputKey));

    // Compare probe metrics (duration, fps, resolution should match)
    assert(
      Math.abs(probe1.format.duration - probe2.format.duration) < 0.01,
      "Duration should match between runs"
    );
    assert(
      renderEntry1.fps === renderEntry2.fps,
      "FPS should match between runs"
    );
    assert(
      renderEntry1.resolution === renderEntry2.resolution,
      "Resolution should match between runs"
    );

    logTestResult(testName, true);
  } catch (error) {
    logTestResult(testName, false, error.message);
    throw error;
  }
}

// Test 6: Idempotency (safe overwrite)
async function test6_Idempotency() {
  const testName = "Test 6: Idempotency (Safe Overwrite)";
  logger.info(`\n${"=".repeat(60)}`);
  logger.info(testName);
  logger.info("=".repeat(60));

  try {
    const jobId = await setupTestJob(uuidv4(), {
      cutPlanData: createCutPlan([
        { start: 0, end: 5 },
        { start: 10, end: 15 },
      ]),
    });

    process.env.TRANSITIONS_ENABLED = "true";
    process.env.TRANSITIONS_DURATION_MS = "300";

    const event = {
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId,
      planKey: keyFor(TEST_ENV, TEST_TENANT, jobId, "plan", "cut_plan.json"),
      sourceVideoKey: keyFor(
        TEST_ENV,
        TEST_TENANT,
        jobId,
        "input",
        path.basename(TEST_VIDEO)
      ),
      transitions: true,
    };

    // First run
    const context1 = { awsRequestId: `test-${Date.now()}` };
    const result1 = await handler(event, context1);
    const manifest1 = loadManifest(TEST_ENV, TEST_TENANT, jobId);
    const renderCount1 = manifest1.renders.length;

    // Second run (should overwrite)
    const context2 = { awsRequestId: `test-${Date.now()}` };
    const result2 = await handler(event, context2);
    const manifest2 = loadManifest(TEST_ENV, TEST_TENANT, jobId);
    const renderCount2 = manifest2.renders.length;

    // Should have added a new render entry (not replaced)
    assert(
      renderCount2 > renderCount1,
      "Should add new render entry on second run"
    );

    // Both should have same output key
    assert(
      result1.outputKey === result2.outputKey,
      "Output key should be the same"
    );

    // File should exist and be valid
    const outputPath = pathFor(result2.outputKey);
    assert(fs.existsSync(outputPath), "Output file should exist");
    assert(fs.statSync(outputPath).size > 0, "Output file should not be empty");

    logTestResult(testName, true);
  } catch (error) {
    logTestResult(testName, false, error.message);
    throw error;
  }
}

// Test 7: Transitions disabled (should produce base cuts)
async function test7_TransitionsDisabled() {
  const testName = "Test 7: Transitions Disabled (Should Produce Base Cuts)";
  logger.info(`\n${"=".repeat(60)}`);
  logger.info(testName);
  logger.info("=".repeat(60));

  try {
    const jobId = await setupTestJob(uuidv4(), {
      cutPlanData: createCutPlan([
        { start: 0, end: 5 },
        { start: 10, end: 15 },
      ]),
    });

    delete process.env.TRANSITIONS_ENABLED;

    const event = {
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId,
      planKey: keyFor(TEST_ENV, TEST_TENANT, jobId, "plan", "cut_plan.json"),
      sourceVideoKey: keyFor(
        TEST_ENV,
        TEST_TENANT,
        jobId,
        "input",
        path.basename(TEST_VIDEO)
      ),
      transitions: false,
    };

    const context = { awsRequestId: `test-${Date.now()}` };
    const result = await handler(event, context);

    assert(
      result.outputKey.includes("base_cuts.mp4"),
      "Should produce base_cuts.mp4 when transitions disabled"
    );
    assert(result.useTransitions === false, "Should not use transitions");

    const manifest = loadManifest(TEST_ENV, TEST_TENANT, jobId);
    const renderEntry = manifest.renders[manifest.renders.length - 1];
    assert(
      !renderEntry.transition,
      "Should not have transition metadata when disabled"
    );

    logTestResult(testName, true);
  } catch (error) {
    logTestResult(testName, false, error.message);
    throw error;
  }
}

// Test runner
async function runAllTests() {
  logger.info("=".repeat(60));
  logger.info("Video Render Engine Transitions Test Suite");
  logger.info("=".repeat(60));

  const tests = [
    test1_SingleKeepSegment,
    test2_TwoKeepSegments,
    test3_ThreeKeepSegments,
    test4_DurationCalculation,
    test5_Determinism,
    test6_Idempotency,
    test7_TransitionsDisabled,
  ];

  for (const test of tests) {
    try {
      await test();
    } catch (error) {
      logger.error(`Test failed with error: ${error.message}`);
      logger.error(error.stack);
    }
  }

  // Summary
  logger.info("\n" + "=".repeat(60));
  logger.info("Test Summary");
  logger.info("=".repeat(60));
  logger.info(`Total Tests: ${testResults.length}`);
  logger.info(`Passed: ${testsPassed}`);
  logger.info(`Failed: ${testsFailed}`);
  logger.info("=".repeat(60));

  // Print detailed results
  logger.info("\nDetailed Results:");
  testResults.forEach(result => {
    const status = result.passed ? "✅" : "❌";
    logger.info(
      `  ${status} ${result.testName}${result.message ? ` - ${result.message}` : ""}`
    );
  });

  if (testsFailed > 0) {
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(error => {
  logger.error("[FATAL] Test suite failed:", error);
  process.exit(1);
});
