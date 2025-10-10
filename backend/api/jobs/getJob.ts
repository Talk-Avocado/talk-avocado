import { LoggingWrapper } from '../../lib/logging.js';
import { currentEnv } from '../../lib/storage.js';
import { loadManifest } from '../../lib/manifest.js';
import { Manifest } from '../../lib/types.js';

// Mock DynamoDB client for Phase 1 (local mode)
// In production, this would be AWS SDK DynamoDB client
interface DynamoDBItem {
  tenantId: string;
  jobSort: string;
  jobId: string;
  status: string;
  env: string;
  manifestKey: string;
  createdAt: string;
  updatedAt: string;
  correlationId?: string;
}

class MockDynamoDB {
  private items: Map<string, DynamoDBItem> = new Map();

  async getItem(tenantId: string, jobSort: string): Promise<DynamoDBItem | null> {
    const key = `${tenantId}#${jobSort}`;
    return this.items.get(key) || null;
  }

  // Helper method to find job by jobId within a tenant
  async getJobByJobId(tenantId: string, jobId: string): Promise<DynamoDBItem | null> {
    for (const [key, item] of this.items.entries()) {
      if (item.tenantId === tenantId && item.jobId === jobId) {
        return item;
      }
    }
    return null;
  }
}

const dynamoDB = new MockDynamoDB();

interface GetJobResponse {
  jobId: string;
  tenantId: string;
  status: string;
  artifacts: {
    audio?: string;
    transcript?: string;
    plan?: string;
    renders?: string[];
  };
  manifestKey: string;
  updatedAt: string;
}

export async function getJob(event: any): Promise<{ statusCode: number; body: string }> {
  const logger = new LoggingWrapper('getJob');
  const correlationId = event.headers?.['x-correlation-id'] || 'unknown';
  
  logger.addPersistentAttributes({
    correlationId,
    operation: 'getJob'
  });

  try {
    // Extract jobId from path parameters
    const jobId = event.pathParameters?.jobId;
    if (!jobId) {
      logger.error('Missing jobId in path parameters');
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing jobId in path parameters' })
      };
    }

    // Extract tenantId from query parameters
    const tenantId = event.queryStringParameters?.tenantId;
    if (!tenantId) {
      logger.error('Missing tenantId in query parameters');
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing tenantId in query parameters' })
      };
    }

    // Validate tenantId format
    const tenantIdPattern = /^[a-z0-9](?:[a-z0-9-_]{0,62}[a-z0-9])?$/;
    if (!tenantIdPattern.test(tenantId)) {
      logger.error('Invalid tenantId format', { tenantId });
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid tenantId format' })
      };
    }

    logger.addPersistentAttributes({
      tenantId,
      jobId
    });

    // Get job from DynamoDB
    const dbItem = await dynamoDB.getJobByJobId(tenantId, jobId);
    if (!dbItem) {
      logger.warn('Job not found', { tenantId, jobId });
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Job not found' })
      };
    }

    // Load manifest to get artifact pointers
    const env = currentEnv();
    const manifest = loadManifest(env, tenantId, jobId);
    
    logger.info('Manifest loaded successfully', { manifestKey: dbItem.manifestKey });

    // Derive artifact pointers from manifest
    const artifacts: GetJobResponse['artifacts'] = {};
    
    if (manifest.audio?.key) {
      artifacts.audio = manifest.audio.key;
    }
    
    if (manifest.transcript?.jsonKey) {
      artifacts.transcript = manifest.transcript.jsonKey;
    }
    
    if (manifest.plan?.key) {
      artifacts.plan = manifest.plan.key;
    }
    
    if (manifest.renders && manifest.renders.length > 0) {
      artifacts.renders = manifest.renders.map(render => render.key);
    }

    const response: GetJobResponse = {
      jobId: manifest.jobId,
      tenantId: manifest.tenantId,
      status: manifest.status,
      artifacts,
      manifestKey: dbItem.manifestKey,
      updatedAt: manifest.updatedAt
    };

    logger.info('Job retrieved successfully', { 
      jobId, 
      status: manifest.status,
      artifactCount: Object.keys(artifacts).length
    });

    return {
      statusCode: 200,
      body: JSON.stringify(response)
    };

  } catch (error) {
    logger.error('Failed to get job', { error: error instanceof Error ? error.message : String(error) });
    
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

// Lambda handler wrapper
export const handler = getJob;
