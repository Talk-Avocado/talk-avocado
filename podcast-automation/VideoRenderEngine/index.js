// VideoRenderEngine.js — Memory-Safe Streaming Edition
// Load .env for local mode from project root
if (process.env.LOCAL_MODE === "true") {
  const path = require("path");
  require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
}

const { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { createWriteStream, readFileSync, existsSync, copyFileSync, unlinkSync } = require("fs");
const { execSync } = require("child_process");
const path = require("path");
const os = require("os");

const s3 = new S3Client({ region: "eu-west-2" });

exports.handler = async (event) => {
  const record = event.Records?.[0];
  if (!record) {
    console.error("❌ No event record found");
    return;
  }

  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

  if (!key.endsWith(".cutplan.json")) {
    console.log("⏭ Skipped non-cutplan file:", key);
    return;
  }

  try {
    // 📥 Load cutplan
let cutplan;
try {
  if (process.env.LOCAL_MODE === "true") {
    const { readFileSync, existsSync } = require("fs");
    const { resolve } = require("path");
    const localPath = resolve(__dirname, "..", "test-assets", key);
    if (!existsSync(localPath)) {
      throw new Error(`❌ Cutplan file missing: ${localPath}. Aborting render.`);
    }
    
    cutplan = JSON.parse(readFileSync(localPath, "utf8"));
  } else {
    try {
      const cutplanRes = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      cutplan = JSON.parse(await cutplanRes.Body.transformToString());
    } catch (err) {
      throw new Error(`❌ Cutplan file missing in S3: ${key}. Aborting render.`);
    }
    
  }
} catch (err) {
  console.error(`❌ Failed to load cutplan: ${err.message}. Copying original video instead.`);
  return await copyOriginalVideo(bucket, key);
}


    console.log("📄 Cutplan loaded:", JSON.stringify(cutplan, null, 2));

    // Sanitize cuts to prevent invalid times from crashing
const minDuration = 0.05; // seconds
cutplan.cuts = cutplan.cuts
  .map(cut => ({
    ...cut,
    startSec: toSeconds(cut.start),
    endSec: toSeconds(cut.end)
  }))
  .filter(cut => {
    const valid = (
      !isNaN(cut.startSec) &&
      !isNaN(cut.endSec) &&
      cut.endSec - cut.startSec >= minDuration
    );
    if (!valid) console.warn(`⚠️ Skipping invalid cut: ${cut.start} → ${cut.end} (${cut.reason})`);
    return valid;
  })
  .sort((a, b) => a.startSec - b.startSec)
  .map(({ start, end, reason }) => ({ start, end, reason }));

    // 📝 Try loading polished transcript for reference
    const polishedKey = `polished/${path.basename(key).replace(".cutplan.json", ".polished.md")}`;
    try {
      let polishedMd;
      if (process.env.LOCAL_MODE === "true") {
        const { readFileSync, existsSync } = require("fs");
        const { resolve } = require("path");
        const localPath = resolve(__dirname, "..", "test-assets", polishedKey);
        if (existsSync(localPath)) {
          polishedMd = readFileSync(localPath, "utf8");
        } else {
          console.warn("⚠️ No polished transcript found for this cutplan");
        }
      } else {
        const polishedRes = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: polishedKey }));
        polishedMd = await polishedRes.Body.transformToString();
      }
      if (polishedMd) {
        console.log("📝 Polished transcript preview:\n", polishedMd.substring(0, 500) + (polishedMd.length > 500 ? "..." : ""));
      }
    } catch {
      console.warn("⚠️ No polished transcript found for this cutplan");
    }

    // 📥 Prepare input/output keys
    let inputKey = cutplan.source;
    if (!inputKey.startsWith("mp4/")) inputKey = `mp4/${inputKey.replace(/^\/?/, "")}`;
    if (!inputKey.endsWith(".mp4")) inputKey += ".mp4";
    const outputKey = `review/${cutplan.output}`;

    // 📂 Temp paths
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, path.basename(inputKey));
    const outputPath = path.join(tmpDir, path.basename(outputKey));

    if (process.env.LOCAL_MODE === "true") {
      const { copyFileSync } = require("fs");
      const { resolve } = require("path");
      const localSource = resolve(__dirname, "..", "test-assets", inputKey);
      console.log(`🧪 [Local Mode] Copying video from ${localSource}`);
      copyFileSync(localSource, inputPath);
    } else {
      console.log("🔍 Checking source video exists:", inputKey);
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: inputKey }));

      console.log(`⬇️ Streaming download from S3: ${inputKey}`);
      await streamS3ToFile(bucket, inputKey, inputPath);
    }

    // 🎯 Detect actual video duration with ffprobe
    let videoDurationSec = null;
    try {
      const ffprobeCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`;
      const result = execSync(ffprobeCmd).toString().trim();
      videoDurationSec = parseFloat(result);
      console.log(`⏱ Video duration detected: ${videoDurationSec.toFixed(2)} seconds`);
    } catch (err) {
      console.warn("⚠️ Failed to detect video duration with ffprobe, will use fallback logic");
    }

    // 🚨 Safety check: prevent producing a mostly empty video
const totalCutTime = cutplan.cuts.reduce((sum, cut) => {
  return sum + (toSeconds(cut.end) - toSeconds(cut.start));
}, 0);
const keepTime = videoDurationSec - totalCutTime;
const keepRatio = keepTime / videoDurationSec;

if (keepRatio < 0.20) { // Less than 20% keep time
  console.warn(`⚠️ Cutplan would keep only ${(keepRatio * 100).toFixed(1)}% of the video. Reverting to original.`);
  return await copyOriginalVideo(bucket, key);
}

    // 🎯 Build cut segments
    if (!cutplan.cuts || cutplan.cuts.length === 0) {
      throw new Error(`❌ Cutplan has no cuts. Aborting render.`);
    } else {
    
      console.log(`✂️ Applying ${cutplan.cuts.length} cuts:`);
      cutplan.cuts.forEach((cut, i) => {
        console.log(`  Cut ${i + 1}: ${cut.start} → ${cut.end} (${cut.reason})`);
      });

      let segments = [];

      let lastEnd = "00:00:00.00";
      const pad = 0.3; // reduced padding for tighter edits

      cutplan.cuts.forEach(cut => {
        if (toSeconds(cut.start) > toSeconds(lastEnd)) {
          // Prevent overlapping or duplicated keep ranges
          if (segments.length && toSeconds(cut.start) <= toSeconds(segments[segments.length - 1].end)) {
              return; // skip, overlap with previous keep segment
          }
      
          // Apply padding
          let segStart = Math.max(0, toSeconds(lastEnd));
let segEnd = videoDurationSec;

          // === FRAME GAP SAFEGUARD ===
// Ensure at least 1 frame gap (~0.034s at 29.97fps) between consecutive segments
const FRAME_GAP = 1 / 29.97; // ~0.0334s
if (segments.length > 0) {
  const prevEndSec = toSeconds(segments[segments.length - 1].end);
  if (segStart < prevEndSec + FRAME_GAP) {
    segStart = prevEndSec + FRAME_GAP;
  }
  // Prevent negative/zero-length segment
  if (segStart >= segEnd) {
    console.warn(`⚠️ Skipping zero/negative-length segment at ${segStart.toFixed(3)}s`);
    return; // skip pushing this segment
  }
}

segments.push({
  start: secondsToTimestamp(segStart),
  end: secondsToTimestamp(segEnd)
});

        }
        lastEnd = cut.end;
      });

      // Final tail after last cut
      if (videoDurationSec && toSeconds(lastEnd) < videoDurationSec) {
        let segStart = Math.max(0, toSeconds(lastEnd) - pad);
        let segEnd = videoDurationSec;
        // === FRAME GAP SAFEGUARD ===
// Ensure at least 1 frame gap (~0.034s at 29.97fps) between consecutive segments
const FRAME_GAP = 1 / 29.97; // ~0.0334s
if (segments.length > 0) {
  const prevEndSec = toSeconds(segments[segments.length - 1].end);
  if (segStart < prevEndSec + FRAME_GAP) {
    segStart = prevEndSec + FRAME_GAP;
  }
  // Prevent negative/zero-length segment
  if (segStart >= segEnd) {
    console.warn(`⚠️ Skipping zero/negative-length segment at ${segStart.toFixed(3)}s`);
    return; // skip pushing this segment
  }
}

segments.push({
  start: secondsToTimestamp(segStart),
  end: secondsToTimestamp(segEnd)
});

      }

      console.log("📌 Segments to keep:", segments);

      if (segments.length === 0) {
        throw new Error("❌ No valid keep segments generated after processing cuts. Aborting render.");
      } else {
      
        const segmentFiles = [];
        // Merge very close segments to avoid jumpy video
segments = segments.reduce((merged, seg) => {
  if (merged.length && (toSeconds(seg.start) - toSeconds(merged[merged.length - 1].end)) < 0.5) {

    merged[merged.length - 1].end = seg.end;
  } else {
    merged.push(seg);
  }
  return merged;
}, []);

        const concatListPath = path.join(os.tmpdir(), "concat_list.txt");

        // Extract each keep segment to a temporary file
        let pLimit = require("p-limit");
if (typeof pLimit !== "function" && pLimit.default) {
  pLimit = pLimit.default; // For p-limit v4+ (ESM default export)
}


const limit = pLimit(4); // max concurrent FFmpeg processes

await Promise.all(segments.map((seg, i) => limit(async () => {
  const segFile = path.join(os.tmpdir(), `segment-${i}.mp4`);
  let ffmpegSegCmd = `ffmpeg -y -ss ${seg.start} -to ${seg.end} -i "${inputPath}" -c:v libx264 -crf 12 -preset slow -pix_fmt yuv420p -c:a aac -b:a 256k -movflags +faststart "${segFile}"`;
  try {
    console.log(`🎬 Extracting segment ${i + 1}: ${ffmpegSegCmd}`);
    execSync(ffmpegSegCmd, { stdio: "inherit" });
  } catch (err) {
    console.warn(`⚠️ Extraction failed for segment ${i + 1}, re-encoding...`);
    const reencodeCmd = `ffmpeg -y -ss ${seg.start} -to ${seg.end} -i "${inputPath}" -c:v libx264 -crf 12 -preset slow -pix_fmt yuv420p -c:a aac -b:a 256k -movflags +faststart "${segFile}"`;
    execSync(reencodeCmd, { stdio: "inherit" });
  }
  segmentFiles.push(segFile);
})));

        

        

        // Write concat list file
        const concatListContent = segmentFiles.map(f => `file '${f}'`).join("\n");
        require("fs").writeFileSync(concatListPath, concatListContent);

        // Concat all segments into final output
// Always verify streams first to decide if direct copy is safe
const ffmpegConcatCmd = `ffmpeg -f concat -safe 0 -i "${concatListPath}" -c:v libx264 -crf 12 -preset slow -pix_fmt yuv420p -c:a aac -b:a 256k -movflags +faststart -y "${outputPath}"`;


console.log("🎬 Concatenating segments into final file:", ffmpegConcatCmd);
let concatSucceeded = false;

try {
  execSync(ffmpegConcatCmd, { stdio: "inherit" });

  // Probe output to confirm both streams exist
  const probeCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=codec_type -of csv=p=0 "${outputPath}"`;
  const probeResult = execSync(probeCmd).toString().trim();
  if (!probeResult.includes("video")) {
    throw new Error("❌ Final concat file has no video stream — must re-encode");
  }

  concatSucceeded = true;
} catch (err) {
  console.warn(`⚠️ Direct concat failed: ${err.message}`);
}

