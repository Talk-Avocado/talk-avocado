import { handler } from "./index.js";
import { logger } from "scripts/logger.js";

(async () => {
  // Simulate S3 event for a cut plan file in test-assets/plans/
  const event = {
    Records: [
      {
        s3: {
          bucket: { name: "local-bucket" },
          object: { key: "plans/sample.cutplan.json" } // Match SmartCutPlanner output
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
