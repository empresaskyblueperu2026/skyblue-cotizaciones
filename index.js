/*
  SKY BLUE PWA — Backend API proxy
  Keeps the Anthropic API key secure on the server
  
  Deploy on Railway.app (free tier):
  1. Sube esta carpeta a GitHub
  2. Conecta Railway a tu repo
  3. Agrega variable ANTHROPIC_API_KEY en Railway
  4. Deploy automático
*/

const express = require('express');
const path    = require('path');
const app     = express();

app.use(express.json({ limit: '25mb' }));

// Serve PWA static files
app.use(express.static(path.join(__dirname, '../public')));

// API proxy route — keeps key secure
app.post('/api/claude', async function(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'x-api-key':            apiKey,
        'anthropic-version':    '2023-06-01',
        'anthropic-beta':       'pdfs-2024-09-25'
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('API proxy error:', err.message);
    res.status(502).json({ error: 'Proxy error: ' + err.message });
  }
});

// PWA fallback — all routes serve index.html
app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('SKY BLUE PWA running on port ' + PORT);
});
