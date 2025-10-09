# Windows Compatibility Guide

This guide explains how to use the Talk Avocado git workflow scripts on Windows with Git Bash in Cursor.

## Prerequisites

### Required Software
1. **Git for Windows** - Download from [git-scm.com](https://git-scm.com/download/win)
2. **Cursor IDE** - Download from [cursor.sh](https://cursor.sh)
3. **Node.js** (optional) - For frontend development features
4. **Python 3.11+** (optional) - For backend development features

### Required Tools
- **Git Bash** - Comes with Git for Windows
- **jq** (optional) - For enhanced validation caching
  ```bash
  # Install via Chocolatey
  choco install jq
  
  # Or download from https://stedolan.github.io/jq/
  ```

## Setup Instructions

### 1. Verify Git Bash Installation
Open Git Bash and verify it's working:
```bash
git --version
bash --version
```

### 2. Clone the Repository
```bash
git clone https://github.com/Talk-Avocado/talk-avocado.git
cd talk-avocado
```

### 3. Test Windows Compatibility
Run the compatibility test to verify everything works:
```bash
./scripts/dev-tools/test-windows-compatibility.sh
```

You should see:
```
✅ All critical tests passed! The git workflow scripts should work on Windows.
```

## Using the Git Workflow Scripts

### Basic Commands
```bash
# Show help
./scripts/dev-tools/git-workflow.sh help

# Check MFU status
./scripts/dev-tools/git-workflow.sh mfu-status

# Validate project
./scripts/dev-tools/git-workflow.sh validate
```

### MFU Workflow Commands
```bash
# Create MFU branch (interactive)
./scripts/dev-tools/git-workflow.sh mfu-create

# Commit MFU progress (non-interactive)
./scripts/dev-tools/git-workflow.sh mfu-commit

# Complete MFU (merge to dev)
./scripts/dev-tools/git-workflow.sh mfu-complete

# Fast commit (skip validation)
./scripts/dev-tools/git-workflow.sh mfu-fast-commit
```

### Interactive Menu
Run without arguments to access the interactive menu:
```bash
./scripts/dev-tools/git-workflow.sh
```

## Windows-Specific Considerations

### 1. Path Separators
The scripts automatically handle Windows path separators. Git Bash converts Windows paths to Unix-style paths automatically.

### 2. Date Commands
The scripts use cross-platform date commands that work with both:
- **Windows Git Bash**: Uses GNU `date` command
- **Unix/Linux/macOS**: Uses BSD `date` command

### 3. Cache Directory
Validation cache is stored in:
```
%USERPROFILE%\.cache\consultancy-platform\validation\
```

### 4. File Permissions
Git Bash handles file permissions correctly for Windows. The scripts don't require special permissions.

## Troubleshooting

### Common Issues

#### 1. "Command not found" errors
**Problem**: Scripts can't find required commands
**Solution**: 
- Make sure you're running in Git Bash (not Command Prompt or PowerShell)
- Verify you're in the project root directory
- Check that Git is properly installed

#### 2. Date conversion errors
**Problem**: Date commands fail
**Solution**: 
- The scripts automatically detect Windows and use appropriate date commands
- If issues persist, check that Git Bash is up to date

#### 3. Cache directory issues
**Problem**: Can't create cache directory
**Solution**:
- Check that you have write permissions to your user directory
- The cache directory will be created automatically

#### 4. Interactive prompts not working
**Problem**: Scripts hang waiting for input
**Solution**:
- Use command-line arguments instead of interactive mode
- Example: `./scripts/dev-tools/git-workflow.sh mfu-commit` instead of running without arguments

### Getting Help

1. **Run the compatibility test**:
   ```bash
   ./scripts/dev-tools/test-windows-compatibility.sh
   ```

2. **Check script help**:
   ```bash
   ./scripts/dev-tools/git-workflow.sh help
   ```

3. **Enable debug mode** (if needed):
   ```bash
   bash -x ./scripts/dev-tools/git-workflow.sh mfu-status
   ```

## Features That Work on Windows

✅ **All core MFU workflow functions**
- Create MFU branches
- Commit MFU progress (with validation)
- Complete MFU (merge to dev)
- Fast commit (skip validation)

✅ **Validation system**
- Smart validation caching
- Cross-platform date handling
- File change detection

✅ **Git operations**
- Branch management
- Commit and push operations
- Merge operations

✅ **Interactive and non-interactive modes**
- Command-line arguments work perfectly
- Interactive menu works in Git Bash

## Features That May Need Additional Setup

⚠️ **Backend validation** (requires Python/Poetry)
- Install Python 3.11+ and Poetry
- Run: `cd backend && poetry install`

⚠️ **Frontend validation** (requires Node.js)
- Install Node.js 18+
- Run: `cd frontend && npm install`

⚠️ **Markdown linting** (optional)
- Install: `npm install -g markdownlint-cli2`

## Testing Your Setup

After setup, test these commands in order:

1. **Basic functionality**:
   ```bash
   ./scripts/dev-tools/git-workflow.sh help
   ```

2. **Project validation**:
   ```bash
   ./scripts/dev-tools/git-workflow.sh validate
   ```

3. **MFU status**:
   ```bash
   ./scripts/dev-tools/git-workflow.sh mfu-status
   ```

4. **Create a test MFU branch**:
   ```bash
   ./scripts/dev-tools/git-workflow.sh mfu-create
   # Select option 1 for MFU-DEVOPS-01-ongoing-improvements
   ```

5. **Test commit**:
   ```bash
   ./scripts/dev-tools/git-workflow.sh mfu-commit
   ```

If all these work, you're ready to use the git workflow scripts on Windows!

## Support

If you encounter issues not covered in this guide:

1. Check the compatibility test output
2. Verify you're using Git Bash (not Command Prompt)
3. Ensure you're in the project root directory
4. Check that all required dependencies are installed

The scripts are designed to be cross-platform and should work seamlessly on Windows with Git Bash.
