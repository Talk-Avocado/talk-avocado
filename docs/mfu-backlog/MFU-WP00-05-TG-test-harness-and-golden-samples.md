---
title: "MFU-WP00-05-TG: Test Harness and Golden Samples"
sidebar_label: "WP00-05: TG Harness & Goldens"
date: 2025-10-01
status: completed
version: 1.0
audience: [developers, qa]
---

## MFU-WP00-05-TG: Test Harness and Golden Samples

## MFU Identification

- MFU ID: MFU-WP00-05-TG
- Title: Test Harness and Golden Samples
- Date Created: 2025-10-01
- Date Last Updated: 2025-10-30
- Created By: Radha
- Work Package: WP00 — Foundations (Phase 1)
- Sprint: Phase 1 – Foundations

## MFU Definition

**Functional Description**:
Provide a curated media set with expected outputs (goldens) and a small e2e smoke test runner to validate the pipeline.

**Technical Scope**:

### Decisions Adopted (Phase-1)

- Harness lanes: `--lane cuts`, `--lane transitions`, `--lane edit` (cuts → transitions), and `--negative-tests` to assert cross-tenant access is blocked.
- Event payloads sent by harness exactly match ASL Task inputs defined in `docs/CONVENTIONS.md`.
- Golden tolerances and timeouts are read from `docs/uat/uat-config.json`.

- Curate short media samples (mp4/mov)
- Expected outputs: durations, basic transcripts, cut plans
- CLI runner to execute pipeline on samples and compare key metrics. Add lanes:
  - `--lane cuts` (runs cuts only, produces `renders/base_cuts.mp4`)
  - `--lane transitions` (runs transitions on top of cuts, produces `renders/with_transitions.mp4`)
  - `--lane edit` (cuts → optional transitions)
  - `--negative-tests` (assert cross-tenant access is blocked)

**Business Value**  
Gives fast feedback on regressions and validates MFUs end-to-end with minimal runtime.

### Target Harness Architecture (Phase 1 WP00/WP01)

```bash
tools/
  harness/
    run-local-pipeline.js     # Non-interactive runner (replaces interactive script)
    compare-goldens.js        # Compares outputs under storage/ to goldens with tolerances
docs/
  samples/
    README.md                 # How to add new samples and goldens
podcast-automation/
  test-assets/
    raw/                      # Input samples (temporary in WP01)
    goldens/                  # Golden expectations (see schema below)
      <sample-name>/
        manifest.json         # Selected subset to compare
        metrics.json          # Duration, word count, cuts, render metrics
        transcript.preview.txt
        _metadata.json        # Schema version, generation date
storage/                      # Local root: {env}/{tenantId}/{jobId}/...
```

### Migration Notes (replace interactive runner)

- Replace `podcast-automation/run-workflow.js` with `tools/harness/run-local-pipeline.js`:
  - Non-interactive CLI flags: `--env dev --tenant t-local --job auto --input <path>`
  - Seeds `./storage/{env}/{tenant}/{job}/input/` and invokes handlers via their module paths:
    - `backend/services/audio-extraction/handler.js`
    - `backend/services/transcription/handler.js`
    - `backend/services/smart-cut-planner/handler.js`
    - `backend/services/video-render-engine/handler.js`
  - Runs to completion with exit code 0/1 and concise stdout summary
- Goldens live under `podcast-automation/test-assets/goldens/` during WP01, but compare against outputs in `./storage/{env}/{tenant}/{job}/...` so pathing matches production layout.
- **Deprecation**: Existing `podcast-automation/run-workflow.js` should be archived or removed after migration validation; document the transition in `docs/ROADMAP.md`.

### Harness CLI Contract

**Flags:**

- `--env <dev|stage|prod>` — Target environment (default: `dev`)
- `--tenant <tenantId>` — Tenant identifier (default: `t-local`)
- `--job <jobId|auto>` — Job ID; `auto` generates a UUID (default: `auto`)
- `--input <path-to-video>` — Path to input video file (required)
- `--goldens <path>` — Path to golden directory for comparison (optional)
- `--strict` — Disable numeric tolerances; require exact matches (default: `false`)

