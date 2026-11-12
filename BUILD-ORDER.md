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

## Update 2026-11-08 (repair intake)

- Admin route `/repairs` adds device intake, branch-scoped search, Cairo deadlines, status changes and custody history.
- On staging, apply `0011_repair_intake.sql` after `0010`, run `supabase/tests/repair_intake_test.sql`, then open **الصيانة** from the admin sidebar. The SQL test rolls back its fixtures.
- Owner, manager and cashier can update repairs within their assigned branches. Accountants can view repairs in their assigned branches. Technician assignment is recorded by name in this phase.
- Next stages are in `docs/REPAIR-DASHBOARD-PLAN.md`, including spare parts, quotes, payments and warranty.

## Update 2026-11-10 (security hardening, from the Volt study)
- Done in code: migration `0015_security_hardening.sql` — per-user rate limits on sales (60/min), expenses (20/min), refunds (15/min), approval requests (30/min); shift gate (no sale without an open cash session, switch: `app_settings.require_open_shift`); manager PIN (bcrypt, 6-8 digits, 5 wrong tries = 15 min lock, one caller cannot spread guesses: 10 failures/15 min); one-time override tokens (5 min); append-only `security_events`; owner force-logout.
- Done in code: admin screen "الأمان" (`/security`): set my PIN, staff table with unlock / force logout, security events with search and CSV; AuthProvider signs out when `is_current_session_valid()` returns false.
- Tests: `supabase/tests/security_hardening_test.sql` (12 checks, rolled back).
- Run order: 0015, then the test on STAGING.
- NOT VERIFIED: 0015 and the test were only syntax-parsed (libpg-query), never run on a real database. No Supabase project for this store was reachable from the tools used.
- NOT VERIFIED: the shift gate may break older tests/flows that sell by card with no open drawer (sales_expenses_cash_test); check on staging. Set `require_open_shift` to 0 to turn it off.
- NOT VERIFIED: force logout deletes `auth.sessions` rows if permitted; otherwise it relies on the JWT `iat` check (a token can live up to its expiry for direct API calls). Real revocation needs a Supabase Auth admin call.
- NOT BUILT yet: PIN prompt in the sales screen (backend `request_override` / `consume_override` is ready; discount approval still uses the owner approvals flow); login lockout (use Supabase Auth rate limits + MFA in the dashboard); multiple drawers (products / repairs / machines / installments / wallets) with per-drawer counting at shift open and close.
- Next, in order: wire the PIN prompt into discount/refund, multi-drawer shifts, wallets, installments, trade-in.

## Update 2026-11-10 (Phase 1: drawers and shifts — see docs/VOLT-PARITY-PLAN.md)
- Done in code: migration `0016_drawers_shifts.sql` — 6 drawers per branch (products, maintenance, machines, installments, wallets, safe); append-only ledger `drawer_movements` (balance = sum, no editable balance); cash sale/refund/expense/supplier payments mirrored into the products drawer by triggers; `open_shift` / `close_shift` with a count per drawer (skip allowed, difference written to the ledger and saved on the shift, note required when there is a difference); `transfer_drawer` and `adjust_drawer` (idempotency key, open shift required, safe = owner/manager only, manager PIN token at/above `drawer_transfer_pin_threshold` = 5000, owner exempt).
- Done in code: screen `/cash` rewritten as "الورديات والأدراج" (drawer cards, open/close wizard, transfer, adjust, history with per-drawer differences) and a reusable manager-PIN prompt `components/ApproverPin.tsx`.
- Tests: `supabase/tests/drawers_test.sql` (12 checks, rolled back). Needs 0015 + 0016.
- VERIFIED on staging (Phone-store, 2026-11-10): 0001-0016 applied; all SQL test files pass (security_hardening 12/12, drawers 12/12, and the 9 older files). `returns_test.sql` had two test-only bugs, fixed.
- NOT VERIFIED: the shifts screen was typechecked and linted, never clicked through with a real login.
- NOT VERIFIED / KNOWN GAP: only cash from sales, refunds, expenses and supplier payments reaches the ledger (all into the products drawer). Repair payments, voided sales, machine/wallet/installment cash are NOT mirrored yet (Phases 5-6). Expenses cannot choose a drawer yet.
- Old `open_cash_session` / `close_cash_session` still exist for old tests; the new screen uses `open_shift` / `close_shift`. Do not mix them in daily use: `open_cash_session` does not count the other drawers.
- "Open shift for another employee" (Volt feature) is in the function (`p_for`) but not in the screen yet.

## Update 2026-11-10 (maintenance: money, delivery, warranty, board — from the Volt maintenance screens)
- Done in code AND applied to staging (Phone-store): `0017_function_hardening.sql` (trigger functions no longer callable via the API, search_path pinned), `0018_repair_money.sql` (repair payments into the maintenance drawer, `deliver_repair` with balance check + warranty, back-door trigger on `update_repair`, `check_repair_warranty`, `repair_templates`), `0019_warranty_rp_search.sql` (short RP numbers in the warranty lookup).
- Tests on staging: `repair_money_test.sql` 13/13, `drawers_test.sql` 12/12, older `repair_intake_test` and `maintenance_workflow_test` still pass after 0018.
- Done in code (typecheck + lint pass, NOT clicked through with a login): the Repairs page now has tabs — board (5 columns grouping our 10 statuses), list, history (CSV), customer statement by phone (CSV), service templates; buttons for the warranty checker and the combined (multi-device, print-only) invoice; the order dialog has a payment / refund / delivery section; the quote form can fill labour from a template.
- NOT APPLIED: `0020_held_baskets.sql` (POS held baskets) — written, parsed, no screen yet.
- Decisions: lock codes are NOT stored (a device passcode is a secret); delivery with an unpaid balance is owner/manager only with a written reason; delivering a priced repair through `update_repair` is blocked (use `deliver_repair`).
- NOT BUILT yet: customer entity with "add customer" in the intake form (Phase 4); WhatsApp updates; public tracking link; card/transfer/wallet repair payments into machine/wallet drawers (Phase 5); repair cash is the only repair money in the ledger.

