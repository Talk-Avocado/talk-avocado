#!/usr/bin/env node
// show-test-results.js - Parse and display test results in readable format
/* eslint-disable no-console */

import fs from "fs";

const logFile = "test-results-latest.txt";

if (!fs.existsSync(logFile)) {
  console.log("Test results file not found. Please run the tests first.");
  process.exit(1);
}

const content = fs.readFileSync(logFile, "utf-8");
const lines = content.split("\n");

console.log("=".repeat(60));
console.log("Smart Cut Planner Test Results");
console.log("=".repeat(60));
console.log("");

// Extract test results
const testResults = [];

for (const line of lines) {
  // Look for test pass/fail messages
  if (line.includes("✅") || line.includes("❌")) {
    const match = line.match(/(✅|❌)\s*(Test \d+[^:]*):\s*(.*)/);
    if (match) {
      testResults.push({
        status: match[1],
        name: match[2],
        message: match[3],
      });
    }
  }

  // Look for summary
  if (
    line.includes("Test Summary") ||
    line.includes("Passed:") ||
    line.includes("Failed:")
  ) {
    console.log(line);
  }
}

// Display results
if (testResults.length > 0) {
  console.log("\nTest Results:");
  console.log("-".repeat(60));
  testResults.forEach(result => {
    console.log(`${result.status} ${result.name}`);
    if (result.message) {
      console.log(`   ${result.message}`);
    }
  });
  console.log("-".repeat(60));
  console.log(`\nTotal: ${testResults.length} tests`);
  const passed = testResults.filter(r => r.status === "✅").length;
  const failed = testResults.filter(r => r.status === "❌").length;
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
} else {
  console.log("No test results found in output.");
  console.log("Raw output (last 20 lines):");
  lines.slice(-20).forEach(line => console.log(line));
}

console.log("\n" + "=".repeat(60));
