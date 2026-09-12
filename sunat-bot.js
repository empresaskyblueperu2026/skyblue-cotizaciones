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

  const nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(function () { return null; });
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
  /* OJO: el portal de SUNAT mantiene conexiones abiertas (push/ajax), por lo que
     'networkidle' NUNCA se cumple y agota el tiempo. Se espera por el DOM. */
  const url = page.url();
  if (!/e-menu\.sunat\.gob\.pe/i.test(url)) {
    try {
      await page.goto('https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm',
        { waitUntil: 'domcontentloaded', timeout: 40000 });
    } catch (e) { paso(traza, 'abrir menu', false, e.message.slice(0, 90)); return false; }
  }
  paso(traza, 'abrir menu', true, page.url().slice(0, 70));
  await new Promise(function (r) { setTimeout(r, 3500); });

  /* Estrategia 1: el buscador del menu (lo mas estable del portal). */
  try {
    const buscador = await page.$('#txtBusca, input[id*="busca" i], input[placeholder*="opci" i]');
    if (buscador) {
      await buscador.click({ clickCount: 3 });
      await buscador.type('Consultar Factura y Nota', { delay: 40 });
      await new Promise(function (r) { setTimeout(r, 2500); });
      const clicado = await page.evaluate(function () {
        var els = [].slice.call(document.querySelectorAll('a,li,span,div'));
        var el = els.filter(function (e) {
          return /consultar factura y nota/i.test(e.innerText || '') && e.offsetParent !== null
            && (e.innerText || '').length < 80;
        })[0];
        if (el) { el.click(); return (el.innerText || '').trim().slice(0, 60); }
        return null;
      });
      if (clicado) {
        paso(traza, 'buscador del menu', true, 'abrio: ' + clicado);
        await new Promise(function (r) { setTimeout(r, 5000); });
        return true;
      }
    }
  } catch (e) { }

  /* Estrategia 2: el acceso directo de la portada. */
  try {
    const directo = await page.evaluate(function () {
      var els = [].slice.call(document.querySelectorAll('a,div,span,img'));
      var el = els.filter(function (e) {
        var t = (e.innerText || '') + ' ' + (e.getAttribute('alt') || '') + ' ' + (e.getAttribute('title') || '');
        return /consulta de facturas y notas/i.test(t) && e.offsetParent !== null;
      })[0];
      if (el) { el.click(); return true; }
      return false;
    });
    if (directo) {
      paso(traza, 'acceso directo', true, 'Consulta de Facturas y Notas Electronicas');
      await new Promise(function (r) { setTimeout(r, 5000); });
      return true;
    }
  } catch (e) { }

  /* Estrategia 3: recorrer el arbol del menu paso a paso. */
  const rutas = ['Empresas', 'Comprobantes de Pago', 'SEE - SOL', 'Factura Electr', 'Consultar Factura y Nota'];
  let avanzo = 0;
  for (const t of rutas) {
    const hecho = await page.evaluate(function (txt) {
      var els = [].slice.call(document.querySelectorAll('a,span,div,li,td'));
      var el = els.filter(function (e) {
        var propio = (e.innerText || '').trim();
        return propio.toLowerCase().indexOf(txt.toLowerCase()) === 0 && propio.length < 70 && e.offsetParent !== null;
      })[0];
      if (el) { el.click(); return true; }
      return false;
    }, t).catch(function () { return false; });
    if (hecho) { avanzo++; await new Promise(function (r) { setTimeout(r, 2200); }); }
  }
  if (avanzo >= 3) { paso(traza, 'recorrer menu', true, avanzo + ' de ' + rutas.length + ' pasos'); return true; }

  /* Si nada funciono, se informa QUE opciones habia, para corregir con datos reales. */
  const visibles = await page.evaluate(function () {
    return [].slice.call(document.querySelectorAll('a,li,span'))
      .map(function (e) { return (e.innerText || '').trim(); })
      .filter(function (t) { return t.length > 3 && t.length < 60; })
      .slice(0, 40);
  }).catch(function () { return []; });
  paso(traza, 'abrir consulta', false, 'no se hallo la opcion. Visibles: ' + visibles.slice(0, 12).join(' | ').slice(0, 300));
  return false;
}

/* ─────────── Etapa 3: consultar un periodo y leer la tabla ─────────── */

/* La consulta vive en un marco propio (ol-ti-itconscpempyme/consultar.do) que tarda
   en montarse. Se espera a que exista Y tenga campos, no solo a que aparezca la URL. */
async function esperarMarcoConsulta(page, msMax) {
  const limite = Date.now() + (msMax || 30000);
  while (Date.now() < limite) {
    const cand = page.frames().filter(function (f) {
      return /itconscpempyme|consultar\.do|conscpe/i.test(String(f.url()));
    });
    for (const f of cand) {
      try {
        const n = await f.evaluate(function () { return document.querySelectorAll('input,select').length; });
        if (n > 0) return f;
      } catch (e) { }
    }
    await new Promise(function (r) { setTimeout(r, 1500); });
  }
  return null;
}

/* Radiografia de todos los marcos: sirve para afinar selectores con datos reales. */
async function radiografia(page) {
  const out = [];
  for (const f of page.frames()) {
    try {
      const info = await f.evaluate(function () {
        return {
          campos: [].slice.call(document.querySelectorAll('input,select')).slice(0, 12).map(function (e) {
            return e.tagName.toLowerCase() + (e.id ? ('#' + e.id) : '') + (e.name ? ('[' + e.name + ']') : '') +
              (e.type ? (':' + e.type) : '');
          }),
          botones: [].slice.call(document.querySelectorAll('input[type=submit],input[type=button],button'))
            .slice(0, 6).map(function (e) { return (e.value || e.innerText || '').trim().slice(0, 25); })
        };
      });
      if (info.campos.length) out.push(String(f.url()).slice(-55) + ' => ' + info.campos.join(' ') + (info.botones.length ? (' | botones: ' + info.botones.join(',')) : ''));
    } catch (e) { }
  }
  return out;
}

