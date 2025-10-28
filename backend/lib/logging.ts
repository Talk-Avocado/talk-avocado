// backend/lib/logging.ts
import { Logger } from "@aws-lambda-powertools/logger";

/**
 * Thin wrapper around Powertools Logger providing context fields
 * This replaces the stub implementation from WP00-01
 */
class LoggingWrapper {
  private logger: any;

  constructor(
    serviceName: string,
    persistentAttributes: Record<string, any> = {}
  ) {
    this.logger = new Logger({
      serviceName:
        process.env.POWERTOOLS_SERVICE_NAME || "TalkAvocado/MediaProcessing",
      logLevel: (process.env.LOG_LEVEL || "INFO") as any,
      persistentLogAttributes: persistentAttributes,
    });
  }

  /**
   * Log info message with optional additional attributes
   */
  info(message: string, attributes?: Record<string, any>) {
    this.logger.info(message, attributes);
  }

  /**
   * Log error message with optional additional attributes
   */
  error(message: string, attributes?: Record<string, any>) {
    this.logger.error(message, attributes);
  }

  /**
   * Log warning message with optional additional attributes
   */
  warn(message: string, attributes?: Record<string, any>) {
    this.logger.warn(message, attributes);
  }

  /**
   * Log debug message with optional additional attributes
   */
  debug(message: string, attributes?: Record<string, any>) {
    this.logger.debug(message, attributes);
  }

  /**
   * Add persistent attributes to all subsequent log messages
   */
  addPersistentAttributes(attributes: Record<string, any>) {
    this.logger.addPersistentLogAttributes(attributes);
  }

  /**
   * Remove persistent attributes
   */
  removePersistentAttributes(keys: string[]) {
    this.logger.removePersistentLogAttributes(keys);
  }
}

export { LoggingWrapper };
