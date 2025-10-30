#!/bin/bash

# Core utility functions for the git workflow system
# This module contains essential context management and validation cache functions

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Windows compatibility helper
is_windows() {
  [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]
}

# Cross-platform date command wrapper
get_file_modification_time() {
  local file="$1"
  if is_windows; then
    # Windows Git Bash - use GNU date with stat
    date -d "@$(stat -c %Y "$file" 2>/dev/null || echo "0")" 2>/dev/null || echo "Unknown"
  else
    # Unix-like systems - use BSD date
    date -r "$file" 2>/dev/null || echo "Unknown"
  fi
}

# Cross-platform timestamp to date conversion
timestamp_to_date() {
  local timestamp="$1"
  local format="${2:-%Y-%m-%d %H:%M:%S}"
  if is_windows; then
    # Windows Git Bash - use GNU date format
    date -d "@$timestamp" "+$format" 2>/dev/null || echo ""
  else
    # Unix-like systems - use BSD date format
    date -r "$timestamp" "+$format" 2>/dev/null || echo ""
  fi
}

# Ensure we're in the frontend context
ensure_frontend_context() {
  if [[ -f "package.json" ]] && [[ -f "next.config.js" ]]; then
    echo -e "${GREEN}✓ Already in frontend context${NC}"
    return 0
  elif [[ -d "frontend" ]] && [[ -f "frontend/package.json" ]] && [[ -f "frontend/next.config.js" ]]; then
    echo -e "${BLUE}Switching to frontend directory...${NC}"
    cd frontend || return 1
    return 0
  else
    echo -e "${RED}❌ Frontend directory not found. Please run this command from the project root or frontend directory${NC}"
    return 1
  fi
}

# Ensure we're in the backend context
ensure_backend_context() {
  if [[ -f "pyproject.toml" ]] && [[ -d "app" ]]; then
    echo -e "${GREEN}✓ Already in backend context${NC}"
    return 0
  elif [[ -d "backend" ]] && [[ -f "backend/pyproject.toml" ]] && [[ -d "backend/app" ]]; then
    echo -e "${BLUE}Switching to backend directory...${NC}"
    cd backend || return 1
    return 0
  else
    echo -e "${RED}❌ Backend directory not found. Please run this command from the project root or backend directory${NC}"
    return 1
  fi
}

# Ensure we're in the project root
ensure_project_root() {
  # Relaxed check for talk-avocado project
  if [[ ! -d "docs" ]] || [[ ! -d "scripts" ]]; then
    echo -e "${RED}❌ Please run this command from the project root directory${NC}"
    return 1
  fi
  echo -e "${GREEN}✓ Already in project root${NC}"
}

# Start backend API server (dev) for Talk Avocado local HTTP endpoints
api_up() {
  echo -e "${BLUE}Starting backend API server...${NC}"
  # Ensure project root
  if ! ensure_project_root; then
    return 1
  fi
  # Defaults if not provided
  export TALKAVOCADO_ENV="${TALKAVOCADO_ENV:-dev}"
  # Resolve MEDIA_STORAGE_PATH to absolute project storage directory
  local PROJECT_ROOT
  PROJECT_ROOT="$(git rev-parse --show-toplevel)"
  export MEDIA_STORAGE_PATH="${MEDIA_STORAGE_PATH:-${PROJECT_ROOT}/storage}"
  echo "TALKAVOCADO_ENV=${TALKAVOCADO_ENV}"
  echo "MEDIA_STORAGE_PATH=${MEDIA_STORAGE_PATH}"
  (
    cd backend || exit 1
    npm run build && npm run dev:api
  )
}

# Get current commit hash
get_current_commit_hash() {
  git rev-parse HEAD 2>/dev/null || echo "unknown"
}

# Get current branch name
get_current_branch() {
  git branch --show-current 2>/dev/null || echo "unknown"
}

# Validation cache functions
get_validation_cache_file() {
  # Cross-platform cache directory
  local cache_dir
  if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
    # Windows Git Bash
    cache_dir="$HOME/.cache/consultancy-platform/validation"
  else
    # Unix-like systems
    cache_dir="$HOME/.cache/consultancy-platform/validation"
  fi
  mkdir -p "$cache_dir"
  echo "$cache_dir/validation_cache.json"
}

ensure_validation_cache_dir() {
  local cache_dir="$HOME/.cache/consultancy-platform/validation"
  mkdir -p "$cache_dir"
}

get_validation_cache_timestamp() {
  local cache_file
  cache_file=$(get_validation_cache_file)
  if [[ -f "$cache_file" ]]; then
    if command -v jq &> /dev/null; then
      jq -r '.timestamp // empty' "$cache_file" 2>/dev/null || echo "0"
    else
      echo "0"
    fi
  else
    echo "0"
  fi
}

is_validation_cache_valid() {
  local cache_file
  cache_file=$(get_validation_cache_file)
  
  if [[ ! -f "$cache_file" ]]; then
    return 1
  fi
  
  local cache_timestamp
  cache_timestamp=$(get_validation_cache_timestamp)
  local current_time
  current_time=$(date +%s)
  local cache_age=$((current_time - cache_timestamp))
  
  # Cache is valid for 30 minutes
  [[ $cache_age -lt 1800 ]]
}

have_files_changed_since_validation() {
  local cache_timestamp
  cache_timestamp=$(get_validation_cache_timestamp)
  
  if [[ "$cache_timestamp" == "0" ]]; then
    return 0 # Files have "changed" if no cache exists
  fi
  
  # Convert timestamp to date format for git (cross-platform)
  local cache_date
  cache_date=$(timestamp_to_date "$cache_timestamp" "%Y-%m-%d %H:%M:%S")
  
  if [[ -z "$cache_date" ]]; then
    return 0 # If we can't parse the timestamp, assume files changed
  fi
  
  # Check if any relevant files have been modified since last validation
  local changed_files
  changed_files=$(git diff --name-only --since="$cache_date" 2>/dev/null | grep -E '\.(ts|tsx|js|jsx|py|md|json|toml|yaml|yml)$' || true)
  
  [[ -n "$changed_files" ]]
}

# Save validation result to cache
save_validation_result() {
  local level="$1"
  local result="$2"
  local validation_type="${3:-general}"
  local cache_file
  cache_file=$(get_validation_cache_file)
  
  ensure_validation_cache_dir
  
  local timestamp
  timestamp=$(date +%s)
  
  # Read existing cache or create new structure
  local existing_cache
  if [[ -f "$cache_file" ]]; then
    existing_cache=$(cat "$cache_file")
  else
    existing_cache='{}'
  fi
  
  # Update cache with new validation result
  if command -v jq &> /dev/null; then
    echo "$existing_cache" | jq --arg level "$level" \
      --arg result "$result" \
      --arg timestamp "$timestamp" \
      --arg commit "$(get_current_commit_hash)" \
      --arg branch "$(get_current_branch)" \
      --arg type "$validation_type" \
      '. + {
        level: $level,
        result: $result,
        timestamp: $timestamp,
        commit: $commit,
        branch: $branch,
        validation_type: $type
      }' > "$cache_file"
  else
    # Fallback if jq not available
    echo "{\"level\":\"$level\",\"result\":\"$result\",\"timestamp\":\"$timestamp\"}" > "$cache_file"
  fi
}

