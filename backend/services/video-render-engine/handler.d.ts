export function handler(event: any, context: any): Promise<{
    ok: boolean;
    outputKey: string;
    correlationId: any;
    durationSec: number;
    resolution: string | undefined;
    fps: any;
    keepSegments: any;
}>;
