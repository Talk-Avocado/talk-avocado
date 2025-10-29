# Lambda Monitoring Operational Runbook

## Overview
This runbook provides operational guidance for monitoring and maintaining the TalkAvocado Lambda functions deployed as part of MFU-WP00-03.

## Lambda Functions Deployed

### Services
- **audio-extraction**: Extracts audio from video files using FFmpeg
- **transcription**: Transcribes audio using Whisper AI model
- **smart-cut-planner**: Analyzes content and creates cut plans
- **video-render-engine**: Renders final video with cuts and transitions
- **ffmpeg-test**: Validates FFmpeg runtime functionality

### Configuration
- **Memory**: 1769MB (audio-extraction, smart-cut-planner, ffmpeg-test), 3008MB (transcription), 5120MB (video-render-engine)
- **Timeout**: 300s (audio-extraction, smart-cut-planner), 600s (transcription), 900s (video-render-engine), 60s (ffmpeg-test)
- **Ephemeral Storage**: 2-8GB depending on service
- **Runtime**: Container image with FFmpeg/ffprobe

## Monitoring Dashboard

### CloudWatch Dashboard: `TalkAvocado-MediaProcessing`
Access via AWS Console → CloudWatch → Dashboards → TalkAvocado-MediaProcessing

#### Key Metrics
1. **Invocations**: Total function invocations per service
2. **Errors**: Error count and error rate per service
3. **Duration**: P95, P99, and average execution time
4. **Throttles**: Function throttling events
5. **FFmpegExecTime**: Custom metric for FFmpeg execution time
6. **TmpSpaceUsed**: Custom metric for ephemeral storage usage

## Alarms and Alerting

### Critical Alarms
1. **Error Rate Alarm**
   - **Name**: `TalkAvocado-{service}-ErrorRate`
   - **Threshold**: > 5% error rate over 5 minutes
   - **Action**: Immediate investigation required

2. **Duration Alarm**
   - **Name**: `TalkAvocado-{service}-Duration`
   - **Threshold**: > 90% of configured timeout
   - **Action**: Performance optimization needed

3. **DLQ Alarm**
   - **Name**: `TalkAvocado-{service}-DLQ`
   - **Threshold**: > 0 messages
   - **Action**: Failed message investigation required

### Alarm Response Procedures

#### Error Rate > 5%
1. **Immediate Actions**:
   - Check CloudWatch Logs for error patterns
   - Review recent deployments or configuration changes
   - Check downstream service health (S3, DynamoDB)

2. **Investigation Steps**:
   - Analyze error logs for common patterns
   - Check function memory and timeout utilization
   - Verify input data format and size

3. **Resolution**:
   - Fix code issues if identified
   - Adjust memory/timeout if needed
   - Implement additional error handling

#### Duration > 90% of Timeout
1. **Immediate Actions**:
   - Check function memory utilization
   - Review input data size and complexity
   - Check for resource contention

2. **Investigation Steps**:
   - Analyze X-Ray traces for bottlenecks
   - Review FFmpeg command optimization
   - Check ephemeral storage usage

3. **Resolution**:
   - Optimize FFmpeg commands
   - Increase memory allocation if needed
   - Implement input validation and size limits

#### DLQ Messages Present
1. **Immediate Actions**:
   - Check DLQ message content and error details
   - Identify the root cause of failures
   - Review retry policy effectiveness

2. **Investigation Steps**:
   - Analyze failed message payloads
   - Check error classification accuracy
   - Review retry configuration

3. **Resolution**:
   - Fix underlying issues
   - Adjust retry policies if needed
   - Reprocess messages if appropriate

## Performance Monitoring

### Key Performance Indicators (KPIs)
1. **Cold Start Duration**: < 10 seconds for all services
2. **Warm Execution Time**: < 50% of timeout for normal operations
3. **Memory Utilization**: < 80% of allocated memory
4. **Error Rate**: < 1% under normal operations
5. **DLQ Count**: 0 under normal operations

### Performance Optimization
1. **Memory Tuning**:
   - Use `infrastructure/lambda/power-tuning.js` for optimization
   - Test different memory configurations
   - Monitor cost vs performance trade-offs

2. **Init Duration Optimization**:
   - Use `infrastructure/lambda/init-duration-test.js` for measurement
   - Consider provisioned concurrency for critical functions
   - Optimize container image size

