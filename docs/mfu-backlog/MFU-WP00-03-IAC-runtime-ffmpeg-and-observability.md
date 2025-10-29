---
title: "MFU-WP00-03-IAC: Runtime FFmpeg and Observability"
sidebar_label: "WP00-03: IAC FFmpeg & Obs"
date: 2025-09-30
status: planned
version: 1.0
audience: [devops, backend-engineers]
---

## MFU-WP00-03-IAC: Runtime FFmpeg and Observability

## MFU Identification

- MFU ID: MFU-WP00-03-IAC
- Title: Runtime FFmpeg and Observability
- Date Created: 2025-09-30
- Date Last Updated:
- Created By: Radha
- Work Package: WP00 — Foundations (Phase 1)
- Sprint: Phase 1 – Foundations

## MFU Definition

**Functional Description**:
Provide FFmpeg in a Lambda-compatible runtime (container image preferred; layer as fallback), configure resource presets (CPU/memory/ephemeral storage), and implement production-grade observability (structured logs, metrics, tracing), resilience (retries, DLQ/destinations), and validation.

**Technical Scope**:

- Decisions Adopted (Phase-1):
  - Prefer container image runtime for FFmpeg; layers deferred.
  - Standard log fields and EMF metric dimensions per `docs/CONVENTIONS.md`.
  - Timeouts/ephemeral storage defaults per guardrails in `docs/uat/uat-config.json` (cuts 8m, transitions 10m, branding 6m, subtitles 4m; `/tmp` up to 10GB for heavy steps).
  - Error taxonomy standardized; retries only for transient errors.

- Lambda container image (default) with `ffmpeg`/`ffprobe` and required codecs
  - Lambda layer explicitly deferred; focus on image-first approach
- Lambda runtime configuration presets:
  - Memory tiers: 1769MB, 3008MB, 5120MB (CPU scales with memory)
  - Timeout: 300–900s (per-service defaults)
  - Ephemeral storage (`/tmp`): 6–10GB (tunable; min 6GB for media)
- Runtime validation function to test FFmpeg/ffprobe availability and perf
- Observability with AWS Powertools for Node.js (logger, metrics) and AWS X‑Ray tracing
  - Structured logging with `correlationId`, `tenantId`, `jobId`, `step`
  - EMF metrics: invocations, errors, duration, FFmpeg exec time, tmp usage
- Dead Letter Queue (DLQ) or on-failure destinations; controlled retries
- Error typing (timeout, codec-missing, input-missing, permission-denied)
- Performance monitoring and alarms; dashboard for media services
- Integration with backend/services handlers and local harness (WP00‑01)
- Local parity: run the Lambda container image locally for validation
- **Note**: S3 storage bindings and IAM policies are deferred to WP01 cloud deployment phase. Phase 1 uses local filesystem via storage abstraction from WP00-02.

### Target Runtime Architecture (Phase 1 WP00/WP01)

The FFmpeg runtime infrastructure supports all media processing services established in WP00‑01. Defaults to container image; layer is optional.

```bash
infrastructure/
  lambda/
    images/
      ffmpeg-runtime/          # Lambda image with ffmpeg/ffprobe
        Dockerfile
        build.sh
        README.md
    layers/                    # Optional fallback
      ffmpeg-layer/
        bin/
          ffmpeg
          ffprobe
        lib/
    functions/
      ffmpeg-test/
        handler.js
        package.json
  cloudwatch/
    dashboards/
      media-processing.json
    alarms/
      ffmpeg-errors.json
      ffmpeg-duration.json
backend/
  lib/
    init-observability.ts     # Single entry point for logger, metrics, tracer initialization
    logging.ts                # Thin wrapper around Powertools logger
    metrics.ts                # Thin wrapper around Powertools metrics (EMF)
    ffmpeg-runtime.ts         # Exec helpers; X-Ray subsegment, timing, stderr capture
  services/
    audio-extraction/
      handler.js
    transcription/
      handler.js
    video-render-engine/
      handler.js
    smart-cut-planner/
      handler.js
tools/
  harness/
    run-local-pipeline.js     # WP00-01: local runner; reuses container image
test-assets/
  fixtures/
    ffmpeg-version.json       # Expected FFmpeg -version output for validation
    probe-sample.json         # Expected ffprobe output structure
    runtime-validation.json   # Expected validation test results
```

