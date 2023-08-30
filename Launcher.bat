@echo off
REM --------------------------------------------
REM This script was created by: Deffcolony
REM --------------------------------------------
title SillyTavern Launcher
setlocal

REM ANSI Escape Code for Colors
set "reset=[0m"

REM Strong Foreground Colors
set "white_fg_strong=[90m"
set "red_fg_strong=[91m"
set "green_fg_strong=[92m"
set "yellow_fg_strong=[93m"
set "blue_fg_strong=[94m"
set "magenta_fg_strong=[95m"
set "cyan_fg_strong=[96m"

REM Normal Background Colors
set "red_bg=[41m"
set "blue_bg=[44m"

REM Environment Variables (TOOLBOX 7-Zip)
set "zip7version=7z2301-x64"
set "zip7_install_path=%ProgramFiles%\7-Zip"
set "zip7_download_path=%TEMP%\%zip7version%.exe"

REM Environment Variables (TOOLBOX FFmpeg)
set "ffmpeg_url=https://www.gyan.dev/ffmpeg/builds/ffmpeg-git-full.7z"
set "ffdownload_path=%TEMP%\ffmpeg.7z"
set "ffextract_path=C:\ffmpeg"
set "bin_path=%ffextract_path%\bin"

REM Environment Variables (TOOLBOX Node.js)
set "node_installer_path=%temp%\NodejsInstaller.msi"


REM Check if Git is installed if not then install git
git --version > nul 2>&1
if %errorlevel% neq 0 (
    echo %yellow_fg_strong%[WARN]%reset% Git is not installed on this system. 
    echo %blue_fg_strong%[INFO]%reset% Installing Git...
    bitsadmin /transfer "GitInstaller" /download /priority FOREGROUND "https://github.com/git-for-windows/git/releases/download/v2.42.0.windows.1/Git-2.42.0-64-bit.exe" "%temp%GitInstaller.exe"
rem    curl -o "%temp%\GitInstaller.exe" "https://github.com/git-for-windows/git/releases/download/v2.42.0.windows.1/Git-2.42.0-64-bit.exe"
    echo %blue_fg_strong%[INFO]%reset% Launching GitInstaller...
    powershell.exe -nologo -noprofile -command "Start-Process '%temp%GitInstaller.exe' -Verb runAs"
    echo %blue_bg%From the Git installer: Click NEXT on everything.%reset%
    pause
    del "%temp%GitInstaller.exe"
    echo %green_fg_strong%Git is installed. Please restart the Launcher.%reset%
    pause
    exit
)

REM Check for updates
git fetch origin

for /f %%i in ('git rev-list HEAD...origin/%current_branch%') do (
    set "update_status=%yellow_fg_strong%Update Available%reset%"
    goto :found_update
)

set "update_status=%green_fg_strong%Up to Date%reset%"
:found_update


REM Home - frontend
:home
cls
echo %blue_fg_strong%/ Home%reset%
echo -------------------------------------
echo What would you like to do?
echo 1. Start SillyTavern
echo 2. Update
echo 3. Switch to release branch
echo 4. Switch to staging branch
echo 5. Backup
echo 6. Toolbox
echo 7. Exit

REM Get the current Git branch
for /f %%i in ('git branch --show-current') do set current_branch=%%i
echo ======== VERSION STATUS =========
echo Current branch: %cyan_fg_strong%%current_branch%%reset%
echo Update Status: %update_status%
echo =================================
set /p choice=Choose Your Destiny: 


REM Home - backend
if "%choice%"=="1" (
    call :start
) else if "%choice%"=="2" (
    call :update
) else if "%choice%"=="3" (
    call :switch_release
) else if "%choice%"=="4" (
    call :switch_staging
) else if "%choice%"=="5" (
    call :backup_menu
) else if "%choice%"=="6" (
    call :toolbox
) else if "%choice%"=="7" (
    exit
) else (
    color 6
    echo WARNING: Invalid number. Please insert a valid number.
    pause
    goto :home
)