async function sunatConsultarPeriodo(page, desde, hasta, traza) {
  const marco = await esperarMarcoConsulta(page, 30000);
  if (!marco) {
    const rx = await radiografia(page);
    paso(traza, 'ubicar pantalla de consulta', false, ('no aparecio el marco de consulta. ' + rx.join(' || ')).slice(0, 420));
    return null;
  }
  paso(traza, 'ubicar pantalla de consulta', true, String(marco.url()).slice(-60));

  /* Selectores especificos: NO se usa 'input[type=text]' a secas porque en la pagina
     principal eso es el buscador del menu y se terminaba escribiendo ahi. */
  const selDesde = ['input[id*="fechaInicio" i]', 'input[name*="fechaInicio" i]', 'input[id*="fecIni" i]',
                    'input[name*="fecIni" i]', 'input[id*="desde" i]', 'input[name*="desde" i]', '#txtFechaInicio'];
  const selHasta = ['input[id*="fechaFin" i]', 'input[name*="fechaFin" i]', 'input[id*="fecFin" i]',
                    'input[name*="fecFin" i]', 'input[id*="hasta" i]', 'input[name*="hasta" i]', '#txtFechaFin'];

  let sDesde = await escribirEn(marco, selDesde, desde);
  let sHasta = await escribirEn(marco, selHasta, hasta);

  /* Respaldo: si no calzo ningun nombre, se usan los dos primeros campos de fecha
     que haya EN ESE MARCO (la pantalla solo tiene dos). */
  if (!sDesde || !sHasta) {
    const puestos = await marco.evaluate(function (d, h) {
      var ins = [].slice.call(document.querySelectorAll('input[type=text],input:not([type])'))
        .filter(function (e) { return e.offsetParent !== null && !e.readOnly; });
      if (ins.length < 2) return null;
      function set(el, v) {
        el.focus(); el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      set(ins[0], d); set(ins[1], h);
      return (ins[0].id || ins[0].name || 'campo1') + ' / ' + (ins[1].id || ins[1].name || 'campo2');
    }, desde, hasta).catch(function () { return null; });
    if (puestos) { sDesde = puestos; sHasta = puestos; }
  }

  if (!sDesde || !sHasta) {
    const rx = await radiografia(page);
    paso(traza, 'ingresar fechas', false, ('no se hallaron los campos. ' + rx.join(' || ')).slice(0, 420));
    return null;
  }
  paso(traza, 'ingresar fechas', true, desde + ' a ' + hasta + ' (' + sDesde + ')');

  /* Tipo de consulta: FE Emitidas. */
  try {
    const tipo = await marco.evaluate(function () {
      var sels = [].slice.call(document.querySelectorAll('select'));
      for (var i = 0; i < sels.length; i++) {
        var op = [].slice.call(sels[i].options || []).filter(function (o) { return /emitid/i.test(o.text || ''); })[0];
        if (op) { sels[i].value = op.value; sels[i].dispatchEvent(new Event('change', { bubbles: true })); return op.text.trim(); }
      }
      return null;
    });
    if (tipo) paso(traza, 'tipo de consulta', true, tipo);
  } catch (e) { }

  const btn = await clicEn(marco, ['input[value="Aceptar" i]', 'input[type="submit"]', 'button[id*="aceptar" i]',
                                   '#btnAceptar', 'button[type="submit"]']);
  if (!btn) {
    /* Algunas pantallas responden al Enter dentro del formulario. */
    try { await marco.evaluate(function () { var f = document.forms[0]; if (f) f.submit(); }); } catch (e) { }
  }
  paso(traza, 'ejecutar consulta', true, btn || 'envio del formulario');
  await new Promise(function (r) { setTimeout(r, 7000); });

  /* Leer la tabla de resultados (puede haberse recargado el marco). */
  const marco2 = (await esperarMarcoConsulta(page, 12000)) || marco;
  let filas = [];
  try {
    filas = await marco2.evaluate(function () {
      var tablas = [].slice.call(document.querySelectorAll('table'));
      var mejor = null, max = 0;
      tablas.forEach(function (t) {
        var n = t.querySelectorAll('tr').length;
        if (n > max && /factura|comprobante|receptor|emision/i.test(t.innerText || '')) { max = n; mejor = t; }
      });
      if (!mejor) return [];
      return [].slice.call(mejor.querySelectorAll('tr')).map(function (tr) {
        return [].slice.call(tr.querySelectorAll('td,th')).map(function (td) { return (td.innerText || '').trim(); });
      }).filter(function (x) { return x.length > 2; });
    });
  } catch (e) { }

  if (!filas.length) {
    let txt = '';
    try { txt = await marco2.evaluate(function () { return (document.body.innerText || '').slice(0, 250); }); } catch (e) { }
    paso(traza, 'leer resultados', false, /no se encontr|sin resultado|no existe|no hay/i.test(txt)
      ? 'SUNAT informa que no hay comprobantes en ese periodo'
      : ('sin tabla de resultados. Pantalla: ' + txt.slice(0, 180)));
    return [];
  }
  paso(traza, 'leer resultados', true, filas.length + ' fila(s)');
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
