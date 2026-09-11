# ARQUITECTURA — SIGMA ERP

> Documento técnico del sistema SIGMA (ERP multi-empresa para contrataciones con el Estado peruano).
> Generado a partir del análisis del código real en producción. Última actualización: **11 de septiembre de 2026**.

---

## 1. Resumen ejecutivo

**SIGMA** es un ERP multi-empresa (multi-tenant) que opera tres empresas peruanas dedicadas a contrataciones con el Estado (SEACE / OSCE, Ley 32069):

| Empresa | RUC | ID interno (tenant) |
|---|---|---|
| SKY BLUE PERU S.A.C. | 20610723501 | `ea38482b-f5a5-4a1b-b167-0d779aecd758` |
| MQC CONSTRUCCIONES GENERALES S.A.C. | 20606666633 | `b3d8aa75-d846-4efa-9a67-e86facd0ebee` |
| DEIKO GROUP S.A.C. | 20605605312 | `9ed760ef-f283-4b20-ae12-2155c9099952` |

Cada empresa mantiene **datos, catálogo, precios y plantillas de documentos totalmente aislados**.

**Características arquitectónicas definitorias:**

- **Sin framework de frontend ni build step.** Todo es JavaScript de navegador (ES5) escrito a mano.
- **Dos archivos contienen prácticamente todo el sistema:** `index.js` (547 KB, backend + app de cotizaciones) y `sigma.html` (493 KB, portal ERP).
- **La base de datos principal NO es relacional**, sino un documento JSON en Supabase Storage (ver §3).
- **La IA es parte del núcleo**, no un añadido: extracción de comprobantes, análisis de TDR, clasificación documental.

---

## 2. Lenguaje, framework y dependencias

### 2.1 Stack

| Capa | Tecnología |
|---|---|
| Lenguaje | JavaScript (Node.js ≥ 18, CommonJS) |
| Framework backend | **Express 4.18** — único framework del proyecto |
| Frontend | HTML + CSS + JavaScript **vanilla ES5**. Sin React/Vue/build/bundler/TypeScript |
| Motor de plantillas | Ninguno: HTML generado por concatenación de strings |
| PWA | `manifest.json` + `sw.js` (Service Worker, estrategia *network-first*) |

### 2.2 Dependencias (`package.json`)

```json
"dependencies": {
  "express":          "^4.18.2",
  "node-forge":       "^1.3.1",
  "xml-crypto":       "^6.0.0",
  "@xmldom/xmldom":   "^0.8.10",
  "adm-zip":          "^0.5.16"
}
```

> ⚠️ **Nota de precisión:** de estas cinco, **solo `express` se usa realmente**. Las otras cuatro
> (`node-forge`, `xml-crypto`, `@xmldom/xmldom`, `adm-zip`) fueron instaladas para la firma digital de
> XML UBL de SUNAT, pero **no aparecen en ningún `require()` del código**. Corresponden al modo de
> emisión `propio`, que sigue en estado beta (§7.3).

### 2.3 Sin dependencias de infraestructura

El proyecto **no usa ORM, ni cliente oficial de Supabase, ni SDK de Google, ni librería de Telegram**.
Toda integración externa se hace con `fetch` nativo contra las APIs REST. Tampoco hay tests, linter ni
migraciones.

### 2.4 Estructura de archivos

```
repo/
├── index.js            547 KB  Servidor Express + APP_HTML (app de cotizaciones embebida en un string)
├── sigma.html          493 KB  Portal ERP (shell + los 20 módulos de negocio)
├── sw.js                       Service Worker de la PWA
├── manifest.json               Manifiesto PWA
├── railway.json                Configuración de despliegue
├── erp_schema.sql              Esquema SQL (parcialmente implementado — ver §3.4)
├── skyblue_data.json           Respaldo local del almacén JSON (ignorado por git)
└── *.png / *.svg               Identidad gráfica por empresa (MQC, DEIKO)
```

