#!/bin/bash

# Validation functions for the git workflow system
# This module contains smart validation logic for frontend, backend, and middleware

# Core utilities are already sourced by the main script

# Run smart frontend validation with caching
run_smart_frontend_validation() {
  local level="${1:-standard}"
  level=$(determine_validation_level "$level")
  
  echo -e "${BLUE}Running smart frontend validation (level: $level)...${NC}"
  
  # Check cache first
  if is_validation_type_cached "frontend"; then
    local cached_result
    cached_result=$(get_validation_result "frontend")
    if [[ "$cached_result" == "success" ]]; then
      echo -e "${GREEN}✅ Using cached frontend validation result${NC}"
      return 0
    fi
  fi
  
  ensure_frontend_context || return 1
  
  local validation_passed=true
  
  case "$level" in
    "essential")
      echo "Running essential frontend checks..."
      if ! npm run lint --silent 2>/dev/null; then
        echo -e "${RED}❌ Frontend linting failed${NC}"
        validation_passed=false
      fi
      ;;
    "standard")
      echo "Running standard frontend validation..."
      if ! npm run lint --silent 2>/dev/null; then
        echo -e "${RED}❌ Frontend linting failed${NC}"
        validation_passed=false
      fi
      if ! npm run type-check --silent 2>/dev/null; then
        echo -e "${RED}❌ Frontend type checking failed${NC}"
        validation_passed=false
      fi
      ;;
    "full")
      echo "Running full frontend validation..."
      if ! npm run lint --silent 2>/dev/null; then
        echo -e "${RED}❌ Frontend linting failed${NC}"
        validation_passed=false
      fi
      if ! npm run type-check --silent 2>/dev/null; then
        echo -e "${RED}❌ Frontend type checking failed${NC}"
        validation_passed=false
      fi
      if ! npm run test --silent 2>/dev/null; then
        echo -e "${RED}❌ Frontend tests failed${NC}"
        validation_passed=false
      fi
      ;;
  esac
  
  # Save result to cache
  if [[ "$validation_passed" == "true" ]]; then
    save_validation_result "$level" "success" "frontend"
    echo -e "${GREEN}✅ Frontend validation passed${NC}"
    return 0
  else
    save_validation_result "$level" "failed" "frontend"
    echo -e "${RED}❌ Frontend validation failed${NC}"
    return 1
  fi
}

# Run backend essential checks (fail-fast)
run_backend_essential_checks() {
  echo -e "${BLUE}Running backend essential checks (fail-fast)...${NC}"
  
  ensure_backend_context || return 1
  
  local checks_passed=true
  
  # Check Black formatting
  echo "  Checking Black formatting..."
  if ! poetry run black --check app/ 2>/dev/null; then
    echo -e "${RED}❌ Black formatting check failed${NC}"
    checks_passed=false
  fi
  
  # Check Flake8 linting
  echo "  Checking Flake8 linting..."
  if ! poetry run flake8 app/ 2>/dev/null; then
    echo -e "${RED}❌ Flake8 linting failed${NC}"
    checks_passed=false
  fi
  
  # Check Ruff linting
  echo "  Checking Ruff linting..."
  if ! poetry run ruff check app/ 2>/dev/null; then
    echo -e "${RED}❌ Ruff linting failed${NC}"
    checks_passed=false
  fi
  
  if [[ "$checks_passed" == "true" ]]; then
    echo -e "${GREEN}✅ Backend essential checks passed${NC}"
    return 0
  else
    echo -e "${RED}❌ Backend essential checks failed - stopping early${NC}"
    return 1
  fi
}

# Run smart backend validation with caching
run_smart_backend_validation() {
  local level="${1:-standard}"
  level=$(determine_validation_level "$level")
  
  echo -e "${BLUE}Running smart backend validation (level: $level)...${NC}"
  
  # Check cache first
  if is_validation_type_cached "backend"; then
    local cached_result
    cached_result=$(get_validation_result "backend")
    if [[ "$cached_result" == "success" ]]; then
      echo -e "${GREEN}✅ Using cached backend validation result${NC}"
      return 0
    fi
  fi
  
  ensure_backend_context || return 1
  
  local validation_passed=true
  
  case "$level" in
    "essential")
      echo "Running essential backend checks..."
      if ! run_backend_essential_checks; then
        validation_passed=false
      fi
      ;;
    "standard")
      echo "Running standard backend validation..."
      if ! run_backend_essential_checks; then
        validation_passed=false
      else
        echo "  Running MyPy type checking..."
        if ! poetry run mypy app/ 2>/dev/null; then
          echo -e "${RED}❌ MyPy type checking failed${NC}"
          validation_passed=false
        fi
      fi
      ;;
    "full")
      echo "Running full backend validation..."
      if ! run_backend_essential_checks; then
        validation_passed=false
      else
        echo "  Running MyPy type checking..."
        if ! poetry run mypy app/ 2>/dev/null; then
          echo -e "${RED}❌ MyPy type checking failed${NC}"
          validation_passed=false
        fi
        
        echo "  Running Pylint code quality..."
        if ! poetry run pylint app/ 2>/dev/null; then
          echo -e "${RED}❌ Pylint code quality check failed${NC}"
          validation_passed=false
        fi
        
        echo "  Running unit tests..."
        if ! poetry run pytest app/tests/ -v 2>/dev/null; then
          echo -e "${RED}❌ Unit tests failed${NC}"
          validation_passed=false
        fi
      fi
      ;;
  esac
  
  # Save result to cache
  if [[ "$validation_passed" == "true" ]]; then
    save_validation_result "$level" "success" "backend"
    echo -e "${GREEN}✅ Backend validation passed${NC}"
    return 0
  else
    save_validation_result "$level" "failed" "backend"
    echo -e "${RED}❌ Backend validation failed${NC}"
    return 1
  fi
}

