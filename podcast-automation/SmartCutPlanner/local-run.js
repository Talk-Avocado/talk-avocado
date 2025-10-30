import { handler } from "./index.js";
import { logger } from "scripts/logger.js";

(async () => {
  // Simulate S3 event for the transcript JSON from TranscribeWithWhisper
  const event = {
    Records: [
      {
        s3: {
          bucket: { name: "local-bucket" },
          object: { key: "transcripts/sample.json" } // Match your actual transcript filename
        }
      }
    ]
  };

  try {
    await handler(event);
    logger.info("✅ Local run complete");
  } catch (err) {
    logger.error("🔥 Error during local run:", err);
  }
})();
