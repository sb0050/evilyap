# Script pour tester le déploiement Vercel complet (frontend et backend) en local

# Vérifier si Vercel CLI est installé
if (-not (Get-Command vercel -ErrorAction SilentlyContinue)) {
    Write-Host "Vercel CLI n'est pas installé. Installation en cours..."
    npm install -g vercel
}

# Définir les répertoires
$rootDir = $PSScriptRoot
$backendDir = Join-Path $rootDir "backend"
$frontendDir = Join-Path $rootDir "frontend"

# Vérifier si les ports sont disponibles
function Test-PortAvailable {
    param (
        [int]$Port
    )
    
    $listener = $null
    try {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $Port)
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        if ($listener -ne $null) {
            $listener.Stop()
        }
    }
}

if (-not (Test-PortAvailable -Port 3000)) {
    Write-Host "Le port 3000 est déjà utilisé. Veuillez libérer ce port avant de continuer." -ForegroundColor Red
    exit 1
}

if (-not (Test-PortAvailable -Port 8080)) {
    Write-Host "Le port 8080 est déjà utilisé. Veuillez libérer ce port avant de continuer." -ForegroundColor Red
    exit 1
}

# Créer les fichiers .env.development.local temporaires
$backendEnvContent = @"
# Stripe Configuration
STRIPE_SECRET_KEY=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
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here

# Clerk Configuration
CLERK_SECRET_KEY=sk_test_2duYTRP16n1F1NaLe40RWfe3P0aCpWftcw6eg6EPrd

# Application Configuration
CLIENT_URL=http://localhost:3000
PORT=8080

# Boxtal Configuration
BOXTAL_ACCESS_KEY=QWUTAKVAZGZAQTGSE3PKHCRDM5LJA8MV05P6FMQH
BOXTAL_SECRET_KEY=2771e9e1-ac5f-4da0-840e-9256b90ab95c
"@

$frontendEnvContent = @"
VITE_API_URL=http://localhost:8080
"@

# Écrire les contenus dans les fichiers .env.development.local
$backendEnvContent | Out-File -FilePath "$backendDir\.env.development.local" -Encoding utf8
$frontendEnvContent | Out-File -FilePath "$frontendDir\.env.development.local" -Encoding utf8

Write-Host "Fichiers .env.development.local créés avec succès." -ForegroundColor Green

# Fonction pour nettoyer les ressources
function Cleanup {
    if (Test-Path "$backendDir\.env.development.local") {
        Remove-Item -Path "$backendDir\.env.development.local"
    }
    if (Test-Path "$frontendDir\.env.development.local") {
        Remove-Item -Path "$frontendDir\.env.development.local"
    }
    Write-Host "Nettoyage terminé." -ForegroundColor Green
}

# Demander à l'utilisateur quelle méthode utiliser pour le backend
Write-Host "Comment souhaitez-vous démarrer le backend?" -ForegroundColor Yellow
Write-Host "1. Utiliser npm run dev (recommandé)" -ForegroundColor Green
Write-Host "2. Utiliser vercel dev (peut causer des erreurs)" -ForegroundColor Yellow
$backendChoice = Read-Host "Entrez votre choix (1 ou 2)"

# Gérer le nettoyage lors de l'arrêt du script
try {
    # Démarrer le backend selon le choix de l'utilisateur
    Write-Host "Démarrage du backend sur http://localhost:8080" -ForegroundColor Cyan
    if ($backendChoice -eq "2") {
        Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "Set-Location '$backendDir'; npm run vercel:dev"
    } else {
        Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "Set-Location '$backendDir'; npm run dev"
    }
    
    Write-Host "Démarrage du frontend sur http://localhost:3000" -ForegroundColor Cyan
    Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "Set-Location '$frontendDir'; vercel dev --listen 3000 --yes"
    
    Write-Host "Les serveurs sont en cours d'exécution. Appuyez sur Ctrl+C pour arrêter." -ForegroundColor Yellow
    
    # Attendre que l'utilisateur appuie sur Ctrl+C
    while ($true) {
        Start-Sleep -Seconds 1
    }
}
finally {
    # Nettoyer les ressources
    Cleanup
}