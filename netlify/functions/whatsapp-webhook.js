const { sendWhatsAppMessage } = require("./send-whatsapp-message");

function currentPrice(now = new Date()) {
  const base = new Date("2026-09-01T00:00:00Z");
  const months = (now.getUTCFullYear() - base.getUTCFullYear()) * 12 +
    now.getUTCMonth() - base.getUTCMonth();
  return 40 + Math.max(0, months) * 2;
}

function normalize(text) {
  return String(text || "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Each order is self-contained: no in-memory session is assumed in Netlify.
function parseOrder(text) {
  const parts = String(text || "").trim().split(/[,;\n]+/).map(x => x.trim());
  if (parts.length !== 3) return null;
  const quantityMatch = normalize(parts[0]).match(/^(?:quiero\s+)?([1-9]\d*)\s*(?:frascos?|kilos?|kg)?$/);
  const payments = { yape: "Yape", transferencia: "transferencia", efectivo: "efectivo" };
  const payment = payments[normalize(parts[2])];
  const quantity = quantityMatch ? Number(quantityMatch[1]) : NaN;
  if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(quantity * currentPrice()) ||
      !payment || !/[a-z]/.test(normalize(parts[1])) || parts[1].length > 100) return null;
  return { quantity, district: parts[1], payment };
}

function replyFor(text) {
  const value = normalize(text);
  const price = currentPrice();
  const example = "Escribe los tres datos en un solo mensaje, separados por comas. Por ejemplo: 4, San Borja, Yape.";

  if (/\b(cancelar|salir|baja)\b/.test(value)) {
    return "Entendido. Para comenzar nuevamente, escribe HOLA. Si ya coordinaste un pedido con una persona, confirma la cancelación con ella.";
  }

  const order = parseOrder(text);
  if (order) {
    const subtotal = (order.quantity * price).toFixed(2);
    return `Estos son los datos de tu solicitud 🐝:\n` +
      `• Cantidad: ${order.quantity} ${order.quantity === 1 ? "frasco" : "frascos"} de 1 kilo\n` +
      `• Distrito: ${order.district}\n` +
      `• Forma de pago: ${order.payment}\n` +
      `• Precio por frasco: S/ ${price.toFixed(2)}\n` +
      `• Subtotal de productos: S/ ${subtotal}\n\n` +
      "El costo de envío y la disponibilidad de entrega están pendientes de coordinación. " +
      "Este resumen no registra ni confirma un pedido. Para concretarlo, debes coordinar con una persona de Abejita Andina. " +
      "Si deseas corregir los datos, envía nuevamente cantidad, distrito y forma de pago en un solo mensaje.";
  }

  if (/\b(hola|buenas|inicio|menu)\b/.test(value)) {
    return `¡Hola! Soy Killa, asesora de Abejita Andina 🐝. Tenemos miel pura de la sierra de Arequipa, presentación de 1 kilo, a S/ ${price}. Escribe PRECIO, BENEFICIOS o PEDIDO.`;
  }
  if (/\b(precio|cuanto|costo|vale)\b/.test(value)) {
    return `El frasco de Abejita Andina de 1 kilo cuesta actualmente S/ ${price}. El precio aumenta S/ 2 cada mes. Para preparar tu solicitud, ${example}`;
  }
  if (/\b(beneficios?|natural|quimicos?|preservantes?|flores?|origen)\b/.test(value)) {
    return "Abejita Andina es miel de origen andino, recolectada entre flores silvestres de Arequipa y sin químicos ni preservantes añadidos. Para preparar una solicitud, escribe PEDIDO.";
  }
  if (/\b(comprar|pedido|quiero|frascos?)\b/.test(value) || /^\d/.test(value) || /[,;]/.test(value)) {
    return `El precio vigente es S/ ${price} por frasco de 1 kilo. Necesito cantidad, distrito y forma de pago (Yape, transferencia o efectivo). ${example}`;
  }
  if (/^(si|ok|claro|dale)[.!\s]*$/.test(value)) {
    return "¿Deseas ver los BENEFICIOS o preparar un PEDIDO? Escribe una de esas dos opciones.";
  }
  return "Puedo ayudarte con información, precio o solicitudes de Abejita Andina. Escribe PRECIO, BENEFICIOS o PEDIDO.";
}

function parseBody(event) {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "{}";
  return JSON.parse(raw);
}

exports.handler = async (event) => {
  const verifyToken = process.env.VERIFY_TOKEN || "abejita_andina_2026";
  if (event.httpMethod === "GET") {
    const params = event.queryStringParameters || {};
    if (params["hub.mode"] === "subscribe" && params["hub.verify_token"] === verifyToken) {
      return { statusCode: 200, body: params["hub.challenge"] || "" };
    }
    return { statusCode: 403, body: "Token de verificación inválido" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: { Allow: "GET, POST" }, body: "Método no permitido" };
  }
  try {
    const body = parseBody(event);
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        for (const message of change.value?.messages || []) {
          if (message.type !== "text" || !message.from) continue;
          console.log(`Mensaje de texto recibido; id: ${message.id || "sin id"}`);
          await sendWhatsAppMessage(message.from, replyFor(message.text?.body || ""));
        }
      }
    }
    return { statusCode: 200, body: "EVENT_RECEIVED" };
  } catch (error) {
    console.error("Error procesando webhook:", error.message);
    return { statusCode: 200, body: "EVENT_RECEIVED" };
  }
};

exports.currentPrice = currentPrice;
exports.replyFor = replyFor;
exports.parseOrder = parseOrder;
