#!/bin/bash

# Windows Compatibility Test Script
# This script tests the git workflow functions on Windows with Git Bash

# Source the core module to get access to helper functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/modules/core.sh"

echo "Windows Compatibility Test for Git Workflow Scripts"
echo "=================================================="
echo ""

# Test 1: Check if we're running on Windows
echo "1. Testing Windows detection..."
if is_windows; then
  echo "   ✅ Windows environment detected: $OSTYPE"
else
  echo "   ℹ️  Not running on Windows: $OSTYPE"
fi
echo ""

# Test 2: Test date command compatibility
echo "2. Testing date command compatibility..."
current_time=$(date +%s)
echo "   Current timestamp: $current_time"

# Test timestamp to date conversion
test_date=$(timestamp_to_date "$current_time" "%Y-%m-%d %H:%M:%S")
echo "   Converted date: $test_date"

if [[ -n "$test_date" ]]; then
  echo "   ✅ Date conversion working"
else
  echo "   ❌ Date conversion failed"
fi
echo ""

# Test 3: Test file modification time
echo "3. Testing file modification time..."
test_file="scripts/dev-tools/git-workflow.sh"
if [[ -f "$test_file" ]]; then
  mod_time=$(get_file_modification_time "$test_file")
  echo "   File: $test_file"
  echo "   Modification time: $mod_time"
  if [[ "$mod_time" != "Unknown" ]]; then
    echo "   ✅ File modification time working"
  else
    echo "   ❌ File modification time failed"
  fi
else
  echo "   ⚠️  Test file not found: $test_file"
fi
echo ""

# Test 4: Test cache directory creation
echo "4. Testing cache directory creation..."
cache_file=$(get_validation_cache_file)
echo "   Cache file path: $cache_file"
if [[ -f "$cache_file" ]] || [[ -d "$(dirname "$cache_file")" ]]; then
  echo "   ✅ Cache directory accessible"
else
  echo "   ❌ Cache directory not accessible"
fi
echo ""

# Test 5: Test external dependencies
echo "5. Testing external dependencies..."
deps_ok=true

# Check Git
if command -v git >/dev/null 2>&1; then
  echo "   ✅ Git: $(git --version)"
else
  echo "   ❌ Git not found"
  deps_ok=false
fi

# Check Node.js (optional)
if command -v node >/dev/null 2>&1; then
  echo "   ✅ Node.js: $(node --version)"
else
  echo "   ⚠️  Node.js not found (optional for some features)"
fi

# Check Python (optional)
if command -v python3 >/dev/null 2>&1; then
  echo "   ✅ Python3: $(python3 --version)"
else
  echo "   ⚠️  Python3 not found (optional for some features)"
fi

# Check jq (optional)
if command -v jq >/dev/null 2>&1; then
  echo "   ✅ jq: $(jq --version)"
else
  echo "   ⚠️  jq not found (optional for enhanced caching)"
fi

# Check Poetry (optional)
if command -v poetry >/dev/null 2>&1; then
  echo "   ✅ Poetry: $(poetry --version)"
else
  echo "   ⚠️  Poetry not found (optional for backend features)"
fi

echo ""

# Test 6: Test basic git workflow functions
echo "6. Testing basic git workflow functions..."

# Test project root detection
if ensure_project_root; then
  echo "   ✅ Project root detection working"
else
  echo "   ❌ Project root detection failed"
  deps_ok=false
fi

# Test branch detection
current_branch=$(get_current_branch)
echo "   Current branch: $current_branch"
if [[ "$current_branch" != "unknown" ]]; then
  echo "   ✅ Branch detection working"
else
  echo "   ❌ Branch detection failed"
  deps_ok=false
fi

echo ""

# Test 7: Test MFU workflow functions (dry run)
echo "7. Testing MFU workflow functions..."

# Test validation cache functions
if is_validation_cache_valid; then
  echo "   ✅ Validation cache system working"
else
  echo "   ℹ️  Validation cache not valid (expected for first run)"
fi

echo ""

# Summary
echo "Windows Compatibility Test Summary"
echo "=================================="
if [[ "$deps_ok" == "true" ]]; then
  echo "✅ All critical tests passed! The git workflow scripts should work on Windows."
  echo ""
  echo "Next steps for Radha:"
  echo "1. Run: ./scripts/dev-tools/git-workflow.sh help"
  echo "2. Test: ./scripts/dev-tools/git-workflow.sh mfu-status"
  echo "3. Test: ./scripts/dev-tools/git-workflow.sh validate"
  echo ""
  echo "If you encounter any issues:"
  echo "- Make sure you're running in Git Bash (not Command Prompt or PowerShell)"
  echo "- Ensure you're in the project root directory"
  echo "- Check that Git is properly installed and configured"
else
  echo "❌ Some tests failed. Please check the issues above."
  echo ""
  echo "Common fixes:"
  echo "- Make sure you're running in Git Bash"
  echo "- Ensure you're in the project root directory"
  echo "- Install missing dependencies if needed"
fi

echo ""
echo "Test completed at: $(date)"
