// backend/services/smart-cut-planner/handler-simple.js
// Simplified ES module version for testing without complex dependencies
import { planCuts } from './planner-logic.js';
import fs from 'node:fs';
import path from 'node:path';
import { initObservability } from '../../dist/init-observability.js';

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

// Simple storage functions for testing
function keyFor(env, tenantId, jobId, ...pathParts) {
  return `${env}/${tenantId}/${jobId}/${pathParts.join('/')}`;
}

function pathFor(key) {
  return `storage/${key}`;
}

function writeFileAtKey(key, content) {
  const filePath = pathFor(key);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content);
}

function loadManifest(env, tenantId, jobId) {
  const manifestKey = keyFor(env, tenantId, jobId, 'manifest.json');
  const manifestPath = pathFor(manifestKey);
  if (fs.existsSync(manifestPath)) {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  }
  return {};
}

function saveManifest(env, tenantId, jobId, manifest) {
  const manifestKey = keyFor(env, tenantId, jobId, 'manifest.json');
  writeFileAtKey(manifestKey, JSON.stringify(manifest, null, 2));
}

// Simple schema validation
function validateCutPlan(cutPlanData) {
  if (!cutPlanData.cuts || !Array.isArray(cutPlanData.cuts)) {
    return false;
  }
  
  for (const cut of cutPlanData.cuts) {
    if (!cut.start || !cut.end || !cut.type) {
      return false;
    }
    if (!['keep', 'cut'].includes(cut.type)) {
      return false;
    }
  }
  
  return true;
}

export const handler = async (event, context) => {
  const { env, tenantId, jobId, transcriptKey } = event;
  const correlationId = event.correlationId || context.awsRequestId;
  
  const { logger } = initObservability({
    serviceName: 'SmartCutPlanner',
    correlationId,
    tenantId,
    jobId,
    step: 'smart-cut-planner',
  });

  logger.info(`[SmartCutPlanner] Processing: env=${env}, tenant=${tenantId}, job=${jobId}`);
  logger.info(`[SmartCutPlanner] Transcript key: ${transcriptKey}`);

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

    logger.info(`[SmartCutPlanner] Found ${transcriptData.segments.length} segments`);

    const start = Date.now();
    const cutPlan = planCuts(transcriptData);
    cutPlan.metadata.processingTimeMs = Date.now() - start;

    logger.info(`[SmartCutPlanner] Generated cut plan with ${cutPlan.cuts.length} segments`);

    if (!validateCutPlan(cutPlan)) {
      throw new PlannerError(`Cut plan schema invalid`, ERROR_TYPES.SCHEMA_VALIDATION);
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

    logger.info(`[SmartCutPlanner] Planning completed successfully`);
    logger.info(`[SmartCutPlanner] Plan key: ${planKey}`);
    logger.info(`[SmartCutPlanner] Total cuts: ${cutPlan.cuts?.length || 0}`);

    return { ok: true, planKey, correlationId };
  } catch (err) {
    logger.error(`[SmartCutPlanner] Planning failed:`, err.message);
    logger.error(`[SmartCutPlanner] Error type:`, err.type);
    logger.error(`[SmartCutPlanner] Error details:`, err.details);
    
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
