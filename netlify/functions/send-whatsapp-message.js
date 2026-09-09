function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

async function sendWhatsAppMessage(to, message) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const graphVersion = process.env.GRAPH_API_VERSION || "v23.0";
  const destination = normalizePhone(to);

  if (!token || !phoneId) {
    throw new Error("Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_ID en Netlify");
  }
  if (!destination || !message) {
    throw new Error("El destinatario y el mensaje son obligatorios");
  }

  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${phoneId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: destination,
        type: "text",
        text: { preview_url: false, body: String(message).slice(0, 4096) },
      }),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Meta respondió ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: { Allow: "POST" }, body: "Método no permitido" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const data = await sendWhatsAppMessage(body.to, body.message);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, data }),
    };
  } catch (error) {
    console.error("Error enviando mensaje:", error.message);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: error.message }),
    };
  }
};

exports.sendWhatsAppMessage = sendWhatsAppMessage;
