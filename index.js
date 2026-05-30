/*
  SKY BLUE PWA — Backend corregido para estructura plana
  Todos los archivos estan en la raiz del repo
*/

const express = require('express');
const path    = require('path');
const app     = express();

app.use(express.json({ limit: '25mb' }));

// Serve static files from current directory (todos en raiz)
app.use(express.static(__dirname));

// Health check para Railway
app.get('/health', function(req, res) {
  res.status(200).json({ status: 'ok', app: 'SKY BLUE Cotizaciones' });
});

// API proxy — mantiene la API key segura en el servidor
app.post('/api/claude', async function(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada en el servidor' });
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
    console.error('API error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// Todas las rutas sirven index.html (SPA)
app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', function() {
  console.log('SKY BLUE PWA corriendo en puerto ' + PORT);
});