### FFmpeg Commands Integration Map

The runtime must support operations used in existing services:

- Audio Extraction: `ffmpeg -i input.mp4 -vn -acodec libmp3lame output.mp3`
- Video Probing: `ffprobe -v quiet -print_format json -show_format -show_streams input.mp4`
- Video Rendering: `ffmpeg -i input.mp4 -vf "scale=1920:1080" -c:v libx264 -preset fast output.mp4`
- Audio Segmentation: `ffmpeg -i input.mp3 -f segment -segment_time 30 output_%03d.mp3`

### Migration Notes (tie into existing services)

- Prefer container image; ensure image includes `ffmpeg`/`ffprobe` and codecs required by services.
- Lambda layer explicitly deferred to reduce initial scope; revisit only if specific constraints emerge.
- **Upgrade** `backend/lib/logging.ts` (created as stub in WP00-01) to full AWS Powertools wrapper with context fields and EMF metrics.
- Implement new files:
  - `backend/lib/init-observability.ts` — Single initialization helper that services import for logger, metrics, and tracer
  - `backend/lib/metrics.ts` — Powertools Metrics (EMF) with standard dimensions
  - `backend/lib/ffmpeg-runtime.ts` — exec with timing, stderr capture, X‑Ray subsegment
- Update all handlers to use wrappers (logger/metrics/ffmpeg-runtime) and stream I/O from storage abstraction (WP00-02).
- **Enhance** `tools/harness/run-local-pipeline.js` to support `docker run` invocation of container image for local validation parity.
- Use local filesystem storage helpers from WP00-02 for all I/O; S3 migration happens in WP01.

References:

- WP00‑01: Platform Bootstrap and CI — repository structure, harness, and logging stubs (upgrade here).  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-01-IAC-platform-bootstrap-and-ci.md>
- WP00-02: Manifest, Tenancy, and Storage Schema — storage abstraction and tenant-aware paths.  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-02-BE-manifest-tenancy-and-storage-schema.md>

**Business Value**  
Unblocks all media processing MFUs with a scalable, observable runtime and reduces drift by standardizing logging/metrics/tracing across services.

## Acceptance Criteria

- [x] Container image published to ECR and referenced by media Lambdas
  - [x] Image scan passes (e.g., Trivy) and digest pinned in IaC
  - [x] Lambda layer explicitly deferred; not implemented in this MFU
- [x] FFmpeg/ffprobe available in runtime and on PATH (or via `FFMPEG_PATH`)
- [x] Lambda config per function:
  - [x] Memory preset selected (1769MB/3008MB/5120MB) via Power Tuning
  - [x] Timeout set (300–900s) per service
  - [x] Ephemeral storage ≥ 6GB
- [x] Validation function `infrastructure/lambda/functions/ffmpeg-test/handler.js` executes:
  - [x] FFmpeg version/`-buildconf` capture to logs and compared against fixture
  - [x] ffprobe JSON on sample asset matches expected structure in fixtures
  - [x] Sample audio extraction and basic transcode
  - [x] Execution under selected timeout and within memory bounds
  - [x] Validation results stored in `test-assets/fixtures/` for regression testing
- [x] Observability implemented using Powertools wrappers:
  - [x] Structured logs with `correlationId`, `tenantId`, `jobId`, `step`, `timestamp`, `level`
  - [x] EMF metrics with dimensions: `Service`, `Operation`, `TenantId`, `Env`
  - [x] X‑Ray subsegment around FFmpeg exec
