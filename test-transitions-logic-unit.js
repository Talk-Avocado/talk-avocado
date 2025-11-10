#!/usr/bin/env node
// test-transitions-logic-unit.js
// Unit tests for transitions-logic.js filtergraph generation functions
//
// Tests:
// - buildTrimNodes: filtergraph generation for 2+ segments
// - buildCrossfadeChain: pairwise xfade/acrossfade folding
// - buildTransitionGraph: complete graph assembly
// - Edge case: single segment (no transitions)
// - FFmpeg command structure validation

import {
  buildTrimNodes,
  buildCrossfadeChain,
  buildTransitionGraph,
  TransitionError,
  ERROR_TYPES,
} from "./backend/services/video-render-engine/transitions-logic.js";
import { logger } from "./scripts/logger.js";

// Test results tracking
const testResults = [];
let testsPassed = 0;
let testsFailed = 0;

function logTestResult(testName, passed, message = "") {
  const status = passed ? "✅ PASS" : "❌ FAIL";
  const logMessage = `${status}: ${testName}${message ? ` - ${message}` : ""}`;
  // eslint-disable-next-line no-console
  console.log(logMessage);
  logger.info(logMessage);
  testResults.push({ testName, passed, message });
  if (passed) {
    testsPassed++;
  } else {
    testsFailed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

// Test 1: buildTrimNodes - Single segment
function test1_BuildTrimNodes_SingleSegment() {
  const testName = "Test 1: buildTrimNodes - Single Segment";
  logger.info(`\n${"=".repeat(60)}`);
  logger.info(testName);
  logger.info("=".repeat(60));

  try {
    const keeps = [{ start: 0, end: 5 }];
    const result = buildTrimNodes(keeps);

    assert(Array.isArray(result), "Should return an array");
    assert(
      result.length === 2,
      "Should return 2 filtergraph parts (video + audio)"
    );
    assert(
      result[0].includes("[0:v]trim=start=0.00:end=5.00"),
      "Video trim should include correct start/end times"
    );
    assert(
      result[0].includes("setpts=PTS-STARTPTS[v0]"),
      "Video trim should include setpts and output label [v0]"
    );
    assert(
      result[1].includes("[0:a]atrim=start=0.00:end=5.00"),
      "Audio trim should include correct start/end times"
    );
    assert(
      result[1].includes("asetpts=PTS-STARTPTS[a0]"),
      "Audio trim should include asetpts and output label [a0]"
    );

    logTestResult(testName, true);
  } catch (error) {
    logTestResult(testName, false, error.message);
    throw error;
  }
}

// Test 2: buildTrimNodes - Multiple segments
function test2_BuildTrimNodes_MultipleSegments() {
  const testName = "Test 2: buildTrimNodes - Multiple Segments";
  logger.info(`\n${"=".repeat(60)}`);
  logger.info(testName);
  logger.info("=".repeat(60));

  try {
    const keeps = [
      { start: 0, end: 5 },
      { start: 10, end: 15 },
      { start: 20, end: 25 },
    ];
    const result = buildTrimNodes(keeps);

    assert(Array.isArray(result), "Should return an array");
    assert(
      result.length === 6,
      "Should return 6 filtergraph parts (3 segments × 2 streams)"
    );

    // Check first segment
    assert(
      result[0].includes("[0:v]trim=start=0.00:end=5.00"),
      "First video trim should have correct times"
    );
    assert(result[0].includes("[v0]"), "First video should output to [v0]");
    assert(
      result[1].includes("[0:a]atrim=start=0.00:end=5.00"),
      "First audio trim should have correct times"
    );
    assert(result[1].includes("[a0]"), "First audio should output to [a0]");

    // Check second segment
    assert(
      result[2].includes("[0:v]trim=start=10.00:end=15.00"),
      "Second video trim should have correct times"
    );
    assert(result[2].includes("[v1]"), "Second video should output to [v1]");
    assert(
      result[3].includes("[0:a]atrim=start=10.00:end=15.00"),
      "Second audio trim should have correct times"
    );
    assert(result[3].includes("[a1]"), "Second audio should output to [a1]");

    // Check third segment
    assert(
      result[4].includes("[0:v]trim=start=20.00:end=25.00"),
      "Third video trim should have correct times"
    );
    assert(result[4].includes("[v2]"), "Third video should output to [v2]");

    logTestResult(testName, true);
  } catch (error) {
    logTestResult(testName, false, error.message);
    throw error;
  }
}

// Test 3: buildTrimNodes - Error handling
function test3_BuildTrimNodes_ErrorHandling() {
  const testName = "Test 3: buildTrimNodes - Error Handling";
  logger.info(`\n${"=".repeat(60)}`);
  logger.info(testName);
  logger.info("=".repeat(60));

  try {
    // Test empty array
    try {
      buildTrimNodes([]);
      assert(false, "Should throw error for empty array");
    } catch (error) {
      assert(error instanceof TransitionError, "Should throw TransitionError");
      assert(
        error.type === ERROR_TYPES.INVALID_KEEPS,
        "Should have INVALID_KEEPS error type"
      );
    }

    // Test invalid input
    try {
      buildTrimNodes(null);
      assert(false, "Should throw error for null input");
    } catch (error) {
      assert(
        error instanceof TransitionError,
        "Should throw TransitionError for null"
      );
    }

    logTestResult(testName, true);
  } catch (error) {
    logTestResult(testName, false, error.message);
    throw error;
  }
}

// Test 4: buildCrossfadeChain - Single segment (no transitions)
function test4_BuildCrossfadeChain_SingleSegment() {
  const testName =
    "Test 4: buildCrossfadeChain - Single Segment (No Transitions)";
  logger.info(`\n${"=".repeat(60)}`);
  logger.info(testName);
  logger.info("=".repeat(60));

  try {
    const keeps = [{ start: 0, end: 5 }];
    const result = buildCrossfadeChain(keeps, { durationMs: 300 });

    assert(Array.isArray(result.chain), "Should return chain array");
    assert(
      result.chain.length === 0,
      "Should return empty chain for single segment"
    );
    assert(result.vOut === "[v0]", "Should return [v0] as video output");
    assert(result.aOut === "[a0]", "Should return [a0] as audio output");

    logTestResult(testName, true);
  } catch (error) {
    logTestResult(testName, false, error.message);
    throw error;
  }
}

// Test 5: buildCrossfadeChain - Two segments (one transition)
function test5_BuildCrossfadeChain_TwoSegments() {
  const testName =
    "Test 5: buildCrossfadeChain - Two Segments (One Transition)";
  logger.info(`\n${"=".repeat(60)}`);
  logger.info(testName);
  logger.info("=".repeat(60));

  try {
    const keeps = [
      { start: 0, end: 5 }, // 5 seconds
      { start: 10, end: 15 }, // 5 seconds
    ];
    const result = buildCrossfadeChain(keeps, { durationMs: 300 });

    assert(Array.isArray(result.chain), "Should return chain array");
    assert(
      result.chain.length === 2,
      "Should return 2 chain parts (video + audio xfade)"
    );

    // Check video xfade
    const videoXfade = result.chain[0];
    assert(
      videoXfade.includes("[v0][v1]xfade"),
      "Should include [v0][v1]xfade"
    );
    // Note: xfade is crossfade by default, no transition parameter needed
    assert(
      videoXfade.includes("duration=0.30"),
      "Should have duration=0.30 (300ms)"
    );
    assert(videoXfade.includes("[vx1]"), "Should output to [vx1]");

    // Check audio acrossfade
    const audioAcrossfade = result.chain[1];
    assert(
      audioAcrossfade.includes("[a0][a1]acrossfade"),
      "Should include [a0][a1]acrossfade"
    );
    assert(audioAcrossfade.includes("d=0.30"), "Should have d=0.30 (300ms)");
    assert(audioAcrossfade.includes("[ax1]"), "Should output to [ax1]");

    assert(
      result.vOut === "[vx1]",
      "Should return [vx1] as final video output"
    );
    assert(
      result.aOut === "[ax1]",
      "Should return [ax1] as final audio output"
    );

    logTestResult(testName, true);
  } catch (error) {
    logTestResult(testName, false, error.message);
    throw error;
  }
}

// Test 6: buildCrossfadeChain - Three segments (two transitions)
function test6_BuildCrossfadeChain_ThreeSegments() {
  const testName =
    "Test 6: buildCrossfadeChain - Three Segments (Two Transitions)";
  logger.info(`\n${"=".repeat(60)}`);
  logger.info(testName);
  logger.info("=".repeat(60));

  try {
    const keeps = [
      { start: 0, end: 5 }, // 5 seconds
      { start: 10, end: 15 }, // 5 seconds
      { start: 20, end: 25 }, // 5 seconds
    ];
    const result = buildCrossfadeChain(keeps, { durationMs: 300 });

    assert(Array.isArray(result.chain), "Should return chain array");
    assert(
      result.chain.length === 4,
      "Should return 4 chain parts (2 transitions × 2 streams)"
    );

    // First transition: [v0][v1] -> [vx1], [a0][a1] -> [ax1]
    assert(
      result.chain[0].includes("[v0][v1]xfade"),
      "First transition should use [v0][v1]"
    );
    assert(
      result.chain[0].includes("[vx1]"),
      "First transition should output to [vx1]"
    );
    assert(
      result.chain[1].includes("[a0][a1]acrossfade"),
      "First audio transition should use [a0][a1]"
    );

    // Second transition: [vx1][v2] -> [vx2], [ax1][a2] -> [ax2]
    assert(
      result.chain[2].includes("[vx1][v2]xfade"),
      "Second transition should use [vx1][v2]"
    );
    assert(
      result.chain[2].includes("[vx2]"),
      "Second transition should output to [vx2]"
    );
    assert(
      result.chain[3].includes("[ax1][a2]acrossfade"),
      "Second audio transition should use [ax1][a2]"
    );

    assert(
      result.vOut === "[vx2]",
      "Should return [vx2] as final video output"
    );
    assert(
      result.aOut === "[ax2]",
      "Should return [ax2] as final audio output"
    );

    logTestResult(testName, true);
  } catch (error) {
    logTestResult(testName, false, error.message);
    throw error;
  }
}

// Test 7: buildCrossfadeChain - Error handling (invalid duration)
function test7_BuildCrossfadeChain_ErrorHandling() {
  const testName = "Test 7: buildCrossfadeChain - Error Handling";
  logger.info(`\n${"=".repeat(60)}`);
  logger.info(testName);
  logger.info("=".repeat(60));

  try {
    const keeps = [
      { start: 0, end: 5 },
      { start: 10, end: 15 },
    ];

    // Test invalid duration (too large)
    try {
      buildCrossfadeChain(keeps, { durationMs: 6000 });
      assert(false, "Should throw error for duration > 5000ms");
    } catch (error) {
      assert(error instanceof TransitionError, "Should throw TransitionError");
      assert(
        error.type === ERROR_TYPES.INVALID_DURATION,
        "Should have INVALID_DURATION error type"
      );
    }

    // Test invalid duration (zero or negative)
    try {
      buildCrossfadeChain(keeps, { durationMs: 0 });
      assert(false, "Should throw error for duration = 0");
    } catch (error) {
      assert(
        error instanceof TransitionError || error instanceof Error,
        "Should throw error for zero duration"
      );
    }

    try {
      buildCrossfadeChain(keeps, { durationMs: -100 });
      assert(false, "Should throw error for negative duration");
    } catch (error) {
      assert(
        error instanceof TransitionError || error instanceof Error,
        "Should throw error for negative duration"
      );
    }

    logTestResult(testName, true);
  } catch (error) {
    logTestResult(testName, false, error.message);
    throw error;
  }
}

// Test 8: buildTransitionGraph - Complete graph assembly
function test8_BuildTransitionGraph_CompleteGraph() {
  const testName = "Test 8: buildTransitionGraph - Complete Graph Assembly";
  logger.info(`\n${"=".repeat(60)}`);
  logger.info(testName);
  logger.info("=".repeat(60));

  try {
    const keeps = [
      { start: 0, end: 5 },
      { start: 10, end: 15 },
    ];
    const result = buildTransitionGraph(keeps, { durationMs: 300 });

    assert(
      typeof result.filtergraph === "string",
      "Should return filtergraph string"
    );
    assert(result.vOut === "[vx1]", "Should return correct video output label");
    assert(result.aOut === "[ax1]", "Should return correct audio output label");

    // Check that filtergraph contains trim nodes
    assert(
      result.filtergraph.includes("[0:v]trim=start=0.00:end=5.00"),
      "Should include first video trim"
    );
    assert(
      result.filtergraph.includes("[0:a]atrim=start=0.00:end=5.00"),
      "Should include first audio trim"
    );
    assert(
      result.filtergraph.includes("[0:v]trim=start=10.00:end=15.00"),
      "Should include second video trim"
    );

    // Check that filtergraph contains transition chain
    // Note: xfade is crossfade by default, no transition parameter needed
    assert(
      result.filtergraph.includes("xfade"),
      "Should include xfade transition"
    );
    assert(
      result.filtergraph.includes("acrossfade"),
      "Should include acrossfade transition"
    );

    // Check that parts are joined with semicolons
    const parts = result.filtergraph.split(";");
    assert(
      parts.length >= 4,
      "Should have at least 4 parts (2 trims + 2 transitions)"
    );

    logTestResult(testName, true);
  } catch (error) {
    logTestResult(testName, false, error.message);
    throw error;
  }
}

// Test 9: buildTransitionGraph - Single segment (no transitions)
function test9_BuildTransitionGraph_SingleSegment() {
  const testName =
    "Test 9: buildTransitionGraph - Single Segment (No Transitions)";
  logger.info(`\n${"=".repeat(60)}`);
  logger.info(testName);
  logger.info("=".repeat(60));

  try {
    const keeps = [{ start: 0, end: 5 }];
    const result = buildTransitionGraph(keeps, { durationMs: 300 });

    assert(
      typeof result.filtergraph === "string",
      "Should return filtergraph string"
    );
    assert(result.vOut === "[v0]", "Should return [v0] as video output");
    assert(result.aOut === "[a0]", "Should return [a0] as audio output");

    // Check that filtergraph contains trim nodes but no transitions
    assert(
      result.filtergraph.includes("[0:v]trim=start=0.00:end=5.00"),
      "Should include video trim"
    );
    assert(
      result.filtergraph.includes("[0:a]atrim=start=0.00:end=5.00"),
      "Should include audio trim"
    );
    assert(
      !result.filtergraph.includes("xfade"),
      "Should NOT include xfade for single segment"
    );
    assert(
      !result.filtergraph.includes("acrossfade"),
      "Should NOT include acrossfade for single segment"
    );

    logTestResult(testName, true);
  } catch (error) {
    logTestResult(testName, false, error.message);
    throw error;
  }
}

// Test 10: FFmpeg command structure validation
function test10_FFmpegCommandStructure() {
  const testName = "Test 10: FFmpeg Command Structure Validation";
  logger.info(`\n${"=".repeat(60)}`);
  logger.info(testName);
  logger.info("=".repeat(60));

  try {
    const keeps = [
      { start: 0, end: 5 },
      { start: 10, end: 15 },
    ];
    const result = buildTransitionGraph(keeps, { durationMs: 300 });

    // Verify filtergraph structure matches expected FFmpeg format
    // Expected format: trim nodes separated by semicolons, then transition chain
    const parts = result.filtergraph.split(";");

    // Should have: 2 video trims + 2 audio trims + 1 video xfade + 1 audio acrossfade = 6 parts
    assert(parts.length === 6, "Should have 6 filtergraph parts");

    // Verify trim nodes format
    const videoTrim0 = parts.find(
      p => p.includes("[0:v]trim") && p.includes("[v0]")
    );
    assert(videoTrim0, "Should have video trim for [v0]");
    assert(
      videoTrim0.includes("setpts=PTS-STARTPTS"),
      "Video trim should include setpts"
    );

    const audioTrim0 = parts.find(
      p => p.includes("[0:a]atrim") && p.includes("[a0]")
    );
    assert(audioTrim0, "Should have audio trim for [a0]");
    assert(
      audioTrim0.includes("asetpts=PTS-STARTPTS"),
      "Audio trim should include asetpts"
    );

    // Verify transition format
    const videoXfade = parts.find(p => p.includes("xfade"));
    assert(videoXfade, "Should have video xfade");
    // Note: xfade is crossfade by default, no transition parameter needed
    assert(
      videoXfade.includes("duration="),
      "Video xfade should include duration"
    );
    assert(videoXfade.includes("offset="), "Video xfade should include offset");

    const audioAcrossfade = parts.find(p => p.includes("acrossfade"));
    assert(audioAcrossfade, "Should have audio acrossfade");
    assert(
      audioAcrossfade.includes("d="),
      "Audio acrossfade should include duration parameter"
    );

    logTestResult(testName, true);
  } catch (error) {
    logTestResult(testName, false, error.message);
    throw error;
  }
}

// Test runner
async function runAllTests() {
  // eslint-disable-next-line no-console
  console.log("=".repeat(60));
  // eslint-disable-next-line no-console
  console.log("Transitions Logic Unit Test Suite");
  // eslint-disable-next-line no-console
  console.log("=".repeat(60));
  logger.info("=".repeat(60));
  logger.info("Transitions Logic Unit Test Suite");
  logger.info("=".repeat(60));

  const tests = [
    test1_BuildTrimNodes_SingleSegment,
    test2_BuildTrimNodes_MultipleSegments,
    test3_BuildTrimNodes_ErrorHandling,
    test4_BuildCrossfadeChain_SingleSegment,
    test5_BuildCrossfadeChain_TwoSegments,
    test6_BuildCrossfadeChain_ThreeSegments,
    test7_BuildCrossfadeChain_ErrorHandling,
    test8_BuildTransitionGraph_CompleteGraph,
    test9_BuildTransitionGraph_SingleSegment,
    test10_FFmpegCommandStructure,
  ];

  for (const test of tests) {
    try {
      test(); // Tests are synchronous
    } catch (error) {
      logger.error(`Test failed with error: ${error.message}`);
      logger.error(error.stack);
      // eslint-disable-next-line no-console
      console.error(`Test failed with error: ${error.message}`);
      // eslint-disable-next-line no-console
      console.error(error.stack);
    }
  }

  // Summary
  // eslint-disable-next-line no-console
  console.log("\n" + "=".repeat(60));
  // eslint-disable-next-line no-console
  console.log("Test Summary");
  // eslint-disable-next-line no-console
  console.log("=".repeat(60));
  // eslint-disable-next-line no-console
  console.log(`Total Tests: ${testResults.length}`);
  // eslint-disable-next-line no-console
  console.log(`Passed: ${testsPassed}`);
  // eslint-disable-next-line no-console
  console.log(`Failed: ${testsFailed}`);
  // eslint-disable-next-line no-console
  console.log("=".repeat(60));
  logger.info("\n" + "=".repeat(60));
  logger.info("Test Summary");
  logger.info("=".repeat(60));
  logger.info(`Total Tests: ${testResults.length}`);
  logger.info(`Passed: ${testsPassed}`);
  logger.info(`Failed: ${testsFailed}`);
  logger.info("=".repeat(60));

  // Print detailed results
  // eslint-disable-next-line no-console
  console.log("\nDetailed Results:");
  testResults.forEach(result => {
    const status = result.passed ? "✅" : "❌";
    // eslint-disable-next-line no-console
    console.log(
      `  ${status} ${result.testName}${result.message ? ` - ${result.message}` : ""}`
    );
  });
  logger.info("\nDetailed Results:");
  testResults.forEach(result => {
    const status = result.passed ? "✅" : "❌";
    logger.info(
      `  ${status} ${result.testName}${result.message ? ` - ${result.message}` : ""}`
    );
  });

  if (testsFailed > 0) {
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(error => {
  logger.error("Fatal error running tests:", error);
  process.exit(1);
});