> **Particularidad crítica de `index.js`:** la aplicación de cotizaciones vive dentro de una constante
> `APP_HTML`, un string de una sola línea con miles de caracteres. Los saltos de línea van escapados
> como `\n` literales, no reales. Editarlo con herramientas de línea (`sed`, heredocs) corrompe el
> archivo; debe editarse con herramientas que respeten UTF-8 y validarse siempre con `node -c index.js`.

---

## 3. Base de datos

El sistema usa **tres almacenes distintos** con propósitos separados.

### 3.1 Almacén principal — Documento JSON en Supabase Storage

Es la base de datos **real** del sistema, donde vive casi toda la información de negocio.

| Parámetro | Valor |
|---|---|
| Proyecto Supabase | `xlwndbqflbodgszjalzp` |
| URL | `https://xlwndbqflbodgszjalzp.supabase.co` |
| Bucket | `sigma-data` (privado) |
| Objeto | `global.json` |
| Acceso | REST con `SUPABASE_SERVICE_KEY` (rol *service_role*, omite RLS) |

**Convención de claves — así se logra el aislamiento entre empresas:**

```
<módulo>_<empresaId>        →  ej.  oport_ea38482b-f5a5-4a1b-b167-0d779aecd758
```

SKY BLUE conserva además claves heredadas sin sufijo (`hist`, `oc`, `sc`, `compras`, `extra`, `conf`)
por ser la empresa original del sistema; el endpoint `/api/data` las reconoce como suyas.

#### Claves de datos por empresa

| Clave en la nube | Clave en localStorage | Contenido | Tipo |
|---|---|---|---|
| `sproy_<empId>` | `sigma_proy_<empId>` | Proyectos públicos < 8 UIT | array |
| `sprov_<empId>` | `sigma_prov_<empId>` | Proveedores | array |
| `scat_<empId>` | `sigma_cat_<empId>` | Catálogo de productos/servicios | array |
| `ocrec_<empId>` | `sigma_ocrec_<empId>` | Órdenes de compra recibidas | array |
| `cotstat_<empId>` | `sigma_cotstat_<empId>` | Estado/seguimiento de cotizaciones | objeto |
| `fact_<empId>` | `sigma_fact_<empId>` | Facturas emitidas | array |
| `oport_<empId>` | `sigma_oport_<empId>` | Oportunidades SEACE | array |
| `conf_<empId>` | `sigma_conf_<empId>` | Actas de conformidad | array |
| `crm_<empId>` | `sigma_crm_<empId>` | CRM (contactos + tareas) | objeto |
| `logist_<empId>` | `sigma_logist_<empId>` | Logística / entregas | array |
| `exp_<empId>` | `sigma_exp_<empId>` | Experiencia empresarial (IA) | array |
| `contfact_<empId>` | `sigma_contfact_<empId>` | Comprobantes extraídos por IA | array |
| — | `sigma_emp_docs_<empId>` | Bóveda documental de la empresa | array |

> **`contfact_` es la excepción de sincronización:** no se envía en `cloudSyncPush()` y el endpoint
> `/api/data` **descarta activamente** cualquier clave `contfact_*` entrante. Los comprobantes solo se
> escriben por `/api/contfact/guardar`, que aplica deduplicación. Esto evita que una pestaña con datos
> viejos reviva comprobantes borrados.

#### Esquema de las entidades principales (campos reales)

**Cotización** (`hist[]`)
```
num, ver, fecha, cli{n, ruc, con, tel, mail, dir}, proy, mon, pago, entr,
valid, igv, items[{id, cod, desc, qty, precio, compra, prov, _prod}], tot, user
```

**Orden de compra** (`oc`, historial en `ocHist[]`)
```
num, ver, user, fecha, prov{n, ruc, con, tel, mail, dir}, refSC,
items[{id, cod, desc, qty, unit, precio}], mon, igv, pago, entr, lugEntr, obs, aprobPor
```

**Solicitud de cotización** (`sc`, historial en `scHist[]`)
```
num, ver, user, fecha, prov{n, ruc, con, tel, mail, dir},
items[{id, desc, qty, unit, obs}], mon, fechaLim, lugEntr, obs
```

