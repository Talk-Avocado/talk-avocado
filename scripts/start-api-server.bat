@echo off
REM Batch file to start API server with correct environment variables for Windows

echo Starting API Server with correct environment variables...

REM Set environment variables
set TALKAVOCADO_ENV=dev
set MEDIA_STORAGE_PATH=D:\talk-avocado\storage

echo Environment variables:
echo   TALKAVOCADO_ENV = %TALKAVOCADO_ENV%
echo   MEDIA_STORAGE_PATH = %MEDIA_STORAGE_PATH%

REM Change to backend directory
cd /d "%~dp0..\..\backend"

REM Build first
echo.
echo Building backend...
call npm run build

if %ERRORLEVEL% neq 0 (
    echo Build failed! Exiting.
    exit /b 1
)

REM Start the API server
echo.
echo Starting API server on http://localhost:3000...
echo Press Ctrl+C to stop
echo.

call npm run dev:api

