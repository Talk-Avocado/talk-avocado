# Git Workflow Guide

A guide for developers working on the Talk Avocado project using our MFU (Minimum Feature Unit) workflow.

## Table of Contents

- [Overview](#overview)
- [Getting Started](#getting-started)
- [MFU Workflow](#mfu-workflow)
- [Daily Development](#daily-development)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Overview

### What is MFU?

MFU (Minimum Feature Unit) is our approach to breaking down work into small, manageable, and independently deliverable units. Each MFU:

- Represents a single, focused piece of work
- Can be completed and merged within a reasonable timeframe
- Is documented in `docs/mfu-backlog/`
- Follows a structured workflow from creation to release

### Branch Strategy

```text
main (production)
  ↑
dev (integration)
  ↑
mfu-* branches (feature work)
```

- **main** - Production-ready code, tagged with releases
- **dev** - Integration branch for completed MFUs
- **mfu-*** - Individual feature branches for specific MFUs

## Getting Started

### Prerequisites

1. **Required Tools:**

   ```bash
   # Git
   git --version
   
   # Optional but recommended
   npm install -g markdownlint-cli2
   ```

2. **Clone the Repository:**

   ```bash
   git clone <repository-url>
   cd talk-avocado
   ```

3. **Make the Workflow Script Executable:**

   ```bash
   chmod +x scripts/dev-tools/git-workflow.sh
   ```

### First Run

Launch the interactive menu:

```bash
./scripts/dev-tools/git-workflow.sh
```

You'll see:

```text
Talk Avocado Development Workflow v3.0.0
-------------------------------------------

MFU Workflow:
1) Create MFU branch
2) Commit MFU progress (with validation)
3) Fast commit MFU progress (skip validation)
4) Complete MFU (merge to dev)
5) Release (merge dev→main + tag)
6) Show MFU status
7) Clean up completed MFU branches

General git:
8) Push current branch
9) Sync with main (fetch/rebase)
10) Validate all

Lint & Docs:
11) Check markdown lint issues
12) Fix markdown lint issues

0) Exit
```

## MFU Workflow

### Step 1: Create MFU Branch

**Interactive:**

```bash
./scripts/dev-tools/git-workflow.sh
# Select option: 1
```

**Command Line:**

```bash
./scripts/dev-tools/git-workflow.sh mfu-create
```

**What happens:**

1. Shows available MFUs from `docs/mfu-backlog/`
2. You select an MFU or provide a custom name
3. Script switches to `dev` branch
4. Pulls latest changes
5. Creates and checks out your new `mfu-*` branch

**Example:**

```text
Available MFUs in current work cycle:

1) MFU-WP00-01-IAC-platform-bootstrap-and-ci
   Infrastructure as Code: Platform Bootstrap and CI

2) MFU-WP00-02-BE-manifest-tenancy-and-storage-schema
   Backend: Manifest Tenancy and Storage Schema

Select MFU number (or press Enter for custom name): 1
Selected: Infrastructure as Code: Platform Bootstrap and CI
✅ MFU branch 'MFU-WP00-01-IAC-platform-bootstrap-and-ci' created successfully
```

### Step 2: Work on Your MFU

Make your changes as normal:

```bash
# Edit files
vim podcast-automation/ExtractAudioFromVideo/index.js

# Check status
git status

# Stage changes
git add .
```

### Step 3: Commit Progress

#### Regular Commit (with validation)

**Interactive:**

```bash
./scripts/dev-tools/git-workflow.sh
# Select option: 2
```

**Command Line:**

```bash
./scripts/dev-tools/git-workflow.sh mfu-commit
```

**What happens:**

1. Validates you're on an MFU branch
2. Runs smart validation (only validates changed file categories)
3. Opens structured commit process (see below)

#### Fast Commit (skip validation)

Use this for rapid iteration during development:

```bash
./scripts/dev-tools/git-workflow.sh mfu-fast-commit
```

**⚠️ Warning:** Remember to run full validation before completing the MFU!

#### Structured Commit Process

Both commit options use a structured process:

```text
1. Staging changes...
   Stage all changes? [Y/n]: y
   ✓ All changes staged

2. Select update type:
   1) feat     - A new feature
   2) fix      - A bug fix
   3) docs     - Documentation only changes
   4) style    - Changes that do not affect the meaning of the code
   5) refactor - A code change that neither fixes a bug nor adds a feature
   6) test     - Adding missing tests or correcting existing tests
   7) chore    - Changes to the build process or auxiliary tools
   8) perf     - A code change that improves performance
   9) ci       - Changes to CI configuration files and scripts
   10) build   - Changes that affect the build system or external dependencies

   Enter update type [1-10]: 1

3. Select focus area:
   - auth (authentication related)
   - api (API endpoints)
   - ui (user interface components)
   - db (database related)
   - config (configuration changes)
   - middleware (middleware changes)
   - types (TypeScript types)
   - docs (documentation changes)
   - scripts (development scripts)
   - mfu (MFU workflow changes)
   - validation (validation system changes)

   Enter focus area (optional, press Enter to skip): scripts

4. Enter commit description: add audio extraction Lambda function

Commit message preview:
feat(scripts): add audio extraction Lambda function

Confirm commit message? [Y/n]: y

5. Committing changes...
✅ Changes committed successfully

Push changes to remote? [Y/n]: y
✅ Changes pushed to remote
```

**Example Commit Messages:**

```text
feat(api): add video rendering endpoint
fix(scripts): resolve audio extraction timeout
docs(guides): update MFU workflow documentation
refactor(lambda): simplify transcription handler
chore(deps): update AWS SDK to v3.865.0
```

### Step 4: Complete MFU

When your MFU is ready to merge to `dev`:

**Interactive:**

```bash
./scripts/dev-tools/git-workflow.sh
# Select option: 4
```

**Command Line:**

```bash
./scripts/dev-tools/git-workflow.sh mfu-complete
```

**What happens:**

1. Runs final validation
2. Switches to `dev` branch
3. Pulls latest changes
4. Merges your MFU branch
5. Pushes to remote
6. Preserves your MFU branch (for work cycle tracking)

### Step 5: Release (Dev → Main)

**⚠️ Typically done by team lead or during release cycles**:

**Interactive:**

```bash
./scripts/dev-tools/git-workflow.sh
# Select option: 5
```

**Command Line:**

```bash
./scripts/dev-tools/git-workflow.sh mfu-release
```

**What happens:**

1. Validates you're on `dev` branch
2. Runs validation
3. Switches to `main` branch
4. Merges `dev` into `main`
5. Creates a release tag (e.g., `release-20241008-143000`)
6. Pushes tag and changes to remote

## Daily Development

### Starting Your Day

```bash
# Update your local repository
./scripts/dev-tools/git-workflow.sh sync
# Or use option 9 in interactive mode

# Check your current MFU status
./scripts/dev-tools/git-workflow.sh mfu-status
# Or use option 6 in interactive mode
```

### During Development

```bash
# Make changes
# ...

# Fast commit for rapid iteration
./scripts/dev-tools/git-workflow.sh mfu-fast-commit

# Continue working...
```

### Before Completing MFU

```bash
# Run full validation
./scripts/dev-tools/git-workflow.sh validate

# Check documentation
./scripts/dev-tools/git-workflow.sh check-markdown

# Fix any markdown issues
./scripts/dev-tools/git-workflow.sh fix-markdown

# Final commit with validation
./scripts/dev-tools/git-workflow.sh mfu-commit

# Complete MFU
./scripts/dev-tools/git-workflow.sh mfu-complete
```

## Best Practices

### MFU Branch Naming

- Use the exact MFU name from `docs/mfu-backlog/`
- Examples:
  - `MFU-WP00-01-IAC-platform-bootstrap-and-ci`
  - `MFU-WP01-02-BE-transcription`
  - `MFU-WP01-04-BE-video-engine-cuts`

### Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```text
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks
- `perf`: Performance improvements
- `ci`: CI/CD changes
- `build`: Build system changes

**Scope Examples:**

- `scripts`: Development scripts
- `lambda`: Lambda functions
- `docs`: Documentation
- `workflow`: State machine/orchestration
- `api`: API endpoints
- `infra`: Infrastructure code

### When to Use Fast Commit

✅ **Use Fast Commit When:**

- Rapidly iterating on a solution
- Making frequent small commits during active development
- Working on experimental code
- Time-sensitive debugging

❌ **Don't Use Fast Commit For:**

- Final commits before completing MFU
- Changes you're about to push to shared branches
- Code that others will review immediately

### Validation

The workflow includes smart validation that:

- **Caches results** to avoid redundant checks
- **Only validates changed categories** (docs, scripts, etc.)
- **Skips validation** for documentation-only changes
- **Runs middleware checks** when code changes

**Manual Validation:**

```bash
# Check markdown
./scripts/dev-tools/git-workflow.sh check-markdown

# Run all validations
./scripts/dev-tools/git-workflow.sh validate
```

### Documentation

Always update documentation when:

- Adding new features
- Changing workflows
- Modifying APIs or interfaces
- Creating new MFUs

**Check and fix markdown issues:**

```bash
# Check
./scripts/dev-tools/git-workflow.sh check-markdown

# Auto-fix
./scripts/dev-tools/git-workflow.sh fix-markdown
```

## Troubleshooting

### "Not on an MFU branch"

**Problem:** Trying to commit MFU progress from wrong branch.

**Solution:**

```bash
# Check current branch
git branch

# Switch to your MFU branch
git checkout MFU-WP00-01-IAC-platform-bootstrap-and-ci

# Or create a new MFU branch
./scripts/dev-tools/git-workflow.sh mfu-create
```

### "Validation failed - commit aborted"

**Problem:** Code changes don't pass validation checks.

**Solution:**

```bash
# Check what failed
./scripts/dev-tools/git-workflow.sh validate

# For markdown issues
./scripts/dev-tools/git-workflow.sh fix-markdown

# Then try committing again
```

### Merge Conflicts

**Problem:** Conflicts when completing MFU or syncing.

**Solution:**

```bash
# The script will notify you of conflicts
# Resolve conflicts manually
git status
git diff

# Edit conflicted files
vim <conflicted-file>

# Stage resolved files
git add <resolved-file>

# Complete the merge
git commit

# Continue with workflow
```

### "Failed to push changes"

**Problem:** Remote branch has changes you don't have locally.

**Solution:**

```bash
# Pull latest changes
git pull origin <your-branch>

# Resolve any conflicts
# Then push again
git push origin <your-branch>

# Or use the sync command
./scripts/dev-tools/git-workflow.sh sync
```

### Cleaning Up Old MFU Branches

After a work cycle is complete:

```bash
./scripts/dev-tools/git-workflow.sh mfu-cleanup
# Or use option 7 in interactive mode
```

This will:

1. List all local MFU branches
2. Ask for confirmation
3. Delete completed branches

## Command Reference

### Interactive Mode

```bash
./scripts/dev-tools/git-workflow.sh
```

### Command Line Options

| Command | Description |
|---------|-------------|
| `mfu-create` | Create a new MFU branch |
| `mfu-commit` | Commit with validation |
| `mfu-fast-commit` | Fast commit (skip validation) |
| `mfu-complete` | Complete MFU and merge to dev |
| `mfu-release` | Merge dev to main and create tag |
| `mfu-status` | Show current MFU status |
| `mfu-cleanup` | Clean up completed MFU branches |
| `push` | Push current branch to remote |
| `sync` | Sync with main branch |
| `validate` | Run all validations |
| `check-markdown` | Check markdown lint issues |
| `fix-markdown` | Auto-fix markdown issues |
| `commit-structured` | Structured commit (any branch) |
| `help` | Show help message |

### Examples

```bash
# Start new MFU
./scripts/dev-tools/git-workflow.sh mfu-create

# Commit progress
./scripts/dev-tools/git-workflow.sh mfu-commit

# Quick iteration
./scripts/dev-tools/git-workflow.sh mfu-fast-commit

# Push current work
./scripts/dev-tools/git-workflow.sh push

# Check status
./scripts/dev-tools/git-workflow.sh mfu-status

# Complete MFU
./scripts/dev-tools/git-workflow.sh mfu-complete
```

## Getting Help

- **Script Help:** `./scripts/dev-tools/git-workflow.sh help`
- **Script README:** `scripts/README.md`
- **Changelog:** `scripts/dev-tools/CHANGELOG.md`
- **MFU Backlog:** `docs/mfu-backlog/`

## Additional Resources

- [Conventional Commits](https://www.conventionalcommits.org/)
- [Git Branching Strategies](https://git-scm.com/book/en/v2/Git-Branching-Branching-Workflows)
- [Markdown Style Guide](https://google.github.io/styleguide/docguide/style.html)

---

**Questions or Issues?** Contact the development team or check the project documentation in `docs/`.