**Comprobante extraído por IA** (`contfact_<empId>[]`) — la entidad más rica del sistema
```
id, tipo_doc, cv, serie_numero, fecha_emision,
emisor{razon, ruc, dir}, receptor{razon, ruc},
moneda, subtotal, igv, percepcion, retencion, tasa, base_imponible,
doc_relacionado, total, items[{desc, cant, unidad, punit, total}],
calidad, confianza, revision, validaciones[], origen, creado,
editado[], editado_manual, aprobado_por, aprobado_en
```
- `tipo_doc`: `FACTURA | BOLETA | NOTA_CREDITO | NOTA_DEBITO | COMPROBANTE_PERCEPCION | COMPROBANTE_RETENCION | RECIBO_HONORARIOS | TICKET | OTRO`
- `cv` (compra/venta): `COMPRA | VENTA | NO_DETERMINADO` — se deduce comparando el RUC de la empresa contra emisor/receptor
- `origen`: `manual | telegram`
- `confianza`: 0-100; por debajo de 90 marca `revision = true`

**Oportunidad SEACE** (`oport_<empId>[]`)
```
id, source, seaceId, nombre, cliente, desc, monto, moneda, estado, fecha, url
```

**Experiencia empresarial** (`exp_<empId>[]`) — 44 campos
```
id, code, company_id, company_name, company_ruc,
client_name, client_ruc, client_type, experience_type,
original_object, normalized_object, short_title, executive_summary, technical_description,
start_date, end_date, date, currency, subtotal, tax, total_amount,
paid_amount, outstanding_amount, payment_percentage,
delivery_location, department, province, district,
primary_category, secondary_categories, documents, items, payments, categories,
validations, evidence, alerts, audit, documentary_status, ai_confidence, payment_status,
created_at, updated_at
```

**Proyecto público** (`sproy_<empId>[]`)
```
id, nombre, entidad, monto, fecha, creado, driveId, driveUrl, driveFolders, stages
```

**CRM** (`crm_<empId>`) — objeto con dos colecciones
```
contactos[{id, nombre, empresa, ruc, cargo, cel, email, etapa, valorEst,
           origen, tgChatId, notas, creado, ultTocado}]
tareas[{id, contacto, titulo, vence, estado, tipo, tgChatId}]
```

**Otras entidades**
```
ocrec_[]  : id, num, cliente, ruc, fecha, monto, proyecto, rubro, estado, items
scat_[]   : id, nombre, unidad, precio_min, precio_max, proveedores, fecha
sprov_[]  : nombre, ruc, telefono, ubicacion, email, productos
fact_[]   : id, num, cliente, ruc, fecha, monto, tipo, estado
compras[] : id, fecha, proveedor, items[{cod, nombre, tipo, marca, modelo,
                                         procedencia, qty, precio_compra, precio_venta}], total_compra
extra[]   : id, p, c, n, v      (catálogo base: proveedor, categoría, nombre, valor)
```

### 3.2 Configuración y secretos — `config.json` en el mismo bucket

Objeto separado del de datos, con la configuración operativa. **Los tokens de bots y las credenciales
SUNAT viven aquí, nunca en el código ni en el repositorio.**

| Clave | Contenido |
|---|---|
| `usuarios[]` | Usuarios del sistema: `{usuario, salt, hash, empresas, nombre, rol, creado}` |
| `usuariosInicial` | Bandera: la contraseña maestra sigue siendo la inicial |
| `tgToken`, `tgChatId` | Bot de alertas generales |
| `ventasBot` | Bot del agente de ventas |
| `contfactBot`, `contfactSecret` | Bot de contabilidad (`@Contabilidadskyblue_bot`) |
| `seaceBot` | Bot de alertas SEACE (`@Buscador8uits_bot`): `{token, chatId, secret, username, nombre}` |
| `sunat` | Credenciales y modo de emisión por empresa |
| `counters` | Correlativos de numeración de documentos |
| `seaceSeen[]` | IDs de procesos SEACE ya notificados |
| `lastAlertDate`, `lastBackupDate`, `lastReporte`, `lastSeaceAM/PM` | Control de ejecución diaria |

Además, el certificado digital `.pfx` de cada empresa se guarda como `cert_<empId>.b64` en el mismo
bucket privado.