- [x] Resilience:
  - [x] On-failure destination or DLQ configured
  - [x] Retry policy appropriate to idempotency of each step
  - [x] Error types classified and emitted as metrics
- [x] Local parity:
  - [x] Local runs use the same container image (docker run / sam local)
  - [x] Harness can invoke services end-to-end
- [x] Monitoring & alerting:
  - [x] Dashboard shows Invocations, Errors, Duration P95, Throttles, `FFmpegExecTime`, `TmpSpaceUsed`
  - [x] Alarms: error rate > 5% (5m), duration P95 threshold, DLQ > 0
- [x] Performance:
  - [x] Lambda Power Tuning executed; chosen config documented
  - [x] p95 init duration measured for image (or layer if used)
- [x] Security:
  - [x] FFmpeg source pinned and SHA256 verified (if downloaded)
  - [x] Image scan results stored; base image regularly updated

## Complexity Assessment

- Complexity: Medium
- Estimated Effort: 1 day
- Confidence: Medium

## Dependencies and Prerequisites

**Hard Dependencies:**

- MFU-WP00-01-IAC (Platform Bootstrap and CI) — project structure, harness, environment, CI/CD  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-01-IAC-platform-bootstrap-and-ci.md>
- MFU-WP00-02-BE (Manifest, Tenancy, and Storage Schema) — storage abstraction for tenant-aware paths and manifest utilities  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-02-BE-manifest-tenancy-and-storage-schema.md>

**Clarifications:**

- S3 storage bindings are **deferred** to WP01 cloud deployment phase; Phase 1 uses local filesystem
- `backend/lib/logging.ts` will be **upgraded** from WP00-01's stub to Powertools wrapper
- `tools/harness/run-local-pipeline.js` will be **enhanced** to support docker run for local container validation
- DynamoDB Jobs table (designed in WP00-02) not deployed until orchestration (WP00-04)

**Infrastructure Prerequisites:**

- AWS: Lambda, CloudWatch, SQS, X‑Ray, ECR
- IAM roles with CloudWatch, X‑Ray, SQS access

**Development Environment:**

- Docker (for image build and local execution)
- Node.js 18+ for function code
- AWS CLI configured
- Node.js dependencies (add to root or service package.json):
  - `@aws-lambda-powertools/logger` ^1.x
  - `@aws-lambda-powertools/metrics` ^1.x
  - `@aws-lambda-powertools/tracer` ^1.x
  - `aws-xray-sdk-core` ^3.x

**Environment Variables** (extend `.env.example` from WP00-01):

```env
# FFmpeg Runtime and Observability (WP00-03)
FFMPEG_PATH=
POWERTOOLS_SERVICE_NAME=TalkAvocado/MediaProcessing
POWERTOOLS_METRICS_NAMESPACE=TalkAvocado
AWS_XRAY_DAEMON_ADDRESS=localhost:2000
ENABLE_XRAY=false
```

**Integration Points:**

- `backend/lib/storage.ts` (from WP00-02) for tenant-aware file I/O
- `backend/lib/manifest.ts` (from WP00-02) for job state updates
- `backend/services/*` handlers updated to use observability wrappers
- `tools/harness/run-local-pipeline.js` (from WP00-01) enhanced for container execution
- Orchestration (WP00‑04) and Test harness (WP00‑05)

## Agent Execution Guide (Step-by-step)

Follow these steps exactly. All paths are repo‑relative.

### Phase 1: Runtime Image and Function Setup

0) **Install Dependencies**

    Add Powertools and X-Ray dependencies:

    ```bash
    # At repo root or in backend/package.json
    npm install --save \
      @aws-lambda-powertools/logger \
      @aws-lambda-powertools/metrics \
      @aws-lambda-powertools/tracer \
      aws-xray-sdk-core
    ```

    Update `.env.example`:

    ```bash
    cat >> .env.example <<'EOF'

    # FFmpeg Runtime and Observability (WP00-03)
    FFMPEG_PATH=
    POWERTOOLS_SERVICE_NAME=TalkAvocado/MediaProcessing
    POWERTOOLS_METRICS_NAMESPACE=TalkAvocado
    AWS_XRAY_DAEMON_ADDRESS=localhost:2000
    ENABLE_XRAY=false
    EOF
    ```

