#!/bin/bash

# Talk Avocado Git Workflow Helper
# Simplified for this project - sources essential modules

# Script version and info
SCRIPT_VERSION="3.0.0"
SCRIPT_NAME="git-workflow.sh"

# CHANGELOG v3.0.0:
# - Pruned frontend/backend specific menus and commands
# - Focused on MFU workflow + lightweight linting for docs/scripts
# - Reordered menu to fit this project's needs

# Source essential modules
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/modules/core.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/modules/validation.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/modules/mfu.sh"

# Local helpers for this project
push_current_branch() {
  echo -e "${BLUE}Pushing current branch...${NC}"
  local branch
  branch=$(get_current_branch)
  if [[ -z "$branch" || "$branch" == "unknown" ]]; then
    echo -e "${RED}❌ Could not determine current branch${NC}"
    return 1
  fi
  if git push -u origin "$branch"; then
    echo -e "${GREEN}✅ Pushed '$branch' to origin${NC}"
  else
    echo -e "${RED}❌ Push failed${NC}"
    return 1
  fi
}

validate_all() {
  echo -e "${BLUE}Running project validations...${NC}"
  local ok=true
  if ! check_markdown_lint; then ok=false; fi
  if [[ "$ok" == true ]]; then
    echo -e "${GREEN}✅ All validations passed${NC}"
    return 0
  else
    echo -e "${YELLOW}⚠️  Some validations reported issues${NC}"
    return 1
  fi
}

