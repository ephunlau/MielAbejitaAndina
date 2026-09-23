const { sendWhatsAppMessage } = require("./send-whatsapp-message");
const ORDER_HELP = "Para pedir, escribe cantidad, presentación, distrito y pago en un solo mensaje. Ejemplo: 4, medio kilo, San Borja, Yape. También puedes elegir 1 kilo. Un solo tipo de frasco por mensaje.";

function catalogText(products) {
  return `Tenemos miel de abeja andina en dos presentaciones: 1 kilo a S/ ${products["PR-01"].price.toFixed(2)} y medio kilo (500 g) a S/ ${products["PR-02"].price.toFixed(2)}.`;
}

function normalize(text) {
  return String(text || "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Each order is self-contained: no in-memory session is assumed in Netlify.
function productFor(text, products) {
  const value = normalize(text);
  if (/^(?:1\s*(?:kilo|kg)|un kilo|kilo|pr-01)$/.test(value)) return products["PR-01"];
  if (/^(?:medio kilo|1\/2\s*(?:kilo|kg)?|0[.,]5\s*(?:kilo|kg)|500\s*(?:g|gr|gramos)|pr-02)$/.test(value)) return products["PR-02"];
  return null;
}
function parseOrder(text, products) {
  const parts = String(text || "").trim().replace(/0,5\s*(kg|kilo)/gi, "0.5 $1").split(/[,;\n]+/).map(x => x.trim());
  if (parts.length !== 3 && parts.length !== 4) return null;
  const quantityMatch = normalize(parts[0]).match(/^(?:quiero\s+)?([1-9]\d*)\s*(?:frascos?\s*)?(?:de\s+)?(.*)$/);
  if (!quantityMatch) return null;
  const inline = quantityMatch[2].trim();
  const product = parts.length === 4 ? (inline ? null : productFor(parts[1], products)) : (inline ? productFor(inline, products) : products["PR-01"]);
  if (!product) return null;
  const district = parts[parts.length - 2];
  const payments = { yape: "Yape", transferencia: "transferencia", efectivo: "efectivo" };
  const paymentKey = normalize(parts[parts.length - 1]);
  const payment = Object.hasOwn(payments, paymentKey) ? payments[paymentKey] : null;
  const quantity = Number(quantityMatch[1]);
  if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(quantity * Math.round(product.price * 100)) ||
      !payment || !/[a-z]/.test(normalize(district)) || district.length > 100) return null;
  return { quantity, district, payment, product };
}

function replyFor(text, products) {
  const CATALOG = catalogText(products);
  const value = normalize(text);

  if (/\b(cancelar|salir|baja)\b/.test(value)) {
    return "Entendido. Para comenzar nuevamente, escribe HOLA. Si ya coordinaste un pedido con una persona, confirma la cancelación con ella.";
  }

  if (/\b(hola|buenas|inicio|menu)\b/.test(value)) {
    return `¡Hola! Soy Killa, asesora de Abejita Andina 🐝. ${CATALOG} Escribe PRECIO, BENEFICIOS o PEDIDO.`;
  }
  if (/\b(precio|cuanto|costo|vale|medio|kilo|500|presentaciones?)\b/.test(value)) {
    return `${CATALOG} ${ORDER_HELP}`;
  }
  if (/\b(beneficios?|natural|quimicos?|preservantes?|flores?|origen)\b/.test(value)) {
    return "Abejita Andina es miel de origen andino, recolectada entre flores silvestres de Arequipa y sin químicos ni preservantes añadidos. Para preparar una solicitud, escribe PEDIDO.";
  }
  if (/\b(comprar|pedido|quiero|frascos?)\b/.test(value) || /^\d/.test(value) || /[,;]/.test(value)) {
    return `${CATALOG} ${ORDER_HELP} Aceptamos Yape, transferencia o efectivo.`;
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

async function sheetsRequest(payload) {
  const url = process.env.SHEETS_WEBHOOK_URL;
  const token = process.env.SHEETS_TOKEN;
  if (!url || !token) throw new Error("Faltan SHEETS_WEBHOOK_URL o SHEETS_TOKEN");
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url)) throw new Error("URL de Sheets inválida");
  const response = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, token }), signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Google Sheets respondió HTTP ${response.status}`);
  const data = await response.json();
  if (data.ok !== true) throw new Error("Google Sheets no pudo completar la operación");
  return data;
}

async function loadProducts() {
  const data = await sheetsRequest({ accion: "catalogo", canal: "WhatsApp" });
  const products = {};
  for (const row of data.productos || []) {
    if (!["PR-01", "PR-02"].includes(row.id)) continue;
    const price = Number(row.price);
    if (products[row.id] || !Number.isFinite(price) || price <= 0) throw new Error("Precio inválido en Productos");
    products[row.id] = { id: row.id, label: row.id === "PR-01" ? "1 kilo" : "500 g (medio kilo)", price };
  }
  if (!products["PR-01"] || !products["PR-02"]) throw new Error("Faltan productos PR-01 o PR-02");
  return products;
}

async function saveOrder(message, order, contacts) {
  if (!message.id) throw new Error("Falta el identificador del mensaje de WhatsApp");
  const contact = (contacts || []).find(c => c.wa_id === message.from);
  const saved = await sheetsRequest({
    nombre: contact?.profile?.name || `Cliente WhatsApp ${message.from}`,
    contacto: message.from, cantidad: order.quantity, distrito: order.district,
    medio_pago: order.payment, id_producto: order.product.id,
    canal: "WhatsApp", message_id: message.id,
  });
  if (saved.ok !== true || !saved.id_pedido || saved.version !== "v3-whatsapp") {
    throw new Error("Google Sheets no confirmó el guardado con la versión v3-whatsapp");
  }
  if (saved.id_producto !== order.product.id || !Number.isFinite(Number(saved.monto_total))) {
    throw new Error("Google Sheets no confirmó la presentación del pedido; revisar el puente de Productos");
  }
  return saved;
}

function savedReply(order, saved) {
  return `Tu pedido ${saved.id_pedido} quedó registrado 🐝.\n` +
    `Cantidad: ${order.quantity} frascos de ${order.product.label}\nDistrito: ${order.district}\n` +
    `Forma de pago: ${order.payment}\nSubtotal de productos: S/ ${Number(saved.monto_total).toFixed(2)}\n\n` +
    "El costo de envío y la entrega están pendientes de coordinación. El pago aún debe verificarse. " +
    "Para modificar o cancelar este pedido, comunícate con Abejita Andina e indica su número.";
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
    let products;
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        for (const message of change.value?.messages || []) {
          if (message.type !== "text" || !message.from) continue;
          console.log(`Mensaje de texto recibido; id: ${message.id || "sin id"}`);
          const text = message.text?.body || "";
          if (!products) {
            try { products = await loadProducts(); }
            catch (error) {
              console.error("No se pudo consultar Productos:", error.message);
              await sendWhatsAppMessage(message.from, "No puedo consultar los precios en este momento. Por favor, vuelve a intentarlo más tarde.");
              continue;
            }
          }
          const order = /\b(cancelar|salir|baja)\b/.test(normalize(text)) ? null : parseOrder(text, products);
          if (order) {
            const saved = await saveOrder(message, order, change.value?.contacts);
            await sendWhatsAppMessage(message.from, savedReply(order, saved));
          } else {
            await sendWhatsAppMessage(message.from, replyFor(text, products));
          }
        }
      }
    }
    return { statusCode: 200, body: "EVENT_RECEIVED" };
  } catch (error) {
    console.error("Error procesando webhook:", error.message);
    return { statusCode: 503, body: "RETRY_LATER" };
  }
};

exports.loadProducts = loadProducts;
exports.replyFor = replyFor;
exports.parseOrder = parseOrder;
exports.saveOrder = saveOrder;
