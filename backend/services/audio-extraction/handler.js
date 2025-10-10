// ExtractAudioFromVideo.js — Enhanced with Observability
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const { spawn, execSync } = require("child_process");
const { tmpdir } = require("os");
const { join, basename } = require("path");
const { createWriteStream, readFileSync, unlinkSync, existsSync } = require("fs");

// Import observability wrappers
const { initObservability } = require('../../lib/init-observability');
const { FFmpegRuntime } = require('../../lib/ffmpeg-runtime');

const s3 = new S3Client({ region: process.env.AWS_REGION });
const lambda = new LambdaClient({ region: process.env.AWS_REGION });

exports.handler = async (event, context) => {
  // Initialize observability
  const { logger, metrics, tracer } = initObservability({
    serviceName: 'AudioExtraction',
    correlationId: context?.awsRequestId || 'local-' + Date.now(),
    tenantId: event.tenantId || 'default',
    jobId: event.jobId || 'unknown',
    step: 'audio-extraction',
  });

  const ffmpeg = new FFmpegRuntime(logger, metrics, tracer);

  logger.info('Audio extraction Lambda triggered', { 
    eventType: event.Records ? 'S3Event' : 'DirectInvoke',
    recordCount: event.Records?.length || 0 
  });

  const record = event.Records?.[0];
  if (!record) {
    logger.error('No event record found');
    metrics.addCount('AudioExtractionError', { ErrorType: 'NoRecord' });
    metrics.publishStoredMetrics();
    return { statusCode: 400, body: "No event record" };
  }

  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
  const originalName = basename(key).replace(/^raw\//, "");
  const nameWithoutExt = originalName.replace(/\.[^.]+$/, "");

  const tempInputPath = join(tmpdir(), originalName);
  const normalizedPath = join(tmpdir(), `${nameWithoutExt}.mp4`);
  const tempOutputPath = join(tmpdir(), `${nameWithoutExt}.mp3`);

  logger.info('Starting audio extraction', { 
    bucket, 
    key, 
    originalName, 
    nameWithoutExt 
  });

  try {
    // Validate FFmpeg runtime
    if (!(await ffmpeg.validateRuntime())) {
      throw new Error('FFmpeg runtime validation failed');
    }

    // ⬇️ Stream from S3 → Local disk
    logger.info('Streaming download from S3', { key });
    await streamS3ToFile(bucket, key, tempInputPath);

    // 🔄 Convert to MP4 if needed
    let inputForAudio = tempInputPath;
    if (!key.toLowerCase().endsWith(".mp4")) {
      logger.info('Converting to MP4 format');
      const convertCommand = `ffmpeg -i "${tempInputPath}" -c:v libx264 -crf 23 -preset fast -c:a aac -b:a 128k -y "${normalizedPath}"`;
      await ffmpeg.executeCommand(convertCommand, 'VideoConversion');
      inputForAudio = normalizedPath;
    }

    // 📤 Save final MP4 to S3
    const finalVideoKey = `mp4/${nameWithoutExt}.mp4`;
    await uploadFileToS3(bucket, finalVideoKey, inputForAudio, "video/mp4");
    logger.info('MP4 saved to S3', { key: finalVideoKey });

    // 🎧 Extract MP3 audio
    logger.info('Extracting audio to MP3');
    const audioExtractCommand = `ffmpeg -i "${inputForAudio}" -vn -acodec libmp3lame -b:a 128k "${tempOutputPath}"`;
    await ffmpeg.executeCommand(audioExtractCommand, 'AudioExtraction');

    if (!existsSync(tempOutputPath)) throw new Error(".mp3 not created");

    // 📤 Save MP3 to S3
    const audioKey = `mp3/${nameWithoutExt}.mp3`;
    await uploadFileToS3(bucket, audioKey, tempOutputPath, "audio/mpeg");
    logger.info('MP3 saved to S3', { key: audioKey });

    // 🚀 Trigger StartTranscriptionJob Lambda
    await lambda.send(new InvokeCommand({
      FunctionName: "StartTranscriptionJob",
      InvocationType: "Event",
      Payload: JSON.stringify({
        Records: [{ s3: { bucket: { name: bucket }, object: { key: audioKey } } }]
      })
    }));
    logger.info('StartTranscriptionJob invoked', { audioKey });

    // 🧹 Cleanup
    [tempInputPath, tempOutputPath, normalizedPath].forEach(p => existsSync(p) && unlinkSync(p));

    // Record success metrics
    metrics.addCount('AudioExtractionSuccess');
    metrics.publishStoredMetrics();

    logger.info('Audio extraction completed successfully', { 
      audioKey, 
      finalVideoKey,
      correlationId: context?.awsRequestId 
    });

    return { 
      statusCode: 200, 
      body: `Extracted and uploaded ${audioKey}`,
      correlationId: context?.awsRequestId 
    };
  } catch (error) {
    logger.error('Audio extraction failed', { 
      error: error.message, 
      stack: error.stack,
      bucket,
      key 
    });
    
    metrics.addCount('AudioExtractionError', { ErrorType: error.name || 'Unknown' });
    metrics.publishStoredMetrics();
    
    return { 
      statusCode: 500, 
      body: `Error: ${error.message}`,
      correlationId: context?.awsRequestId 
    };
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
    const localPath = resolve(__dirname, "..", "..", "..", "podcast-automation", "test-assets", key);
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
    const localPath = resolve(__dirname, "..", "..", "..", "podcast-automation", "test-assets", key);
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


