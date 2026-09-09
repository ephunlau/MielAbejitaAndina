const { sendWhatsAppMessage } = require("./send-whatsapp-message");

function currentPrice(now = new Date()) {
  const base = new Date("2026-09-01T00:00:00Z");
  const months =
    (now.getUTCFullYear() - base.getUTCFullYear()) * 12 +
    now.getUTCMonth() - base.getUTCMonth();
  return 40 + Math.max(0, months) * 2;
}

function replyFor(text) {
  const value = String(text || "").trim().toLowerCase();
  const price = currentPrice();

  if (/\b(hola|buenas|inicio|menú|menu)\b/.test(value)) {
    return `¡Hola! Soy Killa, asesora de Abejita Andina 🐝. Tenemos miel pura de la sierra de Arequipa, presentación de 1 kilo, a S/ ${price}. ¿Deseas conocer sus beneficios o realizar un pedido?`;
  }
  if (/\b(precio|cuánto|cuanto|costo|vale)\b/.test(value)) {
    return `El frasco de Abejita Andina de 1 kilo cuesta actualmente S/ ${price}. El precio aumenta S/ 2 cada mes. ¿Cuántos frascos deseas?`;
  }
  if (/\b(beneficio|natural|químico|quimico|preservante|flor|origen)\b/.test(value)) {
    return "Abejita Andina es miel de origen andino, recolectada entre flores silvestres de Arequipa y sin químicos ni preservantes añadidos. ¿Deseas realizar un pedido?";
  }
  if (/\b(comprar|pedido|quiero|frascos?)\b/.test(value)) {
    return `¡Perfecto! El precio vigente es S/ ${price} por frasco de 1 kilo. Indícame: cantidad, distrito y forma de pago (Yape, transferencia o efectivo).`;
  }
  if (/\b(cancelar|salir|baja)\b/.test(value)) {
    return "Entendido. No continuaré con el pedido. Cuando desees comenzar nuevamente, escribe HOLA.";
  }
  return "Puedo ayudarte con información, precio o pedidos de Abejita Andina. Escribe PRECIO, BENEFICIOS o PEDIDO.";
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
    if (
      params["hub.mode"] === "subscribe" &&
      params["hub.verify_token"] === verifyToken
    ) {
      return { statusCode: 200, body: params["hub.challenge"] || "" };
    }
    return { statusCode: 403, body: "Token de verificación inválido" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: { Allow: "GET, POST" }, body: "Método no permitido" };
  }

  try {
    const body = parseBody(event);
    const value = body.entry?.[0]?.changes?.[0]?.value;
    const messages = value?.messages || [];

    for (const message of messages) {
      if (message.type !== "text" || !message.from) continue;
      const incomingText = message.text?.body || "";
      console.log(`Mensaje recibido de ${message.from}: ${incomingText}`);
      await sendWhatsAppMessage(message.from, replyFor(incomingText));
    }

    return { statusCode: 200, body: "EVENT_RECEIVED" };
  } catch (error) {
    console.error("Error procesando webhook:", error.message);
    return { statusCode: 200, body: "EVENT_RECEIVED" };
  }
};

exports.currentPrice = currentPrice;
exports.replyFor = replyFor;
