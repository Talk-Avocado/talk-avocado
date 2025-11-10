#!/usr/bin/env node
// run-full-pipeline.js
// Run the full pipeline: Transcription -> Smart Cut Planner -> Video Render Engine

// Set OpenMP fix for Whisper
process.env.KMP_DUPLICATE_LIB_OK = "TRUE";

import { handler as transcriptionHandler } from "./backend/services/transcription/handler.js";
import { handler as smartCutPlannerHandler } from "./backend/services/smart-cut-planner/handler-simple.js";
import { handler as videoRenderHandler } from "./backend/services/video-render-engine/handler-simple.cjs";
import { keyFor, pathFor } from "./backend/dist/storage.js";
import { loadManifest } from "./backend/dist/manifest.js";
import fs from "node:fs";
import { logger } from "./scripts/logger.js";

const TEST_ENV = "dev";
const TEST_TENANT = "t-test";
const JOB_ID = "cc9fde8e-eb0c-4398-a895-625d874a89e9";

async function runFullPipeline() {
  logger.info("=".repeat(60));
  logger.info(
    "Full Pipeline: Transcription -> Smart Cut Planner -> Video Render Engine"
  );
  logger.info("=".repeat(60));
  logger.info(`Job ID: ${JOB_ID}`);
  logger.info("");

  try {
    // Step 1: Transcription
    logger.info("=".repeat(60));
    logger.info("Step 1: Transcription");
    logger.info("=".repeat(60));
    logger.info("");

    const audioKey = keyFor(
      TEST_ENV,
      TEST_TENANT,
      JOB_ID,
      "audio",
      "sample-short.mp3"
    );
    const audioPath = pathFor(audioKey);

    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    logger.info(`Audio file: ${audioPath}`);
    logger.info("");

    const transcriptionEvent = {
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId: JOB_ID,
      audioKey: audioKey,
      correlationId: `full-pipeline-${Date.now()}`,
    };

    const transcriptionContext = {
      awsRequestId: `transcription-${Date.now()}`,
    };

    logger.info("Starting transcription...");
    const transcriptKey = keyFor(
      TEST_ENV,
      TEST_TENANT,
      JOB_ID,
      "transcripts",
      "transcript.json"
    );
    const transcriptPath = pathFor(transcriptKey);

    try {
      const transcriptionResult = await transcriptionHandler(
        transcriptionEvent,
        transcriptionContext
      );
      logger.info("✅ Transcription completed");
      logger.info(
        `  Transcript JSON: ${transcriptionResult.transcriptJsonKey}`
      );
      logger.info(`  Transcript SRT: ${transcriptionResult.transcriptSrtKey}`);
      logger.info("");
    } catch (error) {
      // If transcription fails but transcript file exists, continue
      if (fs.existsSync(transcriptPath)) {
        logger.warn(
          "Transcription handler failed but transcript file exists, continuing..."
        );
        logger.warn(`  Error: ${error.message}`);
        logger.info("");
      } else {
        throw new Error(
          `Transcription failed and transcript file not found: ${error.message}`
        );
      }
    }

    // Verify transcript
    if (fs.existsSync(transcriptPath)) {
      const transcript = JSON.parse(fs.readFileSync(transcriptPath, "utf-8"));
      const lastSegment = transcript.segments[transcript.segments.length - 1];
      logger.info(
        `Transcript: ${transcript.segments.length} segments, ends at ${lastSegment.end}s`
      );
      logger.info("");
    } else {
      throw new Error(`Transcript file not found: ${transcriptPath}`);
    }

    // Step 2: Smart Cut Planner
    logger.info("=".repeat(60));
    logger.info("Step 2: Smart Cut Planner");
    logger.info("=".repeat(60));
    logger.info("");

    const smartCutPlannerEvent = {
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId: JOB_ID,
      transcriptKey: transcriptKey,
      correlationId: `full-pipeline-${Date.now()}`,
    };

    const smartCutPlannerContext = {
      awsRequestId: `smart-cut-planner-${Date.now()}`,
    };

    logger.info("Starting Smart Cut Planner...");
    await smartCutPlannerHandler(smartCutPlannerEvent, smartCutPlannerContext);
    logger.info("✅ Smart Cut Planner completed");
    logger.info("");

    // Verify cut plan
    const planKey = keyFor(
      TEST_ENV,
      TEST_TENANT,
      JOB_ID,
      "plan",
      "cut_plan.json"
    );
    const planPath = pathFor(planKey);
    if (fs.existsSync(planPath)) {
      const cutPlan = JSON.parse(fs.readFileSync(planPath, "utf-8"));
      const keepSegments = cutPlan.cuts.filter(c => c.type === "keep");
      const cutSegments = cutPlan.cuts.filter(c => c.type === "cut");
      const totalKeepDuration = keepSegments.reduce((sum, seg) => {
        return sum + (parseFloat(seg.end) - parseFloat(seg.start));
      }, 0);
      const lastSegment = cutPlan.cuts[cutPlan.cuts.length - 1];
      logger.info(
        `Cut Plan: ${cutPlan.cuts.length} segments (${keepSegments.length} keep, ${cutSegments.length} cut)`
      );
      logger.info(`  Total Keep Duration: ${totalKeepDuration.toFixed(2)}s`);
      logger.info(`  Last Segment End: ${lastSegment.end}s`);
      logger.info("");
    } else {
      throw new Error(`Cut plan file not found: ${planPath}`);
    }

    // Step 3: Video Render Engine
    logger.info("=".repeat(60));
    logger.info("Step 3: Video Render Engine");
    logger.info("=".repeat(60));
    logger.info("");

    const manifest = loadManifest(TEST_ENV, TEST_TENANT, JOB_ID);
    const sourceVideoKey =
      manifest.sourceVideoKey ||
      manifest.input?.sourceKey ||
      keyFor(TEST_ENV, TEST_TENANT, JOB_ID, "input", "sample-short.mp4");

    const videoRenderEvent = {
      env: TEST_ENV,
      tenantId: TEST_TENANT,
      jobId: JOB_ID,
      planKey: planKey,
      sourceVideoKey: sourceVideoKey,
      correlationId: `full-pipeline-${Date.now()}`,
    };

    const videoRenderContext = {
      awsRequestId: `video-render-${Date.now()}`,
    };

    logger.info("Starting Video Render Engine...");
    await videoRenderHandler(videoRenderEvent, videoRenderContext);
    logger.info("✅ Video Render Engine completed");
    logger.info("");

    // Final Results
    logger.info("=".repeat(60));
    logger.info("Final Results");
    logger.info("=".repeat(60));
    logger.info("");

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

      // Get video duration
      const { execFileSync } = await import("child_process");
      const ffprobePath = process.env.FFPROBE_PATH || "ffprobe";
      const probeOutput = execFileSync(
        ffprobePath,
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "default=noprint_wrappers=1:nokey=1",
          outputPath,
        ],
        { encoding: "utf8" }
      );
      const outputDuration = parseFloat(probeOutput.trim());

      logger.info("✅ Pipeline completed successfully!");
      logger.info("");
      logger.info("Output Video:");
      logger.info(`  Storage Key: ${outputKey}`);
      logger.info(`  Full Path: ${outputPath}`);
      logger.info(`  Size: ${outputSizeMB} MB`);
      logger.info(
        `  Duration: ${outputDuration.toFixed(2)}s (${(outputDuration / 60).toFixed(2)} minutes)`
      );
      logger.info("");
      logger.info("=".repeat(60));

      return {
        success: true,
        outputKey,
        outputPath,
        outputSizeMB,
        outputDuration,
      };
    } else {
      throw new Error(`Output video not found: ${outputPath}`);
    }
  } catch (error) {
    logger.error("");
    logger.error("=".repeat(60));
    logger.error("Pipeline Failed");
    logger.error("=".repeat(60));
    logger.error(`Error: ${error.message}`);
    logger.error(`Error type: ${error.type || "UNKNOWN"}`);
    logger.error("");

    if (error.stack) {
      logger.error("Stack trace:");
      logger.error(error.stack);
    }

    logger.error("=".repeat(60));
    throw error;
  }
}

runFullPipeline()
  .then(result => {
    if (result.success) {
      logger.info("");
      logger.info("Summary:");
      logger.info(`  Output Path: ${result.outputPath}`);
      logger.info(`  Size: ${result.outputSizeMB} MB`);
      logger.info(`  Duration: ${result.outputDuration.toFixed(2)}s`);
      process.exit(0);
    }
  })
  .catch(error => {
    logger.error("Pipeline failed:", error);
    process.exit(1);
  });
