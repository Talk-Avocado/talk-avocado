#!/bin/bash

# MFU (Minimum Feature Unit) functions for the git workflow system
# This module contains all MFU workflow and optimization functions

# Core utilities are already sourced by the main script

# Configure git to prevent vi from opening during merges
# This ensures merge operations don't require user interaction
if ! git config --local core.mergeoptions >/dev/null 2>&1; then
  git config --local core.mergeoptions "--no-edit"
fi

# MFU branch management
create_mfu_branch() {
  echo -e "${BLUE}Creating MFU branch...${NC}"
  
  ensure_project_root || return 1
  
  # Get available MFUs from the backlog
  local mfu_files
  mfu_files=$(find docs/mfu-backlog -name "MFU-*.md" -type f | sort)
  
  if [[ -z "$mfu_files" ]]; then
    echo -e "${RED}❌ No MFU files found in docs/mfu-backlog${NC}"
    return 1
  fi
  
  # Display available MFUs
  echo -e "${BLUE}Available MFUs in current work cycle:${NC}"
  echo ""
  
  local index=1
  local mfu_options=()
  local mfu_names=()
  
  while IFS= read -r mfu_file; do
    local filename
    filename=$(basename "$mfu_file" .md)
    
    # Extract MFU name and description
    local title
    title=$(head -n 5 "$mfu_file" | grep -E "^# " | head -n 1 | sed 's/^# //')
    
    if [[ -z "$title" ]]; then
      title="$filename"
    fi
    
    # Only show title if it's different from filename
    if [[ "$title" == "$filename" ]]; then
      echo "$index) $filename"
    else
      echo "$index) $filename"
      echo "   $title"
    fi
    echo ""
    
    mfu_options+=("$filename")
    mfu_names+=("$title")
    ((index++))
  done <<< "$mfu_files"
  
  # Get user selection
  local choice
  read -r -p "Select MFU number (or press Enter for custom name): " choice
  
  local branch_name
  
  if [[ -z "$choice" ]]; then
    # Custom branch name
    read -r -p "Enter custom MFU branch name (e.g., mfu-auth-01): " branch_name
  elif [[ "$choice" =~ ^[0-9]+$ ]] && [[ $choice -ge 1 ]] && [[ $choice -le ${#mfu_options[@]} ]]; then
    # Valid selection
    local selected_index=$((choice - 1))
    branch_name="${mfu_options[$selected_index]}"
    echo -e "${GREEN}Selected: ${mfu_names[$selected_index]}${NC}"
  else
    echo -e "${RED}❌ Invalid selection${NC}"
    return 1
  fi
  
  if [[ -z "$branch_name" ]]; then
    echo -e "${RED}❌ Branch name cannot be empty${NC}"
    return 1
  fi
  
  # Ensure we're on dev branch
  local current_branch
  current_branch=$(get_current_branch)
  
  if [[ "$current_branch" != "dev" ]]; then
    echo -e "${YELLOW}⚠️  Switching to dev branch...${NC}"
    if ! git checkout dev; then
      echo -e "${RED}❌ Failed to switch to dev branch${NC}"
      return 1
    fi
  fi
  
  # Pull latest changes
  echo "Pulling latest changes from dev..."
  if ! git pull origin dev; then
    echo -e "${RED}❌ Failed to pull latest changes${NC}"
    return 1
  fi
  
  # Create and switch to new branch
  echo "Creating MFU branch: $branch_name"
  if ! git checkout -b "$branch_name"; then
    echo -e "${RED}❌ Failed to create MFU branch${NC}"
    return 1
  fi
  
  echo -e "${GREEN}✅ MFU branch '$branch_name' created successfully${NC}"
  return 0
}

# MFU validation requirements
determine_mfu_validation_requirements() {
  local validation_level="standard"
  
  # Check if this is a critical MFU
  if [[ "$(get_current_branch)" == *"auth"* ]] || [[ "$(get_current_branch)" == *"security"* ]]; then
    validation_level="full"
  fi
  
  # Check if there are significant changes
  local changed_files
  changed_files=$(git diff --name-only HEAD~1 2>/dev/null | wc -l)
  
  if [[ $changed_files -gt 50 ]]; then
    validation_level="full"
  fi
  
  echo "$validation_level"
}

# MFU context validation (now uses smart coordinator logic)
run_mfu_context_validation() {
  echo -e "${BLUE}Running MFU context validation...${NC}"
  
  ensure_project_root || return 1
  
  # Check cache first for any validation type
  local cache_hit=false
  for validation_type in "mfu-context" "validation-coordinator" "frontend" "backend"; do
    if is_validation_type_cached "$validation_type"; then
      local cached_result
      cached_result=$(get_validation_result "$validation_type")
      if [[ "$cached_result" == "success" ]]; then
        echo -e "${GREEN}✅ Using cached $validation_type validation result${NC}"
        save_validation_result "standard" "success" "mfu-context"
        return 0
      fi
    fi
  done
  
  # Use the smart validation coordinator logic
  local changed_categories
  changed_categories=$(classify_changed_files)
  if [[ -z "$changed_categories" ]]; then
    echo -e "${GREEN}No relevant files changed since last validation. Skipping all validations.${NC}"
    save_validation_result "standard" "success" "mfu-context"
    return 0
  fi

  echo "Detected changed categories: $changed_categories"

  local validation_passed=true
  local validation_level="standard"
  local ran_any=0

  # If scripts changed, run all validations
  if [[ "$changed_categories" =~ scripts ]]; then
    echo -e "${YELLOW}Scripts changed. Running all validations and invalidating all caches.${NC}"
    clear_validation_cache
    changed_categories="frontend backend docs config other"
  fi

  # If only docs changed
  if [[ "$changed_categories" =~ ^docs$ ]]; then
    echo -e "${BLUE}Only documentation files changed. Skipping code validation.${NC}"
    save_validation_result "$validation_level" "success" "mfu-context"
    return 0
  fi

  # Run frontend validation if needed (skip if frontend doesn't exist)
  if [[ "$changed_categories" =~ frontend ]]; then
    if [[ -d "frontend" ]]; then
      echo "🔄 Frontend validation (due to frontend changes)..."
      if cd frontend && run_smart_frontend_validation "$validation_level"; then
        echo -e "${GREEN}✅ Frontend validation completed${NC}"
        ran_any=1
      else
        echo -e "${RED}❌ Frontend validation failed${NC}"
        validation_passed=false
        ran_any=1
      fi
      cd - > /dev/null || return 1
    else
      echo -e "${YELLOW}⚠️  Frontend changes detected but no frontend directory${NC}"
    fi
  fi

  # Run backend validation if needed (skip if backend doesn't exist)
  if [[ "$changed_categories" =~ backend ]]; then
    if [[ -d "backend" ]]; then
      echo "🔄 Backend validation (due to backend changes)..."
      if cd backend && run_smart_backend_validation "$validation_level"; then
        echo -e "${GREEN}✅ Backend validation completed${NC}"
        ran_any=1
      else
        echo -e "${RED}❌ Backend validation failed${NC}"
        validation_passed=false
        ran_any=1
      fi
      cd - > /dev/null || return 1
    else
      echo -e "${YELLOW}⚠️  Backend changes detected but no backend directory${NC}"
    fi
  fi

  # Run middleware validation if needed (if backend or frontend or scripts changed)
  if [[ "$changed_categories" =~ frontend ]] || [[ "$changed_categories" =~ backend ]] || [[ "$changed_categories" =~ scripts ]]; then
    echo "🔄 Middleware validation (due to code changes)..."
    if run_smart_middleware_validation; then
      echo -e "${GREEN}✅ Middleware validation completed${NC}"
      ran_any=1
    else
      echo -e "${RED}❌ Middleware validation failed${NC}"
      validation_passed=false
      ran_any=1
    fi
  fi

  # If only docs/config/other changed, print message
  if [[ $ran_any -eq 0 ]]; then
    echo -e "${YELLOW}No code changes detected that require validation. Skipping code validation.${NC}"
    save_validation_result "$validation_level" "success" "mfu-context"
    return 0
  fi

  if [[ "$validation_passed" == "true" ]]; then
    echo -e "${GREEN}✅ MFU context validation passed${NC}"
    save_validation_result "$validation_level" "success" "mfu-context"
    return 0
  else
    echo -e "${RED}❌ MFU context validation failed${NC}"
    save_validation_result "$validation_level" "failed" "mfu-context"
    return 1
  fi
}

# MFU progress commit (now with integrated caching and smart validation)
commit_mfu_progress() {
  echo -e "${BLUE}Committing MFU progress...${NC}"
  
  ensure_project_root || return 1
  
  # Check if we're on an MFU branch
  local current_branch
  current_branch=$(get_current_branch)
  
  if [[ ! "$current_branch" =~ ^[Mm][Ff][Uu]- ]]; then
    echo -e "${RED}❌ Not on an MFU branch${NC}"
    return 1
  fi
  
  # Run validation before commit (now uses smart validation with caching)
  echo "Running pre-commit validation..."
  if ! run_mfu_context_validation; then
    echo -e "${RED}❌ Validation failed - commit aborted${NC}"
    return 1
  fi
  
  # Use the structured commit process
  run_structured_commit_process
}

# Fast MFU progress commit (skips validation for rapid development)
fast_commit_mfu_progress() {
  echo -e "${BLUE}Fast committing MFU progress (skipping validation)...${NC}"
  
  ensure_project_root || return 1
  
  # Check if we're on an MFU branch
  local current_branch
  current_branch=$(get_current_branch)
  
  if [[ ! "$current_branch" =~ ^[Mm][Ff][Uu]- ]]; then
    echo -e "${RED}❌ Not on an MFU branch${NC}"
    return 1
  fi
  
  echo -e "${YELLOW}⚠️  Skipping validation for rapid development commit${NC}"
  echo -e "${YELLOW}⚠️  Remember to run full validation before completing the MFU${NC}"
  
  # Use the structured commit process with --no-verify to skip hooks
  run_fast_structured_commit_process
}

# Complete MFU
complete_mfu() {
  echo -e "${BLUE}Completing MFU...${NC}"
  
  ensure_project_root || return 1
  
  # Check if we're on an MFU branch
  local current_branch
  current_branch=$(get_current_branch)
  
  if [[ ! "$current_branch" =~ ^[Mm][Ff][Uu]- ]]; then
    echo -e "${RED}❌ Not on an MFU branch${NC}"
    return 1
  fi
  
  # Run final validation
  echo "Running final validation..."
  if ! run_mfu_context_validation; then
    echo -e "${RED}❌ Final validation failed - cannot complete MFU${NC}"
    return 1
  fi
  
  # Clean up any validation cache files that might interfere with git operations
  if [[ -d ".mfu-validation-cache-local" ]]; then
    echo "Cleaning up local validation cache files..."
    rm -rf ".mfu-validation-cache-local"
  fi
  
  # Stash any remaining uncommitted changes before switching branches
  if ! git diff-index --quiet HEAD --; then
    echo "Stashing uncommitted changes before branch switch..."
    git stash push -m "Auto-stash before MFU completion - $(date)"
  fi
  
  # Switch to dev branch
  echo "Switching to dev branch..."
  if ! git checkout dev; then
    echo -e "${RED}❌ Failed to switch to dev branch${NC}"
    return 1
  fi
  
  # Pull latest changes
  echo "Pulling latest changes..."
  if ! git pull origin dev; then
    echo -e "${RED}❌ Failed to pull latest changes${NC}"
    return 1
  fi
  
  # Merge MFU branch (no-edit to prevent vi from opening)
  echo "Merging MFU branch..."
  if ! git merge --no-edit "$current_branch"; then
    echo -e "${RED}❌ Failed to merge MFU branch${NC}"
    echo "Please resolve conflicts and try again"
    return 1
  fi
  
  # Note: MFU branch is preserved for work cycle completion
  echo -e "${BLUE}ℹ️  MFU branch '$current_branch' preserved for work cycle completion${NC}"
  echo -e "${BLUE}ℹ️  Branch will be deleted when work cycle is complete${NC}"
  
  # Restore stashed changes if any
  if git stash list | grep -q "Auto-stash before MFU completion"; then
    echo "Restoring stashed changes..."
    if ! git stash pop; then
      echo -e "${YELLOW}⚠️  Could not automatically restore stashed changes${NC}"
      echo "Please check 'git stash list' and restore manually if needed"
    fi
  fi
  
  # Push dev branch changes to remote
  echo "Pushing dev branch changes to remote..."
  if ! git push origin dev; then
    echo -e "${YELLOW}⚠️  Failed to push dev branch changes to remote${NC}"
  else
    echo -e "${GREEN}✅ Dev branch changes pushed to remote successfully${NC}"
  fi
  
  echo -e "${GREEN}✅ MFU completed successfully${NC}"
  return 0
}

# Merge dev to main
merge_dev_to_main() {
  echo -e "${BLUE}Merging dev to main...${NC}"
  
  ensure_project_root || return 1
  
  # Check if we're on dev branch
  local current_branch
  current_branch=$(get_current_branch)
  
  if [[ "$current_branch" != "dev" ]]; then
    echo -e "${RED}❌ Must be on dev branch to merge to main${NC}"
    return 1
  fi
  
  # Run validation
  echo "Running validation before merge..."
  if ! run_mfu_context_validation; then
    echo -e "${RED}❌ Validation failed - merge aborted${NC}"
    return 1
  fi
  
  # Clean up any validation cache files that might interfere with git operations
  if [[ -d ".mfu-validation-cache-local" ]]; then
    echo "Cleaning up local validation cache files..."
    rm -rf ".mfu-validation-cache-local"
  fi
  
  # Stash any remaining uncommitted changes before switching branches
  if ! git diff-index --quiet HEAD --; then
    echo "Stashing uncommitted changes before branch switch..."
    git stash push -m "Auto-stash before dev-to-main merge - $(date)"
  fi
  
  # Switch to main branch
  echo "Switching to main branch..."
  if ! git checkout main; then
    echo -e "${RED}❌ Failed to switch to main branch${NC}"
    return 1
  fi
  
  # Pull latest changes
  echo "Pulling latest changes..."
  if ! git pull origin main; then
    echo -e "${RED}❌ Failed to pull latest changes${NC}"
    return 1
  fi
  
  # Merge dev (no-edit to prevent vi from opening)
  echo "Merging dev branch..."
  if ! git merge --no-edit dev; then
    echo -e "${RED}❌ Failed to merge dev branch${NC}"
    echo "Please resolve conflicts and try again"
    return 1
  fi
  
  # Create tag
  local default_tag
  default_tag="release-$(date +%Y%m%d-%H%M%S)"
  
  echo -e "${BLUE}Creating release tag...${NC}"
  echo "Suggested tag: $default_tag"
  read -r -p "Enter version tag (or press Enter for default): " version
  
  if [[ -z "$version" ]]; then
    version="$default_tag"
  fi
  
  echo "Creating version tag: $version"
  if ! git tag "$version"; then
    echo -e "${YELLOW}⚠️  Failed to create version tag${NC}"
  else
    echo -e "${GREEN}✅ Version tag '$version' created successfully${NC}"
    
    # Push the tag to remote
    echo "Pushing tag to remote..."
    if ! git push origin "$version"; then
      echo -e "${YELLOW}⚠️  Failed to push tag to remote${NC}"
    else
      echo -e "${GREEN}✅ Tag pushed to remote successfully${NC}"
    fi
    
    # Push main branch changes
    echo "Pushing main branch changes..."
    if ! git push origin main; then
      echo -e "${YELLOW}⚠️  Failed to push main branch changes${NC}"
    else
      echo -e "${GREEN}✅ Main branch changes pushed successfully${NC}"
    fi
  fi
  
  # Restore stashed changes if any
  if git stash list | grep -q "Auto-stash before dev-to-main merge"; then
    echo "Restoring stashed changes..."
    if ! git stash pop; then
      echo -e "${YELLOW}⚠️  Could not automatically restore stashed changes${NC}"
      echo "Please check 'git stash list' and restore manually if needed"
    fi
  fi
  
  echo -e "${GREEN}✅ Dev merged to main successfully${NC}"
  return 0
}

# Show MFU status
show_mfu_status() {
  echo -e "${BLUE}MFU Status:${NC}"
  
  local current_branch
  current_branch=$(get_current_branch)
  
  echo "  Current branch: $current_branch"
  
  if [[ "$current_branch" =~ ^mfu- ]]; then
    echo "  Status: Working on MFU"
    
    # Show recent commits
    echo "  Recent commits:"
    git log --oneline -5
    
    # Show uncommitted changes
    if ! git diff-index --quiet HEAD --; then
      echo "  Uncommitted changes:"
      git status --short
    fi
  elif [[ "$current_branch" == "dev" ]]; then
    echo "  Status: On dev branch"
    
    # Show recent MFU merges
    echo "  Recent MFU merges:"
    git log --oneline --grep="Merge.*mfu-" -5
  elif [[ "$current_branch" == "main" ]]; then
    echo "  Status: On main branch"
    
    # Show recent releases
    echo "  Recent releases:"
    git tag --sort=-version:refname | head -5
  else
    echo "  Status: On feature branch"
  fi
}

# MFU validation coordinator (DEPRECATED - functionality moved to run_mfu_context_validation)
run_mfu_validation_coordinator() {
  echo -e "${YELLOW}⚠️  run_mfu_validation_coordinator is deprecated. Use commit_mfu_progress instead.${NC}"
  echo -e "${BLUE}Redirecting to improved MFU context validation...${NC}"
  run_mfu_context_validation
}

# Enhanced duplicate detection
run_enhanced_duplicate_detection() {
  echo -e "${BLUE}Running enhanced duplicate detection...${NC}"
  ensure_project_root || return 1
  local duplicates_found=0

  backend_duplicate_count() {
    local count=0
    cd backend || return 1
    while IFS= read -r -d '' file; do
      if [[ "$file" == *.py ]]; then
        local function_names
        function_names=$(grep "^def " "$file" 2>/dev/null | sed 's/^def //' | sed 's/(.*//' | sort | uniq -d)
        if [[ -n "$function_names" ]]; then
          echo -e "${YELLOW}⚠️  Duplicate function names in $file:${NC}"
          while IFS= read -r line; do echo "  $line"; done <<< "$function_names"
          count=$((count + 1))
        fi
      fi
    done < <(find app -name "*.py" -type f -print0 2>/dev/null)
    echo "$count"
  }

  frontend_duplicate_count() {
    local count=0
    cd frontend || return 1
    while IFS= read -r -d '' file; do
      if [[ "$file" == *.tsx ]] || [[ "$file" == *.jsx ]]; then
        local component_names
        component_names=$(grep -E "export.*function|export.*const.*=" "$file" 2>/dev/null | sed 's/export.*function //' | sed 's/export.*const //' | sed 's/=.*//' | sort | uniq -d)
        if [[ -n "$component_names" ]]; then
          echo -e "${YELLOW}⚠️  Duplicate component names in $file:${NC}"
          while IFS= read -r line; do echo "  $line"; done <<< "$component_names"
          count=$((count + 1))
        fi
      fi
    done < <(find src -name "*.tsx" -o -name "*.jsx" -type f -print0 2>/dev/null)
    echo "$count"
  }

  local backend_count frontend_count
  backend_count=$(backend_duplicate_count)
  frontend_count=$(frontend_duplicate_count)
  duplicates_found=$((backend_count + frontend_count))

  if [[ $duplicates_found -eq 0 ]]; then
    echo -e "${GREEN}✅ No duplicates found${NC}"
    return 0
  else
    echo -e "${YELLOW}⚠️  Found $duplicates_found files with potential duplicates${NC}"
    return 1
  fi
}

# Show MFU performance metrics
show_mfu_performance_metrics() {
  echo -e "${BLUE}MFU Performance Metrics:${NC}"
  
  # Get validation cache info
  local cache_file
  cache_file=$(get_validation_cache_file)
  
  if [[ -f "$cache_file" ]]; then
    echo "  Last validation: $(date -r "$cache_file")"
    echo "  Cache valid: $(is_validation_cache_valid && echo "Yes" || echo "No")"
    
    if command -v jq &> /dev/null; then
      local last_level
      last_level=$(jq -r '.level // "unknown"' "$cache_file" 2>/dev/null)
      echo "  Last validation level: $last_level"
    fi
  else
    echo "  No validation cache found"
  fi
  
  # Show recent commit frequency
  echo "  Recent commit frequency:"
  git log --oneline --since="1 week ago" | wc -l | sed 's/^/    /'
  echo "    commits in the last week"
  
  # Show branch activity
  echo "  Active branches:"
  git branch -r --sort=-committerdate | head -5 | sed 's/^/    /'
}

# MFU optimized commit cycle (DEPRECATED - functionality integrated into standard commit)
run_mfu_optimized_commit_cycle() {
  echo -e "${YELLOW}⚠️  run_mfu_optimized_commit_cycle is deprecated. Use commit_mfu_progress instead.${NC}"
  echo -e "${BLUE}Redirecting to improved MFU commit process...${NC}"
  commit_mfu_progress
}

# MFU optimized push cycle (now uses the consolidated commit function)
run_mfu_optimized_push_cycle() {
  echo -e "${BLUE}Running MFU push cycle...${NC}"
  
  ensure_project_root || return 1
  
  # Run the improved commit process (which includes validation)
  if ! commit_mfu_progress; then
    return 1
  fi
  
  # Push changes
  echo "Pushing changes..."
  if ! git push origin "$(get_current_branch)"; then
    echo -e "${RED}❌ Failed to push changes${NC}"
    return 1
  fi
  
  echo -e "${GREEN}✅ Changes pushed successfully${NC}"
  return 0
}

# Alias for the optimized push cycle (for menu consistency)
push_mfu_changes() {
  run_mfu_optimized_push_cycle
}

# Clean up completed MFU branches (for work cycle completion)
cleanup_completed_mfu_branches() {
  echo -e "${BLUE}Cleaning up completed MFU branches...${NC}"
  
  ensure_project_root || return 1
  
  # Get list of local MFU branches
  local mfu_branches
  mfu_branches=$(git branch --list "mfu-*" | sed 's/^[* ]*//')
  
  if [[ -z "$mfu_branches" ]]; then
    echo -e "${GREEN}✅ No MFU branches found to clean up${NC}"
    return 0
  fi
  
  echo "Found MFU branches:"
  echo "$mfu_branches"
  echo ""
  
  read -r -p "Do you want to delete all completed MFU branches? (y/N): " confirm
  
  if [[ "$confirm" =~ ^[Yy]$ ]]; then
    echo "Deleting completed MFU branches..."
    
    while IFS= read -r branch; do
      if [[ -n "$branch" ]]; then
        echo "Deleting branch: $branch"
        if git branch -D "$branch"; then
          echo -e "${GREEN}✅ Deleted: $branch${NC}"
        else
          echo -e "${YELLOW}⚠️  Failed to delete: $branch${NC}"
        fi
      fi
    done <<< "$mfu_branches"
    
    echo -e "${GREEN}✅ MFU branch cleanup completed${NC}"
  else
    echo -e "${BLUE}ℹ️  Branch cleanup cancelled${NC}"
  fi
  
  return 0
} 

# Run UAT readiness validation via runner script
run_mfu_uat() {
  echo -e "${BLUE}Running UAT readiness validation...${NC}"
  ensure_project_root || return 1
  bash scripts/dev-tools/run-uat.sh
} 