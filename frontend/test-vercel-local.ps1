# Script pour tester le déploiement Vercel du frontend en local

# Vérifier si Vercel CLI est installé
if (-not (Get-Command vercel -ErrorAction SilentlyContinue)) {
    Write-Host "Vercel CLI n'est pas installé. Installation en cours..."
    npm install -g vercel
}

# Définir le répertoire du frontend
$frontendDir = $PSScriptRoot

# Créer un fichier .env.development.local temporaire avec les variables d'environnement nécessaires
$envContent = @"
VITE_API_URL=http://localhost:8080
"@

# Écrire le contenu dans le fichier .env.development.local
$envContent | Out-File -FilePath "$frontendDir\.env.development.local" -Encoding utf8

Write-Host "Fichier .env.development.local créé avec succès."
Write-Host "Démarrage du serveur Vercel en mode développement..."

# Changer le répertoire courant vers le répertoire du frontend
Set-Location -Path $frontendDir

try {
    # Démarrer Vercel en mode développement
    vercel dev --listen 3000 --yes
}
finally {
    # Nettoyer le fichier .env.development.local
    if (Test-Path "$frontendDir\.env.development.local") {
        Remove-Item -Path "$frontendDir\.env.development.local"
        Write-Host "Fichier .env.development.local supprimé."
    }
}