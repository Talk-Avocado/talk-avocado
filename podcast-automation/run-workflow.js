import path from "path";
import fs from "fs";
import readline from "readline";
import { logger } from "scripts/logger.js";

// Utility: find newest raw file & detect if multiple new files exist
function getNewestRawFile() {
    const rawDir = path.resolve(__dirname, "test-assets", "raw");
    const allowedExts = [".mp4", ".mov", ".mkv", ".avi", ".m4v"]; // add more if needed
  
    const files = fs.readdirSync(rawDir)
      .filter(file => {
        const ext = path.extname(file).toLowerCase();
        return !file.startsWith(".") && allowedExts.includes(ext);
      })
      .map(file => ({
        name: file,
        time: fs.statSync(path.join(rawDir, file)).mtime.getTime(),
        mtime: fs.statSync(path.join(rawDir, file)).mtime
      }));
  
      if (!files.length) {
        const allFiles = fs.readdirSync(rawDir);
        logger.warn("⚠️ No valid video files found in test-assets/raw/ — directory may be empty or contain only unsupported files.");
        
        if (allFiles.length) {
          logger.warn("📂 Files present in raw/:");
          allFiles.forEach(f => {
            if (f.startsWith(".")) {
              logger.warn(` - ${f} (ignored: hidden/system file)`);
            } else {
              const ext = path.extname(f).toLowerCase();
              logger.warn(` - ${f} (unsupported extension: ${ext || "none"})`);
            }
          });
        } else {
          logger.warn("📂 raw/ directory is completely empty.");
        }
        
        throw new Error("❌ No files found in test-assets/raw/");
      }
      
      
  
    const today = new Date().toDateString();
    const todayFiles = files.filter(f => f.mtime.toDateString() === today);
  
    if (todayFiles.length > 1) {
      return { multipleToday: true, todayFiles, files };
    }
  
    const newestFile = files.sort((a, b) => b.time - a.time)[0].name;
    return { multipleToday: false, newestFile };
  }
  

// Confirmation prompt
function confirm(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

(async () => {
  try {
    const { multipleToday, todayFiles, files } = getNewestRawFile();
    let newestFile = getNewestRawFile().newestFile;

    if (multipleToday) {
      logger.warn(`⚠️ Found ${todayFiles.length} raw files modified today:`);
      todayFiles.forEach(f => logger.warn(` - ${f.name}`));

      const answer = await confirm(
        "❓ Multiple raw files found from today. Continue with the newest one? (y/N): "
      );
      if (answer !== "y") {
        logger.info("🚫 Aborting.");
        process.exit(0);
      }
      files.sort((a, b) => b.time - a.time);
      newestFile = files[0].name;
    }

    const baseName = path.basename(newestFile, path.extname(newestFile));

    // Pre-run summary
    logger.info("\n📋 Workflow Summary:");
    logger.info(`  Raw video: test-assets/raw/${newestFile}`);
    logger.info("  Steps to run:");
    logger.info("    1. ExtractAudioFromVideo → outputs:");
    logger.info(`         - test-assets/mp4/${baseName}.mp4`);
    logger.info(`         - test-assets/mp3/${baseName}.mp3`);
    logger.info("    2. TranscribeWithWhisper → outputs:");
    logger.info(`         - test-assets/transcripts/${baseName}.json`);
    logger.info("    3. SmartCutPlanner → outputs:");
    logger.info(`         - test-assets/polished/${baseName}.polished.md`);
    logger.info(`         - test-assets/plans/${baseName}.cutplan.json`);
    logger.info("    4. VideoRenderEngine → outputs:");
    logger.info(`         - test-assets/review/${baseName}.final.mp4`);

    const proceed = await confirm("\n⚠️ Proceed with this workflow? (y/N): ");
    if (proceed !== "y") {
      logger.info("🚫 Aborting.");
      process.exit(0);
    }

    process.env.LOCAL_MODE = "true";

    // STEP 1: ExtractAudioFromVideo
    logger.info("\n=== STEP 1: ExtractAudioFromVideo ===");
    const { handler: extractHandler } = await import("./ExtractAudioFromVideo/index.js");
    await extractHandler({
      Records: [
        {
          s3: {
            bucket: { name: "local-bucket" },
            object: { key: `raw/${newestFile}` }
          }
        }
      ]
    });

    // STEP 2: TranscribeWithWhisper
    logger.info("\n=== STEP 2: TranscribeWithWhisper ===");
    const { handler: transcribeHandler } = await import("./TranscribeWithWhisper/index.js");
    await transcribeHandler({
      Records: [
        {
          s3: {
            bucket: { name: "local-bucket" },
            object: { key: `mp3/${baseName}.mp3` }
          }
        }
      ]
    });

    // STEP 3: SmartCutPlanner
    logger.info("\n=== STEP 3: SmartCutPlanner ===");
    const { handler: plannerHandler } = await import("./SmartCutPlanner/index.js");
    await plannerHandler({
      Records: [
        {
          s3: {
            bucket: { name: "local-bucket" },
            object: { key: `transcripts/${baseName}.json` }
          }
        }
      ]
    });

    // STEP 4: VideoRenderEngine
    logger.info("\n=== STEP 4: VideoRenderEngine ===");
    const { handler: renderHandler } = await import("./VideoRenderEngine/index.js");
    await renderHandler({
      Records: [
        {
          s3: {
            bucket: { name: "local-bucket" },
            object: { key: `plans/${baseName}.cutplan.json` }
          }
        }
      ]
    });

    logger.info("\n🎉 Workflow complete for:", newestFile);
  } catch (err) {
    logger.error("🔥 Workflow failed:", err);
    process.exit(1);
  }
})();
