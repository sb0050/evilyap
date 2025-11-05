import express, { Request, Response, NextFunction } from "express";
import cors = require("cors");
import * as dotenv from "dotenv";
import { clerkMiddleware } from "@clerk/express";
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

const allowedOrigins = (
  process.env.CLIENT_URL ||
  process.env.CLIENT_URLS ||
  "http://localhost:3000"
)
  .split(",")
  .map((o) => normalizeOrigin(o))
  .filter((o) => !!o);

console.warn("CORS is enabled for:", allowedOrigins);
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// Appliquer Clerk à toutes les routes pour pouvoir utiliser getAuth(req)
app.use(clerkMiddleware());

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
