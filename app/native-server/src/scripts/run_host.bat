@echo off
setlocal

REM Get the directory of this batch script
set "SCRIPT_DIR=%~dp0"
REM Remove trailing backslash from SCRIPT_DIR if present for consistency
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

REM Define the log directory relative to the script
set "LOG_DIR=%SCRIPT_DIR%\logs"
REM Define the Node.js script path
set "NODE_SCRIPT=%SCRIPT_DIR%\index.js"

REM Create log directory if it doesn't exist
if not exist "%LOG_DIR%" (
  md "%LOG_DIR%"
)

REM Timestamp for log files (YYYYMMDD_HHMMSS)
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /format:list') do set "DATETIME_STR=%%I"
set "TIMESTAMP=%DATETIME_STR:~0,8%_%DATETIME_STR:~8,6%"

set "WRAPPER_LOG=%LOG_DIR%\native_host_wrapper_windows_%TIMESTAMP%.log"
set "STDERR_LOG=%LOG_DIR%\native_host_stderr_windows_%TIMESTAMP%.log"

echo Wrapper script called at %DATE% %TIME% > "%WRAPPER_LOG%"
echo SCRIPT_DIR: %SCRIPT_DIR% >> "%WRAPPER_LOG%"
echo LOG_DIR: %LOG_DIR% >> "%WRAPPER_LOG%"
echo NODE_SCRIPT: %NODE_SCRIPT% >> "%WRAPPER_LOG%"
echo Initial PATH: %PATH% >> "%WRAPPER_LOG%"
echo User: %USERNAME% >> "%WRAPPER_LOG%"
echo Current PWD: %CD% >> "%WRAPPER_LOG%"

set "NODE_EXEC="

REM 1. Check if node is in PATH using 'where'
for /f "delims=" %%i in ('where node.exe 2^>nul') do (
    if not defined NODE_EXEC set "NODE_EXEC=%%i"
)
if defined NODE_EXEC (
    echo Found node using 'where node.exe': %NODE_EXEC% >> "%WRAPPER_LOG%"
)

REM 2. If not found by 'where', check common locations
if not defined NODE_EXEC (
    if exist "%ProgramFiles%\nodejs\node.exe" (
        set "NODE_EXEC=%ProgramFiles%\nodejs\node.exe"
        echo Found node at %ProgramFiles%\nodejs\node.exe >> "%WRAPPER_LOG%"
    ) else if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
        set "NODE_EXEC=%ProgramFiles(x86)%\nodejs\node.exe"
        echo Found node at %ProgramFiles(x86)%\nodejs\node.exe >> "%WRAPPER_LOG%"
    ) else if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
        set "NODE_EXEC=%LOCALAPPDATA%\Programs\nodejs\node.exe"
        echo Found node at %LOCALAPPDATA%\Programs\nodejs\node.exe >> "%WRAPPER_LOG%"
    )
    REM Add more common paths if necessary, e.g., for NVM for Windows
    if exist "%APPDATA%\nvm" (
        for /f "delims=" %%v in ('dir /b /ad "%APPDATA%\nvm" 2^>nul ^| sort /r') do (
            if not defined NODE_EXEC if exist "%APPDATA%\nvm\%%v\node.exe" (
                set "NODE_EXEC=%APPDATA%\nvm\%%v\node.exe"
                echo Found NVM for Windows node at %APPDATA%\nvm\%%v\node.exe >> "%WRAPPER_LOG%"
                goto :node_found
            )
        )
    )
)
:node_found

if not defined NODE_EXEC (
    echo ERROR: Node.js executable not found! >> "%WRAPPER_LOG%"
    echo Searched 'where node.exe' and common installation paths. >> "%WRAPPER_LOG%"
    exit /B 1
)

echo Using Node executable: %NODE_EXEC% >> "%WRAPPER_LOG%"
echo Node version found by script: >> "%WRAPPER_LOG%"
call "%NODE_EXEC%" -v >> "%WRAPPER_LOG%" 2>>&1
echo Executing: "%NODE_EXEC%" "%NODE_SCRIPT%" >> "%WRAPPER_LOG%"

REM Execute the Node.js script. Stdout goes to Chrome. Stderr goes to the log file.
call "%NODE_EXEC%" "%NODE_SCRIPT%" 2>> "%STDERR_LOG%"

endlocal
exit /B %ERRORLEVEL%