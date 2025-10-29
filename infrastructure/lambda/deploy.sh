#!/bin/bash

# TalkAvocado Lambda Infrastructure Deployment Script
# Usage: ./deploy.sh [environment] [action]
# Environment: dev, staging, prod (default: dev)
# Action: deploy, destroy, diff, synth (default: deploy)

set -e

ENVIRONMENT=${1:-dev}
ACTION=${2:-deploy}
STACK_NAME="TalkAvocado-Lambda-${ENVIRONMENT}"

echo "🚀 TalkAvocado Lambda Infrastructure Deployment"
echo "Environment: ${ENVIRONMENT}"
echo "Action: ${ACTION}"
echo "Stack Name: ${STACK_NAME}"
echo ""

# Check if CDK is installed
if ! command -v cdk &> /dev/null; then
    echo "❌ AWS CDK is not installed. Please install it first:"
    echo "npm install -g aws-cdk"
    exit 1
fi

# Check if AWS CLI is configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS CLI is not configured. Please run 'aws configure' first."
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build

# Bootstrap CDK if needed
if [ "$ACTION" = "deploy" ]; then
    echo "🚀 Bootstrapping CDK (if needed)..."
    cdk bootstrap --context environment=${ENVIRONMENT} || true
fi

# Execute the action
case $ACTION in
    "deploy")
        echo "🚀 Deploying Lambda infrastructure..."
        cdk deploy --context environment=${ENVIRONMENT} --require-approval never
        ;;
    "destroy")
        echo "💥 Destroying Lambda infrastructure..."
        cdk destroy --context environment=${ENVIRONMENT} --force
        ;;
    "diff")
        echo "🔍 Showing differences..."
        cdk diff --context environment=${ENVIRONMENT}
        ;;
    "synth")
        echo "📝 Synthesizing CloudFormation template..."
        cdk synth --context environment=${ENVIRONMENT}
        ;;
    *)
        echo "❌ Unknown action: $ACTION"
        echo "Available actions: deploy, destroy, diff, synth"
        exit 1
        ;;
esac

echo ""
echo "✅ Operation completed successfully!"
