// TranscribeWithWhisper.js (Debug Mode — Chunked Processing + Words[] Recovery Retry + Fail-Fast on Missing Words[])
import { execSync } from "child_process";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import https from "https";
import path from "path";
import { tmpdir } from "os";
import { join } from "path";
import { createReadStream, createWriteStream, unlinkSync, existsSync, statSync, readFileSync } from "fs";
import dotenv from "dotenv";

// Load .env for local mode
if (process.env.LOCAL_MODE === "true") {
  dotenv.config({ path: path.resolve(process.cwd(), ".env") });
}


const s3 = new S3Client({ region: process.env.AWS_REGION });
const secrets = new SecretsManagerClient({ region: process.env.AWS_REGION });

export const handler = async (event) => {
  console.log("✅ TranscribeWithWhisper Lambda triggered");
  console.log("📦 Event payload:", JSON.stringify(event));

  const record = event.Records?.[0];
  if (!record) return console.error("❌ No event record found");

  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
  if (!key.endsWith(".mp3")) {
    console.log("⏭ Skipped non-mp3 file:", key);
    return;
  }

  const baseName = path.basename(key, ".mp3");
  const tempPath = join(tmpdir(), `${baseName}.mp3`);

  try {
    // 🔑 Get API key
let apiKey;
if (process.env.LOCAL_MODE === "true") {
  apiKey = process.env.OPENAI_API_KEY;
} else {
  const secret = await secrets.send(new GetSecretValueCommand({ SecretId: "OpenAIWhisperAPIKey" }));
  apiKey = JSON.parse(secret.SecretString).OPENAI_API_KEY;
}


    // 📥 Stream MP3 from S3 to temp file
    console.log(`⬇️ Streaming download from S3: ${key}`);
    await streamS3ToFile(bucket, key, tempPath);

    // 📏 Log file diagnostics
    const stats = statSync(tempPath);
    console.log(`📏 MP3 size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    const headerBytes = readFileSync(tempPath).slice(0, 32).toString("hex").match(/.{1,2}/g).join(" ");
    console.log(`🔍 First 32 bytes (hex): ${headerBytes}`);

    // 🎧 ffprobe diagnostics (optional)
    try {
      const ffprobeFull = execSync(`ffprobe -v quiet -print_format json -show_format -show_streams "${tempPath}"`).toString();
      console.log(`🛠 Audio Format Details:\n${ffprobeFull}`);
    } catch {
      console.warn("⚠️ Could not determine audio format via ffprobe");
    }

    // ⏳ Initial split — hard cap at 600s to avoid Whisper max limits
const chunkPaths = splitAudio(tempPath, 600);

    // Log actual duration of each chunk for debugging
chunkPaths.forEach((p, idx) => {
  try {
    const dur = parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=nokey=1:noprint_wrappers=1 "${p}"`).toString().trim());
    console.log(`⏱ Chunk ${idx + 1}: ${dur.toFixed(2)} seconds`);
  } catch {
    console.warn(`⚠️ Failed to get duration for chunk ${idx + 1}: ${p}`);
  }
});

    console.log(`🔪 Created ${chunkPaths.length} chunk(s)`);

    let mergedTranscript = { text: "", words: [], segments: [] };
    let offset = 0;

    for (const chunkPath of chunkPaths) {
      console.log(`🗣 Transcribing chunk: ${path.basename(chunkPath)} (offset ${offset}s)`);

      let result = await retryAsync(() => callWhisper(apiKey, chunkPath), 3, 2000, chunkPath);

if (result && result.autoSplit) {
  // Process each smaller chunk and merge back
  for (const smallChunk of result.chunks) {
    let smallTranscript = await retryAsync(() => callWhisper(apiKey, smallChunk), 3, 2000, smallChunk) || {};
    normalizeTranscript(smallTranscript);

    if (smallTranscript.words.length === 0 && smallTranscript.segments.length > 0) {
      console.warn(`⚠️ Missing words[] in auto-split chunk — retrying with strict settings`);
      const retrySmall = await retryAsync(() => callWhisper(apiKey, smallChunk, true), 2, 2000, smallChunk) || {};
      normalizeTranscript(retrySmall);
      if (retrySmall.words.length > 0) {
        console.log(`✅ Recovered words[] in auto-split chunk`);
        smallTranscript = retrySmall;
      }
    }

    if (smallTranscript.words.length === 0) {
      console.error(`❌ No words[] found for auto-split chunk after retries`);
      continue;
    }

    // Merge into main transcript
    if (smallTranscript.text) {
      mergedTranscript.text += (mergedTranscript.text ? " " : "") + smallTranscript.text;
    }
    mergedTranscript.words.push(
      ...smallTranscript.words.map(w => ({
        ...w,
        start: parseFloat((w.start + offset).toFixed(2)),
        end: parseFloat((w.end + offset).toFixed(2))
      }))
    );
    mergedTranscript.segments.push(
      ...smallTranscript.segments.map(s => ({
        ...s,
        start: parseFloat((s.start + offset).toFixed(2)),
        end: parseFloat((s.end + offset).toFixed(2))
      }))
    );
    offset += getAudioDuration(smallChunk);
  }
  continue; // skip rest of the normal chunk logic
}

let chunkTranscript = result || {};

      // 🔄 Normalize AWS-style → OpenAI-style
      normalizeTranscript(chunkTranscript);

      // 🔄 Retry if still no words[] but segments exist
      if (chunkTranscript.words.length === 0 && chunkTranscript.segments.length > 0) {
        console.warn(`⚠️ Missing words[] for ${path.basename(chunkPath)} — retrying with strict settings`);
        const retryTranscript = await retryAsync(() => callWhisper(apiKey, chunkPath, true), 2, 2000) || {};
        normalizeTranscript(retryTranscript);
        if (retryTranscript.words.length > 0) {
          console.log(`✅ Successfully recovered words[] for ${path.basename(chunkPath)}`);
          chunkTranscript = retryTranscript;
        }
      }

      // 🛑 Fail-fast if still missing words[]
      if (chunkTranscript.words.length === 0) {
        console.error(`❌ No words[] found for chunk ${path.basename(chunkPath)} after retries`);
        console.error("📄 Raw Whisper JSON dump (truncated):\n", JSON.stringify(chunkTranscript).slice(0, 5000));
        throw new Error(`❌ Missing word-level data for chunk ${path.basename(chunkPath)}`);
      }

      // Merge text
      if (chunkTranscript.text) {
        mergedTranscript.text += (mergedTranscript.text ? " " : "") + chunkTranscript.text;
      }

      // Merge words with timestamp offset
      mergedTranscript.words.push(
        ...chunkTranscript.words.map(w => ({
          ...w,
          start: parseFloat((w.start + offset).toFixed(2)),
          end: parseFloat((w.end + offset).toFixed(2))
        }))
      );

      // Merge segments with timestamp offset
      mergedTranscript.segments.push(
        ...chunkTranscript.segments.map(s => ({
          ...s,
          start: parseFloat((s.start + offset).toFixed(2)),
          end: parseFloat((s.end + offset).toFixed(2))
        }))
      );

      // Increment offset
      const chunkDur = chunkTranscript.words.length
        ? Math.max(...chunkTranscript.words.map(w => w.end))
        : 600;
      offset += chunkDur;
    }

    // 💾 Save transcript
