# monitor-test-progress.ps1
# Monitor the chunking validation test progress

$startTime = Get-Date -Date "2025-11-04 13:50:06"
$expectedDuration = 30 # minutes
$processId = 7220

Write-Host "=== Chunking Validation Test Monitor ===" -ForegroundColor Cyan
Write-Host ""

while ($true) {
    $now = Get-Date
    $elapsed = $now - $startTime
    $remaining = New-TimeSpan -Minutes $expectedDuration - $elapsed
    
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "Time: $($now.ToString('HH:mm:ss'))" -ForegroundColor White
    Write-Host ""
    Write-Host "Elapsed: $([math]::Floor($elapsed.TotalMinutes))m $($elapsed.Seconds)s" -ForegroundColor Green
    Write-Host "Remaining: ~$([math]::Floor($remaining.TotalMinutes))m $($remaining.Seconds)s" -ForegroundColor Yellow
    Write-Host "Expected completion: ~$($startTime.AddMinutes($expectedDuration).ToString('HH:mm:ss'))" -ForegroundColor Cyan
    Write-Host ""
    
    if ($process) {
        Write-Host "Status: ✅ RUNNING (PID: $processId)" -ForegroundColor Green
        Write-Host "CPU Time: $($process.CPU)s" -ForegroundColor Gray
        Write-Host "Memory: $([math]::Round($process.WorkingSet / 1MB, 2)) MB" -ForegroundColor Gray
    } else {
        Write-Host "Status: ⚠️  PROCESS NOT FOUND" -ForegroundColor Red
        Write-Host "Test may have completed or failed" -ForegroundColor Yellow
        break
    }
    
    Write-Host ""
    Write-Host "Checking again in 60 seconds..." -ForegroundColor Gray
    Write-Host ""
    
    Start-Sleep -Seconds 60
}

Write-Host "Monitoring stopped." -ForegroundColor Yellow