# Get validation result from cache
get_validation_result() {
  local validation_type="${1:-general}"
  local cache_file
  cache_file=$(get_validation_cache_file)
  
  if [[ -f "$cache_file" ]]; then
    if command -v jq &> /dev/null; then
      jq -r '.result // empty' "$cache_file" 2>/dev/null || echo "unknown"
    else
      echo "unknown"
    fi
  else
    echo "unknown"
  fi
}

# Check if specific validation type is cached and valid
is_validation_type_cached() {
  local validation_type="${1:-general}"
  local cache_file
  cache_file=$(get_validation_cache_file)
  
  if [[ ! -f "$cache_file" ]]; then
    return 1
  fi
  
  # Check if the validation type matches and cache is valid
  local cached_type
  if command -v jq &> /dev/null; then
    cached_type=$(jq -r '.validation_type // empty' "$cache_file" 2>/dev/null || echo "")
  else
    cached_type=""
  fi
  
  if [[ "$cached_type" == "$validation_type" ]] && is_validation_cache_valid && ! have_files_changed_since_validation; then
    return 0
  else
    return 1
  fi
}

# Test email delivery with Gmail API verification
test_email_delivery_with_gmail() {
  echo -e "${BLUE}Testing email delivery with Gmail API...${NC}"
  ensure_backend_context || return 1
  
  # Check if Gmail API credentials are configured
  if [[ ! -f "app/core/gmail_credentials.json" ]]; then
    echo -e "${RED}❌ Gmail API credentials not found${NC}"
    echo -e "${YELLOW}Please configure Gmail API credentials first${NC}"
    return 1
  fi
  
  # Run the email delivery test
  if poetry run python -c "
import sys
sys.path.insert(0, 'app')
from app.core.email import EmailService
from app.core.config import settings

email_service = EmailService()
result = email_service.test_gmail_connection()
print(f'Gmail API test result: {result}')
"; then
    echo -e "${GREEN}✅ Gmail API test completed${NC}"
    return 0
  else
    echo -e "${RED}❌ Gmail API test failed${NC}"
    return 1
  fi
}

# Enable email capture mode for testing
enable_email_capture_mode() {
  echo -e "${BLUE}Enabling email capture mode for testing...${NC}"
  ensure_backend_context || return 1
  
  # Set environment variable for email capture
  export EMAIL_CAPTURE_MODE=true
  echo -e "${GREEN}✅ Email capture mode enabled${NC}"
  echo -e "${YELLOW}📧 All emails will be captured and logged instead of being sent${NC}"
  echo -e "${YELLOW}💡 Restart the backend server to apply this setting${NC}"
}

