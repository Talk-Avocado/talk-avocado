/**
 * Retry policy utilities for Lambda functions
 * Implements exponential backoff with jitter for resilient error handling
 */

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterMs: number;
}

export interface RetryableError extends Error {
  isRetryable: boolean;
  retryAfterMs?: number;
}

export class RetryPolicy {
  private config: RetryConfig;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = {
      maxAttempts: config.maxAttempts ?? 3,
      baseDelayMs: config.baseDelayMs ?? 1000,
      maxDelayMs: config.maxDelayMs ?? 30000,
      backoffMultiplier: config.backoffMultiplier ?? 2,
      jitterMs: config.jitterMs ?? 1000,
      ...config,
    };
  }

  /**
   * Execute a function with retry logic
   */
  async execute<T>(fn: () => Promise<T>, context?: string): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          throw error;
        }

        // Don't retry on last attempt
        if (attempt === this.config.maxAttempts) {
          break;
        }

        // Calculate delay with exponential backoff and jitter
        const delay = this.calculateDelay(attempt);

        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.warn(
          `Retry attempt ${attempt}/${this.config.maxAttempts} failed${context ? ` for ${context}` : ""}: ${errorMessage}. Retrying in ${delay}ms`
        );

        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      // Check if error has explicit retryable flag
      if (
        "isRetryable" in error &&
        typeof (error as any).isRetryable === "boolean"
      ) {
        return (error as any).isRetryable;
      }

      // Check for common retryable error patterns
      const retryablePatterns = [
        /timeout/i,
        /network/i,
        /connection/i,
        /throttle/i,
        /rate limit/i,
        /service unavailable/i,
        /internal server error/i,
        /bad gateway/i,
        /gateway timeout/i,
        /temporary/i,
      ];

      return retryablePatterns.some(pattern => pattern.test(error.message));
    }

    return false;
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  private calculateDelay(attempt: number): number {
    const exponentialDelay =
      this.config.baseDelayMs *
      Math.pow(this.config.backoffMultiplier, attempt - 1);
    const cappedDelay = Math.min(exponentialDelay, this.config.maxDelayMs);
    const jitter = Math.random() * this.config.jitterMs;

    return Math.floor(cappedDelay + jitter);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Predefined retry configurations for different service types
 */
export const RetryConfigs = {
  // For audio/video processing - more aggressive retry
  mediaProcessing: {
    maxAttempts: 5,
    baseDelayMs: 2000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
    jitterMs: 2000,
  },

  // For transcription - moderate retry
  transcription: {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitterMs: 1000,
  },

  // For storage operations - quick retry
  storage: {
    maxAttempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 10000,
    backoffMultiplier: 1.5,
    jitterMs: 500,
  },

  // For API calls - standard retry
  api: {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitterMs: 1000,
  },
} as const;

/**
 * Utility function to create retryable errors
 */
export function createRetryableError(
  message: string,
  retryAfterMs?: number
): RetryableError {
  const error = new Error(message) as RetryableError;
  error.isRetryable = true;
  if (retryAfterMs) {
    error.retryAfterMs = retryAfterMs;
  }
  return error;
}

/**
 * Utility function to create non-retryable errors
 */
export function createNonRetryableError(message: string): Error {
  const error = new Error(message);
  (error as any).isRetryable = false;
  return error;
}
