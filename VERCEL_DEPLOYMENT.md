# Guide de déploiement sur Vercel

## Structure du projet

Ce projet est divisé en deux parties principales :
- **Frontend** : Application React/Vite
- **Backend** : API Express.js

Chaque partie sera déployée séparément sur Vercel.

## Déploiement du Frontend

1. Créez un nouveau projet sur Vercel
2. Connectez votre dépôt GitHub
3. Sélectionnez le dossier `/frontend` comme racine du projet
4. Configurez les variables d'environnement dans l'interface Vercel :
   - `VITE_API_URL` : URL de votre backend déployé (ex: https://app-live-backend.vercel.app/api)
   - `VITE_CLERK_PUBLISHABLE_KEY` : Clé publique Clerk
   - `VITE_STRIPE_PUBLISHABLE_KEY` : Clé publique Stripe
5. Déployez le projet

## Déploiement du Backend

1. Créez un nouveau projet sur Vercel
2. Connectez votre dépôt GitHub
3. Sélectionnez le dossier `/backend` comme racine du projet
4. Configurez les variables d'environnement dans l'interface Vercel :
   - `PORT` : 8080 (Vercel utilise ce port par défaut)
   - `CLIENT_URL` : URL de votre frontend déployé (ex: https://app-live-frontend.vercel.app)
   - `STRIPE_SECRET_KEY` : Clé secrète Stripe
   - `STRIPE_WEBHOOK_SECRET` : Clé secrète pour les webhooks Stripe
   - `CLERK_SECRET_KEY` : Clé secrète Clerk
   - Autres variables spécifiques à votre application
5. Déployez le projet

## Configuration des webhooks

Après le déploiement :

1. Mettez à jour l'URL du webhook Stripe pour pointer vers votre backend déployé : `https://app-live-backend.vercel.app/api/stripe/webhook`
2. Mettez à jour les URL de redirection dans le tableau de bord Clerk pour utiliser votre domaine frontend déployé

## Notes importantes

- Les fichiers `vercel.json` dans les dossiers frontend et backend contiennent la configuration nécessaire pour le déploiement
- Le backend est configuré pour accepter les requêtes CORS uniquement depuis l'URL du frontend spécifiée dans la variable d'environnement `CLIENT_URL`
- Assurez-vous que toutes les variables d'environnement sont correctement configurées dans l'interface Vercel avant le déploiement