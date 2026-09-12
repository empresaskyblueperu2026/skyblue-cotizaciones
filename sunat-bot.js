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

/* Un marco sirve si tiene al menos dos campos de texto VISIBLES (inicio y fin).
   Los campos ocultos de descarga (formArchivo.*) no cuentan. */
async function inspeccionarMarco(f) {
  try {
    return await f.evaluate(function () {
      var vis = [].slice.call(document.querySelectorAll('input'))
        .filter(function (e) {
          var t = (e.type || 'text').toLowerCase();
          return (t === 'text' || t === '') && e.offsetParent !== null && !e.disabled;
        })
        .map(function (e) {
          return { id: e.id || '', name: e.name || '', valor: (e.value || '').slice(0, 12), clase: (e.className || '').slice(0, 20) };
        });
      var botones = [].slice.call(document.querySelectorAll('input[type=submit],input[type=button],button,a'))
        .filter(function (e) { return e.offsetParent !== null; })
        .map(function (e) { return (e.value || e.innerText || '').trim(); })
        .filter(function (t) { return t && t.length < 30; }).slice(0, 10);
      var selects = [].slice.call(document.querySelectorAll('select'))
        .filter(function (e) { return e.offsetParent !== null; })
        .map(function (e) { return (e.id || e.name || '?') + ':' + [].slice.call(e.options).map(function (o) { return o.text.trim(); }).slice(0, 4).join('/'); });
      return { visibles: vis, botones: botones, selects: selects, texto: (document.body.innerText || '').slice(0, 120) };
    });
  } catch (e) { return null; }
}

/* Espera hasta que ALGUN marco tenga dos campos de texto visibles. */
async function esperarMarcoConsulta(page, msMax) {
  const limite = Date.now() + (msMax || 35000);
  while (Date.now() < limite) {
    for (const f of page.frames()) {
      const info = await inspeccionarMarco(f);
      if (info && info.visibles.length >= 2) return { marco: f, info: info };
    }
    await new Promise(function (r) { setTimeout(r, 1500); });
  }
  return null;
}

/* Radiografia legible de TODOS los marcos, solo con lo visible. */
async function radiografia(page) {
  const out = [];
  for (const f of page.frames()) {
    const i = await inspeccionarMarco(f);
    if (!i) continue;
    const campos = i.visibles.map(function (v) { return (v.id || v.name || '?'); }).join(' , ');
    out.push({
      url: String(f.url()).slice(-70),
      campos_visibles: campos || '(ninguno)',
      botones: i.botones.join(' , ').slice(0, 120),
      selects: i.selects.join(' | ').slice(0, 120),
      texto: i.texto.replace(/\s+/g, ' ').slice(0, 100)
    });
  }
  return out;
}

