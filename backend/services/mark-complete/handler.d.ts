export function handler(event: any): Promise<{
    statusCode: number;
    body: {
        tenantId: any;
        jobId: any;
        status: string;
        updatedAt: string;
        correlationId: any;
    };
}>;
