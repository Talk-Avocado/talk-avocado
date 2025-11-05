# Test script to verify manifest path resolution
# This will help debug why the server can't find manifests

$jobId = "44b6daf2-3a9c-44d9-96f8-f078fd13c114"
$env = "dev"
$tenantId = "demo-tenant"

Write-Host "=== Testing Manifest Path Resolution ===" -ForegroundColor Cyan
Write-Host ""

# Test 1: Check if manifest file exists
Write-Host "Test 1: Checking if manifest file exists..." -ForegroundColor Yellow
$expectedPath = "D:\talk-avocado\storage\$env\$tenantId\$jobId\manifest.json"
Write-Host "Expected path: $expectedPath"
if (Test-Path $expectedPath) {
    Write-Host "✓ Manifest file EXISTS" -ForegroundColor Green
    $m = Get-Content $expectedPath -Raw | ConvertFrom-Json
    Write-Host "  Status: $($m.status)"
    Write-Host "  Has audio: $($m.audio -ne $null)"
} else {
    Write-Host "✗ Manifest file NOT FOUND" -ForegroundColor Red
    Write-Host "  Checking parent directory..."
    $parentDir = Split-Path $expectedPath
    if (Test-Path $parentDir) {
        Write-Host "  Parent directory exists. Contents:"
        Get-ChildItem $parentDir | Select-Object Name
    } else {
        Write-Host "  Parent directory also not found!"
    }
}

Write-Host ""
Write-Host "Test 2: Testing server path resolution..." -ForegroundColor Yellow

# Test what path Node.js would resolve
cd backend
$nodeTest = @"
const path = require('path');
const env = process.env.MEDIA_STORAGE_PATH || './storage';
const root = path.resolve(env);
const manifestPath = path.join(root, 'dev', 'demo-tenant', '44b6daf2-3a9c-44d9-96f8-f078fd13c114', 'manifest.json');
console.log('MEDIA_STORAGE_PATH:', process.env.MEDIA_STORAGE_PATH || '(not set)');
console.log('Resolved root:', root);
console.log('Manifest path:', manifestPath);
const fs = require('fs');
const exists = fs.existsSync(manifestPath);
console.log('File exists:', exists);
"@

$env:MEDIA_STORAGE_PATH='D:\talk-avocado\storage'
node -e $nodeTest

Write-Host ""
Write-Host "Test 3: List all job directories..." -ForegroundColor Yellow
$storageBase = "D:\talk-avocado\storage\dev\demo-tenant"
if (Test-Path $storageBase) {
    Write-Host "Job directories:"
    Get-ChildItem $storageBase -Directory | Select-Object Name | Format-Table
} else {
    Write-Host "✗ Storage base directory not found: $storageBase" -ForegroundColor Red
}