:start
REM Check if Node.js is installed
node --version > nul 2>&1
if %errorlevel% neq 0 (
    echo %red_fg_strong%[ERROR] node command not found in PATH%reset%
    echo %red_bg%Please make sure Node.js is installed and added to your PATH.%reset%
    echo %blue_bg%To install Node.js go to Toolbox%reset%
    pause
    goto :home
)

echo Launching SillyTavern...
cls
pushd %~dp0
call npm install --no-audit
node server.js
pause
popd
goto :home

:update
echo Updating...
pushd %~dp0

REM Check if git is installed
git --version > nul 2>&1
if %errorlevel% neq 0 (
    echo %red_fg_strong%[ERROR] git command not found in PATH. Skipping update.%reset%
    echo %red_bg%Please make sure Git is installed and added to your PATH.%reset%
    echo %blue_bg%To install Git go to Toolbox%reset%
) else (
    call git pull --rebase --autostash
    if %errorlevel% neq 0 (
        REM incase there is still something wrong
        echo There were errors while updating. Please download the latest version manually.
    )
)
pause
goto :home


:switch_release
REM Check if git is installed
git --version > nul 2>&1
if %errorlevel% neq 0 (
    echo %red_fg_strong%[ERROR] git command not found in PATH%reset%
    echo %red_bg%Please make sure Git is installed and added to your PATH.%reset%
    echo %blue_bg%To install Git go to Toolbox%reset%
    pause
    goto :home
)
echo Switching to release branch...
git switch release
pause
goto :home


:switch_staging
REM Check if git is installed
git --version > nul 2>&1
if %errorlevel% neq 0 (
    echo %red_fg_strong%[ERROR] git command not found in PATH%reset%
    echo %red_bg%Please make sure git is installed and added to your PATH.%reset%
    pause
    goto :home
)
echo Switching to staging branch...
git switch staging
pause
goto :home



REM backup - frontend
:backup_menu
REM Check if 7-Zip is installed
7z > nul 2>&1
if %errorlevel% neq 0 (
    echo %red_fg_strong%[ERROR] 7z command not found in PATH%reset%
    echo %red_bg%Please make sure 7-Zip is installed and added to your PATH.%reset%
    echo %blue_bg%To install 7-Zip go to Toolbox%reset%
    pause
    goto :home
)

cls
echo %blue_fg_strong%/ Home / Backup%reset%
echo -------------------------------------
echo What would you like to do?
REM color 7
echo 1. Create Backup
echo 2. Restore Backup
echo 3. Back to Home

set /p backup_choice=Choose Your Destiny: 

REM backup - backend
if "%backup_choice%"=="1" (
    call :create_backup
) else if "%backup_choice%"=="2" (
    call :restore_backup
) else if "%backup_choice%"=="3" (
    goto :home
) else (
    color 6
    echo WARNING: Invalid number. Please insert a valid number.
    pause
    goto :backup_menu
)


REM toolbox - frontend
:toolbox
cls
echo %blue_fg_strong%/ Home / Toolbox%reset%
echo -------------------------------------
echo What would you like to do?
REM color 7
echo 1. Install 7-Zip
echo 2. Install FFmpeg
echo 3. Install Node.js
echo 4. Edit Environment - Power Users only!
echo 5. Reinstall SillyTavern
echo 6. Back to Home

set /p toolbox_choice=Choose Your Destiny: 

REM toolbox - backend
if "%toolbox_choice%"=="1" (
    call :install7zip
) else if "%toolbox_choice%"=="2" (
    call :installffmpeg
) else if "%toolbox_choice%"=="3" (
    call :installnodejs
) else if "%toolbox_choice%"=="4" (
    call :editenvironment
) else if "%toolbox_choice%"=="5" (
    call :reinstallsillytavern
) else if "%toolbox_choice%"=="6" (
    goto :home
) else (
    color 6
    echo WARNING: Invalid number. Please insert a valid number.
    pause
    goto :toolbox
)


:install7zip
echo Downloading 7-Zip...
curl -o "%TEMP%\%zip7version%.exe" "https://www.7-zip.org/a/%zip7version%.exe"

echo Launching 7-Zip installer...
echo %blue_bg%Make sure to install 7-Zip at %zip7_install_path%%reset%
"%TEMP%\%zip7version%.exe"


