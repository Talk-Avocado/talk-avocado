export function handler(event: any, context: any): Promise<{
    ok: boolean;
    transcriptJsonKey: string;
    transcriptSrtKey: string;
    correlationId: any;
}>;
