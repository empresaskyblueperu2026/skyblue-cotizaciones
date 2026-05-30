/*
  SKY BLUE PWA — Backend servidor
  Railway asigna el puerto automaticamente via variable PORT
*/

const express = require('express');
const path    = require('path');
const app     = express();

app.use(express.json({ limit: '25mb' }));

// Archivos estaticos (todos en la raiz del repo)
app.use(express.static(__dirname));

// Health check para Railway
app.get('/health', function(req, res) {
  res.status(200).json({ status: 'ok' });
});

// Proxy seguro para la API de Claude
app.post('/api/claude', async function(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key no configurada' });
  }
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'pdfs-2024-09-25'
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// SPA fallback
app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Railway pone el puerto en process.env.PORT — NUNCA hardcodear
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', function() {
  console.log('SKY BLUE corriendo en puerto ' + PORT);
});
