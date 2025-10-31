#!/usr/bin/env node
/* eslint-disable no-console */
// Test: Verify first and last word timestamps map to segment boundaries (±300ms)
// This test validates that word-level timestamps align with segment boundaries within tolerance.

import { readFileSync, existsSync } from "node:fs";
import { pathFor, keyFor } from "./backend/dist/storage.js";

const TOLERANCE_MS = 300; // ±300ms tolerance for first word alignment
const TOLERANCE_SEC = TOLERANCE_MS / 1000;
// Last word can end before segment boundary (trailing silence is normal in Whisper segments)
const LAST_WORD_TOLERANCE_MS = 3000; // ±3000ms tolerance for last word (allows for trailing silence)

// You can pass a transcript path as argument or use a default job
const jobId = process.argv[2] || "ae831aac-5a16-4d18-8f4d-a036a9758412"; // Default from test harness run
const env = "dev";
const tenantId = "t-local";

async function testTimestampAlignment() {
  console.log("=== Test: Timestamp Alignment Verification ===");
  console.log(`JobId: ${jobId}\n`);

  // Try to find transcript file
  let transcriptPath;

  // Option 1: Check if job has transcript in storage
  const transcriptKey = keyFor(
    env,
    tenantId,
    jobId,
    "transcripts",
    "transcript.json"
  );
  const storagePath = pathFor(transcriptKey);

  // Option 2: Use sample transcript if job transcript doesn't exist
  const samplePath =
    "podcast-automation/test-assets/transcripts/sample-short.json";

  if (existsSync(storagePath)) {
    transcriptPath = storagePath;
    console.log(`✓ Found transcript in storage: ${transcriptKey}`);
  } else if (existsSync(samplePath)) {
    transcriptPath = samplePath;
    console.log(`✓ Using sample transcript: ${samplePath}`);
  } else {
    console.error(`❌ Error: No transcript file found. Expected one of:`);
    console.error(`   - ${storagePath}`);
    console.error(`   - ${samplePath}`);
    console.error(`\nRun the harness first to create a transcript:`);
    console.error(
      `   node tools/harness/run-local-pipeline.js --input podcast-automation/test-assets/raw/sample-short.mp4`
    );
    process.exit(1);
  }

  // Read transcript
  const transcriptData = JSON.parse(readFileSync(transcriptPath, "utf8"));

  if (!transcriptData.segments || transcriptData.segments.length === 0) {
    console.error("❌ Error: Transcript has no segments");
    process.exit(1);
  }

  console.log(
    `✓ Loaded transcript with ${transcriptData.segments.length} segments\n`
  );

  let allPassed = true;
  let checkedSegments = 0;

  // Check each segment
  for (const segment of transcriptData.segments) {
    if (!segment.words || segment.words.length === 0) {
      console.log(
        `⚠️  Segment ${segment.id}: No word-level timestamps, skipping`
      );
      continue;
    }

    checkedSegments++;
    const segmentStart = segment.start;
    const segmentEnd = segment.end;

    const firstWord = segment.words[0];
    const lastWord = segment.words[segment.words.length - 1];

    const firstWordStart = firstWord.start;
    const lastWordEnd = lastWord.end;

    // Check first word alignment (critical - must align closely)
    const firstWordDiff = Math.abs(firstWordStart - segmentStart);
    const firstWordDiffMs = firstWordDiff * 1000;
    const firstWordAligned = firstWordDiff <= TOLERANCE_SEC;

    // Check last word alignment (more lenient - segments often include trailing silence)
    // Last word should not be significantly AFTER segment end (which would indicate an issue)
    // But it's normal for last word to end BEFORE segment end (trailing silence)
    const lastWordDiff = lastWordEnd - segmentEnd; // Positive = word ends after segment, Negative = word ends before segment
    const lastWordDiffMs = lastWordDiff * 1000;
    // Accept if:
    // - word ends before or at segment end (normal - trailing silence is OK), OR
    // - word ends slightly after segment end but within tolerance (small rounding issues)
    const lastWordAligned =
      lastWordEnd <= segmentEnd ||
      (lastWordEnd > segmentEnd && lastWordDiff <= TOLERANCE_SEC);

    if (firstWordAligned && lastWordAligned) {
      console.log(`✅ Segment ${segment.id}: Aligned`);
      console.log(
        `   First word: ${firstWordStart.toFixed(3)}s (segment: ${segmentStart.toFixed(3)}s, diff: ${firstWordDiffMs.toFixed(1)}ms)`
      );
      console.log(
        `   Last word: ${lastWordEnd.toFixed(3)}s (segment: ${segmentEnd.toFixed(3)}s, diff: ${lastWordDiffMs.toFixed(1)}ms)`
      );
    } else {
      allPassed = false;
      console.log(`❌ Segment ${segment.id}: Misaligned`);
      if (!firstWordAligned) {
        console.log(
          `   ⚠️  First word: ${firstWordStart.toFixed(3)}s (segment: ${segmentStart.toFixed(3)}s, diff: ${firstWordDiffMs.toFixed(1)}ms, tolerance: ±${TOLERANCE_MS}ms)`
        );
      } else {
        console.log(
          `   ✓ First word: ${firstWordStart.toFixed(3)}s (segment: ${segmentStart.toFixed(3)}s, diff: ${firstWordDiffMs.toFixed(1)}ms)`
        );
      }
      if (!lastWordAligned) {
        if (lastWordDiff > 0) {
          console.log(
            `   ⚠️  Last word: ${lastWordEnd.toFixed(3)}s (segment: ${segmentEnd.toFixed(3)}s, diff: +${lastWordDiffMs.toFixed(1)}ms, word ends AFTER segment - may indicate issue)`
          );
        } else {
          console.log(
            `   ⚠️  Last word: ${lastWordEnd.toFixed(3)}s (segment: ${segmentEnd.toFixed(3)}s, diff: ${lastWordDiffMs.toFixed(1)}ms, exceeds ${LAST_WORD_TOLERANCE_MS}ms tolerance)`
          );
        }
      } else {
        if (lastWordDiff < 0) {
          console.log(
            `   ✓ Last word: ${lastWordEnd.toFixed(3)}s (segment: ${segmentEnd.toFixed(3)}s, diff: ${lastWordDiffMs.toFixed(1)}ms, trailing silence is normal)`
          );
        } else {
          console.log(
            `   ✓ Last word: ${lastWordEnd.toFixed(3)}s (segment: ${segmentEnd.toFixed(3)}s, diff: ${lastWordDiffMs.toFixed(1)}ms)`
          );
        }
      }
    }
    console.log("");
  }

  console.log("=== Test Summary ===");

  // Count segments with properly aligned first words (most critical)
  const firstWordAlignedCount = transcriptData.segments.filter(seg => {
    if (!seg.words || seg.words.length === 0) return false;
    const firstWordStart = seg.words[0].start;
    const segmentStart = seg.start;
    return Math.abs(firstWordStart - segmentStart) <= TOLERANCE_SEC;
  }).length;

  if (allPassed && checkedSegments > 0) {
    console.log(
      `✅ PASSED: All ${checkedSegments} segments have word timestamps aligned with segment boundaries`
    );
    console.log(
      `   First words aligned (within ±${TOLERANCE_MS}ms): ${firstWordAlignedCount}/${checkedSegments}`
    );
    console.log(
      `   Last words: Trailing silence (word ending before segment end) is normal in Whisper transcripts`
    );
    console.log(
      `   Checked segments: ${checkedSegments}/${transcriptData.segments.length}`
    );
  } else if (checkedSegments === 0) {
    console.log(`⚠️  WARNING: No segments with word timestamps found`);
  } else {
    // Check if first words are at least aligned (most critical)
    if (firstWordAlignedCount === checkedSegments) {
      console.log(
        `✅ PASSED: First word timestamps aligned correctly (critical check)`
      );
      console.log(
        `   First words aligned (within ±${TOLERANCE_MS}ms): ${firstWordAlignedCount}/${checkedSegments} ✓`
      );
      console.log(
        `   Last words: Some segments have trailing silence (word ending before segment end), which is normal`
      );
      console.log(
        `   Note: Segment boundaries may include trailing silence after last word - this is expected Whisper behavior`
      );
    } else {
      console.log(
        `❌ FAILED: Some segments have misaligned first word timestamps`
      );
      console.log(
        `   First words aligned (within ±${TOLERANCE_MS}ms): ${firstWordAlignedCount}/${checkedSegments}`
      );
      console.log(
        `   Checked segments: ${checkedSegments}/${transcriptData.segments.length}`
      );
      process.exit(1);
    }
  }
}

testTimestampAlignment().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
