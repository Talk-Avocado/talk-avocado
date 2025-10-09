import fs from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Manifest } from './types.js';
import { keyFor, pathFor, ensureDirForFile } from './storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try multiple possible paths for the schema
const possiblePaths = [
  path.resolve(process.cwd(), 'docs/schemas/manifest.schema.json'),
  path.resolve(process.cwd(), '../docs/schemas/manifest.schema.json'),
  path.resolve(__dirname, '../../docs/schemas/manifest.schema.json')
];

let schemaPath = '';
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    schemaPath = p;
    break;
  }
}

if (!schemaPath) {
  throw new Error(`Manifest schema not found. Tried: ${possiblePaths.join(', ')}`);
}
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile<Manifest>(schema);

export function manifestKey(env: string, tenantId: string, jobId: string) {
  return keyFor(env, tenantId, jobId, 'manifest.json');
}

export function loadManifest(env: string, tenantId: string, jobId: string): Manifest {
  const p = pathFor(manifestKey(env, tenantId, jobId));
  const obj = JSON.parse(fs.readFileSync(p, 'utf-8'));
  if (!validate(obj)) {
    const msg = ajv.errorsText(validate.errors || []);
    throw new Error('Invalid manifest: ' + msg);
  }
  return obj;
}

export function saveManifest(env: string, tenantId: string, jobId: string, m: Manifest) {
  const valid = validate(m);
  if (!valid) {
    const msg = ajv.errorsText(validate.errors || []);
    throw new Error('Invalid manifest: ' + msg);
  }
  const p = pathFor(manifestKey(env, tenantId, jobId));
  ensureDirForFile(p);
  fs.writeFileSync(p, JSON.stringify(m, null, 2));
  return p;
}
