Release: phone-store v0.1 (admin app + storefront + database migrations 0001-0009)
Date: 2026-11-07 (Africa/Cairo)
Assistant(s): Claude Code (Sonnet 5.5)
Commit range: N/A - the project is NOT under version control (no git repository)

## 1. Scope and change review: FAIL
- Evidence: `git rev-parse` -> "not a git repository". No commit range can be reviewed.
- Action: create a git repository and a GitHub repo, commit the current state, protect `main`.
- High-risk areas present: authentication, authorization (RLS), money/cash handling, customer phone numbers and addresses (web orders), supplier payments, IMEI traceability, public order endpoint.

## 2. Secrets and sensitive data: PASS (scanner not run)
- Evidence: pattern scan (service_role, sk_live, sk_test, private keys, DB URLs, JWT-like strings) over all source/SQL/JSON/MD/HTML -> 0 hits.
- `.env` (admin) and `.env.local` (storefront) exist locally and are ignored by each app's `.gitignore` (`.env.*` rule added to admin). Only the Supabase *publishable* key is used in the apps; no service-role key anywhere.
- No source maps in the admin build; storefront has `productionBrowserSourceMaps: false`.
- Not done: `gitleaks` (not installed; no git history yet). Run it after the first commit.
- Note: customer PII (name, phone, address) is stored in `online_orders`/`sales_invoices` and appears in `audit_log`; keep audit access to owner/accountant (already enforced).

## 3. Dependencies: PASS
- `npm audit --omit=dev`: admin 0 vulnerabilities, storefront 0 vulnerabilities.
- Direct dependencies: react, react-dom, react-router-dom, @tanstack/react-query, @supabase/supabase-js, tailwindcss, vite, vitest; storefront adds next 16.4.5.
- `zod` is installed in admin but not used: remove it or use it for form validation.

## 4. Static checks and build: PASS
- Admin: `tsc -b` clean, lint 0 errors (4 harmless fast-refresh/effect warnings), `vite build` OK.
- Storefront: `tsc --noEmit` clean, eslint clean, `next build` OK.

## 5. Tests: FAIL (partial)
- Unit: admin `vitest` 4/4 pass (money helpers).
- Database tests (Supabase SQL Editor, rolled back): device tracking 12/12 passed (screenshot seen). rls_foundation, purchasing_flow, storefront, sales_expenses_cash, returns, supplier_ledger: owner reported OK but result tables were NOT seen by the assistant -> NOT VERIFIED. The tests now print a SUMMARY row for one-screenshot proof.
- No automated end-to-end UI tests (login as each role, phone + desktop, Arabic RTL) exist -> missing. No regression-test framework for the storefront.
- Role click-through (owner, manager, cashier, warehouse) has not been performed.

## 6. Security review: FAIL (items below)
- Authentication: passwords handled by Supabase Auth (bcrypt). Session/cookie flags are Supabase defaults: NOT VERIFIED. Owner MFA NOT enabled -> FAIL.
- Authorization: RLS enabled on 33/33 tables (migration scan). 51/51 security-definer functions set `search_path`. Role + ownership checks inside every mutating function. Tested for the foundation, purchasing, storefront, sales, returns, suppliers, devices flows (see section 5). PASS where tests were seen (devices).
- Input/output: money, serials, quantities, enums validated in the database; no dynamic SQL (`execute`) anywhere; no `dangerouslySetInnerHTML`/`innerHTML`/`eval` in app source. Redirect targets are fixed routes. Image URLs must be https.
- Public endpoints: `place_online_order` / `track_order` are callable anonymously by design. Protections: input validation, max 3 open orders per phone, 24h reservation expiry, honeypot field. Missing: CAPTCHA, per-IP rate limit -> FAIL (see 6A-9).
- `catalog_items` is a definer view exposing only published items, price and stock capped at 5; no cost column (verified by test).
- Storefront image optimizer accepts any https host (`remotePatterns: **`) -> restrict to the store's own storage host before launch (Medium).
- Mobile: N/A (no mobile app in this release).

