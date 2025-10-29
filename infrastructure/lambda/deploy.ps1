# TalkAvocado Lambda Infrastructure Deployment Script
# Usage: .\deploy.ps1 [environment] [action]
# Environment: dev, staging, prod (default: dev)
# Action: deploy, destroy, diff, synth (default: deploy)

param(
    [string]$Environment = "dev",
    [string]$Action = "deploy"
)

$StackName = "TalkAvocado-Lambda-$Environment"

Write-Host "🚀 TalkAvocado Lambda Infrastructure Deployment" -ForegroundColor Green
Write-Host "Environment: $Environment" -ForegroundColor Yellow
Write-Host "Action: $Action" -ForegroundColor Yellow
Write-Host "Stack Name: $StackName" -ForegroundColor Yellow
Write-Host ""

# Check if CDK is installed
try {
    cdk --version | Out-Null
    Write-Host "✅ AWS CDK is installed" -ForegroundColor Green
} catch {
    Write-Host "❌ AWS CDK is not installed. Please install it first:" -ForegroundColor Red
    Write-Host "npm install -g aws-cdk" -ForegroundColor Red
    exit 1
}

# Check if AWS CLI is configured
try {
    aws sts get-caller-identity | Out-Null
    Write-Host "✅ AWS CLI is configured" -ForegroundColor Green
} catch {
    Write-Host "❌ AWS CLI is not configured. Please run 'aws configure' first." -ForegroundColor Red
    exit 1
}

# Install dependencies
Write-Host "📦 Installing dependencies..." -ForegroundColor Blue
npm install

# Build TypeScript
Write-Host "🔨 Building TypeScript..." -ForegroundColor Blue
npm run build

# Bootstrap CDK if needed
if ($Action -eq "deploy") {
    Write-Host "🚀 Bootstrapping CDK (if needed)..." -ForegroundColor Blue
    cdk bootstrap --context environment=$Environment
}

# Execute the action
switch ($Action) {
    "deploy" {
        Write-Host "🚀 Deploying Lambda infrastructure..." -ForegroundColor Blue
        cdk deploy --context environment=$Environment --require-approval never
    }
    "destroy" {
        Write-Host "💥 Destroying Lambda infrastructure..." -ForegroundColor Red
        cdk destroy --context environment=$Environment --force
    }
    "diff" {
        Write-Host "🔍 Showing differences..." -ForegroundColor Blue
        cdk diff --context environment=$Environment
    }
    "synth" {
        Write-Host "📝 Synthesizing CloudFormation template..." -ForegroundColor Blue
        cdk synth --context environment=$Environment
    }
    default {
        Write-Host "❌ Unknown action: $Action" -ForegroundColor Red
        Write-Host "Available actions: deploy, destroy, diff, synth" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "✅ Operation completed successfully!" -ForegroundColor Green
