# FFmpeg Runtime Lambda Container Image

This directory contains the Lambda container image configuration for FFmpeg runtime support.

## Overview

The FFmpeg runtime provides a Lambda-compatible container image with FFmpeg and FFprobe binaries, along with required codecs for media processing operations.

## Files

- `Dockerfile` - Multi-stage build configuration for Lambda container image
- `build.sh` - Build script that downloads FFmpeg, builds the image, and pushes to ECR
- `README.md` - This documentation

## Usage

### Building the Image

```bash
# Set required environment variables
export ECR_URI="123456789012.dkr.ecr.us-east-1.amazonaws.com"
export IMG_NAME="ffmpeg-runtime"

# Optional: Pin FFmpeg version for reproducible builds
export FFMPEG_SHA256="sha256-hash-of-ffmpeg-tarball"

# Build and push
bash build.sh
```

### Local Testing

```bash
# Test FFmpeg availability
docker run --rm ffmpeg-runtime:latest ffmpeg -version

# Test FFprobe availability  
docker run --rm ffmpeg-runtime:latest ffprobe -version
```

## Architecture

- **Base Image**: `public.ecr.aws/lambda/nodejs:20`
- **FFmpeg Source**: Static builds from johnvansickle.com
- **Binary Location**: `/opt/bin/ffmpeg` and `/opt/bin/ffprobe`
- **PATH**: Updated to include `/opt/bin`

## Security

- FFmpeg binaries are downloaded from trusted source
- SHA256 verification supported for reproducible builds
- Container image scanning recommended before deployment

## Integration

This image is used by all media processing Lambda functions:

- Audio extraction
- Video rendering
- Smart cut planning
- Transcription preprocessing

Functions should use the observability wrappers from `backend/lib/` for logging, metrics, and tracing.
