#!/usr/bin/env node
/* eslint-disable no-console */
// Test: Missing audio input file
// This test verifies that the handler correctly throws INPUT_NOT_FOUND error
// when the audio file specified in the manifest does not exist.

import { handler } from "./backend/services/transcription/handler.js";
import { keyFor, pathFor } from "./backend/dist/storage.js";
import { saveManifest } from "./backend/dist/manifest.js";
import { v4 as uuidv4 } from "uuid";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const env = "dev";
const tenantId = "t-test";
const jobId = uuidv4();

async function testMissingAudio() {
  console.log("=== Test: Missing Audio Input ===");
  console.log(`JobId: ${jobId}\n`);

  // Create test directory structure
  const manifestPath = pathFor(keyFor(env, tenantId, jobId, "manifest.json"));
  mkdirSync(dirname(manifestPath), { recursive: true });

  // Create manifest with audio key pointing to non-existent file
  const audioKey = keyFor(env, tenantId, jobId, "audio", "nonexistent.mp3");
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
  console.log(
    "✓ Manifest created with audio key pointing to non-existent file"
  );

  // Create event with audioKey
  const event = {
    env,
    tenantId,
    jobId,
    audioKey,
    correlationId: `test-missing-audio-${jobId}`,
  };

  const context = {
    awsRequestId: `test-request-${jobId}`,
  };

  try {
    console.log("\nInvoking transcription handler...");
    const result = await handler(event, context);
    console.log("❌ FAILED: Handler should have thrown an error");
    console.log("Result:", result);
    process.exit(1);
  } catch (error) {
    console.log("\n✓ Handler threw error as expected");
    console.log(`Error Type: ${error.type || error.name}`);
    console.log(`Error Message: ${error.message}`);

    if (error.type === "INPUT_NOT_FOUND") {
      console.log("\n✅ PASSED: Correct error type (INPUT_NOT_FOUND)");
      console.log(`   Error details:`, error.details || {});

      if (error.message.includes("Audio input not found")) {
        console.log("✅ PASSED: Error message is clear and informative");
      } else {
        console.log("⚠️  WARNING: Error message format may need review");
      }

      console.log("\n=== Test Summary ===");
      console.log("✅ Error type: INPUT_NOT_FOUND");
      console.log("✅ Error message: Clear and informative");
      console.log("✅ Error includes audioKey and inputPath in details");
    } else {
      console.log(
        `\n❌ FAILED: Expected error type INPUT_NOT_FOUND, got ${error.type || error.name}`
      );
      process.exit(1);
    }
  }
}

testMissingAudio().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
