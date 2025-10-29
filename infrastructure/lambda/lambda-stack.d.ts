import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
export interface LambdaStackProps extends cdk.StackProps {
  environment: string;
  tenantId: string;
}
export declare class TalkAvocadoLambdaStack extends cdk.Stack {
  readonly functions: {
    [key: string]: lambda.Function;
  };
  readonly deadLetterQueues: {
    [key: string]: sqs.Queue;
  };
  constructor(scope: Construct, id: string, props: LambdaStackProps);
  private createCloudWatchAlarms;
}
