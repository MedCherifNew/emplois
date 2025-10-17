const express = require('express');
const path = require('path');
const app = express();

// Sert les fichiers statiques depuis le dossier 'public'
app.use(express.static(path.join(__dirname, '..', 'public')));

// Gère toutes les autres requêtes en renvoyant l'index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Vercel exporte l'application
module.exports = app;
