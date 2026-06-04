@echo off
echo ============================================================
echo  SRMCGateway - First Time Setup
echo ============================================================
echo.
echo This script copies gradle-wrapper.jar from your Android Studio
echo installation into this project so it can be opened.
echo.

set "STUDIO_JAR=C:\Program Files\Android\Android Studio\plugins\gradle\lib\gradle-wrapper.jar"
set "DEST=%~dp0gradle\wrapper\gradle-wrapper.jar"

if exist "%STUDIO_JAR%" (
    echo Found: %STUDIO_JAR%
    copy "%STUDIO_JAR%" "%DEST%" >nul
    echo.
    echo SUCCESS! gradle-wrapper.jar copied.
    echo.
    echo Now open Android Studio and go to:
    echo   File - Open - select this folder (SRMCGateway)
    echo.
) else (
    echo Android Studio jar not found at default path.
    echo.
    echo Please manually copy gradle-wrapper.jar into:
    echo   %DEST%
    echo.
    echo You can find it at:
    echo   [Android Studio install folder]\plugins\gradle\lib\gradle-wrapper.jar
    echo.
    echo OR open a terminal in this folder and run:
    echo   gradle wrapper --gradle-version 8.2
    echo.
)
pause