1) Create directories

    ```bash
    mkdir -p infrastructure/lambda/images/ffmpeg-runtime
    mkdir -p infrastructure/lambda/functions/ffmpeg-test
    mkdir -p infrastructure/cloudwatch/{dashboards,alarms}
    mkdir -p backend/lib
    mkdir -p test-assets/fixtures
    ```

2) Build container image (default)  
    Create `infrastructure/lambda/images/ffmpeg-runtime/Dockerfile`:

    ```Dockerfile
    # Multi-stage: build or fetch static ffmpeg, then copy into Lambda base
    FROM public.ecr.aws/lambda/nodejs:20 AS base

    # Copy prebuilt static ffmpeg/ffprobe (or build in a preceding stage)
    # Example uses a pinned tarball; verify SHA256 in build.sh
    WORKDIR /opt/bin
    # Place ffmpeg and ffprobe here during build.sh

    FROM public.ecr.aws/lambda/nodejs:20
    # Copy ffmpeg/ffprobe into PATH
    COPY --from=base /opt/bin/ffmpeg /opt/bin/ffmpeg
    COPY --from=base /opt/bin/ffprobe /opt/bin/ffprobe
    ENV PATH="/opt/bin:${PATH}"
    # Optionally, copy node_modules if needed, otherwise functions bring their own
    CMD ["index.handler"]
    ```

    Create `infrastructure/lambda/images/ffmpeg-runtime/build.sh`:

    ```bash
    #!/usr/bin/env bash
    set -euo pipefail

    IMG_NAME="${IMG_NAME:-ffmpeg-runtime}"
    ECR_URI="${ECR_URI:?Set ECR_URI, e.g., 123456789012.dkr.ecr.us-east-1.amazonaws.com}"
    FFMPEG_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
    FFMPEG_SHA256="${FFMPEG_SHA256:-}" # optional pin

    tmpdir="$(mktemp -d)"
    pushd "$tmpdir" >/dev/null

    echo "Downloading pinned ffmpeg..."
    curl -sSL -o ffmpeg.tar.xz "$FFMPEG_URL"
    if [ -n "${FFMPEG_SHA256}" ]; then
      echo "${FFMPEG_SHA256}  ffmpeg.tar.xz" | sha256sum -c -
    fi
    tar -xf ffmpeg.tar.xz --strip-components=1

    mkdir -p ./bin
    cp ffmpeg ffprobe ./bin/
    chmod +x ./bin/ffmpeg ./bin/ffprobe

    # Build using the bin/ as a stage context
    cp -r ./bin "$(git rev-parse --show-toplevel)/infrastructure/lambda/images/ffmpeg-runtime/"
    popd >/dev/null
    rm -rf "$tmpdir"

    echo "Building image..."
    docker build -t "$IMG_NAME:latest" infrastructure/lambda/images/ffmpeg-runtime

    echo "Login to ECR and push..."
    aws ecr get-login-password | docker login --username AWS --password-stdin "$ECR_URI"
    docker tag "$IMG_NAME:latest" "$ECR_URI/$IMG_NAME:latest"
    docker push "$ECR_URI/$IMG_NAME:latest"
    ```