## Update 2026-11-10 (theme + Phase 0 + start of Phase 1 — see docs/VOLT-GAP-PLAN.md)
- Theme: desktop-style look for the admin (translucent sidebar, soft depth, blue accent, spring motion, themed selects, skeleton loading, reduced-motion respected). Files: `index.css`, `ui.tsx`, `Shell.tsx`, `Login.tsx`, `State.tsx`.
- Applied on staging (Phone-store): `0020_held_baskets`, `0021_sale_idempotency` (`create_sale_once`: one key per invoice form, double click = one invoice; removes the resumed held basket; attaches the customer), `0022_customers_debt` (customers, identity details hidden from cashiers, append-only customer ledger, credit sales via payment method `credit` with a credit limit, debt collection into the products drawer, manual debt, reversal entries, `sale_profit_split` view), `0023_credit_return_guard`.
- Test on staging: `supabase/tests/customers_debt_test.sql` 14/14 (rolled back). Older test files were NOT re-run after 0021-0023.
- Screens: new "العملاء والديون" (`/customers`: list, search, filters, CSV, add/edit, account statement, collect, manual debt, reverse, identity details); Sales: customer picker, "آجل" payment, credit-limit warning, hold / resume / delete held invoices, idempotent save.
- Typecheck, lint and build pass. NOT VERIFIED: none of the inner screens were clicked through with a real login (only the login page was seen in the browser).
- NOT BUILT: returns on credit invoices (blocked at the database on purpose until Phase 6); realising deferred profit when a debt is collected; repair / installment / used-device debts feeding the customer ledger; the old `open_cash_session` / `close_cash_session` are still callable (10 older tests use them).
- Decisions taken as defaults (owner can change): credit needs a registered customer; limit 0 = no credit; only the owner may pass the limit; cashiers cannot set limits, stop customers or see national IDs; profit split is rounded to piastres (Volt rounds to pounds).
- Approval-system recommendations: `docs/APPROVAL-SYSTEM.md`.

## Update 2026-11-10 (Phase 2, first part: accounts and money routing)
- Applied on staging: `0024_money_accounts.sql` — wallet / payment-machine accounts with an append-only ledger, daily and monthly limits, minimum balance, set-balance (first time = opening balance) and transfers; expenses, supplier payments and debt collection can choose the drawer (cash) or the account (non-cash), no choice = old behaviour; a chosen drawer or account can never go negative; drawer "add cash" / "withdraw cash"; shift number (`shift_no`, shown as W-000N); `shift_alerts` for every count difference with a review step (the shift owner cannot review their own); `balance_control_log` view with before / after.
- Test on staging: `supabase/tests/money_accounts_test.sql` 10/10 (rolled back).
- Screens: new "الأرصدة والحسابات" (`/accounts`): account cards with limit bars, add / edit, set balance, transfer, add / withdraw drawer cash (manager PIN above the threshold), unreviewed shift differences, control log with CSV. Drawer / account picker added to expense payment, supplier payment and debt collection.
- Checked in the browser with a login: accounts page, new account, opening balance, control log row. No console errors.
- NOT BUILT (rest of Phase 2): sales, refunds and repair payments by card / wallet do not move an account yet; the shift close wizard has no account-count step; shift number is not shown on the shifts page; closing snapshot has no stock value; "open shift for employee" still missing from the screen; old `open_cash_session` / `close_cash_session` still callable; wallet send / receive with commission, bills and machine operations are Phase 7.
- Test data left on staging: customer «عميل تجربة 1» (500 debt), wallet «تجربة محفظة 1» (1,200).

## Update 2026-11-12 (Phase 2, rest: account routing and shift close)
- Applied on staging: `0025_account_routing.sql` — card / wallet / transfer money from sales, sales refunds (`create_return_from`, the account is saved on the return so an approval keeps it) and repair payments / deposits / refunds now moves the chosen account; no account chosen = recorded only (old behaviour); an unknown or stopped account is refused; an account cannot go below its minimum balance. `0026_shift_account_counts.sql` — `close_shift` accepts counts for wallets and machines; a difference needs a note, is saved as a correction, and raises a shift alert (code `acct:<id>`); the closing snapshot now keeps account balances and stock value at cost.
- Tests on staging (rolled back): `account_routing_test.sql` 8/8, `shift_account_counts_test.sql` 5/5; after 0025 all 9 test files pass (sales 17, returns 12, drawers 12, repair money 13, device tracking 12, supplier 13, customers 14, accounts 10, routing 8).
- Screens: account picker on sales payment lines, return dialog and repair payments; shift screen shows the shift number (W-000N) and an account count step in the close dialog; history shows account differences.
- Typecheck and lint pass. NOT VERIFIED: these screens were not clicked through with a login.
- NOT BUILT: "open shift for employee" in the screen; revoking old `open_cash_session` / `close_cash_session` (older tests still use them); account count when opening a shift.