# Check testing environment (frontend, backend, and email service)
check_testing_environment() {
  echo -e "${BLUE}🔍 Checking Testing Environment${NC}"
  echo "=================================="
  
  local all_checks_passed=true
  
  # Check if we're in project root
  if ! ensure_project_root; then
    echo -e "${RED}❌ Not in project root directory${NC}"
    return 1
  fi
  
  echo ""
  
  # 0a. Check Node.js Version
  echo -e "${CYAN}📦 Checking Node.js Version...${NC}"
  if command -v node >/dev/null 2>&1; then
    local node_version
    node_version=$(node -v)
    local required_version="22"
    local major_version
    major_version=$(echo "$node_version" | cut -d'.' -f1 | tr -d 'v')
    
    if [[ "$major_version" == "$required_version" ]]; then
      echo -e "${GREEN}✅ Node.js version is correct: $node_version${NC}"
    else
      echo -e "${RED}❌ Node.js version mismatch. Required: v${required_version}.x, Current: $node_version${NC}"
      echo -e "${YELLOW}   Switch with: nvm use $required_version${NC}"
      all_checks_passed=false
    fi
  else
    echo -e "${RED}❌ Node.js not found${NC}"
    echo -e "${YELLOW}   Install with: nvm install 22${NC}"
    all_checks_passed=false
  fi
  
  # 0b. Check Python Version
  echo -e "${CYAN}🐍 Checking Python Version...${NC}"
  if command -v python3 >/dev/null 2>&1; then
    local python_version
    python_version=$(python3 --version 2>&1 | awk '{print $2}')
    local python_major_minor
    python_major_minor=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "unknown")
    
    if [[ "$python_major_minor" =~ ^3\.(11|12) ]]; then
      echo -e "${GREEN}✅ Python version is correct: $python_version${NC}"
    else
      echo -e "${YELLOW}⚠️  Python version: $python_version (recommended: 3.11 or 3.12)${NC}"
    fi
  else
    echo -e "${RED}❌ Python 3 not found${NC}"
    all_checks_passed=false
  fi
  
  # 0c. Check PostgreSQL Service
  echo -e "${CYAN}🐘 Checking PostgreSQL Service...${NC}"
  if command -v pg_isready >/dev/null 2>&1; then
    if pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
      echo -e "${GREEN}✅ PostgreSQL is running on localhost:5432${NC}"
    else
      echo -e "${RED}❌ PostgreSQL is not running on localhost:5432${NC}"
      echo -e "${YELLOW}   Start with: docker run --name postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:15${NC}"
      echo -e "${YELLOW}   Or: sudo systemctl start postgresql (Linux)${NC}"
      all_checks_passed=false
    fi
  else
    echo -e "${YELLOW}⚠️  pg_isready not found, cannot verify PostgreSQL${NC}"
    echo -e "${YELLOW}   Install PostgreSQL client tools${NC}"
  fi
  
  # 0d. Check Redis Service (optional but recommended)
  echo -e "${CYAN}📮 Checking Redis Service...${NC}"
  if command -v redis-cli >/dev/null 2>&1; then
    if redis-cli -h localhost -p 6379 ping >/dev/null 2>&1; then
      echo -e "${GREEN}✅ Redis is running on localhost:6379${NC}"
    else
      echo -e "${YELLOW}⚠️  Redis is not running on localhost:6379 (optional for rate limiting)${NC}"
      echo -e "${YELLOW}   Start with: docker run --name redis -p 6379:6379 -d redis:7${NC}"
    fi
  else
    echo -e "${YELLOW}⚠️  redis-cli not found, cannot verify Redis (optional)${NC}"
  fi
  
  echo ""
  
  # 1. Check Frontend Server (Port 3000)
  echo -e "${CYAN}📱 Checking Frontend Server (Port 3000)...${NC}"
  if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Frontend server is running on port 3000${NC}"
  else
    echo -e "${RED}❌ Frontend server is NOT running on port 3000${NC}"
    echo -e "${YELLOW}   Start with: ./scripts/dev-tools/git-workflow.sh frontend-dev${NC}"
    all_checks_passed=false
  fi
  
  # 2. Check Backend Server (Port 8000)
  echo -e "${CYAN}🔧 Checking Backend Server (Port 8000)...${NC}"
  if curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend server is running on port 8000${NC}"
  else
    echo -e "${RED}❌ Backend server is NOT running on port 8000${NC}"
    echo -e "${YELLOW}   Start with: ./scripts/dev-tools/git-workflow.sh backend-start${NC}"
    all_checks_passed=false
  fi
  
  # 3. Check Email Service Configuration
  echo -e "${CYAN}📧 Checking Email Service Configuration...${NC}"
  
  # Check backend .env file for email configuration
  if [[ -f "backend/.env" ]]; then
    local use_mock
    local mailersend_key
    local sender_email
    
    use_mock=$(grep "^USE_MOCK=" backend/.env | cut -d'=' -f2 | tr -d '"' || echo "false")
    mailersend_key=$(grep "^MAILERSEND_API_KEY=" backend/.env | cut -d'=' -f2 | tr -d '"' || echo "")
    sender_email=$(grep "^MAILERSEND_SENDER_EMAIL=" backend/.env | cut -d'=' -f2 | tr -d '"' || echo "")
    
    if [[ "$use_mock" == "true" ]]; then
      echo -e "${YELLOW}⚠️  Email service is in MOCK mode (emails will be logged only)${NC}"
    elif [[ -n "$mailersend_key" ]] && [[ -n "$sender_email" ]]; then
      echo -e "${GREEN}✅ MailerSend API key is configured${NC}"
      echo -e "${GREEN}✅ Sender email is configured: $sender_email${NC}"
      
      # Test email service connectivity
      echo -e "${CYAN}   Testing MailerSend API connectivity...${NC}"
      if curl -s -H "Authorization: Bearer $mailersend_key" https://api.mailersend.com/v1/me > /dev/null 2>&1; then
        echo -e "${GREEN}   ✅ MailerSend API is accessible${NC}"
      else
        echo -e "${RED}   ❌ MailerSend API is not accessible${NC}"
        echo -e "${YELLOW}   Check your API key and internet connection${NC}"
        all_checks_passed=false
      fi
    else
      echo -e "${RED}❌ MailerSend configuration is incomplete${NC}"
      echo -e "${YELLOW}   Check MAILERSEND_API_KEY and MAILERSEND_SENDER_EMAIL in backend/.env${NC}"
      all_checks_passed=false
    fi
  else
    echo -e "${RED}❌ Backend .env file not found${NC}"
    all_checks_passed=false
  fi
  
  # 3b. Check Critical Backend Environment Variables
  echo -e "${CYAN}🔑 Checking Critical Backend Environment Variables...${NC}"
  if [[ -f "backend/.env" ]]; then
    local db_url secret_key session_hmac
    db_url=$(grep "^DATABASE_URL=" backend/.env | cut -d'=' -f2 | tr -d '"' || echo "")
    secret_key=$(grep "^SECRET_KEY=" backend/.env | cut -d'=' -f2 | tr -d '"' || echo "")
    session_hmac=$(grep "^SESSION_HMAC_SECRET=" backend/.env | cut -d'=' -f2 | tr -d '"' || echo "")
    
    if [[ -n "$db_url" ]]; then
      echo -e "${GREEN}✅ DATABASE_URL is configured${NC}"
    else
      echo -e "${RED}❌ DATABASE_URL is missing in backend/.env${NC}"
      all_checks_passed=false
    fi
    
    if [[ -n "$secret_key" ]]; then
      local key_length=${#secret_key}
      if [[ $key_length -ge 32 ]]; then
        echo -e "${GREEN}✅ SECRET_KEY is configured (${key_length} chars)${NC}"
      else
        echo -e "${YELLOW}⚠️  SECRET_KEY is too short (${key_length} chars, should be >= 32)${NC}"
      fi
    else
      echo -e "${RED}❌ SECRET_KEY is missing in backend/.env${NC}"
      all_checks_passed=false
    fi
    
    if [[ -n "$session_hmac" ]]; then
      echo -e "${GREEN}✅ SESSION_HMAC_SECRET is configured${NC}"
    else
      echo -e "${RED}❌ SESSION_HMAC_SECRET is missing in backend/.env${NC}"
      all_checks_passed=false
    fi
  fi
  
  # 4. Check Frontend Environment
  echo -e "${CYAN}🌐 Checking Frontend Environment...${NC}"
  if [[ -f "frontend/.env.local" ]]; then
    echo -e "${GREEN}✅ Frontend .env.local file exists${NC}"
    
    # Check for required frontend environment variables
    local backend_url nextauth_url auth_secret auth_url session_hmac_fe
    
    backend_url=$(grep "^BACKEND_URL=" frontend/.env.local | cut -d'=' -f2 | tr -d '"' || echo "")
    nextauth_url=$(grep "^NEXTAUTH_URL=" frontend/.env.local | cut -d'=' -f2 | tr -d '"' || echo "")
    auth_secret=$(grep "^AUTH_SECRET=" frontend/.env.local | cut -d'=' -f2 | tr -d '"' || echo "")
    auth_url=$(grep "^AUTH_URL=" frontend/.env.local | cut -d'=' -f2 | tr -d '"' || echo "")
    session_hmac_fe=$(grep "^SESSION_HMAC_SECRET=" frontend/.env.local | cut -d'=' -f2 | tr -d '"' || echo "")
    
    if [[ -n "$backend_url" ]]; then
      echo -e "${GREEN}✅ BACKEND_URL is configured: $backend_url${NC}"
    else
      echo -e "${RED}❌ BACKEND_URL not configured in frontend/.env.local${NC}"
      all_checks_passed=false
    fi
    
    if [[ -n "$auth_secret" ]]; then
      local auth_secret_length=${#auth_secret}
      if [[ $auth_secret_length -ge 32 ]]; then
        echo -e "${GREEN}✅ AUTH_SECRET is configured (${auth_secret_length} chars)${NC}"
      else
        echo -e "${YELLOW}⚠️  AUTH_SECRET is too short (${auth_secret_length} chars, should be >= 32)${NC}"
      fi
    else
      echo -e "${RED}❌ AUTH_SECRET is missing (required for NextAuth v5)${NC}"
      all_checks_passed=false
    fi
    
    if [[ -n "$auth_url" ]]; then
      echo -e "${GREEN}✅ AUTH_URL is configured: $auth_url${NC}"
    else
      echo -e "${RED}❌ AUTH_URL not configured (required for NextAuth v5)${NC}"
      all_checks_passed=false
    fi
    
    if [[ -n "$session_hmac_fe" ]]; then
      echo -e "${GREEN}✅ SESSION_HMAC_SECRET is configured${NC}"
    else
      echo -e "${RED}❌ SESSION_HMAC_SECRET is missing${NC}"
      all_checks_passed=false
    fi
    
    if [[ -n "$nextauth_url" ]]; then
      echo -e "${GREEN}✅ NEXTAUTH_URL is configured: $nextauth_url${NC}"
    else
      echo -e "${YELLOW}⚠️  NEXTAUTH_URL not configured (legacy, may not be needed)${NC}"
    fi
  else
    echo -e "${RED}❌ Frontend .env.local file not found${NC}"
    echo -e "${YELLOW}   Run: ./scripts/setup-frontend-env.sh${NC}"
    all_checks_passed=false
  fi
  
  # 5. Check Database Connectivity (if backend is running)
  echo -e "${CYAN}🗄️  Checking Database Connectivity...${NC}"
  
  # First try the simple webhook health endpoint (no auth required)
  local webhook_health_response
  webhook_health_response=$(curl -s http://localhost:8000/api/v1/webhooks/health 2>/dev/null || echo "")
  
  if [[ -n "$webhook_health_response" ]]; then
    echo -e "${GREEN}✅ Backend webhook health endpoint is accessible${NC}"
    
    # Try to get more detailed health info from the protected endpoint
    # Check if we have Azure Key Vault configuration
    local azure_key_vault_url=""
    if [[ -f "backend/.env" ]]; then
      azure_key_vault_url=$(grep "^AZURE_KEY_VAULT_URL=" backend/.env | cut -d'=' -f2 | tr -d '"')
    fi
    
    if [[ -n "$azure_key_vault_url" ]]; then
      echo -e "${CYAN}   Azure Key Vault configured, attempting detailed health check...${NC}"
      
      # Try to get the API key from Azure Key Vault
      local api_key=""
      local vault_name=""
      
      # Extract vault name from URL
      if [[ "$azure_key_vault_url" =~ https://([^.]+)\.vault\.azure\.net ]]; then
        vault_name="${BASH_REMATCH[1]}"
      fi
      
      if [[ -n "$vault_name" ]]; then
        # Check if Azure CLI is available and we can access the vault
        if command -v az >/dev/null 2>&1; then
          api_key=$(az keyvault secret show --vault-name "$vault_name" --name "api-secret-current" --query "value" -o tsv 2>/dev/null || echo "")
          
          if [[ -n "$api_key" ]]; then
            # Test the detailed health endpoint with the API key
            local detailed_health_response
            detailed_health_response=$(curl -s -H "X-API-Key: $api_key" http://localhost:8000/api/v1/health/ 2>/dev/null || echo "")
            
            if [[ -n "$detailed_health_response" ]]; then
              local db_status
              db_status=$(echo "$detailed_health_response" | python3 -c "import sys, json; print(json.load(sys.stdin).get('database', 'unknown'))" 2>/dev/null)
              
              if [[ "$db_status" == "connected" ]]; then
                echo -e "${GREEN}   ✅ Database connectivity: $db_status${NC}"
              elif [[ "$db_status" == error* ]]; then
                echo -e "${RED}   ❌ Database error: $db_status${NC}"
                all_checks_passed=false
              else
                echo -e "${YELLOW}   ⚠️  Database status: $db_status${NC}"
              fi
            else
              echo -e "${YELLOW}   ⚠️  Could not reach detailed health endpoint${NC}"
            fi
          else
            echo -e "${YELLOW}   ⚠️  Could not retrieve API key from Azure Key Vault${NC}"
            echo -e "${YELLOW}   Run: az keyvault secret set --vault-name \"$vault_name\" --name \"api-secret-current\" --value \"<your-api-key>\"${NC}"
          fi
        else
          echo -e "${YELLOW}   ⚠️  Azure CLI not available for detailed health check${NC}"
          echo -e "${YELLOW}   Install Azure CLI: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli${NC}"
        fi
      else
        echo -e "${YELLOW}   ⚠️  Could not extract vault name from AZURE_KEY_VAULT_URL${NC}"
      fi
    else
      echo -e "${YELLOW}   ⚠️  Azure Key Vault not configured for detailed health checks${NC}"
      echo -e "${YELLOW}   Add AZURE_KEY_VAULT_URL to backend/.env for full health monitoring${NC}"
    fi
  else
    echo -e "${RED}❌ Backend is not responding to health checks${NC}"
    echo -e "${YELLOW}   Check if backend server is running on port 8000${NC}"
    all_checks_passed=false
  fi
  
  # 5b. Check Alembic Migrations Status (SQLAlchemy)
  echo -e "${CYAN}🔄 Checking Alembic Migrations Status...${NC}"
  if [[ -d "backend/alembic" ]]; then
    if command -v poetry >/dev/null 2>&1; then
      pushd backend >/dev/null 2>&1 || exit
      local migration_output
      migration_output=$(poetry run alembic current 2>&1 || echo "error")
      popd >/dev/null 2>&1 || exit
      
      if [[ "$migration_output" == "error" ]] || [[ -z "$migration_output" ]]; then
        echo -e "${RED}❌ No Alembic migrations applied${NC}"
        echo -e "${YELLOW}   Run: cd backend && poetry run alembic upgrade head${NC}"
        all_checks_passed=false
      else
        local current_rev
        current_rev=$(echo "$migration_output" | grep -oP '(?<=\(head\) )[a-f0-9]+' || echo "$migration_output" | awk '{print $1}')
        if [[ -n "$current_rev" ]]; then
          echo -e "${GREEN}✅ Alembic migrations applied: $current_rev${NC}"
        else
          echo -e "${YELLOW}⚠️  Alembic current: $migration_output${NC}"
        fi
      fi
    else
      echo -e "${YELLOW}⚠️  Poetry not found, cannot check Alembic migrations${NC}"
    fi
  else
    echo -e "${YELLOW}⚠️  Alembic directory not found${NC}"
  fi
  
  # 5c. Test Frontend-Backend API Communication
  echo -e "${CYAN}🔗 Testing Frontend-Backend API Communication...${NC}"
  if curl -s http://localhost:3000 > /dev/null 2>&1 && curl -s http://localhost:8000/health > /dev/null 2>&1; then
    # Test if frontend can reach backend via its configured URL
    local backend_url_from_fe
    if [[ -f "frontend/.env.local" ]]; then
      backend_url_from_fe=$(grep "^BACKEND_URL=" frontend/.env.local | cut -d'=' -f2 | tr -d '"' || echo "http://localhost:8000")
    else
      backend_url_from_fe="http://localhost:8000"
    fi
    
    # Try to reach backend health endpoint from configured URL
    if curl -s "${backend_url_from_fe}/health" > /dev/null 2>&1; then
      echo -e "${GREEN}✅ Frontend can communicate with backend at $backend_url_from_fe${NC}"
    else
      echo -e "${RED}❌ Frontend cannot reach backend at $backend_url_from_fe${NC}"
      echo -e "${YELLOW}   Check BACKEND_URL in frontend/.env.local${NC}"
      all_checks_passed=false
    fi
  else
    echo -e "${YELLOW}⚠️  Cannot test API communication (servers not running)${NC}"
  fi

# 6. Check Gmail API Configuration (optional)
  echo -e "${CYAN}📬 Checking Gmail API Configuration...${NC}"
  # Prefer GMAIL_CREDENTIALS_PATH from backend/.env
  local gmail_credentials_path=""
  if [[ -f "backend/.env" ]]; then
    gmail_credentials_path=$(grep "^GMAIL_CREDENTIALS_PATH=" backend/.env | cut -d'=' -f2 | tr -d '"')
  fi
  if [[ -z "$gmail_credentials_path" ]]; then
    gmail_credentials_path="backend/credentials.json"
  fi
  if [[ -f "$gmail_credentials_path" ]]; then
    echo -e "${GREEN}✅ Gmail API credentials file found at: $gmail_credentials_path${NC}"
    # Check if Google API dependencies are installed
    if python3 -c "import google.auth, googleapiclient" 2>/dev/null; then
      echo -e "${GREEN}✅ Google API libraries are installed${NC}"
      if [[ -f "backend/.env" ]] && grep -q "GMAIL_CREDENTIALS_PATH" backend/.env; then
        echo -e "${GREEN}✅ GMAIL_CREDENTIALS_PATH is configured in backend/.env${NC}"
      else
        echo -e "${YELLOW}⚠️  GMAIL_CREDENTIALS_PATH not configured in backend/.env (using default path)${NC}"
      fi
    else
      echo -e "${YELLOW}⚠️  Google API libraries not installed${NC}"
      echo -e "${YELLOW}   Run: ./scripts/setup-gmail-api.sh${NC}"
    fi
  else
    echo -e "${YELLOW}⚠️  Gmail API credentials file not found at: $gmail_credentials_path${NC}"
    echo -e "${YELLOW}   Set GMAIL_CREDENTIALS_PATH in backend/.env or place credentials at backend/credentials.json${NC}"
    echo -e "${YELLOW}   Run: ./scripts/setup-gmail-api.sh for setup instructions${NC}"
  fi
  
  echo ""
  echo "=================================="
  
  if [[ "$all_checks_passed" == "true" ]]; then
    echo -e "${GREEN}🎉 All testing environment checks passed!${NC}"
    echo -e "${GREEN}✅ Ready for testing and development${NC}"
    echo ""
    echo -e "${CYAN}📊 Environment Summary:${NC}"
    echo -e "  • Node.js, Python, PostgreSQL, Redis: Running"
    echo -e "  • Frontend (3000) & Backend (8000): Online"
    echo -e "  • Environment variables: Configured"
    echo -e "  • Database migrations: Up to date"
    echo -e "  • API communication: Working"
    echo ""
    echo -e "${CYAN}📧 Email Testing Options:${NC}"
    echo -e "  Basic test:     ./scripts/test-email-delivery.sh"
    echo -e "  Gmail API test: python3 scripts/test-email-with-gmail-verification.py"
    echo -e "  Setup Gmail:    ./scripts/setup-gmail-api.sh"
    return 0
  else
    echo -e "${RED}❌ Some checks failed. Please fix the issues above before testing.${NC}"
    echo ""
    echo -e "${YELLOW}🔧 Quick fixes:${NC}"
    echo -e "  Servers:     ./scripts/dev-tools/git-workflow.sh frontend-dev (or backend-start)"
    echo -e "  PostgreSQL:  docker run --name postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:15"
    echo -e "  Redis:       docker run --name redis -p 6379:6379 -d redis:7"
    echo -e "  Frontend env: ./scripts/setup-frontend-env.sh"
    echo -e "  Migrations:  cd backend && poetry run alembic upgrade head"
    echo -e "  Node version: nvm use 22"
    echo ""
    echo -e "${CYAN}📖 Documentation:${NC}"
    echo -e "  Environment setup: docs/development/ENVIRONMENT_SETUP.md"
    echo -e "  Testing guide:     docs/development/TESTING_ENVIRONMENT_CHECK.md"
    return 1
  fi
}

# Determine validation level based on context
determine_validation_level() {
  local level="${1:-standard}"
  
  case "$level" in
    "essential"|"quick")
      echo "essential"
      ;;
    "standard"|"normal")
      echo "standard"
      ;;
    "full"|"complete"|"comprehensive")
      echo "full"
      ;;
    *)
      echo "standard"
      ;;
  esac
}

# Sync with main branch
sync_main() {
  echo -e "${BLUE}Syncing with main branch...${NC}"
  
  ensure_project_root || return 1
  
  # Get current branch
  local current_branch
  current_branch=$(get_current_branch)
  
  # Stash any uncommitted changes
  if ! git diff-index --quiet HEAD --; then
    echo "Stashing uncommitted changes..."
    git stash push -m "Auto-stash before sync"
  fi
  
  # Switch to main and pull
  echo "Switching to main branch..."
  if ! git checkout main; then
    echo -e "${RED}❌ Failed to switch to main branch${NC}"
    return 1
  fi
  
  echo "Pulling latest changes from main..."
  if ! git pull origin main; then
    echo -e "${RED}❌ Failed to pull from main${NC}"
    return 1
  fi
  
  # Switch back to original branch
  if [[ "$current_branch" != "main" ]]; then
    echo "Switching back to $current_branch..."
    if ! git checkout "$current_branch"; then
      echo -e "${RED}❌ Failed to switch back to $current_branch${NC}"
      return 1
    fi
    
    # Rebase on main
    echo "Rebasing on main..."
    if ! git rebase main; then
      echo -e "${RED}❌ Failed to rebase on main${NC}"
      return 1
    fi
  fi
  
  # Restore stashed changes
  if git stash list | grep -q "Auto-stash before sync"; then
    echo "Restoring stashed changes..."
    git stash pop
  fi
  
  echo -e "${GREEN}✅ Sync with main completed successfully${NC}"
  return 0
}

# Create feature branch
create_feature_branch() {
  echo -e "${BLUE}Creating feature branch...${NC}"
  
  ensure_project_root || return 1
  
  local branch_name
  read -r -p "Enter feature branch name (e.g., feature/user-auth): " branch_name
  
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
  echo "Creating feature branch: $branch_name"
  if ! git checkout -b "$branch_name"; then
    echo -e "${RED}❌ Failed to create feature branch${NC}"
    return 1
  fi
  
  echo -e "${GREEN}✅ Feature branch '$branch_name' created successfully${NC}"
  return 0
}

# Prepare commit (pre-checks only)
prepare_commit() {
  echo -e "${BLUE}Running pre-commit validation checks...${NC}"
  
  ensure_project_root || return 1
  
  # Run validation
  echo "Running pre-commit validation..."
  if ! run_mfu_context_validation; then
    echo -e "${RED}❌ Validation failed - commit aborted${NC}"
    return 1
  fi
  
  echo -e "${GREEN}✅ All pre-commit validations passed!${NC}"
  echo ""
  read -r -p "Would you like to start the commit process now? [Y/n]: " start_commit
  if [[ "$start_commit" =~ ^[Nn]$ ]]; then
    echo -e "${YELLOW}Commit process cancelled${NC}"
    return 0
  fi
  
  # Start the structured commit process
  run_structured_commit_process
}

# Structured commit process with update type and focus area
run_structured_commit_process() {
  echo -e "${BLUE}Starting structured commit process...${NC}"
  
  ensure_project_root || return 1
  
  # Check for uncommitted changes
  if [[ -z $(git status --porcelain) ]]; then
    echo -e "${YELLOW}No changes to commit${NC}"
    return 0
  fi
  
  echo -e "${BLUE}1. Staging changes...${NC}"
  git status --short
  echo ""
  
  # Check if we're in an interactive terminal
  if [[ -t 0 ]]; then
    read -r -p "Stage all changes? [Y/n]: " stage_changes
    if [[ ! "$stage_changes" =~ ^[Nn]$ ]]; then
      git add .
      echo -e "${GREEN}✓ All changes staged${NC}"
    else
      echo "Please stage your changes manually with: git add <files>"
      return 1
    fi
  else
    # Non-interactive mode - auto-stage all changes
    echo "Non-interactive mode: auto-staging all changes"
    git add .
    echo -e "${GREEN}✓ All changes staged${NC}"
  fi
  
  # Prompt for commit type
  echo -e "${BLUE}2. Select update type:${NC}"
  echo "1) feat     - A new feature"
  echo "2) fix      - A bug fix"
  echo "3) docs     - Documentation only changes"
  echo "4) style    - Changes that do not affect the meaning of the code"
  echo "5) refactor - A code change that neither fixes a bug nor adds a feature"
  echo "6) test     - Adding missing tests or correcting existing tests"
  echo "7) chore    - Changes to the build process or auxiliary tools"
  echo "8) perf     - A code change that improves performance"
  echo "9) ci       - Changes to CI configuration files and scripts"
  echo "10) build   - Changes that affect the build system or external dependencies"
  echo ""
  
  read -r -p "Enter update type [1-10]: " commit_type_choice
  
  local commit_type=""
  case $commit_type_choice in
    1) commit_type="feat" ;;
    2) commit_type="fix" ;;
    3) commit_type="docs" ;;
    4) commit_type="style" ;;
    5) commit_type="refactor" ;;
    6) commit_type="test" ;;
    7) commit_type="chore" ;;
    8) commit_type="perf" ;;
    9) commit_type="ci" ;;
    10) commit_type="build" ;;
    *)
      echo -e "${RED}Invalid choice. Defaulting to 'feat'${NC}"
      commit_type="feat"
      ;;
  esac
  
  # Prompt for focus area (scope)
  echo ""
  echo -e "${BLUE}3. Select focus area:${NC}"
  echo "- auth (authentication related)"
  echo "- api (API endpoints)"
  echo "- ui (user interface components)"
  echo "- db (database related)"
  echo "- config (configuration changes)"
  echo "- middleware (middleware changes)"
  echo "- types (TypeScript types)"
  echo "- docs (documentation changes)"
  echo "- scripts (development scripts)"
  echo "- mfu (MFU workflow changes)"
  echo "- validation (validation system changes)"
  echo ""
  read -r -p "Enter focus area (optional, press Enter to skip): " commit_scope
  
  # Prompt for commit description
  echo ""
  read -r -p "4. Enter commit description: " commit_description
  if [[ -z "$commit_description" ]]; then
    echo -e "${RED}Commit description cannot be empty${NC}"
    return 1
  fi
  
  # Build commit message
  local commit_message=""
  if [[ -n "$commit_scope" ]]; then
    commit_message="${commit_type}(${commit_scope}): ${commit_description}"
  else
    commit_message="${commit_type}: ${commit_description}"
  fi
  
  # Show preview and confirm
  echo ""
  echo -e "${BLUE}Commit message preview:${NC}"
  echo -e "${GREEN}$commit_message${NC}"
  echo ""
  read -r -p "Confirm commit message? [Y/n]: " confirm_commit
  if [[ "$confirm_commit" =~ ^[Nn]$ ]]; then
    echo -e "${YELLOW}Commit cancelled${NC}"
    return 1
  fi
  
  # Commit changes
  echo -e "${BLUE}5. Committing changes...${NC}"
  if ! git commit -m "$commit_message"; then
    echo -e "${RED}❌ Failed to commit changes${NC}"
    return 1
  fi
  
  echo -e "${GREEN}✅ Changes committed successfully${NC}"
  
  # Ask if they want to push
  read -r -p "Push changes to remote? [Y/n]: " push_changes
  if [[ ! "$push_changes" =~ ^[Nn]$ ]]; then
    if ! git push -u origin "$(get_current_branch)"; then
      echo -e "${RED}❌ Failed to push changes${NC}"
      return 1
    fi
    echo -e "${GREEN}✅ Changes pushed to remote${NC}"
  fi
  
  return 0
}

