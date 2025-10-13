// backend/lib/ffmpeg-runtime.ts
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * FFmpeg runtime helper with timing, stderr capture, and X-Ray subsegment
 */
class FFmpegRuntime {
  private logger: any;
  private metrics: any;
  private tracer: any;

  constructor(logger: any, metrics: any, tracer: any) {
    this.logger = logger;
    this.metrics = metrics;
    this.tracer = tracer;
  }

  /**
   * Validate that FFmpeg runtime is available and functional
   */
  async validateRuntime(): Promise<boolean> {
    try {
      this.logger.info('Validating FFmpeg runtime availability');
      
      // Check FFmpeg availability
      const ffmpegVersion = execSync('ffmpeg -version', { 
        encoding: 'utf8', 
        timeout: 10000,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      // Check FFprobe availability
      const ffprobeVersion = execSync('ffprobe -version', { 
        encoding: 'utf8', 
        timeout: 10000,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.logger.info('FFmpeg runtime validation successful', {
        ffmpegAvailable: true,
        ffprobeAvailable: true
      });

      return true;
    } catch (error) {
      this.logger.error('FFmpeg runtime validation failed', { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  /**
   * Execute FFmpeg command with observability
   */
  async executeCommand(command: string, operation: string): Promise<{ stdout: string; stderr: string; duration: number }> {
    const startTime = Date.now();
    let subsegment: any = null;

    try {
      this.logger.info('Executing FFmpeg command', { command, operation });

      // Create X-Ray subsegment if tracing is enabled
      if (this.tracer && process.env.ENABLE_XRAY === 'true') {
        subsegment = this.tracer.getSegment().addNewSubsegment('ffmpeg-execution');
        subsegment.addAnnotation('command', command);
        subsegment.addAnnotation('operation', operation);
      }

      // Execute command with timeout and capture both stdout and stderr
      const result = execSync(command, {
        encoding: 'utf8',
        timeout: this.getTimeoutForOperation(operation),
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
      });

      const duration = Date.now() - startTime;
      const stderr = ''; // execSync doesn't capture stderr separately

      // Record metrics
      this.metrics.recordFFmpegExecution(command, duration, true);
      this.metrics.recordOperation(operation, true, duration);

      this.logger.info('FFmpeg command completed successfully', {
        command,
        operation,
        duration,
        outputSize: result.length
      });

      return { stdout: result, stderr, duration };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Record error metrics
      this.metrics.recordFFmpegExecution(command, duration, false);
      this.metrics.recordOperation(operation, false, duration);

      this.logger.error('FFmpeg command failed', {
        command,
        operation,
        duration,
        error: error instanceof Error ? error.message : String(error),
        stderr: (error as any).stderr || ''
      });

      throw error;
    } finally {
      // Close X-Ray subsegment
      if (subsegment) {
        subsegment.close();
      }
    }
  }

  /**
   * Execute FFmpeg command asynchronously for long-running operations
   */
  async executeCommandAsync(command: string, operation: string): Promise<{ stdout: string; stderr: string; duration: number }> {
    const startTime = Date.now();
    let subsegment: any = null;

    return new Promise((resolve, reject) => {
      try {
        this.logger.info('Executing FFmpeg command asynchronously', { command, operation });

        // Create X-Ray subsegment if tracing is enabled
        if (this.tracer && process.env.ENABLE_XRAY === 'true') {
          subsegment = this.tracer.getSegment().addNewSubsegment('ffmpeg-execution-async');
          subsegment.addAnnotation('command', command);
          subsegment.addAnnotation('operation', operation);
        }

        const child = spawn('sh', ['-c', command], {
          stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data: any) => {
          stdout += data.toString();
        });

        child.stderr.on('data', (data: any) => {
          stderr += data.toString();
        });

        child.on('close', (code: any) => {
          const duration = Date.now() - startTime;

          if (code === 0) {
            // Success
            this.metrics.recordFFmpegExecution(command, duration, true);
            this.metrics.recordOperation(operation, true, duration);

            this.logger.info('FFmpeg async command completed successfully', {
              command,
              operation,
              duration,
              outputSize: stdout.length
            });

            resolve({ stdout, stderr, duration });
          } else {
            // Error
            this.metrics.recordFFmpegExecution(command, duration, false);
            this.metrics.recordOperation(operation, false, duration);

            this.logger.error('FFmpeg async command failed', {
              command,
              operation,
              duration,
              exitCode: code,
              stderr
            });

            reject(new Error(`FFmpeg command failed with exit code ${code}: ${stderr}`));
          }

          // Close X-Ray subsegment
          if (subsegment) {
            subsegment.close();
          }
        });

        child.on('error', (error: any) => {
          const duration = Date.now() - startTime;
          
          this.metrics.recordFFmpegExecution(command, duration, false);
          this.metrics.recordOperation(operation, false, duration);

          this.logger.error('FFmpeg async command spawn failed', {
            command,
            operation,
            duration,
            error: error.message
          });

          if (subsegment) {
            subsegment.close();
          }

          reject(error);
        });

        // Set timeout
        const timeout = this.getTimeoutForOperation(operation);
        setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`FFmpeg command timed out after ${timeout}ms`));
        }, timeout);

      } catch (error) {
        const duration = Date.now() - startTime;
        
        this.metrics.recordFFmpegExecution(command, duration, false);
        this.metrics.recordOperation(operation, false, duration);

        this.logger.error('FFmpeg async command setup failed', {
          command,
          operation,
          duration,
          error: error instanceof Error ? error.message : String(error)
        });

        if (subsegment) {
          subsegment.close();
        }

        reject(error);
      }
    });
  }

  /**
   * Get timeout for operation based on type
   */
  private getTimeoutForOperation(operation: string): number {
    const timeouts: Record<string, number> = {
      'AudioExtraction': 8 * 60 * 1000, // 8 minutes
      'VideoRendering': 10 * 60 * 1000, // 10 minutes
      'SmartCutPlanner': 6 * 60 * 1000, // 6 minutes
      'SubtitlesGeneration': 4 * 60 * 1000, // 4 minutes
      'default': 5 * 60 * 1000 // 5 minutes
    };

    return timeouts[operation] || timeouts.default;
  }

  /**
   * Check available disk space in /tmp
   */
  async checkTmpSpace(): Promise<number> {
    try {
      const stats = fs.statSync('/tmp');
      // This is a simplified check - in practice you'd want to use a proper disk space check
      const tmpUsage = 0; // Placeholder - would need proper implementation
      
      this.metrics.recordTmpUsage(tmpUsage);
      return tmpUsage;
    } catch (error) {
      this.logger.warn('Could not check /tmp space', { error: error instanceof Error ? error.message : String(error) });
      return 0;
    }
  }
}

export { FFmpegRuntime };
