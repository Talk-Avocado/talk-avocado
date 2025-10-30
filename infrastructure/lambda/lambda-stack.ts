import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import { Construct } from "constructs";
import * as yaml from "js-yaml";
import * as fs from "fs";
import * as path from "path";

export interface LambdaStackProps extends cdk.StackProps {
  environment: string;
  tenantId: string;
}

export class TalkAvocadoLambdaStack extends cdk.Stack {
  public readonly functions: { [key: string]: lambda.Function } = {};
  public readonly deadLetterQueues: { [key: string]: sqs.Queue } = {};

  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props);

    // Load configuration
    const configPath = path.join(__dirname, "config", "lambda-config.yaml");
    const config = yaml.load(fs.readFileSync(configPath, "utf8")) as any;

    // Create ECR repository reference
    const ecrRepository = ecr.Repository.fromRepositoryName(
      this,
      "FFmpegRuntimeRepository",
      "talk-avocado/ffmpeg-runtime"
    );

    // Create dead letter queues for each service
    Object.keys(config.services).forEach(serviceName => {
      const dlq = new sqs.Queue(this, `${serviceName}-DLQ`, {
        queueName: `talk-avocado-${serviceName}-dlq-${props.environment}`,
        retentionPeriod: cdk.Duration.days(14),
        visibilityTimeout: cdk.Duration.minutes(15),
      });
      this.deadLetterQueues[serviceName] = dlq;
    });

    // Create Lambda functions
    Object.entries(config.services).forEach(
      ([serviceName, serviceConfig]: [string, any]) => {
        const functionName = `talk-avocado-${serviceName}-${props.environment}`;

        // Create IAM role for the function
        const role = new iam.Role(this, `${serviceName}-Role`, {
          assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
          managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName(
              "service-role/AWSLambdaBasicExecutionRole"
            ),
          ],
          inlinePolicies: {
            MediaProcessingPolicy: new iam.PolicyDocument({
              statements: [
                new iam.PolicyStatement({
                  effect: iam.Effect.ALLOW,
                  actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
                  resources: [
                    `arn:aws:s3:::talk-avocado-*-${props.environment}/*`,
                  ],
                }),
                new iam.PolicyStatement({
                  effect: iam.Effect.ALLOW,
                  actions: [
                    "dynamodb:GetItem",
                    "dynamodb:PutItem",
                    "dynamodb:UpdateItem",
                    "dynamodb:Query",
                  ],
                  resources: [
                    `arn:aws:dynamodb:${this.region}:${this.account}:table/talk-avocado-jobs-${props.environment}`,
                  ],
                }),
                new iam.PolicyStatement({
                  effect: iam.Effect.ALLOW,
                  actions: [
                    "xray:PutTraceSegments",
                    "xray:PutTelemetryRecords",
                  ],
                  resources: ["*"],
                }),
              ],
            }),
          },
        });

        // Create the Lambda function
        const lambdaFunction = new lambda.Function(
          this,
          `${serviceName}-Function`,
          {
            functionName,
            runtime: lambda.Runtime.FROM_IMAGE,
            architecture: lambda.Architecture.X86_64,
            code: lambda.Code.fromEcrImage(ecrRepository, {
              tagOrDigest: "latest", // In production, use specific digest
            }),
            handler: lambda.Handler.FROM_IMAGE,
            memorySize: serviceConfig.memory,
            timeout: cdk.Duration.seconds(serviceConfig.timeout),
            role,
            environment: {
              ...serviceConfig.environment,
              ENVIRONMENT: props.environment,
              TENANT_ID: props.tenantId,
              LOG_LEVEL: "INFO",
              POWERTOOLS_SERVICE_NAME: serviceName,
              POWERTOOLS_METRICS_NAMESPACE: "TalkAvocado",
              POWERTOOLS_LOGGER_LOG_EVENT: "true",
            },
            ephemeralStorageSize: cdk.Size.gibibytes(
              serviceConfig.ephemeral_storage.size
            ),
            deadLetterQueue: this.deadLetterQueues[serviceName],
            reservedConcurrentExecutions: config.common.reserved_concurrency,
            logRetention: logs.RetentionDays.ONE_MONTH,
            tracing: lambda.Tracing.ACTIVE,
            description: serviceConfig.description,
          }
        );

        // Add X-Ray permissions
        lambdaFunction.addToRolePolicy(
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
            resources: ["*"],
          })
        );

        this.functions[serviceName] = lambdaFunction;
      }
    );

    // Create CloudWatch Alarms
    this.createCloudWatchAlarms(config);

    // Output important values
    new cdk.CfnOutput(this, "FFmpegRuntimeRepositoryURI", {
      value: ecrRepository.repositoryUri,
      description: "ECR Repository URI for FFmpeg runtime image",
    });

    Object.entries(this.functions).forEach(([serviceName, func]) => {
      new cdk.CfnOutput(this, `${serviceName}FunctionArn`, {
        value: func.functionArn,
        description: `${serviceName} Lambda Function ARN`,
      });
    });
  }

  private createCloudWatchAlarms(config: any) {
    // Error rate alarm
    Object.entries(this.functions).forEach(([serviceName, func]) => {
      const errorRateAlarm = new cdk.aws_cloudwatch.Alarm(
        this,
        `${serviceName}-ErrorRate-Alarm`,
        {
          alarmName: `TalkAvocado-${serviceName}-ErrorRate`,
          metric: func.metricErrors({
            period: cdk.Duration.minutes(5),
            statistic: "Average",
          }),
          threshold: 0.05, // 5% error rate
          evaluationPeriods: 2,
          treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
          alarmDescription: `Error rate alarm for ${serviceName}`,
        }
      );

      // Duration alarm
      const durationAlarm = new cdk.aws_cloudwatch.Alarm(
        this,
        `${serviceName}-Duration-Alarm`,
        {
          alarmName: `TalkAvocado-${serviceName}-Duration`,
          metric: func.metricDuration({
            period: cdk.Duration.minutes(5),
            statistic: "Average",
          }),
          threshold: config.services[serviceName].timeout * 0.9 * 1000, // 90% of timeout
          evaluationPeriods: 2,
          treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
          alarmDescription: `Duration alarm for ${serviceName}`,
        }
      );

      // DLQ alarm - using CloudWatch metric directly
      const dlqAlarm = new cdk.aws_cloudwatch.Alarm(
        this,
        `${serviceName}-DLQ-Alarm`,
        {
          alarmName: `TalkAvocado-${serviceName}-DLQ`,
          metric: new cdk.aws_cloudwatch.Metric({
            namespace: "AWS/SQS",
            metricName: "ApproximateNumberOfVisibleMessages",
            dimensionsMap: {
              QueueName: this.deadLetterQueues[serviceName].queueName,
            },
          }),
          threshold: 0,
          comparisonOperator:
            cdk.aws_cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          evaluationPeriods: 1,
          treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
          alarmDescription: `DLQ alarm for ${serviceName}`,
        }
      );
    });
  }
}
