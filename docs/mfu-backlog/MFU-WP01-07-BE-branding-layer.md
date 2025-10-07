---
title: "MFU-WP01-07-BE: Branding Layer"
sidebar_label: "WP01-07: BE Branding Layer"
date: 2025-10-01
status: planned
version: 1.0
audience: [backend-engineers]
---

## MFU-WP01-07-BE: Branding Layer

## MFU Identification

- MFU ID: MFU-WP01-07-BE
- Title: Branding Layer
- Date Created: 2025-10-01
- Date Last Updated: 2025-10-01
- Created By: Radha
- Work Package: WP01 — POC Pipeline
- Sprint: Phase 1 – Pipeline

## MFU Definition

**Functional Description**  
Apply tenant-configurable branding elements (intro/outro videos, logo overlays, watermarks) to the final edited video, producing a polished, branded output suitable for demos and stakeholder presentations. Handles asset management, timing synchronization, and maintains audio/video quality while adding professional branding elements.

**Technical Scope**

- Inputs:
  - `renders/with_transitions.mp4` (or `base_cuts.mp4` if transitions not applied)
  - `subtitles/final.srt` and `subtitles/final.vtt` (if available)
  - Tenant branding configuration from manifest or environment
- Output:
  - `renders/final_poc.mp4` with applied branding
  - Optional: `renders/branding-log.json` with processing details and asset timings
- Branding elements:
  - Intro video: configurable duration, fade-in/out transitions
  - Outro video: configurable duration, fade-in/out transitions  
  - Logo overlay: optional watermark with configurable position, size, opacity, duration
  - Audio branding: intro/outro audio tracks with crossfade transitions
- Quality preservation:
  - Maintain original video codec, fps, and resolution
  - Preserve audio quality and loudness levels
  - Ensure subtitle timing remains synchronized
- Tenant configuration:
  - Branding assets stored per tenant in `assets/branding/` or configurable paths
  - Support for multiple branding presets per tenant
  - Asset validation and format compatibility checks
- Manifest updates:
  - Finalize manifest with complete asset paths and processing metadata
  - Include branding configuration used and asset versions
  - Mark job as completed with final output details
- Determinism:
  - Given identical inputs and branding config, output should be byte-identical
  - Asset processing uses fixed parameters for consistency

**Business Value**  
Delivers a production-ready, branded video output that maintains professional quality while showcasing tenant branding. Enables stakeholder demos and final product delivery with consistent branding application across all tenant outputs.

### Target Service Architecture (Phase 1 WP01)

```bash
backend/
  services/
    branding-layer/
      handler.js               # Lambda/worker handler
      branding-logic.js        # Core branding application logic
      asset-manager.js         # Branding asset management and validation
      README.md
      package.json
backend/
  lib/
    storage.ts                 # From WP00-02
    manifest.ts                # From WP00-02
    init-observability.ts      # From WP00-03
    ffmpeg-runtime.ts          # From WP00-03
docs/
  mfu-backlog/
    MFU-WP01-05-BE-video-engine-transitions.md
    MFU-WP01-06-BE-subtitles-post-edit.md
    MFU-WP01-07-BE-branding-layer.md
storage/
  {env}/{tenantId}/{jobId}/...
  {env}/{tenantId}/assets/branding/...  # Tenant branding assets
tools/
  harness/
    run-local-pipeline.js      # From WP00-05; add lane to run branding
```

### Handler Contract

- Event (from orchestrator or local harness):
  - `env: "dev" | "stage" | "prod"`
  - `tenantId: string`
  - `jobId: string`
  - `sourceVideoKey?: string` (default `{env}/{tenantId}/{jobId}/renders/with_transitions.mp4`)
  - `subtitleKeys?: { srt?: string, vtt?: string }` (optional subtitle files)
  - `brandingConfig?: { intro?: string, outro?: string, logo?: string, preset?: string }`
  - `correlationId?: string`
- Behavior:
  - Load manifest and resolve source video key
  - Load tenant branding configuration and validate assets
  - Apply intro/outro videos with fade transitions
  - Apply logo overlay if configured
  - Burn-in subtitles if available
  - Write `renders/final_poc.mp4` with branding applied
  - Update manifest with final output details and mark job complete
  - Emit structured logs and EMF metrics
- Errors:
  - On failure, set manifest `status = "failed"` and push error log entry; surface error

