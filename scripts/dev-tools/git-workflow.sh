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

# Main menu function
show_menu() {
  echo "Talk Avocado Development Workflow v$SCRIPT_VERSION"
  echo "-------------------------------------------"
  echo ""
  echo "MFU Workflow:"
  echo "1) Create MFU branch"
  echo "2) Commit MFU progress (with validation)"
  echo "3) Fast commit MFU progress (skip validation)"
  echo "4) Complete MFU (merge to dev)"
  echo "5) Release (merge dev→main + tag)"
  echo "6) Show MFU status"
  echo "7) Clean up completed MFU branches"
  echo ""
  echo "General git:"
  echo "8) Push current branch"
  echo "9) Sync with main (fetch/rebase)"
  echo "10) Validate all"
  echo ""
  echo "Lint & Docs:"
  echo "11) Check markdown lint issues"
  echo "12) Fix markdown lint issues"
  echo ""
  echo "0) Exit"
  echo ""
  read -r -p "Select an option: " choice
}

# Main execution function
main() {
  case $choice in
    1) create_mfu_branch ;;
    2) commit_mfu_progress ;;
    3) fast_commit_mfu_progress ;;
    4) complete_mfu ;;
    5) merge_dev_to_main ;;
    6) show_mfu_status ;;
    7) cleanup_completed_mfu_branches ;;
    8) push_current_branch ;;
    9) sync_main ;;
    10) validate_all ;;
    11) check_markdown_lint ;;
    12) fix_markdown_lint ;;
    
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
    "mfu-commit") commit_mfu_progress ;;
    "mfu-fast-commit") fast_commit_mfu_progress ;;
    "mfu-complete") complete_mfu ;;
    "mfu-release") merge_dev_to_main ;;
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

    # Help
    "help"|"-h"|"--help")
      echo "Usage: $SCRIPT_NAME [command]"
      echo ""
      echo "Available commands:"
      echo "  MFU: mfu-create, mfu-commit, mfu-fast-commit, mfu-complete, mfu-release, mfu-status, mfu-cleanup"
      echo "  Docs: check-markdown, fix-markdown"
      echo "  General: push, sync, validate, commit-structured"
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