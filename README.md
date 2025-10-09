# TalkAvocado

TalkAvocado is an automated podcast production platform that transforms raw video content into polished, professional podcasts through AI-powered audio processing, transcription, smart editing, and video rendering.

## Phase 1 Scope

Phase 1 focuses on establishing the foundational infrastructure and core processing pipeline:

- **Audio Extraction**: Extract high-quality audio from video files
- **Transcription**: AI-powered speech-to-text using Whisper
- **Smart Cut Planning**: Intelligent editing decisions for optimal content flow
- **Video Rendering**: Generate polished video outputs with transitions and branding
- **Orchestration**: AWS Step Functions-based workflow management

## Quick Start

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd talk-avocado
   ```

2. **Set up environment**

   ```bash
   cp .env.example .env
   bash scripts/setup.sh
   ```

3. **Run tests**

   ```bash
   bash scripts/test.sh
   ```

## Path Conventions

The platform uses a consistent storage structure for all media files:

```text
{MEDIA_STORAGE_PATH}/{env}/{tenantId}/{jobId}/
├── input/           # Original video files
├── audio/           # Extracted audio
├── transcript/      # Transcription outputs
├── plan/            # Smart cut plans
├── renders/         # Final video outputs
├── subtitles/       # Generated subtitles
├── logs/            # Processing logs
└── manifest.json    # Job metadata
```

- `MEDIA_STORAGE_PATH`: Base storage location (local path for development, S3 for production)
- `env`: Environment (dev, stage, prod)
- `tenantId`: Tenant identifier for multi-tenancy
- `jobId`: Unique job identifier

## Development

- **Setup**: `bash scripts/setup.sh`
- **Test**: `bash scripts/test.sh`
- **Format**: `bash scripts/format.sh`

## Architecture

- **Backend Services**: Node.js/TypeScript microservices for each processing step
- **Orchestration**: AWS Step Functions for workflow management
- **Storage**: S3-compatible storage with local development support
- **CI/CD**: GitHub Actions with automated testing and validation

## Contributing

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for development guidelines and [ROADMAP.md](docs/ROADMAP.md) for project roadmap.

## License

[License information to be added]