### 3.3 Almacén de navegador — `localStorage`

Cada módulo trabaja primero contra `localStorage` (claves `sigma_<módulo>_<empresaId>`) y sincroniza con
la nube mediante `cloudSyncPush()` / `cloudSyncPull()`. Esto da funcionamiento offline, pero implica que
**el navegador es la fuente de verdad durante la sesión**.

### 3.4 PostgreSQL — esquema definido pero **en su mayoría sin usar**

`erp_schema.sql` define 8 tablas en Supabase Postgres con RLS habilitado. Sin embargo, el análisis del
código revela que **solo `empresas` se consulta realmente** (10 llamadas a `sbFetch`); las otras siete
no tienen una sola referencia en el código.

| Tabla | Estado real |
|---|---|
| `empresas` | ✅ **En uso activo** — única fuente de las empresas del sistema |
| `usuarios` | ❌ Sin uso — la autenticación vive en `config.json` (§6) |
| `cotizaciones` | ❌ Sin uso — viven en `hist` (JSON) |
| `proyectos` | ❌ Sin uso — viven en `sproy_<empId>` (JSON) |
| `hitos` | ❌ Sin uso — son `stages` dentro de cada proyecto |
| `facturas` | ❌ Sin uso — viven en `fact_<empId>` (JSON) |
| `documentos` | ❌ Sin uso — se usa Google Drive + Storage |
| `ia_auditoria` | ❌ Sin uso |

**Esquema real de `empresas` (la tabla que sí opera):**

```sql
create table empresas (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null,
  ruc               text,
  direccion         text,
  telefono          text,
  email             text,
  web               text,
  logo_url          text,
  color_primario    text default '#1e40af',
  color_secundario  text default '#3b82f6',
  terminos          text,          -- T&C (solo clientes privados)
  subdominio        text unique,   -- ej: deiko, skyblue
  activo            boolean default true,
  creado_en         timestamptz default now()
);
```

Las demás tablas del SQL (`usuarios`, `cotizaciones`, `proyectos`, `hitos`, `facturas`, `documentos`,
`ia_auditoria`) conservan sus definiciones completas en `erp_schema.sql` y sirven como **hoja de ruta de
migración** si algún día se mueve el almacén JSON a relacional.

---

## 4. Módulos funcionales

El portal (`sigma.html`) organiza 20 módulos en cuatro categorías. Cada uno se renderiza con una función
`render*()` (32 en total).

### Principal
| Módulo | Descripción |
|---|---|
| **Dashboard** | KPIs, gráficos, panel de agentes IA, feed de actividad |
| **Experiencia IA** | Carga múltiple de documentos; la IA los clasifica (15 tipos), extrae ítems, agrupa OC ↔ Factura ↔ Guía de una misma operación en **una sola experiencia**, valida cruzadamente y controla pagos. Incluye compatibilidad con TDR y búsqueda semántica |

### Comercial
| Módulo | Descripción |
|---|---|
| **Oportunidades** | Procesos SEACE ≤ 8 UIT de La Libertad; decisión Participar / Pensando / Descartar |
| **Proyectos Públicos** | Flujo canónico de 8 etapas: Análisis·Viabilidad·Presupuesto → Propuesta → Orden de Compra → Compra a Proveedores → Entrega → Conformidad → Facturación → Pago |
| **Cotizaciones** | Generación de cotizaciones con plantilla propia por empresa |
| **Conformidad** | Actas de conformidad; ingreso ítem por ítem o por texto libre con extracción IA, detección de IGV y validación de totales |
| **Seguim. Ventas** | Estado comercial de cada cotización |
| **OC Recibidas** | Órdenes de compra que emiten los clientes |
| **Solicitud Cotiz.** | Solicitudes a proveedores |
| **OC a Proveedores** | Órdenes de compra emitidas |
| **CRM Clientes** | Contactos, etapas, valor estimado y tareas con recordatorios automáticos |
| **Proveedores** | Base de proveedores con sus productos y precios |
| **Productos** | Catálogo con rangos de precio y proveedores asociados |
| **Trazabilidad** | Seguimiento transversal de documentos |
| **Catálogo** | Catálogo base compartido |

