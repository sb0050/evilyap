# 🌐 Configuration ngrok pour l'application

## 📋 **Étapes pour résoudre le problème /checkout sur mobile**

### **Problème identifié :**
- La page `/checkout` ne fonctionne pas via ngrok sur mobile
- **Cause :** Le frontend essaie d'appeler l'API sur `localhost:5000` depuis ngrok
- **Solution :** Exposer le backend via ngrok aussi

## 🛠️ **Solution complète :**

### **1. Exposer les deux services via ngrok**

```bash
# Terminal 1 : Exposer le frontend (port 3000)
ngrok http 3000

# Terminal 2 : Exposer le backend (port 5000)  
ngrok http 5000
```

### **2. Noter les URLs générées**

Exemple de sortie ngrok :
```
Frontend: https://full-united-finch.ngrok-free.app
Backend:  https://another-random-name.ngrok-free.app
```

### **3. Mettre à jour le fichier .env**

Ajouter la variable pour l'URL du backend ngrok :

```env
# API Configuration
VITE_API_URL=http://localhost:5000
VITE_API_URL_NGROK=https://another-random-name.ngrok-free.app
```

### **4. Redémarrer l'application**

```bash
# Arrêter et relancer le frontend pour prendre en compte les nouvelles variables
npm start
```

## 🔍 **Debug et vérification**

### **Console du navigateur :**
Ouvrir les DevTools sur mobile et vérifier :
```
🔧 API Base URL: https://another-random-name.ngrok-free.app
🌐 Current hostname: full-united-finch.ngrok-free.app
📍 Environment variables: { VITE_API_URL_NGROK: "https://..." }
```

### **Test des endpoints :**
- ✅ Frontend : `https://full-united-finch.ngrok-free.app/`
- ✅ Checkout : `https://full-united-finch.ngrok-free.app/checkout`
- ✅ API Health : `https://another-random-name.ngrok-free.app/api/health`

## 🚨 **Points d'attention :**

1. **URLs ngrok changent** à chaque redémarrage (version gratuite)
2. **Mettre à jour .env** à chaque nouvelle session ngrok
3. **Redémarrer le frontend** après changement d'URL
4. **Vérifier CORS** : Le backend accepte les domaines ngrok

## 📱 **Test sur mobile :**

1. Ouvrir `https://full-united-finch.ngrok-free.app/checkout`
2. Vérifier la console pour les erreurs
3. Tester les fonctionnalités :
   - Connexion Clerk ✅
   - Chargement de la carte Leaflet
   - Appels API Boxtal
   - Paiements Stripe

## 🔧 **Alternative : ngrok avec domaine fixe**

Pour éviter de changer les URLs à chaque fois :

```bash
# Version payante ngrok avec domaine fixe
ngrok http 3000 --domain=your-app.ngrok.app
ngrok http 5000 --domain=your-api.ngrok.app
```
