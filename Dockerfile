# Imagen del ERP SIGMA.
# Incluye Chromium porque el bot de consulta SUNAT necesita un navegador sin pantalla.
FROM node:18-slim

# Chromium y las librerias que necesita para arrancar sin entorno grafico.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates fonts-liberation \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Puppeteer usa el Chromium del sistema: no descarga su propia copia.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

# Primero las dependencias, para aprovechar la cache entre despliegues.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

EXPOSE 8080
CMD ["node", "index.js"]