// If concat failed or is missing video, re-encode entire output
if (!concatSucceeded) {
  const ffmpegConcatReencodeCmd = `ffmpeg -f concat -safe 0 -i "${concatListPath}" -c:v libx264 -crf 12 -preset slow -pix_fmt yuv420p -c:a aac -b:a 256k -movflags +faststart -y "${outputPath}"`;
  console.log("🎬 Re-encoding with high quality:", ffmpegConcatReencodeCmd);
  execSync(ffmpegConcatReencodeCmd, { stdio: "inherit" });
}


        // Cleanup temp segments
        segmentFiles.forEach(f => existsSync(f) && unlinkSync(f));
        existsSync(concatListPath) && unlinkSync(concatListPath);
      }
    }

    // 📤 Save final video
    if (process.env.LOCAL_MODE === "true") {
      const { copyFileSync, mkdirSync } = require("fs");
      const { resolve, dirname } = require("path");
      const localDest = resolve(__dirname, "..", "test-assets", outputKey);
      mkdirSync(dirname(localDest), { recursive: true });
      copyFileSync(outputPath, localDest);
      console.log(`🧪 [Local Mode] Final video saved to: ${localDest}`);
    } else {
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: outputKey,
        Body: readFileSync(outputPath),
        ContentType: "video/mp4"
      }));
      console.log(`✅ Final video uploaded as: ${outputKey}`);
    }

    // 🧹 Cleanup
    [inputPath, outputPath].forEach(p => existsSync(p) && unlinkSync(p));
  } catch (err) {
    console.error("🔥 VideoRenderEngine failed:", err);
  }
};