# Run comprehensive CI/CD validation matching GitHub Actions workflow
run_cicd_validation() {
  echo -e "${BLUE}Running comprehensive CI/CD validation...${NC}"
  echo -e "${BLUE}This matches the GitHub Actions CI/CD pipeline${NC}"
  echo ""
  
  local ok=true
  local node_ok=true
  local python_ok=true
  local harness_ok=true
  
  # Node.js validation (matches CI node job)
  echo -e "${CYAN}🔍 Node.js Validation${NC}"
  echo "  Installing dependencies..."
  if [[ -f package.json ]]; then
    if npm ci 2>/dev/null || npm install 2>/dev/null; then
      echo -e "${GREEN}  ✅ Dependencies installed${NC}"
    else
      echo -e "${RED}  ❌ Failed to install dependencies${NC}"
      node_ok=false
    fi
    
    echo "  Running ESLint..."
    if npm run lint 2>/dev/null; then
      echo -e "${GREEN}  ✅ ESLint passed${NC}"
    else
      echo -e "${RED}  ❌ ESLint failed${NC}"
      node_ok=false
    fi
    
    echo "  Checking ES Module compliance..."
    if npm run check-es-modules 2>/dev/null; then
      echo -e "${GREEN}  ✅ ES Module compliance passed${NC}"
    else
      echo -e "${RED}  ❌ ES Module compliance failed${NC}"
      node_ok=false
    fi
    
    echo "  Checking code formatting..."
    if npm run format:check 2>/dev/null; then
      echo -e "${GREEN}  ✅ Code formatting passed${NC}"
    else
      echo -e "${YELLOW}  ⚠️  Code formatting issues found${NC}"
      echo -e "${YELLOW}     Run 'npm run format' to fix${NC}"
    fi
    
    echo "  Running tests..."
    if npm test --silent 2>/dev/null; then
      echo -e "${GREEN}  ✅ Tests passed${NC}"
    else
      echo -e "${YELLOW}  ⚠️  No tests or tests failed${NC}"
    fi
  else
    echo -e "${YELLOW}  ⚠️  No package.json found, skipping Node validation${NC}"
  fi
  
  echo ""
  
  # Python validation (matches CI python job)
  echo -e "${CYAN}🐍 Python Validation${NC}"
  if [[ -f requirements.txt || -f pyproject.toml ]]; then
    echo "  Setting up Python environment..."
    if python -m venv .venv 2>/dev/null; then
      echo -e "${GREEN}  ✅ Virtual environment created${NC}"
    else
      echo -e "${YELLOW}  ⚠️  Virtual environment setup failed${NC}"
    fi
    
    echo "  Installing dependencies..."
    if source .venv/bin/activate 2>/dev/null && pip install --upgrade pip 2>/dev/null; then
      if [[ -f requirements.txt ]]; then
        pip install -r requirements.txt 2>/dev/null || true
      fi
      if [[ -f pyproject.toml ]]; then
        pip install -e . 2>/dev/null || true
      fi
      pip install black ruff pytest 2>/dev/null || true
      echo -e "${GREEN}  ✅ Dependencies installed${NC}"
    else
      echo -e "${YELLOW}  ⚠️  Dependency installation had issues${NC}"
    fi
    
    echo "  Running Python linting..."
    if source .venv/bin/activate 2>/dev/null && ruff . 2>/dev/null; then
      echo -e "${GREEN}  ✅ Ruff linting passed${NC}"
    else
      echo -e "${YELLOW}  ⚠️  Ruff linting had issues${NC}"
    fi
    
    echo "  Checking Python formatting..."
    if source .venv/bin/activate 2>/dev/null && black --check . 2>/dev/null; then
      echo -e "${GREEN}  ✅ Black formatting passed${NC}"
    else
      echo -e "${YELLOW}  ⚠️  Black formatting had issues${NC}"
    fi
    
    echo "  Running Python tests..."
    if source .venv/bin/activate 2>/dev/null && pytest -q 2>/dev/null; then
      echo -e "${GREEN}  ✅ Python tests passed${NC}"
    else
      echo -e "${YELLOW}  ⚠️  No Python tests or tests failed${NC}"
    fi
  else
    echo -e "${YELLOW}  ⚠️  No Python files found, skipping Python validation${NC}"
  fi
  
  echo ""
  
  # Harness validation (matches CI harness job)
  echo -e "${CYAN}🧪 Harness Validation${NC}"
  if [[ -d backend && -f tools/harness/run-local-pipeline-simple.js ]]; then
    echo "  Installing backend dependencies..."
    if cd backend && npm ci 2>/dev/null || npm install 2>/dev/null; then
      echo -e "${GREEN}  ✅ Backend dependencies installed${NC}"
    else
      echo -e "${RED}  ❌ Backend dependency installation failed${NC}"
      harness_ok=false
    fi
    cd .. 2>/dev/null || true
    
    echo "  Building backend..."
    if cd backend && npm run build 2>/dev/null; then
      echo -e "${GREEN}  ✅ Backend build successful${NC}"
    else
      echo -e "${RED}  ❌ Backend build failed${NC}"
      harness_ok=false
    fi
    cd .. 2>/dev/null || true
    
    echo "  Running harness test..."
    if [[ -f podcast-automation/test-assets/raw/sample-short.mp4 && -d podcast-automation/test-assets/goldens/sample-short ]]; then
      if node tools/harness/run-local-pipeline-simple.js \
          --input podcast-automation/test-assets/raw/sample-short.mp4 \
          --goldens podcast-automation/test-assets/goldens/sample-short \
          --env dev 2>/dev/null; then
        echo -e "${GREEN}  ✅ Harness test passed${NC}"
      else
        echo -e "${RED}  ❌ Harness test failed${NC}"
        harness_ok=false
      fi
    else
      echo -e "${YELLOW}  ⚠️  Harness test assets not found, skipping harness test${NC}"
    fi
  else
    echo -e "${YELLOW}  ⚠️  Harness components not found, skipping harness validation${NC}"
  fi
  
  echo ""
  
  # Summary
  echo -e "${BLUE}📊 CI/CD Validation Summary${NC}"
  if [[ "$node_ok" == true ]]; then
    echo -e "${GREEN}  ✅ Node.js validation: PASSED${NC}"
  else
    echo -e "${RED}  ❌ Node.js validation: FAILED${NC}"
    ok=false
  fi
  
  if [[ "$python_ok" == true ]]; then
    echo -e "${GREEN}  ✅ Python validation: PASSED${NC}"
  else
    echo -e "${YELLOW}  ⚠️  Python validation: ISSUES (non-blocking)${NC}"
  fi
  
  if [[ "$harness_ok" == true ]]; then
    echo -e "${GREEN}  ✅ Harness validation: PASSED${NC}"
  else
    echo -e "${RED}  ❌ Harness validation: FAILED${NC}"
    ok=false
  fi
  
  echo ""
  if [[ "$ok" == true ]]; then
    echo -e "${GREEN}🎉 All CI/CD validations passed!${NC}"
    echo -e "${GREEN}   Your code is ready for CI/CD pipeline${NC}"
    return 0
  else
    echo -e "${RED}❌ Some CI/CD validations failed${NC}"
    echo -e "${YELLOW}   Fix the issues above before committing${NC}"
    return 1
  fi
}

# Enhanced MFU commit with CI/CD validation
commit_mfu_progress_with_cicd() {
  echo -e "${BLUE}Committing MFU progress with CI/CD validation...${NC}"
  
  # Run CI/CD validation first
  if ! run_cicd_validation; then
    echo -e "${RED}❌ CI/CD validation failed. Fix issues before committing.${NC}"
    echo -e "${YELLOW}   Use command 13 to run CI/CD validation manually${NC}"
    return 1
  fi
  
  # If CI/CD validation passes, proceed with normal MFU commit
  echo -e "${GREEN}✅ CI/CD validation passed, proceeding with commit...${NC}"
  commit_mfu_progress
}

# Enhanced MFU complete with CI/CD validation
complete_mfu_with_cicd() {
  echo -e "${BLUE}Completing MFU with CI/CD validation...${NC}"
  
  # Run CI/CD validation first
  if ! run_cicd_validation; then
    echo -e "${RED}❌ CI/CD validation failed. Fix issues before completing MFU.${NC}"
    echo -e "${YELLOW}   Use command 13 to run CI/CD validation manually${NC}"
    return 1
  fi
  
  # If CI/CD validation passes, proceed with normal MFU complete
  echo -e "${GREEN}✅ CI/CD validation passed, proceeding with MFU completion...${NC}"
  complete_mfu
}

