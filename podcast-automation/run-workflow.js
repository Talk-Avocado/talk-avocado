import path from "path";
import fs from "fs";
import readline from "readline";

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
        console.warn("⚠️ No valid video files found in test-assets/raw/ — directory may be empty or contain only unsupported files.");
        
        if (allFiles.length) {
          console.warn("📂 Files present in raw/:");
          allFiles.forEach(f => {
            if (f.startsWith(".")) {
              console.warn(` - ${f} (ignored: hidden/system file)`);
            } else {
              const ext = path.extname(f).toLowerCase();
              console.warn(` - ${f} (unsupported extension: ${ext || "none"})`);
            }
          });
        } else {
          console.warn("📂 raw/ directory is completely empty.");
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
      console.warn(`⚠️ Found ${todayFiles.length} raw files modified today:`);
      todayFiles.forEach(f => console.warn(` - ${f.name}`));

      const answer = await confirm(
        "❓ Multiple raw files found from today. Continue with the newest one? (y/N): "
      );
      if (answer !== "y") {
        console.log("🚫 Aborting.");
        process.exit(0);
      }
      files.sort((a, b) => b.time - a.time);
      newestFile = files[0].name;
    }

    const baseName = path.basename(newestFile, path.extname(newestFile));

    // Pre-run summary
    console.log("\n📋 Workflow Summary:");
    console.log(`  Raw video: test-assets/raw/${newestFile}`);
    console.log("  Steps to run:");
    console.log("    1. ExtractAudioFromVideo → outputs:");
    console.log(`         - test-assets/mp4/${baseName}.mp4`);
    console.log(`         - test-assets/mp3/${baseName}.mp3`);
    console.log("    2. TranscribeWithWhisper → outputs:");
    console.log(`         - test-assets/transcripts/${baseName}.json`);
    console.log("    3. SmartCutPlanner → outputs:");
    console.log(`         - test-assets/polished/${baseName}.polished.md`);
    console.log(`         - test-assets/plans/${baseName}.cutplan.json`);
    console.log("    4. VideoRenderEngine → outputs:");
    console.log(`         - test-assets/review/${baseName}.final.mp4`);

    const proceed = await confirm("\n⚠️ Proceed with this workflow? (y/N): ");
    if (proceed !== "y") {
      console.log("🚫 Aborting.");
      process.exit(0);
    }

    process.env.LOCAL_MODE = "true";

    // STEP 1: ExtractAudioFromVideo
    console.log("\n=== STEP 1: ExtractAudioFromVideo ===");
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
    console.log("\n=== STEP 2: TranscribeWithWhisper ===");
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
    console.log("\n=== STEP 3: SmartCutPlanner ===");
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
    console.log("\n=== STEP 4: VideoRenderEngine ===");
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

    console.log("\n🎉 Workflow complete for:", newestFile);
  } catch (err) {
    console.error("🔥 Workflow failed:", err);
    process.exit(1);
  }
})();
