# Contributing to TalkAvocado

## Development Workflow

### 1. Branch Naming

- Use MFU-based branch names: `MFU-WP{PP}-{NN}-{TYPE}-{slug}`
- Example: `MFU-WP00-01-IAC-platform-bootstrap-and-ci`

### 2. Pull Request Process

1. Create feature branch from `main`
2. Make changes following coding standards
3. Run tests: `bash scripts/test.sh`
4. Format code: `bash scripts/format.sh`
5. Create PR with clear description
6. Ensure CI passes before requesting review

### 3. Code Review

- All PRs require at least one approval
- CI must pass (lint + tests)
- Follow the "15-minute setup" principle for new features

## Coding Standards

### JavaScript/TypeScript

- **Linting**: ESLint with recommended rules
- **Formatting**: Prettier (100 char line length, single quotes)
- **Style**: ES2021+ features, strict mode enabled

### Python

- **Linting**: Ruff with E, F, I rules
- **Formatting**: Black (100 char line length)
- **Style**: Python 3.11+ features

### General

- Use meaningful variable and function names
- Add comments for complex logic
- Follow existing patterns in the codebase
- Write tests for new functionality

## Environment Setup

### Prerequisites

- Node.js 20+ (if working with JS/TS)
- Python 3.11+ (if working with Python)
- Git

### Quick Setup

```bash
git clone <repository-url>
cd talk-avocado
cp .env.example .env
bash scripts/setup.sh
bash scripts/test.sh
```

## Testing

### Running Tests

```bash
# Run all tests
bash scripts/test.sh

# Node.js specific
npm test

# Python specific
pytest
```

### Test Requirements

- New features must include tests
- Maintain >95% CI pass rate
- Tests should run in <5 minutes locally

## File Organization

### Backend Services

```text
backend/services/{service-name}/
├── handler.js          # Main service handler
├── package.json        # Service dependencies
└── README.md          # Service documentation
```

### Documentation

```text
docs/
├── mfu-backlog/       # MFU specifications
├── schemas/           # JSON schemas
├── guides/            # Development guides
└── adrs/             # Architecture Decision Records
```

## Commit Messages

Use conventional commit format:

```text
type(scope): description

- feat: new feature
- fix: bug fix
- docs: documentation changes
- style: formatting changes
- refactor: code refactoring
- test: test additions/changes
- chore: maintenance tasks
```

## MFU Development Process

1. **Create MFU**: Use template in `docs/mfu-backlog/`
2. **Implement**: Follow step-by-step agent execution guide
3. **Test**: Validate against acceptance criteria
4. **Document**: Update relevant documentation
5. **Review**: Submit for team review

## Questions?

- Check existing documentation in `docs/`
- Review MFU specifications for detailed requirements
- Ask questions in team channels or create issues