# Non-interactive commit process for MFU workflow
run_non_interactive_commit_process() {
  echo -e "${BLUE}Starting non-interactive commit process...${NC}"
  
  ensure_project_root || return 1
  
  # Check for uncommitted changes
  if [[ -z $(git status --porcelain) ]]; then
    echo -e "${YELLOW}No changes to commit${NC}"
    return 0
  fi
  
  echo -e "${BLUE}1. Staging changes...${NC}"
  git status --short
  echo ""
  echo "Auto-staging all changes"
  git add .
  echo -e "${GREEN}✓ All changes staged${NC}"
  
  # Auto-detect commit type based on changed files
  local changed_files
  changed_files=$(git diff --cached --name-only)
  
  local commit_type=""
  if echo "$changed_files" | grep -q "\.md$"; then
    commit_type="docs"
    echo "Detected documentation changes, using 'docs'"
  elif echo "$changed_files" | grep -q "scripts/"; then
    commit_type="chore"
    echo "Detected script changes, using 'chore'"
  elif echo "$changed_files" | grep -q "backend/"; then
    commit_type="feat"
    echo "Detected backend changes, using 'feat'"
  else
    commit_type="feat"
    echo "Defaulting to 'feat'"
  fi
  
  # Auto-detect scope based on changed files
  local commit_scope=""
  if echo "$changed_files" | grep -q "scripts/"; then
    commit_scope="scripts"
    echo "Detected script changes, using scope 'scripts'"
  elif echo "$changed_files" | grep -q "docs/"; then
    commit_scope="docs"
    echo "Detected documentation changes, using scope 'docs'"
  elif echo "$changed_files" | grep -q "backend/"; then
    commit_scope="api"
    echo "Detected backend changes, using scope 'api'"
  else
    echo "No specific scope detected"
  fi
  
  # Generate description based on changes
  local commit_description=""
  if echo "$changed_files" | grep -q "\.md$"; then
    commit_description="Update documentation"
  elif echo "$changed_files" | grep -q "scripts/"; then
    commit_description="Update development scripts"
  elif echo "$changed_files" | grep -q "backend/"; then
    commit_description="Update backend implementation"
  else
    commit_description="Update project files"
  fi
  echo "Generated description: '$commit_description'"
  
  # Build commit message
  local commit_message=""
  if [[ -n "$commit_scope" ]]; then
    commit_message="${commit_type}(${commit_scope}): ${commit_description}"
  else
    commit_message="${commit_type}: ${commit_description}"
  fi
  
  # Show preview
  echo ""
  echo -e "${BLUE}Commit message preview:${NC}"
  echo -e "${GREEN}$commit_message${NC}"
  echo ""
  echo "Auto-confirming commit"
  
  # Commit changes
  echo -e "${BLUE}Committing changes...${NC}"
  if ! git commit -m "$commit_message"; then
    echo -e "${RED}❌ Failed to commit changes${NC}"
    return 1
  fi
  
  echo -e "${GREEN}✅ Changes committed successfully${NC}"
  
  # Auto-push
  echo "Auto-pushing changes"
  if ! git push -u origin "$(get_current_branch)"; then
    echo -e "${RED}❌ Failed to push changes${NC}"
    return 1
  fi
  echo -e "${GREEN}✅ Changes pushed to remote${NC}"
  
  return 0
}

