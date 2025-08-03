@echo off
echo Starting LM Outlet App...
echo.

echo Installing dependencies...
call npm install --legacy-peer-deps
if %errorlevel% neq 0 (
    echo Error installing main dependencies
    pause
    exit /b 1
)

echo Installing server dependencies...
cd server
call npm install
if %errorlevel% neq 0 (
    echo Error installing server dependencies
    pause
    exit /b 1
)

echo.
echo Starting servers...
echo Backend server will start on http://localhost:5000
echo Frontend app will start on http://localhost:3000
echo.

start "Backend Server" cmd /c "npm run dev"
cd ..
start "Frontend App" cmd /c "npm start"

echo.
echo Both servers are starting...
echo Check the opened windows for any errors.
echo.
pause
