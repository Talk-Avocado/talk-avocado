// backend/lib/init-observability.ts
const { Logger } = require('@aws-lambda-powertools/logger');
const { Metrics } = require('@aws-lambda-powertools/metrics');
const { Tracer } = require('@aws-lambda-powertools/tracer');

/**
 * Initialize observability stack for a Lambda handler
 * @param {Object} options - Configuration options
 * @param {string} options.serviceName - Service name (e.g., 'AudioExtraction')
 * @param {string} options.correlationId - Correlation ID from context
 * @param {string} options.tenantId - Tenant identifier
 * @param {string} options.jobId - Job identifier
 * @param {string} options.step - Current processing step
 * @returns {Object} { logger, metrics, tracer }
 */
function initObservability({
  serviceName,
  correlationId,
  tenantId,
  jobId,
  step,
}: {
  serviceName: string;
  correlationId: string;
  tenantId: string;
  jobId: string;
  step: string;
}) {
  const logger = new Logger({
    serviceName: process.env.POWERTOOLS_SERVICE_NAME || 'TalkAvocado/MediaProcessing',
    logLevel: process.env.LOG_LEVEL || 'INFO',
    persistentLogAttributes: {
      correlationId,
      tenantId,
      jobId,
      step,
    },
  });

  const metrics = new Metrics({
    namespace: process.env.POWERTOOLS_METRICS_NAMESPACE || 'TalkAvocado',
    serviceName,
    defaultDimensions: {
      Service: serviceName,
      Environment: process.env.TALKAVOCADO_ENV || 'dev',
      TenantId: tenantId || 'unknown',
    },
  });

  const tracer = new Tracer({
    serviceName,
    enabled: process.env.ENABLE_XRAY === 'true',
  });

  return { logger, metrics, tracer };
}

export { initObservability };