# Run smart middleware validation (skips if frontend/backend not present)
run_smart_middleware_validation() {
  echo -e "${BLUE}Running middleware validation...${NC}"
  ensure_project_root || return 1
  local validation_passed=true
  local checked_any=false

  check_frontend_middleware() {
    if [[ ! -d "frontend" ]]; then
      return 0  # Skip if no frontend
    fi
    cd frontend || return 1
    local result=0
    if [[ -f "src/middleware.ts" ]]; then
      checked_any=true
      if ! npm run type-check --silent 2>/dev/null; then
        echo -e "${RED}❌ Frontend middleware type check failed${NC}"
        result=1
      fi
    fi
    cd - > /dev/null || return 1
    return $result
  }

  check_backend_middleware() {
    if [[ ! -d "backend" ]]; then
      return 0  # Skip if no backend
    fi
    cd backend || return 1
    local result=0
    if [[ -d "app/middleware" ]]; then
      checked_any=true
      if ! poetry run black --check app/middleware/ 2>/dev/null; then
        echo -e "${RED}❌ Backend middleware formatting check failed${NC}"
        result=1
      fi
      if ! poetry run flake8 app/middleware/ 2>/dev/null; then
        echo -e "${RED}❌ Backend middleware linting failed${NC}"
        result=1
      fi
    fi
    cd - > /dev/null || return 1
    return $result
  }

  echo "  Checking frontend middleware..."
  if ! check_frontend_middleware; then
    validation_passed=false
  fi

  echo "  Checking backend middleware..."
  if ! check_backend_middleware; then
    validation_passed=false
  fi

  if [[ "$checked_any" == "false" ]]; then
    echo -e "${YELLOW}⚠️  No middleware to validate (frontend/backend not present)${NC}"
    return 0
  fi

  if [[ "$validation_passed" == "true" ]]; then
    echo -e "${GREEN}✅ Middleware validation passed${NC}"
    return 0
  else
    echo -e "${RED}❌ Middleware validation failed${NC}"
    return 1
  fi
}

# Clear validation cache
clear_validation_cache() {
  echo -e "${BLUE}Clearing validation cache...${NC}"
  local cache_file
  cache_file=$(get_validation_cache_file)
  
  if [[ -f "$cache_file" ]]; then
    rm "$cache_file"
    echo -e "${GREEN}✅ Validation cache cleared${NC}"
  else
    echo -e "${YELLOW}⚠️  No validation cache found${NC}"
  fi
}

# Show validation cache status
show_validation_cache_status() {
  echo -e "${BLUE}Validation Cache Status:${NC}"
  
  local cache_file
  cache_file=$(get_validation_cache_file)
  
  if [[ -f "$cache_file" ]]; then
    echo "  Cache file: $cache_file"
    echo "  Last validation: $(date -r "$cache_file")"
    echo "  Cache valid: $(is_validation_cache_valid && echo "Yes" || echo "No")"
    echo "  Files changed: $(have_files_changed_since_validation && echo "Yes" || echo "No")"
    
    if command -v jq &> /dev/null; then
      echo "  Last level: $(jq -r '.level // "unknown"' "$cache_file" 2>/dev/null)"
      echo "  Last result: $(jq -r '.result // "unknown"' "$cache_file" 2>/dev/null)"
      echo "  Last commit: $(jq -r '.commit // "unknown"' "$cache_file" 2>/dev/null)"
      echo "  Last branch: $(jq -r '.branch // "unknown"' "$cache_file" 2>/dev/null)"
      echo "  Validation type: $(jq -r '.validation_type // "unknown"' "$cache_file" 2>/dev/null)"
      
      # Show cache status for each validation type
      echo ""
      echo "  Cache status by type:"
      echo "    Frontend: $(is_validation_type_cached "frontend" && echo "✅ Cached" || echo "❌ Not cached")"
      echo "    Backend: $(is_validation_type_cached "backend" && echo "✅ Cached" || echo "❌ Not cached")"
      echo "    MFU Context: $(is_validation_type_cached "mfu-context" && echo "✅ Cached" || echo "❌ Not cached")"
    fi
  else
    echo "  No cache file found"
  fi
} 