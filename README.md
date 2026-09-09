# Killa en Netlify

## Estructura

Sube esta carpeta completa a GitHub o arrástrala como proyecto de Netlify. No muevas los archivos de `netlify/functions`.

## Variables de entorno en Netlify

Configura `VERIFY_TOKEN`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `GRAPH_API_VERSION` y `BUSINESS_PHONE` usando `.env.example` como referencia.

## Webhook en Meta

- URL: `https://TU-SITIO.netlify.app/webhook`
- Token de verificación: el mismo valor de `VERIFY_TOKEN`
- Campo a suscribir: `messages`

## Prueba

Después de verificar el webhook, escribe `HOLA` desde otro teléfono al número `+51 990 467 150`. Killa debe responder con el precio vigente y las opciones disponibles.
