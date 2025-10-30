export type Env = "dev" | "stage" | "prod" | "test";

export interface ManifestInput {
  sourceKey: string;
  originalFilename: string;
  bytes: number;
  mimeType: string;
  checksum?: string;
  uploadedAt?: string;
}

export interface ManifestTranscript {
  jsonKey?: string;
  srtKey?: string;
  language?: string;
  model?: "tiny" | "base" | "small" | "medium" | "large";
  confidence?: number;
  transcribedAt?: string;
}

export interface ManifestPlan {
  key?: string;
  schemaVersion?: string;
  algorithm?: string;
  totalCuts?: number;
  plannedAt?: string;
}

export interface ManifestRender {
  key: string;
  type: "preview" | "final" | "thumbnail";
  codec: "h264" | "h265" | "vp9";
  durationSec?: number;
  resolution?: string;
  notes?: string;
  renderedAt?: string;
}

export interface ManifestSubtitle {
  key: string;
  type: "source" | "final";
  format: "srt" | "vtt";
  durationSec?: number;
  wordCount?: number;
  generatedAt?: string;
}

export interface ManifestLog {
  key?: string;
  type?: "pipeline" | "error" | "debug";
  createdAt?: string;
}

export interface ManifestMetadata {
  clientVersion?: string;
  processingTimeMs?: number;
  tags?: string[];
}

export interface Manifest {
  schemaVersion: "1.0.0";
  env: Env;
  tenantId: string;
  jobId: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  sourceVideoKey?: string;
  input?: ManifestInput;
  audio?: {
    key?: string;
    codec?: "mp3" | "wav" | "aac";
    durationSec?: number;
    bitrateKbps?: number;
    sampleRate?: 16000 | 22050 | 44100 | 48000;
    extractedAt?: string;
  };
  transcript?: ManifestTranscript;
  plan?: ManifestPlan;
  renders?: ManifestRender[];
  subtitles?: ManifestSubtitle[];
  logs?: ManifestLog[];
  metadata?: ManifestMetadata;
}

// Cut Plan Types
export interface CutSegment {
  start: string;
  end: string;
  type: "keep" | "cut";
  reason?: string;
  confidence?: number;
}

export interface CutPlanMetadata {
  processingTimeMs?: number;
  parameters?: Record<string, any>;
}

export interface CutPlan {
  schemaVersion?: "1.0.0";
  source?: string;
  output?: string;
  cuts: CutSegment[];
  metadata?: CutPlanMetadata;
}
