"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TalkAvocadoLambdaStack = void 0;
const cdk = require("aws-cdk-lib");
const lambda = require("aws-cdk-lib/aws-lambda");
const sqs = require("aws-cdk-lib/aws-sqs");
const iam = require("aws-cdk-lib/aws-iam");
const logs = require("aws-cdk-lib/aws-logs");
const ecr = require("aws-cdk-lib/aws-ecr");
const yaml = require("js-yaml");
const fs = require("fs");
const path = require("path");
class TalkAvocadoLambdaStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        this.functions = {};
        this.deadLetterQueues = {};
        // Load configuration
        const configPath = path.join(__dirname, 'config', 'lambda-config.yaml');
        const config = yaml.load(fs.readFileSync(configPath, 'utf8'));
        // Create ECR repository reference
        const ecrRepository = ecr.Repository.fromRepositoryName(this, 'FFmpegRuntimeRepository', 'talk-avocado/ffmpeg-runtime');
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
        Object.entries(config.services).forEach(([serviceName, serviceConfig]) => {
            const functionName = `talk-avocado-${serviceName}-${props.environment}`;
            // Create IAM role for the function
            const role = new iam.Role(this, `${serviceName}-Role`, {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [
                    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                ],
                inlinePolicies: {
                    MediaProcessingPolicy: new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    's3:GetObject',
                                    's3:PutObject',
                                    's3:DeleteObject',
                                ],
                                resources: [
                                    `arn:aws:s3:::talk-avocado-*-${props.environment}/*`,
                                ],
                            }),
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'dynamodb:GetItem',
                                    'dynamodb:PutItem',
                                    'dynamodb:UpdateItem',
                                    'dynamodb:Query',
                                ],
                                resources: [
                                    `arn:aws:dynamodb:${this.region}:${this.account}:table/talk-avocado-jobs-${props.environment}`,
                                ],
                            }),
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    'xray:PutTraceSegments',
                                    'xray:PutTelemetryRecords',
                                ],
                                resources: ['*'],
                            }),
                        ],
                    }),
                },
            });
            // Create the Lambda function
            const lambdaFunction = new lambda.Function(this, `${serviceName}-Function`, {
                functionName,
                runtime: lambda.Runtime.NODEJS_18_X,
                architecture: lambda.Architecture.X86_64,
                code: lambda.Code.fromEcrImage(ecrRepository, {
                    tagOrDigest: 'latest', // In production, use specific digest
                }),
                handler: lambda.Handler.FROM_IMAGE,
                memorySize: serviceConfig.memory,
                timeout: cdk.Duration.seconds(serviceConfig.timeout),
                role,
                environment: {
                    ...serviceConfig.environment,
                    ENVIRONMENT: props.environment,
                    TENANT_ID: props.tenantId,
                    LOG_LEVEL: 'INFO',
                    POWERTOOLS_SERVICE_NAME: serviceName,
                    POWERTOOLS_METRICS_NAMESPACE: 'TalkAvocado',
                    POWERTOOLS_LOGGER_LOG_EVENT: 'true',
                },
                ephemeralStorageSize: cdk.Size.gibibytes(serviceConfig.ephemeral_storage.size),
                deadLetterQueue: this.deadLetterQueues[serviceName],
                reservedConcurrentExecutions: config.common.reserved_concurrency,
                logRetention: logs.RetentionDays.ONE_MONTH,
                tracing: lambda.Tracing.ACTIVE,
                description: serviceConfig.description,
            });
            // Add X-Ray permissions
            lambdaFunction.addToRolePolicy(new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    'xray:PutTraceSegments',
                    'xray:PutTelemetryRecords',
                ],
                resources: ['*'],
            }));
            this.functions[serviceName] = lambdaFunction;
        });
        // Create CloudWatch Alarms
        this.createCloudWatchAlarms(config);
        // Output important values
        new cdk.CfnOutput(this, 'FFmpegRuntimeRepositoryURI', {
            value: ecrRepository.repositoryUri,
            description: 'ECR Repository URI for FFmpeg runtime image',
        });
        Object.entries(this.functions).forEach(([serviceName, func]) => {
            new cdk.CfnOutput(this, `${serviceName}FunctionArn`, {
                value: func.functionArn,
                description: `${serviceName} Lambda Function ARN`,
            });
        });
    }
    createCloudWatchAlarms(config) {
        // Error rate alarm
        Object.entries(this.functions).forEach(([serviceName, func]) => {
            new cdk.aws_cloudwatch.Alarm(this, `${serviceName}-ErrorRate`, {
                alarmName: `TalkAvocado-${serviceName}-ErrorRate`,
                metric: func.metricErrors({
                    period: cdk.Duration.minutes(5),
                    statistic: 'Average',
                }),
                threshold: 0.05, // 5% error rate
                evaluationPeriods: 2,
                treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
                alarmDescription: `Error rate alarm for ${serviceName}`,
            });
            // Duration alarm
            new cdk.aws_cloudwatch.Alarm(this, `${serviceName}-Duration`, {
                alarmName: `TalkAvocado-${serviceName}-Duration`,
                metric: func.metricDuration({
                    period: cdk.Duration.minutes(5),
                    statistic: 'Average',
                }),
                threshold: config.services[serviceName].timeout * 0.9 * 1000, // 90% of timeout
                evaluationPeriods: 2,
                treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
                alarmDescription: `Duration alarm for ${serviceName}`,
            });
            // DLQ alarm - using CloudWatch metric directly
            new cdk.aws_cloudwatch.Alarm(this, `${serviceName}-DLQ`, {
                alarmName: `TalkAvocado-${serviceName}-DLQ`,
                metric: new cdk.aws_cloudwatch.Metric({
                    namespace: 'AWS/SQS',
                    metricName: 'ApproximateNumberOfVisibleMessages',
                    dimensionsMap: {
                        QueueName: this.deadLetterQueues[serviceName].queueName,
                    },
                }),
                threshold: 0,
                comparisonOperator: cdk.aws_cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
                evaluationPeriods: 1,
                treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
                alarmDescription: `DLQ alarm for ${serviceName}`,
            });
        });
    }
}
exports.TalkAvocadoLambdaStack = TalkAvocadoLambdaStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibGFtYmRhLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQyxpREFBaUQ7QUFDakQsMkNBQTJDO0FBQzNDLDJDQUEyQztBQUMzQyw2Q0FBNkM7QUFDN0MsMkNBQTJDO0FBRTNDLGdDQUFnQztBQUNoQyx5QkFBeUI7QUFDekIsNkJBQTZCO0FBTzdCLE1BQWEsc0JBQXVCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFJbkQsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUF1QjtRQUMvRCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUpWLGNBQVMsR0FBdUMsRUFBRSxDQUFDO1FBQ25ELHFCQUFnQixHQUFpQyxFQUFFLENBQUM7UUFLbEUscUJBQXFCO1FBQ3JCLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLFFBQVEsRUFBRSxvQkFBb0IsQ0FBQyxDQUFDO1FBQ3hFLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLFlBQVksQ0FBQyxVQUFVLEVBQUUsTUFBTSxDQUFDLENBQVEsQ0FBQztRQUVyRSxrQ0FBa0M7UUFDbEMsTUFBTSxhQUFhLEdBQUcsR0FBRyxDQUFDLFVBQVUsQ0FBQyxrQkFBa0IsQ0FDckQsSUFBSSxFQUNKLHlCQUF5QixFQUN6Qiw2QkFBNkIsQ0FDOUIsQ0FBQztRQUVGLDZDQUE2QztRQUM3QyxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLEVBQUU7WUFDakQsTUFBTSxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxHQUFHLFdBQVcsTUFBTSxFQUFFO2dCQUNwRCxTQUFTLEVBQUUsZ0JBQWdCLFdBQVcsUUFBUSxLQUFLLENBQUMsV0FBVyxFQUFFO2dCQUNqRSxlQUFlLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO2dCQUN0QyxpQkFBaUIsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7YUFDNUMsQ0FBQyxDQUFDO1lBQ0gsSUFBSSxDQUFDLGdCQUFnQixDQUFDLFdBQVcsQ0FBQyxHQUFHLEdBQUcsQ0FBQztRQUMzQyxDQUFDLENBQUMsQ0FBQztRQUVILDBCQUEwQjtRQUMxQixNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLFdBQVcsRUFBRSxhQUFhLENBQWdCLEVBQUUsRUFBRTtZQUN0RixNQUFNLFlBQVksR0FBRyxnQkFBZ0IsV0FBVyxJQUFJLEtBQUssQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUV4RSxtQ0FBbUM7WUFDbkMsTUFBTSxJQUFJLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxHQUFHLFdBQVcsT0FBTyxFQUFFO2dCQUNyRCxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsZ0JBQWdCLENBQUMsc0JBQXNCLENBQUM7Z0JBQzNELGVBQWUsRUFBRTtvQkFDZixHQUFHLENBQUMsYUFBYSxDQUFDLHdCQUF3QixDQUFDLDBDQUEwQyxDQUFDO2lCQUN2RjtnQkFDRCxjQUFjLEVBQUU7b0JBQ2QscUJBQXFCLEVBQUUsSUFBSSxHQUFHLENBQUMsY0FBYyxDQUFDO3dCQUM1QyxVQUFVLEVBQUU7NEJBQ1YsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO2dDQUN0QixNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLO2dDQUN4QixPQUFPLEVBQUU7b0NBQ1AsY0FBYztvQ0FDZCxjQUFjO29DQUNkLGlCQUFpQjtpQ0FDbEI7Z0NBQ0QsU0FBUyxFQUFFO29DQUNULCtCQUErQixLQUFLLENBQUMsV0FBVyxJQUFJO2lDQUNyRDs2QkFDRixDQUFDOzRCQUNGLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztnQ0FDdEIsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSztnQ0FDeEIsT0FBTyxFQUFFO29DQUNQLGtCQUFrQjtvQ0FDbEIsa0JBQWtCO29DQUNsQixxQkFBcUI7b0NBQ3JCLGdCQUFnQjtpQ0FDakI7Z0NBQ0QsU0FBUyxFQUFFO29DQUNULG9CQUFvQixJQUFJLENBQUMsTUFBTSxJQUFJLElBQUksQ0FBQyxPQUFPLDRCQUE0QixLQUFLLENBQUMsV0FBVyxFQUFFO2lDQUMvRjs2QkFDRixDQUFDOzRCQUNGLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztnQ0FDdEIsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSztnQ0FDeEIsT0FBTyxFQUFFO29DQUNQLHVCQUF1QjtvQ0FDdkIsMEJBQTBCO2lDQUMzQjtnQ0FDRCxTQUFTLEVBQUUsQ0FBQyxHQUFHLENBQUM7NkJBQ2pCLENBQUM7eUJBQ0g7cUJBQ0YsQ0FBQztpQkFDSDthQUNGLENBQUMsQ0FBQztZQUVILDZCQUE2QjtZQUM3QixNQUFNLGNBQWMsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLEdBQUcsV0FBVyxXQUFXLEVBQUU7Z0JBQzFFLFlBQVk7Z0JBQ1osT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsV0FBVztnQkFDbkMsWUFBWSxFQUFFLE1BQU0sQ0FBQyxZQUFZLENBQUMsTUFBTTtnQkFDeEMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLGFBQWEsRUFBRTtvQkFDNUMsV0FBVyxFQUFFLFFBQVEsRUFBRSxxQ0FBcUM7aUJBQzdELENBQUM7Z0JBQ0YsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsVUFBVTtnQkFDbEMsVUFBVSxFQUFFLGFBQWEsQ0FBQyxNQUFNO2dCQUNoQyxPQUFPLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFDLE9BQU8sQ0FBQztnQkFDcEQsSUFBSTtnQkFDSixXQUFXLEVBQUU7b0JBQ1gsR0FBRyxhQUFhLENBQUMsV0FBVztvQkFDNUIsV0FBVyxFQUFFLEtBQUssQ0FBQyxXQUFXO29CQUM5QixTQUFTLEVBQUUsS0FBSyxDQUFDLFFBQVE7b0JBQ3pCLFNBQVMsRUFBRSxNQUFNO29CQUNqQix1QkFBdUIsRUFBRSxXQUFXO29CQUNwQyw0QkFBNEIsRUFBRSxhQUFhO29CQUMzQywyQkFBMkIsRUFBRSxNQUFNO2lCQUNwQztnQkFDRCxvQkFBb0IsRUFBRSxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxhQUFhLENBQUMsaUJBQWlCLENBQUMsSUFBSSxDQUFDO2dCQUM5RSxlQUFlLEVBQUUsSUFBSSxDQUFDLGdCQUFnQixDQUFDLFdBQVcsQ0FBQztnQkFDbkQsNEJBQTRCLEVBQUUsTUFBTSxDQUFDLE1BQU0sQ0FBQyxvQkFBb0I7Z0JBQ2hFLFlBQVksRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVM7Z0JBQzFDLE9BQU8sRUFBRSxNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU07Z0JBQzlCLFdBQVcsRUFBRSxhQUFhLENBQUMsV0FBVzthQUN2QyxDQUFDLENBQUM7WUFFSCx3QkFBd0I7WUFDeEIsY0FBYyxDQUFDLGVBQWUsQ0FDNUIsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO2dCQUN0QixNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLO2dCQUN4QixPQUFPLEVBQUU7b0JBQ1AsdUJBQXVCO29CQUN2QiwwQkFBMEI7aUJBQzNCO2dCQUNELFNBQVMsRUFBRSxDQUFDLEdBQUcsQ0FBQzthQUNqQixDQUFDLENBQ0gsQ0FBQztZQUVGLElBQUksQ0FBQyxTQUFTLENBQUMsV0FBVyxDQUFDLEdBQUcsY0FBYyxDQUFDO1FBQy9DLENBQUMsQ0FBQyxDQUFDO1FBRUgsMkJBQTJCO1FBQzNCLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUVwQywwQkFBMEI7UUFDMUIsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSw0QkFBNEIsRUFBRTtZQUNwRCxLQUFLLEVBQUUsYUFBYSxDQUFDLGFBQWE7WUFDbEMsV0FBVyxFQUFFLDZDQUE2QztTQUMzRCxDQUFDLENBQUM7UUFFSCxNQUFNLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLFdBQVcsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO1lBQzdELElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsR0FBRyxXQUFXLGFBQWEsRUFBRTtnQkFDbkQsS0FBSyxFQUFFLElBQUksQ0FBQyxXQUFXO2dCQUN2QixXQUFXLEVBQUUsR0FBRyxXQUFXLHNCQUFzQjthQUNsRCxDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFTyxzQkFBc0IsQ0FBQyxNQUFXO1FBQ3hDLG1CQUFtQjtRQUNuQixNQUFNLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLFdBQVcsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO1lBQzdELE1BQU0sY0FBYyxHQUFHLElBQUksR0FBRyxDQUFDLGNBQWMsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLEdBQUcsV0FBVyxZQUFZLEVBQUU7Z0JBQ3BGLFNBQVMsRUFBRSxlQUFlLFdBQVcsWUFBWTtnQkFDakQsTUFBTSxFQUFFLElBQUksQ0FBQyxZQUFZLENBQUM7b0JBQ3hCLE1BQU0sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7b0JBQy9CLFNBQVMsRUFBRSxTQUFTO2lCQUNyQixDQUFDO2dCQUNGLFNBQVMsRUFBRSxJQUFJLEVBQUUsZ0JBQWdCO2dCQUNqQyxpQkFBaUIsRUFBRSxDQUFDO2dCQUNwQixnQkFBZ0IsRUFBRSxHQUFHLENBQUMsY0FBYyxDQUFDLGdCQUFnQixDQUFDLGFBQWE7Z0JBQ25FLGdCQUFnQixFQUFFLHdCQUF3QixXQUFXLEVBQUU7YUFDeEQsQ0FBQyxDQUFDO1lBRUgsaUJBQWlCO1lBQ2pCLE1BQU0sYUFBYSxHQUFHLElBQUksR0FBRyxDQUFDLGNBQWMsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLEdBQUcsV0FBVyxXQUFXLEVBQUU7Z0JBQ2xGLFNBQVMsRUFBRSxlQUFlLFdBQVcsV0FBVztnQkFDaEQsTUFBTSxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUM7b0JBQzFCLE1BQU0sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7b0JBQy9CLFNBQVMsRUFBRSxTQUFTO2lCQUNyQixDQUFDO2dCQUNGLFNBQVMsRUFBRSxNQUFNLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxDQUFDLE9BQU8sR0FBRyxHQUFHLEdBQUcsSUFBSSxFQUFFLGlCQUFpQjtnQkFDL0UsaUJBQWlCLEVBQUUsQ0FBQztnQkFDcEIsZ0JBQWdCLEVBQUUsR0FBRyxDQUFDLGNBQWMsQ0FBQyxnQkFBZ0IsQ0FBQyxhQUFhO2dCQUNuRSxnQkFBZ0IsRUFBRSxzQkFBc0IsV0FBVyxFQUFFO2FBQ3RELENBQUMsQ0FBQztZQUVILCtDQUErQztZQUMvQyxNQUFNLFFBQVEsR0FBRyxJQUFJLEdBQUcsQ0FBQyxjQUFjLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxHQUFHLFdBQVcsTUFBTSxFQUFFO2dCQUN4RSxTQUFTLEVBQUUsZUFBZSxXQUFXLE1BQU07Z0JBQzNDLE1BQU0sRUFBRSxJQUFJLEdBQUcsQ0FBQyxjQUFjLENBQUMsTUFBTSxDQUFDO29CQUNwQyxTQUFTLEVBQUUsU0FBUztvQkFDcEIsVUFBVSxFQUFFLG9DQUFvQztvQkFDaEQsYUFBYSxFQUFFO3dCQUNiLFNBQVMsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsV0FBVyxDQUFDLENBQUMsU0FBUztxQkFDeEQ7aUJBQ0YsQ0FBQztnQkFDRixTQUFTLEVBQUUsQ0FBQztnQkFDWixrQkFBa0IsRUFBRSxHQUFHLENBQUMsY0FBYyxDQUFDLGtCQUFrQixDQUFDLHNCQUFzQjtnQkFDaEYsaUJBQWlCLEVBQUUsQ0FBQztnQkFDcEIsZ0JBQWdCLEVBQUUsR0FBRyxDQUFDLGNBQWMsQ0FBQyxnQkFBZ0IsQ0FBQyxhQUFhO2dCQUNuRSxnQkFBZ0IsRUFBRSxpQkFBaUIsV0FBVyxFQUFFO2FBQ2pELENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBeExELHdEQXdMQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XHJcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcclxuaW1wb3J0ICogYXMgc3FzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zcXMnO1xyXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XHJcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xyXG5pbXBvcnQgKiBhcyBlY3IgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcic7XHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG5pbXBvcnQgKiBhcyB5YW1sIGZyb20gJ2pzLXlhbWwnO1xyXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XHJcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIExhbWJkYVN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XHJcbiAgZW52aXJvbm1lbnQ6IHN0cmluZztcclxuICB0ZW5hbnRJZDogc3RyaW5nO1xyXG59XHJcblxyXG5leHBvcnQgY2xhc3MgVGFsa0F2b2NhZG9MYW1iZGFTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XHJcbiAgcHVibGljIHJlYWRvbmx5IGZ1bmN0aW9uczogeyBba2V5OiBzdHJpbmddOiBsYW1iZGEuRnVuY3Rpb24gfSA9IHt9O1xyXG4gIHB1YmxpYyByZWFkb25seSBkZWFkTGV0dGVyUXVldWVzOiB7IFtrZXk6IHN0cmluZ106IHNxcy5RdWV1ZSB9ID0ge307XHJcblxyXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBMYW1iZGFTdGFja1Byb3BzKSB7XHJcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcclxuXHJcbiAgICAvLyBMb2FkIGNvbmZpZ3VyYXRpb25cclxuICAgIGNvbnN0IGNvbmZpZ1BhdGggPSBwYXRoLmpvaW4oX19kaXJuYW1lLCAnY29uZmlnJywgJ2xhbWJkYS1jb25maWcueWFtbCcpO1xyXG4gICAgY29uc3QgY29uZmlnID0geWFtbC5sb2FkKGZzLnJlYWRGaWxlU3luYyhjb25maWdQYXRoLCAndXRmOCcpKSBhcyBhbnk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIEVDUiByZXBvc2l0b3J5IHJlZmVyZW5jZVxyXG4gICAgY29uc3QgZWNyUmVwb3NpdG9yeSA9IGVjci5SZXBvc2l0b3J5LmZyb21SZXBvc2l0b3J5TmFtZShcclxuICAgICAgdGhpcyxcclxuICAgICAgJ0ZGbXBlZ1J1bnRpbWVSZXBvc2l0b3J5JyxcclxuICAgICAgJ3RhbGstYXZvY2Fkby9mZm1wZWctcnVudGltZSdcclxuICAgICk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIGRlYWQgbGV0dGVyIHF1ZXVlcyBmb3IgZWFjaCBzZXJ2aWNlXHJcbiAgICBPYmplY3Qua2V5cyhjb25maWcuc2VydmljZXMpLmZvckVhY2goc2VydmljZU5hbWUgPT4ge1xyXG4gICAgICBjb25zdCBkbHEgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsIGAke3NlcnZpY2VOYW1lfS1ETFFgLCB7XHJcbiAgICAgICAgcXVldWVOYW1lOiBgdGFsay1hdm9jYWRvLSR7c2VydmljZU5hbWV9LWRscS0ke3Byb3BzLmVudmlyb25tZW50fWAsXHJcbiAgICAgICAgcmV0ZW50aW9uUGVyaW9kOiBjZGsuRHVyYXRpb24uZGF5cygxNCksXHJcbiAgICAgICAgdmlzaWJpbGl0eVRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDE1KSxcclxuICAgICAgfSk7XHJcbiAgICAgIHRoaXMuZGVhZExldHRlclF1ZXVlc1tzZXJ2aWNlTmFtZV0gPSBkbHE7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBDcmVhdGUgTGFtYmRhIGZ1bmN0aW9uc1xyXG4gICAgT2JqZWN0LmVudHJpZXMoY29uZmlnLnNlcnZpY2VzKS5mb3JFYWNoKChbc2VydmljZU5hbWUsIHNlcnZpY2VDb25maWddOiBbc3RyaW5nLCBhbnldKSA9PiB7XHJcbiAgICAgIGNvbnN0IGZ1bmN0aW9uTmFtZSA9IGB0YWxrLWF2b2NhZG8tJHtzZXJ2aWNlTmFtZX0tJHtwcm9wcy5lbnZpcm9ubWVudH1gO1xyXG4gICAgICBcclxuICAgICAgLy8gQ3JlYXRlIElBTSByb2xlIGZvciB0aGUgZnVuY3Rpb25cclxuICAgICAgY29uc3Qgcm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCBgJHtzZXJ2aWNlTmFtZX0tUm9sZWAsIHtcclxuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcclxuICAgICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcclxuICAgICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpLFxyXG4gICAgICAgIF0sXHJcbiAgICAgICAgaW5saW5lUG9saWNpZXM6IHtcclxuICAgICAgICAgIE1lZGlhUHJvY2Vzc2luZ1BvbGljeTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XHJcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtcclxuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgICAgICAgICAgICdzMzpHZXRPYmplY3QnLFxyXG4gICAgICAgICAgICAgICAgICAnczM6UHV0T2JqZWN0JyxcclxuICAgICAgICAgICAgICAgICAgJ3MzOkRlbGV0ZU9iamVjdCcsXHJcbiAgICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbXHJcbiAgICAgICAgICAgICAgICAgIGBhcm46YXdzOnMzOjo6dGFsay1hdm9jYWRvLSotJHtwcm9wcy5lbnZpcm9ubWVudH0vKmAsXHJcbiAgICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICAgICAgICAgJ2R5bmFtb2RiOkdldEl0ZW0nLFxyXG4gICAgICAgICAgICAgICAgICAnZHluYW1vZGI6UHV0SXRlbScsXHJcbiAgICAgICAgICAgICAgICAgICdkeW5hbW9kYjpVcGRhdGVJdGVtJyxcclxuICAgICAgICAgICAgICAgICAgJ2R5bmFtb2RiOlF1ZXJ5JyxcclxuICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtcclxuICAgICAgICAgICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlL3RhbGstYXZvY2Fkby1qb2JzLSR7cHJvcHMuZW52aXJvbm1lbnR9YCxcclxuICAgICAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICAgICAgICAgICAneHJheTpQdXRUcmFjZVNlZ21lbnRzJyxcclxuICAgICAgICAgICAgICAgICAgJ3hyYXk6UHV0VGVsZW1ldHJ5UmVjb3JkcycsXHJcbiAgICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcclxuICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgXSxcclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gQ3JlYXRlIHRoZSBMYW1iZGEgZnVuY3Rpb25cclxuICAgICAgY29uc3QgbGFtYmRhRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsIGAke3NlcnZpY2VOYW1lfS1GdW5jdGlvbmAsIHtcclxuICAgICAgICBmdW5jdGlvbk5hbWUsXHJcbiAgICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgICAgYXJjaGl0ZWN0dXJlOiBsYW1iZGEuQXJjaGl0ZWN0dXJlLlg4Nl82NCxcclxuICAgICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tRWNySW1hZ2UoZWNyUmVwb3NpdG9yeSwge1xyXG4gICAgICAgICAgdGFnT3JEaWdlc3Q6ICdsYXRlc3QnLCAvLyBJbiBwcm9kdWN0aW9uLCB1c2Ugc3BlY2lmaWMgZGlnZXN0XHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgaGFuZGxlcjogbGFtYmRhLkhhbmRsZXIuRlJPTV9JTUFHRSxcclxuICAgICAgICBtZW1vcnlTaXplOiBzZXJ2aWNlQ29uZmlnLm1lbW9yeSxcclxuICAgICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcyhzZXJ2aWNlQ29uZmlnLnRpbWVvdXQpLFxyXG4gICAgICAgIHJvbGUsXHJcbiAgICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICAgIC4uLnNlcnZpY2VDb25maWcuZW52aXJvbm1lbnQsXHJcbiAgICAgICAgICBFTlZJUk9OTUVOVDogcHJvcHMuZW52aXJvbm1lbnQsXHJcbiAgICAgICAgICBURU5BTlRfSUQ6IHByb3BzLnRlbmFudElkLFxyXG4gICAgICAgICAgTE9HX0xFVkVMOiAnSU5GTycsXHJcbiAgICAgICAgICBQT1dFUlRPT0xTX1NFUlZJQ0VfTkFNRTogc2VydmljZU5hbWUsXHJcbiAgICAgICAgICBQT1dFUlRPT0xTX01FVFJJQ1NfTkFNRVNQQUNFOiAnVGFsa0F2b2NhZG8nLFxyXG4gICAgICAgICAgUE9XRVJUT09MU19MT0dHRVJfTE9HX0VWRU5UOiAndHJ1ZScsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBlcGhlbWVyYWxTdG9yYWdlU2l6ZTogY2RrLlNpemUuZ2liaWJ5dGVzKHNlcnZpY2VDb25maWcuZXBoZW1lcmFsX3N0b3JhZ2Uuc2l6ZSksXHJcbiAgICAgICAgZGVhZExldHRlclF1ZXVlOiB0aGlzLmRlYWRMZXR0ZXJRdWV1ZXNbc2VydmljZU5hbWVdLFxyXG4gICAgICAgIHJlc2VydmVkQ29uY3VycmVudEV4ZWN1dGlvbnM6IGNvbmZpZy5jb21tb24ucmVzZXJ2ZWRfY29uY3VycmVuY3ksXHJcbiAgICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxyXG4gICAgICAgIHRyYWNpbmc6IGxhbWJkYS5UcmFjaW5nLkFDVElWRSxcclxuICAgICAgICBkZXNjcmlwdGlvbjogc2VydmljZUNvbmZpZy5kZXNjcmlwdGlvbixcclxuICAgICAgfSk7XHJcblxyXG4gICAgICAvLyBBZGQgWC1SYXkgcGVybWlzc2lvbnNcclxuICAgICAgbGFtYmRhRnVuY3Rpb24uYWRkVG9Sb2xlUG9saWN5KFxyXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICAgJ3hyYXk6UHV0VHJhY2VTZWdtZW50cycsXHJcbiAgICAgICAgICAgICd4cmF5OlB1dFRlbGVtZXRyeVJlY29yZHMnLFxyXG4gICAgICAgICAgXSxcclxuICAgICAgICAgIHJlc291cmNlczogWycqJ10sXHJcbiAgICAgICAgfSlcclxuICAgICAgKTtcclxuXHJcbiAgICAgIHRoaXMuZnVuY3Rpb25zW3NlcnZpY2VOYW1lXSA9IGxhbWJkYUZ1bmN0aW9uO1xyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIENsb3VkV2F0Y2ggQWxhcm1zXHJcbiAgICB0aGlzLmNyZWF0ZUNsb3VkV2F0Y2hBbGFybXMoY29uZmlnKTtcclxuXHJcbiAgICAvLyBPdXRwdXQgaW1wb3J0YW50IHZhbHVlc1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0ZGbXBlZ1J1bnRpbWVSZXBvc2l0b3J5VVJJJywge1xyXG4gICAgICB2YWx1ZTogZWNyUmVwb3NpdG9yeS5yZXBvc2l0b3J5VXJpLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0VDUiBSZXBvc2l0b3J5IFVSSSBmb3IgRkZtcGVnIHJ1bnRpbWUgaW1hZ2UnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgT2JqZWN0LmVudHJpZXModGhpcy5mdW5jdGlvbnMpLmZvckVhY2goKFtzZXJ2aWNlTmFtZSwgZnVuY10pID0+IHtcclxuICAgICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgYCR7c2VydmljZU5hbWV9RnVuY3Rpb25Bcm5gLCB7XHJcbiAgICAgICAgdmFsdWU6IGZ1bmMuZnVuY3Rpb25Bcm4sXHJcbiAgICAgICAgZGVzY3JpcHRpb246IGAke3NlcnZpY2VOYW1lfSBMYW1iZGEgRnVuY3Rpb24gQVJOYCxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY3JlYXRlQ2xvdWRXYXRjaEFsYXJtcyhjb25maWc6IGFueSkge1xyXG4gICAgLy8gRXJyb3IgcmF0ZSBhbGFybVxyXG4gICAgT2JqZWN0LmVudHJpZXModGhpcy5mdW5jdGlvbnMpLmZvckVhY2goKFtzZXJ2aWNlTmFtZSwgZnVuY10pID0+IHtcclxuICAgICAgY29uc3QgZXJyb3JSYXRlQWxhcm0gPSBuZXcgY2RrLmF3c19jbG91ZHdhdGNoLkFsYXJtKHRoaXMsIGAke3NlcnZpY2VOYW1lfS1FcnJvclJhdGVgLCB7XHJcbiAgICAgICAgYWxhcm1OYW1lOiBgVGFsa0F2b2NhZG8tJHtzZXJ2aWNlTmFtZX0tRXJyb3JSYXRlYCxcclxuICAgICAgICBtZXRyaWM6IGZ1bmMubWV0cmljRXJyb3JzKHtcclxuICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXHJcbiAgICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJyxcclxuICAgICAgICB9KSxcclxuICAgICAgICB0aHJlc2hvbGQ6IDAuMDUsIC8vIDUlIGVycm9yIHJhdGVcclxuICAgICAgICBldmFsdWF0aW9uUGVyaW9kczogMixcclxuICAgICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjZGsuYXdzX2Nsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxyXG4gICAgICAgIGFsYXJtRGVzY3JpcHRpb246IGBFcnJvciByYXRlIGFsYXJtIGZvciAke3NlcnZpY2VOYW1lfWAsXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gRHVyYXRpb24gYWxhcm1cclxuICAgICAgY29uc3QgZHVyYXRpb25BbGFybSA9IG5ldyBjZGsuYXdzX2Nsb3Vkd2F0Y2guQWxhcm0odGhpcywgYCR7c2VydmljZU5hbWV9LUR1cmF0aW9uYCwge1xyXG4gICAgICAgIGFsYXJtTmFtZTogYFRhbGtBdm9jYWRvLSR7c2VydmljZU5hbWV9LUR1cmF0aW9uYCxcclxuICAgICAgICBtZXRyaWM6IGZ1bmMubWV0cmljRHVyYXRpb24oe1xyXG4gICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcclxuICAgICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIHRocmVzaG9sZDogY29uZmlnLnNlcnZpY2VzW3NlcnZpY2VOYW1lXS50aW1lb3V0ICogMC45ICogMTAwMCwgLy8gOTAlIG9mIHRpbWVvdXRcclxuICAgICAgICBldmFsdWF0aW9uUGVyaW9kczogMixcclxuICAgICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjZGsuYXdzX2Nsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxyXG4gICAgICAgIGFsYXJtRGVzY3JpcHRpb246IGBEdXJhdGlvbiBhbGFybSBmb3IgJHtzZXJ2aWNlTmFtZX1gLFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIERMUSBhbGFybSAtIHVzaW5nIENsb3VkV2F0Y2ggbWV0cmljIGRpcmVjdGx5XHJcbiAgICAgIGNvbnN0IGRscUFsYXJtID0gbmV3IGNkay5hd3NfY2xvdWR3YXRjaC5BbGFybSh0aGlzLCBgJHtzZXJ2aWNlTmFtZX0tRExRYCwge1xyXG4gICAgICAgIGFsYXJtTmFtZTogYFRhbGtBdm9jYWRvLSR7c2VydmljZU5hbWV9LURMUWAsXHJcbiAgICAgICAgbWV0cmljOiBuZXcgY2RrLmF3c19jbG91ZHdhdGNoLk1ldHJpYyh7XHJcbiAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvU1FTJyxcclxuICAgICAgICAgIG1ldHJpY05hbWU6ICdBcHByb3hpbWF0ZU51bWJlck9mVmlzaWJsZU1lc3NhZ2VzJyxcclxuICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHtcclxuICAgICAgICAgICAgUXVldWVOYW1lOiB0aGlzLmRlYWRMZXR0ZXJRdWV1ZXNbc2VydmljZU5hbWVdLnF1ZXVlTmFtZSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgdGhyZXNob2xkOiAwLFxyXG4gICAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2RrLmF3c19jbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5HUkVBVEVSX1RIQU5fVEhSRVNIT0xELFxyXG4gICAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxyXG4gICAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNkay5hd3NfY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXHJcbiAgICAgICAgYWxhcm1EZXNjcmlwdGlvbjogYERMUSBhbGFybSBmb3IgJHtzZXJ2aWNlTmFtZX1gLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH1cclxufVxyXG4iXX0=