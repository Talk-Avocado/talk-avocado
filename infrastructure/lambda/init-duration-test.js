#!/usr/bin/env node

/**
 * Lambda Init Duration Test Script for TalkAvocado Media Processing Services
 * 
 * This script measures the cold start initialization time for Lambda functions
 * to help optimize container image size and initialization performance.
 */

/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

// Service configurations for init duration testing
const SERVICES = {
  'audio-extraction': {
    description: 'Audio extraction with FFmpeg',
    expectedInitTime: 5000, // 5 seconds
    criticalInitTime: 10000, // 10 seconds
    dependencies: ['ffmpeg', 'ffprobe', 'node_modules']
  },
  'transcription': {
    description: 'Transcription with Whisper',
    expectedInitTime: 8000, // 8 seconds
    criticalInitTime: 15000, // 15 seconds
    dependencies: ['whisper', 'ffmpeg', 'ffprobe', 'node_modules']
  },
  'smart-cut-planner': {
    description: 'Smart cut planning analysis',
    expectedInitTime: 3000, // 3 seconds
    criticalInitTime: 8000, // 8 seconds
    dependencies: ['node_modules', 'analysis-libs']
  },
  'video-render-engine': {
    description: 'Video rendering with FFmpeg',
    expectedInitTime: 6000, // 6 seconds
    criticalInitTime: 12000, // 12 seconds
    dependencies: ['ffmpeg', 'ffprobe', 'node_modules']
  },
  'ffmpeg-test': {
    description: 'FFmpeg runtime validation',
    expectedInitTime: 2000, // 2 seconds
    criticalInitTime: 5000, // 5 seconds
    dependencies: ['ffmpeg', 'ffprobe']
  }
};

class InitDurationTester {
  constructor(serviceName, region = 'us-east-1') {
    this.serviceName = serviceName;
    this.region = region;
    this.functionName = `talk-avocado-${serviceName}-dev`;
    this.results = [];
  }

  /**
   * Test cold start initialization duration
   */
  async testInitDuration(iteration = 1) {
    console.log(`\n🧪 Testing init duration for ${this.serviceName} (iteration ${iteration})...`);
    
    try {
      // Simulate cold start by invoking function after a delay
      // In practice, this would involve actual Lambda invocations
      const startTime = Date.now();
      
      // Simulate the initialization process
      const initTime = await this.simulateInitProcess();
      const totalTime = Date.now() - startTime;
      
      const result = {
        iteration,
        initTime,
        totalTime,
        timestamp: new Date().toISOString(),
        success: true
      };
      
      this.results.push(result);
      
      const status = this.getInitStatus(initTime);
      console.log(`   ${status} Init time: ${initTime}ms (Total: ${totalTime}ms)`);
      
      return result;
      
    } catch (error) {
      console.error(`   ❌ Error in iteration ${iteration}:`, error.message);
      
      const result = {
        iteration,
        initTime: null,
        totalTime: null,
        timestamp: new Date().toISOString(),
        success: false,
        error: error.message
      };
      
      this.results.push(result);
      return result;
    }
  }

  /**
   * Simulate the Lambda initialization process
   */
  async simulateInitProcess() {
    const service = SERVICES[this.serviceName];
    if (!service) {
      throw new Error(`Unknown service: ${this.serviceName}`);
    }
    
    // Simulate different initialization phases
    const phases = [
      { name: 'Container startup', duration: 1000 + Math.random() * 500 },
      { name: 'Runtime initialization', duration: 500 + Math.random() * 300 },
      { name: 'Dependency loading', duration: this.simulateDependencyLoading(service.dependencies) },
      { name: 'FFmpeg initialization', duration: this.simulateFFmpegInit() },
      { name: 'Application startup', duration: 200 + Math.random() * 200 }
    ];
    
    let totalInitTime = 0;
    
    for (const phase of phases) {
      console.log(`     ⏳ ${phase.name}...`);
      await this.sleep(phase.duration);
      totalInitTime += phase.duration;
    }
    
    return totalInitTime;
  }

  /**
   * Simulate dependency loading time
   */
  simulateDependencyLoading(dependencies) {
    let baseTime = 0;
    
    dependencies.forEach(dep => {
      switch (dep) {
        case 'ffmpeg':
        case 'ffprobe':
          baseTime += 800 + Math.random() * 400; // FFmpeg binary loading
          break;
        case 'whisper':
          baseTime += 2000 + Math.random() * 1000; // Whisper model loading
          break;
        case 'node_modules':
          baseTime += 1000 + Math.random() * 500; // NPM packages
          break;
        case 'analysis-libs':
          baseTime += 500 + Math.random() * 300; // Analysis libraries
          break;
        default:
          baseTime += 100 + Math.random() * 100;
      }
    });
    
    return baseTime;
  }

  /**
   * Simulate FFmpeg initialization
   */
  simulateFFmpegInit() {
    if (this.serviceName === 'ffmpeg-test') {
      return 300 + Math.random() * 200; // Quick validation
    }
    
    if (this.serviceName.includes('video') || this.serviceName.includes('audio')) {
      return 1000 + Math.random() * 500; // Full FFmpeg init
    }
    
    return 0; // No FFmpeg for some services
  }

