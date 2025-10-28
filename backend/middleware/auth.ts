const { ClerkExpressRequireAuth } = require("@clerk/clerk-sdk-node");

// Middleware pour vérifier l'authentification avec Clerk
const requireAuth = ClerkExpressRequireAuth({
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  secretKey: process.env.CLERK_SECRET_KEY,
});

module.exports = {
  requireAuth,
};
