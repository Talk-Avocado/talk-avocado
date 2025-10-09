# Phase-1 Conventions

This document defines Phase-1 conventions across artefacts, event shapes, manifest updates, metrics, errors, logging, and verification tolerances.

## Canonical Artefact Names and Paths

- Cuts output: `renders/base_cuts.mp4`
- Transitions output: `renders/with_transitions.mp4`
- Final output: `renders/final.mp4`
- Subtitles: `subtitles/final.srt` (optional `subtitles/final.vtt`)
- Plans: `plan/cut_plan.json`, `plan/transition_plan.json`
- Transcripts (example): `transcripts/whisper.json`

### Golden Tolerances and Comparison Rules

- Video: duration ±100 ms; frame count ±1; A/V sync drift ≤50 ms
- Subtitles: cue boundary ≤33 ms; no overlaps; monotonic times
- Transcription: word count Δ ≤5; timestamps monotonic
- JSON/text artefacts: byte equality

### Logging Fields (present on every log line)

```json
{ "correlationId": "string", "tenantId": "string", "jobId": "string", "step": "string", "error": { "type": "optional string" } }
```

### Standard Metrics and Error Types

- Metrics (examples by stage):
  - Cuts: `VideoCutsDurationMs`, `VideoCutsFrames`, `VideoCutsError_{Type}`
  - Transitions: `VideoTransitionsDurationMs`, `VideoTransitionsApplied`, `VideoTransitionsError_{Type}`
  - Subtitles: `SubtitleCues`, `SubtitleCueBoundaryMaxMs`, `SubtitleError_{Type}`
  - Branding: `BrandingSuccess`, `BrandingElementsApplied`, `BrandingError_{Type}`

- Error taxonomy (use exact strings): `INPUT_MISSING`, `VALIDATION_FAILED`, `CODEC_UNSUPPORTED`, `TIMEOUT`, `TRANSIENT_DEPENDENCY`, `UNKNOWN`

- Retry policy: only `TRANSIENT_DEPENDENCY` and `TIMEOUT` (bounded attempts, exponential backoff with jitter).

### Stage Table: Inputs → Outputs → Manifest → Metrics → Errors

| Stage | Inputs | Outputs | Manifest fields touched | Metrics | Error types |
| --- | --- | --- | --- | --- | --- |
| audio-extraction | `media.sourceKey` (set) | source media in S3 | `media.sourceKey`, `steps.cuts.status=pend/processing/completed/failed`, `job.updatedAt` | `<Stage>DurationMs`, `<Stage>Error_{Type}` | All |
| transcription | `media.sourceKey` | `transcripts/whisper.json` | `extra.transcription.*` or `media.transcriptKey`, `steps.transcription.status`, `job.updatedAt` | `<Stage>DurationMs`, `TranscriptWords`, `<Stage>Error_{Type}` | All |
| smart-cut-planner | `transcripts/*` | `plan/cut_plan.json` | `media.plan.cutPlanKey`, `steps.cuts.status` (prepare), `job.updatedAt` | `<Stage>DurationMs`, `CutPlanSegments`, `<Stage>Error_{Type}` | All |
| video-cuts | `sourceVideoKey`, `cutPlanKey` | `renders/base_cuts.mp4` | `media.baseCutsKey`, `steps.cuts.status`, `job.updatedAt` | `VideoCutsDurationMs`, `VideoCutsFrames`, `VideoCutsError_{Type}` | All |
| video-transitions | `renders/base_cuts.mp4`, `transitionPlanKey` | `renders/with_transitions.mp4` | `media.withTransitionsKey`, `steps.transitions.status`, `job.updatedAt` | `VideoTransitionsDurationMs`, `VideoTransitionsApplied`, `VideoTransitionsError_{Type}` | All |
| subtitles-post-edit | transcript(s) | `subtitles/final.srt` (+ `.vtt`) | `media.subtitles`, `steps.subtitles.status`, `job.updatedAt` | `SubtitleCues`, `SubtitleCueBoundaryMaxMs`, `SubtitleError_{Type}` | All |
| branding-layer | `renders/with_transitions.mp4`, `subtitles/final.srt` | `renders/final.mp4` | `media.finalKey`, `steps.branding.status`, `job.updatedAt` | `BrandingSuccess`, `BrandingElementsApplied`, `BrandingError_{Type}` | All |