### Migration Notes (new service)

- Create new `backend/services/branding-layer/` service.
- Implement `backend/services/branding-layer/branding-logic.js`:
  - `applyIntroOutro(sourcePath, outputPath, config)` → applies intro/outro with fades
  - `applyLogoOverlay(sourcePath, outputPath, config)` → applies logo watermark
  - `burnSubtitles(sourcePath, outputPath, subtitlePath)` → burns in subtitle track
  - `combineBrandingElements(sourcePath, outputPath, config)` → orchestrates all branding
- Implement `backend/services/branding-layer/asset-manager.js`:
  - `loadTenantBranding(tenantId, config)` → loads and validates branding assets
  - `validateAssetFormat(assetPath, type)` → checks asset compatibility
  - `getAssetMetadata(assetPath)` → extracts duration, resolution, etc.
- Update manifest via `backend/lib/manifest.ts`; include final output metadata and branding details.

## Acceptance Criteria

- [ ] Reads source video from `renders/with_transitions.mp4` or `base_cuts.mp4`
- [ ] Loads tenant branding configuration from manifest or environment
- [ ] Validates branding assets exist and are compatible formats
- [ ] Applies intro video with configurable duration and fade transitions
- [ ] Applies outro video with configurable duration and fade transitions
- [ ] Applies logo overlay if configured:
  - [ ] Supports configurable position, size, opacity, and duration
  - [ ] Maintains video quality and aspect ratio
- [ ] Burns in subtitles if available (`final.srt` or `final.vtt`)
- [ ] Maintains original video codec, fps, and resolution
- [ ] Preserves audio quality and loudness levels
- [ ] Output `renders/final_poc.mp4` is produced with all branding applied
- [ ] Subtitle timing remains synchronized with final output
- [ ] Manifest updated:
  - [ ] Finalizes manifest with complete asset paths
  - [ ] Includes branding configuration and asset versions used
  - [ ] Marks job status as completed
  - [ ] Updates `updatedAt` and `logs[]` with processing summary
- [ ] Logs include `correlationId`, `tenantId`, `jobId`, `step = "branding-layer"`
- [ ] Idempotent for same `{env}/{tenantId}/{jobId}` (safe overwrite)
- [ ] Harness (WP00-05) can invoke branding lane locally end-to-end
- [ ] Non-zero exit on error when run via harness; manifest status updated appropriately

## Complexity Assessment

- Complexity: Medium
- Estimated Effort: 1–2 days
- Confidence: Medium

## Dependencies and Prerequisites

- Hard dependencies:
  - MFU‑WP01‑05‑BE (video engine transitions - provides source render)
  - MFU‑WP01‑06‑BE (subtitles post-edit - provides final subtitles)
  - MFU‑WP00‑02‑BE (manifest, storage, tenancy helpers)
  - MFU‑WP00‑03‑IAC (FFmpeg runtime, observability wrappers)
- Recommended:
  - MFU‑WP00‑04‑MW (orchestration skeleton)
  - MFU‑WP00‑05‑TG (harness/goldens integration)

**Environment Variables** (extend `.env.example`):
```env
# Branding Layer (WP01-07)
BRANDING_ENABLED=true
BRANDING_INTRO_DURATION_SEC=3.0
BRANDING_OUTRO_DURATION_SEC=3.0
BRANDING_LOGO_OPACITY=0.8
BRANDING_LOGO_POSITION=bottom-right
BRANDING_LOGO_SIZE=10%
BRANDING_FADE_DURATION_MS=500
BRANDING_BURN_SUBTITLES=true
FFMPEG_PATH=                      # From WP00-03; optional if ffmpeg on PATH
FFPROBE_PATH=                     # From WP00-03; optional if ffprobe on PATH
```

## Agent Execution Guide (Step-by-step)

Follow these steps exactly. All paths are repo‑relative.

1) Ensure directories exist
- Create or verify:
  - `backend/services/branding-layer/`

2) Implement asset manager module
- Create `backend/services/branding-layer/asset-manager.js` with:
  - `loadTenantBranding(tenantId, config)` → loads branding assets for tenant
  - `validateAssetFormat(assetPath, type)` → checks asset compatibility
  - `getAssetMetadata(assetPath)` → extracts duration, resolution, codec info