**Defaults:**

- `--env dev --tenant t-local --job auto` (auto generates UUID)

**Behavior:**

- Seeds `./storage/{env}/{tenant}/{job}/input/` with the provided input
- Invokes handlers in order (audio → transcription → plan → cuts → [Choice] transitions → subtitles → branding)
- Writes artifacts under canonical keys and updates manifest
- If `--goldens` provided, runs `compare-goldens` and exits non-zero on mismatch
- On handler error: logs error, updates manifest status to `failed`, and exits non-zero
- Prints concise summary and per-check diff on failure

**Examples:**

```bash
# Basic run without golden comparison
node tools/harness/run-local-pipeline.js \
  --input podcast-automation/test-assets/raw/sample.mp4

# Full run with golden comparison
node tools/harness/run-local-pipeline.js \
  --env dev \
  --tenant t-local \
  --job auto \
  --input podcast-automation/test-assets/raw/sample.mp4 \
  --goldens podcast-automation/test-assets/goldens/sample

# Strict mode (exact matches only)
node tools/harness/run-local-pipeline.js \
  --input test.mp4 \
  --goldens goldens/test \
  --strict
```

### Golden Samples Format

Each golden sample directory contains:

- `manifest.json` — Selected fields only (deep-compare subset)
- `metrics.json` — Numeric metrics with tolerances applied (unless `--strict`)
  - `audio.durationSec`
  - `transcript.wordCount`
  - `plan.cutsCount`
  - `render.durationSec`
- `transcript.preview.txt` — First 200 chars, normalized whitespace
- `_metadata.json` — Optional: schema version, generation date, FFmpeg version used

Example `metrics.json` (tolerances applied where noted):

```json
{
  "schemaVersion": "1.0.0",
  "generatedAt": "2025-09-25T12:00:00Z",
  "audio": {
    "durationSec": 123.4,
    "_tolerance": 0.1
  },
  "transcript": {
    "wordCount": 1520,
    "_tolerance": 5
  },
  "plan": {
    "cutsCount": 18,
    "_exact": true
  },
  "render": {
    "durationSec": 123.3,
    "_tolerance": 0.1
  }
}
```

Manifest subset example (only specified fields are compared):

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

**Note**: `jobId` and timestamp fields are excluded from comparison as they vary per run.

## Acceptance Criteria

- [x] `tools/harness/run-local-pipeline.js` runs end-to-end non-interactively
- [x] Canonical outputs written under `./storage/{env}/{tenantId}/{jobId}/...`
- [x] `tools/harness/compare-goldens.js` compares against goldens with:
  - [x] Numeric tolerances (durations ±0.1s)
  - [x] Subset JSON equality for manifest fields
  - [x] Normalized text comparison for transcript preview
- [x] Pass/fail summary printed; mismatches show concise diffs
- [x] Exit code is non-zero on any mismatch (CI-suitable)
- [x] Sample goldens provided for 1–2 short inputs
- [x] `--strict` flag implemented and documented
- [x] Error handling: handler failures update manifest and exit non-zero
- [x] CI job added that runs harness on sample and compares goldens

## Complexity Assessment

- Complexity: Medium
- Estimated Effort: 1 day
- Confidence: Medium

## Dependencies and Prerequisites

Hard dependencies (Phase 1 local-first):

- MFU‑WP00‑01‑IAC (repo scaffolding, harness baseline, env conventions)  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-01-IAC-platform-bootstrap-and-ci.md>
- MFU‑WP00‑02‑BE (manifest, tenancy, storage abstraction)  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-02-BE-manifest-tenancy-and-storage-schema.md>

Recommended but not required to start:

- MFU‑WP00‑03‑IAC (FFmpeg runtime and observability wrappers)  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-03-IAC-runtime-ffmpeg-and-observability.md>
- MFU‑WP00‑04‑MW (orchestration skeleton) — for future wiring; harness can run locally without it  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-04-MW-orchestration-skeleton-and-job-status-api.md>

**Environment Variables** (extend `.env.example` from WP00-01):

