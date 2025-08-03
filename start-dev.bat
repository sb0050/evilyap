@echo off
echo 🚀 Démarrage de l'application LM OUTLET...
echo.

echo 📦 Vérification des dépendances...
if not exist "node_modules" (
    echo ❌ Installation des dépendances frontend...
    npm install
)

if not exist "server\node_modules" (
    echo ❌ Installation des dépendances serveur...
    cd server
    npm install
    cd ..
)

echo ✅ Dépendances vérifiées
echo.

echo 🔧 Vérification de la configuration...
if not exist ".env" (
    echo ⚠️  Fichier .env manquant dans le frontend
)

if not exist "server\.env" (
    echo ⚠️  Fichier .env manquant dans le serveur
)

echo ✅ Configuration vérifiée
echo.

echo 🌐 Démarrage des services...
echo 📱 Frontend: http://localhost:3000
echo 🔧 Backend:  http://localhost:5000
echo.

npm run dev

pause
