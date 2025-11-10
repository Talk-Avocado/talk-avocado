#!/usr/bin/env node
// test-transitions-with-sample-video.js
// Test video engine transitions with your sample video
//
// Usage:
//   node test-transitions-with-sample-video.js [path-to-video] [path-to-cut-plan]
//
// Examples:
//   node test-transitions-with-sample-video.js
//   node test-transitions-with-sample-video.js "podcast-automation/test-assets/raw/Weekly Q&A Session - 2025-07-11 - Includes Rachel discussing certified ip.mp4"
//   node test-transitions-with-sample-video.js "path/to/video.mp4" "path/to/cut_plan.json"

import { handler } from "./backend/services/video-render-engine/handler.js";
import { keyFor, pathFor, ensureDirForFile } from "./backend/dist/storage.js";
import { saveManifest, loadManifest } from "./backend/dist/manifest.js";
import fs, { copyFileSync } from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { logger } from "./scripts/logger.js";

// Default sample video (the one you've been using)
const DEFAULT_VIDEO =
  "podcast-automation/test-assets/raw/Weekly Q&A Session - 2025-07-11 - Includes Rachel discussing certified ip.mp4";

// Test configuration
const TEST_ENV = "dev";
const TEST_TENANT = "t-test-transitions";

async function testTransitionsWithSampleVideo(videoPath, cutPlanPath) {
  logger.info("=".repeat(60));
  logger.info("Testing Video Engine Transitions with Sample Video");
  logger.info("=".repeat(60));

  // Use provided video or default
  const inputVideo = videoPath || DEFAULT_VIDEO;

  if (!fs.existsSync(inputVideo)) {
    logger.error(`Video file not found: ${inputVideo}`);
    logger.info("\nAvailable videos in podcast-automation/test-assets/raw/:");
    const rawDir = "podcast-automation/test-assets/raw";
    if (fs.existsSync(rawDir)) {
      const files = fs
        .readdirSync(rawDir)
        .filter(
          f =>
            f.toLowerCase().endsWith(".mp4") ||
            f.toLowerCase().endsWith(".mov") ||
            f.toLowerCase().endsWith(".mkv")
        );
      files.forEach(f => logger.info(`  - ${path.join(rawDir, f)}`));
    }
    process.exit(1);
  }

  const videoStats = fs.statSync(inputVideo);
  const videoSizeMB = (videoStats.size / (1024 * 1024)).toFixed(2);
  logger.info(`Input Video: ${inputVideo}`);
  logger.info(`Video Size: ${videoSizeMB} MB`);
  logger.info("");

  // Generate job ID
  const jobId = uuidv4();
  logger.info(`Job ID: ${jobId}`);
  logger.info("");

  // Setup test job
  const inputKey = keyFor(
    TEST_ENV,
    TEST_TENANT,
    jobId,
    "input",
    path.basename(inputVideo)
  );
  const inputPath = pathFor(inputKey);
  ensureDirForFile(inputPath);
  copyFileSync(inputVideo, inputPath);
  logger.info(`Copied video to: ${inputPath}`);

  // Create manifest
  const manifest = {
    schemaVersion: "1.0.0",
    env: TEST_ENV,
    tenantId: TEST_TENANT,
    jobId,
    status: "processing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    input: {
      sourceKey: inputKey,
      originalFilename: path.basename(inputVideo),
      bytes: videoStats.size,
      mimeType: "video/mp4",
    },
  };
  saveManifest(TEST_ENV, TEST_TENANT, jobId, manifest);

  // Load or create cut plan
  let cutPlan;
  const planKey = keyFor(TEST_ENV, TEST_TENANT, jobId, "plan", "cut_plan.json");
  const planPath = pathFor(planKey);

  if (cutPlanPath && fs.existsSync(cutPlanPath)) {
    // Use provided cut plan
    logger.info(`Using provided cut plan: ${cutPlanPath}`);
    cutPlan = JSON.parse(fs.readFileSync(cutPlanPath, "utf-8"));
    ensureDirForFile(planPath);
    fs.writeFileSync(planPath, JSON.stringify(cutPlan, null, 2));
  } else {
    // Try to find existing cut plan for this video
    logger.info("Looking for existing cut plan...");
    const storageBasePath = `storage/${TEST_ENV}/t-test`;
    let foundPlan = null;

    if (fs.existsSync(storageBasePath)) {
      const jobDirs = fs
        .readdirSync(storageBasePath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

      // Look for job with matching video filename
      const videoBasename = path.basename(inputVideo);
      for (const existingJobId of jobDirs) {
        const existingManifestPath = `${storageBasePath}/${existingJobId}/manifest.json`;
        if (fs.existsSync(existingManifestPath)) {
          try {
            const existingManifest = JSON.parse(
              fs.readFileSync(existingManifestPath, "utf-8")
            );
            if (existingManifest.input?.originalFilename === videoBasename) {
              const existingPlanPath = `${storageBasePath}/${existingJobId}/plan/cut_plan.json`;
              if (fs.existsSync(existingPlanPath)) {
                foundPlan = existingPlanPath;
                logger.info(`Found existing cut plan: ${foundPlan}`);
                break;
              }
            }
          } catch (e) {
            continue;
          }
        }
      }
    }

    if (foundPlan) {
      cutPlan = JSON.parse(fs.readFileSync(foundPlan, "utf-8"));
      ensureDirForFile(planPath);
      fs.writeFileSync(planPath, JSON.stringify(cutPlan, null, 2));
    } else {
      // Create a simple test cut plan with 2+ keep segments
      logger.info("Creating test cut plan with 2 keep segments...");
      cutPlan = {
        schemaVersion: "1.0.0",
        cuts: [
          {
            type: "keep",
            start: "0.00",
            end: "10.00",
            reason: "test_segment_1",
          },
          {
            type: "keep",
            start: "20.00",
            end: "30.00",
            reason: "test_segment_2",
          },
        ],
      };
      ensureDirForFile(planPath);
      fs.writeFileSync(planPath, JSON.stringify(cutPlan, null, 2));
      logger.info(
        "Created test cut plan with 2 keep segments (0-10s and 20-30s)"
      );
    }
  }

  // Count keep segments
  const keepSegments = cutPlan.cuts.filter(c => c.type === "keep");
  logger.info(
    `Cut Plan: ${keepSegments.length} keep segment(s), ${cutPlan.cuts.length - keepSegments.length} cut segment(s)`
  );

  if (keepSegments.length < 2) {
    logger.warn(
      "⚠️  Warning: Need at least 2 keep segments for transitions. Creating additional keep segment..."
    );
    // Add another keep segment
    const lastKeep = keepSegments[keepSegments.length - 1];
    const newStart = parseFloat(lastKeep.end) + 10;
    const newEnd = newStart + 10;
    cutPlan.cuts.push({
      type: "keep",
      start: newStart.toFixed(2),
      end: newEnd.toFixed(2),
      reason: "test_segment_added",
    });
    keepSegments.push(cutPlan.cuts[cutPlan.cuts.length - 1]);
    fs.writeFileSync(planPath, JSON.stringify(cutPlan, null, 2));
    logger.info(
      `Added keep segment: ${newStart.toFixed(2)}s - ${newEnd.toFixed(2)}s`
    );
  }

  logger.info("");
  logger.info("Keep Segments:");
  keepSegments.forEach((seg, idx) => {
    logger.info(
      `  ${idx + 1}. ${seg.start}s - ${seg.end}s (${(parseFloat(seg.end) - parseFloat(seg.start)).toFixed(2)}s)`
    );
  });
  logger.info("");

  // Enable transitions
  process.env.TRANSITIONS_ENABLED = "true";
  process.env.TRANSITIONS_DURATION_MS = "300";
  process.env.TRANSITIONS_AUDIO_FADE_MS = "300";

  // Prepare event
  const sourceVideoKey = keyFor(
    TEST_ENV,
    TEST_TENANT,
    jobId,
    "input",
    path.basename(inputVideo)
  );

  const event = {
    env: TEST_ENV,
    tenantId: TEST_TENANT,
    jobId,
    planKey,
    sourceVideoKey,
    transitions: true,
    correlationId: `test-transitions-${jobId}-${Date.now()}`,
  };

  const context = { awsRequestId: `test-transitions-${Date.now()}` };

  logger.info("Running video render engine with transitions...");
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
    const finalManifest = loadManifest(TEST_ENV, TEST_TENANT, jobId);
    const renderEntry = finalManifest.renders[finalManifest.renders.length - 1];

    if (renderEntry) {
      logger.info("");
      logger.info("Output Details:");
      logger.info(`  Duration: ${renderEntry.durationSec.toFixed(2)}s`);
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
      const totalKeepDuration = keepSegments.reduce((sum, seg) => {
        return sum + (parseFloat(seg.end) - parseFloat(seg.start));
      }, 0);
      const joins = keepSegments.length - 1;
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
const videoPath = args[0] || null;
const cutPlanPath = args[1] || null;

testTransitionsWithSampleVideo(videoPath, cutPlanPath).catch(error => {
  logger.error("[FATAL] Test failed:", error);
  process.exit(1);
});