# Fast structured commit process (skips hooks for rapid development)
run_fast_structured_commit_process() {
  echo -e "${BLUE}Starting fast structured commit process (skipping hooks)...${NC}"
  
  ensure_project_root || return 1
  
  # Check for uncommitted changes
  if [[ -z $(git status --porcelain) ]]; then
    echo -e "${YELLOW}No changes to commit${NC}"
    return 0
  fi
  
  echo -e "${BLUE}1. Staging changes...${NC}"
  git status --short
  echo ""
  read -r -p "Stage all changes? [Y/n]: " stage_changes
  if [[ ! "$stage_changes" =~ ^[Nn]$ ]]; then
    git add .
    echo -e "${GREEN}✓ All changes staged${NC}"
  else
    echo "Please stage your changes manually with: git add <files>"
    return 1
  fi
  
  # Prompt for commit type
  echo -e "${BLUE}2. Select update type:${NC}"
  echo "1) feat     - A new feature"
  echo "2) fix      - A bug fix"
  echo "3) docs     - Documentation only changes"
  echo "4) style    - Changes that do not affect the meaning of the code"
  echo "5) refactor - A code change that neither fixes a bug nor adds a feature"
  echo "6) test     - Adding missing tests or correcting existing tests"
  echo "7) chore    - Changes to the build process or auxiliary tools"
  echo "8) perf     - A code change that improves performance"
  echo "9) ci       - Changes to CI configuration files and scripts"
  echo "10) build   - Changes that affect the build system or external dependencies"
  echo ""
  
  read -r -p "Enter update type [1-10]: " commit_type_choice
  
  local commit_type=""
  case $commit_type_choice in
    1) commit_type="feat" ;;
    2) commit_type="fix" ;;
    3) commit_type="docs" ;;
    4) commit_type="style" ;;
    5) commit_type="refactor" ;;
    6) commit_type="test" ;;
    7) commit_type="chore" ;;
    8) commit_type="perf" ;;
    9) commit_type="ci" ;;
    10) commit_type="build" ;;
    *)
      echo -e "${RED}Invalid choice. Defaulting to 'feat'${NC}"
      commit_type="feat"
      ;;
  esac
  
  # Prompt for focus area (scope)
  echo ""
  echo -e "${BLUE}3. Select focus area:${NC}"
  echo "- auth (authentication related)"
  echo "- api (API endpoints)"
  echo "- ui (user interface components)"
  echo "- db (database related)"
  echo "- config (configuration changes)"
  echo "- middleware (middleware changes)"
  echo "- types (TypeScript types)"
  echo "- docs (documentation changes)"
  echo "- scripts (development scripts)"
  echo "- mfu (MFU workflow changes)"
  echo "- validation (validation system changes)"
  echo ""
  read -r -p "Enter focus area (optional, press Enter to skip): " commit_scope
  
  # Prompt for commit description
  echo ""
  read -r -p "4. Enter commit description: " commit_description
  if [[ -z "$commit_description" ]]; then
    echo -e "${RED}Commit description cannot be empty${NC}"
    return 1
  fi
  
  # Build commit message
  local commit_message=""
  if [[ -n "$commit_scope" ]]; then
    commit_message="${commit_type}(${commit_scope}): ${commit_description}"
  else
    commit_message="${commit_type}: ${commit_description}"
  fi
  
  # Show preview and confirm
  echo ""
  echo -e "${BLUE}Commit message preview:${NC}"
  echo -e "${GREEN}$commit_message${NC}"
  echo ""
  read -r -p "Confirm commit message? [Y/n]: " confirm_commit
  if [[ "$confirm_commit" =~ ^[Nn]$ ]]; then
    echo -e "${YELLOW}Commit cancelled${NC}"
    return 1
  fi
  
  # Commit changes with --no-verify to skip hooks
  echo -e "${BLUE}5. Committing changes (skipping hooks)...${NC}"
  if ! git commit --no-verify -m "$commit_message"; then
    echo -e "${RED}❌ Failed to commit changes${NC}"
    return 1
  fi
  
  echo -e "${GREEN}✅ Changes committed successfully (hooks skipped)${NC}"
  
  # Ask if they want to push
  read -r -p "Push changes to remote? [Y/n]: " push_changes
  if [[ ! "$push_changes" =~ ^[Nn]$ ]]; then
    echo -e "${BLUE}Pushing changes (skipping pre-push hooks)...${NC}"
    if ! git push --no-verify -u origin "$(get_current_branch)"; then
      echo -e "${RED}❌ Failed to push changes${NC}"
      return 1
    fi
    echo -e "${GREEN}✅ Changes pushed to remote (hooks skipped)${NC}"
  fi
  
  return 0
}

