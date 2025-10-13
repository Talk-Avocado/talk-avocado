// ExtractAudioFromVideo.js — Perfected Streaming Edition
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { spawn, execSync } from "child_process";
import { tmpdir } from "os";
import { join, basename } from "path";
import { createWriteStream, readFileSync, unlinkSync, existsSync } from "fs";

const s3 = new S3Client({ region: process.env.AWS_REGION });
const lambda = new LambdaClient({ region: process.env.AWS_REGION });

export const handler = async (event) => {
  console.log("✅ Lambda triggered");
  console.log("📦 Event payload:", JSON.stringify(event));

  const record = event.Records?.[0];
  if (!record) {
    console.error("❌ No event record found");
    return { statusCode: 400, body: "No event record" };
  }

  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
  const originalName = basename(key).replace(/^raw\//, "");
  const nameWithoutExt = originalName.replace(/\.[^.]+$/, "");

  const tempInputPath = join(tmpdir(), originalName);
  const normalizedPath = join(tmpdir(), `${nameWithoutExt}.mp4`);
  const tempOutputPath = join(tmpdir(), `${nameWithoutExt}.mp3`);

  try {
    // ⬇️ Stream from S3 → Local disk
    console.log(`⬇️ Streaming download from S3: ${key}`);
    await streamS3ToFile(bucket, key, tempInputPath);

    // 🔄 Convert to MP4 if needed
    let inputForAudio = tempInputPath;
    if (!key.toLowerCase().endsWith(".mp4")) {
      console.log("🔄 Converting to .mp4");
      execSync(`ffmpeg -i "${tempInputPath}" -c:v libx264 -crf 23 -preset fast -c:a aac -b:a 128k -y "${normalizedPath}"`, { stdio: "inherit" });
      inputForAudio = normalizedPath;
    }

    // 📤 Save final MP4 to S3
    const finalVideoKey = `mp4/${nameWithoutExt}.mp4`;
    await uploadFileToS3(bucket, finalVideoKey, inputForAudio, "video/mp4");
    console.log(`📤 .mp4 saved as: ${finalVideoKey}`);

    // 🎧 Extract MP3 audio
    console.log("🎧 Extracting audio...");
    await runFfmpeg([
      "-i", inputForAudio,
      "-vn",
      "-acodec", "libmp3lame",
      "-b:a", "128k",
      tempOutputPath
    ]);

    if (!existsSync(tempOutputPath)) throw new Error(".mp3 not created");

    // 📤 Save MP3 to S3
    const audioKey = `mp3/${nameWithoutExt}.mp3`;
    await uploadFileToS3(bucket, audioKey, tempOutputPath, "audio/mpeg");
    console.log(`📤 .mp3 saved as: ${audioKey}`);

    // 🚀 Trigger StartTranscriptionJob Lambda
    await lambda.send(new InvokeCommand({
      FunctionName: "StartTranscriptionJob",
      InvocationType: "Event",
      Payload: JSON.stringify({
        Records: [{ s3: { bucket: { name: bucket }, object: { key: audioKey } } }]
      })
    }));
    console.log("🚀 StartTranscriptionJob invoked");

    // 🧹 Cleanup
    [tempInputPath, tempOutputPath, normalizedPath].forEach(p => existsSync(p) && unlinkSync(p));

    return { statusCode: 200, body: `Extracted and uploaded ${audioKey}` };
  } catch (error) {
    console.error("🔥 Lambda failed:", error);
    return { statusCode: 500, body: `Error: ${error.message}` };
  }
};

/**
 * Stream large S3 file to disk to prevent OOM
 */
async function streamS3ToFile(bucket, key, filePath) {
  if (process.env.LOCAL_MODE === "true") {
    console.log("🧪 [Local Mode] Reading file from local disk:", key);
    const { copyFileSync } = require("fs");
    const { resolve } = require("path");

    // Look in the mirrored subfolder structure inside test-assets
    const localPath = resolve(__dirname, "..", "test-assets", key);
    copyFileSync(localPath, filePath);
    return;
  }

  const { Body } = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return new Promise((resolve, reject) => {
    const fileStream = createWriteStream(filePath);
    Body.pipe(fileStream)
      .on("error", reject)
      .on("close", resolve);
  });
}


/**
 * Upload file from disk to S3
 */
async function uploadFileToS3(bucket, key, filePath, contentType) {
  if (process.env.LOCAL_MODE === "true") {
    console.log(`🧪 [Local Mode] Saving output locally as ${key}`);
    const { copyFileSync, mkdirSync } = require("fs");
    const { resolve, dirname } = require("path");

    // Build the same folder structure inside test-assets
    const localPath = resolve(__dirname, "..", "test-assets", key);
    mkdirSync(dirname(localPath), { recursive: true });
    copyFileSync(filePath, localPath);
    return;
  }

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: readFileSync(filePath),
    ContentType: contentType,
    ACL: "bucket-owner-full-control"
  }));
}


/**
 * Run ffmpeg command with logging
 */
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", args);
    ffmpeg.stderr.on("data", data => console.log("ffmpeg:", data.toString()));
    ffmpeg.on("close", code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))));
  });
}
