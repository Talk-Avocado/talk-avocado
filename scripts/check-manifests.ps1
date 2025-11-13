# Quick script to check manifests for invalid sampleRate values
$storageBase = "D:\talk-avocado\storage\dev\demo-tenant"
$allowedSampleRates = @(16000, 22050, 44100, 48000)

Write-Host "=== Checking Manifests for Invalid sampleRate ===" -ForegroundColor Cyan
Write-Host ""

Get-ChildItem $storageBase -Directory | ForEach-Object {
    $jobId = $_.Name
    $m = Join-Path $_.FullName "manifest.json"
    
    if (Test-Path $m) {
        try {
            $content = Get-Content $m -Raw | ConvertFrom-Json
            if ($content.audio -and $content.audio.sampleRate) {
                $sr = $content.audio.sampleRate
                if ($allowedSampleRates -notcontains $sr) {
                    Write-Host "$jobId : INVALID sampleRate=$sr" -ForegroundColor Red
                } else {
                    Write-Host "$jobId : Valid sampleRate=$sr" -ForegroundColor Green
                }
            } else {
                Write-Host "$jobId : No audio data" -ForegroundColor Gray
            }
        } catch {
            Write-Host "$jobId : Error: $_" -ForegroundColor Yellow
        }
    }
}