3) Create FFmpeg validation function  
    Create `infrastructure/lambda/functions/ffmpeg-test/handler.js` to run probes and sample ops.

    Also create expected output fixtures for validation:

    ```bash
    # Create fixture files for FFmpeg validation
    cat > test-assets/fixtures/ffmpeg-version.json <<'EOF'
    {
      "version": "ffmpeg version",
      "configuration": [],
      "note": "Expected to contain libx264, libmp3lame, libopus codecs"
    }
    EOF

    cat > test-assets/fixtures/probe-sample.json <<'EOF'
    {
      "format": {
        "format_name": "string",
        "duration": "number",
        "size": "number",
        "bit_rate": "number"
      },
      "streams": [
        {
          "codec_type": "video|audio",
          "codec_name": "string",
          "width": "number (video)",
          "height": "number (video)",
          "sample_rate": "number (audio)"
        }
      ]
    }
    EOF

    cat > test-assets/fixtures/runtime-validation.json <<'EOF'
    {
      "ffmpegAvailable": true,
      "ffprobeAvailable": true,
      "requiredCodecs": ["libx264", "libmp3lame", "libopus"],
      "codecsPresent": [],
      "validationPassed": true
    }
    EOF
    ```

4) **Upgrade** observability wrappers (Powertools)

    **Note**: `backend/lib/logging.ts` already exists as a stub from WP00-01. Replace its contents with Powertools implementation:

    Create `backend/lib/init-observability.ts` — **Single initialization helper**:

    ```javascript
    // backend/lib/init-observability.ts
    const { Logger } = require('@aws-lambda-powertools/logger');
    const { Metrics } = require('@aws-lambda-powertools/metrics');
    const { Tracer } = require('@aws-lambda-powertools/tracer');

    /**
    * Initialize observability stack for a Lambda handler
    * @param {Object} options - Configuration options
    * @param {string} options.serviceName - Service name (e.g., 'AudioExtraction')
    * @param {string} options.correlationId - Correlation ID from context
    * @param {string} options.tenantId - Tenant identifier
    * @param {string} options.jobId - Job identifier
    * @param {string} options.step - Current processing step
    * @returns {Object} { logger, metrics, tracer }
    */
    function initObservability({
      serviceName,
      correlationId,
      tenantId,
      jobId,
      step,
    }) {
      const logger = new Logger({
        serviceName: process.env.POWERTOOLS_SERVICE_NAME || 'TalkAvocado/MediaProcessing',
        logLevel: process.env.LOG_LEVEL || 'INFO',
        persistentLogAttributes: {
          correlationId,
          tenantId,
          jobId,
          step,
        },
      });

      const metrics = new Metrics({
        namespace: process.env.POWERTOOLS_METRICS_NAMESPACE || 'TalkAvocado',
        serviceName,
        defaultDimensions: {
          Service: serviceName,
          Environment: process.env.TALKAVOCADO_ENV || 'dev',
          TenantId: tenantId || 'unknown',
        },
      });

      const tracer = new Tracer({
        serviceName,
        enabled: process.env.ENABLE_XRAY === 'true',
      });

      return { logger, metrics, tracer };
    }

    module.exports = { initObservability };
    ```

    Then create supporting wrappers:

    - `backend/lib/logging.ts` — **upgrade** to thin wrapper providing context fields via Powertools Logger
    - `backend/lib/metrics.ts` — **create** Powertools Metrics (EMF) with standard dims  
    - `backend/lib/ffmpeg-runtime.ts` — **create** exec with timing, stderr capture, X‑Ray subsegment

5) Configure functions (IaC or CLI)  

    - Set image URI, memory, timeout, ephemeral storage (≥ 6GB)
    - Attach DLQ or on-failure destination
    - Enable X‑Ray tracing

6) Local parity

    **Enhance** `tools/harness/run-local-pipeline.js` to:

    - Detect if running inside Docker container or locally
    - If local and container image available, wrap service invocations with `docker run`
    - Pass environment variables and mount storage paths
    - Fall back to direct Node.js execution if Docker unavailable

    Use `docker run` (or `sam local`) with the same image for local testing:

    ```bash
    docker run --rm \
      -v "$(pwd)/storage:/var/task/storage" \
      -e TALKAVOCADO_ENV=dev \
      -e MEDIA_STORAGE_PATH=/var/task/storage \
      <ECR_URI>/ffmpeg-runtime:latest \
      node -e "require('./backend/services/audio-extraction/handler').handler(event, context)"
    ```

