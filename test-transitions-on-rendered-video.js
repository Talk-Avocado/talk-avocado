#!/usr/bin/env node
// test-transitions-on-rendered-video.js
// Test video engine transitions on an already-rendered base_cuts.mp4 video
//
// Usage:
//   node test-transitions-on-rendered-video.js [jobId-with-base-cuts]
//
// Example:
//   node test-transitions-on-rendered-video.js 872d6765-2d60-4806-aa8f-b9df56f74c03

import { handler } from "./backend/services/video-render-engine/handler.js";
import { keyFor, pathFor, ensureDirForFile } from "./backend/dist/storage.js";
import { saveManifest, loadManifest } from "./backend/dist/manifest.js";
import { probe } from "./backend/services/video-render-engine/renderer-logic.js";
import fs, { copyFileSync } from "node:fs";
import { v4 as uuidv4 } from "uuid";
import { logger } from "./scripts/logger.js";

// Test configuration
const TEST_ENV = "dev";
const TEST_TENANT = "t-test-transitions";

// Default job ID with the 59-minute rendered video
const DEFAULT_JOB_ID = "872d6765-2d60-4806-aa8f-b9df56f74c03";

async function testTransitionsOnRenderedVideo(jobIdWithBaseCuts) {
  logger.info("=".repeat(60));
  logger.info("Testing Video Engine Transitions on Rendered Video");
  logger.info("=".repeat(60));

  const sourceJobId = jobIdWithBaseCuts || DEFAULT_JOB_ID;
  logger.info(`Using source job: ${sourceJobId}`);

  // Find the base_cuts.mp4 file
  const baseCutsKey = keyFor(
    TEST_ENV,
    "t-test",
    sourceJobId,
    "renders",
    "base_cuts.mp4"
  );
  const baseCutsPath = pathFor(baseCutsKey);

  if (!fs.existsSync(baseCutsPath)) {
    logger.error(`Base cuts video not found: ${baseCutsPath}`);
    logger.info("\nLooking for base_cuts.mp4 files...");
    const storageBasePath = `storage/${TEST_ENV}/t-test`;
    if (fs.existsSync(storageBasePath)) {
      const jobDirs = fs
        .readdirSync(storageBasePath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

      for (const jobId of jobDirs) {
        const baseCuts = `${storageBasePath}/${jobId}/renders/base_cuts.mp4`;
        if (fs.existsSync(baseCuts)) {
          const stats = fs.statSync(baseCuts);
          const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
          logger.info(`  - ${jobId}: ${sizeMB} MB`);
        }
      }
    }
    process.exit(1);
  }

  const videoStats = fs.statSync(baseCutsPath);
  const videoSizeMB = (videoStats.size / (1024 * 1024)).toFixed(2);
  logger.info(`Base Cuts Video: ${baseCutsPath}`);
  logger.info(`Video Size: ${videoSizeMB} MB`);

  // Probe the video to get duration
  const probeResult = await probe(baseCutsPath);
  const durationSec = Number(probeResult.format?.duration || 0);
  logger.info(
    `Video Duration: ${durationSec.toFixed(2)}s (${(durationSec / 60).toFixed(2)} minutes)`
  );
  logger.info("");

  // Load the cut plan from the source job
  const sourcePlanKey = keyFor(
    TEST_ENV,
    "t-test",
    sourceJobId,
    "plan",
    "cut_plan.json"
  );
  const sourcePlanPath = pathFor(sourcePlanKey);

  if (!fs.existsSync(sourcePlanPath)) {
    logger.error(`Cut plan not found: ${sourcePlanPath}`);
    process.exit(1);
  }

  const cutPlan = JSON.parse(fs.readFileSync(sourcePlanPath, "utf-8"));
  const originalKeepSegments = cutPlan.cuts.filter(c => c.type === "keep");
  logger.info(
    `Cut Plan: ${originalKeepSegments.length} keep segment(s), ${cutPlan.cuts.length - originalKeepSegments.length} cut segment(s)`
  );
  logger.info("");

  if (originalKeepSegments.length < 2) {
    logger.error("Need at least 2 keep segments for transitions!");
    process.exit(1);
  }

  // Create a new job for transitions
  const newJobId = uuidv4();
  logger.info(`New Job ID: ${newJobId}`);
  logger.info("");

  // Copy base_cuts.mp4 to the new job's input folder
  const inputKey = keyFor(
    TEST_ENV,
    TEST_TENANT,
    newJobId,
    "input",
    "base_cuts.mp4"
  );
  const inputPath = pathFor(inputKey);
  ensureDirForFile(inputPath);
  copyFileSync(baseCutsPath, inputPath);
  logger.info(`Copied base_cuts.mp4 to: ${inputPath}`);

  // Remap cut plan timestamps to base_cuts.mp4 timeline
  // Since base_cuts.mp4 already has cuts applied, segments are concatenated
  // We need to calculate where each segment appears in the base_cuts.mp4 timeline
  logger.info("Remapping cut plan timestamps to base_cuts.mp4 timeline...");
  let cumulativeTime = 0;
  const remappedCuts = [];

  for (const cut of cutPlan.cuts) {
    if (cut.type === "keep") {
      const segmentDuration = parseFloat(cut.end) - parseFloat(cut.start);
      const remappedCut = {
        ...cut,
        start: cumulativeTime.toFixed(2),
        end: (cumulativeTime + segmentDuration).toFixed(2),
      };
      remappedCuts.push(remappedCut);
      cumulativeTime += segmentDuration;
    }
    // Skip cut segments since they're already removed in base_cuts.mp4
  }

  const remappedCutPlan = {
    ...cutPlan,
    cuts: remappedCuts,
  };

  logger.info(
    `Remapped ${remappedCuts.length} keep segments to base_cuts.mp4 timeline`
  );
  logger.info(`Total duration in base_cuts.mp4: ${cumulativeTime.toFixed(2)}s`);
  logger.info("");

  // Copy remapped cut plan to new job
  const planKey = keyFor(
    TEST_ENV,
    TEST_TENANT,
    newJobId,
    "plan",
    "cut_plan.json"
  );
  const planPath = pathFor(planKey);
  ensureDirForFile(planPath);
  fs.writeFileSync(planPath, JSON.stringify(remappedCutPlan, null, 2));
  logger.info(`Saved remapped cut plan to: ${planPath}`);

  // Create manifest
  const manifest = {
    schemaVersion: "1.0.0",
    env: TEST_ENV,
    tenantId: TEST_TENANT,
    jobId: newJobId,
    status: "processing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    input: {
      sourceKey: inputKey,
      originalFilename: "base_cuts.mp4",
      bytes: videoStats.size,
      mimeType: "video/mp4",
    },
  };
  saveManifest(TEST_ENV, TEST_TENANT, newJobId, manifest);

  // Enable transitions
  process.env.TRANSITIONS_ENABLED = "true";
  process.env.TRANSITIONS_DURATION_MS = "300";
  process.env.TRANSITIONS_AUDIO_FADE_MS = "300";

  // Prepare event
  const sourceVideoKey = inputKey;

  const event = {
    env: TEST_ENV,
    tenantId: TEST_TENANT,
    jobId: newJobId,
    planKey,
    sourceVideoKey,
    transitions: true,
    correlationId: `test-transitions-${newJobId}-${Date.now()}`,
  };

  const context = { awsRequestId: `test-transitions-${Date.now()}` };

  const remappedKeepSegments = remappedCutPlan.cuts.filter(
    c => c.type === "keep"
  );

  logger.info("Running video render engine with transitions...");
  logger.info(
    `Processing ${remappedKeepSegments.length} keep segments with ${remappedKeepSegments.length - 1} transitions...`
  );
  logger.info("");

  try {
    const startTime = Date.now();
    const result = await handler(event, context);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    logger.info("");
    logger.info("=".repeat(60));
    logger.info("✅ SUCCESS - Transitions Applied");
    logger.info("=".repeat(60));
    logger.info(`Processing Time: ${duration}s`);
    logger.info(`Output Key: ${result.outputKey}`);
    logger.info(`Used Transitions: ${result.useTransitions ? "Yes" : "No"}`);
    logger.info(`Joins: ${result.joins || 0}`);

    // Load manifest to get render details
    const finalManifest = loadManifest(TEST_ENV, TEST_TENANT, newJobId);
    const renderEntry = finalManifest.renders[finalManifest.renders.length - 1];

    if (renderEntry) {
      logger.info("");
      logger.info("Output Details:");
      logger.info(
        `  Duration: ${renderEntry.durationSec.toFixed(2)}s (${(renderEntry.durationSec / 60).toFixed(2)} minutes)`
      );
      logger.info(`  Resolution: ${renderEntry.resolution}`);
      logger.info(`  FPS: ${renderEntry.fps}`);

      if (renderEntry.transition) {
        logger.info("");
        logger.info("Transition Details:");
        logger.info(`  Type: ${renderEntry.transition.type}`);
        logger.info(`  Duration: ${renderEntry.transition.durationMs}ms`);
        logger.info(`  Audio Fade: ${renderEntry.transition.audioFadeMs}ms`);
      }

      // Calculate expected duration
      const totalKeepDuration = remappedKeepSegments.reduce((sum, seg) => {
        return sum + (parseFloat(seg.end) - parseFloat(seg.start));
      }, 0);
      const joins = remappedKeepSegments.length - 1;
      const transitionOverlap =
        (parseFloat(process.env.TRANSITIONS_DURATION_MS) / 1000) * joins;
      const expectedDuration = totalKeepDuration - transitionOverlap;
      const actualDuration = renderEntry.durationSec;
      const durationDiff = Math.abs(actualDuration - expectedDuration);

      logger.info("");
      logger.info("Duration Validation:");
      logger.info(`  Total Keep Duration: ${totalKeepDuration.toFixed(2)}s`);
      logger.info(
        `  Transition Overlap: ${transitionOverlap.toFixed(2)}s (${joins} joins × ${(parseFloat(process.env.TRANSITIONS_DURATION_MS) / 1000).toFixed(2)}s)`
      );
      logger.info(`  Expected Duration: ${expectedDuration.toFixed(2)}s`);
      logger.info(`  Actual Duration: ${actualDuration.toFixed(2)}s`);
      logger.info(`  Difference: ${durationDiff.toFixed(3)}s`);

      const fps =
        parseFloat(renderEntry.fps.split("/")[0]) /
        (renderEntry.fps.includes("/")
          ? parseFloat(renderEntry.fps.split("/")[1])
          : 1);
      const frameDuration = 1 / fps;
      const tolerance = frameDuration;

      if (durationDiff <= tolerance) {
        logger.info(
          `  ✅ Within tolerance (±${tolerance.toFixed(3)}s = ±1 frame)`
        );
      } else {
        logger.warn(
          `  ⚠️  Outside tolerance (±${tolerance.toFixed(3)}s = ±1 frame)`
        );
      }
    }

    // Output file path
    const outputPath = pathFor(result.outputKey);
    if (fs.existsSync(outputPath)) {
      const outputStats = fs.statSync(outputPath);
      const outputSizeMB = (outputStats.size / (1024 * 1024)).toFixed(2);
      logger.info("");
      logger.info("Output File:");
      logger.info(`  Path: ${outputPath}`);
      logger.info(`  Size: ${outputSizeMB} MB`);
      logger.info("");
      logger.info(
        "✅ You can now view the output video with transitions applied!"
      );
    }
  } catch (error) {
    logger.error("");
    logger.error("=".repeat(60));
    logger.error("❌ ERROR - Transitions Failed");
    logger.error("=".repeat(60));
    logger.error(`Error: ${error.message}`);
    logger.error("");
    if (error.stack) {
      logger.error(error.stack);
    }
    process.exit(1);
  }
}

// Main
const args = process.argv.slice(2);
const jobId = args[0] || null;

testTransitionsOnRenderedVideo(jobId).catch(error => {
  logger.error("[FATAL] Test failed:", error);
  process.exit(1);
});
