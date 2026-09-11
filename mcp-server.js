/* ═══════════════════════════════════════════════════════════════════════════
   SIGMA ERP — SERVIDOR MCP (Model Context Protocol)  ·  SOLO LECTURA

   Modulo independiente: no importa ni modifica la logica del ERP.
   Lee directamente el almacen JSON de Supabase Storage y expone herramientas
   de consulta a Claude mediante el transporte "Streamable HTTP" de MCP.

   Seguridad:
     - Requiere token (Authorization: Bearer <MCP_TOKEN>). Sin token no arranca: rechaza todo.
     - Ninguna herramienta escribe. No hay endpoints de escritura.
     - Toda respuesta pasa por sanitizar(): elimina DNI, cuentas bancarias, CCI,
       contrasenas, tokens, certificados y demas datos sensibles.

   Uso desde index.js (una sola linea, sin tocar nada mas):
     app.use('/mcp', require('./mcp-server').router);
   ═══════════════════════════════════════════════════════════════════════════ */

const express = require('express');
const router = express.Router();

const SERVER_NAME = 'sigma-erp';
const SERVER_VERSION = '1.0.0';
/* Version del protocolo MCP que implementa este servidor. */
const PROTOCOL_VERSION = '2025-06-18';
const PROTOCOLOS_ACEPTADOS = ['2025-06-18', '2025-03-26', '2024-11-05'];

/* ─────────────────────────── Acceso a datos (solo lectura) ─────────────────────────── */

const SB_URL = process.env.SUPABASE_URL || 'https://xlwndbqflbodgszjalzp.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SB_BUCKET = 'sigma-data';
const SB_OBJ = 'global.json';

/* Cache corto: evita releer el almacen completo en cada herramienta. */
let _cache = { datos: null, ts: 0 };
const CACHE_MS = 30 * 1000;

async function leerAlmacen() {
  if (_cache.datos && (Date.now() - _cache.ts) < CACHE_MS) return _cache.datos;
  if (!SB_KEY) throw new Error('El servidor no tiene acceso a los datos (falta SUPABASE_SERVICE_KEY).');
  const r = await fetch(SB_URL + '/storage/v1/object/' + SB_BUCKET + '/' + SB_OBJ + '?t=' + Date.now(), {
    headers: { 'Authorization': 'Bearer ' + SB_KEY, 'apikey': SB_KEY, 'cache-control': 'no-cache' }
  });
  if (!r.ok) throw new Error('No se pudo leer el almacen (HTTP ' + r.status + ').');
  const t = await r.text();
  const datos = t ? JSON.parse(t) : {};
  _cache = { datos: datos, ts: Date.now() };
  return datos;
}

async function leerEmpresas() {
  if (!SB_KEY) return [];
  const r = await fetch(SB_URL + '/rest/v1/empresas?select=id,nombre,ruc&order=nombre', {
    headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }
  });
  if (!r.ok) return [];
  return await r.json();
}

/* ─────────────────────────── Saneamiento de datos sensibles ─────────────────────────── */

/* Campos que NUNCA salen del servidor, sin importar donde aparezcan. */
const CAMPOS_PROHIBIDOS = /^(dni|doc|documento|nrodoc|num_doc|cci|cuenta|nrocuenta|cuenta_bancaria|banco|entidad_bancaria|clave|claveSol|clave_sol|certClave|password|pass|contrasena|contrasenia|hash|salt|token|secret|clientSecret|apikey|api_key|cert|pfx|firma|auth|authorization|tgChatId|chatId)$/i;

/* Palabras sensibles buscadas por TOKEN, no por subcadena: asi "direccion" no se
   confunde con "cci", ni "descuento" con "cuenta". */
const PALABRAS_SENSIBLES = /^(dni|cci|cuenta|cuentas|ctacte|banco|bancaria|bancario|clave|claves|password|passwd|pwd|secret|secreto|token|hash|salt|certificado|certificados|credencial|credenciales)$/i;

