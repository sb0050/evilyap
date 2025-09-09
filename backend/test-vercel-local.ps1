# Script pour tester le déploiement Vercel du backend en local

# Vérifier si Vercel CLI est installé
if (-not (Get-Command vercel -ErrorAction SilentlyContinue)) {
    Write-Host "Vercel CLI n'est pas installé. Installation en cours..."
    npm install -g vercel
}

# Définir le répertoire du backend
$backendDir = $PSScriptRoot

# Créer un fichier .env.development.local temporaire avec les variables d'environnement nécessaires
$envContent = @"
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

# Écrire le contenu dans le fichier .env.development.local
$envContent | Out-File -FilePath "$backendDir\.env.development.local" -Encoding utf8

Write-Host "Fichier .env.development.local créé avec succès."
Write-Host "Démarrage du serveur Vercel en mode développement..."

# Changer le répertoire courant vers le répertoire du backend
Set-Location -Path $backendDir

# Demander à l'utilisateur quelle méthode utiliser
Write-Host "Comment souhaitez-vous démarrer le serveur?" -ForegroundColor Yellow
Write-Host "1. Utiliser npm run dev (recommandé)" -ForegroundColor Green
Write-Host "2. Utiliser vercel dev (peut causer des erreurs)" -ForegroundColor Yellow
$choice = Read-Host "Entrez votre choix (1 ou 2)"

try {
    if ($choice -eq "2") {
        # Démarrer avec vercel dev
        Write-Host "Démarrage avec vercel dev..." -ForegroundColor Yellow
        npm run vercel:dev
    } else {
        # Démarrer avec npm run dev (par défaut)
        Write-Host "Démarrage avec npm run dev..." -ForegroundColor Green
        npm run dev
    }
}
finally {
    # Nettoyer le fichier .env.development.local
    if (Test-Path "$backendDir\.env.development.local") {
        Remove-Item -Path "$backendDir\.env.development.local"
        Write-Host "Fichier .env.development.local supprimé."
    }
}