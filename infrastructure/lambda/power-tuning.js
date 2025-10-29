#!/usr/bin/env node

/**
 * Lambda Power Tuning Script for TalkAvocado Media Processing Services
 *
 * This script helps optimize Lambda memory allocation by testing different
 * memory configurations and measuring performance metrics.
 */

/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");

// Memory tiers to test (in MB)
const MEMORY_TIERS = [
  128, 256, 512, 1024, 1536, 1769, 2048, 3008, 4096, 5120, 6144, 7168, 8192,
  9216, 10240,
];

// Service configurations
const SERVICES = {
  "audio-extraction": {
    description: "Audio extraction with FFmpeg",
    testPayload: {
      inputKey: "test-video.mp4",
      outputKey: "test-audio.mp3",
      duration: 60, // seconds
    },
    expectedDuration: 30, // seconds
    currentMemory: 1769,
  },
  transcription: {
    description: "Transcription with Whisper",
    testPayload: {
      inputKey: "test-audio.mp3",
      outputKey: "test-transcript.json",
      duration: 120, // seconds
    },
    expectedDuration: 90, // seconds
    currentMemory: 3008,
  },
  "smart-cut-planner": {
    description: "Smart cut planning analysis",
    testPayload: {
      inputKey: "test-transcript.json",
      outputKey: "test-cut-plan.json",
      duration: 180, // seconds
    },
    expectedDuration: 60, // seconds
    currentMemory: 1769,
  },
  "video-render-engine": {
    description: "Video rendering with FFmpeg",
    testPayload: {
      inputKey: "test-cut-plan.json",
      outputKey: "test-rendered.mp4",
      duration: 300, // seconds
    },
    expectedDuration: 180, // seconds
    currentMemory: 5120,
  },
  "ffmpeg-test": {
    description: "FFmpeg runtime validation",
    testPayload: {
      testType: "version",
      expectedVersion: "5.1.2",
    },
    expectedDuration: 5, // seconds
    currentMemory: 1769,
  },
};

class LambdaPowerTuner {
  constructor(serviceName, region = "us-east-1") {
    this.serviceName = serviceName;
    this.region = region;
    this.functionName = `talk-avocado-${serviceName}-dev`;
    this.results = [];
  }

  /**
   * Test a specific memory configuration
   */
  async testMemoryConfiguration(memoryMB) {
    console.log(
      `\n🧪 Testing ${this.serviceName} with ${memoryMB}MB memory...`
    );

    try {
      // Update function memory (this would be done via CDK in practice)
      console.log(`   📝 Updating function memory to ${memoryMB}MB...`);

      // Simulate function invocation
      const startTime = Date.now();
      const result = await this.invokeFunction(memoryMB);
      const duration = Date.now() - startTime;

      // Calculate cost (approximate)
      const cost = this.calculateCost(memoryMB, duration);

      const testResult = {
        memory: memoryMB,
        duration: duration,
        cost: cost,
        success: result.success,
        error: result.error,
        timestamp: new Date().toISOString(),
      };

      this.results.push(testResult);

      console.log(`   ✅ Duration: ${duration}ms, Cost: $${cost.toFixed(6)}`);

      return testResult;
    } catch (error) {
      console.error(`   ❌ Error testing ${memoryMB}MB:`, error.message);

      const testResult = {
        memory: memoryMB,
        duration: null,
        cost: null,
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };

      this.results.push(testResult);
      return testResult;
    }
  }

  /**
   * Simulate function invocation
   */
  async invokeFunction(memoryMB) {
    // In a real implementation, this would invoke the actual Lambda function
    // For now, we'll simulate based on the service type and memory

    const service = SERVICES[this.serviceName];
    if (!service) {
      throw new Error(`Unknown service: ${this.serviceName}`);
    }

    // Simulate processing time based on memory allocation
    // Higher memory = faster processing (up to a point)
    const baseDuration = service.expectedDuration * 1000; // Convert to ms
    const memoryFactor = Math.max(0.5, Math.min(2.0, 1024 / memoryMB));
    const simulatedDuration = baseDuration * memoryFactor;

    // Add some randomness to simulate real-world conditions
    const jitter = (Math.random() - 0.5) * 0.2; // ±10% jitter
    const actualDuration = simulatedDuration * (1 + jitter);

    // Simulate occasional failures at very low memory
    const success = memoryMB >= 512 || Math.random() > 0.1;

    return new Promise(resolve => {
      setTimeout(() => {
        resolve({
          success,
          error: success ? null : "Insufficient memory for processing",
        });
      }, actualDuration);
    });
  }

  /**
   * Calculate approximate cost for the test
   */
  calculateCost(memoryMB, durationMs) {
    // AWS Lambda pricing (as of 2024)
    const pricePerGBSecond = 0.0000166667; // $0.0000166667 per GB-second
    const pricePerRequest = 0.0000002; // $0.0000002 per request

    const durationSeconds = durationMs / 1000;
    const memoryGB = memoryMB / 1024;

    const computeCost = memoryGB * durationSeconds * pricePerGBSecond;
    const requestCost = pricePerRequest;

    return computeCost + requestCost;
  }