```javascript
// backend/services/branding-layer/asset-manager.js
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

class AssetError extends Error {
  constructor(message, type, details = {}) {
    super(message);
    this.name = 'AssetError';
    this.type = type;
    this.details = details;
  }
}

const ERROR_TYPES = {
  ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
  INVALID_FORMAT: 'INVALID_FORMAT',
  METADATA_EXTRACTION: 'METADATA_EXTRACTION'
};

function execAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 50 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) { err.stdout = stdout; err.stderr = stderr; return reject(err); }
      resolve({ stdout, stderr });
    });
  });
}

async function getAssetMetadata(assetPath) {
  try {
    const { stdout } = await execAsync(process.env.FFPROBE_PATH || 'ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      assetPath
    ]);
    
    const metadata = JSON.parse(stdout);
    const videoStream = metadata.streams.find(s => s.codec_type === 'video');
    const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
    
    return {
      duration: parseFloat(metadata.format.duration),
      width: videoStream ? parseInt(videoStream.width) : null,
      height: videoStream ? parseInt(videoStream.height) : null,
      fps: videoStream ? eval(videoStream.r_frame_rate) : null,
      codec: videoStream ? videoStream.codec_name : null,
      audioCodec: audioStream ? audioStream.codec_name : null,
      hasVideo: !!videoStream,
      hasAudio: !!audioStream
    };
  } catch (err) {
    throw new AssetError(`Metadata extraction failed: ${err.message}`, ERROR_TYPES.METADATA_EXTRACTION, { assetPath, error: err.message });
  }
}

function validateAssetFormat(assetPath, type) {
  if (!fs.existsSync(assetPath)) {
    throw new AssetError(`Asset not found: ${assetPath}`, ERROR_TYPES.ASSET_NOT_FOUND, { assetPath, type });
  }
  
  const ext = path.extname(assetPath).toLowerCase();
  const validFormats = {
    video: ['.mp4', '.mov', '.avi', '.mkv'],
    image: ['.png', '.jpg', '.jpeg', '.gif', '.bmp']
  };
  
  if (!validFormats[type] || !validFormats[type].includes(ext)) {
    throw new AssetError(`Invalid ${type} format: ${ext}`, ERROR_TYPES.INVALID_FORMAT, { assetPath, type, ext });
  }
}

async function loadTenantBranding(tenantId, config) {
  const branding = {
    intro: null,
    outro: null,
    logo: null,
    metadata: {}
  };
  
  // Load intro video
  if (config.intro) {
    const introPath = path.resolve(`storage/${config.env || 'dev'}/${tenantId}/assets/branding/${config.intro}`);
    validateAssetFormat(introPath, 'video');
    branding.intro = introPath;
    branding.metadata.intro = await getAssetMetadata(introPath);
  }
  
  // Load outro video
  if (config.outro) {
    const outroPath = path.resolve(`storage/${config.env || 'dev'}/${tenantId}/assets/branding/${config.outro}`);
    validateAssetFormat(outroPath, 'video');
    branding.outro = outroPath;
    branding.metadata.outro = await getAssetMetadata(outroPath);
  }
  
  // Load logo image
  if (config.logo) {
    const logoPath = path.resolve(`storage/${config.env || 'dev'}/${tenantId}/assets/branding/${config.logo}`);
    validateAssetFormat(logoPath, 'image');
    branding.logo = logoPath;
  }
  
  return branding;
}

module.exports = {
  loadTenantBranding,
  validateAssetFormat,
  getAssetMetadata,
  AssetError,
  ERROR_TYPES
};
```

3) Implement branding logic module
- Create `backend/services/branding-layer/branding-logic.js` with:
  - `applyIntroOutro(sourcePath, outputPath, config)` → applies intro/outro with fades
  - `applyLogoOverlay(sourcePath, outputPath, config)` → applies logo watermark
  - `burnSubtitles(sourcePath, outputPath, subtitlePath)` → burns in subtitle track
  - `combineBrandingElements(sourcePath, outputPath, config)` → orchestrates all branding

