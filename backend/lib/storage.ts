import fs from 'node:fs';
import path from 'node:path';

const ENV = (process.env.TALKAVOCADO_ENV || 'dev') as 'dev' | 'stage' | 'prod';
const MEDIA_STORAGE_PATH = process.env.MEDIA_STORAGE_PATH || './storage';
const ENABLE_LEGACY_MIRROR = String(process.env.ENABLE_LEGACY_MIRROR || 'false') === 'true';

export function storageRoot() {
  return path.resolve(MEDIA_STORAGE_PATH);
}

export function key(...parts: string[]) {
  return parts.join('/').replace(/\\/g, '/');
}

export function keyFor(env: string, tenantId: string, jobId: string, ...rest: string[]) {
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

export function currentEnv() {
  return ENV;
}

export function maybeMirrorLegacy(env: string, tenantId: string, jobId: string, logical: string, data: Buffer | string) {
  if (!ENABLE_LEGACY_MIRROR) return;
  if (logical.endsWith('/audio/' + jobId + '.mp3')) {
    const legacy = key(env, tenantId, jobId, 'mp3', jobId + '.mp3');
    writeFileAtKey(legacy, data);
  }
}
