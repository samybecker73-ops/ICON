@echo off
setlocal EnableExtensions
chcp 65001 >nul
title ICON - Creation de l'installateur Windows
color 0B

cd /d "%~dp0"

echo.
echo  ============================================================
echo                    ICON - BUILD INSTALLATION
echo  ============================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERREUR] Node.js est introuvable.
    echo Installe Node.js LTS depuis https://nodejs.org/ puis relance ce fichier.
    echo.
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERREUR] npm est introuvable.
    echo.
    pause
    exit /b 1
)

if not exist "package.json" (
    echo [ERREUR] package.json est introuvable.
    pause
    exit /b 1
)

echo [INFO] Versions detectees :
node --version
npm --version

for /f "delims=" %%V in ('node -p "require(`./package.json`).version"') do set "APP_VERSION=%%V"
for /f "tokens=1 delims=v." %%V in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%V"

if not defined NODE_MAJOR (
    echo [ERREUR] Impossible de determiner la version de Node.js.
    pause
    exit /b 1
)
if %NODE_MAJOR% LSS 20 (
    echo [ERREUR] ICON necessite Node.js 20 ou superieur.
    pause
    exit /b 1
)

echo.
echo [1/2] Installation des dependances ICON...
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo [ERREUR] L'installation des dependances a echoue.
    pause
    exit /b 1
)

echo.
echo [TEST] Verification du projet ICON...
call npm test
if errorlevel 1 (
    echo [ERREUR] Les tests du projet ont echoue.
    pause
    exit /b 1
)

echo [2/2] Creation de l'installateur Windows (sans publication)...
call npm run build:win
if errorlevel 1 (
    echo [ERREUR] La creation de l'installateur a echoue.
    pause
    exit /b 1
)

echo.
echo  ============================================================
echo                 BUILD ICON TERMINE
echo  ============================================================
echo.

if exist "dist\ICON-Setup-%APP_VERSION%.exe" (
    echo [OK] Installateur genere :
    echo     %CD%\dist\ICON-Setup-%APP_VERSION%.exe
    start "" explorer "%CD%\dist"
) else (
    echo [ATTENTION] Verifie les messages de electron-builder.
)

echo.
pause
exit /b 0