```javascript
// backend/services/branding-layer/branding-logic.js
const { execFile } = require('node:child_process');

class BrandingError extends Error {
  constructor(message, type, details = {}) {
    super(message);
    this.name = 'BrandingError';
    this.type = type;
    this.details = details;
  }
}

const ERROR_TYPES = {
  FFMPEG_EXECUTION: 'FFMPEG_EXECUTION',
  INVALID_CONFIG: 'INVALID_CONFIG',
  ASSET_PROCESSING: 'ASSET_PROCESSING'
};

function execAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 50 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) { err.stdout = stdout; err.stderr = stderr; return reject(err); }
      resolve({ stdout, stderr });
    });
  });
}

async function applyIntroOutro(sourcePath, outputPath, config) {
  const introDuration = Number(config.introDuration || 3.0);
  const outroDuration = Number(config.outroDuration || 3.0);
  const fadeMs = Number(config.fadeDuration || 500);
  
  if (!config.intro && !config.outro) {
    // No intro/outro, just copy source
    const args = ['-y', '-i', sourcePath, '-c', 'copy', outputPath];
    await execAsync(process.env.FFMPEG_PATH || 'ffmpeg', args);
    return;
  }
  
  const args = ['-y'];
  
  // Input files
  if (config.intro) args.push('-i', config.intro);
  args.push('-i', sourcePath);
  if (config.outro) args.push('-i', config.outro);
  
  // Build filtergraph
  const filters = [];
  let videoFilter = '';
  let audioFilter = '';
  
  if (config.intro) {
    const fadeIn = (fadeMs / 1000).toFixed(2);
    const introEnd = introDuration.toFixed(2);
    videoFilter += `[0:v]fade=t=in:st=0:d=${fadeIn},fade=t=out:st=${(introDuration - fadeMs/1000).toFixed(2)}:d=${fadeIn}[intro];`;
    audioFilter += `[0:a]afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${(introDuration - fadeMs/1000).toFixed(2)}:d=${fadeIn}[introa];`;
  }
  
  videoFilter += `[1:v]`;
  audioFilter += `[1:a]`;
  
  if (config.outro) {
    const fadeOut = (fadeMs / 1000).toFixed(2);
    const outroStart = `[2:v]fade=t=in:st=0:d=${fadeOut},fade=t=out:st=${(outroDuration - fadeMs/1000).toFixed(2)}:d=${fadeOut}[outro];`;
    const outroAudio = `[2:a]afade=t=in:st=0:d=${fadeOut},afade=t=out:st=${(outroDuration - fadeMs/1000).toFixed(2)}:d=${fadeOut}[outroa];`;
    videoFilter += outroStart;
    audioFilter += outroAudio;
  }
  
  // Concatenate
  if (config.intro && config.outro) {
    videoFilter += `[intro][1:v][outro]concat=n=3:v=1:a=0[vout];`;
    audioFilter += `[introa][1:a][outroa]concat=n=3:v=0:a=1[aout]`;
  } else if (config.intro) {
    videoFilter += `[intro][1:v]concat=n=2:v=1:a=0[vout];`;
    audioFilter += `[introa][1:a]concat=n=2:v=0:a=1[aout]`;
  } else if (config.outro) {
    videoFilter += `[1:v][outro]concat=n=2:v=1:a=0[vout];`;
    audioFilter += `[1:a][outroa]concat=n=2:v=0:a=1[aout]`;
  }
  
  const filtergraph = videoFilter + audioFilter;
  
  args.push('-filter_complex', filtergraph);
  args.push('-map', '[vout]', '-map', '[aout]');
  args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '20');
  args.push('-c:a', 'aac', '-b:a', '192k');
  args.push(outputPath);
  
  try {
    await execAsync(process.env.FFMPEG_PATH || 'ffmpeg', args);
  } catch (err) {
    throw new BrandingError(`Intro/outro application failed: ${err.message}`, ERROR_TYPES.FFMPEG_EXECUTION, {
      sourcePath, outputPath, config, ffmpegError: err.message
    });
  }
}

async function applyLogoOverlay(sourcePath, outputPath, config) {
  if (!config.logo) {
    // No logo, just copy
    const args = ['-y', '-i', sourcePath, '-c', 'copy', outputPath];
    await execAsync(process.env.FFMPEG_PATH || 'ffmpeg', args);
    return;
  }
  
  const position = config.logoPosition || 'bottom-right';
  const size = config.logoSize || '10%';
  const opacity = Number(config.logoOpacity || 0.8);
  
  let overlayFilter = '';
  switch (position) {
    case 'top-left':
      overlayFilter = 'overlay=10:10';
      break;
    case 'top-right':
      overlayFilter = 'overlay=W-w-10:10';
      break;
    case 'bottom-left':
      overlayFilter = 'overlay=10:H-h-10';
      break;
    case 'bottom-right':
      overlayFilter = 'overlay=W-w-10:H-h-10';
      break;
    default:
      overlayFilter = 'overlay=W-w-10:H-h-10';
  }
  
  const args = [
    '-y',
    '-i', sourcePath,
    '-i', config.logo,
    '-filter_complex', `[1:v]scale=${size},format=rgba,colorchannelmixer=aa=${opacity}[logo];[0:v][logo]${overlayFilter}[vout]`,
    '-map', '[vout]',
    '-map', '0:a',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '20',
    '-c:a', 'copy',
    outputPath
  ];
  
  try {
    await execAsync(process.env.FFMPEG_PATH || 'ffmpeg', args);
  } catch (err) {
    throw new BrandingError(`Logo overlay failed: ${err.message}`, ERROR_TYPES.FFMPEG_EXECUTION, {
      sourcePath, outputPath, config, ffmpegError: err.message
    });
  }
}

async function burnSubtitles(sourcePath, outputPath, subtitlePath) {
  if (!subtitlePath || !require('fs').existsSync(subtitlePath)) {
    // No subtitles, just copy
    const args = ['-y', '-i', sourcePath, '-c', 'copy', outputPath];
    await execAsync(process.env.FFMPEG_PATH || 'ffmpeg', args);
    return;
  }
  
  const args = [
    '-y',
    '-i', sourcePath,
    '-vf', `subtitles=${subtitlePath}`,
    '-c:a', 'copy',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '20',
    outputPath
  ];
  
  try {
    await execAsync(process.env.FFMPEG_PATH || 'ffmpeg', args);
  } catch (err) {
    throw new BrandingError(`Subtitle burn-in failed: ${err.message}`, ERROR_TYPES.FFMPEG_EXECUTION, {
      sourcePath, outputPath, subtitlePath, ffmpegError: err.message
    });
  }
}

async function combineBrandingElements(sourcePath, outputPath, config) {
  const tempPath = outputPath.replace('.mp4', '_temp.mp4');
  
  try {
    // Step 1: Apply intro/outro
    await applyIntroOutro(sourcePath, tempPath, config);
    
    // Step 2: Apply logo overlay
    const logoOutput = config.logo ? outputPath.replace('.mp4', '_logo.mp4') : tempPath;
    await applyLogoOverlay(tempPath, logoOutput, config);
    
    // Step 3: Burn subtitles
    if (config.subtitlePath) {
      await burnSubtitles(logoOutput, outputPath, config.subtitlePath);
    } else if (config.logo) {
      // No subtitles, rename logo output to final
      require('fs').renameSync(logoOutput, outputPath);
    }
    
    // Cleanup temp files
    if (require('fs').existsSync(tempPath)) require('fs').unlinkSync(tempPath);
    if (config.logo && require('fs').existsSync(logoOutput)) require('fs').unlinkSync(logoOutput);
    
  } catch (err) {
    // Cleanup on error
    if (require('fs').existsSync(tempPath)) require('fs').unlinkSync(tempPath);
    throw err;
  }
}

module.exports = {
  applyIntroOutro,
  applyLogoOverlay,
  burnSubtitles,
  combineBrandingElements,
  BrandingError,
  ERROR_TYPES
};
```

