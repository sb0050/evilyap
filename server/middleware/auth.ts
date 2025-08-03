const { ClerkExpressRequireAuth } = require('@clerk/clerk-sdk-node');

// Middleware pour vérifier l'authentification avec Clerk
const requireAuth = ClerkExpressRequireAuth({
  // Options de configuration si nécessaire
});

module.exports = {
  requireAuth,
};
