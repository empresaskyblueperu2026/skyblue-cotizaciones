# SKY BLUE PERU — PWA de Cotizaciones

App web progresiva (PWA) para generar cotizaciones profesionales.
Funciona en iPhone, Android, iPad y PC como una app instalable.

---

## INSTALACION RAPIDA (Railway — Gratis)

### Paso 1: Subir a GitHub
1. Crea cuenta en https://github.com (si no tienes)
2. Crea repositorio nuevo llamado "skyblue-cotizaciones"
3. Sube todos estos archivos al repositorio

### Paso 2: Deploy en Railway
1. Ve a https://railway.app
2. "New Project" → "Deploy from GitHub repo"
3. Selecciona tu repo "skyblue-cotizaciones"
4. Railway detecta automaticamente el package.json y despliega

### Paso 3: Agregar API Key
1. En Railway, abre tu proyecto
2. Ve a "Variables"
3. Agrega: ANTHROPIC_API_KEY = tu_api_key_de_anthropic
4. Railway reinicia automaticamente

### Paso 4: Tu URL
Railway te da una URL tipo: https://skyblue-cotizaciones.up.railway.app
Comparte ese link y cualquiera puede abrirlo.

---

## INSTALAR COMO APP EN EL CELULAR

### iPhone/iPad (Safari):
1. Abre la URL en Safari
2. Toca el boton Compartir (cuadrado con flecha arriba)
3. Toca "Agregar a pantalla de inicio"
4. Toca "Agregar"
→ Aparece el icono SKY BLUE en tu pantalla. Abrela como cualquier app.

### Android (Chrome):
1. Abre la URL en Chrome
2. Aparece automaticamente un banner "Instalar SKY BLUE"
3. Toca "Instalar"
→ Se instala y abre en pantalla completa sin barra del navegador.

---

## COMO FUNCIONA OFFLINE

La app guarda todo en localStorage del celular:
- Catalogo de 149+ productos: siempre disponible
- Historial de cotizaciones: siempre disponible
- Crear/editar cotizaciones: siempre disponible
- Imprimir/exportar PDF: siempre disponible

Solo necesita internet para:
- Cargar PDF/imagen de cotizacion del proveedor (usa IA de Claude)

---

## COSTOS

| Servicio  | Costo    | Para que          |
|-----------|----------|-------------------|
| Railway   | GRATIS   | Hosting del servidor |
| GitHub    | GRATIS   | Guardar el codigo |
| Anthropic | ~$5/mes  | API de IA (solo si cargas muchos PDFs) |

---

## SOPORTE

Desarrollado para SKY BLUE PERU S.A.C.
RUC: 20610723501
