import express from "express";

const router = express.Router();

// Configuration Boxtal
const BOXTAL_CONFIG = {
  client_id: process.env.BOXTAL_ACCESS_KEY || "your_client_id",
  client_secret: process.env.BOXTAL_SECRET_KEY || "your_client_secret",
  auth_url: "https://api.boxtal.com/iam/account-app/token",
};

let boxtalToken: string | null = null;
let boxtalTokenExpiry: number = 0;

const verifyAndRefreshBoxtalToken = async () => {
  const currentTime = Date.now();

  // Vérifie si le token est encore valide
  if (boxtalToken && boxtalTokenExpiry && currentTime < boxtalTokenExpiry) {
    return boxtalToken; // Retourne le token valide
  }

  // Si le token est invalide ou expiré, appelle l'endpoint pour en générer un nouveau
  const url = `${BOXTAL_CONFIG.auth_url}`;
  const credentials = Buffer.from(
    `${BOXTAL_CONFIG.client_id}:${BOXTAL_CONFIG.client_secret}`
  ).toString("base64");
  const options = {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
  };

  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Error response from Boxtal API:", errorText);
      throw new Error(`Failed to refresh Boxtal token: ${errorText}`);
    }

    const data: any = await response.json();
    console.log("New Boxtal Token obtained");

    // Stocke le nouveau token et son expiration
    boxtalToken = data.accessToken;
    boxtalTokenExpiry = Date.now() + data.expiresIn * 1000; // Convertit les secondes en millisecondes

    return boxtalToken;
  } catch (error) {
    console.error("Error refreshing Boxtal token:", error);
    throw new Error("Unable to refresh Boxtal token");
  }
};

// Route pour obtenir le token d'authentification Boxtal
router.post("/auth", async (req, res) => {
  try {
    const token = await verifyAndRefreshBoxtalToken();
    res.status(200).json({
      access_token: token,
      expires_in: Math.floor((boxtalTokenExpiry - Date.now()) / 1000),
      token_type: "Bearer",
    });
  } catch (error: any) {
    console.error("Error in /api/boxtal/auth:", error);
    res.status(500).json({ error: "Failed to generate Boxtal token" });
  }
});

//Point de proximité
router.post("/parcel-points", async (req, res) => {
  try {
    const token = await verifyAndRefreshBoxtalToken();
    const url = `https://api.boxtal.com/shipping/v3.1/parcel-point`;

    // Construire les paramètres URL correctement
    const params = new URLSearchParams();
    Object.keys(req.body).forEach((key) => {
      if (req.body[key] !== undefined && req.body[key] !== null) {
        params.append(key, req.body[key].toString());
      }
    });
    const options = {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    };

    const response = await fetch(`${url}?${params.toString()}`, options);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Erreur API Boxtal:", response.status, errorText);
      throw new Error(`API Boxtal error: ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Error in /api/boxtal/parcel-points:", error);
    res.status(500).json({
      error: "Failed to get parcel points",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

//Passer commande
router.post("/shipping-orders", async (req, res) => {
  try {
    const token = await verifyAndRefreshBoxtalToken();
    const url = `https://api.boxtal.com/shipping/v3.1/shipping-order`;
    const options = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body),
    };

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Boxtal shipping order error:", errorData);
      return res.status(response.status).json({
        error: "Failed to create shipping order",
        details: errorData,
      });
    }

    const data = await response.json();
    return res.json(data);
  } catch (error) {
    console.error("Error in /api/boxtal/shipping-orders:", error);
    return res.status(500).json({
      error: "Failed to create shipping order",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});
export default router;
