export function getDefaultConfig(): {
    minPauseMs: number;
    fillerWords: string[];
    minCutDurationSec: number;
    minSegmentDurationSec: number;
    maxSegmentDurationSec: number;
    mergeThresholdMs: number;
    deterministic: boolean;
};
export function detectSilence(segments: any, config: any): {
    start: any;
    end: any;
    reason: string;
}[];
export function detectFillerWords(segments: any, config: any): {
    start: number;
    end: any;
    reason: string;
}[];
export function mergeCutRegions(regions: any, mergeThresholdMs: any): any[];
export function filterShortCuts(regions: any, minDurationSec: any): any;
export function generateCutPlan(transcriptData: any, cutRegions: any, config: any): {
    schemaVersion: string;
    source: string;
    output: string;
    cuts: {
        start: any;
        end: any;
        type: string;
        reason: any;
        confidence: number;
    }[];
    metadata: {
        processingTimeMs: number;
        parameters: {
            minPauseMs: any;
            minCutDurationSec: any;
            mergeThresholdMs: any;
            deterministic: any;
        };
    };
};
export function planCuts(transcriptData: any, userConfig: any): {
    schemaVersion: string;
    source: string;
    output: string;
    cuts: {
        start: any;
        end: any;
        type: string;
        reason: any;
        confidence: number;
    }[];
    metadata: {
        processingTimeMs: number;
        parameters: {
            minPauseMs: any;
            minCutDurationSec: any;
            mergeThresholdMs: any;
            deterministic: any;
        };
    };
};