4) Implement handler
- Create `backend/services/branding-layer/handler.js` that:
  - Loads source video and tenant branding configuration
  - Validates branding assets
  - Applies all branding elements in sequence
  - Updates manifest with final output details

```javascript
// backend/services/branding-layer/handler.js
const { initObservability } = require('../../lib/init-observability');
const { keyFor, pathFor, writeFileAtKey } = require('../../lib/storage');
const { loadManifest, saveManifest } = require('../../lib/manifest');
const { loadTenantBranding, AssetError, ERROR_TYPES } = require('./asset-manager');
const { combineBrandingElements, BrandingError } = require('./branding-logic');
const fs = require('node:fs');

exports.handler = async (event, context) => {
  const { env, tenantId, jobId } = event;
  const correlationId = event.correlationId || context.awsRequestId;
  const { logger, metrics } = initObservability({
    serviceName: 'BrandingLayer',
    correlationId, tenantId, jobId, step: 'branding-layer',
  });

  const sourceVideoKey = event.sourceVideoKey || keyFor(env, tenantId, jobId, 'renders', 'with_transitions.mp4');
  const outputKey = keyFor(env, tenantId, jobId, 'renders', 'final_poc.mp4');
  
  const brandingConfig = {
    env,
    intro: event.brandingConfig?.intro || process.env.BRANDING_INTRO_VIDEO,
    outro: event.brandingConfig?.outro || process.env.BRANDING_OUTRO_VIDEO,
    logo: event.brandingConfig?.logo || process.env.BRANDING_LOGO_IMAGE,
    introDuration: Number(event.brandingConfig?.introDuration || process.env.BRANDING_INTRO_DURATION_SEC || 3.0),
    outroDuration: Number(event.brandingConfig?.outroDuration || process.env.BRANDING_OUTRO_DURATION_SEC || 3.0),
    logoPosition: event.brandingConfig?.logoPosition || process.env.BRANDING_LOGO_POSITION || 'bottom-right',
    logoSize: event.brandingConfig?.logoSize || process.env.BRANDING_LOGO_SIZE || '10%',
    logoOpacity: Number(event.brandingConfig?.logoOpacity || process.env.BRANDING_LOGO_OPACITY || 0.8),
    fadeDuration: Number(event.brandingConfig?.fadeDuration || process.env.BRANDING_FADE_DURATION_MS || 500)
  };

  try {
    // Load and validate branding assets
    const branding = await loadTenantBranding(tenantId, brandingConfig);
    
    // Check for subtitles
    const srtKey = keyFor(env, tenantId, jobId, 'subtitles', 'final.srt');
    const vttKey = keyFor(env, tenantId, jobId, 'subtitles', 'final.vtt');
    let subtitlePath = null;
    
    if (fs.existsSync(pathFor(srtKey))) {
      subtitlePath = pathFor(srtKey);
    } else if (fs.existsSync(pathFor(vttKey))) {
      subtitlePath = pathFor(vttKey);
    }
    
    // Apply branding
    const sourcePath = pathFor(sourceVideoKey);
    const outputPath = pathFor(outputKey);
    
    await combineBrandingElements(sourcePath, outputPath, {
      ...branding,
      subtitlePath,
      ...brandingConfig
    });
    
    // Update manifest
    const manifest = loadManifest(env, tenantId, jobId);
    manifest.status = 'completed';
    manifest.finalOutput = {
      key: outputKey,
      type: 'final_poc',
      codec: 'h264',
      branding: {
        intro: brandingConfig.intro,
        outro: brandingConfig.outro,
        logo: brandingConfig.logo,
        appliedAt: new Date().toISOString()
      }
    };
    manifest.updatedAt = new Date().toISOString();
    manifest.logs = manifest.logs || [];
    manifest.logs.push({
      type: 'info',
      message: `Branding applied successfully: intro=${!!brandingConfig.intro}, outro=${!!brandingConfig.outro}, logo=${!!brandingConfig.logo}, subtitles=${!!subtitlePath}`,
      createdAt: new Date().toISOString()
    });
    
    saveManifest(env, tenantId, jobId, manifest);
    
    metrics.addMetric('BrandingSuccess', 'Count', 1);
    metrics.addMetric('BrandingElementsApplied', 'Count', 
      (brandingConfig.intro ? 1 : 0) + (brandingConfig.outro ? 1 : 0) + (brandingConfig.logo ? 1 : 0));
    logger.info('Branding applied', { outputKey, branding: brandingConfig });
    
    return { ok: true, outputKey, correlationId };
  } catch (err) {
    logger.error('Branding failed', { error: err.message, type: err.type });
    metrics.addMetric('BrandingError', 'Count', 1);
    metrics.addMetric(`BrandingError_${err.type || 'UNKNOWN'}`, 'Count', 1);
    
    try {
      const manifest = loadManifest(env, tenantId, jobId);
      manifest.status = 'failed';
      manifest.updatedAt = new Date().toISOString();
      manifest.logs = manifest.logs || [];
      manifest.logs.push({
        type: 'error',
        message: `Branding failed: ${err.message}`,
        createdAt: new Date().toISOString()
      });
      saveManifest(env, tenantId, jobId, manifest);
    } catch {}
    
    throw err;
  }
};
```