async function sunatConsultarPeriodo(page, desde, hasta, traza, salida) {
  const hallado = await esperarMarcoConsulta(page, 35000);
  if (!hallado) {
    salida.radiografia = await radiografia(page);
    paso(traza, 'ubicar campos de fecha', false, 'ningun marco mostro dos campos de texto. Ver el detalle tecnico.');
    return null;
  }
  const marco = hallado.marco, info = hallado.info;
  paso(traza, 'ubicar campos de fecha', true,
    info.visibles.map(function (v) { return v.id || v.name || '?'; }).join(' , ').slice(0, 120));

  /* Se escriben en los dos primeros campos visibles de ESE marco, con los eventos
     que la aplicacion de SUNAT espera para dar por valido el dato. */
  const puesto = await marco.evaluate(function (d, h) {
    var ins = [].slice.call(document.querySelectorAll('input'))
      .filter(function (e) {
        var t = (e.type || 'text').toLowerCase();
        return (t === 'text' || t === '') && e.offsetParent !== null && !e.disabled;
      });
    if (ins.length < 2) return null;
    function set(el, v) {
      el.focus(); el.value = '';
      el.value = v;
      ['input', 'change', 'keyup', 'blur'].forEach(function (ev) {
        el.dispatchEvent(new Event(ev, { bubbles: true }));
      });
    }
    set(ins[0], d); set(ins[1], h);
    return { a: ins[0].id || ins[0].name || 'campo1', b: ins[1].id || ins[1].name || 'campo2',
             leidoA: ins[0].value, leidoB: ins[1].value };
  }, desde, hasta).catch(function () { return null; });

  if (!puesto) {
    salida.radiografia = await radiografia(page);
    paso(traza, 'ingresar fechas', false, 'no se pudo escribir en los campos.');
    return null;
  }
  paso(traza, 'ingresar fechas', true, puesto.a + '=' + puesto.leidoA + ' , ' + puesto.b + '=' + puesto.leidoB);

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

  /* Los campos de SUNAT NO estan dentro de un <form>, por lo que no sirve enviar
     formularios: hay que pulsar el boton. Se busca en TODO el marco y se identifica
     por texto, alt, title, id, name, imagen y onclick; se descartan Salir, Cerrar,
     Descarga masiva y los iconos de calendario. Ante varios candidatos se toma el
     mas pequeno, que es el boton y no su contenedor. */
  const pulsado = await marco.evaluate(function () {
    function txtPropio(e) {
      var t = '';
      for (var i = 0; i < e.childNodes.length; i++) { var n = e.childNodes[i]; if (n.nodeType === 3) t += n.nodeValue; }
      return t.trim();
    }
    function senas(e) {
      return ((e.value || '') + ' ' + txtPropio(e) + ' ' + (e.alt || '') + ' ' + (e.title || '') + ' ' +
        (e.id || '') + ' ' + (e.name || '') + ' ' + ((e.getAttribute && e.getAttribute('src')) || '') + ' ' +
        ((e.getAttribute && e.getAttribute('onclick')) || '')).toLowerCase();
    }
    var POS = /acepta|buscar|consultar|continuar/;
    var NEG = /salir|cerrar|cancelar|limpiar|imprimir|volver|descarga|masiva|calendario|fecha/;
    var els = [].slice.call(document.querySelectorAll('a,button,input,img,td,span,div')).filter(function (e) {
      if (e.offsetParent === null) return false;
      if (e.tagName === 'INPUT') {
        var t = (e.type || '').toLowerCase();
        if (['button', 'submit', 'image'].indexOf(t) < 0) return false;
      }
      if (e.offsetWidth > 320 || e.offsetHeight > 90) return false;
      var s = senas(e);
      return POS.test(s) && !NEG.test(s);
    });
    els.sort(function (a, b) { return (a.offsetWidth * a.offsetHeight) - (b.offsetWidth * b.offsetHeight); });
    var b = els[0];
    if (b) { b.click(); return b.tagName.toLowerCase() + (b.id ? ('#' + b.id) : '') + ' ' + senas(b).slice(0, 40); }
    return null;
  }).catch(function () { return null; });

  if (!pulsado) {
    const opciones = await marco.evaluate(function () {
      return [].slice.call(document.querySelectorAll('a,button,input,img,td'))
        .filter(function (e) { return e.offsetParent !== null; })
        .map(function (e) {
          return e.tagName.toLowerCase() + ':' +
            ((e.value || e.innerText || e.alt || e.title || e.id || e.name ||
              ((e.getAttribute && e.getAttribute('src')) || '')) + '').trim().slice(0, 22);
        }).slice(0, 20);
    }).catch(function () { return []; });
    salida.radiografia = await radiografia(page);
    paso(traza, 'ejecutar consulta', false, 'no se hallo el boton. Habia: ' + opciones.join(' , ').slice(0, 280));
    return null;
  }
  paso(traza, 'ejecutar consulta', true, pulsado);
  await new Promise(function (r) { setTimeout(r, 9000); });

  /* Buscar la tabla de resultados en cualquier marco. */
  let filas = [];
  for (const f of page.frames()) {
    try {
      const t = await f.evaluate(function () {
        /* No se depende de encabezados ni de la anidacion: una fila de datos es la que
           tiene una celda con fecha dd/mm/aaaa y otra con el numero de comprobante
           (E001 - 4, F001-123, B001 - 7...). Asi da igual como este maquetada. */
        var reFecha = /^\s*\d{2}\/\d{2}\/\d{4}\s*$/;
        var reNum = /^\s*[A-Z]{1,4}\d{0,4}\s*-\s*\d+\s*$/i;
        var filas = [].slice.call(document.querySelectorAll('tr')).filter(function (tr) {
          var celdas = [].slice.call(tr.cells || []);
          if (celdas.length < 3) return false;
          /* Se descartan las filas de envoltura: sus celdas contienen otras tablas. */
          if (tr.querySelector('table')) return false;
          var txt = celdas.map(function (c) { return (c.innerText || '').trim(); });
          return txt.some(function (x) { return reFecha.test(x); }) &&
                 txt.some(function (x) { return reNum.test(x); });
        });
        if (!filas.length) return [];

        /* Encabezado: la primera fila de la misma tabla que no sea de datos. */
        var tabla = filas[0].closest ? filas[0].closest('table') : null;
        var enc = null;
        if (tabla) {
          var todas = [].slice.call(tabla.rows || []);
          for (var i = 0; i < todas.length; i++) {
            var t2 = [].slice.call(todas[i].cells || []).map(function (c) { return (c.innerText || '').trim(); });
            if (t2.some(function (x) { return /fecha de emis|nro|receptor|importe/i.test(x); })) { enc = t2; break; }
          }
        }
        var datos = filas.map(function (tr) {
          return [].slice.call(tr.cells || []).map(function (c) { return (c.innerText || '').trim(); });
        });
        return enc ? [enc].concat(datos) : datos;
      });
      if (t && t.length) { filas = t; break; }
    } catch (e) { }
  }

  if (!filas.length) {
    salida.radiografia = await radiografia(page);
    /* Volcado del HTML de las tablas, para corregir el lector con datos ciertos. */
    salida.volcado = [];
    for (const f of page.frames()) {
      try {
        const v = await f.evaluate(function () {
          var tablas = [].slice.call(document.querySelectorAll('table'));
          if (!tablas.length) return null;
          /* La tabla mas profunda que mencione un comprobante. */
          var cand = tablas.filter(function (t) {
            return /\d{2}\/\d{2}\/\d{4}/.test(t.innerText || '') || /E\d{3}|F\d{3}|B\d{3}/.test(t.innerText || '');
          });
          var t = cand.length ? cand[cand.length - 1] : tablas[tablas.length - 1];
          return {
            filas: (t.rows || []).length,
            celdasPrimeraFila: t.rows && t.rows[0] ? t.rows[0].cells.length : 0,
            html: (t.outerHTML || '').replace(/\s+/g, ' ').slice(0, 2500),
            totalTablas: tablas.length
          };
        });
        if (v) salida.volcado.push({ url: String(f.url()).slice(-60), tabla: v });
      } catch (e) { }
    }
    let txt = '';
    try { txt = await marco.evaluate(function () { return (document.body.innerText || '').slice(0, 250); }); } catch (e) { }
    paso(traza, 'leer resultados', false, /no se encontr|sin resultado|no existe|no hay/i.test(txt)
      ? 'SUNAT informa que no hay comprobantes en ese periodo'
      : 'sin tabla de resultados. Ver el detalle tecnico.');
    return [];
  }
  paso(traza, 'leer resultados', true, filas.length + ' fila(s)');
  return filas;
}