### Operaciones
| Módulo | Descripción |
|---|---|
| **Logística** | Entregas y despachos |
| **Facturación** | Facturas emitidas e integración SUNAT |
| **Cobranza** | Control de cuentas por cobrar |

### Gestión
| Módulo | Descripción |
|---|---|
| **Contabilidad** | Incluye el submódulo **Extracción IA**: recibe fotos/PDF por Telegram o carga manual, clasifica el comprobante y si es compra o venta, extrae todos los campos (IGV, percepciones, retenciones, detalle de ítems), valida duplicados y consistencia de totales, asigna un % de confianza y marca para revisión humana por debajo de 90 %. Incluye un modal de revisión **totalmente editable** con auditoría de cambios |
| **Bóveda de Empresa** | Documentos permanentes de la empresa |
| **Historial** | Historial de documentos emitidos |
| **Reportes** | Reportes consolidados |
| **Configuración** | Ajustes, bots, SUNAT y **gestión de usuarios** (solo rol maestro) |

---

## 5. Despliegue en la nube

```
┌──────────────────┐   git push origin main   ┌──────────────────┐
│  GitHub          │ ───────────────────────► │  Railway         │
│  empresaskyblue  │      (auto-deploy)       │  node index.js   │
│  peru2026/       │                          │  healthcheck     │
│  skyblue-        │                          │  /health         │
│  cotizaciones    │                          └────────┬─────────┘
└──────────────────┘                                   │
                                                       │ REST + fetch
                        ┌──────────────────────────────┼───────────────────────────┐
                        ▼                              ▼                           ▼
              ┌──────────────────┐        ┌─────────────────────┐      ┌──────────────────┐
              │ Supabase         │        │  Google Drive API   │      │  APIs externas   │
              │ • Storage        │        │  (Service Account)  │      │  • Gemini 2.5    │
              │   sigma-data:    │        │  carpetas por       │      │  • Claude Sonnet │
              │   global.json    │        │  proyecto           │      │  • SEACE         │
              │   config.json    │        └─────────────────────┘      │  • SUNAT / SIRE  │
              │   cert_<emp>.b64 │                                     │  • Telegram (x3) │
              │ • Postgres       │                                     └──────────────────┘
              │   (solo empresas)│
              └──────────────────┘
```

### 5.1 Hosting

| Parámetro | Valor |
|---|---|
| Plataforma | **Railway** (auto-deploy desde GitHub `main`) |
| URL producción | `https://skyblue-cotizaciones-production.up.railway.app` |
| Arranque | `node index.js` |
| Healthcheck | `GET /health`, timeout 30 s |
| Política de reinicio | `ON_FAILURE` |
| Puerto | `process.env.PORT` (por defecto 3000), escucha en `0.0.0.0` |

### 5.2 Variables de entorno

| Variable | Uso |
|---|---|
| `SUPABASE_URL` | URL del proyecto (tiene valor por defecto en código) |
| `SUPABASE_SERVICE_KEY` | Clave *service_role* — **secreta**, solo en Railway |
| `GEMINI_API_KEY` | Google Gemini 2.5 Flash |
| `ANTHROPIC_API_KEY` | Claude Sonnet 4.5 (respaldo de Gemini) |
| `TELEGRAM_BOT_TOKEN` | Token por defecto del bot de alertas |
| `GOOGLE_SA_KEY` | Credenciales JSON de la Service Account de Drive |
| `DRIVE_ROOT_FOLDER_ID` | Carpeta raíz en Drive |
| `AUTH_SECRET` | Firma HMAC de los tokens de sesión |
| `PROD_URL` | URL pública (para registrar webhooks) |
| `PORT` | Puerto asignado por Railway |

### 5.3 Modo espejo local (`proxyCloud`)

Cuando el servidor corre sin `SUPABASE_SERVICE_KEY` (típicamente en la PC del desarrollador),
`sbReady()` devuelve `false` y **cada endpoint reenvía la petición a producción** mediante
`proxyCloud(req, res)`.

