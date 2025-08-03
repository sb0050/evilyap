Write-Host "🚀 Démarrage du projet LM Outlet..." -ForegroundColor Green
Write-Host ""

# Démarrer le serveur backend
Write-Host "📡 Démarrage du serveur backend..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd server; npm run dev" -WindowStyle Normal

# Attendre un peu
Start-Sleep -Seconds 3

# Démarrer le frontend Vite
Write-Host "🌐 Démarrage du frontend Vite..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npx vite --port 3000" -WindowStyle Normal

Write-Host ""
Write-Host "✅ Projet démarré !" -ForegroundColor Green
Write-Host "📱 Frontend: http://localhost:3000" -ForegroundColor Cyan
Write-Host "🔧 Backend:  http://localhost:5000" -ForegroundColor Cyan
Write-Host ""
Write-Host "Appuyez sur une touche pour fermer cette fenêtre..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
