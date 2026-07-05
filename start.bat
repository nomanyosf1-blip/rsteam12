@echo off
title RS TEAM - Full Stack App
color 0b
echo ===================================================
echo               RS TEAM - STARTUP SYSTEM
echo ===================================================
echo.
echo [1/2] Checking dependencies...
if not exist node_modules (
    echo [!] node_modules not found. Installing...
    call npm install
) else (
    echo [OK] Dependencies already installed.
)

echo.
echo [2/2] Starting Development Server...
echo [TIP] Open http://localhost:3000 in your browser.
echo.
call npm run dev
pause
