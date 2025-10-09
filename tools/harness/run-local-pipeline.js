#!/usr/bin/env node

const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    tenant: "default",
    job: null,
    input: null,
    env: "dev",
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--tenant":
        options.tenant = args[++i];
        break;
      case "--job":
        options.job = args[++i];
        break;
      case "--input":
        options.input = args[++i];
        break;
      case "--env":
        options.env = args[++i];
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        if (!options.input && !arg.startsWith("-")) {
          options.input = arg;
        }
        break;
    }
  }

  return options;
}

// Display help information
function showHelp() {
  console.log(`
TalkAvocado Local Pipeline Harness

Usage: node run-local-pipeline.js [options] [input-file]

Options:
  --tenant <id>     Tenant ID (default: default)
  --job <id>        Job ID (default: auto-generated)
  --input <path>    Input video file path
  --env <env>       Environment (dev|stage|prod) (default: dev)
  --help, -h        Show this help message

Examples:
  node run-local-pipeline.js --input video.mp4
  node run-local-pipeline.js --tenant acme --job job123 --input video.mp4 --env dev
  node run-local-pipeline.js video.mp4
`);
}

// Generate job ID if not provided
function generateJobId() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const random = Math.random().toString(36).substring(2, 8);
  return `job-${timestamp}-${random}`;
}

// Validate input file
function validateInputFile(inputPath) {
  if (!inputPath) {
    throw new Error("❌ Input file path is required");
  }

  const fullPath = path.resolve(inputPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`❌ Input file not found: ${fullPath}`);
  }

  const allowedExts = [".mp4", ".mov", ".mkv", ".avi", ".m4v", ".webm"];
  const ext = path.extname(fullPath).toLowerCase();
  if (!allowedExts.includes(ext)) {
    throw new Error(`❌ Unsupported file format: ${ext}. Supported: ${allowedExts.join(", ")}`);
  }

  return fullPath;
}

// Setup storage structure
function setupStorage(env, tenantId, jobId) {
  const storagePath = process.env.MEDIA_STORAGE_PATH || "./storage";
  const jobPath = path.join(storagePath, env, tenantId, jobId);
  
  const dirs = [
    "input",
    "audio", 
    "transcript",
    "plan",
    "renders",
    "subtitles",
    "logs"
  ];

  dirs.forEach(dir => {
    const dirPath = path.join(jobPath, dir);
    fs.mkdirSync(dirPath, { recursive: true });
  });

  return jobPath;
}

// Copy input file to storage
function copyInputFile(inputPath, jobPath) {
  const fileName = path.basename(inputPath);
  const destPath = path.join(jobPath, "input", fileName);
  fs.copyFileSync(inputPath, destPath);
  return destPath;
}

// Create manifest file
function createManifest(env, tenantId, jobId, inputFile) {
  const manifest = {
    version: "1.0",
    jobId,
    tenantId,
    env,
    input: {
      file: path.basename(inputFile),
      path: inputFile
    },
    status: "processing",
    createdAt: new Date().toISOString(),
    steps: {
      audioExtraction: { status: "pending" },
      transcription: { status: "pending" },
      cutPlanning: { status: "pending" },
      videoRendering: { status: "pending" }
    }
  };

  const manifestPath = path.join(process.env.MEDIA_STORAGE_PATH || "./storage", env, tenantId, jobId, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

// Update manifest step status
function updateManifestStep(env, tenantId, jobId, step, status, error = null) {
  const manifestPath = path.join(process.env.MEDIA_STORAGE_PATH || "./storage", env, tenantId, jobId, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  
  manifest.steps[step] = { status, error, completedAt: status === "completed" ? new Date().toISOString() : null };
  
  if (status === "failed") {
    manifest.status = "failed";
  } else if (Object.values(manifest.steps).every(s => s.status === "completed")) {
    manifest.status = "completed";
    manifest.completedAt = new Date().toISOString();
  }
  
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

// Run a service handler
async function runService(serviceName, event, env, tenantId, jobId) {
  console.log(`\n=== ${serviceName.toUpperCase()} ===`);
  
  try {
    updateManifestStep(env, tenantId, jobId, serviceName, "running");
    
    const handlerPath = path.resolve(__dirname, "..", "..", "backend", "services", serviceName, "handler.js");
    const handler = require(handlerPath);
    
    await handler.handler(event);
    
    updateManifestStep(env, tenantId, jobId, serviceName, "completed");
    console.log(`✅ ${serviceName} completed successfully`);
    
  } catch (error) {
    console.error(`❌ ${serviceName} failed:`, error.message);
    updateManifestStep(env, tenantId, jobId, serviceName, "failed", error.message);
    throw error;
  }
}

// Main pipeline execution
async function runPipeline(options) {
  const { tenant, job, input, env } = options;
  
  // Generate job ID if not provided
  const jobId = job || generateJobId();
  
  console.log("🚀 TalkAvocado Local Pipeline");
  console.log(`   Tenant: ${tenant}`);
  console.log(`   Job ID: ${jobId}`);
  console.log(`   Environment: ${env}`);
  console.log(`   Input: ${input}`);
  
  // Validate input file
  const inputPath = validateInputFile(input);
  const baseName = path.basename(inputPath, path.extname(inputPath));
  
  // Setup storage structure
  const jobPath = setupStorage(env, tenant, jobId);
  console.log(`   Storage: ${jobPath}`);
  
  // Copy input file
  const storedInputPath = copyInputFile(inputPath, jobPath);
  console.log(`   Stored input: ${storedInputPath}`);
  
  // Create manifest
  createManifest(env, tenant, jobId, storedInputPath);
  
  // Set environment variables
  process.env.LOCAL_MODE = "true";
  process.env.TALKAVOCADO_ENV = env;
  
  try {
    // Step 1: Audio Extraction
    await runService("audio-extraction", {
      Records: [{
        s3: {
          bucket: { name: "local-bucket" },
          object: { key: `raw/${path.basename(storedInputPath)}` }
        }
      }]
    }, env, tenant, jobId);
    
    // Step 2: Transcription
    await runService("transcription", {
      Records: [{
        s3: {
          bucket: { name: "local-bucket" },
          object: { key: `mp3/${baseName}.mp3` }
        }
      }]
    }, env, tenant, jobId);
    
    // Step 3: Smart Cut Planning
    await runService("smart-cut-planner", {
      Records: [{
        s3: {
          bucket: { name: "local-bucket" },
          object: { key: `transcripts/${baseName}.json` }
        }
      }]
    }, env, tenant, jobId);
    
    // Step 4: Video Rendering
    await runService("video-render-engine", {
      Records: [{
        s3: {
          bucket: { name: "local-bucket" },
          object: { key: `plans/${baseName}.cutplan.json` }
        }
      }]
    }, env, tenant, jobId);
    
    console.log("\n🎉 Pipeline completed successfully!");
    console.log(`   Final output: ${path.join(jobPath, "renders", `${baseName}.final.mp4`)}`);
    
    return 0;
    
  } catch (error) {
    console.error("\n💥 Pipeline failed:", error.message);
    return 1;
  }
}

// Main execution
async function main() {
  const options = parseArgs();
  
  if (options.help) {
    showHelp();
    return 0;
  }
  
  if (!options.input) {
    console.error("❌ Input file is required. Use --help for usage information.");
    return 1;
  }
  
  try {
    return await runPipeline(options);
  } catch (error) {
    console.error("💥 Fatal error:", error.message);
    return 1;
  }
}

// Run if called directly
if (require.main === module) {
  main().then(code => process.exit(code));
}

module.exports = { runPipeline, parseArgs, showHelp };
