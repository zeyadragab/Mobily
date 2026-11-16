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

## Update 2026-11-12 (top bar, Phase 3 catalog, Phase 4 supply)
- Top bar (admin, desktop): clock (Cairo) with weather pill, shift status with shift number / online / quick sale, bell and tasks with counts (unreviewed shift differences, pending approvals), theme and accent colour, calculator, refresh; red banner above pages while shift differences wait for review. Files: `components/TopBar.tsx`, `lib/theme.ts`, `public/theme.js`. Weather comes from open-meteo (no key, Cairo coordinates only) and hides itself if unreachable. NOT VERIFIED visually (browser pane needs a login).
- Applied on staging: `0027_catalog.sql` — category spec fields with value checks, units, tracking mode (none / IMEI with Luhn check / internal serial; `track_serial` kept in sync), wholesale price, EAN-13 barcode generator, safe bulk import (checks first, 2,000 rows max, nothing written on any error), category delete rule. `0028_supply.sql` — `receive_supply` (goods + supplier invoice + optional payment from a drawer or account in one call, idempotent, average cost, optional new prices), stock counts (open, enter counts, scan serials, reasons, manager approval, missing devices), damaged goods with supplier return flag, shortage book.
- Tests on staging (rolled back): `catalog_test.sql` 9/9, `supply_test.sql` 9/9; after 0027 older files re-run: device tracking 12, purchasing 18, sales 17, returns 12, storefront 12, rls 13, order endpoint 7 - all pass. Not re-run after 0028 (it only adds objects and one enum value).
- Screens: Products (tracking mode, unit, wholesale price, spec fields, barcode generate, category manager, CSV export / import, price list and barcode labels printing), new page "التوريد والجرد" (`/supply`: 3-step supply wizard, supply log with CSV, damaged goods, stock count, shortage book). Typecheck and lint pass. NOT VERIFIED: none of these screens clicked through with a login.
- NOT BUILT (rest of Phases 3-4): supply cancel rule, price list as a saved document, labels for non-EAN barcodes (text only), supplier "goods or services" type and archive, purchase-order flow calling the same receive core.

## Update 2026-11-12 (Phase 5: selling)
- Applied on staging: `0029_pos.sql` — `create_sale` v2 and `create_sale_once` (new optional arguments: price mode, offer, manager PIN token). Wholesale / retail price mode; per-line price override (a cashier may go down to the max-discount %, below that or below cost a manager PIN token is needed, the owner is never blocked); offers (percent with cap, fixed, buy X get Y, bundle price) with dates and max uses; uncoded items (name, cost, reason recorded, PIN for cashiers at 1,000 or more); `sales_log` view with paid, credit and profit (profit only for owner / manager / accountant).
- Tests on staging (rolled back): `pos_test.sql` 10/10; after 0029: sales 17, returns 12, customers 14, accounts 10, routing 8, repair money 13 all pass.
- Screens: sales invoice form (price mode toggle, editable unit price with PIN prompt, offer picker with live preview, "item without code" form), sales list with credit and profit columns, new page "العروض والباقات" (`/offers`). Typecheck and lint pass. NOT VERIFIED: not clicked through with a login.
- Decision: an offer discount is pre-approved (does not need owner approval); only the manual discount above the max % does.
- NOT BUILT: a separate full-screen POS grid layout (the invoice form is reused), tax / service receipt dialog, void sale, uncoded "profit only to the drawer" setting (default is the full price), offers for web orders.

## Update 2026-11-12 (Phase 6: returns and warranty, sidebar)
- Applied on staging: `0030_returns_v2.sql` — return condition per line (new / used / damaged); returns on invoices that had a credit part are allowed (the 0023 guard is removed): the part still owed on that invoice is taken off the customer debt first, the rest is paid out; refund to the customer account ("credit"); manual reduction of the refund (restocking fee) with a reason, manager PIN token for cashiers; invoice search by number, phone, name, device serial / IMEI or barcode; one warranty checker for sold devices and finished repairs (`check_warranty`); `returns_archive` view.
- Tests on staging (rolled back): `returns_v2_test.sql` 9/9; older: returns 12, account routing 8, customers 14, sales 17, POS 10, device tracking 12 all pass.
- Screens: new page "مرتجعات العملاء" (`/returns`: new return with search, archive with KPIs and CSV, warranty checker); return dialog has condition, credit refund, reduction with PIN. Typecheck and lint pass. NOT VERIFIED: not clicked through with a login.
- Sidebar: planned pages from the Volt sidebar now show as greyed "coming soon" entries with their phase (send / receive, bills, trade-in, in / out, installments, mobile tax, team, employee accounts, reports, WhatsApp campaigns, settings).
- NOT BUILT: warranty in days on the variant (stays in months), returns print receipt (RET number only), supplier-return flow for damaged returned items.

