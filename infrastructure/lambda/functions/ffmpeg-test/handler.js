import { execSync } from "child_process";
import fs from "fs";
import { logger } from "scripts/logger.js";
// path import removed as it's not used

/**
 * FFmpeg Runtime Validation Function
 *
 * This function validates that FFmpeg and FFprobe are available in the Lambda runtime
 * and can perform basic operations. It's used for runtime validation and regression testing.
 */
exports.handler = async (event, context) => {
  const startTime = Date.now();
  const results = {
    ffmpegAvailable: false,
    ffprobeAvailable: false,
    requiredCodecs: ["libx264", "libmp3lame", "libopus"],
    codecsPresent: [],
    validationPassed: false,
    executionTime: 0,
    errors: [],
  };

  try {
    logger.info("Starting FFmpeg runtime validation...");

    // Test FFmpeg availability and version
    try {
      execSync("ffmpeg -version", { encoding: "utf8", timeout: 10000 });
      results.ffmpegAvailable = true;
      logger.info("FFmpeg version check passed");

      // Check for required codecs in build configuration
      const buildConf = execSync("ffmpeg -buildconf", {
        encoding: "utf8",
        timeout: 10000,
      });
      results.requiredCodecs.forEach(codec => {
        if (buildConf.includes(codec)) {
          results.codecsPresent.push(codec);
        }
      });

      logger.info(`Available codecs: ${results.codecsPresent.join(", ")}`);
    } catch (error) {
      results.errors.push(`FFmpeg availability check failed: ${error.message}`);
      logger.error("FFmpeg not available:", error.message);
    }

    // Test FFprobe availability
    try {
      execSync("ffprobe -version", { encoding: "utf8", timeout: 10000 });
      results.ffprobeAvailable = true;
      logger.info("FFprobe version check passed");
    } catch (error) {
      results.errors.push(
        `FFprobe availability check failed: ${error.message}`
      );
      logger.error("FFprobe not available:", error.message);
    }

    // Test basic FFprobe JSON output (if we have a test file)
    if (results.ffprobeAvailable && event.testFile) {
      try {
        const probeOutput = execSync(
          `ffprobe -v quiet -print_format json -show_format -show_streams "${event.testFile}"`,
          { encoding: "utf8", timeout: 15000 }
        );
        const probeData = JSON.parse(probeOutput);

        // Validate expected structure
        if (probeData.format && probeData.streams) {
          logger.info("FFprobe JSON structure validation passed");
          results.probeValidation = true;
        } else {
          results.errors.push("FFprobe JSON structure validation failed");
        }
      } catch (error) {
        results.errors.push(`FFprobe JSON test failed: ${error.message}`);
        logger.error("FFprobe JSON test failed:", error.message);
      }
    }

    // Test basic audio extraction (if we have test files)
    if (results.ffmpegAvailable && event.inputFile && event.outputFile) {
      try {
        const extractCommand = `ffmpeg -i "${event.inputFile}" -vn -acodec libmp3lame -t 5 "${event.outputFile}"`;
        execSync(extractCommand, { encoding: "utf8", timeout: 30000 });

        // Verify output file was created
        if (fs.existsSync(event.outputFile)) {
          logger.info("Basic audio extraction test passed");
          results.audioExtractionTest = true;

          // Clean up test output
          fs.unlinkSync(event.outputFile);
        } else {
          results.errors.push(
            "Audio extraction test failed - output file not created"
          );
        }
      } catch (error) {
        results.errors.push(`Audio extraction test failed: ${error.message}`);
        logger.error("Audio extraction test failed:", error.message);
      }
    }

    // Determine overall validation result
    results.validationPassed =
      results.ffmpegAvailable &&
      results.ffprobeAvailable &&
      results.codecsPresent.length >= 2 && // At least 2 of 3 required codecs
      results.errors.length === 0;

    results.executionTime = Date.now() - startTime;

    logger.info("FFmpeg runtime validation completed", {
      validationPassed: results.validationPassed,
      executionTime: results.executionTime,
      errors: results.errors.length,
    });

    return {
      statusCode: results.validationPassed ? 200 : 500,
      body: JSON.stringify({
        ...results,
        timestamp: new Date().toISOString(),
        correlationId: context.awsRequestId,
      }),
    };
  } catch (error) {
    results.executionTime = Date.now() - startTime;
    results.errors.push(`Unexpected error: ${error.message}`);

    logger.error("FFmpeg validation failed with unexpected error:", error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        ...results,
        validationPassed: false,
        timestamp: new Date().toISOString(),
        correlationId: context.awsRequestId,
      }),
    };
  }
};
