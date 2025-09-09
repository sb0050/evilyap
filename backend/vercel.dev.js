// Fichier de configuration pour le développement local avec Vercel
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');

// Import du serveur Express
const app = require('./server');

// Création d'un handler pour les requêtes HTTP
const handler = (req, res) => {
  // Passer la requête à l'application Express
  app(req, res);
};

// Exporter le handler pour Vercel
module.exports = handler;