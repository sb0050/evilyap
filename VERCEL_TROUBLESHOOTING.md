# Guide de dépannage pour le déploiement Vercel

## Problèmes identifiés et solutions

### 1. Erreur Stripe : "Neither apiKey nor config.authenticator provided"

#### Problème
L'erreur suivante se produit lors du déploiement sur Vercel :
```
Error: Neither apiKey nor config.authenticator provided
    at Stripe._setAuthenticator (/var/task/backend/node_modules/stripe/cjs/stripe.core.js:155:23)
```

#### Solution
- Les variables d'environnement nécessaires pour Stripe n'étaient pas correctement configurées dans le déploiement Vercel.
- Nous avons mis à jour `backend/vercel.json` pour inclure toutes les variables d'environnement nécessaires.
- Un fichier `backend/.env.vercel` a été créé comme référence pour les variables à configurer dans le dashboard Vercel.

#### Comment configurer
1. Connectez-vous à votre [dashboard Vercel](https://vercel.com/dashboard)
2. Sélectionnez votre projet backend
3. Allez dans "Settings" > "Environment Variables"
4. Ajoutez les variables suivantes :
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `CLERK_SECRET_KEY`
   - `BOXTAL_ACCESS_KEY`
   - `BOXTAL_SECRET_KEY`
   - `CLIENT_URL`
   - `PORT`

### 2. Erreur de listener : "TypeError: listener is not a function"

#### Problème
L'erreur suivante se produit lors de l'exécution de `vercel dev` :
```
Typerror: listener is not a function
```

#### Solution
- Le problème vient d'une incompatibilité entre le serveur Express et le serveur de développement Vercel.
- Nous avons modifié `server.ts` pour exporter l'application Express, permettant son utilisation comme middleware.
- Nous avons ajouté un script `vercel:dev` dans `package.json` pour tester avec Vercel CLI.
- Nous avons mis à jour les scripts de test pour offrir le choix entre `npm run dev` (recommandé) et `vercel dev`.

#### Comment tester

**Option 1 : Utiliser le script de test local**
```powershell
# Dans le répertoire du backend
./test-vercel-local.ps1
```
Le script vous demandera quelle méthode vous souhaitez utiliser.

**Option 2 : Utiliser npm directement**
```bash
# Pour utiliser Express directement (recommandé)
npm run dev

# Pour utiliser Vercel dev (peut causer des erreurs)
npm run vercel:dev
```

## Scripts disponibles

### Scripts racine
- `npm run vercel:dev` - Teste l'application complète (frontend + backend)

### Scripts backend
- `npm run dev` - Démarre le serveur backend avec Express (recommandé)
- `npm run vercel:dev` - Démarre le serveur backend avec Vercel CLI

### Scripts frontend
- `vercel dev --listen 3000 --yes` - Démarre le serveur frontend avec Vercel CLI

## Conseils supplémentaires

1. **Pour le développement local** : Utilisez `npm run dev` pour le backend et `vercel dev` pour le frontend.

2. **Pour tester le déploiement Vercel** : Si vous rencontrez des erreurs avec `vercel dev`, essayez d'utiliser `npm run dev` pour le backend et configurez manuellement les variables d'environnement.

3. **Pour le déploiement en production** : Assurez-vous que toutes les variables d'environnement sont correctement configurées dans le dashboard Vercel avant de déployer.

## Fichiers de documentation

- `VERCEL_STRIPE_SETUP.md` - Guide pour configurer Stripe avec Vercel
- `backend/VERCEL_DEV_SOLUTION.md` - Explication détaillée de la solution pour l'erreur de listener
- `VERCEL_DEPLOYMENT.md` - Guide général pour le déploiement sur Vercel