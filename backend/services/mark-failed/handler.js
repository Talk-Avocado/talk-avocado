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
 * Mark job as failed - updates both DynamoDB and manifest
 * This is called when any step in the pipeline fails
 */
exports.handler = async (event) => {
  const logger = new LoggingWrapper('mark-failed');
  const correlationId = event.correlationId || 'unknown';
  
  logger.addPersistentAttributes({
    correlationId,
    operation: 'mark-failed'
  });

  try {
    const { tenantId, jobId, error } = event;
    
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
    
    // Update manifest status to failed
    manifest.status = 'failed';
    manifest.updatedAt = now;
    
    // Add error information to logs
    if (!manifest.logs) {
      manifest.logs = [];
    }
    
    manifest.logs.push({
      type: 'error',
      createdAt: now,
      message: error ? JSON.stringify(error) : 'Pipeline failed'
    });
    
    // Add failure metadata
    if (!manifest.metadata) {
      manifest.metadata = {};
    }
    manifest.metadata.failedAt = now;
    manifest.metadata.failureReason = error ? error.message || JSON.stringify(error) : 'Unknown error';
    
    // Save updated manifest
    saveManifest(env, tenantId, jobId, manifest);
    
    logger.error('Manifest updated to failed status', { 
      status: 'failed',
      updatedAt: now,
      error: error ? error.message : 'Unknown error'
    });

    // Update DynamoDB record
    const dbItem = await dynamoDB.getJobByJobId(tenantId, jobId);
    if (dbItem) {
      await dynamoDB.updateItem(tenantId, dbItem.jobSort, {
        status: 'failed',
        updatedAt: now
      });
      
      logger.info('DynamoDB record updated to failed status');
    }

    // Return success response for Step Functions
    return {
      statusCode: 200,
      body: {
        tenantId,
        jobId,
        status: 'failed',
        updatedAt: now,
        correlationId,
        error: error ? error.message : 'Unknown error'
      }
    };

  } catch (handlerError) {
    logger.error('Failed to mark job as failed', { 
      error: handlerError.message,
      stack: handlerError.stack,
      originalError: error
    });
    
    // Return error response for Step Functions
    throw new Error(`Mark failed handler failed: ${handlerError.message}`);
  }
};