> ⚠️ **Consecuencia operativa importante:** una prueba ejecutada en `localhost` **escribe en los datos
> reales de producción**. Además, un endpoint recién creado en local devolverá 404 hasta que se despliegue,
> porque el proxy lo busca en el servidor remoto.

### 5.4 Tareas programadas

Un único `setInterval` cada 30 minutos actúa como planificador (solo si hay conexión a Supabase). Las
horas se evalúan en UTC; Perú es UTC−5:

| Hora Perú | UTC | Tarea |
|---|---|---|
| continuo | — | `runCrmRecordatorios()` — seguimientos CRM |
| 08:00 | 13 | `runAlertas()` + `runSeaceDigest('AM')` |
| 10:00 | 15 | `runRetencion('postventa')`; día 1 de mes → `remarketing`; lunes → `rescate` |
| 18:00 | 23 | `runBackup()` — respaldo del almacén |
| 20:00 | 01 | `runSeaceDigest('PM')` |
| 21:00 | 02 | `runReporteDiario()` |

### 5.5 Bots de Telegram

| Bot | Config | Propósito |
|---|---|---|
| Alertas generales | `cfg.tgToken` / `cfg.tgChatId` | Vencimientos, reporte diario, respaldos, recordatorios CRM |
| Agente de ventas | `cfg.ventasBot` | Atención comercial |
| `@Contabilidadskyblue_bot` | `cfg.contfactBot` | Recepción de comprobantes para extracción IA |
| `@Buscador8uits_bot` | `cfg.seaceBot` | Digest SEACE: 50 procesos activos de La Libertad, 2 veces al día |

Cada bot registra su webhook con un `secret_token` propio que se valida en la cabecera
`x-telegram-bot-api-secret-token`.

---

## 6. Autenticación y control de acceso

| Aspecto | Implementación |
|---|---|
| Almacén | `cfg.usuarios[]` en `config.json` (Supabase Storage) |
| Contraseñas | `crypto.scryptSync(clave, salt, 32)` con salt aleatorio de 16 bytes — **nunca en texto plano** |
| Comparación | `crypto.timingSafeEqual()` (resistente a ataques de temporización) |
| Sesión | Token firmado HMAC-SHA256 con `AUTH_SECRET`, vencimiento **12 horas** |
| Transporte | Cabecera `Authorization: Bearer <token>`; el cliente lo guarda en `localStorage.sigma_token` |
| Roles | `master` (todas las empresas) · `empresa` (solo las asignadas) |

**Usuarios en producción:** `master` (acceso total) y `skyblue`, `deiko`, `mqc` (una empresa cada uno).

`GET /api/empresas` **filtra del lado del servidor** según el token, por lo que un usuario de empresa no
puede cambiar a otra compañía desde el selector del cotizador.

> ⚠️ **Límite conocido y deliberado:** los endpoints de datos (`/api/data`, `/api/contfact/*`, etc.) **no
> exigen token todavía**. Quien conozca las URLs puede consultarlos directamente. El login protege el
> acceso a la interfaz y el listado de empresas, no cada lectura de datos. Endurecer esto requiere cuidado
> para no romper los webhooks de los bots ni las tareas programadas.

---

## 7. APIs y endpoints

**82 rutas** en total (48 `GET`, 34 `POST`).

### 7.1 Autenticación — `/api/auth` (5)
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/login` | Valida credenciales, devuelve token + empresas permitidas |
| POST | `/api/auth/sesion` | Restaura sesión desde un token existente |
| POST | `/api/auth/clave` | Cambio de contraseña propia |
| GET | `/api/auth/usuarios` | Lista usuarios — **solo rol master** |
| POST | `/api/auth/usuarios` | Crear / editar / eliminar usuario — **solo rol master** |

### 7.2 Datos y configuración (8)
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/data` | Lee el almacén; `?emp=<id>` selecciona la partición de la empresa |
| POST | `/api/data` | Escribe el almacén (descarta claves `contfact_*`) |
| GET/POST | `/api/config` | Configuración general |
| GET | `/api/empresas` | Empresas **filtradas por el token de sesión** |
| POST | `/api/empresas` | Alta/actualización de empresa |
| GET | `/api/empresas/seed` | Completa datos faltantes de las empresas |
| GET | `/api/diag` | Diagnóstico (API key, versión de Node, puerto) |
| GET | `/health` | Healthcheck de Railway |

