import express, { Request, Response, NextFunction } from "express";
import cors = require("cors");
import * as dotenv from "dotenv";
// Charger les variables d'environnement
dotenv.config();

// Imports des routes
import stripeRoutes from "./routes/stripe";
import boxtalRoutes from "./routes/boxtal";
import storeRoutes from "./routes/store";

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(
  cors({
    origin: [process.env.CLIENT_URL || "http://localhost:3000"],
    credentials: true,
  })
);

// Pour les webhooks Stripe, nous devons traiter le raw body
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));

// Pour les autres routes, utiliser JSON
app.use(express.json());

// Routes
app.use("/api/stripe", stripeRoutes);
app.use("/api/boxtal", boxtalRoutes);
app.use("/api/stores", storeRoutes);

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
