#!/usr/bin/env node
// test-long-video.js
// Test video render engine with the longer Weekly Q&A Session video

import { handler } from "./backend/services/video-render-engine/handler.js";
import { keyFor, pathFor, ensureDirForFile } from "./backend/dist/storage.js";
import { saveManifest, loadManifest } from "./backend/dist/manifest.js";
import fs, { copyFileSync } from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { logger } from "./scripts/logger.js";

// Test configuration
const TEST_ENV = "dev";
const TEST_TENANT = "t-test";
const LONG_VIDEO =
  "podcast-automation/test-assets/raw/Weekly Q&A Session - 2025-07-11 - Includes Rachel discussing certified ip.mp4";

async function testLongVideo() {
  logger.info("=".repeat(60));
  logger.info("Testing Video Render Engine with Long Video");
  logger.info("=".repeat(60));
  logger.info(`Video: ${LONG_VIDEO}`);

  // Check if video exists
  if (!fs.existsSync(LONG_VIDEO)) {
    logger.error(`Video file not found: ${LONG_VIDEO}`);
    process.exit(1);
  }

  const videoStats = fs.statSync(LONG_VIDEO);
  const videoSizeMB = (videoStats.size / (1024 * 1024)).toFixed(2);
  logger.info(`Video size: ${videoSizeMB} MB`);
  logger.info("");

  // Generate a valid UUID for the job
  const jobId = uuidv4();
  logger.info(`Job ID: ${jobId}`);
  logger.info("");

  // Create a simple cut plan that keeps some segments from the longer video
  // For testing, we'll keep segments from the beginning, middle, and end
  const cutPlan = {
    schemaVersion: "1.0.0",
    source: "transcripts/transcript.json",
    output: "plan/cut_plan.json",
    cuts: [
      // Keep first 30 seconds
      { start: "0.00", end: "30.00", type: "keep", reason: "test_segment" },
      // Cut next 30 seconds
      { start: "30.00", end: "60.00", type: "cut", reason: "test_segment" },
      // Keep next 30 seconds
      { start: "60.00", end: "90.00", type: "keep", reason: "test_segment" },
      // Cut next 30 seconds
      { start: "90.00", end: "120.00", type: "cut", reason: "test_segment" },
      // Keep next 30 seconds
      { start: "120.00", end: "150.00", type: "keep", reason: "test_segment" },
    ],
  };

  // Setup test job
  logger.info("Setting up test job...");
  const manifest = {
    schemaVersion: "1.0.0",
    env: TEST_ENV,
    tenantId: TEST_TENANT,
    jobId: jobId,
    status: "processing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Copy video to input location
  const inputKey = keyFor(
    TEST_ENV,
    TEST_TENANT,
    jobId,
    "input",
    path.basename(LONG_VIDEO)
  );
  const inputPath = pathFor(inputKey);
  ensureDirForFile(inputPath);
  logger.info(`Copying video to: ${inputKey}`);
  copyFileSync(LONG_VIDEO, inputPath);
  logger.info("Video copied successfully");

  manifest.input = {
    sourceKey: inputKey,
    originalFilename: path.basename(LONG_VIDEO),
    bytes: videoStats.size,
    mimeType: "video/mp4",
  };

  // Save manifest
  saveManifest(TEST_ENV, TEST_TENANT, jobId, manifest);
  logger.info("Manifest saved");

  // Create cut plan
  const planKey = keyFor(TEST_ENV, TEST_TENANT, jobId, "plan", "cut_plan.json");
  const planPath = pathFor(planKey);
  ensureDirForFile(planPath);
  fs.writeFileSync(planPath, JSON.stringify(cutPlan, null, 2));
  logger.info(`Cut plan saved: ${planKey}`);
  logger.info(
    `  Keep segments: ${cutPlan.cuts.filter(c => c.type === "keep").length}`
  );
  logger.info(
    `  Cut segments: ${cutPlan.cuts.filter(c => c.type === "cut").length}`
  );
  logger.info("");

  // Prepare event
  const sourceVideoKey = keyFor(
    TEST_ENV,
    TEST_TENANT,
    jobId,
    "input",
    path.basename(LONG_VIDEO)
  );
  const event = {
    env: TEST_ENV,
    tenantId: TEST_TENANT,
    jobId: jobId,
    planKey: planKey,
    sourceVideoKey: sourceVideoKey,
    correlationId: `test-long-video-${jobId}`,
  };

  const context = { awsRequestId: `test-long-video-${Date.now()}` };

  // Run the handler
  logger.info("Starting video render engine...");
  logger.info("This may take several minutes for a long video...");
  logger.info("");

  const startTime = Date.now();

  try {
    const result = await handler(event, context);

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000 / 60).toFixed(2);

    logger.info("");
    logger.info("=".repeat(60));
    logger.info("Test Results");
    logger.info("=".repeat(60));
    logger.info(`✅ Processing completed in ${duration} minutes`);
    logger.info(`Result: ${result.ok ? "SUCCESS" : "FAILED"}`);

    if (result.ok) {
      logger.info(`Output key: ${result.outputKey}`);

      // Check output file
      const outputPath = pathFor(result.outputKey);
      if (fs.existsSync(outputPath)) {
        const outputStats = fs.statSync(outputPath);
        const outputSizeMB = (outputStats.size / (1024 * 1024)).toFixed(2);
        logger.info(`Output file size: ${outputSizeMB} MB`);
        logger.info(`Output path: ${outputPath}`);
      }

      // Check manifest
      const finalManifest = loadManifest(TEST_ENV, TEST_TENANT, jobId);
      if (finalManifest.renders && finalManifest.renders.length > 0) {
        const render = finalManifest.renders[0];
        logger.info("");
        logger.info("Render Metadata:");
        logger.info(`  Duration: ${render.durationSec?.toFixed(3)}s`);
        logger.info(`  Resolution: ${render.resolution}`);
        logger.info(`  FPS: ${render.fps}`);
        logger.info(`  Codec: ${render.codec}`);
        logger.info(`  Type: ${render.type}`);
      }
    }

    logger.info("=".repeat(60));
  } catch (error) {
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000 / 60).toFixed(2);

    logger.error("");
    logger.error("=".repeat(60));
    logger.error("Test Failed");
    logger.error("=".repeat(60));
    logger.error(`❌ Processing failed after ${duration} minutes`);
    logger.error(`Error type: ${error.type || "UNKNOWN"}`);
    logger.error(`Error message: ${error.message}`);

    if (error.details) {
      logger.error("Error details:", JSON.stringify(error.details, null, 2));
    }

    logger.error("=".repeat(60));
    process.exit(1);
  }
}

testLongVideo().catch(error => {
  logger.error("Test failed:", error);
  process.exit(1);
});