const outputKey = `transcripts/${baseName}.json`;
if (process.env.LOCAL_MODE === "true") {
  console.log(`🧪 [Local Mode] Saving transcript locally as ${outputKey}`);
  const { writeFileSync, mkdirSync } = require("fs");
  const { resolve, dirname } = require("path");

  const localPath = resolve(__dirname, "..", "test-assets", outputKey);
  mkdirSync(dirname(localPath), { recursive: true });
  writeFileSync(localPath, JSON.stringify(mergedTranscript, null, 2));
} else {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: outputKey,
    Body: JSON.stringify(mergedTranscript, null, 2),
    ContentType: "application/json"
  }));
}
console.log(`✅ Whisper transcript saved to: ${outputKey}`);


    // 🧹 Cleanup
    [tempPath, ...chunkPaths].forEach(p => existsSync(p) && unlinkSync(p));

  } catch (err) {
    console.error("🔥 TranscribeWithWhisper failed:", err);
    throw err;
  }
};

// --- Helpers ---

function normalizeTranscript(t) {
  if (!t.words) t.words = [];
  if (!t.segments) t.segments = [];

  // AWS Transcribe-style → words[]
  if (t.results?.items?.length) {
    t.words = t.results.items
      .filter(i => i.start_time && i.end_time && i.type === "pronunciation")
      .map(i => ({
        start: parseFloat(i.start_time),
        end: parseFloat(i.end_time),
        word: i.alternatives?.[0]?.content || ""
      }));
  }

  // AWS Transcribe-style → segments[]
  if (t.results?.audio_segments?.length) {
    t.segments = t.results.audio_segments.map(seg => {
      const segWords = (seg.items || [])
        .map(idx => t.results.items[idx])
        .filter(i => i?.start_time && i?.end_time)
        .map(i => ({
          start: parseFloat(i.start_time),
          end: parseFloat(i.end_time),
          word: i.alternatives?.[0]?.content || ""
        }));
      return {
        start: segWords.length ? segWords[0].start : 0,
        end: segWords.length ? segWords[segWords.length - 1].end : 0,
        words: segWords
      };
    });
  }

  // Recover from OpenAI verbose_json segments[].words
  if (t.words.length === 0 && Array.isArray(t.segments)) {
    const recovered = t.segments.flatMap(s => s.words || []);
    if (recovered.length) {
      console.warn(`⚠️ Recovered ${recovered.length} words from segments[].words`);
      t.words = recovered;
    }
  }
}

