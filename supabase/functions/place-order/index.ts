// Edge Function: place-order
// The ONLY way to place a web order once migration 0010 is applied.
// Steps: origin allow-list -> field validation -> Cloudflare Turnstile check -> per-IP rate limit -> place_online_order.
// Required secrets (Supabase Dashboard > Edge Functions > Secrets):
//   TURNSTILE_SECRET_KEY   Cloudflare Turnstile secret (never put it in the website)
//   ALLOWED_ORIGINS        comma-separated site origins, e.g. https://shop.example.com,http://localhost:3000
// Optional: MAX_ORDERS_PER_IP_HOUR (default 10)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically by Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";

const SECRET = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";
const ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const MAX_PER_HOUR = Number(Deno.env.get("MAX_ORDERS_PER_IP_HOUR") ?? "10");
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Business errors raised by place_online_order that are safe and useful to show to a customer.
const SAFE_ERRORS = /not enough stock|item unavailable|too many open orders|invalid phone|invalid name|address required|invalid items|invalid quantity|invalid fulfilment/i;

function cors(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin && ORIGINS.includes(origin) ? origin : (ORIGINS[0] ?? ""),
    "Access-Control-Allow-Headers": "content-type, apikey, authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const reply = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "content-type": "application/json" } });

type Body = {
  token?: unknown; name?: unknown; phone?: unknown; address?: unknown; fulfilment?: unknown; notes?: unknown; items?: unknown;
};

/** Allow-list validation: unknown fields are ignored, every used field is checked for type, length and format. */
function validate(b: Body) {
  const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : null);
  const token = str(b.token, 2048);
  const name = str(b.name, 80);
  const phone = str(b.phone, 20);
  const address = b.address == null ? "" : str(b.address, 300);
  const notes = b.notes == null ? "" : str(b.notes, 500);
  const fulfilment = b.fulfilment === "pickup" || b.fulfilment === "delivery" ? b.fulfilment : null;
  if (!token || name === null || !phone || address === null || notes === null || !fulfilment) return null;
  if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > 10) return null;
  const items = [];
  for (const it of b.items as Record<string, unknown>[]) {
    if (typeof it?.variant_id !== "string" || !UUID.test(it.variant_id)) return null;
    if (!Number.isInteger(it.qty) || (it.qty as number) < 1 || (it.qty as number) > 5) return null;
    items.push({ variant_id: it.variant_id, qty: it.qty as number });
  }
  return { token, name, phone, address, notes, fulfilment, items };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405, origin);
  if (!origin || !ORIGINS.includes(origin)) return reply({ error: "forbidden_origin" }, 403, origin);

  let raw: Body;
  try { raw = await req.json(); } catch { return reply({ error: "invalid_request" }, 400, origin); }
  const b = validate(raw);
  if (!b) return reply({ error: "invalid_request" }, 400, origin);

  const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";

  // 1. CAPTCHA: verify the one-time token with Cloudflare (server-side).
  const form = new FormData();
  form.set("secret", SECRET);
  form.set("response", b.token);
  if (ip !== "unknown") form.set("remoteip", ip);
  let verified = false;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    verified = Boolean((await r.json())?.success);
  } catch { verified = false; }
  if (!verified) return reply({ error: "captcha_failed" }, 400, origin);

  // 2. Per-IP rate limit (also trims rows older than a day).
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from("order_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).gte("at", since);
  if ((count ?? 0) >= MAX_PER_HOUR) return reply({ error: "rate_limited" }, 429, origin);
  await admin.from("order_attempts").insert({ ip });
  await admin.from("order_attempts").delete().lt("at", new Date(Date.now() - 86400_000).toISOString());

  // 3. Place the order (all business rules, stock locking and limits live in the database function).
  const { data, error } = await admin.rpc("place_online_order", {
    p_name: b.name, p_phone: b.phone, p_address: b.address || null, p_fulfilment: b.fulfilment,
    p_notes: b.notes || null, p_items: b.items,
  });
  if (error) {
    console.error("place_online_order failed:", error.code);
    return reply({ error: "order_failed", message: SAFE_ERRORS.test(error.message) ? error.message : "unexpected" }, 400, origin);
  }
  return reply(data, 200, origin);
});
