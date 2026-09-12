/* ═══════════════════════════════════════════════════════════════════════════
   BOT SUNAT — extraccion automatica de facturas emitidas desde el portal SOL

   Modulo independiente: no importa ni modifica la logica del ERP.
   Abre un navegador sin pantalla, inicia sesion en SUNAT Operaciones en Linea,
   entra a "Consultar Factura y Nota" y lee las facturas emitidas de un periodo.

   SOLO LECTURA: nunca emite, anula ni declara nada ante la administracion.

   Seguridad de la Clave SOL:
     - Se guarda CIFRADA (AES-256-GCM) en la configuracion de la nube, nunca en el codigo.
     - La clave de cifrado deriva de AUTH_SECRET (variable de entorno del servidor).
     - Nunca se devuelve al navegador ni se escribe en los registros.
   ═══════════════════════════════════════════════════════════════════════════ */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const SUNAT_LOGIN = 'https://api-seguridad.sunat.gob.pe/v1/clientessol/4f3b88b3-d9d6-402a-b85d-6a0bc857746a/oauth2/loginMenuSol' +
  '?lang=es-PE&showDni=true&showLanguages=false' +
  '&originalUrl=https://e-menu.sunat.gob.pe/cl-ti-itmenu/AutenticaMenuInternet.htm&state=rO0ABXNyABFqYXZhLnV0aWwuSGFzaE1hcAUH2sHDFmDRAwACRgAKbG9hZEZhY3RvckkACXRocmVzaG9sZHhwP0AAAAAAAAx3CAAAABAAAAADdAADZXhlcHQABnBhcmFtc3QASyomKiYvY2wtdGktaXRtZW51L01lbnVJbnRlcm5ldC5odG0mYjY0ZDI2YThiNWFmMDkxOTIzYjIzYjY0MDdhMWMxZGI0MWU3MzNhNnQABGV4ZWNweA==';

/* ─────────── Cifrado de credenciales ─────────── */

function claveCifrado() {
  const base = process.env.AUTH_SECRET || process.env.SUPABASE_SERVICE_KEY || 'sigma-local';
  return crypto.createHash('sha256').update('sunatsol.' + base).digest();
}
function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', claveCifrado(), iv);
  const dato = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return { d: dato.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64') };
}
function descifrar(obj) {
  if (!obj || !obj.d) return '';
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', claveCifrado(), Buffer.from(obj.iv, 'base64'));
    d.setAuthTag(Buffer.from(obj.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(obj.d, 'base64')), d.final()]).toString('utf8');
  } catch (e) { return ''; }
}

/* ─────────── Navegador sin pantalla ─────────── */

/* Puppeteer es opcional: si no esta instalado el modulo sigue cargando y lo reporta. */
function cargarPuppeteer() {
  try { return { ok: true, pptr: require('puppeteer') }; }
  catch (e1) {
    try { return { ok: true, pptr: require('puppeteer-core'), core: true }; }
    catch (e2) { return { ok: false, error: 'puppeteer no instalado' }; }
  }
}

/* Busca el ejecutable de Chromium: Railway lo instala por Nix en rutas variables. */
function rutaChromium() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const fs = require('fs');
  const candidatos = [
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable', '/snap/bin/chromium'
  ];
  for (const c of candidatos) { try { if (fs.existsSync(c)) return c; } catch (e) { } }
  /* Nix guarda los binarios bajo /nix/store/<hash>-chromium-<version>/bin/ */
  try {
    const base = '/nix/store';
    if (fs.existsSync(base)) {
      const dirs = fs.readdirSync(base).filter(function (d) { return /chromium/.test(d) && !/\.drv$/.test(d); });
      for (const d of dirs) {
        for (const sub of ['/bin/chromium', '/bin/chromium-browser']) {
          const p = base + '/' + d + sub;
          if (fs.existsSync(p)) return p;
        }
      }
    }
  } catch (e) { }
  return null;
}

async function abrirNavegador() {
  const carga = cargarPuppeteer();
  if (!carga.ok) throw new Error('Falta instalar puppeteer en el servidor.');
  const exe = rutaChromium();
  const opciones = {
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--no-zygote', '--single-process',
      '--window-size=1400,900', '--lang=es-PE'
    ]
  };
  if (exe) opciones.executablePath = exe;
  else if (carga.core) throw new Error('No se encontro Chromium en el servidor (puppeteer-core lo necesita instalado).');
  return await carga.pptr.launch(opciones);
}

/* ─────────── Diagnostico ─────────── */

router.get('/estado', async function (req, res) {
  const carga = cargarPuppeteer();
  const exe = rutaChromium();
  const salida = {
    ok: true,
    puppeteer: carga.ok ? (carga.core ? 'puppeteer-core' : 'puppeteer') : 'NO INSTALADO',
    chromium: exe || 'no encontrado',
    navegador: 'sin probar',
    nodo: process.version,
    memoria_mb: Math.round(require('os').totalmem() / 1048576)
  };
  if (carga.ok) {
    try {
      const b = await abrirNavegador();
      const v = await b.version();
      await b.close();
      salida.navegador = 'ARRANCA OK — ' + v;
    } catch (e) { salida.navegador = 'FALLA: ' + String(e.message).slice(0, 200); }
  }
  res.json(salida);
});

module.exports = {
  router: router,
  cifrar: cifrar,
  descifrar: descifrar,
  abrirNavegador: abrirNavegador,
  rutaChromium: rutaChromium,
  SUNAT_LOGIN: SUNAT_LOGIN,
  montar: function (app) { app.use('/api/sunatbot', router); }
};