rem Get the current PATH value from the registry
for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v PATH') do set "current_path=%%B"

rem Check if the paths are already in the current PATH
echo %current_path% | find /i "%zip7_install_path%" > nul
set "zip7_path_exists=%errorlevel%"

rem Append the new paths to the current PATH only if they don't exist
if %zip7_path_exists% neq 0 (
    set "new_path=%current_path%;%zip7_install_path%"
    echo %green_fg_strong%7-Zip added to PATH.%reset%
) else (
    set "new_path=%current_path%"
    echo %yellow_fg_strong%[WARN] 7-Zip already exists in PATH!%reset%
)

rem Update the PATH value in the registry
reg add "HKCU\Environment" /v PATH /t REG_EXPAND_SZ /d "%new_path%" /f

rem Update the PATH value for the current session
setx PATH "%new_path%"

del "%zip7_download_path%"
echo %green_fg_strong%7-Zip is installed. Please restart the Launcher.%reset%
pause
exit


:installffmpeg
REM Check if 7-Zip is installed
7z > nul 2>&1
if %errorlevel% neq 0 (
    echo %red_fg_strong%[ERROR] 7z command not found in PATH%reset%
    echo %red_bg%Please make sure 7-Zip is installed and added to your PATH.%reset%
    echo %blue_bg%To install 7-Zip go to Toolbox%reset%
    pause
    goto :toolbox
)

echo Downloading FFmpeg archive...
rem bitsadmin /transfer "ffmpeg" /download /priority FOREGROUND "%ffmpeg_url%" "%ffdownload_path%"
curl -o "%ffdownload_path%" "%ffmpeg_url%"

echo Creating ffmpeg directory if it doesn't exist...
if not exist "%ffextract_path%" (
    mkdir "%ffextract_path%"
)

echo Extracting FFmpeg archive...
7z x "%ffdownload_path%" -o"%ffextract_path%"


echo Moving FFmpeg contents to C:\ffmpeg...
for /d %%i in ("%ffextract_path%\ffmpeg-*-full_build") do (
    xcopy "%%i\bin" "%ffextract_path%\bin" /E /I /Y
    xcopy "%%i\doc" "%ffextract_path%\doc" /E /I /Y
    xcopy "%%i\presets" "%ffextract_path%\presets" /E /I /Y
    rd "%%i" /S /Q
)

rem Get the current PATH value from the registry
for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v PATH') do set "current_path=%%B"

rem Check if the paths are already in the current PATH
echo %current_path% | find /i "%bin_path%" > nul
set "ff_path_exists=%errorlevel%"

rem Append the new paths to the current PATH only if they don't exist
if %ff_path_exists% neq 0 (
    set "new_path=%current_path%;%bin_path%"
    echo %green_fg_strong%ffmpeg added to PATH.%reset%
) else (
    set "new_path=%current_path%"
    echo %yellow_fg_strong%[WARN] ffmpeg already exists in PATH!%reset%
)

rem Update the PATH value in the registry
reg add "HKCU\Environment" /v PATH /t REG_EXPAND_SZ /d "%new_path%" /f

rem Update the PATH value for the current session
setx PATH "%new_path%" > nul

del "%ffdownload_path%"
echo %green_fg_strong%FFmpeg is installed. Please restart the Launcher.%reset%
pause
exit


:installnodejs
rem bitsadmin /transfer "NodejsInstaller" /download /priority FOREGROUND "https://nodejs.org/dist/v18.17.1/node-v18.17.1-x64.msi" "%node_installer_path%"
curl -o "%node_installer_path%" "https://nodejs.org/dist/v18.17.1/node-v18.17.1-x64.msi"
echo %blue_fg_strong%[INFO]%reset% Installing Nodejs...
msiexec /i "%node_installer_path%" /passive
echo %green_fg_strong%Node.js is installed. Please restart the Launcher.%reset%
pause
exit


:editenvironment
rundll32.exe sysdm.cpl,EditEnvironmentVariables
goto :toolbox