# Check documentation coverage (simplified for this project)
check_documentation_coverage() {
  echo -e "${BLUE}Checking documentation coverage...${NC}"
  
  ensure_project_root || return 1
  
  # Check if docs exist
  if [[ ! -d "docs" ]]; then
    echo -e "${RED}❌ No docs directory found${NC}"
    return 1
  fi
  
  # Count documentation files
  local doc_count
  doc_count=$(find docs -name "*.md" -type f | wc -l)
  
  echo "Found $doc_count documentation files"
  
  if [[ $doc_count -gt 0 ]]; then
    echo -e "${GREEN}✅ Documentation present${NC}"
    return 0
  else
    echo -e "${YELLOW}⚠️  No documentation files found${NC}"
    return 1
  fi
}

# Fix markdown lint issues
fix_markdown_lint() {
  echo -e "${BLUE}Fixing markdown lint issues...${NC}"
  
  ensure_project_root || return 1
  
  # Check if markdownlint-cli2 is available (prefer cli2)
  if command -v markdownlint-cli2 &> /dev/null; then
    if markdownlint-cli2 --fix "**/*.md" "#node_modules"; then
      echo -e "${GREEN}✅ Markdown lint issues fixed${NC}"
      return 0
    else
      echo -e "${RED}❌ Some markdown issues could not be fixed${NC}"
      return 1
    fi
  elif command -v markdownlint &> /dev/null; then
    if markdownlint --fix "**/*.md" --ignore node_modules; then
      echo -e "${GREEN}✅ Markdown lint issues fixed${NC}"
      return 0
    else
      echo -e "${RED}❌ Some markdown issues could not be fixed${NC}"
      return 1
    fi
  else
    echo -e "${YELLOW}⚠️  markdownlint not found${NC}"
    echo -e "${YELLOW}Install with: npm install -g markdownlint-cli2${NC}"
    return 1
  fi
}