## Update 2026-11-16 (Phase 7: wallets, bills, machines)
- Applied on staging earlier (2026-11-14): `0031_wallets_bills.sql` — send / receive / send on credit / receive on credit (pending then settle), daily and monthly account limits, minimum balance, manager PIN token for cashiers at `wallet_pin_threshold` (10,000), bill payments (cash or credit, repeat count up to 20), machine operations, manager-only cancel with exact reversal, idempotency keys, open-shift gate.
- Test on staging (rolled back), run 2026-11-16: `wallets_test.sql` 16 of 17 checks passed; check 8 failed only on a miscount in the test (6 and 9 operations, not 7 and 10). Test fixed, NOT re-run after the fix.
- Screens: `/wallet-ops` (إرسال واستقبال) and `/bills` (فواتير وخدمات) are now routed in `App.tsx` and no longer greyed out; roles owner, manager, cashier. Typecheck and lint pass (no warnings in these files).
- Test fix 2: check 8 asserted that anon has no table grants, but Supabase gives anon grants on every table here; the real protection is RLS. The test now checks RLS on and no anon/public policy (checked by a separate query on staging, full file not re-run after this edit).
- Checked in the browser with a login (2026-11-16, narrow pane, no shift open): both pages load with no real console errors; Send/Receive shows the live preview (send 300: wallet -300, drawer +300) and a no-shift submit is refused with a readable Arabic message and nothing written; Bills shows the 8 service chips, account picker, cash/credit and count fields.
- Checked end to end on staging through the screens (desktop width, owner login, shift W-0051 opened from the shifts page): send 300 + 5 commission (WO-000029: wallet -300, wallets drawer +305), receive 100 + 2 (WO-000030: wallet +100, drawer -98), credit send 200 with the test customer (WO-000031: wallet -200, drawer unchanged, customer wallets debt +200), cancel of WO-000031 with a reason (wallet and debt restored, row shows cancelled), electricity bill 100 + 1 paid in cash from the wallet (BL-000011: wallet -100, machines drawer +101). KPIs and log rows updated each time. Drawer and wallet numbers were checked in the database.
- Test data left on staging: shift W-0051 still OPEN, wallet «تجربة محفظة 1» at 900, wallets drawer 207, machines drawer 101, operations WO-000029/30/31 (31 cancelled), BL-000011.
- NOT VERIFIED in the screens: receive on credit (pending then settle; covered by the SQL test), manager PIN prompt (owner is exempt, so it never appears), cashier role view, machine withdrawal (no machine account on staging), CSV export, receipt printing, bill on credit, phone width after the change. Migrations 0032-0034 and 0037 exist in the repo but are not applied on staging.

## Update 2026-11-16 (Phase 8: maintenance completion — see docs/VOLT-GAP-PLAN.md)
- Applied on staging: `0032_maintenance_money.sql` — repair orders can be linked to a registered customer (`customer_id`, plus brand, expected price); spare parts have a cost and every order line keeps the cost of the day (`unit_cost`, R15), hidden from cashier and technician (column grants + `repair_order_cost`, `repair_part_costs`); `repair_profit` view (quote - parts cost, realised after delivery); delivery with an unpaid rest puts it on the linked customer's account as debt, source `maintenance` (R16), inside the credit limit (owner passes it); without a customer the old rule stays (owner / manager with a written reason); `cancel_delivered_repair` (R17: owner, or manager with a PIN token requested with ANOTHER owner/manager's PIN; refunds money back from the drawer / account, reverses the debt, parts back to stock, order back to repairing, warranty cleared); `set_repair_customer`; `repair_brands` list (21 seeded); `receive_repair` takes `customer_id`, `brand`, `expected_price` (or matches a customer by phone).
- Tests on staging (rolled back): `maintenance_money_test.sql` 13/13; after 0032: `repair_money_test.sql` 13/13 and `repair_intake_test.sql` pass. NOT re-run after 0032: `maintenance_workflow_test.sql`, and the older money tests outside repairs.
- Screens: intake has a customer picker (name and phone come from the account), brand list and expected price; the order dialog shows brand, expected price, profit and parts cost (owner / manager / accountant), a link-to-customer block, delivery with the rest on the customer's account, and cancel delivery (owner directly, manager through the PIN prompt); the parts catalog has a cost field and cost column. Typecheck passes; lint shows only the existing warnings.
- Checked in the browser with an owner login on staging (RP-40): intake with customer + brand + expected price; part created with cost 250; profit 650 on a 900 quote; 200 cash deposit; delivery with 700 on the customer account (debt 500 -> 1,200); cancel delivery (debt back to 500, deposit refunded, part back in stock, warranty cleared).
- NOT VERIFIED: the manager PIN path for cancel in the screen, the cashier view (cost hidden), linking an existing order to a customer in the screen, non-cash payments / refunds to an account in the repair dialog, desktop-width layout of the new blocks.
- Known small issues seen: the parts form keeps its values after "add" (pre-existing); the Vite dev server missed a file change once and needed a restart.
- Test data left on staging: order RP-40 (back in repair, customer «عميل تجربة 1»), part «شاشة تجربة P8» (cost 250, stock 2), shift W-0051 still open.
- NOT BUILT (rest of Phase 8): wallet / machine payment accounts for the close-and-pay dialog beyond the existing account picker, receipt and warranty label print, statement by customer through the customer ledger, expected price on the board.