// 🔹 Stream S3 file to local disk
async function streamS3ToFile(bucket, key, filePath) {
  const { Body } = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return new Promise((resolve, reject) => {
    const fileStream = createWriteStream(filePath);
    Body.pipe(fileStream)
      .on("error", reject)
      .on("close", resolve);
  });
}

// 🔹 Convert timestamp to seconds (supports ss, mm:ss, hh:mm:ss)
function toSeconds(ts) {
  if (typeof ts === "number") return ts;
  if (typeof ts !== "string") return NaN;

  ts = ts.trim();

  // Pure seconds
  if (/^\d+(\.\d+)?$/.test(ts)) {
    return parseFloat(ts);
  }

  // mm:ss(.sss)
  if (/^\d{1,2}:\d{2}(\.\d+)?$/.test(ts)) {
    const [m, s] = ts.split(":").map(parseFloat);
    return m * 60 + s;
  }

  // hh:mm:ss(.sss)
  if (/^\d{1,2}:\d{2}:\d{2}(\.\d+)?$/.test(ts)) {
    const [h, m, s] = ts.split(":").map(parseFloat);
    return h * 3600 + m * 60 + s;
  }

  return NaN;
}

function secondsToTimestamp(sec) {
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = (sec % 60).toFixed(3).padStart(6, '0');
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds}`;
}

async function copyOriginalVideo(bucket, cutplanKey) {
  const originalKey = cutplanKey
    .replace(/^plans\//, 'mp4/')
    .replace(/\.cutplan\.json$/, '.mp4');

  const outputKey = originalKey.replace(/^mp4\//, 'review/');

  if (process.env.LOCAL_MODE === "true") {
    const { copyFileSync, mkdirSync } = require("fs");
    const { resolve, dirname } = require("path");
    const localSource = resolve(__dirname, "..", "test-assets", originalKey);
    const localDest = resolve(__dirname, "..", "test-assets", outputKey);
    mkdirSync(dirname(localDest), { recursive: true });
    copyFileSync(localSource, localDest);
    console.log(`🧪 [Local Mode] Original video copied to: ${localDest}`);
  } else {
    const { Body } = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: originalKey }));
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: outputKey,
      Body,
      ContentType: "video/mp4"
    }));
    console.log(`✅ Original video copied to: ${outputKey}`);
  }
}