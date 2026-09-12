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


/* ─────────── Almacen de credenciales ───────────
   Se usa un objeto propio (sunatsol.json) y NO config.json: asi este modulo no puede
   corromper la configuracion del ERP (tokens de bots, usuarios, etc). */

const SB_URL_BOT = process.env.SUPABASE_URL || 'https://xlwndbqflbodgszjalzp.supabase.co';
const SB_KEY_BOT = process.env.SUPABASE_SERVICE_KEY || '';
const SB_BUCKET_BOT = 'sigma-data';
const SB_OBJ_BOT = 'sunatsol.json';

async function credLeer() {
  if (!SB_KEY_BOT) return {};
  try {
    const r = await fetch(SB_URL_BOT + '/storage/v1/object/' + SB_BUCKET_BOT + '/' + SB_OBJ_BOT + '?t=' + Date.now(),
      { headers: { 'Authorization': 'Bearer ' + SB_KEY_BOT, 'apikey': SB_KEY_BOT, 'cache-control': 'no-cache' } });
    if (!r.ok) return {};
    const t = await r.text();
    return t ? JSON.parse(t) : {};
  } catch (e) { return {}; }
}

async function credGuardar(obj) {
  if (!SB_KEY_BOT) throw new Error('El servidor no tiene acceso al almacen.');
  const cuerpo = Buffer.from(JSON.stringify(obj), 'utf8');
  for (const metodo of ['POST', 'PUT']) {
    const r = await fetch(SB_URL_BOT + '/storage/v1/object/' + SB_BUCKET_BOT + '/' + SB_OBJ_BOT, {
      method: metodo,
      headers: {
        'Authorization': 'Bearer ' + SB_KEY_BOT, 'apikey': SB_KEY_BOT,
        'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache'
      },
      body: cuerpo
    });
    if (r.ok) return true;
  }
  throw new Error('No se pudo guardar la credencial.');
}

/* ─────────── Utilidades del flujo ─────────── */

function nuevaTraza() { return []; }
function paso(traza, nombre, ok, detalle) {
  traza.push({ paso: nombre, ok: !!ok, detalle: detalle || '' });
  return ok;
}

async function captura(page) {
  try { return await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 55 }); }
  catch (e) { return null; }
}

/* Escribe en el primer selector que exista de la lista. */
async function escribirEn(page, selectores, valor) {
  for (const s of selectores) {
    try {
      const el = await page.$(s);
      if (el) { await el.click({ clickCount: 3 }); await el.type(String(valor), { delay: 25 }); return s; }
    } catch (e) { }
  }
  return null;
}
async function clicEn(page, selectores) {
  for (const s of selectores) {
    try { const el = await page.$(s); if (el) { await el.click(); return s; } } catch (e) { }
  }
  return null;
}

/* ─────────── Etapa 1: iniciar sesion ─────────── */

