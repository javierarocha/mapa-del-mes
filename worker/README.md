# Backend de análisis (Cloudflare Worker)

La página en GitHub Pages es estática. Este Worker guarda la clave de la API de Claude y hace el análisis de los documentos.

## Qué necesitas

1. Una clave de API en https://console.anthropic.com (Settings → API keys). Es independiente de la suscripción de claude.ai y se cobra por uso: un análisis de una cartola de varias páginas cuesta unos centavos de dólar.
2. Una cuenta gratuita en https://dash.cloudflare.com.

## Desplegar sin instalar nada

1. En Cloudflare: Workers & Pages → Create → Create Worker → nombre `mapa-del-mes-api` → Deploy.
2. Edit code → borra el contenido y pega `worker.js` → Deploy.
3. Settings → Variables and Secrets:
   - `ANTHROPIC_API_KEY` (tipo Secret): tu clave.
   - `ACCESS_CODE` (tipo Secret): un código corto que le darás a quien use la página, p. ej. `casa-2026`.
   - `ALLOWED_ORIGIN` (tipo Text): `https://TU-USUARIO.github.io`.
4. Copia la URL del Worker (algo como `https://mapa-del-mes-api.TU-CUENTA.workers.dev`).

## Conectar la página

En `index.html` busca `const BACKEND_URL = ''` y pon la URL del Worker. Sube el cambio a GitHub. La primera vez que alguien arrastre un archivo, la página pide el código de acceso y lo recuerda en ese navegador.

## Privacidad

Los documentos viajan del navegador al Worker y de ahí a la API de Anthropic para el análisis. No se guardan en el Worker ni en GitHub. Los datos de la hoja quedan solo en el navegador de quien la usa.