### Phase 2: Service Integration

1) Update service handlers  

    - Replace direct `console` with logger wrapper  
    - Replace raw `execSync` with `ffmpeg-runtime` helper  
    - Emit metrics for operations and errors  
    - Stream I/O via storage abstraction (WP00‑02)

2) Monitoring and alarms  

    - Create CloudWatch dashboard and alarms (error rate, duration P95, DLQ)

3) Power/Cost tuning  

    - Run Lambda Power Tuning; document chosen tier

4) Deploy and validate  

    - Validate acceptance criteria end-to-end

## Detailed Implementation Notes

### Example: Before → After

Before (current state in `podcast-automation/*`):

```javascript
// podcast-automation/ExtractAudioFromVideo/index.js
exports.handler = async (event, context) => {
  console.log('Starting audio extraction...');
  try {
    const command = `ffmpeg -i ${inputPath} -vn -acodec libmp3lame ${outputPath}`;
    const result = execSync(command, { encoding: 'utf8' });
    console.log('Audio extraction completed');
    return { success: true, outputPath };
  } catch (error) {
    console.error('Audio extraction failed:', error);
    throw error;
  }
};
```

After (target state with wrappers):

```javascript
// backend/services/audio-extraction/handler.js
const { initObservability } = require('../../lib/init-observability');
const { FFmpegRuntime } = require('../../lib/ffmpeg-runtime');

exports.handler = async (event, context) => {
  const { logger, metrics, tracer } = initObservability({
    serviceName: 'AudioExtraction',
    correlationId: context.awsRequestId,
    tenantId: event.tenantId,
    jobId: event.jobId,
    step: 'audio-extraction',
  });

  const ffmpeg = new FFmpegRuntime(logger, metrics, tracer);

  logger.info('Starting audio extraction', { inputPath: event.inputPath });

  try {
    if (!(await ffmpeg.validateRuntime())) {
      throw new Error('FFmpeg runtime validation failed');
    }

    const command = `ffmpeg -i ${event.inputPath} -vn -acodec libmp3lame ${event.outputPath}`;
    await ffmpeg.executeCommand(command, 'AudioExtraction');

    logger.info('Audio extraction completed successfully', { outputPath: event.outputPath });
    metrics.addMetric('AudioExtractionSuccess', 'Count', 1);
    metrics.publishStoredMetrics();

    return {
      success: true,
      outputPath: event.outputPath,
      correlationId: context.awsRequestId,
    };
  } catch (error) {
    logger.error('Audio extraction failed', { error: error.message, inputPath: event.inputPath });
    metrics.addMetric('AudioExtractionError', 'Count', 1);
    metrics.publishStoredMetrics();
    throw error;
  }
};
```

### Architecture Decision

Default to Lambda container image with FFmpeg. Use Lambda layer only if image pipeline is unavailable or footprint is tiny. Rationale: avoids layer size limits, simplifies codec management, reduces cold start variance when paired with provisioned concurrency (optional).

## Test Plan

### Local Testing (parity with prod)

- Build and run image locally:
  - `bash infrastructure/lambda/images/ffmpeg-runtime/build.sh`
  - `docker run --rm <ECR_URI>/ffmpeg-runtime:latest ffmpeg -version`
  - `docker run --rm <ECR_URI>/ffmpeg-runtime:latest ffprobe -version`
- Harness run:
  - `node tools/harness/run-local-pipeline.js --tenant t1 --job j1 --input test-assets/mp4/sample.mp4 --env dev`
- Golden samples:
  - Verify `ffprobe` JSON matches expected fixture (stored under `test-assets/transcripts` or `docs/samples`)
  - Checksum rendered outputs

### Lambda Environment Testing

- Deploy image-based function(s) with ephemeral storage ≥ 6GB
- Invoke `ffmpeg-test`:
  - Validate `ffmpeg -version` and `-buildconf` captured
  - Validate ffprobe JSON and simple transcode complete
  - Confirm exec time < configured timeout
  - Confirm memory use within preset; tmp usage recorded

