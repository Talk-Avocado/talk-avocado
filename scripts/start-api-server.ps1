# PowerShell script to start API server with correct environment variables
# This ensures MEDIA_STORAGE_PATH and TALKAVOCADO_ENV are set correctly for Windows

Write-Host "Starting API Server with correct environment variables..." -ForegroundColor Blue

# Get project root (script is in scripts/, so go up two levels)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

Write-Host "Project root: $projectRoot" -ForegroundColor Cyan

# Set environment variables for this PowerShell session
$env:TALKAVOCADO_ENV = "dev"
$env:MEDIA_STORAGE_PATH = Join-Path $projectRoot "storage"

Write-Host "Environment variables:" -ForegroundColor Cyan
Write-Host "  TALKAVOCADO_ENV = $env:TALKAVOCADO_ENV"
Write-Host "  MEDIA_STORAGE_PATH = $env:MEDIA_STORAGE_PATH"

# Verify storage directory exists
if (-not (Test-Path $env:MEDIA_STORAGE_PATH)) {
    Write-Host "Creating storage directory: $env:MEDIA_STORAGE_PATH" -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path $env:MEDIA_STORAGE_PATH | Out-Null
}

# Change to backend directory
$backendDir = Join-Path $projectRoot "backend"
Set-Location $backendDir

# Build first
Write-Host "`nBuilding backend..." -ForegroundColor Cyan
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed! Exiting." -ForegroundColor Red
    exit 1
}

# Ensure MEDIA_STORAGE_PATH is set as absolute path (critical for path resolution)
# Re-set to ensure it's available in the spawned process
$env:MEDIA_STORAGE_PATH = Join-Path $projectRoot "storage"
$env:TALKAVOCADO_ENV = "dev"

Write-Host "`nEnvironment variables (for Node.js process):" -ForegroundColor Cyan
Write-Host "  TALKAVOCADO_ENV = $env:TALKAVOCADO_ENV"
Write-Host "  MEDIA_STORAGE_PATH = $env:MEDIA_STORAGE_PATH"
Write-Host "  Working Directory = $(Get-Location)"

# Start the API server
Write-Host "`nStarting API server on http://localhost:3000..." -ForegroundColor Green
Write-Host "Press Ctrl+C to stop`n" -ForegroundColor Yellow

# Run tsx with environment variables explicitly passed
# Using Start-Process with -PassThru to ensure env vars are inherited
npx tsx watch lib/server.ts

