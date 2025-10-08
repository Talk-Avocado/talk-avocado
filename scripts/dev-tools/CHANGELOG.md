# Git Workflow Helper - Changelog

## v3.0.0 - Talk Avocado Simplified Version

### Major Changes

**Simplified Menu Structure**:

- Reduced from 63+ menu options to 12 focused options
- Organized into logical sections: MFU Workflow, Lint & Docs, General
- Removed all backend/frontend specific commands (Python, Node.js, etc.)
- Removed rate limiting, email testing, and environment checking commands

**Updated Menu**:

```text
MFU Workflow:
1) Create MFU branch
2) Commit MFU progress (with validation)
3) Fast commit MFU progress (skip validation)
4) Complete MFU (merge to dev)
5) Release (merge dev→main + tag)
6) Show MFU status
7) Clean up completed MFU branches

Lint & Docs:
8) Check markdown lint issues
9) Fix markdown lint issues

General:
10) Push current branch
11) Sync with main (fetch/rebase)
12) Validate all
```

**Command Line Interface**
Simplified CLI commands:

- MFU: `mfu-create`, `mfu-commit`, `mfu-fast-commit`, `mfu-complete`, `mfu-release`, `mfu-status`, `mfu-cleanup`
- Docs: `check-markdown`, `fix-markdown`
- General: `push`, `sync`, `validate`, `commit-structured`

**Module Updates**:

**core.sh:**

- Relaxed `ensure_project_root()` to check for `docs/` and `scripts/` instead of frontend/backend
- Added fallback for missing `jq` command in validation cache functions
- Updated markdown linting to support both `markdownlint-cli` and `markdownlint-cli2`
- Simplified `check_documentation_coverage()` to just count markdown files
- Removed backend/frontend specific environment checks

**validation.sh:**

- Updated `run_smart_middleware_validation()` to skip if frontend/backend directories don't exist
- Gracefully handles missing directories with informational messages

**mfu.sh:**

- Updated validation flows to skip frontend/backend validation if directories don't exist
- Maintains all MFU workflow functionality (create, commit, complete, release, cleanup)

**New Files:**

- `scripts/README.md` - Documentation for the workflow helper
- `scripts/dev-tools/CHANGELOG.md` - This changelog

### Removed Features

- All backend-specific commands (Python, Poetry, Black, Flake8, Ruff, MyPy, Pylint, Bandit)
- All frontend-specific commands (Next.js, TypeScript, ESLint, Storybook)
- Rate limiting management
- Email testing with Gmail API
- Testing environment checks
- Production build commands
- Dependency update commands
- Validation cache status/clear commands (still work internally)
- Performance metrics
- Enhanced duplicate detection

### Retained Features

- Complete MFU workflow (branch creation, commits, completion, releases)
- Smart validation with caching (internal)
- Structured commit process with conventional commit types
- Fast commit option for rapid development
- Markdown linting integration
- Git operations (push, sync, merge)
- Validation coordinator logic (internal, auto-detects changes)

### Configuration Requirements

**Optional Tools:**

- `markdownlint-cli2` or `markdownlint-cli` - For markdown linting
- `jq` - For enhanced validation cache (works without it)

**Installation:**

```bash
npm install -g markdownlint-cli2
```

### Migration Notes

If you were using the old script:

- Backend commands: Remove or migrate to project-specific scripts
- Frontend commands: Remove or migrate to package.json scripts
- Email testing: Move to separate testing scripts
- Environment checks: Create project-specific health check scripts

### Usage

**Interactive Mode:**

```bash
./scripts/dev-tools/git-workflow.sh
```

**Command Line:**

```bash
./scripts/dev-tools/git-workflow.sh mfu-create
./scripts/dev-tools/git-workflow.sh mfu-commit
./scripts/dev-tools/git-workflow.sh check-markdown
```

**Help:**

```bash
./scripts/dev-tools/git-workflow.sh help
```

---

## Previous Versions

### v2.2.0 (Consultancy Platform)

- Added fast commit option
- Smart validation with caching
- Menu options 1-63

### v2.1.0 (Consultancy Platform)

- Consolidated optimized commit functions
- Integrated smart validation coordinator
- Deprecated MFU-DEVOPS-01 optimization functions