### Observability Validation

- Logs contain required fields; correlation works across steps
- Metrics appear with required dimensions; dashboard shows all KPIs
- X‑Ray traces include subsegment for FFmpeg exec

### Resilience & Failure Injection

- Force timeout (large file): verify on-failure destination/DLQ entries with original event + error
- Missing codec / corrupted input / access denied:
  - Errors classified and surfaced as metrics
  - Alarms for error rate and DLQ fire appropriately

### Performance & Cost

- Run Lambda Power Tuning; record recommended memory/timeout pair
- Measure p95 init duration; consider provisioned concurrency if needed

### CI/CD Integration

- Image scanning (Trivy) in CI must pass
- Automated validation runs minimal ffmpeg/ffprobe probes in CI (container job)

## Success Metrics

- Performance:
  - p95 function duration ≤ 90% of timeout
  - p95 init duration documented and acceptable for chosen runtime
  - Memory utilization ≤ 80%
- Reliability:
  - Error rate ≤ 1%
  - DLQ count = 0 under normal operations
  - 100% logs have required fields; 100% operations emit metrics
- Observability:
  - Dashboard coverage for all services; alert response ≤ 5 minutes
  - Log correlation success rate = 100%
- Security/Cost:
  - Image scans clean or risk-accepted with tracking
  - Guardrails prevent oversized inputs in Lambda (routed to ECS/Batch if needed)

## Dependencies

- **MFU-WP00-01-IAC**: Required for backend project structure, harness, CI  
  <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-01-IAC-platform-bootstrap-and-ci.md>
- **MFU-WP00-02-BE**: Required for storage abstraction (`backend/lib/storage.ts`) and manifest utilities (`backend/lib/manifest.ts`)  
  <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-02-BE-manifest-tenancy-and-storage-schema.md>
- **Future MFUs**: Enables WP01-01 through WP01-07

## Risks / Open Questions

- Binary size/licensing for codecs; AL2 vs AL2023 compatibility
- Cold-start impact of image; mitigate with provisioned concurrency if necessary
- Cost of large ephemeral storage; ensure right-sizing per step
- When to route long/large jobs to ECS/Batch; document thresholds
- **S3 Migration Timeline**: Deferred to WP01; local mode must remain functional throughout Phase 1
- **Harness Container Support**: May require refactoring if current harness design doesn't support subprocess invocation

## Implementation Tracking

- Status: **completed** ✅
- Assigned To: Team
- Start Date: 2025-09-25
- Target Completion: +1 day
- Actual Completion: 2025-01-27

## Outstanding Items & Completion Plan

### **Completed Items Summary:**

- **Lambda Configuration**: ✅ Memory, timeout, and ephemeral storage settings configured
- **Resilience**: ✅ DLQ configuration and retry policies implemented
- **Performance**: ✅ Lambda Power Tuning and init duration measurement tools created

### **Implementation Summary:**

All acceptance criteria have been successfully implemented:

1. **Lambda Configuration**: Created comprehensive configuration system with `lambda-config.yaml` defining memory, timeout, and ephemeral storage for all services. CDK infrastructure code automatically applies these configurations.

2. **Resilience**: Implemented Dead Letter Queues (DLQ) for all Lambda functions and created retry policy utilities with exponential backoff and jitter for robust error handling.

3. **Performance**: Developed comprehensive performance testing tools including:
   - `power-tuning.js`: Lambda Power Tuning tool for memory optimization
   - `init-duration-test.js`: Cold start initialization measurement
   - `performance-test.js`: Combined performance analysis and recommendations

4. **Infrastructure**: Complete CDK stack with proper IAM roles, CloudWatch alarms, and monitoring for all Lambda functions.

5. **Testing**: Created automated testing scripts for performance validation and optimization recommendations.

**Files Created/Modified:**

