import fs from "node:fs";
import path from "node:path";
import type { Env } from "./types.js";

const ENABLE_LEGACY_MIRROR =
  String(process.env.ENABLE_LEGACY_MIRROR || "false") === "true";

export function storageRoot() {
  // Read dynamically to allow tests to change env between runs
  const root = process.env.MEDIA_STORAGE_PATH || "./storage";

  // If MEDIA_STORAGE_PATH is set, use it directly (should already be absolute from script)
  // Otherwise, resolve relative to project root, not current working directory
  let resolved: string;
  if (process.env.MEDIA_STORAGE_PATH) {
    // Already set by start script - use as-is (should be absolute)
    resolved = path.resolve(root);
  } else {
    // Fallback: try to resolve relative to project root
    // Look for package.json to find project root
    let projectRoot = process.cwd();
    let searchPath = projectRoot;
    while (searchPath !== path.dirname(searchPath)) {
      if (fs.existsSync(path.join(searchPath, "package.json"))) {
        projectRoot = searchPath;
        break;
      }
      searchPath = path.dirname(searchPath);
    }
    resolved = path.resolve(projectRoot, "storage");

    // On Windows, log a warning if we're using fallback
    if (process.platform === "win32") {
      console.warn(
        "[storage] Warning: MEDIA_STORAGE_PATH not set, using fallback:",
        resolved,
        "\n         Current working directory:",
        process.cwd(),
        "\n         Project root detected:",
        projectRoot,
        "\n         This may cause path resolution issues. Set MEDIA_STORAGE_PATH environment variable."
      );
    }
  }

  return resolved;
}

export function key(...parts: string[]) {
  return parts.join("/").replace(/\\/g, "/");
}

export function keyFor(
  env: string,
  tenantId: string,
  jobId: string,
  ...rest: string[]
) {
  return key(env, tenantId, jobId, ...rest);
}

export function pathFor(k: string) {
  return path.join(storageRoot(), k);
}

export function ensureDirForFile(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function writeFileAtKey(k: string, data: Buffer | string) {
  const p = pathFor(k);
  ensureDirForFile(p);
  fs.writeFileSync(p, data);
  return p;
}

export function readFileAtKey(k: string) {
  return fs.readFileSync(pathFor(k));
}

export function currentEnv(): Env {
  // Allow "test" for unit tests in addition to normal envs
  const e = String(process.env.TALKAVOCADO_ENV || "dev");
  return e === "dev" || e === "stage" || e === "prod" || e === "test"
    ? (e as Env)
    : "dev";
}

export function maybeMirrorLegacy(
  env: string,
  tenantId: string,
  jobId: string,
  logical: string,
  data: Buffer | string
) {
  if (!ENABLE_LEGACY_MIRROR) return;
  if (logical.endsWith("/audio/" + jobId + ".mp3")) {
    const legacy = key(env, tenantId, jobId, "mp3", jobId + ".mp3");
    writeFileAtKey(legacy, data);
  }
}