```env
# Test Harness Configuration (WP00-05)
ENABLE_GOLDEN_COMPARISON=false
GOLDEN_TOLERANCE_SEC=0.1
GOLDEN_TOLERANCE_WORDCOUNT=5
```

## Agent Execution Guide (Step-by-step)

Follow these steps exactly. All paths are repo‑relative.

1) Ensure directories exist

    - Create or verify:
      - `tools/harness/`
      - `docs/samples/`
      - `podcast-automation/test-assets/raw/`
      - `podcast-automation/test-assets/goldens/`

2) Implement non-interactive runner

    - Create `tools/harness/run-local-pipeline.js` that:
      - Parses flags: `--env`, `--tenant`, `--job`, `--input`, `--goldens`, `--strict`
      - Seeds input under storage via helpers from WP00‑02
      - Invokes handlers in order using their module paths
      - Updates manifest after each step
      - Prints a concise summary

    **Implementation skeleton:**

    ```javascript
    #!/usr/bin/env node
    // tools/harness/run-local-pipeline.js
    const { parseArgs } = require('node:util');
    const { readFileSync, copyFileSync } = require('node:fs');
    const { v4: uuidv4 } = require('uuid');
    const { keyFor, pathFor, writeFileAtKey, ensureDirForFile } = require('../../backend/lib/storage');
    const { saveManifest, loadManifest } = require('../../backend/lib/manifest');

    async function main() {
      // Parse CLI arguments
      const { values } = parseArgs({
        options: {
          env: { type: 'string', default: 'dev' },
          tenant: { type: 'string', default: 't-local' },
          job: { type: 'string', default: 'auto' },
          input: { type: 'string' },
          goldens: { type: 'string' },
          strict: { type: 'boolean', default: false }
        }
      });

      if (!values.input) {
        console.error('Error: --input is required');
        process.exit(1);
      }

      const jobId = values.job === 'auto' ? uuidv4() : values.job;
      const env = values.env;
      const tenantId = values.tenant;

      console.log(`[harness] Starting pipeline: env=${env}, tenant=${tenantId}, job=${jobId}`);

      // 1. Seed input
      const inputKey = keyFor(env, tenantId, jobId, 'input', require('path').basename(values.input));
      const inputPath = pathFor(inputKey);
      ensureDirForFile(inputPath);
      copyFileSync(values.input, inputPath);
      console.log(`[harness] Input seeded: ${inputKey}`);

      // 2. Create initial manifest
      const manifest = {
        schemaVersion: '1.0.0',
        env,
        tenantId,
        jobId,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        input: {
          sourceKey: inputKey,
          originalFilename: require('path').basename(values.input),
          bytes: readFileSync(values.input).length,
          mimeType: 'video/mp4'
        }
      };
      saveManifest(env, tenantId, jobId, manifest);
      console.log(`[harness] Manifest created`);

      // 3. Invoke handlers in sequence
      const handlers = [
        { name: 'audio-extraction', path: '../../backend/services/audio-extraction/handler' },
        { name: 'transcription', path: '../../backend/services/transcription/handler' },
        { name: 'smart-cut-planner', path: '../../backend/services/smart-cut-planner/handler' },
        { name: 'video-render-engine', path: '../../backend/services/video-render-engine/handler' }
      ];

      for (const handler of handlers) {
        try {
          console.log(`[harness] Running ${handler.name}...`);
          const { handler: fn } = require(handler.path);
          const event = { env, tenantId, jobId, inputPath };
          const context = { awsRequestId: `local-${Date.now()}` };
          await fn(event, context);
          console.log(`[harness] ✓ ${handler.name} completed`);
        } catch (error) {
          console.error(`[harness] ✗ ${handler.name} failed:`, error.message);
          // Update manifest status to failed
          const m = loadManifest(env, tenantId, jobId);
          m.status = 'failed';
          m.updatedAt = new Date().toISOString();
          saveManifest(env, tenantId, jobId, m);
          process.exit(1);
        }
      }

      // 4. Mark completed
      const finalManifest = loadManifest(env, tenantId, jobId);
      finalManifest.status = 'completed';
      finalManifest.updatedAt = new Date().toISOString();
      saveManifest(env, tenantId, jobId, finalManifest);

      console.log(`[harness] Pipeline completed successfully`);

      // 5. Compare goldens if provided
      if (values.goldens) {
        console.log(`[harness] Comparing against goldens: ${values.goldens}`);
        const { compareGoldens } = require('./compare-goldens');
        const passed = await compareGoldens({
          actualPath: pathFor(keyFor(env, tenantId, jobId)),
          goldensPath: values.goldens,
          strict: values.strict
        });
        if (!passed) {
          console.error('[harness] Golden comparison FAILED');
          process.exit(1);
        }
        console.log('[harness] Golden comparison PASSED');
      }

      console.log(`[harness] Job complete: ${jobId}`);
    }

    main().catch(err => {
      console.error('[harness] Fatal error:', err);
      process.exit(1);
    });
    ```

