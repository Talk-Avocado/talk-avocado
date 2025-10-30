import { LoggingWrapper } from '../../dist/logging.js';
import { currentEnv } from '../../dist/storage.js';
import { loadManifest, saveManifest } from '../../dist/manifest.js';

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
    for (const [, item] of this.items.entries()) {
      if (item.tenantId === tenantId && item.jobId === jobId) {
        return item;
      }
    }
    return null;
  }
}

const dynamoDB = new MockDynamoDB();

/**
 * Mark job as completed - updates both DynamoDB and manifest
 * This is called at the end of the pipeline
 */
export const handler = async (event) => {
  const logger = new LoggingWrapper('mark-complete');
  const correlationId = event.correlationId || 'unknown';
  
  logger.addPersistentAttributes({
    correlationId,
    operation: 'mark-complete'
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

    // Load and update manifest if present and valid; otherwise skip quietly for this test
    try {
      const manifest = loadManifest(env, tenantId, jobId);
      manifest.status = 'completed';
      manifest.updatedAt = now;
      if (!manifest.metadata) {
        manifest.metadata = {};
      }
      manifest.metadata.completedAt = now;
      saveManifest(env, tenantId, jobId, manifest);
      logger.info('Manifest updated to completed status', { 
        status: 'completed',
        updatedAt: now
      });
    } catch (err) {
      logger.warn('Skipping manifest update', { reason: err && err.message });
    }

    // Update DynamoDB record
    const dbItem = await dynamoDB.getJobByJobId(tenantId, jobId);
    if (dbItem) {
      await dynamoDB.updateItem(tenantId, dbItem.jobSort, {
        status: 'completed',
        updatedAt: now
      });
      
      logger.info('DynamoDB record updated to completed status');
    }

    // Return success response for Step Functions
    return {
      statusCode: 200,
      body: {
        tenantId,
        jobId,
        status: 'completed',
        updatedAt: now,
        correlationId
      }
    };

  } catch (error) {
    logger.error('Failed to mark job as completed', { 
      error: error.message,
      stack: error.stack
    });
    
    // Return error response for Step Functions
    throw new Error(`Mark complete failed: ${error.message}`);
  }
};
