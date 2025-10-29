#!/usr/bin/env node

/**
 * Comprehensive Performance Testing Script for TalkAvocado Lambda Functions
 * 
 * This script combines power tuning and init duration testing to provide
 * a complete performance analysis and optimization recommendations.
 */

/* eslint-disable no-console */

const { LambdaPowerTuner } = require('./power-tuning.js');
const { InitDurationTester } = require('./init-duration-test.js');
const fs = require('fs');
const path = require('path');

class PerformanceTester {
  constructor(serviceName, region = 'us-east-1') {
    this.serviceName = serviceName;
    this.region = region;
    this.powerTuner = new LambdaPowerTuner(serviceName, region);
    this.initTester = new InitDurationTester(serviceName, region);
    this.combinedResults = {};
  }

  /**
   * Run comprehensive performance testing
   */
  async runPerformanceTests() {
    console.log(`🚀 Starting comprehensive performance testing for ${this.serviceName}...`);
    console.log('='.repeat(60));
    
    try {
      // Run power tuning tests
      console.log('\n📊 PHASE 1: POWER TUNING');
      console.log('-'.repeat(30));
      await this.powerTuner.runPowerTuning();
      
      // Run init duration tests
      console.log('\n⏱️  PHASE 2: INIT DURATION TESTING');
      console.log('-'.repeat(30));
      await this.initTester.runInitDurationTests(5);
      
      // Generate combined analysis
      this.generateCombinedAnalysis();
      
    } catch (error) {
      console.error('❌ Error during performance testing:', error.message);
      throw error;
    }
  }

  /**
   * Generate combined analysis and recommendations
   */
  generateCombinedAnalysis() {
    console.log('\n📈 COMBINED PERFORMANCE ANALYSIS');
    console.log('='.repeat(60));
    
    const powerAnalysis = this.powerTuner.analysis;
    const initAnalysis = this.initTester.analysis;
    
    if (!powerAnalysis || !initAnalysis) {
      console.log('❌ Incomplete test results - cannot generate combined analysis');
      return;
    }
    
    // Performance score calculation
    const performanceScore = this.calculatePerformanceScore(powerAnalysis, initAnalysis);
    
    console.log(`\n🎯 OVERALL PERFORMANCE SCORE: ${performanceScore}/100`);
    
    // Memory optimization recommendations
    console.log('\n💾 MEMORY OPTIMIZATION:');
    console.log(`Recommended Memory: ${powerAnalysis.balanced.memory}MB`);
    console.log(`Current Memory: ${this.getCurrentMemory()}`);
    
    const memoryImprovement = this.calculateMemoryImprovement(powerAnalysis);
    if (memoryImprovement > 0) {
      console.log(`Potential Cost Savings: ${memoryImprovement.toFixed(1)}%`);
    }
    
    // Init duration recommendations
    console.log('\n⚡ INITIALIZATION OPTIMIZATION:');
    console.log(`Average Init Time: ${initAnalysis.avgInitTime}ms`);
    console.log(`Performance Category: ${initAnalysis.performanceCategory.toUpperCase()}`);
    
    if (initAnalysis.performanceCategory === 'poor') {
      console.log('🚨 CRITICAL: Init time exceeds acceptable limits');
      this.generateInitOptimizationRecommendations();
    }
    
    // Combined recommendations
    this.generateCombinedRecommendations(powerAnalysis, initAnalysis, performanceScore);
    
    // Save combined report
    this.saveCombinedReport(powerAnalysis, initAnalysis, performanceScore);
  }

  /**
   * Calculate overall performance score
   */
  calculatePerformanceScore(powerAnalysis, initAnalysis) {
    let score = 0;
    
    // Memory efficiency score (40% weight)
    const memoryScore = this.calculateMemoryScore(powerAnalysis);
    score += memoryScore * 0.4;
    
    // Init duration score (30% weight)
    const initScore = this.calculateInitScore(initAnalysis);
    score += initScore * 0.3;
    
    // Consistency score (20% weight)
    const consistencyScore = this.calculateConsistencyScore(initAnalysis);
    score += consistencyScore * 0.2;
    
    // Cost effectiveness score (10% weight)
    const costScore = this.calculateCostScore(powerAnalysis);
    score += costScore * 0.1;
    
    return Math.round(score);
  }

  /**
   * Calculate memory efficiency score
   */
  calculateMemoryScore(powerAnalysis) {
    if (!powerAnalysis.balanced) return 0;
    
    const currentMemory = this.getCurrentMemory();
    const recommendedMemory = powerAnalysis.balanced.memory;
    
    // Score based on how close recommended memory is to current
    const memoryRatio = Math.min(recommendedMemory, currentMemory) / Math.max(recommendedMemory, currentMemory);
    return Math.round(memoryRatio * 100);
  }

  /**
   * Calculate init duration score
   */
  calculateInitScore(initAnalysis) {
    const service = this.initTester.SERVICES[this.serviceName];
    if (!service) return 0;
    
    const avgInitTime = initAnalysis.avgInitTime;
    const expectedTime = service.expectedInitTime;
    const criticalTime = service.criticalInitTime;
    
    if (avgInitTime <= expectedTime) {
      return 100;
    } else if (avgInitTime <= criticalTime) {
      return 80;
    } else {
      return Math.max(0, 60 - ((avgInitTime - criticalTime) / criticalTime) * 40);
    }
  }

