# Phone Store — build order and status

Source of truth for scope: `phone-store-system-plan.md`. Updated 2026-11-07.

## Stack
- `apps/admin` — Vite + React + TypeScript + Tailwind, Arabic RTL, light/dark tokens (admin + owner app).
- `supabase/migrations` — Postgres with RLS on every table.
- Later: `apps/storefront` (Next.js, needs SEO).

## Working defaults (change when the owner/accountant decide)
| Open decision (plan §11) | Default used now |
|---|---|
| Purchase orders approval | Owner approves every order (`approval_policies` seed) |
| Online selling | Reserve-and-confirm, no online payment yet |
| Inventory costing | Moving average (not built yet) |
| Commission | Accrued at sale, reversed on return (not built yet) |

## Status
| Workstream | Status |
|---|---|
| A. Foundation | **Done in code:** roles, branches, audit log (append-only), approvals engine (separation of duties, one-time execute), login, role-gated shell, approvals + audit screens, money/Cairo-time helpers + tests |
| B. Catalog and inventory | Next |
| C. Suppliers and purchasing | After B |
| D. Finance | After A (commissions blocked on rules) |
| E. Owner app | After B–D data |
| F. Storefront | After B |
| G. Marketing | Last |
| H. Legacy POS bridge | Blocked on discovery session |

## Run
```bash
cd apps/admin
cp .env.example .env     # fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
npm test
```

## Database setup
1. Create a Supabase project (staging first, production separate).
2. Apply `supabase/migrations/0001_foundation.sql`.
3. Create the first user in Supabase Auth, then give them the owner role (once, by SQL):
```sql
insert into public.user_roles (user_id, role) values ('<owner-auth-user-id>', 'owner');
```
After that the owner adds all other roles from the app.

## NOT VERIFIED yet
- The migration has not been run against a real Postgres. Apply on staging and test RLS as each role.
- No end-to-end login test (needs a Supabase project).
- MFA for owner/admin accounts: enable in Supabase Auth settings before production.
- Lint warning in `AuthProvider.tsx` (setState in effect) and bundle >500 kB (add lazy routes).
- Pre-production release checklist not run.

## Update 2026-11-07 (storefront)
- Done in code: apps/storefront (Next.js, public catalog, cart, reserve checkout, order tracking), admin Online Orders screen, migration 0005, tests in supabase/tests.
- Run order: 0003, 0004, 0005, then tests (rls_foundation, purchasing_flow, storefront).
- Run storefront: cd apps/storefront, copy .env.example to .env.local, npm run dev.
- NOT VERIFIED: 0005 on a real database; bot protection on the public order endpoint (add Turnstile/rate limit before launch); product image upload (URL field only).

## Update 2026-11-07 (admin daily operations + owner view)
- Added migration 0006 (sales, expenses, cash drawer, owner summary, transactions feed) and supabase/tests/sales_expenses_cash_test.sql.
- Admin screens: Sales, Cash drawer, Expenses. Owner screens: Transactions feed, dashboard with period comparison.
- Approvals added: sale.discount (over max_discount_pct, default 5), expense.create (over expense_approval_threshold, default 5000). Both in app_settings.
- Storefront restyled (promo bar, header, hero, categories, product rows, mobile tab bar). Light only; accent color is --brand in globals.css.
- Run order: 0003, 0004, 0005, 0006, then the four tests.
- NOT BUILT YET: sales returns, per-device serial tracking, payroll and commissions, supplier payments ledger, marketing.
- NOT VERIFIED: 0006 on a real database; end-to-end click-through as each role.

## Update 2026-11-07 (returns)
- Added migration 0007 (sales returns, refunds, inspection) and supabase/tests/returns_test.sql. Run order: 0007 then the test.
- Rules: refund reduces drawer cash and net sales; returned items go to inspection; cashier returns and manager returns at or above return_approval_threshold (2000) need owner approval.
- NOT BUILT YET: payroll and commissions, supplier payments ledger, per-device serial tracking, marketing, product image upload.

## Update 2026-11-07 (supplier ledger + test catalog)
- Added migration 0008 (supplier invoices, payments, balances), supabase/tests/supplier_ledger_test.sql and the Supplier accounts screen.
- Mismatched supplier invoices and payments of 20000 or more need owner approval (supplier_payment_threshold).
- Added supabase/seed_demo_catalog.sql: 24 made-up test products with local placeholder images in apps/storefront/public/demo. Remove with seed_demo_cleanup.sql.
- Decision: no copying of another retailer catalog (photos, descriptions, prices). Use own products and own photos.
- Run order: 0008, then supplier_ledger_test.sql.

## Update 2026-11-07 (device tracking)
- Added migration 0009 (devices, device_events, serial-aware receiving, sales, returns, web delivery) and supabase/tests/device_tracking_test.sql.
- Admin: Devices screen (IMEI lookup, register, write-off), serial picker in sales, serials in PO receiving, returns by device, serials at web delivery, warranty months per variant.
- Rule: tick "track by serial/IMEI" on a product; its existing stock must be linked to serials (Devices > register, mode existing) before it can be sold. Manual stock adjustments are blocked for tracked items.
- Run order: 0009, then device_tracking_test.sql. Existing tests still apply (set_online_order_status now has an optional 4th parameter).
- NOT BUILT YET: payroll and commissions, marketing, product photo upload, hosting, MFA, release checklist.
