# Quick test script to verify path resolution
# Run this while the API server is running to check what path it's using

Write-Host "Testing storage path resolution..." -ForegroundColor Cyan

# Test with an actual job
Write-Host "`nTesting actual job lookup..." -ForegroundColor Cyan
if ($args.Count -eq 0) {
    Write-Host "Usage: .\test-path-resolution.ps1 <jobId>" -ForegroundColor Yellow
    exit 1
}
$jobId = $args[0]
Write-Host "Job ID: $jobId" -ForegroundColor Yellow

try {
    $result = Invoke-RestMethod -Uri "http://localhost:3000/jobs/$jobId?tenantId=demo-tenant"
    Write-Host "✓ Job found!" -ForegroundColor Green
    Write-Host ($result | ConvertTo-Json -Depth 3)
} catch {
    Write-Host "✗ Error: $_" -ForegroundColor Red
    Write-Host "Response: $($_.Exception.Response)" -ForegroundColor Red
}

# Check if manifest file exists
$manifestPath = "D:\talk-avocado\storage\dev\demo-tenant\$jobId\manifest.json"
Write-Host "`nChecking manifest file at: $manifestPath" -ForegroundColor Cyan
if (Test-Path $manifestPath) {
    Write-Host "✓ Manifest file EXISTS at expected location" -ForegroundColor Green
    $manifest = Get-Content $manifestPath | ConvertFrom-Json
    Write-Host "Manifest contents:" -ForegroundColor Yellow
    Write-Host ($manifest | ConvertTo-Json -Depth 3)
} else {
    Write-Host "✗ Manifest file NOT FOUND at expected location" -ForegroundColor Red
    Write-Host "Expected path: $manifestPath" -ForegroundColor Yellow
}