/* La tabla de SUNAT trae encabezados; se ubican las columnas por su nombre para no
   depender del orden, y se separa "RUC - RAZON SOCIAL" del receptor. */
function filasAFacturas(filas) {
  if (!filas || !filas.length) return [];
  const enc = filas[0].map(function (c) { return String(c).toLowerCase(); });
  function col(re) { for (var i = 0; i < enc.length; i++) { if (re.test(enc[i])) return i; } return -1; }
  var iFecha = col(/fecha de emis/), iNum = col(/nro|numero|factura electr/),
      iRec = col(/receptor|cliente/), iTot = col(/importe|total/), iAnul = col(/anulado/);

  /* Sin encabezado reconocible: se ubican las columnas por el contenido de la
     primera fila de datos (fecha, numero, "RUC - RAZON", importe). */
  var conEncabezado = (iFecha >= 0 && iNum >= 0);
  if (!conEncabezado) {
    var muestra = filas[0];
    for (var i = 0; i < muestra.length; i++) {
      var v = String(muestra[i] || '').trim();
      if (iFecha < 0 && /^\d{2}\/\d{2}\/\d{4}$/.test(v)) { iFecha = i; continue; }
      if (iNum < 0 && /^[A-Z]{1,4}\d{0,4}\s*-\s*\d+$/i.test(v)) { iNum = i; continue; }
      if (iRec < 0 && /^\d{8,11}\s*-\s*\S/.test(v)) { iRec = i; continue; }
      if (iTot < 0 && /^(S\/|\$|US\$)?\s*[\d,]+\.\d{2}$/.test(v)) { iTot = i; continue; }
    }
    if (iFecha < 0 || iNum < 0) return [];
  }

  var cuerpo = conEncabezado ? filas.slice(1) : filas;
  return cuerpo.map(function (f) {
    const rec = String(f[iRec] || '').split(' - ');
    const montoTxt = String(f[iTot] || '').replace(/[^\d.,-]/g, '').replace(/,/g, '');
    const fecha = String(f[iFecha] || '').trim();
    const m = fecha.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return {
      tipo_doc: 'FACTURA',
      serie_numero: String(f[iNum] || '').replace(/\s+/g, ''),
      fecha_emision: m ? (m[3] + '-' + m[2] + '-' + m[1]) : fecha,
      cliente: { razon: rec.slice(1).join(' - ').trim(), ruc: (rec[0] || '').trim() },
      moneda: /\$|US/.test(String(f[iTot] || '')) ? 'USD' : 'PEN',
      total: parseFloat(montoTxt) || 0,
      anulado: iAnul >= 0 ? !!String(f[iAnul] || '').trim() : false,
      origen: 'sunat'
    };
  }).filter(function (x) { return x.serie_numero && !x.anulado; });
}