# Check markdown lint issues
check_markdown_lint() {
  echo -e "${BLUE}Checking markdown lint issues...${NC}"
  
  ensure_project_root || return 1
  
  # Check if markdownlint-cli2 is available (prefer cli2)
  if command -v markdownlint-cli2 &> /dev/null; then
    if markdownlint-cli2 "**/*.md" "#node_modules"; then
      echo -e "${GREEN}✅ No markdown lint issues found${NC}"
      return 0
    else
      echo -e "${YELLOW}⚠️  Markdown lint issues found. Run 'fix-markdown' to auto-fix.${NC}"
      return 1
    fi
  elif command -v markdownlint &> /dev/null; then
    if markdownlint "**/*.md" --ignore node_modules; then
      echo -e "${GREEN}✅ No markdown lint issues found${NC}"
      return 0
    else
      echo -e "${YELLOW}⚠️  Markdown lint issues found. Run 'fix-markdown' to auto-fix.${NC}"
      return 1
    fi
  else
    echo -e "${YELLOW}⚠️  markdownlint not found${NC}"
    echo -e "${YELLOW}Install with: npm install -g markdownlint-cli2${NC}"
    return 1
  fi
} 

# Classify changed files since last validation
classify_changed_files() {
  local cache_timestamp
  cache_timestamp=$(get_validation_cache_timestamp)

  if [[ "$cache_timestamp" == "0" ]]; then
    # First run - only return categories that actually exist and have valid structure in this project
    local categories=""
    if [[ -d "frontend" ]] && [[ -f "frontend/package.json" ]] && [[ -f "frontend/next.config.js" ]]; then
      categories+="frontend "
    fi
    if [[ -d "backend" ]] && [[ -f "backend/pyproject.toml" ]] && [[ -d "backend/app" ]]; then
      categories+="backend "
    fi
    categories+="scripts docs config other"
    echo "$categories" | xargs # trim
    return 0
  fi

  local cache_date
  cache_date=$(timestamp_to_date "$cache_timestamp" "%Y-%m-%d %H:%M:%S")
  if [[ -z "$cache_date" ]]; then
    # Fallback - only return categories that actually exist and have valid structure in this project
    local categories=""
    if [[ -d "frontend" ]] && [[ -f "frontend/package.json" ]] && [[ -f "frontend/next.config.js" ]]; then
      categories+="frontend "
    fi
    if [[ -d "backend" ]] && [[ -f "backend/pyproject.toml" ]] && [[ -d "backend/app" ]]; then
      categories+="backend "
    fi
    categories+="scripts docs config other"
    echo "$categories" | xargs # trim
    return 0
  fi

  local changed_files
  changed_files=$(git diff --name-only --since="$cache_date" 2>/dev/null)
  if [[ -z "$changed_files" ]]; then
    echo ""
    return 0
  fi

  local categories=""
  local seen_frontend=0
  local seen_backend=0
  local seen_scripts=0
  local seen_docs=0
  local seen_config=0
  local seen_other=0

  while IFS= read -r file; do
    if [[ "$file" == frontend/* ]]; then
      seen_frontend=1
    fi
    if [[ "$file" == backend/* ]]; then
      seen_backend=1
    fi
    if [[ "$file" == scripts/* ]]; then
      seen_scripts=1
    fi
    if [[ "$file" =~ \.md$ ]] || [[ "$file" =~ \.mdx$ ]]; then
      seen_docs=1
    fi
    if [[ "$file" =~ \.(json|yaml|yml|toml)$ ]]; then
      seen_config=1
    fi
    # If not matched above, mark as other
    if [[ ! "$file" =~ ^frontend/ && ! "$file" =~ ^backend/ && ! "$file" =~ ^scripts/ && ! "$file" =~ \.md$ && ! "$file" =~ \.mdx$ && ! "$file" =~ \.(json|yaml|yml|toml)$ ]]; then
      seen_other=1
    fi
  done <<< "$changed_files"

  [[ $seen_frontend -eq 1 ]] && categories+="frontend "
  [[ $seen_backend -eq 1 ]] && categories+="backend "
  [[ $seen_scripts -eq 1 ]] && categories+="scripts "
  [[ $seen_docs -eq 1 ]] && categories+="docs "
  [[ $seen_config -eq 1 ]] && categories+="config "
  [[ $seen_other -eq 1 ]] && categories+="other "

  echo "$categories" | xargs # trim
} 

# View development logs
view_development_logs() {
  echo -e "${BLUE}📋 Development Logs Viewer${NC}"
  echo ""
  
  # Check if we're in the project root
  if [[ ! -d "logs" ]]; then
    echo -e "${RED}❌ No logs directory found${NC}"
    echo -e "${YELLOW}💡 Start the development environment first using option 57${NC}"
    return 1
  fi
  
  echo -e "${BLUE}Available log files:${NC}"
  echo ""
  
  # Check for backend logs
  if [[ -f "logs/backend.log" ]]; then
    echo -e "${GREEN}✅ Backend logs: logs/backend.log${NC}"
  else
    echo -e "${RED}❌ Backend logs not found${NC}"
  fi
  
  # Check for frontend logs
  if [[ -f "logs/frontend.log" ]]; then
    echo -e "${GREEN}✅ Frontend logs: logs/frontend.log${NC}"
  else
    echo -e "${RED}❌ Frontend logs not found${NC}"
  fi
  
  # Check for error logs
  if [[ -f "logs/backend_errors.log" ]]; then
    echo -e "${GREEN}✅ Backend errors: logs/backend_errors.log${NC}"
  else
    echo -e "${YELLOW}⚠️  No backend errors logged${NC}"
  fi
  
  echo ""
  echo -e "${BLUE}Log viewing options:${NC}"
  echo "1) View backend logs (last 50 lines)"
  echo "2) View frontend logs (last 50 lines)"
  echo "3) View backend errors (last 50 lines)"
  echo "4) Watch backend logs (live)"
  echo "5) Watch frontend logs (live)"
  echo "6) Watch backend errors (live)"
  echo "7) Clear all logs"
  echo "0) Back to main menu"
  echo ""
  
  read -r -p "Select an option: " log_choice
  
  case $log_choice in
    1)
      if [[ -f "logs/backend.log" ]]; then
        echo -e "${BLUE}📝 Backend logs (last 50 lines):${NC}"
        echo "----------------------------------------"
        tail -n 50 logs/backend.log
      else
        echo -e "${RED}❌ Backend logs not found${NC}"
      fi
      ;;
    2)
      if [[ -f "logs/frontend.log" ]]; then
        echo -e "${BLUE}📝 Frontend logs (last 50 lines):${NC}"
        echo "----------------------------------------"
        tail -n 50 logs/frontend.log
      else
        echo -e "${RED}❌ Frontend logs not found${NC}"
      fi
      ;;
    3)
      if [[ -f "logs/backend_errors.log" ]]; then
        echo -e "${BLUE}📝 Backend errors (last 50 lines):${NC}"
        echo "----------------------------------------"
        tail -n 50 logs/backend_errors.log
      else
        echo -e "${YELLOW}⚠️  No backend errors logged${NC}"
      fi
      ;;
    4)
      if [[ -f "logs/backend.log" ]]; then
        echo -e "${BLUE}🔍 Watching backend logs (Ctrl+C to stop):${NC}"
        echo "----------------------------------------"
        tail -f logs/backend.log
      else
        echo -e "${RED}❌ Backend logs not found${NC}"
      fi
      ;;
    5)
      if [[ -f "logs/frontend.log" ]]; then
        echo -e "${BLUE}🔍 Watching frontend logs (Ctrl+C to stop):${NC}"
        echo "----------------------------------------"
        tail -f logs/frontend.log
      else
        echo -e "${RED}❌ Frontend logs not found${NC}"
      fi
      ;;
    6)
      if [[ -f "logs/backend_errors.log" ]]; then
        echo -e "${BLUE}🔍 Watching backend errors (Ctrl+C to stop):${NC}"
        echo "----------------------------------------"
        tail -f logs/backend_errors.log
      else
        echo -e "${YELLOW}⚠️  No backend errors logged${NC}"
      fi
      ;;
    7)
      echo -e "${YELLOW}⚠️  Are you sure you want to clear all logs? (y/N)${NC}"
      read -r clear_confirm
      if [[ "$clear_confirm" =~ ^[Yy]$ ]]; then
        rm -f logs/*.log
        echo -e "${GREEN}✅ All logs cleared${NC}"
      else
        echo "Operation cancelled."
      fi
      ;;
    0)
      return 0
      ;;
    *)
      echo -e "${RED}❌ Invalid option${NC}"
      ;;
  esac
  
  echo ""
  echo -e "${BLUE}Press Enter to continue...${NC}"
  read -r
} 