3. **FFmpeg Optimization**:
   - Monitor FFmpeg execution time
   - Optimize command parameters
   - Consider different codec options

## Troubleshooting Guide

### Common Issues

#### Function Timeout
- **Symptoms**: Duration alarm triggered, function times out
- **Causes**: Large input files, inefficient FFmpeg commands, insufficient memory
- **Solutions**: Increase timeout, optimize FFmpeg commands, increase memory

#### Memory Issues
- **Symptoms**: Out of memory errors, high memory utilization
- **Causes**: Large input files, memory leaks, insufficient allocation
- **Solutions**: Increase memory allocation, optimize code, add input validation

#### FFmpeg Errors
- **Symptoms**: FFmpeg execution failures, codec errors
- **Causes**: Unsupported formats, missing codecs, invalid parameters
- **Solutions**: Update FFmpeg version, add format validation, fix command parameters

#### DLQ Messages
- **Symptoms**: Messages in Dead Letter Queue
- **Causes**: Permanent failures, retry exhaustion, invalid input
- **Solutions**: Fix underlying issues, adjust retry policies, validate input

### Debugging Steps
1. **Check CloudWatch Logs**:
   - Look for error patterns and stack traces
   - Check correlation IDs for request tracing
   - Review structured log fields

2. **Analyze X-Ray Traces**:
   - Identify performance bottlenecks
   - Check subsegment timing
   - Review external service calls

3. **Review Metrics**:
   - Check custom metrics for FFmpeg execution
   - Monitor ephemeral storage usage
   - Analyze error rate trends

## Maintenance Procedures

### Regular Maintenance
1. **Weekly**:
   - Review alarm history and resolution times
   - Check performance trends and optimization opportunities
   - Review error logs for patterns

2. **Monthly**:
   - Run performance tests with `infrastructure/lambda/performance-test.js`
   - Review and update retry policies if needed
   - Check for security updates in container images

3. **Quarterly**:
   - Review and optimize memory/timeout configurations
   - Update monitoring dashboards and alarms
   - Conduct disaster recovery testing

### Deployment Procedures
1. **Pre-deployment**:
   - Run performance tests
   - Validate configuration changes
   - Check alarm thresholds

2. **Post-deployment**:
   - Monitor error rates and duration
   - Verify alarm functionality
   - Check custom metrics

## Emergency Procedures

### Service Outage
1. **Immediate Response**:
   - Check CloudWatch alarms and logs
   - Identify affected services and scope
   - Notify stakeholders

2. **Investigation**:
   - Analyze error patterns and root cause
   - Check recent changes and deployments
   - Review system health metrics

3. **Resolution**:
   - Implement hotfixes if needed
   - Rollback if necessary
   - Document incident and lessons learned

### Performance Degradation
1. **Immediate Response**:
   - Check duration and memory utilization
   - Review recent changes
   - Scale up if needed

2. **Investigation**:
   - Analyze performance trends
   - Check for resource contention
   - Review input data patterns

3. **Resolution**:
   - Optimize code and configuration
   - Adjust resource allocation
   - Implement performance improvements

## Contact Information

### Escalation Path
1. **Level 1**: Development Team
2. **Level 2**: DevOps Team
3. **Level 3**: Architecture Team

### On-Call Rotation
- Primary: [To be defined]
- Secondary: [To be defined]
- Escalation: [To be defined]

## Appendix

### Useful Commands
```bash
# Check function status
aws lambda get-function --function-name talk-avocado-{service}-dev

# View recent logs
aws logs tail /aws/lambda/talk-avocado-{service}-dev --follow

# Check DLQ messages
aws sqs receive-message --queue-url {dlq-url}

# Run performance tests
cd infrastructure/lambda
npm run test:performance {service}
```

### Useful Links
- [AWS Lambda Console](https://console.aws.amazon.com/lambda/)
- [CloudWatch Dashboard](https://console.aws.amazon.com/cloudwatch/home#dashboards:)
- [X-Ray Service Map](https://console.aws.amazon.com/xray/home#/service-map)
- [SQS Console](https://console.aws.amazon.com/sqs/)

### Configuration Files
- Lambda Configuration: `infrastructure/lambda/config/lambda-config.yaml`
- CDK Stack: `infrastructure/lambda/lambda-stack.ts`
- Retry Policy: `backend/lib/retry-policy.ts`
- Performance Tests: `infrastructure/lambda/performance-test.js`