## 6A. Required controls
1. Env files ignored: PASS (rules present in both apps; `git check-ignore` not runnable without git).
2. HTTPS/SSL: NOT VERIFIED - not deployed. HSTS header configured in both apps.
3. Clean user input: PASS - validated server-side in SQL functions (length, type, enum, range, normalised serials/phones).
4. Parameterized queries only: PASS - app uses the Supabase client; migrations contain no string-built or dynamic SQL.
5. Validation output: PASS - database errors are mapped to safe Arabic messages; unknown errors show a generic message (fixed in this review; raw DB text no longer displayed).
6. Login rate limiting: FAIL (no evidence) - rely on Supabase Auth rate limits; confirm settings and test with repeated wrong passwords.
7. Strong passwords: FAIL (no evidence) - set minimum length 12 and leaked-password protection in Supabase Auth settings; test `Password123` is rejected.
8. Password hashing: PASS - no passwords stored in project tables (grep of migrations); Supabase Auth stores bcrypt hashes.
9. CAPTCHA on public forms: FAIL - the public order form has a honeypot only. Needs Cloudflare Turnstile with server-side token verification (Supabase Edge Function in front of `place_online_order`). HIGH.
10. Security headers: PASS in config. Storefront verified with curl on the dev server: HSTS, nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy present; X-Powered-By removed. Admin headers are in `vercel.json` (verify after deploy). CSP is Report-Only (Next needs inline scripts) -> MEDIUM, enforce after review.
11. No directory listing: PASS on dev server (`/.env`, `/.env.local`, `/.git/config` -> 404; no source maps). Re-test on the production domain.
12. Dependencies updated: PASS in config (`.github/dependabot.yml` for both apps); takes effect once the repo is on GitHub.
13. Errors logged, not shown: FAIL (partial) - users now see generic message + reference ID (admin ErrorBoundary, storefront error page). No server-side error log/monitoring (e.g. Sentry) is connected yet.

## 7. Database and infrastructure: FAIL
- Migrations 0001-0009 applied and checked with `supabase/diagnose.sql`. Rollback scripts: not written (migrations are forward-only) -> document a restore-from-backup plan.
- No separate staging project: all tests and demo data ran on the project labelled PRODUCTION. Test accounts/demo data must be removed (`seed_demo_cleanup.sql`) before real use.
- Backup: not verified (check Supabase backup/PITR for the plan and run a restore test).
- Supabase Auth: public sign-ups should be disabled (staff accounts are created by the owner).
- Supabase Security Advisor: not run (project is in an account the assistant cannot access) -> owner to open Database > Advisors and send a screenshot.
- Monitoring/alerts and a person watching the first hour after launch: not set up.
- Hosting not chosen; HTTPS, redirect HTTP->HTTPS and domain not configured.

## Findings by severity
- Critical: none found.
- High:
  1. No CAPTCHA / per-IP limit on the public order endpoint (6A-9).
  2. Owner MFA not enabled; password policy and login rate limits not evidenced (6A-6, 6A-7).
  3. No role click-through test and no end-to-end tests; 6 SQL test result tables not seen (section 5).
  4. No version control (section 1) and no verified backup / restore (section 7).
  5. Everything runs on one project labelled PRODUCTION with test data and no staging.
  6. No server-side error logging/monitoring (6A-13).
- Medium:
  1. CSP is Report-Only (inline scripts needed by Next) - move to nonce-based enforcing CSP.
  2. Storefront image optimizer allows any https host.
  3. Public sign-ups should be disabled.
  4. No rollback scripts for migrations.
- Low:
  1. Unused `zod` dependency; 4 lint warnings (fast refresh / setState in effect).

## Recommendation: BLOCKED
Approved by: (blank until a human approves)

### Fix order (who)
1. (Owner, 10 min) Supabase Auth: disable sign-ups; min password length 12; leaked-password protection; confirm login rate limits; enable MFA for the owner account.
2. (Owner) Dashboard > Database > Advisors: run Security and Performance advisors, send screenshots.
3. (Owner) Confirm backups on the plan and do one restore test into a new project.
4. (Assistant) git init + first commit, GitHub repo, run gitleaks.
5. (Assistant + owner) Cloudflare Turnstile account (site key + secret) -> Edge Function in front of `place_online_order`, per-IP limit.
6. (Assistant) Playwright end-to-end tests for the critical paths; owner creates one test login per role for the click-through.
7. (Assistant) Connect error monitoring (Sentry) once an account exists.
8. (Both) Create a staging Supabase project; keep production clean; remove demo data and test accounts.
9. (Assistant) Nonce-based enforcing CSP; restrict image hosts.
