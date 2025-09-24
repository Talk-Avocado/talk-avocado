const { handler } = require("./index");

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
    console.log("✅ Local run complete");
  } catch (err) {
    console.error("🔥 Error during local run:", err);
  }
})();
