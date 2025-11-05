// backend/services/smart-cut-planner/handler.js
import { initObservability } from '../../dist/init-observability.js';
import { keyFor, pathFor, writeFileAtKey } from '../../dist/storage.js';
import { loadManifest, saveManifest } from '../../dist/manifest.js';
import { planCuts } from './planner-logic.js';
import fs from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import path from 'node:path';

class PlannerError extends Error {
  constructor(message, type, details = {}) {
    super(message);
    this.name = 'PlannerError';
    this.type = type;
    this.details = details;
  }
}

const ERROR_TYPES = {
  INPUT_NOT_FOUND: 'INPUT_NOT_FOUND',
  TRANSCRIPT_PARSE: 'TRANSCRIPT_PARSE',
  TRANSCRIPT_INVALID: 'TRANSCRIPT_INVALID',
  PLANNING_FAILED: 'PLANNING_FAILED',
  SCHEMA_VALIDATION: 'SCHEMA_VALIDATION',
  MANIFEST_UPDATE: 'MANIFEST_UPDATE',
};

function getCutPlanValidator() {
  const schemaPath = path.resolve('docs/schemas/cut_plan.schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

export const handler = async (event, context) => {
  const { env, tenantId, jobId, transcriptKey } = event;
  const correlationId = event.correlationId || context.awsRequestId;
  const { logger, metrics } = initObservability({
    serviceName: 'SmartCutPlanner',
    correlationId, tenantId, jobId, step: 'smart-cut-planner',
  });

  const validator = getCutPlanValidator();
  const transcriptPath = pathFor(transcriptKey);

  try {
    if (!fs.existsSync(transcriptPath)) {
      throw new PlannerError(`Transcript not found: ${transcriptKey}`, ERROR_TYPES.INPUT_NOT_FOUND, { transcriptKey });
    }
    let transcriptData;
    try {
      transcriptData = JSON.parse(fs.readFileSync(transcriptPath, 'utf-8'));
    } catch (e) {
      throw new PlannerError(`Transcript parse failed: ${e.message}`, ERROR_TYPES.TRANSCRIPT_PARSE);
    }
    if (!Array.isArray(transcriptData.segments) || transcriptData.segments.length === 0) {
      throw new PlannerError(`Transcript invalid: missing segments`, ERROR_TYPES.TRANSCRIPT_INVALID);
    }

    const start = Date.now();
    const cutPlan = planCuts(transcriptData);
    cutPlan.metadata.processingTimeMs = Date.now() - start;

    const valid = validator(cutPlan);
    if (!valid) {
      const msg = (validator.errors || []).map(e => `${e.instancePath} ${e.message}`).join('; ');
      throw new PlannerError(`Cut plan schema invalid: ${msg}`, ERROR_TYPES.SCHEMA_VALIDATION);
    }

    const planKey = keyFor(env, tenantId, jobId, 'plan', 'cut_plan.json');
    writeFileAtKey(planKey, JSON.stringify(cutPlan, null, 2));

    try {
      const manifest = loadManifest(env, tenantId, jobId);
      manifest.plan = {
        ...(manifest.plan || {}),
        key: planKey,
        schemaVersion: cutPlan.schemaVersion,
        algorithm: 'rule-based',
        totalCuts: cutPlan.cuts?.length || 0,
        plannedAt: new Date().toISOString(),
      };
      manifest.updatedAt = new Date().toISOString();
      saveManifest(env, tenantId, jobId, manifest);
    } catch (e) {
      throw new PlannerError(`Manifest update failed: ${e.message}`, ERROR_TYPES.MANIFEST_UPDATE);
    }

    const totalKeeps = cutPlan.cuts?.filter(c => c.type === 'keep').length || 0;
    const totalCuts = cutPlan.cuts?.filter(c => c.type === 'cut').length || 0;

    metrics.addMetric('PlanningSuccess', 'Count', 1);
    metrics.addMetric('TotalSegments', 'Count', transcriptData.segments.length);
    metrics.addMetric('TotalCuts', 'Count', totalCuts);
    metrics.addMetric('TotalKeeps', 'Count', totalKeeps);
    logger.info('Planning completed', { planKey, totalCuts, totalKeeps });

    return { ok: true, planKey, correlationId };
  } catch (err) {
    logger.error('Planning failed', { error: err.message, type: err.type, details: err.details });
    metrics.addMetric('PlanningError', 'Count', 1);
    metrics.addMetric(`PlanningError_${err.type || 'UNKNOWN'}`, 'Count', 1);
    try {
      const manifest = loadManifest(env, tenantId, jobId);
      manifest.status = 'failed';
      manifest.updatedAt = new Date().toISOString();
      manifest.logs = manifest.logs || [];
      manifest.logs.push({ type: 'error', message: `Planner failed: ${err.message}`, createdAt: new Date().toISOString() });
      saveManifest(env, tenantId, jobId, manifest);
    } catch {
      // Ignore errors when trying to log the failure - we're already handling the main error
    }
    throw err;
  }
};