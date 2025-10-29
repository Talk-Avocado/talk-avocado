# TalkAvocado Lambda Infrastructure

This directory contains the AWS CDK infrastructure code for TalkAvocado Lambda functions.

## Overview

The infrastructure includes:

- Lambda functions for media processing services
- Dead Letter Queues (DLQ) for error handling
- CloudWatch alarms for monitoring
- IAM roles and policies
- ECR container image references

## Services

- **audio-extraction**: Extracts audio from video files (1769MB, 5min timeout)
- **transcription**: Transcribes audio using Whisper (3008MB, 10min timeout)
- **smart-cut-planner**: Analyzes content and creates cut plans (1769MB, 5min timeout)
- **video-render-engine**: Renders final video with cuts (5120MB, 15min timeout)
- **ffmpeg-test**: Validates FFmpeg runtime (1769MB, 1min timeout)

## Prerequisites

1. AWS CLI configured with appropriate permissions
2. AWS CDK installed: `npm install -g aws-cdk`
3. Node.js 18+ installed
4. ECR repository `talk-avocado/ffmpeg-runtime` with container image

## Quick Start

### Deploy to Development Environment

```bash
# Using PowerShell (Windows)
.\deploy.ps1 dev deploy

# Using Bash (Linux/Mac)
./deploy.sh dev deploy
```

### Deploy to Other Environments

```bash
# Staging
.\deploy.ps1 staging deploy

# Production
.\deploy.ps1 prod deploy
```

## Configuration

The Lambda configuration is defined in `config/lambda-config.yaml`. This file contains:

- Memory and timeout settings for each service
- Ephemeral storage configuration
- Environment variables
- Retry policies and DLQ settings

## Available Commands

- `deploy`: Deploy the infrastructure
- `destroy`: Remove the infrastructure
- `diff`: Show differences between deployed and local state
- `synth`: Generate CloudFormation template

## Monitoring

The infrastructure automatically creates CloudWatch alarms for:

- Error rates (>5% threshold)
- Duration (90% of timeout threshold)
- Dead Letter Queue messages (>0 threshold)

## Security

- IAM roles with least privilege access
- VPC configuration (disabled by default)
- X-Ray tracing enabled
- Dead Letter Queues for failed messages

## Troubleshooting

### Common Issues

1. **CDK Bootstrap Required**: Run `cdk bootstrap` for first-time setup
2. **ECR Image Not Found**: Ensure the FFmpeg runtime image is built and pushed
3. **Permissions**: Verify AWS CLI has sufficient permissions for Lambda, IAM, and CloudWatch

### Logs

Check CloudWatch Logs for each function:

- `/aws/lambda/talk-avocado-{service}-{environment}`

### Metrics

Monitor key metrics in CloudWatch:

- Invocations
- Errors
- Duration
- Dead Letter Queue depth