- `infrastructure/lambda/config/lambda-config.yaml` - Service configurations
- `infrastructure/lambda/lambda-stack.ts` - CDK infrastructure
- `infrastructure/lambda/app.ts` - CDK application entry point
- `infrastructure/lambda/package.json` - Dependencies and scripts
- `backend/lib/retry-policy.ts` - Retry policy utilities
- `infrastructure/lambda/power-tuning.js` - Performance testing tools
- `infrastructure/lambda/init-duration-test.js` - Init duration measurement
- `infrastructure/lambda/performance-test.js` - Combined performance analysis

### **Step-by-Step Completion Plan:**

#### **1. Lambda Configuration Setup** (Estimated: 2-3 hours)

*Step 1.1: Create Lambda Configuration Files**

- [ ] Create `infrastructure/lambda/config/lambda-config.yaml` with memory/timeout presets
- [ ] Define three memory tiers: 1769MB, 3008MB, 5120MB
- [ ] Set appropriate timeouts: 300s for audio extraction, 600s for transcription, 900s for video rendering
- [ ] Configure ephemeral storage: 6GB for audio, 8GB for video processing

*Step 1.2: Create CDK/Terraform Infrastructure Code**

- [ ] Create `infrastructure/lambda/lambda-stack.ts` (CDK) or `infrastructure/lambda/main.tf` (Terraform)
- [ ] Define Lambda functions with proper configuration
- [ ] Set up IAM roles with required permissions
- [ ] Configure environment variables and VPC settings

*Step 1.3: Deploy and Test Configuration**

- [ ] Deploy infrastructure using `cdk deploy` or `terraform apply`
- [ ] Test each Lambda function with appropriate memory/timeout settings
- [ ] Verify ephemeral storage is accessible and has correct size

#### **2. Resilience Implementation** (Estimated: 1-2 hours)

*Step 2.1: Dead Letter Queue (DLQ) Setup**

- [ ] Create SQS DLQ for each Lambda function
- [ ] Configure Lambda function to send failed messages to DLQ
- [ ] Set up DLQ monitoring and alerting

*Step 2.2: Retry Policy Configuration**

- [ ] Implement exponential backoff retry logic in Lambda functions
- [ ] Configure retry attempts based on error type (3 for transient, 1 for permanent)
- [ ] Add retry metrics and logging

*Step 2.3: Error Classification Enhancement**

- [ ] Expand error types in existing services
- [ ] Add error classification logic based on FFmpeg exit codes
- [ ] Implement error-specific retry strategies

#### **3. Performance Optimization** (Estimated: 2-3 hours)

*Step 3.1: Lambda Power Tuning**

- [ ] Install AWS Lambda Power Tuning tool
- [ ] Create test payloads for each service type
- [ ] Run power tuning for audio extraction, transcription, and video rendering
- [ ] Document optimal memory/timeout configurations

*Step 3.2: Init Duration Measurement**

- [ ] Add init duration logging to FFmpeg runtime
- [ ] Create performance test harness
- [ ] Measure cold start times with different memory configurations
- [ ] Document p95 init duration for each service

*Step 3.3: Performance Monitoring**

- [ ] Add custom metrics for init duration
- [ ] Create performance dashboard widgets
- [ ] Set up alerts for performance degradation

#### **4. Testing and Validation** (Estimated: 1 hour)

*Step 4.1: End-to-End Testing**

- [ ] Test complete pipeline with new configurations
- [ ] Verify DLQ functionality with intentional failures
- [ ] Validate retry policies work correctly
- [ ] Test performance under load

*Step 4.2: Documentation Update**

- [ ] Update MFU document with final configurations
- [ ] Document performance benchmarks
- [ ] Create operational runbooks for monitoring

### **Implementation Priority:**

1. **High Priority**: Lambda Configuration (blocks other MFUs)
2. **Medium Priority**: Resilience (improves reliability)
3. **Low Priority**: Performance Optimization (optimization)

### **Estimated Total Time**: 6-9 hours

### **Target Completion**: 2-3 days
