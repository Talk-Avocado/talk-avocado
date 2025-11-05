# cleanup-test-jobs.ps1
# Clean up test job directories, keeping:
# 1. Documented example job (872d6765-2d60-4806-aa8f-b9df56f74c03)
# 2. Default job IDs for test scripts (ae831aac-5a16-4d18-8f4d-a036a9758412, 012a43c4-bfbe-411b-aeb2-18feeda15255)
# 3. Jobs with complete results (audio + transcript + plan) that might be useful for future testing
# 4. Special test directories (chunking-validation-*, test-*, etc.)

$ErrorActionPreference = "Continue"

Write-Host "=== Cleaning up test job directories ===" -ForegroundColor Cyan
Write-Host ""

# Jobs to keep
$keepJobs = @{
    "t-test" = @(
        "872d6765-2d60-4806-aa8f-b9df56f74c03"  # Documented example
    )
    "t-local" = @(
        "ae831aac-5a16-4d18-8f4d-a036a9758412"  # Default for test-timestamp-alignment.js
    )
    "t-perf" = @(
        "012a43c4-bfbe-411b-aeb2-18feeda15255"  # Default for test-whisper-performance-simple.js
    )
}

# Special test directory patterns to keep
$keepPatterns = @(
    "chunking-validation-*",
    "test-*"
)

function Test-JobHasCompleteResults {
    param (
        [string]$JobDir
    )
    
    $manifestPath = Join-Path $JobDir "manifest.json"
    if (-not (Test-Path $manifestPath)) {
        return $false
    }
    
    try {
        $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
        
        # Check for complete pipeline results: audio + transcript + plan
        $hasAudio = $manifest.audio -ne $null -and $manifest.audio.key -ne $null
        $hasTranscript = $manifest.transcript -ne $null -and $manifest.transcript.jsonKey -ne $null
        $hasPlan = $manifest.plan -ne $null -and $manifest.plan.key -ne $null
        
        return ($hasAudio -and $hasTranscript -and $hasPlan)
    }
    catch {
        return $false
    }
}

function Test-MatchesKeepPattern {
    param (
        [string]$JobName
    )
    
    foreach ($pattern in $keepPatterns) {
        if ($JobName -like $pattern) {
            return $true
        }
    }
    return $false
}

# Process each tenant
$tenants = @("t-test", "t-local", "t-perf")
$totalDeleted = 0
$totalKept = 0
$keptComplete = @()

foreach ($tenant in $tenants) {
    $tenantPath = "storage\dev\$tenant"
    if (-not (Test-Path $tenantPath)) {
        Write-Host "Tenant $tenant not found, skipping..." -ForegroundColor Yellow
        continue
    }
    
    Write-Host "Processing tenant: $tenant" -ForegroundColor Cyan
    $jobs = Get-ChildItem -Path $tenantPath -Directory
    
    foreach ($job in $jobs) {
        $jobName = $job.Name
        $jobPath = $job.FullName
        
        # Check if explicitly kept
        if ($keepJobs[$tenant] -contains $jobName) {
            Write-Host "  KEEP: $jobName (explicitly kept)" -ForegroundColor Green
            $totalKept++
            continue
        }
        
        # Check if matches special pattern
        if (Test-MatchesKeepPattern $jobName) {
            Write-Host "  KEEP: $jobName (matches keep pattern)" -ForegroundColor Green
            $totalKept++
            continue
        }
        
        # Check if has complete results
        if (Test-JobHasCompleteResults $jobPath) {
            Write-Host "  KEEP: $jobName (has complete results)" -ForegroundColor Green
            $totalKept++
            $keptComplete += "$tenant/$jobName"
            continue
        }
        
        # Delete this job
        Write-Host "  DELETE: $jobName" -ForegroundColor Yellow
        try {
            Remove-Item -Path $jobPath -Recurse -Force
            $totalDeleted++
        }
        catch {
            Write-Host "    ERROR: Failed to delete $jobName - $_" -ForegroundColor Red
        }
    }
    Write-Host ""
}

Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Deleted: $totalDeleted job directories" -ForegroundColor Yellow
Write-Host "Kept: $totalKept job directories" -ForegroundColor Green
Write-Host ""
Write-Host "Kept jobs with complete results:" -ForegroundColor Cyan
foreach ($job in $keptComplete) {
    Write-Host "  - $job" -ForegroundColor Green
}
Write-Host ""
Write-Host "Cleanup complete!" -ForegroundColor Green

