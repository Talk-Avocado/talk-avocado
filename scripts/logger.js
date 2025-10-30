// Simple logger for JavaScript files
// Provides consistent logging interface across the codebase

class SimpleLogger {
  constructor(serviceName = "TalkAvocado", context = {}) {
    this.serviceName = serviceName;
    this.context = context;
    this.isDevelopment =
      process.env.NODE_ENV === "development" ||
      process.env.LOCAL_MODE === "true";
  }

  _formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const contextStr =
      Object.keys(this.context).length > 0
        ? ` [${JSON.stringify(this.context)}]`
        : "";
    const dataStr = data ? ` ${JSON.stringify(data)}` : "";
    return `[${timestamp}] [${this.serviceName}] [${level}]${contextStr} ${message}${dataStr}`;
  }

  info(message, data = null) {
    if (this.isDevelopment) {
      console.log(this._formatMessage("INFO", message, data));
    }
  }

  error(message, data = null) {
    console.error(this._formatMessage("ERROR", message, data));
  }

  warn(message, data = null) {
    if (this.isDevelopment) {
      console.warn(this._formatMessage("WARN", message, data));
    }
  }

  debug(message, data = null) {
    if (this.isDevelopment) {
      console.log(this._formatMessage("DEBUG", message, data));
    }
  }

  // For workflow scripts that need user interaction
  user(message) {
    console.log(message);
  }

  // For test files - always show
  test(message, data = null) {
    console.log(`[TEST] ${message}`, data || "");
  }
}

// Create default logger instance
const logger = new SimpleLogger();

export { SimpleLogger, logger };
export default logger;