/* Parte el nombre del campo en palabras: "clienteDni" -> [cliente, dni]; "cuenta_cci" -> [cuenta, cci]. */
function palabrasDe(nombre) {
  return String(nombre || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

function campoSospechoso(nombre) {
  return palabrasDe(nombre).some(function (p) { return PALABRAS_SENSIBLES.test(p); });
}

/* RUC peruano valido: 11 digitos que empiezan en 10/15/16/17/20. Un "ruc" de 8 digitos
   es en realidad un DNI (comun en boletas), y se enmascara. */
function rucPublicoOMascara(valor) {
  const d = String(valor == null ? '' : valor).replace(/\D/g, '');
  if (d.length === 11 && /^(10|15|16|17|20)/.test(d)) return d;
  if (d.length === 8) return '********';           // DNI
  if (d.length === 0) return null;
  return '********';                                // cualquier otro identificador no reconocido
}

/* Elimina de un texto libre patrones que parezcan cuentas bancarias, CCI o DNI. */
function limpiarTexto(txt) {
  let s = String(txt == null ? '' : txt);
  // CCI / cuentas: secuencias de 13 o mas digitos (con o sin guiones/espacios)
  s = s.replace(/\b[\d][\d\s-]{12,}\d\b/g, '[dato bancario omitido]');
  // menciones explicitas con su numero
  s = s.replace(/\b(cci|cuenta|cta|n[uú]mero de cuenta|interbancaria)\b\s*[:#-]?\s*[\d\s-]{6,}/gi, '[dato bancario omitido]');
  s = s.replace(/\b(dni|c\.?e\.?|carn[eé] de extranjer[ií]a)\b\s*[:#-]?\s*[\d]{6,12}/gi, '[documento omitido]');
  s = s.replace(/\b(clave|contrase[nñ]a|password)\b\s*[:#-]?\s*\S+/gi, '[credencial omitida]');
  return s;
}

/* Recorre recursivamente cualquier estructura y devuelve una copia segura. */
function sanitizar(valor, nombreCampo) {
  if (valor == null) return valor;

  if (Array.isArray(valor)) return valor.map(function (v) { return sanitizar(v, nombreCampo); });

  if (typeof valor === 'object') {
    const salida = {};
    for (const k of Object.keys(valor)) {
      if (CAMPOS_PROHIBIDOS.test(k)) continue;                 // se omite por completo
      if (/^ruc$/i.test(k)) {                                   // RUC: publico si es valido, si no se enmascara
        const r = rucPublicoOMascara(valor[k]);
        if (r) salida[k] = r;
        continue;
      }
      if (campoSospechoso(k)) continue;                         // campos con nombre dudoso: fuera
      salida[k] = sanitizar(valor[k], k);
    }
    return salida;
  }

  if (typeof valor === 'string') return limpiarTexto(valor);
  return valor;
}

/* ─────────────────────────── Utilidades de consulta ─────────────────────────── */

/* Redondea importes a 2 decimales: los totales guardados arrastran error de coma
   flotante (ej. 3924.5619999999994) y deben mostrarse como dinero. */
function dinero(v) {
  const n = Number(v);
  if (!isFinite(n)) return v == null ? null : v;
  return Math.round(n * 100) / 100;
}

function normalizar(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
    .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n');
}

/* Busca un texto dentro de los campos indicados de un registro. */
function coincide(registro, texto, campos) {
  if (!texto) return true;
  const q = normalizar(texto);
  return campos.some(function (c) {
    const v = c.split('.').reduce(function (o, k) { return o ? o[k] : null; }, registro);
    return normalizar(v).indexOf(q) >= 0;
  });
}

function aFecha(f) {
  if (!f) return null;
  const s = String(f).trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);            // dd/mm/aaaa
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);                   // aaaa-mm-dd
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function enRango(fecha, desde, hasta) {
  const d = aFecha(fecha);
  if (!d) return !desde && !hasta;
  if (desde) { const a = aFecha(desde); if (a && d < a) return false; }
  if (hasta) { const b = aFecha(hasta); if (b && d > b) return false; }
  return true;
}

/* Resuelve el id de empresa: acepta el UUID, el nombre o un alias corto. */
async function resolverEmpresa(ref) {
  const empresas = await leerEmpresas();
  if (!ref) return null;
  const q = normalizar(ref);
  const hit = empresas.find(function (e) {
    return e.id === ref || normalizar(e.nombre).indexOf(q) >= 0 || normalizar(e.ruc) === q;
  });
  return hit || null;
}

/* Claves del almacen para una empresa; SKY BLUE conserva claves heredadas sin sufijo. */
const SKYBLUE_ID = 'ea38482b-f5a5-4a1b-b167-0d779aecd758';

function leerLista(datos, prefijo, empId) {
  const v = datos[prefijo + '_' + empId];
  return Array.isArray(v) ? v : [];
}

/* ─────────────────────────── Definicion de herramientas ─────────────────────────── */

const HERRAMIENTAS = [
  {
    name: 'listar_empresas',
    title: 'Listar empresas',
    description: 'Lista las empresas del ERP con su identificador y RUC. Usalo primero para saber que empresa consultar en las demas herramientas.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'buscar_productos',
    title: 'Buscar productos y precios',
    description: 'Busca productos y servicios del catalogo con sus precios (minimo, maximo y precios de compra/venta historicos). Permite filtrar por texto y por rango de precio.',
    inputSchema: {
      type: 'object',
      properties: {
        empresa: { type: 'string', description: 'Nombre o id de la empresa. Si se omite, usa SKY BLUE.' },
        texto: { type: 'string', description: 'Texto a buscar en el nombre del producto.' },
        precio_min: { type: 'number', description: 'Precio minimo.' },
        precio_max: { type: 'number', description: 'Precio maximo.' },
        limite: { type: 'number', description: 'Maximo de resultados (por defecto 50).' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'buscar_proveedores',
    title: 'Buscar proveedores',
    description: 'Busca proveedores registrados con sus datos de contacto comerciales y los productos que ofrecen.',
    inputSchema: {
      type: 'object',
      properties: {
        empresa: { type: 'string', description: 'Nombre o id de la empresa.' },
        texto: { type: 'string', description: 'Texto a buscar en nombre, RUC, ubicacion o productos.' },
        producto: { type: 'string', description: 'Filtra proveedores que ofrezcan este producto.' },
        limite: { type: 'number', description: 'Maximo de resultados (por defecto 50).' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'buscar_clientes',
    title: 'Buscar clientes',
    description: 'Busca clientes del CRM y de las cotizaciones emitidas, con su etapa comercial y valor estimado. No devuelve documentos de identidad ni datos bancarios.',
    inputSchema: {
      type: 'object',
      properties: {
        empresa: { type: 'string', description: 'Nombre o id de la empresa.' },
        texto: { type: 'string', description: 'Texto a buscar en nombre, empresa o RUC.' },
        etapa: { type: 'string', description: 'Filtra por etapa del CRM (ej. prospecto, negociacion, ganado).' },
        limite: { type: 'number', description: 'Maximo de resultados (por defecto 50).' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'buscar_cotizaciones',
    title: 'Buscar cotizaciones',
    description: 'Busca cotizaciones emitidas con su cliente, proyecto, moneda, total e items. Permite filtrar por texto, cliente, rango de fechas y rango de montos.',
    inputSchema: {
      type: 'object',
      properties: {
        empresa: { type: 'string', description: 'Nombre o id de la empresa.' },
        texto: { type: 'string', description: 'Texto a buscar en numero, cliente, proyecto o items.' },
        cliente: { type: 'string', description: 'Filtra por nombre del cliente.' },
        desde: { type: 'string', description: 'Fecha inicial (aaaa-mm-dd o dd/mm/aaaa).' },
        hasta: { type: 'string', description: 'Fecha final (aaaa-mm-dd o dd/mm/aaaa).' },
        monto_min: { type: 'number', description: 'Total minimo.' },
        monto_max: { type: 'number', description: 'Total maximo.' },
        incluir_items: { type: 'boolean', description: 'Incluir el detalle de items (por defecto false).' },
        limite: { type: 'number', description: 'Maximo de resultados (por defecto 30).' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'buscar_ventas',
    title: 'Buscar ventas',
    description: 'Busca ventas: facturas emitidas y comprobantes de venta registrados. Permite filtrar por cliente, rango de fechas y montos.',
    inputSchema: {
      type: 'object',
      properties: {
        empresa: { type: 'string', description: 'Nombre o id de la empresa.' },
        texto: { type: 'string', description: 'Texto a buscar en numero de comprobante o cliente.' },
        cliente: { type: 'string', description: 'Filtra por nombre del cliente.' },
        desde: { type: 'string', description: 'Fecha inicial (aaaa-mm-dd o dd/mm/aaaa).' },
        hasta: { type: 'string', description: 'Fecha final (aaaa-mm-dd o dd/mm/aaaa).' },
        monto_min: { type: 'number', description: 'Monto minimo.' },
        monto_max: { type: 'number', description: 'Monto maximo.' },
        limite: { type: 'number', description: 'Maximo de resultados (por defecto 50).' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'resumen_ventas',
    title: 'Resumen de ventas',
    description: 'Devuelve totales agregados de ventas y compras en un periodo: cantidad de comprobantes, monto total, IGV y los principales clientes.',
    inputSchema: {
      type: 'object',
      properties: {
        empresa: { type: 'string', description: 'Nombre o id de la empresa.' },
        desde: { type: 'string', description: 'Fecha inicial (aaaa-mm-dd o dd/mm/aaaa).' },
        hasta: { type: 'string', description: 'Fecha final (aaaa-mm-dd o dd/mm/aaaa).' }
      },
      additionalProperties: false
    }
  }
];

/* ─────────────────────────── Ejecucion de herramientas ─────────────────────────── */

async function empresaDe(args) {
  const ref = args && args.empresa;
  if (!ref) {
    const e = await resolverEmpresa(SKYBLUE_ID);
    return e || { id: SKYBLUE_ID, nombre: 'SKY BLUE PERU S.A.C.' };
  }
  const e = await resolverEmpresa(ref);
  if (!e) throw new Error('No encontre la empresa "' + ref + '". Usa listar_empresas para ver las disponibles.');
  return e;
}

const ACCIONES = {

  async listar_empresas() {
    const empresas = await leerEmpresas();
    return {
      total: empresas.length,
      empresas: empresas.map(function (e) { return { id: e.id, nombre: e.nombre, ruc: rucPublicoOMascara(e.ruc) }; })
    };
  },

  async buscar_productos(args) {
    const emp = await empresaDe(args);
    const datos = await leerAlmacen();
    const limite = Math.min(Math.max(+args.limite || 50, 1), 200);

    /* Catalogo propio de la empresa */
    const catalogo = leerLista(datos, 'scat', emp.id).map(function (p) {
      return {
        origen: 'catalogo', nombre: p.nombre, unidad: p.unidad,
        precio_min: dinero(p.precio_min), precio_max: dinero(p.precio_max),
        proveedores: p.proveedores, actualizado: p.fecha
      };
    });

    /* Catalogo base heredado y precios historicos de compras (solo SKY BLUE los tiene) */
    let base = [], historicos = [];
    if (emp.id === SKYBLUE_ID) {
      base = (Array.isArray(datos.extra) ? datos.extra : []).map(function (x) {
        return { origen: 'catalogo_base', nombre: x.n, categoria: x.c, proveedor: x.p, precio: dinero(x.v) };
      });
      const vistos = {};
      (Array.isArray(datos.compras) ? datos.compras : []).forEach(function (c) {
        (c.items || []).forEach(function (it) {
          const k = normalizar(it.nombre);
          if (!k || vistos[k]) return;
          vistos[k] = true;
          historicos.push({
            origen: 'compra', nombre: it.nombre, marca: it.marca, modelo: it.modelo,
            procedencia: it.procedencia, precio_compra: dinero(it.precio_compra),
            precio_venta: dinero(it.precio_venta), proveedor: c.proveedor, fecha: c.fecha
          });
        });
      });
    }

    let todo = catalogo.concat(base, historicos);
    if (args.texto) todo = todo.filter(function (p) { return coincide(p, args.texto, ['nombre', 'categoria', 'marca', 'proveedor']); });
    if (args.precio_min != null || args.precio_max != null) {
      todo = todo.filter(function (p) {
        const v = [p.precio, p.precio_min, p.precio_max, p.precio_venta].find(function (x) { return typeof x === 'number'; });
        if (v == null) return false;
        if (args.precio_min != null && v < args.precio_min) return false;
        if (args.precio_max != null && v > args.precio_max) return false;
        return true;
      });
    }
    return { empresa: emp.nombre, total_encontrados: todo.length, mostrando: Math.min(todo.length, limite), productos: todo.slice(0, limite) };
  },

  async buscar_proveedores(args) {
    const emp = await empresaDe(args);
    const datos = await leerAlmacen();
    const limite = Math.min(Math.max(+args.limite || 50, 1), 200);

    let lista = leerLista(datos, 'sprov', emp.id).map(function (p) {
      return {
        nombre: p.nombre, ruc: p.ruc, telefono: p.telefono,
        email: p.email, ubicacion: p.ubicacion, productos: p.productos
      };
    });

    /* Proveedores que aparecen en compras historicas (solo SKY BLUE) */
    if (emp.id === SKYBLUE_ID) {
      const yaEstan = {};
      lista.forEach(function (p) { yaEstan[normalizar(p.nombre)] = true; });
      (Array.isArray(datos.compras) ? datos.compras : []).forEach(function (c) {
        const k = normalizar(c.proveedor);
        if (!k || yaEstan[k]) return;
        yaEstan[k] = true;
        lista.push({ nombre: c.proveedor, origen: 'historial_compras', productos: (c.items || []).map(function (i) { return i.nombre; }) });
      });
    }

    if (args.texto) lista = lista.filter(function (p) { return coincide(p, args.texto, ['nombre', 'ruc', 'ubicacion', 'email']); });
    if (args.producto) {
      const q = normalizar(args.producto);
      lista = lista.filter(function (p) { return normalizar(JSON.stringify(p.productos || '')).indexOf(q) >= 0; });
    }
    return { empresa: emp.nombre, total_encontrados: lista.length, mostrando: Math.min(lista.length, limite), proveedores: lista.slice(0, limite) };
  },

  async buscar_clientes(args) {
    const emp = await empresaDe(args);
    const datos = await leerAlmacen();
    const limite = Math.min(Math.max(+args.limite || 50, 1), 200);

    const crm = datos['crm_' + emp.id] || {};
    let lista = (Array.isArray(crm.contactos) ? crm.contactos : []).map(function (c) {
      return {
        origen: 'crm', nombre: c.nombre, empresa: c.empresa, ruc: c.ruc, cargo: c.cargo,
        email: c.email, telefono: c.cel, etapa: c.etapa, valor_estimado: dinero(c.valorEst),
        fuente: c.origen, ultimo_contacto: c.ultTocado
      };
    });

    /* Clientes que aparecen en cotizaciones (solo SKY BLUE conserva el historial heredado) */
    if (emp.id === SKYBLUE_ID) {
      const yaEstan = {};
      lista.forEach(function (c) { yaEstan[normalizar(c.empresa || c.nombre)] = true; });
      (Array.isArray(datos.hist) ? datos.hist : []).forEach(function (q) {
        const cli = q.cli || {};
        const k = normalizar(cli.n);
        if (!k || yaEstan[k]) return;
        yaEstan[k] = true;
        lista.push({
          origen: 'cotizaciones', nombre: cli.con || cli.n, empresa: cli.n, ruc: cli.ruc,
          email: cli.mail, telefono: cli.tel, direccion: cli.dir
        });
      });
    }

    if (args.texto) lista = lista.filter(function (c) { return coincide(c, args.texto, ['nombre', 'empresa', 'ruc', 'email']); });
    if (args.etapa) lista = lista.filter(function (c) { return normalizar(c.etapa).indexOf(normalizar(args.etapa)) >= 0; });
    return { empresa: emp.nombre, total_encontrados: lista.length, mostrando: Math.min(lista.length, limite), clientes: lista.slice(0, limite) };
  },

  async buscar_cotizaciones(args) {
    const emp = await empresaDe(args);
    const datos = await leerAlmacen();
    const limite = Math.min(Math.max(+args.limite || 30, 1), 100);

    /* El historial de cotizaciones es la clave heredada `hist` (SKY BLUE). */
    let lista = (emp.id === SKYBLUE_ID && Array.isArray(datos.hist)) ? datos.hist.slice() : [];
    const estados = datos['cotstat_' + emp.id] || {};

    lista = lista.map(function (q) {
      const cli = q.cli || {};
      const base = {
        numero: q.num, version: q.ver, fecha: q.fecha,
        cliente: cli.n, cliente_ruc: cli.ruc, contacto: cli.con,
        proyecto: q.proy, moneda: q.mon, incluye_igv: q.igv,
        total: dinero(q.tot), forma_pago: q.pago, entrega: q.entr, validez: q.valid,
        elaborado_por: q.user, estado: estados[q.num] ? (estados[q.num].estado || estados[q.num]) : null,
        cantidad_items: (q.items || []).length
      };
      if (args.incluir_items) {
        base.items = (q.items || []).map(function (i) {
          return { codigo: i.cod, descripcion: i.desc, cantidad: i.qty, precio_unitario: dinero(i.precio), proveedor: i.prov };
        });
      }
      return base;
    });

    if (args.texto) lista = lista.filter(function (q) { return coincide(q, args.texto, ['numero', 'cliente', 'proyecto', 'contacto']); });
    if (args.cliente) lista = lista.filter(function (q) { return normalizar(q.cliente).indexOf(normalizar(args.cliente)) >= 0; });
    if (args.desde || args.hasta) lista = lista.filter(function (q) { return enRango(q.fecha, args.desde, args.hasta); });
    if (args.monto_min != null) lista = lista.filter(function (q) { return (+q.total || 0) >= args.monto_min; });
    if (args.monto_max != null) lista = lista.filter(function (q) { return (+q.total || 0) <= args.monto_max; });

    lista.sort(function (a, b) { const x = aFecha(b.fecha), y = aFecha(a.fecha); return (x ? x.getTime() : 0) - (y ? y.getTime() : 0); });
    const suma = lista.reduce(function (s, q) { return s + (+q.total || 0); }, 0);
    return {
      empresa: emp.nombre, total_encontradas: lista.length, mostrando: Math.min(lista.length, limite),
      monto_total_encontrado: Math.round(suma * 100) / 100, cotizaciones: lista.slice(0, limite)
    };
  },

  async buscar_ventas(args) {
    const emp = await empresaDe(args);
    const datos = await leerAlmacen();
    const limite = Math.min(Math.max(+args.limite || 50, 1), 200);

    /* Facturas registradas en el modulo de facturacion */
    let lista = leerLista(datos, 'fact', emp.id).map(function (f) {
      return {
        origen: 'facturacion', numero: f.num, cliente: f.cliente, cliente_ruc: f.ruc,
        fecha: f.fecha, monto: dinero(f.monto), tipo: f.tipo, estado: f.estado
      };
    });

    /* Comprobantes de VENTA extraidos por IA (contabilidad) */
    leerLista(datos, 'contfact', emp.id)
      .filter(function (c) { return c.cv === 'VENTA'; })
      .forEach(function (c) {
        lista.push({
          origen: 'contabilidad', tipo: c.tipo_doc, numero: c.serie_numero,
          cliente: (c.receptor || {}).razon, cliente_ruc: (c.receptor || {}).ruc,
          fecha: c.fecha_emision, moneda: c.moneda, subtotal: dinero(c.subtotal),
          igv: dinero(c.igv), monto: dinero(c.total), requiere_revision: c.revision
        });
      });

    if (args.texto) lista = lista.filter(function (v) { return coincide(v, args.texto, ['numero', 'cliente', 'tipo']); });
    if (args.cliente) lista = lista.filter(function (v) { return normalizar(v.cliente).indexOf(normalizar(args.cliente)) >= 0; });
    if (args.desde || args.hasta) lista = lista.filter(function (v) { return enRango(v.fecha, args.desde, args.hasta); });
    if (args.monto_min != null) lista = lista.filter(function (v) { return (+v.monto || 0) >= args.monto_min; });
    if (args.monto_max != null) lista = lista.filter(function (v) { return (+v.monto || 0) <= args.monto_max; });

    lista.sort(function (a, b) { const x = aFecha(b.fecha), y = aFecha(a.fecha); return (x ? x.getTime() : 0) - (y ? y.getTime() : 0); });
    const suma = lista.reduce(function (s, v) { return s + (+v.monto || 0); }, 0);
    return {
      empresa: emp.nombre, total_encontradas: lista.length, mostrando: Math.min(lista.length, limite),
      monto_total_encontrado: Math.round(suma * 100) / 100, ventas: lista.slice(0, limite)
    };
  },

  async resumen_ventas(args) {
    const emp = await empresaDe(args);
    const datos = await leerAlmacen();
    const comprobantes = leerLista(datos, 'contfact', emp.id)
      .filter(function (c) { return enRango(c.fecha_emision, args.desde, args.hasta); });

    function agrega(tipo) {
      const arr = comprobantes.filter(function (c) { return c.cv === tipo; });
      const total = arr.reduce(function (s, c) { return s + (+c.total || 0); }, 0);
      const igv = arr.reduce(function (s, c) { return s + (+c.igv || 0); }, 0);
      return { comprobantes: arr.length, monto_total: Math.round(total * 100) / 100, igv_total: Math.round(igv * 100) / 100 };
    }

    /* Principales clientes por monto vendido */
    const porCliente = {};
    comprobantes.filter(function (c) { return c.cv === 'VENTA'; }).forEach(function (c) {
      const n = ((c.receptor || {}).razon) || 'Sin identificar';
      porCliente[n] = (porCliente[n] || 0) + (+c.total || 0);
    });
    const top = Object.entries(porCliente).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 10)
      .map(function (e) { return { cliente: e[0], monto: Math.round(e[1] * 100) / 100 }; });

    const cotizaciones = (emp.id === SKYBLUE_ID && Array.isArray(datos.hist) ? datos.hist : [])
      .filter(function (q) { return enRango(q.fecha, args.desde, args.hasta); });

    return {
      empresa: emp.nombre,
      periodo: { desde: args.desde || 'inicio', hasta: args.hasta || 'hoy' },
      ventas: agrega('VENTA'),
      compras: agrega('COMPRA'),
      cotizaciones_emitidas: {
        cantidad: cotizaciones.length,
        monto_total: Math.round(cotizaciones.reduce(function (s, q) { return s + (+q.tot || 0); }, 0) * 100) / 100
      },
      principales_clientes: top
    };
  }
};

/* ─────────────────────────── Autenticacion ─────────────────────────── */

function tokenEsperado() { return process.env.MCP_TOKEN || ''; }

/* Comparacion en tiempo constante para no filtrar informacion del token. */
function tokensIguales(a, b) {
  const crypto = require('crypto');
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length || x.length === 0) return false;
  return crypto.timingSafeEqual(x, y);
}

function autorizado(req) {
  const esperado = tokenEsperado();
  if (!esperado) return false;                         // sin token configurado: cerrado por defecto
  const h = req.headers['authorization'] || '';
  const recibido = h.indexOf('Bearer ') === 0 ? h.slice(7).trim() : '';
  return tokensIguales(recibido, esperado);
}

/* ─────────────────────────── Protocolo MCP (JSON-RPC 2.0) ─────────────────────────── */

function respuesta(id, result) { return { jsonrpc: '2.0', id: id, result: result }; }
function error(id, code, message) { return { jsonrpc: '2.0', id: id, error: { code: code, message: message } }; }

async function manejarMensaje(msg) {
  const id = msg.id;
  const metodo = msg.method;

  if (metodo === 'initialize') {
    const pedido = (msg.params && msg.params.protocolVersion) || PROTOCOL_VERSION;
    const version = PROTOCOLOS_ACEPTADOS.indexOf(pedido) >= 0 ? pedido : PROTOCOL_VERSION;
    return respuesta(id, {
      protocolVersion: version,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, title: 'SIGMA ERP (solo lectura)', version: SERVER_VERSION },
      instructions: 'Consulta de solo lectura del ERP SIGMA: productos y precios, proveedores, clientes, cotizaciones y ventas de SKY BLUE PERU, MQC CONSTRUCCIONES y DEIKO GROUP. Empieza por listar_empresas si necesitas saber que empresas existen. Este servidor nunca devuelve documentos de identidad, datos bancarios ni credenciales.'
    });
  }

  if (metodo === 'ping') return respuesta(id, {});

  if (metodo === 'tools/list') {
    return respuesta(id, { tools: HERRAMIENTAS });
  }

  if (metodo === 'tools/call') {
    const nombre = msg.params && msg.params.name;
    const args = (msg.params && msg.params.arguments) || {};
    const accion = ACCIONES[nombre];
    if (!accion) return error(id, -32602, 'Herramienta desconocida: ' + nombre);
    try {
      const bruto = await accion(args);
      const limpio = sanitizar(bruto);               // ← ninguna respuesta escapa sin sanear
      return respuesta(id, {
        content: [{ type: 'text', text: JSON.stringify(limpio, null, 2) }],
        structuredContent: limpio
      });
    } catch (e) {
      /* Los errores de la herramienta se devuelven como resultado, no como error de protocolo. */
      return respuesta(id, { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true });
    }
  }

  if (metodo && metodo.indexOf('notifications/') === 0) return null;   // notificaciones: sin respuesta

  return error(id, -32601, 'Metodo no soportado: ' + metodo);
}

/* ─────────────────────────── Transporte HTTP ─────────────────────────── */

router.use(function (req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version, Mcp-Session-Id');
    return res.status(204).end();
  }
  next();
});

/* Estado del servidor: util para comprobar que esta vivo sin exponer nada. */
router.get('/salud', function (req, res) {
  res.json({
    ok: true, servidor: SERVER_NAME, version: SERVER_VERSION,
    protocolo: PROTOCOL_VERSION, herramientas: HERRAMIENTAS.length,
    token_configurado: !!tokenEsperado(), datos_disponibles: !!SB_KEY
  });
});

/* Endpoint principal MCP (Streamable HTTP). */
router.post('/', async function (req, res) {
  if (!autorizado(req)) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="sigma-erp-mcp"');
    return res.status(401).json(error(null, -32001, tokenEsperado()
      ? 'Token invalido o ausente.'
      : 'El servidor MCP no tiene token configurado (falta la variable MCP_TOKEN).'));
  }

  const cuerpo = req.body;
  const lote = Array.isArray(cuerpo);
  const mensajes = lote ? cuerpo : [cuerpo];

  if (!mensajes.length || !mensajes[0] || typeof mensajes[0] !== 'object') {
    return res.status(400).json(error(null, -32700, 'Cuerpo JSON-RPC invalido.'));
  }

  const salidas = [];
  for (const m of mensajes) {
    const r = await manejarMensaje(m);
    if (r) salidas.push(r);
  }

  /* Solo notificaciones: se acepta sin contenido. */
  if (!salidas.length) return res.status(202).end();

  res.setHeader('Content-Type', 'application/json');
  return res.json(lote ? salidas : salidas[0]);
});

/* GET en el endpoint MCP: este servidor no abre flujos de eventos (SSE). */
router.get('/', function (req, res) {
  if (!autorizado(req)) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="sigma-erp-mcp"');
    return res.status(401).json(error(null, -32001, 'Token invalido o ausente.'));
  }
  res.status(405).json(error(null, -32000, 'Este servidor no admite streaming por GET; usa POST.'));
});

router.delete('/', function (req, res) { res.status(204).end(); });   // cierre de sesion: nada que liberar

module.exports = { router: router, HERRAMIENTAS: HERRAMIENTAS, sanitizar: sanitizar, _acciones: ACCIONES };