3) Implement goldens comparator

    - Create `tools/harness/compare-goldens.js` that:
      - Loads actuals from storage and goldens from `podcast-automation/test-assets/goldens/<sample>/...`
      - Compares metrics with tolerances; compares manifest subset and transcript preview
      - Prints diffs and returns non-zero on mismatch

    **Implementation skeleton:**

    ```javascript
    // tools/harness/compare-goldens.js
    const { readFileSync, existsSync } = require('node:fs');
    const { join } = require('node:path');

    function loadJSON(path) {
      if (!existsSync(path)) return null;
      return JSON.parse(readFileSync(path, 'utf-8'));
    }

    function compareWithTolerance(actual, expected, tolerance, strict) {
      if (strict || tolerance === undefined) {
        return actual === expected;
      }
      return Math.abs(actual - expected) <= tolerance;
    }

    function compareMetrics(actualManifest, goldenMetrics, strict) {
      const failures = [];

      // Audio duration
      if (goldenMetrics.audio) {
        const actual = actualManifest.audio?.durationSec;
        const expected = goldenMetrics.audio.durationSec;
        const tolerance = strict ? 0 : (goldenMetrics.audio._tolerance || parseFloat(process.env.GOLDEN_TOLERANCE_SEC || '0.1'));
        if (!compareWithTolerance(actual, expected, tolerance, strict)) {
          failures.push(`audio.durationSec: expected ${expected} (±${tolerance}), got ${actual}`);
        }
      }

      // Transcript word count (derive from actual transcript file)
      // Plan cuts count
      // Render duration
      // ... similar logic for other metrics

      return failures;
    }

    function compareManifestSubset(actual, golden) {
      const failures = [];
      
      for (const [key, expectedValue] of Object.entries(golden)) {
        // Skip jobId, timestamps
        if (['jobId', 'createdAt', 'updatedAt'].includes(key)) continue;
        
        const actualValue = actual[key];
        if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
          failures.push(`manifest.${key}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`);
        }
      }

      return failures;
    }

    async function compareGoldens({ actualPath, goldensPath, strict }) {
      console.log('[compare] Loading actuals and goldens...');

      const actualManifest = loadJSON(join(actualPath, 'manifest.json'));
      const goldenManifest = loadJSON(join(goldensPath, 'manifest.json'));
      const goldenMetrics = loadJSON(join(goldensPath, 'metrics.json'));

      if (!actualManifest) {
        console.error('[compare] Actual manifest not found');
        return false;
      }

      let allFailures = [];

      if (goldenMetrics) {
        const metricFailures = compareMetrics(actualManifest, goldenMetrics, strict);
        allFailures = allFailures.concat(metricFailures);
      }

      if (goldenManifest) {
        const manifestFailures = compareManifestSubset(actualManifest, goldenManifest);
        allFailures = allFailures.concat(manifestFailures);
      }

      if (allFailures.length > 0) {
        console.error('[compare] Mismatches found:');
        allFailures.forEach(f => console.error(`  - ${f}`));
        return false;
      }

      console.log('[compare] All checks passed');
      return true;
    }

    module.exports = { compareGoldens };
    ```

