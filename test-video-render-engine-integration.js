#!/usr/bin/env node
// test-video-render-engine-integration.js
// Integration tests for Video Render Engine (MFU-WP01-04-BE)
// Tests with real videos and cut plans from storage

import { handler } from "./backend/services/video-render-engine/handler.js";
import { keyFor, pathFor } from "./backend/dist/storage.js";
import { loadManifest } from "./backend/dist/manifest.js";
import fs from "node:fs";
import { logger } from "./scripts/logger.js";

// Test configuration
const TEST_ENV = "dev";
const TEST_TENANT = "t-test";

// Test results tracking
const testResults = [];
let testsPassed = 0;
let testsFailed = 0;

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

// Test 1: Real Video Integration (works with any available video and cut plan, any length)
async function test1_RealVideoIntegration() {
  const testName = "Test 1: Real Video Integration";
  logger.info(`\n=== ${testName} ===`);

  try {
    // Find any available cut plan in storage
    const storageBasePath = `storage/${TEST_ENV}/${TEST_TENANT}`;
    let foundPlanPath = null;
    let foundJobId = null;
    let foundVideoPath = null;

    // Search for cut plans in all job directories
    if (fs.existsSync(storageBasePath)) {
      const jobDirs = fs
        .readdirSync(storageBasePath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

      for (const jobId of jobDirs) {
        const planPath = `${storageBasePath}/${jobId}/plan/cut_plan.json`;
        if (fs.existsSync(planPath)) {
          // Verify it's a valid cut plan
          try {
            const cutPlan = JSON.parse(fs.readFileSync(planPath, "utf-8"));
            if (cutPlan.cuts && cutPlan.cuts.length > 0) {
              // Check if source video exists
              const manifestPath = `${storageBasePath}/${jobId}/manifest.json`;
              if (fs.existsSync(manifestPath)) {
                const manifest = JSON.parse(
                  fs.readFileSync(manifestPath, "utf-8")
                );
                const sourceVideoKey =
                  manifest.sourceVideoKey || manifest.input?.sourceKey;
                if (sourceVideoKey) {
                  const videoPath = pathFor(sourceVideoKey);
                  if (fs.existsSync(videoPath)) {
                    foundPlanPath = planPath;
                    foundJobId = jobId;
                    foundVideoPath = videoPath;
                    break;
                  }
                }
              }
            }
          } catch (e) {
            // Skip invalid JSON files
            continue;
          }
        }
      }
    }

    if (!foundPlanPath || !foundJobId || !foundVideoPath) {
      logger.info(
        "  No valid cut plan and video found in storage. Skipping integration test."
      );
      logger.info("  To run this test, ensure you have:");
      logger.info(
        "    1. A job with a cut plan at: storage/dev/t-test/{jobId}/plan/cut_plan.json"
      );
      logger.info("    2. A source video referenced in the manifest");
      logTestResult(
        testName,
        true,
        "Skipped - no test data available (this is OK)"
      );
      return true;
    }

    logger.info(`  Found cut plan: ${foundPlanPath}`);
    logger.info(`  Found video: ${foundVideoPath}`);
    logger.info(`  Job ID: ${foundJobId}`);

    // Load cut plan to get info
    const cutPlan = JSON.parse(fs.readFileSync(foundPlanPath, "utf-8"));
    const keepSegments = cutPlan.cuts.filter(c => c.type === "keep");
    const totalKeepDuration = keepSegments.reduce((sum, seg) => {
      return sum + (parseFloat(seg.end) - parseFloat(seg.start));
    }, 0);

    logger.info(
      `  Cut Plan: ${cutPlan.cuts.length} segments (${keepSegments.length} keep, ${cutPlan.cuts.length - keepSegments.length} cut)`
    );
    logger.info(
      `  Total Keep Duration: ${(totalKeepDuration / 60).toFixed(2)} minutes (${totalKeepDuration.toFixed(2)}s)`
    );

    // Load manifest
    const manifest = loadManifest(TEST_ENV, TEST_TENANT, foundJobId);
    const sourceVideoKey = manifest.sourceVideoKey || manifest.input?.sourceKey;
    const planKey = keyFor(
      TEST_ENV,
      TEST_TENANT,
      foundJobId,
      "plan",
      "cut_plan.json"
    );

    // Run video render engine
    const startTime = Date.now();
    const event = {
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId: foundJobId,
      planKey,
      sourceVideoKey,
      correlationId: `test-real-video-${Date.now()}`,
    };
    const context = { awsRequestId: `test-real-video-${Date.now()}` };

    const result = await handler(event, context);
    const processingTime = Date.now() - startTime;

    assert(result.ok === true, "Handler should return ok: true");

    // Verify output
    const outputKey = keyFor(
      TEST_ENV,
      TEST_TENANT,
      foundJobId,
      "renders",
      "base_cuts.mp4"
    );
    const outputPath = pathFor(outputKey);
    assert(fs.existsSync(outputPath), "Output video should exist");

    // Check manifest updated
    const finalManifest = loadManifest(TEST_ENV, TEST_TENANT, foundJobId);
    assert(
      finalManifest.renders && finalManifest.renders.length > 0,
      "Manifest should have renders entry"
    );

    const render = finalManifest.renders[0];
    const outputStats = fs.statSync(outputPath);
    const outputSizeMB = (outputStats.size / (1024 * 1024)).toFixed(2);

    logger.info(
      `  ✅ Processing completed in ${(processingTime / 1000).toFixed(2)}s`
    );
    logger.info(`  Output Video: ${outputSizeMB} MB`);
    logger.info(
      `  Duration: ${render.durationSec?.toFixed(2)}s (${(render.durationSec / 60).toFixed(2)} minutes)`
    );
    logger.info(`  Resolution: ${render.resolution}`);
    logger.info(`  FPS: ${render.fps}`);

    logTestResult(
      testName,
      true,
      `Processed ${cutPlan.cuts.length} segments (${keepSegments.length} keep), generated ${outputSizeMB} MB video in ${(processingTime / 1000).toFixed(2)}s`
    );
    return true;
  } catch (error) {
    logTestResult(testName, false, error.message);
    throw error;
  }
}

// Test runner
async function runAllTests() {
  logger.info("=".repeat(60));
  logger.info("Video Render Engine Integration Test Suite");
  logger.info("=".repeat(60));

  const tests = [test1_RealVideoIntegration];

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
  logger.error("Fatal error running tests:", error);
  process.exit(1);
});
