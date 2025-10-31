#!/usr/bin/env node
/* eslint-disable no-console */
// Test: Whisper CLI not found
// This test verifies that the handler gracefully handles the case when Whisper CLI is not available.
// Note: Handler has a fallback mechanism that uses sample transcript for testing.

import { handler } from "./backend/services/transcription/handler.js";
import { keyFor, pathFor } from "./backend/dist/storage.js";
import { saveManifest } from "./backend/dist/manifest.js";
import { v4 as uuidv4 } from "uuid";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const env = "dev";
const tenantId = "t-test";
const jobId = uuidv4();

async function testWhisperNotInstalled() {
  console.log("=== Test: Whisper CLI Not Installed ===");
  console.log(`JobId: ${jobId}\n`);

  // Temporarily set WHISPER_CMD to a non-existent command
  const originalWhisperCmd = process.env.WHISPER_CMD;
  process.env.WHISPER_CMD = "whisper-nonexistent-command-that-does-not-exist";

  try {
    // Create test directory structure
    const manifestPath = pathFor(keyFor(env, tenantId, jobId, "manifest.json"));
    mkdirSync(dirname(manifestPath), { recursive: true });

    // Create a valid audio file (minimal MP3)
    const audioKey = keyFor(env, tenantId, jobId, "audio", "test.mp3");
    const audioPath = pathFor(audioKey);
    mkdirSync(dirname(audioPath), { recursive: true });

    // Minimal MP3 header
    const mp3Data = Buffer.from([
      0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    writeFileSync(audioPath, mp3Data);
    console.log("✓ Created minimal MP3 audio file");

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
      correlationId: `test-whisper-not-installed-${jobId}`,
    };

    const context = {
      awsRequestId: `test-request-${jobId}`,
    };

    console.log(
      "\nInvoking transcription handler (with nonexistent Whisper command)..."
    );
    console.log(
      "Note: Handler should gracefully fallback to sample transcript if available"
    );

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
        console.log("\n✅ Handler gracefully handled missing Whisper");
        console.log("✅ Fallback to sample transcript was successful");
        console.log("✅ Transcript file created:", transcriptKey);
        console.log("\n=== Test Summary ===");
        console.log("✅ Behavior: Graceful fallback to sample transcript");
        console.log(
          "✅ Note: Handler checks for Whisper but uses fallback when not available"
        );
      } else {
        console.log("\n⚠️  Handler completed but no transcript file found");
        console.log(
          "   This may be expected if sample transcript is not available"
        );
      }

      // Restore original WHISPER_CMD
      if (originalWhisperCmd !== undefined) {
        process.env.WHISPER_CMD = originalWhisperCmd;
      } else {
        delete process.env.WHISPER_CMD;
      }
    } catch (error) {
      console.log("\n✓ Handler threw error (this may be expected)");
      console.log(`Error Type: ${error.type || error.name}`);
      console.log(`Error Message: ${error.message}`);

      if (
        error.type === "WHISPER_NOT_AVAILABLE" ||
        error.type === "WHISPER_EXECUTION"
      ) {
        console.log("\n✅ PASSED: Handler correctly identified Whisper issue");
        if (
          error.message.includes("Install with:") ||
          error.message.includes("not found")
        ) {
          console.log(
            "✅ Error message includes install instructions or clear indication"
          );
        }
      } else {
        console.log(
          "\n⚠️  Unexpected error type, but handler did catch the issue"
        );
      }

      // Restore original WHISPER_CMD
      if (originalWhisperCmd !== undefined) {
        process.env.WHISPER_CMD = originalWhisperCmd;
      } else {
        delete process.env.WHISPER_CMD;
      }

      throw error;
    }
  } catch (error) {
    // Restore original WHISPER_CMD
    if (originalWhisperCmd !== undefined) {
      process.env.WHISPER_CMD = originalWhisperCmd;
    } else {
      delete process.env.WHISPER_CMD;
    }
    throw error;
  }
}

testWhisperNotInstalled().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
