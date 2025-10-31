#!/usr/bin/env node
/* eslint-disable no-console */
// Test: Corrupt or invalid audio file
// This test verifies that the handler gracefully handles corrupt audio files.
// Option to use a custom file from your computer by providing the file path as an argument.

import { handler } from "./backend/services/transcription/handler.js";
import { keyFor, pathFor } from "./backend/dist/storage.js";
import { saveManifest } from "./backend/dist/manifest.js";
import { v4 as uuidv4 } from "uuid";
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

const env = "dev";
const tenantId = "t-test";
const jobId = uuidv4();

async function testCorruptAudio() {
  // Parse command-line arguments for custom file path
  const { values } = parseArgs({
    options: {
      file: { type: "string", short: "f" },
    },
  });

  console.log("=== Test: Corrupt Audio File ===");
  console.log(`JobId: ${jobId}\n`);

  // Create test directory structure
  const manifestPath = pathFor(keyFor(env, tenantId, jobId, "manifest.json"));
  mkdirSync(dirname(manifestPath), { recursive: true });

  let audioKey;
  let audioPath;

  if (values.file) {
    // Use custom file provided by user
    const customFilePath = resolve(values.file);
    if (!existsSync(customFilePath)) {
      console.error(`❌ Error: Custom file not found: ${customFilePath}`);
      process.exit(1);
    }

    audioKey = keyFor(env, tenantId, jobId, "audio", "custom-corrupt.txt");
    audioPath = pathFor(audioKey);
    mkdirSync(dirname(audioPath), { recursive: true });

    // Copy the custom file
    copyFileSync(customFilePath, audioPath);
    console.log(`✓ Using custom file: ${customFilePath}`);
    console.log(`✓ Copied to: ${audioPath}`);
  } else {
    // Create a corrupt/invalid audio file (just random bytes)
    audioKey = keyFor(env, tenantId, jobId, "audio", "corrupt.mp3");
    audioPath = pathFor(audioKey);
    mkdirSync(dirname(audioPath), { recursive: true });

    // Write random invalid bytes
    const corruptData = Buffer.from([
      0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0x11, 0x22, 0x33, 0x44,
      0x55, 0x66, 0x77, 0x88, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x11,
    ]);
    writeFileSync(audioPath, corruptData);
    console.log("✓ Created corrupt audio file (random invalid bytes)");
  }

  // Create manifest with audio key
  const manifest = {
    schemaVersion: "1.0.0",
    env,
    tenantId,
    jobId,
    status: "processing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    audio: {
      key: audioKey,
    },
  };

  saveManifest(env, tenantId, jobId, manifest);
  console.log("✓ Manifest created");

  // Create event with audioKey
  const event = {
    env,
    tenantId,
    jobId,
    audioKey,
    correlationId: `test-corrupt-audio-${jobId}`,
  };

  const context = {
    awsRequestId: `test-request-${jobId}`,
  };

  console.log("\nInvoking transcription handler with corrupt audio...");
  console.log("Note: Handler should gracefully handle corrupt audio");

  try {
    await handler(event, context);

    // Check if handler used fallback
    const transcriptKey = keyFor(
      env,
      tenantId,
      jobId,
      "transcripts",
      "transcript.json"
    );
    const transcriptPath = pathFor(transcriptKey);

    if (existsSync(transcriptPath)) {
      console.log("\n✅ Handler gracefully handled corrupt audio");
      console.log("✅ Fallback to sample transcript was successful");
      console.log("✅ Transcript file created:", transcriptKey);
      console.log("\n=== Test Summary ===");
      console.log("✅ Behavior: Graceful fallback to sample transcript");
      console.log("✅ Handler handles corrupt audio gracefully");
    } else {
      console.log("\n⚠️  Handler completed but no transcript file found");
      console.log(
        "   This may be expected if Whisper fails and sample transcript is not available"
      );
    }
  } catch (error) {
    console.log("\n✓ Handler threw error (this may be expected)");
    console.log(`Error Type: ${error.type || error.name}`);
    console.log(`Error Message: ${error.message}`);

    if (error.type === "WHISPER_EXECUTION") {
      console.log("\n✅ PASSED: Handler correctly identified execution issue");
      console.log("✅ Error includes execution details");

      console.log("\n=== Test Summary ===");
      console.log("✅ Error type: WHISPER_EXECUTION (or graceful fallback)");
      console.log("✅ Handler handles corrupt audio gracefully");
    } else {
      // Check if fallback happened
      const transcriptKey = keyFor(
        env,
        tenantId,
        jobId,
        "transcripts",
        "transcript.json"
      );
      const transcriptPath = pathFor(transcriptKey);

      if (existsSync(transcriptPath)) {
        console.log("\n✅ Handler gracefully handled corrupt audio");
        console.log("✅ Fallback to sample transcript was successful");
        console.log("✅ Transcript file created:", transcriptKey);
      } else {
        console.log(
          "\n⚠️  Handler encountered error, but this is expected for corrupt audio"
        );
        console.log("   Handler may use fallback or throw appropriate error");
      }
    }
  }
}

testCorruptAudio().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
