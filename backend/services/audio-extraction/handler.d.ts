export function handler(event: any, context: any): Promise<{
    ok: boolean;
    outputKey: string;
    correlationId: any;
}>;
