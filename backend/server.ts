import express, { Request, Response, NextFunction } from "express";
import cors = require("cors");
import * as dotenv from "dotenv";
import { clerkMiddleware, getAuth } from "@clerk/express";
// Charger les variables d'environnement
dotenv.config();

// Imports des routes
import stripeRoutes from "./routes/stripe";
import boxtalRoutes from "./routes/boxtal";
import storeRoutes from "./routes/store";
import { emailService } from "./services/emailService";
import uploadRoutes from "./routes/upload";
import shipmentsRoutes from "./routes/shipments";
import cartsRoutes from "./routes/carts";
import supportRoutes from "./routes/support";
import clerkRoutes from "./routes/clerk";

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
// Normaliser les origines autorisées pour CORS (supporte domaine seul et liste séparée par virgules)
const normalizeOrigin = (raw?: string) => {
  const val = (raw || "").trim();
  if (!val) return "http://localhost:3000";
  // Déjà avec schéma
  if (/^https?:\/\//i.test(val)) return val;
  // Domaine ou localhost sans schéma
  const isLocal = /^(localhost|127\.0\.0\.1)/i.test(val);
  const scheme = isLocal ? "http" : "https";
  return `${scheme}://${val}`;
};

const allowedOrigins = (process.env.CLIENT_URL || process.env.CLIENT_URLS || "http://localhost:3000")
  .split(",")
  .map((o) => normalizeOrigin(o))
  .filter((o) => !!o);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// Log minimal des requêtes et laisser passer les préflights CORS
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const acMethod = req.headers["access-control-request-method"] as string | undefined;
  const acHeaders = req.headers["access-control-request-headers"] as string | undefined;
  const hasAuth = !!req.headers.authorization;
  console.log(
    `[req] ${req.method} ${req.path} origin=${origin || "-"} hasAuth=${hasAuth} acMethod=${acMethod || "-"} acHeaders=${acHeaders || "-"}`
  );
  if (req.method === "OPTIONS") {
    console.log("[preflight] responding 204 for CORS preflight");
    return res.sendStatus(204);
  }
  next();
});

// Appliquer Clerk à toutes les routes pour pouvoir utiliser getAuth(req)
// Appliquer Clerk uniquement aux routes protégées et ignorer les routes publiques
// Ceci évite que Clerk renvoie 401 sur des endpoints publics ou sur les préflights
const clerkForProtected = clerkMiddleware();
const PUBLIC_PATH_PREFIXES = [
  "/api/health",
  // Stores (public checks)
  "/api/stores/check-owner",
  "/api/stores/exists",
  // Stripe endpoints utilisés côté client sans auth obligatoire
  "/api/stripe/get-customer-details",
  "/api/stripe/create-customer",
  // Webhooks doivent rester accessibles (signés côté payload)
  "/api/stripe/webhook",
  "/api/boxtal/webhook",
];

const isPublicPath = (p: string) => PUBLIC_PATH_PREFIXES.some((prefix) => p.startsWith(prefix));

app.use((req, res, next) => {
  if (isPublicPath(req.path)) {
    // Ignorer Clerk sur les routes publiques
    return next();
  }
  // Appliquer Clerk sur toutes les autres routes (protégées)
  return clerkForProtected(req, res, next);
});

// Log d'auth Clerk pour diagnostiquer les 401
app.use((req, _res, next) => {
  try {
    const auth = getAuth(req);
    const isAuth = !!auth?.isAuthenticated;
    const userId = auth?.userId || null;
    const sessionId = (auth as any)?.sessionId || null;
    console.log(
      `[auth] isAuthenticated=${isAuth} userId=${userId || "-"} sessionId=${sessionId || "-"}`
    );
  } catch (e) {
    console.log("[auth] getAuth error:", e);
  }
  next();
});

// Pour les webhooks Stripe, nous devons traiter le raw body
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));

// Pour les webhooks Boxtal, traiter aussi le raw body avant express.json
app.use("/api/boxtal/webhook", express.raw({ type: "application/json" }));

// Pour les autres routes, utiliser JSON
app.use(express.json());

// Vérifier la configuration SMTP au démarrage (utile pour les tests)
(async () => {
  const ok = await emailService.verifyConnection();
  if (!ok) {
    console.warn(
      "⚠️ La connexion SMTP a échoué. Vérifiez SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS dans backend/.env"
    );
  }
})();

// Routes
app.use("/api/stripe", stripeRoutes);
app.use("/api/boxtal", boxtalRoutes);
app.use("/api/stores", storeRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/shipments", shipmentsRoutes);
app.use("/api/carts", cartsRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/clerk", clerkRoutes);

// Route de test
app.get("/api/health", (req: Request, res: Response) => {
  res.json({ status: "OK", message: "Server is running" });
});

// Gestion des erreurs
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

// Démarrer le serveur si ce n'est pas importé par un autre module
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Exporter l'application pour Vercel
export default app;
