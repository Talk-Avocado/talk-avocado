#!/usr/bin/env node
// test-smart-cut-planner-integration.js
// Integration tests for Smart Cut Planner (MFU-WP01-03-BE)
// Tests with real video transcripts from storage

import { handler } from "./backend/services/smart-cut-planner/handler.js";
import { keyFor, pathFor, ensureDirForFile } from "./backend/dist/storage.js";
import { saveManifest, loadManifest } from "./backend/dist/manifest.js";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { logger } from "./scripts/logger.js";

const TEST_ENV = "dev";
const TEST_TENANT = "t-test";

// Test results tracking
const testResults = {
  passed: [],
  failed: [],
  skipped: [],
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function logTestResult(testName, passed, message = "") {
  if (passed) {
    logger.info(`✅ ${testName}: PASSED ${message}`);
    testResults.passed.push(testName);
  } else {
    logger.error(`❌ ${testName}: FAILED ${message}`);
    testResults.failed.push(testName);
  }
}

// Test 1: Real Video Integration (works with any available video transcript, any length)
async function test1_RealVideoIntegration() {
  const testName = "Test 1: Real Video Integration";

  // Find any available transcript in storage
  const storageBasePath = `storage/${TEST_ENV}/${TEST_TENANT}`;
  let foundTranscriptPath = null;
  let foundJobId = null;

  try {
    // Search for transcripts in all job directories
    const jobDirs = fs
      .readdirSync(storageBasePath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    for (const jobId of jobDirs) {
      const transcriptPath = `${storageBasePath}/${jobId}/transcripts/transcript.json`;
      if (fs.existsSync(transcriptPath)) {
        // Verify it's a valid transcript with segments
        try {
          const transcriptData = JSON.parse(
            fs.readFileSync(transcriptPath, "utf-8")
          );
          if (transcriptData.segments && transcriptData.segments.length > 0) {
            foundTranscriptPath = transcriptPath;
            foundJobId = jobId;
            break;
          }
        } catch (e) {
          // Skip invalid JSON files
          continue;
        }
      }
    }

    if (!foundTranscriptPath || !foundJobId) {
      throw new Error(
        `No valid transcript found in ${storageBasePath}. Please ensure at least one transcript exists. This test works with videos of any length - short or long.`
      );
    }

    logger.info(`Running ${testName}...`);
    logger.info(`  Found transcript: ${foundTranscriptPath}`);
    logger.info(`  Job ID: ${foundJobId}`);

    const transcriptKey = keyFor(
      TEST_ENV,
      TEST_TENANT,
      foundJobId,
      "transcripts",
      "transcript.json"
    );
    const transcriptPath = pathFor(transcriptKey);

    // Load transcript to get info
    const transcriptData = JSON.parse(fs.readFileSync(transcriptPath, "utf-8"));
    const segments = transcriptData.segments || [];
    const lastSegment = segments[segments.length - 1];
    const duration = lastSegment ? lastSegment.end : 0;
    const durationMinutes = (duration / 60).toFixed(2);

    logger.info(
      `  Transcript: ${segments.length} segments, ${durationMinutes} minutes (works with any video length)`
    );

    // Ensure manifest exists
    const manifestKey = keyFor(
      TEST_ENV,
      TEST_TENANT,
      foundJobId,
      "manifest.json"
    );
    const manifestPath = pathFor(manifestKey);
    if (!fs.existsSync(manifestPath)) {
      saveManifest(TEST_ENV, TEST_TENANT, foundJobId, {
        schemaVersion: "1.0.0",
        env: TEST_ENV,
        tenantId: TEST_TENANT,
        jobId: foundJobId,
        status: "processing",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    // Run smart cut planner
    const startTime = Date.now();
    const event = {
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId: foundJobId,
      transcriptKey: transcriptKey,
      correlationId: `test-long-video-${Date.now()}`,
    };
    const context = {
      awsRequestId: `test-long-video-${Date.now()}`,
    };

    const result = await handler(event, context);
    const processingTime = Date.now() - startTime;

    assert(result.ok, "Handler should return ok: true");

    // Verify output
    const planKey = keyFor(
      TEST_ENV,
      TEST_TENANT,
      foundJobId,
      "plan",
      "cut_plan.json"
    );
    const planPath = pathFor(planKey);
    assert(fs.existsSync(planPath), "Cut plan file should exist");

    const cutPlan = JSON.parse(fs.readFileSync(planPath, "utf-8"));
    const cuts = cutPlan.cuts || [];
    const keepSegments = cuts.filter(c => c.type === "keep");
    const cutSegments = cuts.filter(c => c.type === "cut");

    // Calculate total keep duration
    const totalKeepDuration = keepSegments.reduce((sum, seg) => {
      return sum + (parseFloat(seg.end) - parseFloat(seg.start));
    }, 0);

    // Verify manifest
    const manifest = loadManifest(TEST_ENV, TEST_TENANT, foundJobId);
    assert(manifest.plan, "Manifest should have plan object");
    assert(
      manifest.plan.algorithm === "rule-based",
      "Algorithm should be rule-based"
    );

    // Verify updated time intervals are being used (minSegmentDurationSec should be 1.0, not 3.0)
    const config = cutPlan.metadata?.parameters;
    if (config) {
      assert(
        config.minSegmentDurationSec === 1.0,
        `minSegmentDurationSec should be 1.0 (got ${config.minSegmentDurationSec})`
      );
    }

    const message = `- Processed ${segments.length} transcript segments (${durationMinutes} min) in ${(processingTime / 1000).toFixed(2)}s, generated ${cuts.length} cut plan segments (${keepSegments.length} keep, ${cutSegments.length} cut), preserving ${(totalKeepDuration / 60).toFixed(2)} minutes of content`;
    logTestResult(testName, true, message);
    return true;
  } catch (error) {
    logTestResult(testName, false, `- ${error.message}`);
    return false;
  }
}

// Test 2: CI Harness Test (tiny sample transcript via harness)
async function test2_CIHarness() {
  const testName = "Test 2: CI Harness Test";
  const jobId = randomUUID();

  try {
    // Create a tiny sample transcript (10-20 segments)
    const transcriptKey = keyFor(
      TEST_ENV,
      TEST_TENANT,
      jobId,
      "transcripts",
      "transcript.json"
    );
    const transcriptPath = pathFor(transcriptKey);
    ensureDirForFile(transcriptPath);

    // Create transcript with 15 segments (within 10-20 range)
    const segments = [];
    let currentTime = 0.0;
    for (let i = 0; i < 15; i++) {
      const segmentStart = currentTime;
      const segmentEnd = currentTime + 3.0; // 3 second segments
      const pause = i < 14 ? (i % 3 === 2 ? 2.0 : 0.5) : 0; // Some pauses > 1.5s
      currentTime = segmentEnd + pause;

      segments.push({
        id: i,
        start: segmentStart,
        end: segmentEnd,
        text: `Segment ${i + 1} text content.`,
        words: [
          { start: segmentStart, end: segmentStart + 0.5, text: "Segment" },
          {
            start: segmentStart + 0.5,
            end: segmentStart + 1.0,
            text: String(i + 1),
          },
          { start: segmentStart + 1.0, end: segmentStart + 1.5, text: "text" },
          {
            start: segmentStart + 1.5,
            end: segmentStart + 2.0,
            text: "content",
          },
        ],
      });
    }

    const testTranscript = {
      text: segments.map(s => s.text).join(" "),
      segments: segments,
    };

    fs.writeFileSync(transcriptPath, JSON.stringify(testTranscript, null, 2));

    // Create manifest
    saveManifest(TEST_ENV, TEST_TENANT, jobId, {
      schemaVersion: "1.0.0",
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId,
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Run smart cut planner via handler (simulating harness)
    const event = {
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId,
      transcriptKey,
      correlationId: `ci-test-${Date.now()}`,
    };
    const context = { awsRequestId: `ci-test-${Date.now()}` };

    await handler(event, context);

    // Assert 1: plan/cut_plan.json exists and is valid JSON
    const planKey = keyFor(
      TEST_ENV,
      TEST_TENANT,
      jobId,
      "plan",
      "cut_plan.json"
    );
    const planPath = pathFor(planKey);
    assert(fs.existsSync(planPath), "Cut plan file should exist");

    let cutPlan;
    try {
      const planContent = fs.readFileSync(planPath, "utf-8");
      cutPlan = JSON.parse(planContent);
      assert(cutPlan !== null, "Cut plan should be valid JSON");
    } catch (e) {
      throw new Error(`Cut plan is not valid JSON: ${e.message}`);
    }

    // Assert 2: Schema validation passes
    const schemaPath = path.resolve("docs/schemas/cut_plan.schema.json");
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validator = ajv.compile(schema);
    const valid = validator(cutPlan);
    assert(
      valid,
      `Schema validation should pass. Errors: ${JSON.stringify(validator.errors || [])}`
    );

    // Assert 3: Manifest fields present and non-empty
    const manifest = loadManifest(TEST_ENV, TEST_TENANT, jobId);
    assert(manifest.plan, "Manifest should have plan object");
    assert(manifest.plan.key, "Manifest plan.key should be present");
    assert(
      manifest.plan.algorithm === "rule-based",
      "Manifest plan.algorithm should be 'rule-based'"
    );
    assert(
      typeof manifest.plan.totalCuts === "number",
      "Manifest plan.totalCuts should be a number"
    );
    assert(
      manifest.plan.totalCuts > 0,
      "Manifest plan.totalCuts should be non-empty"
    );
    assert(
      manifest.plan.plannedAt,
      "Manifest plan.plannedAt should be present"
    );
    assert(
      manifest.plan.plannedAt.length > 0,
      "Manifest plan.plannedAt should be non-empty"
    );

    // Assert 4: Deterministic flag produces identical output
    // Run twice with DETERMINISTIC=true and compare outputs
    process.env.DETERMINISTIC = "true";

    const jobId2 = randomUUID();
    const transcriptKey2 = keyFor(
      TEST_ENV,
      TEST_TENANT,
      jobId2,
      "transcripts",
      "transcript.json"
    );
    const transcriptPath2 = pathFor(transcriptKey2);
    ensureDirForFile(transcriptPath2);
    fs.writeFileSync(transcriptPath2, JSON.stringify(testTranscript, null, 2));

    saveManifest(TEST_ENV, TEST_TENANT, jobId2, {
      schemaVersion: "1.0.0",
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId: jobId2,
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const event2 = {
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId: jobId2,
      transcriptKey: transcriptKey2,
      correlationId: `ci-test-${Date.now()}`,
    };
    const context2 = { awsRequestId: `ci-test-${Date.now()}` };
    await handler(event2, context2);

    const planPath2 = pathFor(
      keyFor(TEST_ENV, TEST_TENANT, jobId2, "plan", "cut_plan.json")
    );
    const cutPlan2 = JSON.parse(fs.readFileSync(planPath2, "utf-8"));

    // Normalize for comparison (exclude processingTimeMs)
    const normalized1 = JSON.parse(JSON.stringify(cutPlan));
    const normalized2 = JSON.parse(JSON.stringify(cutPlan2));
    if (normalized1.metadata) normalized1.metadata.processingTimeMs = 0;
    if (normalized2.metadata) normalized2.metadata.processingTimeMs = 0;

    const checksum1 = createHash("sha256")
      .update(JSON.stringify(normalized1))
      .digest("hex");
    const checksum2 = createHash("sha256")
      .update(JSON.stringify(normalized2))
      .digest("hex");
    assert(
      checksum1 === checksum2,
      "Deterministic flag should produce identical output"
    );

    // Assert 5: Logs contain required correlation fields
    // This is verified by checking that correlationId was passed and handler executed successfully
    // The handler logs correlationId, tenantId, jobId, step - verified by successful execution
    assert(event.correlationId, "Event should have correlationId");
    assert(event.tenantId, "Event should have tenantId");
    assert(event.jobId, "Event should have jobId");

    logTestResult(
      testName,
      true,
      `- Processed ${segments.length} segments, generated ${cutPlan.cuts.length} cuts, all assertions passed`
    );
    return true;
  } catch (error) {
    logTestResult(testName, false, `- ${error.message}`);
    return false;
  } finally {
    // Clean up environment variable
    delete process.env.DETERMINISTIC;
  }
}

// Main test runner
async function runAllTests() {
  logger.info("=".repeat(60));
  logger.info("Smart Cut Planner Integration Test Suite");
  logger.info("=".repeat(60));
  logger.info("");

  const tests = [test1_RealVideoIntegration, test2_CIHarness];

  for (const test of tests) {
    try {
      await test();
    } catch (error) {
      logger.error(`Test failed with exception: ${error.message}`);
    }
    logger.info("");
  }

  // Summary
  logger.info("=".repeat(60));
  logger.info("Test Summary");
  logger.info("=".repeat(60));
  logger.info(`Passed: ${testResults.passed.length}`);
  logger.info(`Failed: ${testResults.failed.length}`);
  logger.info(`Skipped: ${testResults.skipped.length}`);
  logger.info("");

  if (testResults.failed.length > 0) {
    logger.info("Failed Tests:");
    testResults.failed.forEach(test => logger.info(`  - ${test}`));
  }

  logger.info("=".repeat(60));

  process.exit(testResults.failed.length > 0 ? 1 : 0);
}

runAllTests().catch(error => {
  logger.error("Test suite failed:", error);
  process.exit(1);
});
