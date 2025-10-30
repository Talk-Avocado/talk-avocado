# ES Module Compliance Checker (PowerShell version)
# This script ensures all JavaScript/TypeScript files use ES modules

param(
    [switch]$Verbose
)

Write-Host "🔍 Checking ES module compliance..." -ForegroundColor Blue

$ErrorCount = 0

# Check for CommonJS require statements
Write-Host "Checking for require() statements..." -ForegroundColor Yellow
$RequireFiles = Get-ChildItem -Recurse -Include "*.js", "*.ts" | Where-Object { 
    $_.FullName -notmatch "node_modules" -and 
    $_.FullName -notmatch "dist" -and 
    $_.Name -notmatch "\.cjs$" 
} | Select-String -Pattern "require\(" -SimpleMatch

if ($RequireFiles) {
    Write-Host "❌ Found $($RequireFiles.Count) require() statements:" -ForegroundColor Red
    $RequireFiles | ForEach-Object {
        Write-Host "  $($_.Filename):$($_.LineNumber): $($_.Line.Trim())" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "💡 Convert these to import statements" -ForegroundColor Yellow
    Write-Host "   Example: const fs = require('fs') → import { readFile } from 'fs'" -ForegroundColor Yellow
    $ErrorCount++
}

# Check for module.exports statements
Write-Host "Checking for module.exports statements..." -ForegroundColor Yellow
$ModuleExportsFiles = Get-ChildItem -Recurse -Include "*.js", "*.ts" | Where-Object { 
    $_.FullName -notmatch "node_modules" -and 
    $_.FullName -notmatch "dist" -and 
    $_.Name -notmatch "\.cjs$" 
} | Select-String -Pattern "module\.exports" -SimpleMatch

if ($ModuleExportsFiles) {
    Write-Host "❌ Found $($ModuleExportsFiles.Count) module.exports statements:" -ForegroundColor Red
    $ModuleExportsFiles | ForEach-Object {
        Write-Host "  $($_.Filename):$($_.LineNumber): $($_.Line.Trim())" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "💡 Convert these to export statements" -ForegroundColor Yellow
    Write-Host "   Example: module.exports = { func } → export { func }" -ForegroundColor Yellow
    $ErrorCount++
}

# Check package.json files for type: "module"
Write-Host "Checking package.json files for ES module configuration..." -ForegroundColor Yellow
$PackageFiles = Get-ChildItem -Recurse -Name "package.json" | Where-Object { 
    $_ -notmatch "node_modules" -and $_ -notmatch "dist" 
}

foreach ($packageFile in $PackageFiles) {
    $content = Get-Content $packageFile -Raw
    if ($content -notmatch '"type":\s*"module"') {
        Write-Host "⚠️  $packageFile missing `"type`": `"module`"" -ForegroundColor Yellow
    } else {
        if ($Verbose) {
            Write-Host "✅ $packageFile has ES module configuration" -ForegroundColor Green
        }
    }
}

if ($ErrorCount -eq 0) {
    Write-Host "✅ All files are using ES modules!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "❌ Found $ErrorCount ES module compliance issues" -ForegroundColor Red
    exit 1
}