/* ─────────── Descarga de los PDF de cada factura ─────────── */

/* Espera a que aparezca un archivo nuevo y terminado (no .crdownload). */
function esperarArchivo(dir, yaEstaban, msMax) {
  const fsx = require('fs');
  return new Promise(function (res) {
    const limite = Date.now() + (msMax || 30000);
    (function mirar() {
      let ahora = [];
      try { ahora = fsx.readdirSync(dir); } catch (e) { }
      const nuevo = ahora.filter(function (a) {
        return yaEstaban.indexOf(a) < 0 && !/\.crdownload$/i.test(a) && !/\.tmp$/i.test(a);
      })[0];
      if (nuevo) {
        /* Confirmar que dejo de crecer (descarga terminada). */
        try {
          const p = require('path').join(dir, nuevo);
          const t1 = fsx.statSync(p).size;
          setTimeout(function () {
            let t2 = 0; try { t2 = fsx.statSync(p).size; } catch (e) { }
            if (t2 > 0 && t2 === t1) return res(nuevo);
            if (Date.now() < limite) return mirar();
            res(t2 > 0 ? nuevo : null);
          }, 900);
          return;
        } catch (e) { }
      }
      if (Date.now() > limite) return res(null);
      setTimeout(mirar, 1000);
    })();
  });
}

/* Pulsa cada enlace "Descargar PDF" y devuelve los archivos en base64.
   Se recorren los enlaces (uno por comprobante), no las filas de la tabla: es mas
   fiable que interpretar una maquetacion con tablas anidadas. */
async function descargarPDFs(page, traza, maxN) {
  const fsx = require('fs'), os = require('os'), path = require('path');
  const dir = fsx.mkdtempSync(path.join(os.tmpdir(), 'sunatpdf-'));

  let client;
  try {
    client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
  } catch (e) { paso(traza, 'preparar descargas', false, e.message.slice(0, 90)); return []; }
  paso(traza, 'preparar descargas', true, '');

  /* Ubicar el marco que tiene los enlaces de descarga. */
  let marco = null, total = 0;
  for (const f of page.frames()) {
    try {
      const n = await f.evaluate(function () {
        return [].slice.call(document.querySelectorAll('a')).filter(function (a) {
          return /descargar\s*pdf/i.test(a.innerText || '');
        }).length;
      });
      if (n > 0) { marco = f; total = n; break; }
    } catch (e) { }
  }
  if (!marco) { paso(traza, 'ubicar descargas', false, 'no se hallaron enlaces "Descargar PDF"'); return []; }
  paso(traza, 'ubicar descargas', true, total + ' comprobante(s) con PDF');

  const tope = Math.min(total, maxN || 30);
  const salida = [];
  for (let i = 0; i < tope; i++) {
    let antes = [];
    try { antes = fsx.readdirSync(dir); } catch (e) { }

    /* Datos de la fila del enlace, para saber a que comprobante corresponde. */
    const fila = await marco.evaluate(function (idx) {
      var links = [].slice.call(document.querySelectorAll('a')).filter(function (a) {
        return /descargar\s*pdf/i.test(a.innerText || '');
      });
      var a = links[idx];
      if (!a) return null;
      var tr = a.closest ? a.closest('tr') : null;
      var celdas = tr ? [].slice.call(tr.cells || []).map(function (c) { return (c.innerText || '').trim(); }) : [];
      a.click();
      return celdas;
    }, i).catch(function () { return null; });

    const arch = await esperarArchivo(dir, antes, 30000);
    if (arch) {
      try {
        const b64 = fsx.readFileSync(path.join(dir, arch)).toString('base64');
        salida.push({ nombre: arch, b64: b64, fila: fila || [] });
      } catch (e) { }
    }
    await new Promise(function (r) { setTimeout(r, 1200); });
  }

  paso(traza, 'descargar PDF', salida.length > 0, salida.length + ' de ' + tope + ' descargado(s)');
  /* Limpieza: los comprobantes no deben quedar en el disco del servidor. */
  try { salida.forEach(function () { }); fsx.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  return salida;
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
    const salida = {};
    const filas = await sunatConsultarPeriodo(page, b.desde, b.hasta, traza, salida);
    const img = await captura(page);
    await navegador.close(); navegador = null;

    const pdfs = await descargarPDFs(page, traza, 30);
    const facturas = filasAFacturas(filas);
    if (facturas.length) paso(traza, 'interpretar facturas', true, facturas.length + ' comprobante(s) listos');
    res.json({ ok: !!((pdfs && pdfs.length) || (facturas && facturas.length)), etapa: 'consulta', filas: filas || [], facturas: facturas, pdfs: pdfs || [], traza: traza, captura: img, radiografia: salida.radiografia || null, volcado: salida.volcado || null });
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