async function sunatLogin(page, cred, traza) {
  await page.setViewport({ width: 1400, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

  await page.goto(SUNAT_LOGIN, { waitUntil: 'domcontentloaded', timeout: 45000 });
  paso(traza, 'abrir pagina de login', true, page.url().slice(0, 90));

  /* El formulario tarda en montarse. */
  try { await page.waitForSelector('#txtRuc, input[name="ruc"], #ruc', { timeout: 20000 }); }
  catch (e) { paso(traza, 'ver formulario', false, 'no aparecieron los campos de acceso'); return false; }

  const sRuc = await escribirEn(page, ['#txtRuc', 'input[name="ruc"]', '#ruc'], cred.ruc);
  const sUsu = await escribirEn(page, ['#txtUsuario', 'input[name="usuario"]', '#usuario'], cred.usuario);
  const sCla = await escribirEn(page, ['#txtContrasena', 'input[type="password"]', '#contrasena'], cred.clave);
  if (!sRuc || !sUsu || !sCla) {
    paso(traza, 'llenar formulario', false, 'faltaron campos: ' + [!sRuc && 'RUC', !sUsu && 'usuario', !sCla && 'clave'].filter(Boolean).join(', '));
    return false;
  }
  paso(traza, 'llenar formulario', true, 'RUC, usuario y clave ingresados');

  const nav = page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(function () { return null; });
  const btn = await clicEn(page, ['#btnAceptar', 'button[type="submit"]', 'input[type="submit"]', '#btnLogin']);
  if (!btn) { await page.keyboard.press('Enter'); }
  await nav;
  await new Promise(function (r) { setTimeout(r, 2500); });

  const url = page.url();
  const texto = await page.evaluate(function () { return document.body ? document.body.innerText.slice(0, 900) : ''; }).catch(function () { return ''; });

  if (/menu|MenuInternet|e-menu/i.test(url)) {
    paso(traza, 'iniciar sesion', true, 'entro al Menu SOL');
    return true;
  }
  /* Mensajes tipicos de rechazo. */
  const motivo = /clave|contrase/i.test(texto) && /incorrect|invalid|errone/i.test(texto) ? 'usuario o clave incorrectos'
    : (/bloquead/i.test(texto) ? 'usuario bloqueado'
      : (/captcha|robot/i.test(texto) ? 'SUNAT pidio verificacion anti-robot'
        : 'no se llego al menu (url: ' + url.slice(0, 80) + ')'));
  paso(traza, 'iniciar sesion', false, motivo);
  return false;
}

/* ─────────── Etapa 2: abrir la consulta de comprobantes ─────────── */

async function sunatAbrirConsulta(page, traza) {
  /* Acceso directo del portal, mas estable que recorrer el menu por clics. */
  const directa = 'https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?pestana=*&agrupacion=*';
  try {
    await page.goto(directa, { waitUntil: 'networkidle2', timeout: 45000 });
    paso(traza, 'abrir menu', true, '');
  } catch (e) { paso(traza, 'abrir menu', false, e.message.slice(0, 90)); return false; }

  /* La opcion vive dentro del arbol: Comprobantes de pago > SEE-SOL > Factura Electronica > Consultar Factura y Nota */
  const rutas = ['Comprobantes de Pago', 'SEE - SOL', 'Factura Electr', 'Consultar Factura y Nota'];
  for (const t of rutas) {
    const hecho = await page.evaluate(function (txt) {
      var els = [].slice.call(document.querySelectorAll('a,span,div,li'));
      var el = els.filter(function (e) {
        return (e.innerText || '').trim().toLowerCase().indexOf(txt.toLowerCase()) === 0 && e.offsetParent !== null;
      })[0];
      if (el) { el.click(); return true; }
      return false;
    }, t).catch(function () { return false; });
    paso(traza, 'menu: ' + t, hecho, hecho ? '' : 'no se encontro la opcion');
    if (!hecho) return false;
    await new Promise(function (r) { setTimeout(r, 1800); });
  }
  return true;
}

/* ─────────── Etapa 3: consultar un periodo y leer la tabla ─────────── */

async function sunatConsultarPeriodo(page, desde, hasta, traza) {
  /* La pantalla de consulta vive en un iframe. */
  let marco = page;
  try {
    const frames = page.frames();
    const f = frames.filter(function (fr) { return /itconscpe|consulta/i.test(fr.url()); })[0];
    if (f) marco = f;
    paso(traza, 'ubicar pantalla de consulta', true, marco === page ? 'en la pagina' : 'en un marco interno');
  } catch (e) { paso(traza, 'ubicar pantalla de consulta', false, e.message.slice(0, 80)); }

  const okDesde = await escribirEn(marco, ['input[id*="fechaInicio"]', 'input[name*="fecIni"]', '#txtFechaInicio'], desde);
  const okHasta = await escribirEn(marco, ['input[id*="fechaFin"]', 'input[name*="fecFin"]', '#txtFechaFin'], hasta);
  if (!okDesde || !okHasta) { paso(traza, 'ingresar fechas', false, 'no se hallaron los campos de fecha'); return null; }
  paso(traza, 'ingresar fechas', true, desde + ' a ' + hasta);

  await clicEn(marco, ['input[value="Aceptar"]', 'button[id*="aceptar"]', '#btnAceptar']);
  await new Promise(function (r) { setTimeout(r, 4000); });

  /* Lee la tabla de resultados. */
  const filas = await marco.evaluate(function () {
    var tablas = [].slice.call(document.querySelectorAll('table'));
    var mejor = null, maxFilas = 0;
    tablas.forEach(function (t) {
      var n = t.querySelectorAll('tr').length;
      if (n > maxFilas && /factura|comprobante|receptor/i.test(t.innerText || '')) { maxFilas = n; mejor = t; }
    });
    if (!mejor) return [];
    return [].slice.call(mejor.querySelectorAll('tr')).map(function (tr) {
      return [].slice.call(tr.querySelectorAll('td,th')).map(function (td) { return (td.innerText || '').trim(); });
    }).filter(function (f) { return f.length > 2; });
  }).catch(function () { return []; });

  paso(traza, 'leer resultados', filas.length > 0, filas.length + ' fila(s) encontradas');
  return filas;
}

/* ─────────── Endpoints ─────────── */

/* Guarda la Clave SOL cifrada. Nunca se devuelve despues. */
router.post('/credenciales', async function (req, res) {
  try {
    const b = req.body || {};
    if (!b.ruc || !b.usuario || !b.clave) return res.status(400).json({ ok: false, error: 'Faltan RUC, usuario o clave.' });
    const todo = await credLeer();
    const emp = b.emp || 'default';
    todo[emp] = {
      ruc: String(b.ruc).replace(/\D/g, '').slice(0, 11),
      usuario: String(b.usuario).trim().slice(0, 40),
      clave: cifrar(b.clave),
      guardado: new Date().toISOString()
    };
    await credGuardar(todo);
    res.json({ ok: true, mensaje: 'Credencial guardada cifrada.' });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* Estado: dice si hay credencial, sin revelar la clave. */
router.get('/credenciales', async function (req, res) {
  try {
    const todo = await credLeer();
    const c = todo[req.query.emp || 'default'];
    res.json({
      ok: true, configurado: !!c,
      ruc: c ? c.ruc : null,
      usuario: c ? (String(c.usuario).slice(0, 2) + '••••') : null,
      guardado: c ? c.guardado : null
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/credenciales/borrar', async function (req, res) {
  try {
    const todo = await credLeer();
    delete todo[(req.body || {}).emp || 'default'];
    await credGuardar(todo);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

async function credDe(emp) {
  const todo = await credLeer();
  const c = todo[emp || 'default'];
  if (!c) throw new Error('No hay credenciales SUNAT guardadas para esta empresa.');
  const clave = descifrar(c.clave);
  if (!clave) throw new Error('No se pudo descifrar la clave (cambio AUTH_SECRET?). Vuelve a guardarla.');
  return { ruc: c.ruc, usuario: c.usuario, clave: clave };
}

/* Etapa 1 aislada: comprobar que el acceso funciona. */
router.post('/probar', async function (req, res) {
  const traza = nuevaTraza();
  let navegador = null;
  try {
    const cred = await credDe((req.body || {}).emp);
    navegador = await abrirNavegador();
    paso(traza, 'abrir navegador', true, '');
    const page = await navegador.newPage();
    const ok = await sunatLogin(page, cred, traza);
    const img = await captura(page);
    await navegador.close(); navegador = null;
    res.json({ ok: ok, traza: traza, captura: img });
  } catch (e) {
    if (navegador) try { await navegador.close(); } catch (x) { }
    paso(traza, 'error', false, e.message.slice(0, 200));
    res.status(500).json({ ok: false, error: e.message, traza: traza });
  }
});

/* Flujo completo: acceso, consulta del periodo y lectura de las facturas. */
router.post('/extraer', async function (req, res) {
  const traza = nuevaTraza();
  let navegador = null;
  try {
    const b = req.body || {};
    if (!b.desde || !b.hasta) return res.status(400).json({ ok: false, error: 'Indica desde y hasta (dd/mm/aaaa).' });
    const cred = await credDe(b.emp);

    navegador = await abrirNavegador();
    paso(traza, 'abrir navegador', true, '');
    const page = await navegador.newPage();

    if (!await sunatLogin(page, cred, traza)) {
      const img = await captura(page); await navegador.close(); navegador = null;
      return res.json({ ok: false, etapa: 'login', traza: traza, captura: img });
    }
    if (!await sunatAbrirConsulta(page, traza)) {
      const img = await captura(page); await navegador.close(); navegador = null;
      return res.json({ ok: false, etapa: 'menu', traza: traza, captura: img });
    }
    const filas = await sunatConsultarPeriodo(page, b.desde, b.hasta, traza);
    const img = await captura(page);
    await navegador.close(); navegador = null;

    res.json({ ok: !!(filas && filas.length), etapa: 'consulta', filas: filas || [], traza: traza, captura: img });
  } catch (e) {
    if (navegador) try { await navegador.close(); } catch (x) { }
    paso(traza, 'error', false, e.message.slice(0, 200));
    res.status(500).json({ ok: false, error: e.message, traza: traza });
  }
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
