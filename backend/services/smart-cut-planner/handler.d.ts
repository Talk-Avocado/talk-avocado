export function handler(event: any, context: any): Promise<{
    ok: boolean;
    planKey: string;
    correlationId: any;
}>;