5) Wire into local harness (WP00-05)
- Add a flag or lane to run branding after transitions and subtitles, using same job context.

6) Validate manifest updates
- Ensure manifest includes final output details and branding configuration

7) Logging and metrics
- Confirm logs contain `correlationId`, `tenantId`, `jobId`, `step`
- Metrics: `BrandingSuccess`, `BrandingElementsApplied`, `BrandingError_*`

8) Idempotency
- Re-run with same job; output overwritten safely; manifest updated

## Test Plan

### Local
- Run harness on a short input with branding assets:
  - Expect `renders/final_poc.mp4` with applied branding
  - Validate intro/outro timing and fade transitions
  - Validate logo overlay position and opacity
  - Validate subtitle synchronization if available
  - Validate video quality and codec preservation
- Configuration testing:
  - Test with different logo positions and sizes
  - Test with/without intro, outro, logo, subtitles
  - Test with different fade durations
- Error path testing:
  - Missing source video → input-not-found error
  - Invalid branding assets → asset validation error
  - Missing tenant branding config → configuration error
- Repeatability:
  - Run same job twice; outputs overwritten; manifest updated deterministically

### CI (optional if harness lane exists)
- Add tiny sample branding assets and run branding lane; assert:
  - Final output exists with applied branding
  - Manifest contains final output details
  - Logs contain required correlation fields
  - Metrics emitted for success and elements applied

