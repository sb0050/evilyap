import express, { Request, Response, NextFunction } from "express";
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
import inseeBceRoutes from "./routes/insee-bce";
import formsRoutes from "./routes/forms";
import adminRoutes from "./routes/admin";

const app = express();

app.use((req: any, res: any, next: NextFunction) => {
  const origin = req.headers.origin;

  if (
    origin === "https://paylive.cc" ||
    origin?.endsWith(".vercel.app") ||
    origin === "http://localhost:3000"
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  next();
});

app.use(clerkMiddleware());

app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  if (
    req.path.startsWith("/stripe/webhook") ||
    req.path.startsWith("/boxtal/webhook")
  ) {
    return next();
  }

  if (process.env.ENV === "prod") {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  next();
});

const PORT = process.env.PORT || 5000;

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
app.use("/api/insee-bce", inseeBceRoutes);
app.use("/api/forms", formsRoutes);
app.use("/api/admin", adminRoutes);

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
