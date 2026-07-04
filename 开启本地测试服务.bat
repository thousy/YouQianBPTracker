@echo off
title YouQian BP Tracker - Local Test Server
echo ==================================================
echo         YouQian BP Tracker Local Server
echo ==================================================
echo.
echo [1/3] Checking Node.js environment...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found on your system!
    echo Please install Node.js from https://nodejs.org
    echo.
    pause
    exit /b
)

echo [2/3] Opening application in your browser...
start "" "http://localhost:9988/index.html"

echo [3/3] Starting local HTTP server on port 9988...
echo --------------------------------------------------
echo Server Cwd: %~dp0
echo Server URL: http://localhost:9988
echo Notice: Please DO NOT close this window.
echo --------------------------------------------------
echo.

cd /d "%~dp0"
npx --yes http-server ./ -p 9988 --cors -c-1

if %errorlevel% neq 0 (
    echo.
    echo [WARNING] Server failed to start!
    echo Port 9988 might be already in use.
    echo.
    pause
)