### 7.3 SUNAT y facturación electrónica — `/api/sunat` (9) + `/api/pdf` (3)
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/sunat/test` | Prueba de credenciales |
| GET | `/api/sunat/validar` | Validación de comprobantes |
| GET | `/api/sunat/sire/propuesta` | Propuesta SIRE (registro de compras/ventas) |
| GET | `/api/sunat/sire/rango` | Consulta por rango de periodos |
| GET | `/api/sunat/sire/tickets` | Estado de tickets SIRE |
| GET | `/api/sunat/sire/archivo` | Descarga de archivos SIRE |
| POST | `/api/sunat/emitir` | Emisión de comprobantes |
| POST | `/api/sunat/cert` | Carga del certificado digital `.pfx` |
| GET | `/api/sunat/cert/status` | Estado del certificado |
| POST | `/api/pdf/comprobantes` | PDF de comprobantes |
| POST | `/api/pdf/validacion` | PDF de validación |
| POST | `/api/pdf/sire` | PDF de reportes SIRE |

**Autenticación SUNAT:** OAuth2 *password grant* contra `https://api-cpe.sunat.gob.pe` usando
`clientId`, `clientSecret`, `ruc`, `usuario` y `clave` del Menú SOL.

**Tres modos de emisión** (`cfg.sunat.<empresa>.modo`):
- `see_sol` — preparación en SIGMA, emisión manual en el portal SUNAT ✅
- `ose` — emisión por API vía proveedor OSE/PSE ⚠️ requiere configurar el proveedor
- `propio` — firma UBL propia 🚧 **en beta**: el certificado se guarda, pero falta homologar el endpoint de envío

> El estado actual real es: **consulta SIRE operativa; emisión automática aún no activa**.

### 7.4 Contabilidad — Extracción IA — `/api/contfact` (8)
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/contfact/extraer` | Extrae datos del comprobante (Gemini → Claude de respaldo) |
| POST | `/api/contfact/guardar` | Guarda con deduplicación (único punto de escritura) |
| GET | `/api/contfact/lista` | Lista los comprobantes de la empresa |
| POST | `/api/contfact/actualizar` | Corrección manual con auditoría de cambios |
| POST | `/api/contfact/borrar` | Elimina un comprobante |
| POST | `/api/contfact/reparar` | Normaliza tipos y elimina duplicados existentes |
| POST | `/api/contfact/activar` | Activa el bot dedicado (registra webhook) |
| POST | `/api/contfact/webhook` | Recibe fotos/PDF desde Telegram |

**Deduplicación:** compara por número normalizado, RUC, monto, fecha y una huella de ítems
(`DESCRIPCIÓN:céntimos` ordenada). Motivos posibles: `numero+RUC`, `numero+monto`, `RUC+fecha+monto`,
`RUC+monto+items`.

### 7.5 SEACE y oportunidades — `/api/seace` (4)
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/seace` | 50 procesos activos de La Libertad |
| GET | `/api/seace/notify` | Fuerza el envío del digest (`?slot=AM|PM`) |
| POST | `/api/seace/bot/activar` | Conecta el bot dedicado |
| POST | `/api/seace/bot/webhook` | Webhook del bot SEACE |

**Fuente:** `https://prod6.seace.gob.pe/v1/s8uit-services/buscadorpublico/contrataciones/buscador`
con `estado=2` (Vigente) y `codigo_departamento=13` (La Libertad). Se solicitan 90 registros, se
descartan los vencidos y se recortan a 50. Cada proceso se clasifica en *puede participar ahora*,
*últimas horas*, *cierra mañana* o *aún no abre*.