4) Add sample goldens

    - Place one or two short inputs under `podcast-automation/test-assets/raw/`
    - Author corresponding goldens under `podcast-automation/test-assets/goldens/<sample>/`
    - Document guidance in `docs/samples/README.md`

5) Wire CLI

    - `run-local-pipeline.js` optionally calls `compare-goldens.js` when `--goldens` is provided
    - Ensure exit code reflects pass/fail

6) Add CI integration

    - Update `.github/workflows/ci.yml` to add a test harness job:

    ```yaml
      harness:
        runs-on: ubuntu-latest
        needs: [node]  # Run after Node lane
        steps:
          - uses: actions/checkout@v4
          - uses: actions/setup-node@v4
            with:
              node-version: '20'
              cache: 'npm'
          - name: Install deps
            run: npm ci || npm install
          - name: Run harness on golden sample
            run: |
              node tools/harness/run-local-pipeline.js \
                --input podcast-automation/test-assets/raw/sample-short.mp4 \
                --goldens podcast-automation/test-assets/goldens/sample-short \
                --env dev
          - name: Upload artifacts on failure
            if: failure()
            uses: actions/upload-artifact@v4
            with:
              name: harness-outputs
              path: storage/
    ```

    **Note**: For larger test assets, consider using Git LFS or downloading from a release artifact.

7) Update environment example

    - Add to `.env.example`:

    ```env
    # Test Harness Configuration (WP00-05)
    ENABLE_GOLDEN_COMPARISON=false
    GOLDEN_TOLERANCE_SEC=0.1
    GOLDEN_TOLERANCE_WORDCOUNT=5
    ```

## Test Plan

### Local

- Run the harness on 1–2 short samples; expect pass/fail summary
- Intentionally alter an output to verify failure path and diff readability
- Run 50 times on same input with unchanged golden; track false positive rate (target: 0)

### CI

- Add a CI job that runs the harness on a tiny sample and compares against goldens
- Ensure non-zero exit fails the pipeline
- Verify CI artifacts uploaded on failure for debugging

## Success Metrics

- Harness runtime < 5 minutes per sample
- Deterministic pass/fail across runs
- False positive rate ≈ 0 over 50 runs
- Adding a new sample+goldens requires ≤ 10 minutes of authoring effort

**Acceptance Test for Success Metrics:**

- Run harness 50 consecutive times on unchanged golden sample
- Count failures (expect 0)
- Time 3 sample additions by new team member; average should be ≤ 10 minutes

## Dependencies

See "Dependencies and Prerequisites" section above for full details.

## Risks / Open Questions

- Drift: Goldens becoming stale as algorithms improve — mitigate with versioned goldens and review gates
- Platform variance: FFmpeg versions can alter durations slightly — tolerate via small numeric deltas
- Environment parity: Local vs containerized execution differences — prefer running via container image when available (see WP00‑03)
- Storage layout changes: Shield comparisons behind manifest helpers from WP00‑02
- CI test asset storage: Small samples in Git acceptable; large samples need Git LFS or external storage
- Handler interface changes: If event shapes change, harness must be updated in lockstep

## Related MFUs

- MFU‑WP00‑01‑IAC: Platform Bootstrap and CI  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-01-IAC-platform-bootstrap-and-ci.md>
- MFU‑WP00‑02‑BE: Manifest, Tenancy, and Storage Schema  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-02-BE-manifest-tenancy-and-storage-schema.md>
- MFU‑WP00‑03‑IAC: Runtime FFmpeg and Observability  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-03-IAC-runtime-ffmpeg-and-observability.md>
- MFU‑WP00‑04‑MW: Orchestration Skeleton and Job Status API  
  See: <https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-04-MW-orchestration-skeleton-and-job-status-api.md>

## Implementation Tracking

- Status: completed
- Assigned To: Team
- Start Date: 2025-09-25
- Target Completion: +1 day
- Actual Completion: 2025-10-30

## Outstanding Items and Completion Plan

- None. All acceptance criteria are met on branch `MFU-WP00-05-TG-test-harness-and-golden-samples`.
