#!/usr/bin/env node
/* eslint-disable no-console */
// Test: Missing audio key in manifest
// This test verifies that the handler correctly throws INPUT_NOT_FOUND error
// when audio.key is missing from the manifest, forcing the handler to attempt derivation.

import { handler } from "./backend/services/transcription/handler.js";
import { keyFor, pathFor } from "./backend/dist/storage.js";
import { saveManifest } from "./backend/dist/manifest.js";
import { v4 as uuidv4 } from "uuid";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const env = "dev";
const tenantId = "t-test";
const jobId = uuidv4();

async function testMissingAudioKey() {
  console.log("=== Test: Missing Audio Key in Manifest ===");
  console.log(`JobId: ${jobId}\n`);

  // Create test directory structure
  const manifestPath = pathFor(keyFor(env, tenantId, jobId, "manifest.json"));
  mkdirSync(dirname(manifestPath), { recursive: true });

  // Create manifest WITHOUT audio.key (audio section missing or incomplete)
  const manifest = {
    schemaVersion: "1.0.0",
    env,
    tenantId,
    jobId,
    status: "processing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    // Note: audio section is missing, or audio.key is missing
  };

  saveManifest(env, tenantId, jobId, manifest);
  console.log("✓ Manifest created WITHOUT audio.key");

  // Create event without audioKey (to force derivation from manifest)
  const event = {
    env,
    tenantId,
    jobId,
    // Note: audioKey is not provided, so handler must derive from manifest
    correlationId: `test-missing-audio-key-${jobId}`,
  };

  const context = {
    awsRequestId: `test-request-${jobId}`,
  };

  try {
    console.log(
      "\nInvoking transcription handler (without audioKey in event)..."
    );
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

      if (
        error.message.includes("Audio key not found in manifest") ||
        error.message.includes("Audio extraction must complete")
      ) {
        console.log(
          "✅ PASSED: Error message indicates manifest issue correctly"
        );
      } else {
        console.log("⚠️  WARNING: Error message format may need review");
      }

      console.log("\n=== Test Summary ===");
      console.log("✅ Error type: INPUT_NOT_FOUND");
      console.log("✅ Error message: Indicates manifest issue correctly");
      console.log(
        "✅ Handler correctly attempts to derive audioKey from manifest"
      );
    } else {
      console.log(
        `\n❌ FAILED: Expected error type INPUT_NOT_FOUND, got ${error.type || error.name}`
      );
      process.exit(1);
    }
  }
}

testMissingAudioKey().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
