# Script PowerShell pour démarrer le serveur et le frontend
Write-Host "🚀 Démarrage de l'application LM OUTLET..." -ForegroundColor Green

# Vérifier que les dépendances sont installées
Write-Host "📦 Vérification des dépendances..." -ForegroundColor Yellow

# Vérifier les dépendances du frontend
if (-not (Test-Path "node_modules")) {
    Write-Host "❌ Dépendances frontend manquantes. Installation..." -ForegroundColor Red
    npm install
}

# Vérifier les dépendances du serveur
if (-not (Test-Path "server/node_modules")) {
    Write-Host "❌ Dépendances serveur manquantes. Installation..." -ForegroundColor Red
    Set-Location server
    npm install
    Set-Location ..
}

Write-Host "✅ Dépendances vérifiées" -ForegroundColor Green

# Vérifier les fichiers .env
if (-not (Test-Path ".env")) {
    Write-Host "⚠️  Fichier .env manquant dans le frontend" -ForegroundColor Yellow
}

if (-not (Test-Path "server/.env")) {
    Write-Host "⚠️  Fichier .env manquant dans le serveur" -ForegroundColor Yellow
}

Write-Host "🔧 Configuration vérifiée" -ForegroundColor Green

# Démarrer les services
Write-Host "🌐 Démarrage du serveur backend (port 5000)..." -ForegroundColor Cyan
Write-Host "⚛️  Démarrage du frontend React (port 3000)..." -ForegroundColor Cyan

# Utiliser concurrently pour démarrer les deux services
npm run dev

Write-Host "🎉 Application démarrée !" -ForegroundColor Green
Write-Host "📱 Frontend: http://localhost:3000" -ForegroundColor White
Write-Host "🔧 Backend:  http://localhost:5000" -ForegroundColor White