:reinstallsillytavern
setlocal enabledelayedexpansion
chcp 65001 > nul
REM Define the names of items to be excluded
set "script_name=%~nx0"
set "excluded_folders=backups"
set "excluded_files=!script_name!"

REM Confirm with the user before proceeding
echo.
echo %red_bg%╔════ DANGER ZONE ══════════════════════════════════════════════════════════════════════════════╗%reset%
echo %red_bg%║ WARNING: This will delete all data in the current branch except the Backups.                  ║%reset%
echo %red_bg%║ If you want to keep any data, make sure to create a backup before proceeding.                 ║%reset%
echo %red_bg%╚═══════════════════════════════════════════════════════════════════════════════════════════════╝%reset%
echo.
echo Are you sure you want to proceed? (Y/N)
set /p "confirmation="
if /i "!confirmation!"=="Y" (
    REM Remove non-excluded folders
    for /d %%D in (*) do (
        set "exclude_folder="
        for %%E in (!excluded_folders!) do (
            if "%%D"=="%%E" set "exclude_folder=true"
        )
        if not defined exclude_folder (
            rmdir /s /q "%%D" 2>nul
        )
    )

    REM Remove non-excluded files
    for %%F in (*) do (
        set "exclude_file="
        for %%E in (!excluded_files!) do (
            if "%%F"=="%%E" set "exclude_file=true"
        )
        if not defined exclude_file (
            del /f /q "%%F" 2>nul
        )
    )

    REM Clone repo into %temp% folder
    git clone https://github.com/SillyTavern/SillyTavern.git "%temp%\SillyTavernTemp"

    REM Move the contents of the temporary folder to the current directory
    xcopy /e /y "%temp%\SillyTavernTemp\*" .

    REM Clean up the temporary folder
    rmdir /s /q "%temp%\SillyTavernTemp"

    echo %green_fg_strong%SillyTavern reinstalled successfully!%reset%
) else (
    echo Reinstall canceled.
)
endlocal
pause
goto :toolbox


:create_backup
REM Create a backup using 7zip
7z a "backups\backup_.7z" ^
    "public\assets\*" ^
    "public\Backgrounds\*" ^
    "public\Characters\*" ^
    "public\Chats\*" ^
    "public\context\*" ^
    "public\Group chats\*" ^
    "public\Groups\*" ^
    "public\instruct\*" ^
    "public\KoboldAI Settings\*" ^
    "public\movingUI\*" ^
    "public\NovelAI Settings\*" ^
    "public\OpenAI Settings\*" ^
    "public\QuickReplies\*" ^
    "public\TextGen Settings\*" ^
    "public\themes\*" ^
    "public\User Avatars\*" ^
    "public\user\*" ^
    "public\worlds\*" ^
    "public\settings.json" ^
    "secrets.json"

REM Rename the backup file with current date and time
for /f "tokens=1-5 delims=/ " %%d in ("%date%") do (
    for /f "tokens=1-2 delims=:." %%h in ("%time%") do (
        rename "backups\backup_.7z" backup_%%e-%%f-%%g_%%h%%i.7z
    )
)

echo %green_fg_strong%Backup created successfully!%reset%
pause
endlocal
goto :backup_menu


:restore_backup
REM Restore a backup using 7zip

echo List of available backups:
echo =========================

setlocal enabledelayedexpansion
set "backup_count=0"

for %%F in ("backups\backup_*.7z") do (
    set /a "backup_count+=1"
    set "backup_files[!backup_count!]=%%~nF"
    echo !backup_count!. %cyan_fg_strong%%%~nF%reset%
)

echo =========================
set /p "restore_choice=Enter number of backup to restore: "

if "%restore_choice%" geq "1" (
    if "%restore_choice%" leq "%backup_count%" (
        set "selected_backup=!backup_files[%restore_choice%]!"
        echo Restoring backup !selected_backup!...
        7z x "backups\!selected_backup!.7z" -o"SillyTavern\public"
        echo %green_fg_strong%!selected_backup! restored successfully.%reset%
    ) else (
        color 6
        echo WARNING: Invalid backup number. Please insert a valid number.
    )
) else (
    color 6
    echo WARNING: Invalid number. Please insert a valid number.
)
pause
goto :backup_menu
