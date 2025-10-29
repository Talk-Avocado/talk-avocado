#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { TalkAvocadoLambdaStack } from "./lambda-stack";

const app = new cdk.App();

// Get environment from context or default to 'dev'
const environment = app.node.tryGetContext("environment") || "dev";
const tenantId = app.node.tryGetContext("tenantId") || "default";

// Create the Lambda stack
new TalkAvocadoLambdaStack(app, `TalkAvocado-Lambda-${environment}`, {
  environment,
  tenantId,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  },
  description: `TalkAvocado Lambda functions for ${environment} environment`,
  tags: {
    Environment: environment,
    Service: "TalkAvocado",
    Component: "Lambda",
    TenantId: tenantId,
  },
});

// Context values are set via command line or cdk.json
