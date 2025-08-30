import express, { Request, Response, NextFunction } from 'express';
import cors = require('cors');
import * as dotenv from 'dotenv';
// Charger les variables d'environnement
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(
  cors({
    origin: [
      process.env.CLIENT_URL || 'http://localhost:3000',
      'https://gobbler-smiling-partly.ngrok-free.app',
      /\.ngrok\.io$/,
      /\.ngrok-free\.app$/,
      /\.ngrok\.app$/,
      /\.loca\.lt$/,
    ],
    credentials: true,
  })
);

// Pour les webhooks Stripe, nous devons traiter le raw body
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// Pour les autres routes, utiliser JSON
app.use(express.json());

// Routes
import stripeRoutes from './routes/stripe';
import boxtalRoutes from './routes/boxtal';
app.use('/api/stripe', stripeRoutes);
app.use('/api/boxtal', boxtalRoutes);

// Route de test
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Route ping pour tester la connectivité
app.get('/api/ping', (req: Request, res: Response) => {
  res.json({
    status: 'pong',
    timestamp: new Date().toISOString(),
    message: 'Backend is reachable',
    origin: req.get('origin') || 'unknown',
  });
});

// Gestion des erreurs
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