```yaml
# Optional CI example
branding-test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'
    - name: Install deps
      run: npm ci || npm install
    - name: Install FFmpeg
      run: |
        sudo apt-get update
        sudo apt-get install -y ffmpeg
    - name: Run branding harness
      run: |
        node tools/harness/run-local-pipeline.js \
          --input podcast-automation/test-assets/raw/sample-branding.mp4 \
          --goldens podcast-automation/test-assets/goldens/sample-branding \
          --env dev
      env:
        BRANDING_ENABLED: true
        BRANDING_INTRO_DURATION_SEC: 2.0
        BRANDING_OUTRO_DURATION_SEC: 2.0
        BRANDING_LOGO_POSITION: bottom-right
    - name: Upload artifacts on failure
      if: failure()
      uses: actions/upload-artifact@v4
      with:
        name: branding-test-outputs
        path: storage/
```

## Success Metrics

- Quality preservation: original video codec, fps, and resolution maintained
- Branding accuracy: intro/outro timing within ±100ms of configured duration
- Logo positioning: overlay appears at correct position and size
- Subtitle sync: burned-in subtitles remain synchronized with audio
- Reliability: 0 intermittent failures across 20 consecutive runs on same input
- Observability: 100% operations logged with required fields; EMF metrics present
- Determinism: Same input/config yields identical output files

## Dependencies

- MFU‑WP01‑05‑BE: Video Engine Transitions  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-05-BE-video-engine-transitions.md
- MFU‑WP01‑06‑BE: Subtitles Post-Edit  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-06-BE-subtitles-post-edit.md
- MFU‑WP00‑02‑BE: Manifest, Tenancy, and Storage Schema  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-02-BE-manifest-tenancy-and-storage-schema.md
- MFU‑WP00‑03‑IAC: Runtime FFmpeg and Observability  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-03-IAC-runtime-ffmpeg-and-observability.md
- MFU‑WP00‑05‑TG: Test Harness and Golden Samples  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP00-05-TG-test-harness-and-golden-samples.md

## Risks / Open Questions

- Branding asset format compatibility across different video codecs and containers
- Logo overlay performance with high-resolution videos
- Intro/outro video aspect ratio mismatches with source content
- Subtitle burn-in performance with long videos
- Tenant branding asset management and versioning strategy
- Future: support for animated logos and complex branding effects
- **Asset Management**: Need strategy for tenant branding asset storage and retrieval
- **Quality Control**: Branding application should not degrade video quality significantly

## Related MFUs

- MFU‑WP01‑05‑BE: Video Engine Transitions  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-05-BE-video-engine-transitions.md
- MFU‑WP01‑06‑BE: Subtitles Post-Edit  
  See: https://vscode.dev/github/Talk-Avocado/talk-avocado/blob/main/docs/mfu-backlog/MFU-WP01-06-BE-subtitles-post-edit.md

## Implementation Tracking

- Status: planned
- Assigned To: Team
- Start Date: 2025-10-01
- Target Completion: +2 days
- Actual Completion: TBC


