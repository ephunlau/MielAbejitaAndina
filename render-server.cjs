'use strict';
const http = require('node:http');
const crypto = require('node:crypto');

function timingSafeTokenMatches(header, expected) {
  const supplied = String(header || '').replace(/^Bearer\s+/i, '');
  if (!expected) return false;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (suppliedBytes.length !== expectedBytes.length) return false;
  return crypto.timingSafeEqual(suppliedBytes, expectedBytes);
}

async function dailyHealthCheck() {
  const scriptUrl = process.env.SHEETS_WEBHOOK_URL;
  const sheetsToken = process.env.SHEETS_TOKEN;
  if (!scriptUrl || !sheetsToken) throw new Error('sheets_config');
  const sheetsResponse = await fetch(scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'killa_health', token: sheetsToken }),
    signal: AbortSignal.timeout(20000),
  });
  if (!sheetsResponse.ok) throw new Error('sheets_http_' + sheetsResponse.status);
  const sheetsResult = await sheetsResponse.json().catch(() => null);
  if (!sheetsResult?.ok) throw new Error('sheets_unhealthy');

  const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      store: false,
      max_output_tokens: 16,
      input: 'Responde únicamente OK.',
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!openAiResponse.ok) {
  const detail = await openAiResponse.text();
  console.error(
    '[daily-health] OpenAI HTTP ' +
      openAiResponse.status +
      ': ' +
      detail.slice(0, 1000)
  );
  throw new Error('openai_http_' + openAiResponse.status);
}
  const openAiResult = await openAiResponse.json().catch(() => null);
  if (openAiResult?.status !== 'completed') throw new Error('openai_incomplete');

  const version = process.env.GRAPH_API_VERSION || 'v23.0';
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const whatsAppToken = process.env.WHATSAPP_TOKEN;
  const recipient = String(process.env.HEALTH_CHECK_TO || '51990467150').replace(/\D/g, '');
  const templateName = process.env.HEALTH_CHECK_TEMPLATE_NAME || 'killa_daily_health';
  if (!phoneId || !whatsAppToken || !/^\d{8,15}$/.test(recipient)) throw new Error('whatsapp_config');
  const whatsAppResponse = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + whatsAppToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'template',
      template: { name: templateName, language: { code: 'es' } },
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!whatsAppResponse.ok) {
    const errorPayload = await whatsAppResponse.json().catch(() => ({}));
    const code = String(errorPayload.error?.code || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
    throw new Error('whatsapp_http_' + whatsAppResponse.status + '_' + code);
  }
  const whatsAppResult = await whatsAppResponse.json().catch(() => null);
  if (!whatsAppResult?.messages?.[0]?.id) throw new Error('whatsapp_invalid_response');
  return true;
}

// Adapter for the existing Netlify handler. Only the WhatsApp webhook is public.
function createServer(handler) {
  return http.createServer(async (req, res) => {
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
      res.end(body);
    };
    const sendJson = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health' && req.method === 'GET') return send(200, 'ok');
      if (url.pathname === '/daily-health-check') {
        if (req.method !== 'POST') return send(405, 'Method not allowed', { Allow: 'POST' });
     console.info('[daily-health] request received');
      if (!timingSafeTokenMatches(req.headers.authorization, process.env.DAILY_HEALTH_TOKEN)) {
        console.warn('[daily-health] rejected: invalid token');
        return send(403, 'Forbidden');
        }
        let requestBytes = 0;
        for await (const chunk of req) {
          requestBytes += chunk.length;
          if (requestBytes > 1024) return send(413, 'Payload too large');
        }
        try {
          await dailyHealthCheck();
          console.info('[daily-health] dependencies healthy; WhatsApp template accepted');
          return sendJson(200, { ok: true });
        } catch (error) {
          console.error('[daily-health] check failed:', error.message);
          return sendJson(503, { ok: false, code: 'health_check_failed' });
        }
      }
      if (!['/webhook', '/.netlify/functions/whatsapp-webhook'].includes(url.pathname)) return send(404, 'Not found');
      if (!['GET', 'POST'].includes(req.method)) return send(405, 'Method not allowed', { Allow: 'GET, POST' });
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) return send(413, 'Payload too large');
        chunks.push(chunk);
      }
      const result = await handler({
        httpMethod: req.method,
        path: url.pathname,
        headers: req.headers,
        queryStringParameters: Object.fromEntries(url.searchParams),
        // Preserve the exact bytes for Meta signature verification.
        body: Buffer.concat(chunks).toString('base64'),
        isBase64Encoded: true,
      });
      send(result.statusCode || 200,
        result.isBase64Encoded ? Buffer.from(result.body || '', 'base64') : result.body || '', result.headers || {});
    } catch (error) {
      console.error('Webhook request failed:', error.name);
      if (!res.headersSent) send(503, 'RETRY_LATER');
      else res.end();
    }
  });
}

if (require.main === module) {
  const required = ['VERIFY_TOKEN', 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID', 'SHEETS_WEBHOOK_URL', 'SHEETS_TOKEN', 'OPENAI_API_KEY'];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) throw new Error('Faltan variables: ' + missing.join(', '));
  const { handler } = require('./netlify/functions/whatsapp-webhook.js');
  const server = createServer(handler);
  const port = Number(process.env.PORT || 10000);
  server.listen(port, '0.0.0.0', () => console.log('Killa listening on port ' + port));
  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 25000).unref();
  });
}
module.exports = { createServer };
