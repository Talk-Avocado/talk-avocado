# Subtitles Post-Edit Service

Re-times subtitles to match the final edited video timeline, accounting for cuts and transitions.

## Overview

This service takes the original transcript with timestamps and maps them to the post-edit timeline by:
1. Removing subtitles for cut segments
2. Adjusting timing for kept segments to account for removed content
3. Generating SRT and VTT subtitle files with frame-accurate timing

## Inputs

- `transcripts/transcript.json` - Original transcript with word/segment timestamps
- `plan/cut_plan.json` - Cut plan with keep/cut segments
- `renders/base_cuts.mp4` or `renders/with_transitions.mp4` - Final rendered video (for validation)

## Outputs

- `subtitles/final.srt` - SubRip format subtitles
- `subtitles/final.vtt` - WebVTT format subtitles
- Manifest updates with subtitle metadata

## Handler Event

```javascript
{
  env: "dev" | "stage" | "prod",
  tenantId: string,
  jobId: string,
  transcriptKey?: string,  // Optional, defaults to {env}/{tenantId}/{jobId}/transcripts/transcript.json
  planKey?: string,        // Optional, defaults to {env}/{tenantId}/{jobId}/plan/cut_plan.json
  renderKey?: string,       // Optional, auto-detects with_transitions.mp4 or base_cuts.mp4
  targetFps?: number,       // Optional, defaults to 30
  correlationId?: string
}
```

## Environment Variables

The following environment variables can be configured:

- `SUBTITLES_TARGET_FPS` - Target frames per second (default: 30)
- `SUBTITLES_FRAME_TOLERANCE_MS` - Frame tolerance in milliseconds (default: 33ms at 30fps)
- `SUBTITLES_GENERATE_SRT` - Generate SRT format, set to `'false'` to disable (default: true)
- `SUBTITLES_GENERATE_VTT` - Generate VTT format, set to `'false'` to disable (default: true)
- `SUBTITLES_INCLUDE_TIMING_MAP` - Include timing map JSON (not yet implemented, default: false)

**Example `.env` configuration:**
```env
# Subtitles Post-Edit (WP01-06)
SUBTITLES_TARGET_FPS=30
SUBTITLES_FRAME_TOLERANCE_MS=33
SUBTITLES_GENERATE_SRT=true
SUBTITLES_GENERATE_VTT=true
SUBTITLES_INCLUDE_TIMING_MAP=false
```

## Timing Accuracy

- Frame accuracy: ±1 frame at target fps (default ±33ms at 30fps)
- All timestamps are rounded to frame boundaries
- Validates frame accuracy before generating output

## Error Handling

The service throws `SubtitleError` with types:
- `INVALID_TRANSCRIPT` - Transcript file missing or invalid
- `INVALID_PLAN` - Cut plan file missing or invalid
- `TIMING_MISMATCH` - Timing calculation errors
- `FRAME_ACCURACY` - Frame accuracy tolerance exceeded

On error, the manifest status is set to `'failed'` and an error log entry is added.

## Idempotency

The service is idempotent - running it multiple times with the same inputs will overwrite previous outputs safely. Existing `final` subtitle entries in the manifest are removed before adding new ones.

## Integration

Integrated with the local harness (`tools/harness/run-local-pipeline.js`) and runs automatically after video-render-engine completes.