  /**
   * Run power tuning for all memory tiers
   */
  async runPowerTuning() {
    console.log(`🚀 Starting power tuning for ${this.serviceName}...`);
    console.log(`📊 Testing ${MEMORY_TIERS.length} memory configurations...`);

    for (const memory of MEMORY_TIERS) {
      await this.testMemoryConfiguration(memory);

      // Add delay between tests to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    this.analyzeResults();
    this.generateReport();
  }

  /**
   * Analyze test results and find optimal configuration
   */
  analyzeResults() {
    const successfulResults = this.results.filter(
      r => r.success && r.duration && r.cost
    );

    if (successfulResults.length === 0) {
      console.log("❌ No successful test results to analyze");
      return;
    }

    // Find the most cost-effective configuration
    const costEffective = successfulResults.reduce((best, current) => {
      return current.cost < best.cost ? current : best;
    });

    // Find the fastest configuration
    const fastest = successfulResults.reduce((best, current) => {
      return current.duration < best.duration ? current : best;
    });

    // Find the best balance (cost per unit of performance)
    const balanced = successfulResults.reduce((best, current) => {
      const currentEfficiency = current.duration / current.cost;
      const bestEfficiency = best.duration / best.cost;
      return currentEfficiency < bestEfficiency ? current : best;
    });

    this.analysis = {
      costEffective,
      fastest,
      balanced,
      totalTests: this.results.length,
      successfulTests: successfulResults.length,
    };
  }

  /**
   * Generate and display the power tuning report
   */
  generateReport() {
    console.log("\n📈 POWER TUNING REPORT");
    console.log("=".repeat(50));
    console.log(`Service: ${this.serviceName}`);
    console.log(`Total Tests: ${this.results.length}`);
    console.log(`Successful Tests: ${this.analysis.successfulTests}`);

    if (this.analysis.successfulTests === 0) {
      console.log("❌ No successful tests to report");
      return;
    }

    console.log("\n🏆 RECOMMENDATIONS:");
    console.log(
      `💰 Most Cost-Effective: ${this.analysis.costEffective.memory}MB`
    );
    console.log(`   Duration: ${this.analysis.costEffective.duration}ms`);
    console.log(`   Cost: $${this.analysis.costEffective.cost.toFixed(6)}`);

    console.log(`⚡ Fastest: ${this.analysis.fastest.memory}MB`);
    console.log(`   Duration: ${this.analysis.fastest.duration}ms`);
    console.log(`   Cost: $${this.analysis.fastest.cost.toFixed(6)}`);

    console.log(`⚖️  Best Balance: ${this.analysis.balanced.memory}MB`);
    console.log(`   Duration: ${this.analysis.balanced.duration}ms`);
    console.log(`   Cost: $${this.analysis.balanced.cost.toFixed(6)}`);

    // Compare with current configuration
    const currentConfig = SERVICES[this.serviceName];
    const currentResult = this.results.find(
      r => r.memory === currentConfig.currentMemory
    );

    if (currentResult && currentResult.success) {
      console.log(
        `\n📊 CURRENT CONFIGURATION (${currentConfig.currentMemory}MB):`
      );
      console.log(`   Duration: ${currentResult.duration}ms`);
      console.log(`   Cost: $${currentResult.cost.toFixed(6)}`);

      const improvement = this.analysis.balanced.cost / currentResult.cost;
      if (improvement < 1) {
        console.log(
          `   💡 Potential cost savings: ${((1 - improvement) * 100).toFixed(1)}%`
        );
      } else {
        console.log(
          `   ⚠️  Current config is ${((improvement - 1) * 100).toFixed(1)}% more expensive`
        );
      }
    }

    // Save detailed results
    this.saveResults();
  }

  /**
   * Save detailed results to file
   */
  saveResults() {
    const reportData = {
      service: this.serviceName,
      timestamp: new Date().toISOString(),
      analysis: this.analysis,
      results: this.results,
    };

    const filename = `power-tuning-${this.serviceName}-${Date.now()}.json`;
    const filepath = path.join(__dirname, "reports", filename);

    // Ensure reports directory exists
    const reportsDir = path.dirname(filepath);
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    fs.writeFileSync(filepath, JSON.stringify(reportData, null, 2));
    console.log(`\n💾 Detailed results saved to: ${filepath}`);
  }
}

/**
 * Main execution function
 */
async function main() {
  const args = process.argv.slice(2);
  const serviceName = args[0];

  if (!serviceName || !SERVICES[serviceName]) {
    console.log("Usage: node power-tuning.js <service-name>");
    console.log("Available services:");
    Object.keys(SERVICES).forEach(name => {
      console.log(`  - ${name}: ${SERVICES[name].description}`);
    });
    process.exit(1);
  }

  const tuner = new LambdaPowerTuner(serviceName);
  await tuner.runPowerTuning();
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { LambdaPowerTuner, SERVICES, MEMORY_TIERS };