### 7.6 Inteligencia artificial (3)
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/gemini` | Gemini 2.5 Flash — motor principal (OCR nativo, `thinkingBudget:0`, reintento ante 429) |
| POST | `/api/claude` | Claude Sonnet 4.5 — respaldo ante cuota agotada (soporta PDF) |
| GET/POST | `/api/aprendizaje` | Memoria de aprendizaje del sistema |

### 7.7 Automatizaciones y bots (10)
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/alertas/run` · `/api/alertas/list` | Alertas de vencimientos |
| GET | `/api/reporte/run` | Reporte diario |
| GET | `/api/backup/run` | Respaldo del almacén |
| GET | `/api/retencion/run` | Agente de retención (postventa / remarketing / rescate) |
| GET | `/api/crm/recordatorios` | Recordatorios de tareas CRM |
| POST | `/api/telegram/config` · GET `/api/telegram/test` | Bot de alertas |
| POST | `/api/ventasbot/webhook` · `/config` · `/simular` · GET `/estado` | Agente de ventas |

### 7.8 Documentos y archivos (10)
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/drive/proyecto` | Crea la estructura de carpetas del proyecto |
| POST | `/api/drive/upload` · `/api/drive/rename` · GET `/api/drive/status` | Gestión en Drive |
| POST | `/api/exp/upload` · GET `/api/exp/file` | Archivos del módulo Experiencia (Storage privado) |
| GET | `/api/cotizaciones/export/:num` | Exporta una cotización |
| GET | `/api/ruc/:numero` | Consulta de RUC |
| GET/POST | `/api/numero/peek` · `/next` · `/set` | Correlativos de documentos |

### 7.9 Páginas y estáticos (18)
`/` (portal SIGMA), `/cotizador` y catch-all `*` (app de cotizaciones), `sw.js`, `manifest.json`,
iconos y la identidad gráfica de cada empresa (`mqc-logo.png`, `deiko-header.png`, `deiko-firma.png`, …).

---

## 8. Generación de documentos

Cada empresa tiene su **kit de plantillas propio**, no un tema compartido:

| Empresa | Identidad |
|---|---|
| SKY BLUE | Azul institucional `#0d3b6e` |
| MQC | Kit `MQ{}`: negro `#1a1a1a`, cobre `#b3652f`, acero `#6c6e71` — funciones `mqcWrap`, `buildPDFMQC`, `mqcDocSC`, `mqcDocOC`, `mqcConfHTML` |
| DEIKO | Kit `DK{}`: navy `#00287d`, charcoal `#303030` — funciones `deikoBand`, `deikoFooter`, `buildPDFDEIKO`, `deikoDocSC`, `deikoDocOC`, `deikoConfHTML` |

Los documentos se componen en HTML y se imprimen a PDF desde el navegador. **Todos se enmarcan en A4
exacto** (`width:210mm; min-height:297mm; @page{margin:0; size:A4 portrait}`), con escalado automático en
pantallas pequeñas mediante `fitA4()` (transformación CSS que preserva el tamaño real al imprimir).

---

## 9. Observaciones para quien retome el proyecto

1. **El SQL no refleja la realidad.** Siete de las ocho tablas están sin usar; la información vive en
   `global.json`. Cualquier consulta directa a Postgres devolverá tablas vacías.
2. **Probar en local escribe en producción** (§5.3). Antes de cualquier prueba, considerar que
   `proxyCloud` reenvía las escrituras al servidor real.
3. **`APP_HTML` es frágil.** Es un string de una sola línea; insertar un `\n` real lo rompe. Validar
   siempre con `node -c index.js` antes de desplegar.
4. **`sigma.html` contiene acentos y emojis.** Fue corrompido una vez a mojibake CP1252; debe editarse
   con herramientas UTF-8, nunca con utilidades de línea que dependan del locale de Windows.
5. **Procesos Node huérfanos en Windows** pueden servir código viejo y producir 404 engañosos en rutas
   nuevas. Terminarlos antes de cada prueba local.
6. **El Service Worker y las pestañas abiertas** conservan el JavaScript anterior tras un despliegue;
   para verificar cambios hay que recargar o usar una URL con query distinto.
7. **Los secretos nunca se escriben en el repositorio.** Tokens de bots y credenciales SUNAT solo en
   `config.json` (Supabase) o en variables de entorno de Railway.

---

*Documento generado por análisis directo del código fuente en producción.*
