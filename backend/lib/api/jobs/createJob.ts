import { v4 as uuidv4 } from 'uuid';
import { LoggingWrapper } from '../../logging.js';
import { currentEnv, keyFor } from '../../storage.js';
import { saveManifest, manifestKey } from '../../manifest.js';
import { Manifest } from '../../types.js';

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

  async putItem(item: DynamoDBItem): Promise<void> {
    const key = `${item.tenantId}#${item.jobSort}`;
    this.items.set(key, item);
  }

  async getItem(tenantId: string, jobSort: string): Promise<DynamoDBItem | null> {
    const key = `${tenantId}#${jobSort}`;
    return this.items.get(key) || null;
  }
}

const dynamoDB = new MockDynamoDB();

interface CreateJobRequest {
  tenantId: string;
  input?: {
    originalFilename: string;
    bytes: number;
    mimeType: string;
    checksum?: string;
    uploadedAt?: string;
  };
}

interface CreateJobResponse {
  jobId: string;
  status: string;
  env: string;
  tenantId: string;
  manifestKey: string;
}

export async function createJob(event: any): Promise<{ statusCode: number; body: string }> {
  const logger = new LoggingWrapper('createJob');
  const correlationId = event.headers?.['x-correlation-id'] || uuidv4();
  
  logger.addPersistentAttributes({
    correlationId,
    operation: 'createJob'
  });

  try {
    // Parse and validate request body
    const body: CreateJobRequest = JSON.parse(event.body || '{}');
    
    if (!body.tenantId) {
      logger.error('Missing required field: tenantId');
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required field: tenantId' })
      };
    }

    // Validate tenantId format (alphanumeric with -/_ between, 1-64 chars)
    const tenantIdPattern = /^[a-z0-9](?:[a-z0-9-_]{0,62}[a-z0-9])?$/;
    if (!tenantIdPattern.test(body.tenantId)) {
      logger.error('Invalid tenantId format', { tenantId: body.tenantId });
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid tenantId format' })
      };
    }

    const env = currentEnv();
    const jobId = uuidv4();
    const now = new Date().toISOString();
    
    logger.addPersistentAttributes({
      tenantId: body.tenantId,
      jobId,
      env
    });

    // Create initial manifest
    const manifest: Manifest = {
      schemaVersion: '1.0.0',
      env,
      tenantId: body.tenantId,
      jobId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      input: body.input ? {
        sourceKey: keyFor(env, body.tenantId, jobId, 'input', body.input.originalFilename),
        originalFilename: body.input.originalFilename,
        bytes: body.input.bytes,
        mimeType: body.input.mimeType,
        checksum: body.input.checksum,
        uploadedAt: body.input.uploadedAt || now
      } : undefined
    };

    // Save manifest to local storage
    const manifestKeyPath = manifestKey(env, body.tenantId, jobId);
    saveManifest(env, body.tenantId, jobId, manifest);
    
    logger.info('Manifest created and saved', { manifestKey: manifestKeyPath });

    // Create DynamoDB record
    const jobSort = `${now}#${jobId}`;
    const dbItem: DynamoDBItem = {
      tenantId: body.tenantId,
      jobSort,
      jobId,
      status: 'pending',
      env,
      manifestKey: manifestKeyPath,
      createdAt: now,
      updatedAt: now,
      correlationId
    };

    await dynamoDB.putItem(dbItem);
    logger.info('DynamoDB record created', { jobSort });

    // Check if we should start the state machine
    const startOnCreate = process.env.START_ON_CREATE === 'true';
    if (startOnCreate) {
      logger.info('State machine start requested', { startOnCreate });
      // TODO: In production, this would start the actual Step Functions state machine
      // For now, we'll just log that it would be started
    }

    const response: CreateJobResponse = {
      jobId,
      status: 'pending',
      env,
      tenantId: body.tenantId,
      manifestKey: manifestKeyPath
    };

    logger.info('Job created successfully', { jobId, status: 'pending' });

    return {
      statusCode: 201,
      body: JSON.stringify(response)
    };

  } catch (error) {
    logger.error('Failed to create job', { error: error instanceof Error ? error.message : String(error) });
    
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

// Lambda handler wrapper
export const handler = createJob;
