#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ENV = process.env.TALKAVOCADO_ENV || 'dev';
const ROOT = process.env.MEDIA_STORAGE_PATH || './storage';

function p(...parts) { return join(ROOT, ...parts); }
function ensure(file) { mkdirSync(dirname(file), { recursive: true }); }

const tenantId = process.argv[2] || 'demo-tenant';
const jobId = process.argv[3] || '00000000-0000-0000-0000-000000000000';

const manifest = {
  schemaVersion: '1.0.0',
  env: ENV,
  tenantId,
  jobId,
  status: 'pending',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mk = p(ENV, tenantId, jobId, 'manifest.json');
ensure(mk);
writeFileSync(mk, JSON.stringify(manifest, null, 2));
console.log('Wrote manifest:', mk);
