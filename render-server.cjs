'use strict';
const http = require('node:http');

// Adapter for the existing Netlify handler. Only the WhatsApp webhook is public.
function createServer(handler) {
  return http.createServer(async (req, res) => {
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
      res.end(body);
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health' && req.method === 'GET') return send(200, 'ok');
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