# Enhanced release with CI/CD validation
merge_dev_to_main_with_cicd() {
  echo -e "${BLUE}Releasing with CI/CD validation...${NC}"
  
  # Run CI/CD validation first
  if ! run_cicd_validation; then
    echo -e "${RED}❌ CI/CD validation failed. Fix issues before releasing.${NC}"
    echo -e "${YELLOW}   Use command 13 to run CI/CD validation manually${NC}"
    return 1
  fi
  
  # If CI/CD validation passes, proceed with normal release
  echo -e "${GREEN}✅ CI/CD validation passed, proceeding with release...${NC}"
  merge_dev_to_main
}

# Main menu function
show_menu() {
  echo "Talk Avocado Development Workflow v$SCRIPT_VERSION"
  echo "-------------------------------------------"
  echo ""
  echo "MFU Workflow:"
  echo "1) Create MFU branch"
  echo "2) Fast commit MFU progress (skip validation)"
  echo "3) Commit MFU progress (with CI/CD validation)"
  echo "4) Complete MFU (merge to dev with CI/CD validation)"
  echo "5) Release (merge dev→main + tag with CI/CD validation)"
  echo "6) Show MFU status"
  echo "7) Clean up completed MFU branches"
  echo ""
  echo "General git:"
  echo "8) Push current branch"
  echo "9) Sync with main (fetch/rebase)"
  echo "10) Validate all (markdown only)"
  echo ""
  echo "Lint & Docs:"
  echo "11) Check markdown lint issues"
  echo "12) Fix markdown lint issues"
  echo "13) Run full CI/CD validation (linting, testing, harness)"
  echo ""
  echo "Local API:"
  echo "14) Start backend API server (dev)"
  echo ""
  echo "0) Exit"
  echo ""
  read -r -p "Select an option: " choice
}

# Main execution function
main() {
  case $choice in
    1) create_mfu_branch ;;
    2) fast_commit_mfu_progress ;;
    3) commit_mfu_progress_with_cicd ;;
    4) complete_mfu_with_cicd ;;
    5) merge_dev_to_main_with_cicd ;;
    6) show_mfu_status ;;
    7) cleanup_completed_mfu_branches ;;
    8) push_current_branch ;;
    9) sync_main ;;
    10) validate_all ;;
    11) check_markdown_lint ;;
    12) fix_markdown_lint ;;
<<<<<<< HEAD
    13) run_cicd_validation ;;
    14) api_up ;;
=======
    13) run_cicd_validation ;;
>>>>>>> origin/dev
    
    0) echo "Goodbye!"; exit 0 ;;
    *) echo "Invalid option. Please try again." ;;
  esac
}

# Handle command line arguments
if [[ $# -eq 0 ]]; then
  # No arguments - show interactive menu
  # Check if input is being piped (non-interactive)
  if [[ ! -t 0 ]]; then
    echo "Error: Cannot run interactive menu with piped input."
    echo "Use command line arguments instead:"
    echo "  ./scripts/dev-tools/git-workflow.sh help"
    echo "  ./scripts/dev-tools/git-workflow.sh commit"
    echo "  ./scripts/dev-tools/git-workflow.sh commit-structured"
    exit 1
  fi
  
  # Interactive menu
  while true; do
    show_menu
    main
    echo ""
    read -r -p "Press Enter to continue..."
  done
else
  # Handle command line arguments
  case "$1" in
    # MFU commands
    "mfu-create") create_mfu_branch ;;
    "mfu-commit") commit_mfu_progress_with_cicd ;;
    "mfu-fast-commit") fast_commit_mfu_progress ;;
    "mfu-complete") complete_mfu_with_cicd ;;
    "mfu-release") merge_dev_to_main_with_cicd ;;
    "mfu-status") show_mfu_status ;;
    "mfu-cleanup") cleanup_completed_mfu_branches ;;

    # General git
    "push") push_current_branch ;;
    "sync") sync_main ;;
    "validate") validate_all ;;
    "commit-structured") run_structured_commit_process ;;

    # Docs/lint
    "check-markdown") check_markdown_lint ;;
    "fix-markdown") fix_markdown_lint ;;
    "cicd-validation") run_cicd_validation ;;

    # Local API server
    "api-up") api_up ;;

    # Help
    "help"|"-h"|"--help")
      echo "Usage: $SCRIPT_NAME [command]"
      echo ""
      echo "Available commands:"
      echo "  MFU: mfu-create, mfu-commit, mfu-fast-commit, mfu-complete, mfu-release, mfu-status, mfu-cleanup"
      echo "  Docs: check-markdown, fix-markdown"
      echo "  CI/CD: cicd-validation"
      echo "  General: push, sync, validate, commit-structured"
      echo "  Local API: api-up"
      echo ""
      echo "Run without arguments for interactive menu."
      ;;

    *)
      echo "Unknown command: $1"
      echo "Run '$SCRIPT_NAME help' for available commands."
      exit 1
      ;;
  esac
fi 