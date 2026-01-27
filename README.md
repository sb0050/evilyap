# PayLive - You Live Shopping Payment Gateway

Application de live shopping avec paiements Stripe et sélection de points relais Boxtal.

## 🚀 Démarrage rapide

### Option 1 : Une seule commande (Recommandé)
```bash
npm run dev
```

### Option 2 : Script PowerShell
```powershell
.\start-dev.ps1
```

### Option 3 : Script Batch
```cmd
start-dev.bat
```

### Option 4 : Makefile
```bash
make dev
```

## 📋 Prérequis

- Node.js (version 16 ou supérieure)
- npm ou yarn
- Compte Stripe (mode test)
- Compte Clerk pour l'authentification
- Compte Boxtal pour les points relais

## 🔧 Installation

### Installation automatique
```bash
# Installe toutes les dépendances (frontend + backend)
npm run install-all
```

### Installation manuelle
```bash
# Frontend
npm install

# Backend
cd server
npm install
cd ..
```

## ⚙️ Configuration

### 1. Frontend (.env)
```env
# Clerk Configuration
REACT_APP_CLERK_PUBLISHABLE_KEY=pk_test_your_clerk_key

# Stripe Configuration (Test Mode)
REACT_APP_STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_key

# API Configuration
REACT_APP_API_URL=http://localhost:5000
```

### 2. Backend (server/.env)
```env
# Stripe Configuration (Test Mode)
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# Boxtal Configuration
BOXTAL_ACCESS_KEY=your_boxtal_access_key
BOXTAL_SECRET_KEY=your_boxtal_secret_key

# Clerk Configuration
CLERK_SECRET_KEY=sk_test_your_clerk_secret_key

# Application Configuration
CLIENT_URL=http://localhost:3000
PORT=5000
```

## 🎯 Fonctionnalités

- ✅ **Authentification** avec Clerk
- ✅ **Paiements sécurisés** avec Stripe
- ✅ **Points relais** avec Boxtal Maps
- ✅ **Checkout en 4 étapes**
- ✅ **Interface responsive** avec Tailwind CSS
- ✅ **Mode test** pour le développement

## 🛠️ Scripts disponibles

### Frontend + Backend
- `npm run dev` - Démarre frontend et backend
- `npm run dev:windows` - Version Windows spécifique

### Frontend uniquement
- `npm start` - Démarre le serveur de développement React
- `npm run build` - Construit l'application pour la production
- `npm test` - Lance les tests

### Backend uniquement
- `npm run server` - Démarre seulement le backend

## 🌐 URLs de développement

- **Frontend**: http://localhost:3000
- **Backend**: http://localhost:5000
- **API Health**: http://localhost:5000/api/health

## 🌐 Tunnel Cloudflare

- télécharger: Download https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.msi.

- lance: 
  ```
  cloudflared.exe service install <VITE_CLOUDFARE_TUNNEL_KEY>
  ```

- tester: local-server-1.paylive.cc/api/health => tu devrais avoir:
  ```
  {
    "status": "OK",
    "message": "Server is running"
  }
  ```

## 🧪 Tests

### Cartes de test Stripe
- **Succès**: `4242 4242 4242 4242`
- **Échec**: `4000 0000 0000 0002`
- **3D Secure**: `4000 0025 0000 3155`

### Autres informations de test
- **Date d'expiration**: N'importe quelle date future
- **CVC**: N'importe quel code à 3 chiffres
- **Code postal**: N'importe quel code postal valide

## 📁 Structure du projet

```
app-live/
├── backend/               # Backend Node.js
│   ├── routes/          # Routes API
│   ├── services/        # Services (email, etc.)
│   ├── server.ts        # Serveur principal
├── frontend/             # Application frontend React
│   ├── public/          # Fichiers publics React
│   ├── src/             # Code source frontend
│   │   ├── components/  # Composants React
│   │   ├── pages/       # Pages de l'application
│   │   ├── services/    # Services (Boxtal, etc.)
│   │   ├── utils/       # Utilitaires
│   │   ├── index.tsx    # Point d'entrée React
│   │   └── App.tsx      # Composant principal
│   ├── package.json     # Dépendances frontend
│   ├── tailwind.config.js # Configuration Tailwind CSS
│   ├── vite.config.ts   # Configuration Vite
│   └── postcss.config.js # Configuration PostCSS
├── .env                 # Variables d'environnement frontend
├── package.json         # Dépendances racine
└── README.md            # Ce fichier
```

## 🔄 Processus de checkout

1. **Étape 1**: Informations personnelles (nom, email, téléphone)
2. **Étape 2**: Adresse de livraison
3. **Étape 3**: Choix du point relais (carte Boxtal)
4. **Étape 4**: Paiement (Stripe)

## 🐛 Dépannage

### Le serveur ne démarre pas
```bash
# Vérifier les variables d'environnement
cat server/.env

# Vérifier les dépendances
cd server && npm install
```

### Le frontend ne se connecte pas au backend
```bash
# Vérifier que le backend est démarré
curl http://localhost:5000/api/health

# Vérifier les variables d'environnement
cat .env
```

### Erreurs de paiement Stripe
- Vérifier que les clés Stripe sont correctes
- S'assurer d'utiliser les clés de test
- Vérifier la console du navigateur pour les erreurs

### Points relais ne s'affichent pas
- Vérifier les clés Boxtal
- Vérifier la console pour les erreurs d'API
- S'assurer que l'adresse de livraison est valide

## 📚 Documentation

- [Stripe Documentation](https://stripe.com/docs)
- [Clerk Documentation](https://clerk.com/docs)
- [Boxtal Documentation](https://developer.boxtal.com)
- [React Documentation](https://reactjs.org/docs)

## 🤝 Support

Pour toute question ou problème :
1. Vérifier les logs dans la console
2. Consulter la documentation des APIs
3. Vérifier les variables d'environnement

## 📄 Licence

Ce projet est sous licence MIT.
