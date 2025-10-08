# Development Scripts

Helper scripts for the Talk Avocado project.

## Git Workflow Helper

**Location:** `scripts/dev-tools/git-workflow.sh`

A comprehensive development workflow tool for managing MFU (Minimum Feature Unit) branches, commits, and releases.

### Quick Start

```bash
# Interactive menu
./scripts/dev-tools/git-workflow.sh

# Or use command-line arguments
./scripts/dev-tools/git-workflow.sh mfu-create
./scripts/dev-tools/git-workflow.sh mfu-commit
```

### Available Commands

#### MFU Workflow

- `mfu-create` - Create a new MFU branch from the backlog
- `mfu-commit` - Commit MFU progress with validation
- `mfu-fast-commit` - Fast commit (skip validation for rapid development)
- `mfu-complete` - Complete MFU and merge to dev
- `mfu-release` - Merge dev to main and create release tag
- `mfu-status` - Show current MFU status
- `mfu-cleanup` - Clean up completed MFU branches

#### Documentation & Linting

- `check-markdown` - Check markdown lint issues
- `fix-markdown` - Auto-fix markdown lint issues

#### General

- `push` - Push current branch to remote
- `sync` - Sync with main branch (fetch/rebase)
- `validate` - Run all project validations
- `commit-structured` - Interactive structured commit

### Prerequisites

For markdown linting:

```bash
npm install -g markdownlint-cli2
```

### Usage Examples

```bash
# Start a new MFU
./scripts/dev-tools/git-workflow.sh mfu-create

# Commit progress (with validation)
./scripts/dev-tools/git-workflow.sh mfu-commit

# Quick commit during rapid development
./scripts/dev-tools/git-workflow.sh mfu-fast-commit

# Complete MFU when done
./scripts/dev-tools/git-workflow.sh mfu-complete

# Check documentation
./scripts/dev-tools/git-workflow.sh check-markdown
```

### Module Structure

The workflow helper is modular:

- `modules/core.sh` - Core utilities, colors, git helpers, validation cache
- `modules/mfu.sh` - MFU workflow functions
- `modules/validation.sh` - Smart validation with caching

### Validation

The script includes smart validation that:

- Caches validation results to avoid redundant checks
- Only validates changed file categories (docs, scripts, etc.)
- Skips validation for documentation-only changes
- Provides fast-commit option for rapid iteration

### Help

Run with `help` to see all available commands:

```bash
./scripts/dev-tools/git-workflow.sh help
```
