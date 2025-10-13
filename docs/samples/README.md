# Test Samples and Golden Files

This directory contains documentation for the test harness samples and golden files used in MFU-WP00-05.

## Current Implementation Status

The harness is currently implemented with a simplified version (`run-local-pipeline-simple.js`) that uses mock handlers for testing purposes. This allows the golden comparison functionality to be fully tested while the actual service handlers are being developed.

**Note**: The full harness (`run-local-pipeline.cjs`) will be available once the service handlers are compatible with the module system.

## Directory Structure

```text
podcast-automation/test-assets/
├── raw/                          # Input video samples
│   └── sample-short.mp4         # Short test video (30 seconds)
└── goldens/                      # Expected outputs (golden files)
    └── sample-short/            # Golden files for sample-short.mp4
        ├── manifest.json        # Selected manifest fields to compare
        ├── metrics.json         # Numeric metrics with tolerances
        ├── transcript.preview.txt # First 200 chars of transcript
        └── _metadata.json       # Schema version, generation info
```

## Adding New Samples

### 1. Add Input Video

Place your test video in `podcast-automation/test-assets/raw/`:

- Use short videos (30-60 seconds) for fast testing
- Supported formats: MP4, MOV, MKV, AVI, M4V, WebM
- Keep file sizes reasonable (< 50MB recommended)

### 2. Generate Golden Files

Run the pipeline on your sample to generate actual outputs:

```bash
node tools/harness/run-local-pipeline.js \
  --input podcast-automation/test-assets/raw/your-sample.mp4 \
  --env dev \
  --tenant t-local \
  --job auto
```

### 3. Create Golden Directory

Create a directory under `podcast-automation/test-assets/goldens/` with the same name as your sample:

```bash
mkdir podcast-automation/test-assets/goldens/your-sample
```

### 4. Author Golden Files

#### metrics.json

Contains numeric metrics with tolerances:

```json
{
  "schemaVersion": "1.0.0",
  "generatedAt": "2025-10-01T12:00:00Z",
  "audio": {
    "durationSec": 30.5,
    "_tolerance": 0.1
  },
  "transcript": {
    "wordCount": 45,
    "_tolerance": 5
  },
  "plan": {
    "cutsCount": 3,
    "_exact": true
  },
  "render": {
    "durationSec": 28.2,
    "_tolerance": 0.1
  }
}
```

#### manifest.json

Contains selected manifest fields for comparison:

```json
{
  "schemaVersion": "1.0.0",
  "env": "dev",
  "tenantId": "t-local",
  "status": "completed",
  "audio": { "codec": "mp3" },
  "transcript": { "language": "en" },
  "plan": { "schemaVersion": "1.0.0" },
  "renders": [
    { "type": "preview", "codec": "h264" }
  ]
}
```

#### transcript.preview.txt

First 200 characters of the transcript, normalized:

```text
This is a sample transcript for testing the harness. It contains about forty-five words to match the expected word count in the metrics. The transcript should be processed correctly by the transcription service and used for cut planning.
```

#### _metadata.json

Optional metadata about the golden:

```json
{
  "schemaVersion": "1.0.0",
  "generatedAt": "2025-10-01T12:00:00Z",
  "ffmpegVersion": "6.0",
  "description": "Sample golden for short test video",
  "inputFile": "your-sample.mp4",
  "duration": "30 seconds"
}
```

## Running Tests

### Basic Test (No Golden Comparison)

```bash
node tools/harness/run-local-pipeline-simple.js \
  --input podcast-automation/test-assets/raw/sample-short.mp4
```

### Test with Golden Comparison

```bash
node tools/harness/run-local-pipeline-simple.js \
  --input podcast-automation/test-assets/raw/sample-short.mp4 \
  --goldens podcast-automation/test-assets/goldens/sample-short
```

### Strict Mode (Exact Matches Only)

```bash
node tools/harness/run-local-pipeline-simple.js \
  --input podcast-automation/test-assets/raw/sample-short.mp4 \
  --goldens podcast-automation/test-assets/goldens/sample-short \
  --strict
```

## Tolerances

The harness supports configurable tolerances for numeric comparisons:

- **Duration tolerances**: ±0.1 seconds (configurable via `GOLDEN_TOLERANCE_SEC`)
- **Word count tolerances**: ±5 words (configurable via `GOLDEN_TOLERANCE_WORDCOUNT`)
- **Exact matches**: Use `_exact: true` in metrics.json or `--strict` flag

## Environment Variables

Configure tolerances via environment variables:

```env
# Test Harness Configuration (WP00-05)
ENABLE_GOLDEN_COMPARISON=false
GOLDEN_TOLERANCE_SEC=0.1
GOLDEN_TOLERANCE_WORDCOUNT=5
```

Add these to your `.env` file or set them as environment variables before running the harness.

## Best Practices

1. **Keep samples small**: Use 30-60 second videos for fast testing
2. **Version control**: Commit both input samples and golden files
3. **Documentation**: Update this README when adding new sample types
4. **Regular updates**: Regenerate goldens when algorithms improve
5. **CI integration**: Run harness tests in CI pipeline

## Troubleshooting

### Golden Comparison Failures

1. Check if actual outputs exist in `storage/{env}/{tenantId}/{jobId}/`
2. Verify golden file formats match the schema
3. Adjust tolerances if needed
4. Use `--strict` mode to identify exact mismatches

### Missing Files

1. Ensure all required golden files exist
2. Check file paths and permissions
3. Verify input video is accessible

### Performance Issues

1. Use smaller test videos
2. Consider using container execution for consistency
3. Monitor memory usage during processing
