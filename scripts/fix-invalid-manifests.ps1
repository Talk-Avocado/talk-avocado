# Script to find and fix manifests with invalid sampleRate values
# Usage: .\scripts\fix-invalid-manifests.ps1 -JobId <jobId> [-Env dev]

param(
    [string]$JobId = "",
    [string]$Env = "dev",
    [string]$TenantId = "demo-tenant"
)

$ErrorActionPreference = "Stop"

$storageBase = "D:\talk-avocado\storage\$Env\$TenantId"

Write-Host "=== Finding and Fixing Invalid Manifests ===" -ForegroundColor Cyan
Write-Host "Storage: $storageBase" -ForegroundColor Gray
Write-Host ""

if (-not (Test-Path $storageBase)) {
    Write-Host "Storage directory not found: $storageBase" -ForegroundColor Red
    exit 1
}

# Get all job directories
$jobDirs = if ($JobId) {
    $jobPath = Join-Path $storageBase $JobId
    if (Test-Path $jobPath) {
        @($jobPath)
    } else {
        @()
    }
} else {
    Get-ChildItem $storageBase -Directory | Where-Object { $_.Name -match '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' -or $_.Name -like 'test-*' } | Select-Object -ExpandProperty FullName
}

$allowedSampleRates = @(16000, 22050, 44100, 48000)
$invalidJobs = @()

Write-Host "Checking $($jobDirs.Count) jobs..." -ForegroundColor Yellow
Write-Host ""

foreach ($jobDir in $jobDirs) {
    $jobId = Split-Path $jobDir -Leaf
    $manifestPath = Join-Path $jobDir "manifest.json"
    
    if (-not (Test-Path $manifestPath)) {
        Write-Host "[$jobId] No manifest found" -ForegroundColor Gray
        continue
    }
    
    try {
        $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
        
        if ($manifest.audio -and $manifest.audio.sampleRate) {
            $sampleRate = $manifest.audio.sampleRate
            if ($allowedSampleRates -notcontains $sampleRate) {
                Write-Host "[$jobId] INVALID sampleRate: $sampleRate" -ForegroundColor Red
                $invalidJobs += @{
                    JobId = $jobId
                    Manifest = $manifest
                    InvalidSampleRate = $sampleRate
                    InputKey = $manifest.input.sourceKey
                }
            } else {
                Write-Host "[$jobId] Valid sampleRate: $sampleRate" -ForegroundColor Green
            }
        } else {
            Write-Host "[$jobId] No audio data in manifest" -ForegroundColor Gray
        }
    } catch {
        Write-Host "[$jobId] Error reading manifest: $_" -ForegroundColor Red
    }
}

if ($invalidJobs.Count -eq 0) {
    Write-Host ""
    Write-Host "No invalid manifests found!" -ForegroundColor Green
    exit 0
}

Write-Host ""
Write-Host "Found $($invalidJobs.Count) jobs with invalid sampleRate values:" -ForegroundColor Yellow
foreach ($job in $invalidJobs) {
    Write-Host "  - $($job.JobId): sampleRate=$($job.InvalidSampleRate)" -ForegroundColor Yellow
}

Write-Host ""
$proceed = Read-Host "Do you want to re-run audio extraction for these jobs? (y/N)"
if ($proceed -ne 'y' -and $proceed -ne 'Y') {
    Write-Host "Cancelled." -ForegroundColor Gray
    exit 0
}

# Re-run audio extraction for invalid jobs
Write-Host ""
Write-Host "Re-running audio extraction..." -ForegroundColor Cyan
Write-Host ""

$env:TALKAVOCADO_ENV = $Env
$env:MEDIA_STORAGE_PATH = "D:\talk-avocado\storage"

foreach ($job in $invalidJobs) {
    $jobId = $job.JobId
    $inputKey = $job.InputKey
    
    if (-not $inputKey) {
        Write-Host "[$jobId] No inputKey found, skipping" -ForegroundColor Yellow
        continue
    }
    
    Write-Host "[$jobId] Re-running audio extraction..." -ForegroundColor Cyan
    
    # Check if input file exists
    $inputPath = "D:\talk-avocado\storage\$inputKey"
    if (-not (Test-Path $inputPath)) {
        Write-Host "[$jobId] Input file not found: $inputPath" -ForegroundColor Red
        continue
    }
    
    # Invoke the audio extraction handler
    try {
        cd backend
        node -e "
            import('./dist/services/audio-extraction/handler.js').then(async (module) => {
                const event = {
                    env: '$Env',
                    tenantId: '$TenantId',
                    jobId: '$jobId',
                    inputKey: '$inputKey',
                    correlationId: 'fix-manifest-' + Date.now()
                };
                try {
                    const result = await module.handler(event, { awsRequestId: 'fix-' + Date.now() });
                    console.log('Success:', JSON.stringify(result, null, 2));
                    process.exit(0);
                } catch (err) {
                    console.error('Error:', err.message);
                    process.exit(1);
                }
            });
        "
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[$jobId] Audio extraction completed successfully" -ForegroundColor Green
        } else {
            Write-Host "[$jobId] Audio extraction failed" -ForegroundColor Red
        }
        cd ..
    } catch {
        Write-Host "[$jobId] Error running audio extraction: $_" -ForegroundColor Red
        cd ..
    }
}

Write-Host ""
Write-Host "Done! Please verify the manifests now have valid sampleRate values." -ForegroundColor Cyan


