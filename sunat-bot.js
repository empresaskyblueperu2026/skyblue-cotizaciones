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
  /* Nix lo deja en el PATH aunque su ruta real sea /nix/store/<hash>-chromium-<ver>/bin */
  try {
    const { execSync } = require('child_process');
    const salida = execSync('command -v chromium chromium-browser google-chrome-stable google-chrome 2>/dev/null || true',
      { encoding: 'utf8', timeout: 5000 }).trim();
    const primera = salida.split('\n').filter(Boolean)[0];
    if (primera && fs.existsSync(primera)) return primera;
  } catch (e) { }
  /* Ultimo recurso: recorrer los perfiles y el almacen de Nix. */
  try {
    const bases = ['/root/.nix-profile/bin', '/nix/var/nix/profiles/default/bin'];
    for (const b of bases) {
      for (const n of ['chromium', 'chromium-browser']) {
        const p = b + '/' + n;
        if (fs.existsSync(p)) return p;
      }
    }
    const store = '/nix/store';
    if (fs.existsSync(store)) {
      const dirs = fs.readdirSync(store).filter(function (d) { return /-chromium-/.test(d) && !/\.drv$/.test(d); });
      for (const d of dirs) {
        for (const sub of ['/bin/chromium', '/bin/chromium-browser']) {
          const p = store + '/' + d + sub;
          if (fs.existsSync(p)) return p;
        }
      }
    }
  } catch (e) { }
  return null;
}

/* Detalle para diagnosticar por que no aparece el navegador. */
function diagnosticoChromium() {
  const out = {};
  try {
    const { execSync } = require('child_process');
    out.which = execSync('command -v chromium 2>/dev/null || echo "(no esta en PATH)"', { encoding: 'utf8', timeout: 5000 }).trim();
    out.path = String(process.env.PATH || '').split(':').slice(0, 8);
    out.nix_store = require('fs').existsSync('/nix/store')
      ? require('fs').readdirSync('/nix/store').filter(function (d) { return /chromium/.test(d); }).slice(0, 5)
      : 'sin /nix/store';
  } catch (e) { out.error = e.message; }
  return out;
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
    diagnostico: diagnosticoChromium(),
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
