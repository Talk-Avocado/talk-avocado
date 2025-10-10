const { LoggingWrapper } = require('../../lib/logging.js');
const { currentEnv } = require('../../lib/storage.js');
const { loadManifest, saveManifest } = require('../../lib/manifest.js');

// Mock DynamoDB client for Phase 1 (local mode)
class MockDynamoDB {
  constructor() {
    this.items = new Map();
  }

  async updateItem(tenantId, jobSort, updates) {
    const key = `${tenantId}#${jobSort}`;
    const existing = this.items.get(key) || {};
    const updated = { ...existing, ...updates };
    this.items.set(key, updated);
    return updated;
  }

  async getJobByJobId(tenantId, jobId) {
    for (const [key, item] of this.items.entries()) {
      if (item.tenantId === tenantId && item.jobId === jobId) {
        return item;
      }
    }
    return null;
  }
}

const dynamoDB = new MockDynamoDB();

/**
 * Mark job as processing - updates both DynamoDB and manifest
 * This is called at the start of the pipeline
 */
exports.handler = async (event) => {
  const logger = new LoggingWrapper('mark-processing');
  const correlationId = event.correlationId || 'unknown';
  
  logger.addPersistentAttributes({
    correlationId,
    operation: 'mark-processing'
  });

  try {
    const { tenantId, jobId } = event;
    
    if (!tenantId || !jobId) {
      throw new Error('Missing required fields: tenantId, jobId');
    }

    logger.addPersistentAttributes({
      tenantId,
      jobId
    });

    const env = currentEnv();
    const now = new Date().toISOString();

    // Load current manifest
    const manifest = loadManifest(env, tenantId, jobId);
    
    // Update manifest status to processing
    manifest.status = 'processing';
    manifest.updatedAt = now;
    
    // Save updated manifest
    saveManifest(env, tenantId, jobId, manifest);
    
    logger.info('Manifest updated to processing status', { 
      status: 'processing',
      updatedAt: now
    });

    // Update DynamoDB record
    const dbItem = await dynamoDB.getJobByJobId(tenantId, jobId);
    if (dbItem) {
      await dynamoDB.updateItem(tenantId, dbItem.jobSort, {
        status: 'processing',
        updatedAt: now
      });
      
      logger.info('DynamoDB record updated to processing status');
    }

    // Return success response for Step Functions
    return {
      statusCode: 200,
      body: {
        tenantId,
        jobId,
        status: 'processing',
        updatedAt: now,
        correlationId
      }
    };

  } catch (error) {
    logger.error('Failed to mark job as processing', { 
      error: error.message,
      stack: error.stack
    });
    
    // Return error response for Step Functions
    throw new Error(`Mark processing failed: ${error.message}`);
  }
};