Notes:

- If transitions are skipped, branding reads `renders/base_cuts.mp4` instead of `renders/with_transitions.mp4`.
- All manifest writes must be schema-validated (see ADR-003). Each write updates `job.updatedAt`.
- Append structured entries to `logs[]` with `{ step, type, message, at, correlationId }`.

### Orchestration and Event Shapes (Phase-1)

- Orchestration: AWS Step Functions (Standard). Harness payloads are identical to ASL Task inputs.

- Cuts Event:

```json
{
  "env": "dev|stage|prod",
  "tenantId": "string",
  "jobId": "string",
  "sourceVideoKey": "string",
  "cutPlanKey": "plan/cut_plan.json",
  "outputKey": "renders/base_cuts.mp4",
  "correlationId": "string"
}
```

- Transitions Event:

```json
{
  "env": "dev|stage|prod",
  "tenantId": "string",
  "jobId": "string",
  "inputKey": "renders/base_cuts.mp4",
  "transitionPlanKey": "plan/transition_plan.json",
  "outputKey": "renders/with_transitions.mp4",
  "correlationId": "string"
}
```

- Branding Event:

```json
{
  "env": "dev|stage|prod",
  "tenantId": "string",
  "jobId": "string",
  "sourceVideoKey": "renders/with_transitions.mp4",
  "subtitleKeys": { "srt": "subtitles/final.srt", "vtt": "subtitles/final.vtt" },
  "brandingConfig": { "intro": "…", "outro": "…", "logo": "…" },
  "outputKey": "renders/final.mp4",
  "correlationId": "string"
}
```

- Subtitles Post-Edit: produces `subtitles/final.srt` (and optionally `.vtt`) for burn-in and downstream consumers.

### Tenant Isolation and Paths

- S3 prefixes: `{env}/{tenantId}/{jobId}/…`
- IAM session tag `tenantId` required; DDB keys PK/SK scoped by tenant.
- Negative cross-tenant access tests must be present in harness.

### Branding and Media Policy (Phase-1)

- H.264 High profile, source fps/resolution, CRF 20.
- Letterbox/pillarbox to preserve AR, never stretch.
- Loudness target −16 LUFS ±1.
- Default crossfade 500 ms.

## Manifest and Storage Schema (v1.0.0)

### Environment Standards
- Environments: `dev`, `stage`, `prod`
- Environment variable: `TALKAVOCADO_ENV` (defaults to `dev`)
- Storage path: `MEDIA_STORAGE_PATH` (defaults to `./storage`)

### Canonical Storage Layout
All storage follows the pattern: `{env}/{tenantId}/{jobId}/...`

```
{env}/                          # dev, stage, prod
  {tenantId}/                   # [a-z0-9-_] (1-64 chars)
    {jobId}/                    # UUID for this processing job
      manifest.json             # canonical job state and artifact registry
      input/
        {originalFilename}
        metadata.json
      audio/
        {jobId}.mp3
        extraction-log.json
      transcripts/
        transcript.json
        captions.source.srt
        analysis.json
      plan/
        cut_plan.json
        planner-config.json
        analysis-log.json
      renders/
        preview.mp4
        final.mp4
        render-log.json
      subtitles/
        final.srt
        style.json
      logs/
        pipeline.log
        errors.json
```

### Manifest Schema Versioning
- Current version: `schemaVersion = "1.0.0"`
- Schema validation: Required on every write operation
- Service-specific fields: Use `extra.<service>.*` namespace
- Schema owner: Backend team (see ADR-003)

### Tenant Isolation
- Tenant ID pattern: `^[a-z0-9](?:[a-z0-9-_]{0,62}[a-z0-9])?$`
- DynamoDB: Tenant-scoped primary keys (`tenantId` as partition key)
- IAM: Session tags include `tenantId` for access control
- Storage: Path-based isolation with no cross-tenant access

### Local vs S3 Mode
- Phase 1: Local filesystem mode only (`./storage/` root)
- Phase 2: S3 mode with identical logical keys
- Compatibility: Legacy mirror mode available via `ENABLE_LEGACY_MIRROR=true`

### Standardized Folder Names
- `transcripts/` (plural) - matches existing codebase usage
- `renders/` - all video outputs
- `subtitles/` - subtitle files (SRT, VTT)
- `plan/` - cut plans and configuration
- `logs/` - processing logs and errors