# CAPTCHA + rate limit for web orders: setup guide

Goal: web orders can only be placed through the `place-order` server function, which checks
Cloudflare Turnstile and a per-IP limit. Bots that call the database function directly are refused.

**Order matters.** Do the steps in this order, otherwise customers cannot order for a while.

## 1. Create the Turnstile widget (Cloudflare, free, ~3 minutes)
1. Cloudflare dashboard > **Turnstile** > **Add widget**.
2. Name: `phonestore`. Hostnames: your website domain (and `localhost` for testing). Mode: **Managed**.
3. Copy the **Site key** (public) and the **Secret key** (private).
   - Site key goes into the website setting `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
   - Secret key goes ONLY into Supabase secrets (step 2). Never paste it in chat, git or the website.

## 2. Set the secrets in Supabase
Dashboard > **Edge Functions** > **Secrets** (or `supabase secrets set ...`):
| Name | Value |
|---|---|
| `TURNSTILE_SECRET_KEY` | the Turnstile secret key |
| `ALLOWED_ORIGINS` | `https://your-shop-domain.com,http://localhost:3000` (comma-separated, exact origins) |
| `MAX_ORDERS_PER_IP_HOUR` | optional, default `10` |

## 3. Deploy the function
Using the Supabase CLI from the project folder:
```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase functions deploy place-order --no-verify-jwt
```
(`verify_jwt = false` is already set in `supabase/config.toml`; the function authenticates requests itself.)

## 4. Turn the website on
Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in the storefront environment (Vercel project settings, and `.env.local` for local use), redeploy.
Local testing without a real widget: Cloudflare's test site key `1x00000000000000000000AA` always passes, and the matching
test secret `1x0000000000000000000000000000000AA` can be set as `TURNSTILE_SECRET_KEY` on a **staging** project only.

## 5. Try one order end to end
Open the website, add a product, check out, solve the widget, and confirm the order appears under **طلبات الموقع**.

## 6. Lock the old door (last step)
SQL Editor: run `supabase/migrations/0010_order_endpoint_lockdown.sql`, then `supabase/tests/order_endpoint_test.sql`
(first row must read `SUMMARY: 7 passed, 0 failed`), then run the other tests again.
After this, calling `place_online_order` directly returns "permission denied".

## What it protects against
- Bots filling the order form: the server rejects a missing/invalid/reused Turnstile token.
- Scripts that skip the page: the database function is no longer callable by the public.
- Floods from one address: 10 orders per IP per hour (plus the existing 3 open orders per phone number).
- Other sites using your endpoint: only `ALLOWED_ORIGINS` are accepted.

## Limits to know
- IP limits can block several customers behind one shared connection (for example the shop's own Wi-Fi). Raise `MAX_ORDERS_PER_IP_HOUR` if needed.
- `track_order` stays public: it needs the customer's 128-bit secret link, so it cannot be guessed.