  /**
   * Calculate consistency score
   */
  calculateConsistencyScore(initAnalysis) {
    const coefficientOfVariation = (initAnalysis.stdDev / initAnalysis.avgInitTime) * 100;
    
    if (coefficientOfVariation <= 10) return 100;
    if (coefficientOfVariation <= 20) return 80;
    if (coefficientOfVariation <= 30) return 60;
    return 40;
  }

  /**
   * Calculate cost effectiveness score
   */
  calculateCostScore(powerAnalysis) {
    if (!powerAnalysis.balanced) return 0;
    
    const currentMemory = this.getCurrentMemory();
    const currentResult = powerAnalysis.results.find(r => r.memory === currentMemory);
    
    if (!currentResult || !currentResult.success) return 50;
    
    const costImprovement = (currentResult.cost - powerAnalysis.balanced.cost) / currentResult.cost;
    return Math.max(0, Math.min(100, 50 + costImprovement * 100));
  }

  /**
   * Get current memory configuration
   */
  getCurrentMemory() {
    const service = this.initTester.SERVICES[this.serviceName];
    return service ? service.currentMemory : 1024;
  }

  /**
   * Calculate memory improvement percentage
   */
  calculateMemoryImprovement(powerAnalysis) {
    const currentMemory = this.getCurrentMemory();
    const currentResult = powerAnalysis.results.find(r => r.memory === currentMemory);
    
    if (!currentResult || !currentResult.success || !powerAnalysis.balanced) {
      return 0;
    }
    
    return ((currentResult.cost - powerAnalysis.balanced.cost) / currentResult.cost) * 100;
  }

  /**
   * Generate initialization optimization recommendations
   */
  generateInitOptimizationRecommendations() {
    console.log('\n🔧 INIT OPTIMIZATION RECOMMENDATIONS:');
    console.log('1. Reduce container image size:');
    console.log('   - Use multi-stage builds');
    console.log('   - Remove unnecessary dependencies');
    console.log('   - Use Alpine Linux base images');
    
    console.log('2. Optimize dependency loading:');
    console.log('   - Lazy load non-critical dependencies');
    console.log('   - Use tree shaking to remove unused code');
    console.log('   - Consider using Lambda layers for common dependencies');
    
    console.log('3. Implement initialization optimization:');
    console.log('   - Use provisioned concurrency for critical functions');
    console.log('   - Implement connection pooling');
    console.log('   - Cache frequently used data');
    
    console.log('4. Monitor and measure:');
    console.log('   - Set up CloudWatch alarms for init duration');
    console.log('   - Use X-Ray tracing to identify bottlenecks');
    console.log('   - Regular performance testing');
  }

  /**
   * Generate combined recommendations
   */
  generateCombinedRecommendations(powerAnalysis, initAnalysis, performanceScore) {
    console.log('\n🎯 COMBINED RECOMMENDATIONS:');
    
    if (performanceScore >= 90) {
      console.log('✅ EXCELLENT: Current configuration is highly optimized');
      console.log('   - Continue monitoring performance');
      console.log('   - Consider minor optimizations for cost savings');
    } else if (performanceScore >= 70) {
      console.log('✅ GOOD: Configuration is well-optimized with room for improvement');
      console.log('   - Implement recommended memory changes');
      console.log('   - Monitor init duration trends');
    } else if (performanceScore >= 50) {
      console.log('⚠️  FAIR: Configuration needs optimization');
      console.log('   - Implement memory optimization');
      console.log('   - Address init duration issues');
      console.log('   - Consider architectural changes');
    } else {
      console.log('❌ POOR: Configuration requires significant optimization');
      console.log('   - Immediate memory optimization required');
      console.log('   - Critical init duration issues must be addressed');
      console.log('   - Consider complete architectural review');
    }
    
    // Specific action items
    console.log('\n📋 ACTION ITEMS:');
    console.log(`1. Update memory to ${powerAnalysis.balanced.memory}MB`);
    console.log('2. Monitor init duration and implement optimizations if needed');
    console.log('3. Set up CloudWatch alarms for performance monitoring');
    console.log('4. Schedule regular performance reviews');
  }

  /**
   * Save combined performance report
   */
  saveCombinedReport(powerAnalysis, initAnalysis, performanceScore) {
    const reportData = {
      service: this.serviceName,
      timestamp: new Date().toISOString(),
      performanceScore,
      powerAnalysis,
      initAnalysis,
      recommendations: {
        recommendedMemory: powerAnalysis.balanced.memory,
        currentMemory: this.getCurrentMemory(),
        memoryImprovement: this.calculateMemoryImprovement(powerAnalysis),
        initOptimizationNeeded: initAnalysis.performanceCategory === 'poor'
      }
    };
    
    const filename = `performance-report-${this.serviceName}-${Date.now()}.json`;
    const filepath = path.join(__dirname, 'reports', filename);
    
    // Ensure reports directory exists
    const reportsDir = path.dirname(filepath);
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    
    fs.writeFileSync(filepath, JSON.stringify(reportData, null, 2));
    console.log(`\n💾 Combined performance report saved to: ${filepath}`);
  }
}

/**
 * Main execution function
 */
async function main() {
  const args = process.argv.slice(2);
  const serviceName = args[0];
  
  if (!serviceName) {
    console.log('Usage: node performance-test.js <service-name>');
    console.log('Available services:');
    const services = ['audio-extraction', 'transcription', 'smart-cut-planner', 'video-render-engine', 'ffmpeg-test'];
    services.forEach(name => {
      console.log(`  - ${name}`);
    });
    process.exit(1);
  }
  
  const tester = new PerformanceTester(serviceName);
  await tester.runPerformanceTests();
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { PerformanceTester };
