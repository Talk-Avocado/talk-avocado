// backend/lib/metrics.ts
import { Metrics } from '@aws-lambda-powertools/metrics';

/**
 * Thin wrapper around Powertools Metrics (EMF) with standard dimensions
 */
class MetricsWrapper {
  private metrics: any;
  private serviceName: string;

  constructor(serviceName: string, defaultDimensions: Record<string, string> = {}) {
    this.serviceName = serviceName;
    this.metrics = new Metrics({
      namespace: process.env.POWERTOOLS_METRICS_NAMESPACE || 'TalkAvocado',
      serviceName,
      defaultDimensions: {
        Service: serviceName,
        Environment: process.env.TALKAVOCADO_ENV || 'dev',
        ...defaultDimensions,
      },
    });
  }

  /**
   * Add a metric with standard dimensions
   */
  addMetric(metricName: string, unit: string, value: number, additionalDimensions?: Record<string, string>) {
    this.metrics.addMetric(metricName, unit, value, additionalDimensions);
  }

  /**
   * Add a count metric (increment by 1)
   */
  addCount(metricName: string, additionalDimensions?: Record<string, string>) {
    this.addMetric(metricName, 'Count', 1, additionalDimensions);
  }

  /**
   * Add a duration metric in milliseconds
   */
  addDuration(metricName: string, durationMs: number, additionalDimensions?: Record<string, string>) {
    this.addMetric(metricName, 'Milliseconds', durationMs, additionalDimensions);
  }

  /**
   * Add a size metric in bytes
   */
  addSize(metricName: string, sizeBytes: number, additionalDimensions?: Record<string, string>) {
    this.addMetric(metricName, 'Bytes', sizeBytes, additionalDimensions);
  }

  /**
   * Publish all stored metrics
   */
  publishStoredMetrics() {
    this.metrics.publishStoredMetrics();
  }

  /**
   * Create a single metric and publish it immediately
   */
  publishMetric(metricName: string, unit: string, value: number, additionalDimensions?: Record<string, string>) {
    this.addMetric(metricName, unit, value, additionalDimensions);
    this.publishStoredMetrics();
  }

  /**
   * Record FFmpeg execution time
   */
  recordFFmpegExecution(command: string, durationMs: number, success: boolean) {
    this.addDuration('FFmpegExecTime', durationMs, {
      Command: command.split(' ')[0], // First part of command (ffmpeg/ffprobe)
      Success: success.toString(),
    });
  }

  /**
   * Record temporary storage usage
   */
  recordTmpUsage(usageBytes: number) {
    this.addSize('TmpSpaceUsed', usageBytes);
  }

  /**
   * Record service operation metrics
   */
  recordOperation(operation: string, success: boolean, durationMs: number) {
    this.addCount(`${operation}${success ? 'Success' : 'Error'}`);
    this.addDuration(`${operation}Duration`, durationMs);
  }
}

export { MetricsWrapper };
