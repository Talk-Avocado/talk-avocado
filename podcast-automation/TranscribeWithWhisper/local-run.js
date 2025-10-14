import { handler } from "./index.js";
import { logger } from "scripts/logger.js";

(async () => {
  // Simulate S3 event for test-assets/mp3/sample.mp3
  const event = {
    Records: [
      {
        s3: {
          bucket: { name: "local-bucket" },
          object: { key: "mp3/sample.mp3" } // matches AWS-style folder structure
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
