# Configuration Stripe Simple - Mode Test

Ce guide explique comment configurer Stripe en mode test pour les paiements simples (sans marketplace).

## 1. Configuration Stripe Dashboard

### Créer un compte Stripe
1. Va sur [stripe.com](https://stripe.com) et crée un compte
2. Active le **mode test** dans le dashboard
3. Récupère tes clés de test :
   - **Clé publique** : `pk_test_...`
   - **Clé secrète** : `sk_test_...`

### Configurer les webhooks (optionnel)
1. Va dans **Developers** > **Webhooks**
2. Ajoute un endpoint : `https://ton-domaine.com/api/stripe/webhook`
3. Sélectionne ces événements :
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`

## 2. Installation et configuration

### Frontend (.env)
```env
# Clerk Configuration
REACT_APP_CLERK_PUBLISHABLE_KEY=pk_test_your_clerk_key

# Stripe Configuration (Test Mode)
REACT_APP_STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_test_key

# API Configuration
REACT_APP_API_URL=http://localhost:5000
```

### Backend (server/.env)
```env
# Stripe Configuration (Test Mode)
STRIPE_SECRET_KEY=sk_test_your_stripe_test_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# Boxtal Configuration
BOXTAL_ACCESS_KEY=H7F652KE9XTPGYT3W7PMGUMGI0ROZ4YGECO66TUH

# Application Configuration
CLIENT_URL=http://localhost:3000
PORT=5000
```

## 3. Installation des dépendances

### Frontend
```bash
npm install @stripe/stripe-js @stripe/react-stripe-js
```

### Backend
```bash
cd server
npm install stripe express cors dotenv node-fetch
```

## 4. Démarrage de l'application

### Backend
```bash
cd server
npm run dev
```

### Frontend
```bash
npm start
```

## 5. Flux de paiement

### Étapes du checkout :
1. **Informations personnelles** - Nom, email, téléphone
2. **Adresse de livraison** - Adresse complète
3. **Choix du point relais** - Sélection via carte Boxtal
4. **Mode de paiement** - Formulaire Stripe avec PaymentElement

### Processus technique :
1. **Initialisation** : Un PaymentIntent est créé au chargement de la page
2. **Montant** : Actuellement fixé à 50€ (modifiable dans `CheckoutPage.jsx`)
3. **Confirmation** : L'utilisateur confirme le paiement
4. **Redirection** : Vers `/complete` avec le résultat du paiement

## 6. Personnalisation

### Modifier le montant
Dans `src/pages/CheckoutPage.jsx`, ligne ~45 :
```javascript
items: [
  { 
    id: 'live-shopping-item', 
    amount: 5000 // 50€ en centimes - modifie cette valeur
  }
]
```

### Ajouter des produits dynamiques
Remplace le montant fixe par des données de panier :
```javascript
// Exemple avec un panier
const cartItems = [
  { id: 'product-1', name: 'T-shirt', amount: 2500 }, // 25€
  { id: 'product-2', name: 'Pantalon', amount: 4500 }, // 45€
]

// Dans la requête
body: JSON.stringify({
  items: cartItems,
  currency: 'eur'
})
```

### Personnaliser les méthodes de paiement
Dans `server/routes/stripe.js`, tu peux spécifier les méthodes acceptées :
```javascript
const paymentIntent = await stripe.paymentIntents.create({
  amount: calculateOrderAmount(items),
  currency: currency,
  automatic_payment_methods: {
    enabled: true,
    allow_redirects: 'never' // Désactive les redirections (ex: Bancontact)
  },
  // Ou spécifier manuellement :
  // payment_method_types: ['card', 'sepa_debit']
})
```

## 7. Tests avec Stripe

### Cartes de test
- **Succès** : `4242 4242 4242 4242`
- **Échec** : `4000 0000 0000 0002`
- **3D Secure** : `4000 0025 0000 3155`

### Autres informations de test
- **Date d'expiration** : N'importe quelle date future
- **CVC** : N'importe quel code à 3 chiffres
- **Code postal** : N'importe quel code postal valide

## 8. Gestion des erreurs

### Côté client
Les erreurs sont affichées sous le formulaire de paiement :
- Erreurs de carte (numéro invalide, etc.)
- Erreurs de validation
- Erreurs de réseau

### Côté serveur
Les erreurs sont loggées dans la console :
- Erreurs de création du PaymentIntent
- Erreurs de webhook
- Erreurs de validation

## 9. Sécurité

### Bonnes pratiques implémentées :
- ✅ **Clés séparées** : Publique côté client, secrète côté serveur
- ✅ **Validation serveur** : Le montant est calculé côté serveur
- ✅ **HTTPS requis** : En production (automatique avec Stripe)
- ✅ **Webhooks sécurisés** : Vérification de signature

### À ajouter en production :
- [ ] **Rate limiting** sur les endpoints de paiement
- [ ] **Logging** des transactions
- [ ] **Monitoring** des erreurs
- [ ] **Base de données** pour stocker les commandes

## 10. Passage en production

### Checklist :
1. [ ] Remplacer les clés de test par les clés de production
2. [ ] Configurer les webhooks en production
3. [ ] Activer HTTPS
4. [ ] Tester avec de vraies cartes (petits montants)
5. [ ] Configurer la gestion des erreurs
6. [ ] Mettre en place le monitoring

### Variables d'environnement production :
```env
# Stripe Production
STRIPE_SECRET_KEY=sk_live_your_live_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_live_webhook_secret

# URLs de production
CLIENT_URL=https://your-domain.com
```

## 11. Support et dépannage

### Logs utiles :
- **Console navigateur** : Erreurs côté client
- **Console serveur** : Erreurs côté serveur
- **Dashboard Stripe** : Historique des paiements et erreurs

### Problèmes courants :
- **PaymentElement ne s'affiche pas** : Vérifier la clé publique Stripe
- **Erreur 401** : Vérifier la clé secrète Stripe
- **Webhook non reçu** : Vérifier l'URL et la signature

### Ressources :
- [Documentation Stripe](https://stripe.com/docs)
- [Stripe Dashboard](https://dashboard.stripe.com)
- [Cartes de test Stripe](https://stripe.com/docs/testing)
