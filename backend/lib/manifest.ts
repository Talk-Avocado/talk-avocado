import fs from "node:fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Manifest } from "./types.js";
import { keyFor, pathFor, ensureDirForFile, storageRoot } from "./storage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try multiple possible paths for the schema
const possiblePaths = [
  path.resolve(process.cwd(), "docs/schemas/manifest.schema.json"),
  path.resolve(process.cwd(), "../docs/schemas/manifest.schema.json"),
  path.resolve(__dirname, "../../docs/schemas/manifest.schema.json"),
];

let schemaPath = "";
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    schemaPath = p;
    break;
  }
}

if (!schemaPath) {
  throw new Error(
    `Manifest schema not found. Tried: ${possiblePaths.join(", ")}`
  );
}
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile<Manifest>(schema);

export function manifestKey(env: string, tenantId: string, jobId: string) {
  return keyFor(env, tenantId, jobId, "manifest.json");
}

export function loadManifest(
  env: string,
  tenantId: string,
  jobId: string
): Manifest {
  const p = pathFor(manifestKey(env, tenantId, jobId));

  // Enhanced error handling with detailed path information
  if (!fs.existsSync(p)) {
    const errorMsg =
      `Manifest file not found at: ${p}\n` +
      `Storage root: ${storageRoot()}\n` +
      `Manifest key: ${manifestKey(env, tenantId, jobId)}\n` +
      `MEDIA_STORAGE_PATH: ${process.env.MEDIA_STORAGE_PATH || "(not set)"}\n` +
      `Current working directory: ${process.cwd()}`;
    throw new Error(errorMsg);
  }

  try {
    // Read file and strip BOM if present, normalize line endings
    let content = fs.readFileSync(p, "utf-8");

    // Remove BOM (Byte Order Mark) if present
    if (content.charCodeAt(0) === 0xfeff) {
      content = content.slice(1);
    }

    // Trim whitespace (shouldn't be necessary but helps)
    content = content.trim();

    // Parse JSON
    const obj = JSON.parse(content);

    if (!validate(obj)) {
      const msg = ajv.errorsText(validate.errors || []);
      throw new Error("Invalid manifest: " + msg);
    }
    return obj;
  } catch (error) {
    if (error instanceof Error && error.message.includes("not found")) {
      throw error; // Re-throw our custom error
    }
    // Other errors (JSON parse, validation) - add context
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Enhanced error reporting for JSON parse errors
    if (error instanceof SyntaxError) {
      // Try to read first few bytes to help debug encoding issues
      const rawBytes = fs.readFileSync(p);
      const preview = rawBytes
        .slice(0, 50)
        .toString("utf-8")
        .replace(/\r?\n/g, "\\n");
      throw new Error(
        `Failed to parse JSON from ${p}: ${errorMsg}\nFile preview (first 50 bytes): ${preview}`
      );
    }

    throw new Error(`Failed to load manifest from ${p}: ${errorMsg}`);
  }
}

export function saveManifest(
  env: string,
  tenantId: string,
  jobId: string,
  m: Manifest
) {
  const valid = validate(m);
  if (!valid) {
    const msg = ajv.errorsText(validate.errors || []);
    throw new Error("Invalid manifest: " + msg);
  }
  const p = pathFor(manifestKey(env, tenantId, jobId));
  ensureDirForFile(p);
  fs.writeFileSync(p, JSON.stringify(m, null, 2));
  return p;
}
