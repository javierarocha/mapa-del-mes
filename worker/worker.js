// Mapa del mes — backend de análisis de documentos.
// Un Cloudflare Worker que recibe PDF/Excel/CSV desde la página estática,
// los envía a la API de Claude y devuelve el presupuesto estructurado.
//
// Secretos (Workers → Settings → Variables):
//   ANTHROPIC_API_KEY  clave de https://console.anthropic.com
//   ACCESS_CODE        código corto que la página pide una vez (evita que cualquiera use tu clave)
// Variable:
//   ALLOWED_ORIGIN     origen del sitio, p. ej. https://USUARIO.github.io
//
// Llamada HTTP cruda a la API (sin SDK) porque el Worker se despliega como un único archivo.

const MODEL = "claude-opus-5-5";
const MAX_FILES = 6;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

const SCHEMA = {
  type: "object",
  properties: {
    in: { type: "array", items: row() },
    varin: { type: "array", items: row() },
    fix: { type: "array", items: row() },
    debt: {
      type: "array",
      items: {
        type: "object",
        properties: { n: { type: "string" }, a: { type: "integer" }, s: { type: "integer" } },
        required: ["n", "a", "s"],
        additionalProperties: false,
      },
    },
    var: { type: "array", items: row() },
    resumen: { type: "string" },
  },
  required: ["in", "varin", "fix", "debt", "var", "resumen"],
  additionalProperties: false,
};
function row() {
  return {
    type: "object",
    properties: { n: { type: "string" }, a: { type: "integer" } },
    required: ["n", "a"],
    additionalProperties: false,
  };
}

const INSTRUCTIONS = `Estos son documentos financieros personales de Chile (cartolas bancarias, estados de cuenta de tarjetas, planillas). Construye con ellos un presupuesto MENSUAL en pesos chilenos, montos enteros sin signo.

- "in": ingresos fijos mensuales (sueldo líquido, pensión de alimentos, arriendos que recibe).
- "varin": ingresos irregulares (freelance, honorarios, ventas, devoluciones). "a" es el total estimado en 12 meses; si los documentos cubren menos, extrapola proporcionalmente.
- "fix": gastos fijos mensuales (arriendo, dividendo, colegio, cuentas básicas, seguros, suscripciones, plan de teléfono).
- "debt": créditos, tarjetas y préstamos. "a" es la cuota mensual; "s" el saldo total pendiente si aparece, si no 0. Cada tarjeta o crédito por separado.
- "var": gastos variables mensuales promediados (supermercado, transporte, farmacia, salidas, otros).
- "resumen": una o dos frases en español sobre qué período cubren los documentos y qué asumiste.

Agrupa compras pequeñas del mismo tipo en un solo ítem. Si algo aparece en varios archivos, no lo dupliques. Nombres cortos y claros. Máximo 12 ítems por lista; lista vacía si no hay datos.`;

function cors(origin, env) {
  const allowed = env.ALLOWED_ORIGIN || "";
  const ok = !allowed || origin === allowed || origin === "http://localhost:8771";
  return {
    ok,
    headers: {
      "Access-Control-Allow-Origin": ok ? origin || "*" : "null",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Access-Code",
      "Access-Control-Max-Age": "86400",
    },
  };
}

const json = (obj, status, headers) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...headers } });

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const c = cors(origin, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: c.headers });
    if (request.method !== "POST") return json({ error: "method" }, 405, c.headers);
    if (!c.ok) return json({ error: "origin" }, 403, c.headers);
    if (env.ACCESS_CODE && request.headers.get("X-Access-Code") !== env.ACCESS_CODE)
      return json({ error: "code" }, 401, c.headers);
    if (!env.ANTHROPIC_API_KEY) return json({ error: "config" }, 500, c.headers);

    let body;
    try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400, c.headers); }
    const files = Array.isArray(body.files) ? body.files.slice(0, MAX_FILES) : [];
    if (!files.length) return json({ error: "no_files" }, 400, c.headers);

    let total = 0;
    const content = [];
    for (const f of files) {
      const name = String(f.name || "archivo").slice(0, 120);
      if (f.pdf) {
        total += f.pdf.length;
        content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.pdf }, title: name });
      } else if (typeof f.text === "string") {
        const t = f.text.slice(0, 200000);
        total += t.length;
        content.push({ type: "text", text: `=== ARCHIVO: ${name} ===\n${t}` });
      }
    }
    if (!content.length) return json({ error: "no_files" }, 400, c.headers);
    if (total > MAX_TOTAL_BYTES) return json({ error: "too_large" }, 413, c.headers);
    content.push({ type: "text", text: INSTRUCTIONS });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2026-10-21",
        "anthropic-beta": "server-side-fallback-2026-07-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        fallbacks: "default",
        output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
        messages: [{ role: "user", content }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return json({ error: "upstream", status: res.status, detail: err.slice(0, 500) }, 502, c.headers);
    }
    const msg = await res.json();
    if (msg.stop_reason === "refusal") return json({ error: "refused" }, 422, c.headers);
    if (msg.stop_reason === "max_tokens") return json({ error: "truncated" }, 502, c.headers);
    const text = (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    let parsed;
    try { parsed = JSON.parse(text); } catch { return json({ error: "invalid_json" }, 502, c.headers); }
    return json({ result: parsed, usage: msg.usage, model: msg.model }, 200, c.headers);
  },
};