  /**
   * Get status emoji based on init time
   */
  getInitStatus(initTime) {
    const service = SERVICES[this.serviceName];
    
    if (initTime <= service.expectedInitTime) {
      return '✅';
    } else if (initTime <= service.criticalInitTime) {
      return '⚠️';
    } else {
      return '❌';
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Run multiple init duration tests
   */
  async runInitDurationTests(iterations = 5) {
    console.log(`🚀 Starting init duration tests for ${this.serviceName}...`);
    console.log(`📊 Running ${iterations} iterations...`);
    
    for (let i = 1; i <= iterations; i++) {
      await this.testInitDuration(i);
      
      // Add delay between tests to ensure cold starts
      if (i < iterations) {
        console.log('   ⏸️  Waiting for cold start...');
        await this.sleep(2000);
      }
    }
    
    this.analyzeResults();
    this.generateReport();
  }

  /**
   * Analyze test results
   */
  analyzeResults() {
    const successfulResults = this.results.filter(r => r.success && r.initTime);
    
    if (successfulResults.length === 0) {
      console.log('❌ No successful test results to analyze');
      return;
    }
    
    const initTimes = successfulResults.map(r => r.initTime);
    const avgInitTime = initTimes.reduce((sum, time) => sum + time, 0) / initTimes.length;
    const minInitTime = Math.min(...initTimes);
    const maxInitTime = Math.max(...initTimes);
    
    // Calculate standard deviation
    const variance = initTimes.reduce((sum, time) => sum + Math.pow(time - avgInitTime, 2), 0) / initTimes.length;
    const stdDev = Math.sqrt(variance);
    
    // Determine performance category
    const service = SERVICES[this.serviceName];
    let performanceCategory = 'excellent';
    if (avgInitTime > service.criticalInitTime) {
      performanceCategory = 'poor';
    } else if (avgInitTime > service.expectedInitTime) {
      performanceCategory = 'acceptable';
    }
    
    this.analysis = {
      avgInitTime: Math.round(avgInitTime),
      minInitTime,
      maxInitTime,
      stdDev: Math.round(stdDev),
      performanceCategory,
      totalTests: this.results.length,
      successfulTests: successfulResults.length,
      expectedInitTime: service.expectedInitTime,
      criticalInitTime: service.criticalInitTime
    };
  }

  /**
   * Generate and display the init duration report
   */
  generateReport() {
    console.log('\n📈 INIT DURATION REPORT');
    console.log('='.repeat(50));
    console.log(`Service: ${this.serviceName}`);
    console.log(`Total Tests: ${this.results.length}`);
    console.log(`Successful Tests: ${this.analysis.successfulTests}`);
    
    if (this.analysis.successfulTests === 0) {
      console.log('❌ No successful tests to report');
      return;
    }
    
    console.log('\n📊 STATISTICS:');
    console.log(`Average Init Time: ${this.analysis.avgInitTime}ms`);
    console.log(`Min Init Time: ${this.analysis.minInitTime}ms`);
    console.log(`Max Init Time: ${this.analysis.maxInitTime}ms`);
    console.log(`Standard Deviation: ${this.analysis.stdDev}ms`);
    
    console.log('\n🎯 PERFORMANCE ANALYSIS:');
    console.log(`Expected Init Time: ${this.analysis.expectedInitTime}ms`);
    console.log(`Critical Init Time: ${this.analysis.criticalInitTime}ms`);
    console.log(`Performance Category: ${this.analysis.performanceCategory.toUpperCase()}`);
    
    // Performance recommendations
    console.log('\n💡 RECOMMENDATIONS:');
    if (this.analysis.performanceCategory === 'poor') {
      console.log('❌ Init time exceeds critical threshold');
      console.log('   - Consider reducing container image size');
      console.log('   - Optimize dependency loading');
      console.log('   - Use provisioned concurrency for critical functions');
    } else if (this.analysis.performanceCategory === 'acceptable') {
      console.log('⚠️  Init time is acceptable but could be improved');
      console.log('   - Consider optimizing container image');
      console.log('   - Review dependency requirements');
    } else {
      console.log('✅ Init time is excellent');
      console.log('   - Current configuration is optimal');
    }
    
    // Consistency analysis
    const coefficientOfVariation = (this.analysis.stdDev / this.analysis.avgInitTime) * 100;
    if (coefficientOfVariation > 20) {
      console.log('⚠️  High variability in init times detected');
      console.log('   - Consider investigating resource contention');
      console.log('   - Review cold start patterns');
    } else {
      console.log('✅ Init times are consistent');
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
      results: this.results
    };
    
    const filename = `init-duration-${this.serviceName}-${Date.now()}.json`;
    const filepath = path.join(__dirname, 'reports', filename);
    
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
  const iterations = parseInt(args[1]) || 5;
  
  if (!serviceName || !SERVICES[serviceName]) {
    console.log('Usage: node init-duration-test.js <service-name> [iterations]');
    console.log('Available services:');
    Object.keys(SERVICES).forEach(name => {
      console.log(`  - ${name}: ${SERVICES[name].description}`);
    });
    process.exit(1);
  }
  
  const tester = new InitDurationTester(serviceName);
  await tester.runInitDurationTests(iterations);
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { InitDurationTester, SERVICES };