## Update 2026-11-16 (Phase 9: installments, in/out, trade-in — see docs/VOLT-GAP-PLAN.md)
- Applied on staging: `0033_installments_inout_tradein.sql` — installment plans and schedule (R20: manual plan with down payment and interest, or a plan from a credit invoice where only the interest is added; the last installment takes the rounding remainder; monthly dates clamp to month end), collections in cash (any drawer, default installments) or into a wallet / machine account (R21), cancel a collection (restores drawer or account, debt and installment), cancel a plan with no collections; `installments_due` view (overdue = due date today or earlier in Cairo); in/out (amanat) ledger apart from sales debt, ledger-only or with a drawer, cancel, `inout_balances` view; trade-in (R18/R19): the device enters stock at the price paid with no supplier, paid in cash, from an account, or off the customer's debt; cashier limit 5,000 (`tradein_cashier_limit`); seller national id kept in `trade_in_sellers` (not readable by cashiers); cancel needs the owner, or a manager with a PIN token requested with ANOTHER approver's PIN; the same serial can be bought again after a cancel.
- 0033 was applied without an audit trigger on `trade_in_sellers` (I wrongly believed `audit_row()` ignores its trigger arguments; it does not). 0038 below fixes that properly.
- Test on staging (rolled back): `installments_test.sql` 19/19. Older files were not re-run after 0033 (it only adds objects and one setting).
- Screens: `/installments` (due and overdue list, plans, collections log, collect dialog with drawer or account, new plan from an invoice or manual with a live schedule preview, cancel plan / collection, CSV), `/inout` (new entry, customer balances, log, cancel, CSV), `/trade-in` (purchase dialog, list, cancel with the PIN prompt for managers, CSV). The three sidebar entries are live; installments and trade-in are open to cashiers, in/out to owner and manager.
- Checked in the browser as owner on staging: manual plan (600 + 60 - 100 over 3 months: 186.67 / 186.67 / 186.66), cash collection with KPI update, cancel collection; in/out 500 into the products drawer and its cancel; trade-in refused for a drawer with too little cash, then bought at 150 from the wallets drawer and cancelled. Drawer, debt and device status were checked in the database each time.
- NOT VERIFIED: the screens as a cashier or manager (including the manager PIN path for cancelling a trade-in), plan from a credit invoice in the screen, collection into a wallet account in the screen, trade-in paid by account or off the customer's debt in the screen, overdue reminders by WhatsApp, receipts / contract printing, the signed contract scan for trade-in (not built), narrow phone layout.
- NOT BUILT (rest of Phase 9): trade-in contract print and signed scan upload, installment receipt print, WhatsApp reminder for overdue installments, installments from a repair or used-device debt, installments dashboard in the owner app.
- Test data left on staging: customer «عميل تجربة 1» has installment plan IP-000004 (first installment due today, unpaid; down payment 100 in the products drawer), a cancelled collection, a cancelled in/out entry, a cancelled trade-in (device P9-USED-0001 written off as damaged), the product «هاتف مستعمل تجربة P9» (tracked, variant P9-USED), shift W-0051 still open.

## Update 2026-11-16 (audit log and identity data)
- Found: `customer_kyc` (0022) used plain `audit_row()`, so on every KYC save the customer's national id, address and guarantor name / phone / national id were copied into `audit_log` (readable by owner and accountant). `audit_row('col', ...)` drops the named columns from the copy, but that table was not using it.
- Applied on staging: `0038_audit_pii.sql` — `customer_kyc` is now audited without `national_id`, `address`, `guarantor_name`, `guarantor_phone`, `guarantor_national_id` (still records which customer changed, who and when); `trade_in_sellers` is audited without `national_id` and `address`.
- Test on staging (rolled back): `supabase/tests/audit_pii_test.sql` 2/2. Negative control: with the old trigger put back, the same check detects the leak.
- Staging had no `customer_kyc` or seller audit rows at the time, so nothing needed scrubbing. `audit_log` is append-only; any database that already has such rows still holds the ids, and removing them needs a reviewed exception to that rule (not done).
- Apply 0038 before real customer data goes into production.
