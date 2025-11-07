#!/usr/bin/env node
// test-video-render-specific-job.js
// Test video render engine with a specific job's cut plan

import { handler } from "./backend/services/video-render-engine/handler-simple.cjs";
import { keyFor, pathFor, ensureDirForFile } from "./backend/dist/storage.js";
import { loadManifest, saveManifest } from "./backend/dist/manifest.js";
import fs from "node:fs";
import path from "node:path";
import { logger } from "./scripts/logger.js";

// Test configuration
const TEST_ENV = "dev";
const TEST_TENANT = "t-test";
const JOB_ID = "cc9fde8e-eb0c-4398-a895-625d874a89e9";

async function testVideoRenderSpecificJob() {
  logger.info("=".repeat(60));
  logger.info("Testing Video Render Engine with Specific Job");
  logger.info("=".repeat(60));
  logger.info(`Job ID: ${JOB_ID}`);
  logger.info("");

  // Check if cut plan exists
  const planKey = keyFor(
    TEST_ENV,
    TEST_TENANT,
    JOB_ID,
    "plan",
    "cut_plan.json"
  );
  const planPath = pathFor(planKey);

  if (!fs.existsSync(planPath)) {
    logger.error(`Cut plan not found: ${planPath}`);
    process.exit(1);
  }

  const cutPlan = JSON.parse(fs.readFileSync(planPath, "utf-8"));
  const keepSegments = cutPlan.cuts.filter(c => c.type === "keep");
  const cutSegments = cutPlan.cuts.filter(c => c.type === "cut");
  const totalKeepDuration = keepSegments.reduce((sum, seg) => {
    return sum + (parseFloat(seg.end) - parseFloat(seg.start));
  }, 0);

  logger.info("Cut Plan Summary:");
  logger.info(`  Total Segments: ${cutPlan.cuts.length}`);
  logger.info(`  Keep Segments: ${keepSegments.length}`);
  logger.info(`  Cut Segments: ${cutSegments.length}`);
  logger.info(
    `  Total Keep Duration: ${totalKeepDuration.toFixed(2)}s (${(totalKeepDuration / 60).toFixed(2)} minutes)`
  );
  logger.info("");

  // Load or create manifest
  let manifest;
  const manifestPath = pathFor(
    keyFor(TEST_ENV, TEST_TENANT, JOB_ID, "manifest.json")
  );
  if (fs.existsSync(manifestPath)) {
    manifest = loadManifest(TEST_ENV, TEST_TENANT, JOB_ID);
    logger.info("Loaded existing manifest");
  } else {
    manifest = {
      schemaVersion: "1.0.0",
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId: JOB_ID,
      status: "processing",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveManifest(TEST_ENV, TEST_TENANT, JOB_ID, manifest);
    logger.info("Created new manifest");
  }

  // Resolve source video
  let sourceVideoKey = manifest.sourceVideoKey || manifest.input?.sourceKey;
  let sourcePath = null;

  if (sourceVideoKey) {
    sourcePath = pathFor(sourceVideoKey);
  }

  // If source video doesn't exist, try to find it in input folder
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    const inputDir = pathFor(
      keyFor(TEST_ENV, TEST_TENANT, JOB_ID, "input", "")
    );
    if (fs.existsSync(inputDir)) {
      const files = fs
        .readdirSync(inputDir)
        .filter(f => f.endsWith(".mp4") || f.endsWith(".mov"));
      if (files.length > 0) {
        const videoFile = files[0];
        sourceVideoKey = keyFor(
          TEST_ENV,
          TEST_TENANT,
          JOB_ID,
          "input",
          videoFile
        );
        sourcePath = pathFor(sourceVideoKey);
        logger.info(`Found video in input folder: ${videoFile}`);
      }
    }
  }

  // If still not found, try sample-short.mp4 from test assets
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    const testVideoPath = path.join(
      "podcast-automation",
      "test-assets",
      "raw",
      "sample-short.mp4"
    );
    if (fs.existsSync(testVideoPath)) {
      sourceVideoKey = keyFor(
        TEST_ENV,
        TEST_TENANT,
        JOB_ID,
        "input",
        "sample-short.mp4"
      );
      sourcePath = pathFor(sourceVideoKey);
      ensureDirForFile(sourcePath);
      fs.copyFileSync(testVideoPath, sourcePath);
      logger.info(`Copied test video to input folder: ${sourcePath}`);

      // Update manifest
      manifest.sourceVideoKey = sourceVideoKey;
      manifest.input = {
        sourceKey: sourceVideoKey,
        originalFilename: "sample-short.mp4",
        bytes: fs.statSync(sourcePath).size,
        mimeType: "video/mp4",
      };
      saveManifest(TEST_ENV, TEST_TENANT, JOB_ID, manifest);
      logger.info("Updated manifest with source video info");
    }
  }

  if (!sourcePath || !fs.existsSync(sourcePath)) {
    logger.error(`Source video not found. Tried:`);
    logger.error(`  - ${sourceVideoKey ? pathFor(sourceVideoKey) : "N/A"}`);
    logger.error(
      `  - Input folder: ${pathFor(keyFor(TEST_ENV, TEST_TENANT, JOB_ID, "input", ""))}`
    );
    logger.error(
      `  - Test assets: podcast-automation/test-assets/raw/sample-short.mp4`
    );
    process.exit(1);
  }

  const sourceStats = fs.statSync(sourcePath);
  const sourceSizeMB = (sourceStats.size / (1024 * 1024)).toFixed(2);
  logger.info("Source Video:");
  logger.info(`  Key: ${sourceVideoKey}`);
  logger.info(`  Path: ${sourcePath}`);
  logger.info(`  Size: ${sourceSizeMB} MB`);
  logger.info("");

  // Prepare event
  const event = {
    env: TEST_ENV,
    tenantId: TEST_TENANT,
    jobId: JOB_ID,
    planKey: planKey,
    sourceVideoKey: sourceVideoKey,
    correlationId: `test-video-render-${JOB_ID}-${Date.now()}`,
  };

  const context = {
    awsRequestId: `test-video-render-${Date.now()}`,
  };

  // Run video render engine
  logger.info("Starting Video Render Engine...");
  logger.info("");

  const startTime = Date.now();

  try {
    await handler(event, context);

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    logger.info("");
    logger.info("=".repeat(60));
    logger.info("Test Results");
    logger.info("=".repeat(60));
    logger.info(`✅ Processing completed in ${duration} seconds`);
    logger.info("");

    // Check output file
    const outputKey = keyFor(
      TEST_ENV,
      TEST_TENANT,
      JOB_ID,
      "renders",
      "base_cuts.mp4"
    );
    const outputPath = pathFor(outputKey);

    if (fs.existsSync(outputPath)) {
      const outputStats = fs.statSync(outputPath);
      const outputSizeMB = (outputStats.size / (1024 * 1024)).toFixed(2);
      logger.info("Output Video:");
      logger.info(`  Storage Key: ${outputKey}`);
      logger.info(`  Full Path: ${outputPath}`);
      logger.info(`  Size: ${outputSizeMB} MB`);
      logger.info("");

      // Load final manifest
      const finalManifest = loadManifest(TEST_ENV, TEST_TENANT, JOB_ID);
      if (finalManifest.renders && finalManifest.renders.length > 0) {
        const render = finalManifest.renders[0];
        logger.info("Render Metadata:");
        logger.info(`  Duration: ${render.durationSec?.toFixed(2)}s`);
        logger.info(`  Resolution: ${render.resolution}`);
        logger.info(`  FPS: ${render.fps}`);
        logger.info(`  Codec: ${render.codec}`);
        logger.info(`  Type: ${render.type}`);
        logger.info(`  Rendered At: ${render.renderedAt}`);
        logger.info("");

        logger.info("=".repeat(60));
        logger.info("✅ Test completed successfully!");
        logger.info("");
        logger.info("Rendered video location:");
        logger.info(`  Storage Key: ${outputKey}`);
        logger.info(`  Full Path: ${outputPath}`);
        logger.info("=".repeat(60));

        return {
          outputKey,
          outputPath,
          render,
          outputSizeMB,
        };
      } else {
        logger.warn("No render metadata found in manifest");
      }
    } else {
      logger.error(`Output file not found: ${outputPath}`);
      process.exit(1);
    }
  } catch (error) {
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    logger.error("");
    logger.error("=".repeat(60));
    logger.error("Test Failed");
    logger.error("=".repeat(60));
    logger.error(`❌ Processing failed after ${duration} seconds`);
    logger.error(`Error type: ${error.type || "UNKNOWN"}`);
    logger.error(`Error message: ${error.message || String(error)}`);
    logger.error(
      `Error details: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`
    );
    logger.error("");

    if (error.stack) {
      logger.error("Stack trace:");
      logger.error(error.stack);
    }

    logger.error("=".repeat(60));
    process.exit(1);
  }
}

testVideoRenderSpecificJob()
  .then(result => {
    if (result) {
      logger.info("");
      logger.info("Summary:");
      logger.info(`  Output Key: ${result.outputKey}`);
      logger.info(`  Output Path: ${result.outputPath}`);
      logger.info(`  Size: ${result.outputSizeMB} MB`);
      logger.info(`  Duration: ${result.render.durationSec?.toFixed(2)}s`);
    }
  })
  .catch(error => {
    logger.error("Test failed:", error);
    process.exit(1);
  });
