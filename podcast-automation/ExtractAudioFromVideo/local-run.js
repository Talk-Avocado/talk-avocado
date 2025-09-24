const { handler } = require("./index");
const fs = require("fs");
const path = require("path");

(async () => {
  // Path to local raw folder
  const rawDir = path.resolve(__dirname, "..", "test-assets", "raw");

  // Get list of files in raw/ sorted by modification time (newest first)
  const newestFile = fs
    .readdirSync(rawDir)
    .map(file => ({
      name: file,
      time: fs.statSync(path.join(rawDir, file)).mtime.getTime()
    }))
    .sort((a, b) => b.time - a.time)[0]?.name;

  if (!newestFile) {
    console.error("❌ No files found in test-assets/raw/");
    process.exit(1);
  }

  console.log(`🧪 Using newest raw file: ${newestFile}`);

  const event = {
    Records: [
      {
        s3: {
          bucket: { name: "local-bucket" },
          object: { key: `raw/${newestFile}` }
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