async function streamS3ToFile(bucket, key, filePath) {
  if (process.env.LOCAL_MODE === "true") {
    console.log("🧪 [Local Mode] Reading MP3 from local disk:", key);
    const { copyFileSync } = require("fs");
    const { resolve } = require("path");

    // Read from shared test-assets folder with same S3 subfolder structure
    const localPath = resolve(__dirname, "..", "test-assets", key);
    copyFileSync(localPath, filePath);
    return;
  }

  const { Body } = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return new Promise((resolve, reject) => {
    const fileStream = createWriteStream(filePath);
    Body.pipe(fileStream).on("error", reject).on("close", resolve);
  });
}

function splitAudio(inputPath, chunkDurationSec) {
  const outputTemplate = join(tmpdir(), `chunk-%03d.mp3`);
  // Re-encode with libmp3lame, normalize, and pad last chunk with silence
  execSync(
    `ffmpeg -i "${inputPath}" -af "apad=pad_dur=5,aresample=async=1:min_hard_comp=0.100:first_pts=0" \
     -f segment -segment_time ${chunkDurationSec} -c:a libmp3lame -b:a 128k "${outputTemplate}" -y`
  );

  return require("fs").readdirSync(tmpdir())
    .filter(f => f.startsWith("chunk-") && f.endsWith(".mp3"))
    .map(f => join(tmpdir(), f))
    .filter(f => {
      try {
        const dur = parseFloat(execSync(
          `ffprobe -v error -show_entries format=duration -of default=nokey=1:noprint_wrappers=1 "${f}"`
        ).toString().trim());
        if (dur < 1) {
          console.warn(`⚠️ Skipping very short chunk (${dur.toFixed(2)}s): ${f}`);
          return false;
        }
        return true;
      } catch {
        console.warn(`⚠️ Could not determine duration for ${f}, keeping by default`);
        return true;
      }
    })
    .sort();
}




async function retryAsync(fn, retries, delay, filePath) {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      console.warn(`⚠️ Attempt ${attempt} failed: ${err.message}`);
      
      // Whisper 500/502/503/504 — retry
      if (isRetryableError(err) && attempt <= retries) {
        const wait = delay * attempt;
        console.log(`⏳ Retrying in ${wait / 1000}s...`);
        await new Promise(res => setTimeout(res, wait));
        continue;
      }

      // If we still fail after last retry AND it's retryable → auto-split the chunk
      if (isRetryableError(err) && attempt > retries && filePath) {
        console.warn(`🔀 Auto-splitting ${filePath} into smaller chunks due to repeated Whisper failure`);
        // Force smaller subchunks for stability — max 300 seconds
const targetDuration = Math.min(300, Math.floor(getAudioDuration(filePath) / 2));
const newChunks = splitAudio(filePath, targetDuration);

        console.log(`   Created ${newChunks.length} smaller chunks from ${path.basename(filePath)}`);
        return { autoSplit: true, chunks: newChunks };
      }

      throw err; // non-retryable or no more retries
    }
  }
}

function isRetryableError(err) {
  // Treat common server-side failures as retryable
  return /500|502|503|504/.test(err.message);
}


function getAudioDuration(filePath) {
  try {
    return parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=nokey=1:noprint_wrappers=1 "${filePath}"`).toString().trim());
  } catch {
    return 0;
  }
}



async function callWhisper(apiKey, filePath, forceWordLevel = false) {
  const boundary = `----WhisperBoundary${Date.now()}`;

  // Start building form head with required Whisper parameters
  let formHead =
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\nword\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\nsegment\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nen\r\n`;

  // Force verbatim transcription parameters
  formHead +=
    `--${boundary}\r\nContent-Disposition: form-data; name="temperature"\r\n\r\n0\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="condition_on_previous_text"\r\n\r\nfalse\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="initial_prompt"\r\n\r\nTranscribe everything exactly as spoken, including hesitations, stutters, repeated words, filler sounds like 'uh', 'um', 'you know', and all pauses.\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="no_speech_threshold"\r\n\r\n0\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="compression_ratio_threshold"\r\n\r\n0\r\n`;

  // If forceWordLevel is true, add stricter decoding params
  if (forceWordLevel) {
    formHead +=
      `--${boundary}\r\nContent-Disposition: form-data; name="beam_size"\r\n\r\n5\r\n`;
  }

  // Attach the file
  formHead +=
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${path.basename(filePath)}"\r\nContent-Type: audio/mpeg\r\n\r\n`;

  const formTail = `\r\n--${boundary}--\r\n`;
  const stats = statSync(filePath);
  const totalLength = Buffer.byteLength(formHead) + stats.size + Buffer.byteLength(formTail);

  console.log(`📤 Sending chunk: ${filePath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.openai.com",
      path: "/v1/audio/transcriptions",
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": totalLength
      }
    }, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        console.log(`📥 Whisper API responded with HTTP ${res.statusCode}`);
        if (res.statusCode >= 500) return reject(new Error(`${res.statusCode} Whisper server error`));
        try {
          resolve(JSON.parse(data));
        } catch {
          console.error("❌ Failed to parse Whisper response. Raw output:\n", data);
          reject(new Error("Failed to parse Whisper response"));
        }
      });
    });

    req.on("error", reject);
    req.write(formHead);
    createReadStream(filePath).on("end", () => req.end(formTail)).pipe(req, { end: false });
  });
}
