# Volt gap plan: what we have, what is missing, how to build it

Written 2026-11-10. Sources read: `VOLT-FULL-SPEC.md` (S), `B-SCENARIO.md` (B), `A-INVENTORY.md` (A) in `D:\Work\volt-study\explore\`; our `BUILD-ORDER.md`, `docs/VOLT-PARITY-PLAN.md` (old plan), `docs/REPAIR-DASHBOARD-PLAN.md`, migrations 0001-0020, `supabase/tests/*.sql`, `apps/admin/src`.
Rule: we rebuild functions and workflows only; no Volt code, name, logo, mascot or Arabic wording. Test vectors `T01..T40` are in `docs/volt-test-vectors.md`.
Status words: **Have**, **Partial**, **Missing**, **Better** (we already do more than Volt). Abbreviations: PRD/MNT/INS/MCH/WAL/SAFE = the six drawers (products, maintenance, installments, machines, e-wallets, safe).

## 0. Where we stand (facts from the repo)
- Applied on staging: 0001-0019, all SQL tests passing (BUILD-ORDER, 2026-11-10). 0020 (held baskets) is written, not applied, no screen.
- Git: migrations 0011-0020, their tests, `lib/drawers.ts`, `Security.tsx`, all `Repair*` components and `docs/` are untracked or modified and uncommitted. Commit them before the next phase.
- Built money core: `drawers` + append-only `drawer_movements` (0016), `open_shift/close_shift` with per-drawer counts, `transfer_drawer`, `adjust_drawer` (idempotency key, PIN token above 5,000, owner exempt), `mirror_cash_movement` trigger (cash sale/refund/expense/supplier payment all land in the PRD drawer), `repair_payments` into MNT (0018), manager PIN + override tokens + rate limits + shift gate on sales (0015).
- Missing core: no `customers` table (sales and repairs keep free-text name/phone), no credit/debt anywhere, no wallet/machine accounts, no profit-pool ledger, no cost on repair parts, no idempotency key on `create_sale`.
- Single-branch shortcut: sales, drawers, shifts, expenses and supplier payments pick `select id from branches where is_active order by created_at limit 1` (0006, 0016, 0018). Repairs are properly branch-scoped (`can_access_repairs`).
- Admin routes today (`App.tsx`, `roles.ts`): dashboard, sales, repairs (tabs), maintenance board (technician), cash (shifts and drawers), expenses, products, inventory, online orders, devices, suppliers, supplier accounts, purchase orders, transactions, approvals, audit, security.

---
## A. Coverage matrix

### A1. POS and sales (S 3)
| Volt function | Status | Where | Gap to close |
|---|---|---|---|
| Product grid, search, barcode, category filter, sort | Partial | `Sales.tsx` NewInvoice (search by name/SKU/barcode) | category filter, sort (recent, best seller, price), scanner-first focus |
| Retail / wholesale mode and wholesale price | Missing | `variants.price` only (0004) | `variants.wholesale_price`, sticky mode, price stored on the line |
| Editable unit price per line | Missing | `create_sale` always uses `v.price` (0009) | line price with cost-floor rule (R09) |
| IMEI pick (search, scan, change) | Have | `SerialPicker.tsx`, `available_serials`, serial branch in `create_sale` | scan field, "change serial" on the cart line |
| Manual discount fixed / percent with note and rules | Partial | `create_sale` discount; above `max_discount_pct` (5) goes to owner approval (0006) | cost-floor rule, percent type, note, PIN token instead of waiting for an approval (ApproverPin exists but only `Cash.tsx` uses it) |
| Offers (percent with cap, fixed, buy X get Y), cart-level | Missing | none | `offers` table, apply/remove in cart (R10) |
| Bundles (components, derived stock, margin math) | Missing | none | `bundles`, `bundle_items`; stock derived (R35) |
| Payments cash / card / transfer / wallet, split | Partial | `sales_payments`, `check_payments` (payments must equal total) | add credit leg, account legs (R05, R06) |
| Credit sale with partial payment | Missing | no customer, no debt | R05, needs phase 1 |
| Uncoded sale (profit-only into drawer) | Missing | none | R07 |
| Held baskets | Partial | `0020_held_baskets.sql`: `hold_basket`, `discard_basket`, RLS, max 20 per user | apply, build the UI (phase 5). **Better than Volt:** keeps customer, discount, notes; cashier sees only own |
| Tax / service receipt (no money, no stock) | Missing | `lib/print.ts` has a generic print iframe | small dialog (phase 5) |
| Sales log: period, type, shift filters | Partial | `Sales.tsx` day filter + search | period list, type filter, shift filter, correct credit totals (E4) |
| Customer statement from POS | Missing | none | after phase 1 |
| Invoice with previous balance, print, WhatsApp | Partial | invoice modal in `Sales.tsx`, `print.ts` | balance lines, thermal/A4 template (phase 13) |
| Cancel a sale | Partial | `sales_invoices.status` allows `void`, no function | Volt has none (undo = return). Keep return-only, add shift-day void with PIN (phase 5) |
| Protection: rate limit, shift gate | Better | `rl_sales` 60/min, `gate_sales_open_shift` (0015) | add idempotency key to `create_sale` (a double click can double-sell today) |

### A2. Shifts and drawers (S 2, 14, 16)
| Volt function | Status | Where | Gap |
|---|---|---|---|
| Open shift, count each drawer or skip, counted value replaces balance | Have | `open_shift` writes `opening_adjust`; `Cash.tsx` | "open on behalf of employee" is in the function (`p_for`) but not in the screen |
| Close shift wizard, count or skip, notes | Have | `close_shift`, `Cash.tsx` | wallet/machine account step (needs phase 7) |
| Difference is a note + alert, not an expense | Partial | difference kept in ledger and `closing_counts` | owner alert / dashboard banner / "reviewed" button missing (R03) |
| Note required on difference | Better | `close_shift` raises "note required" | keep |
| Stock value snapshot at close | Missing | `closing_snapshot` has drawers and safe only | add stock value at cost (R04) |
| Shift code W-000N | Missing | shift id is a uuid | `shift_no` sequence |
| Shift history with details per drawer | Partial | `Cash.tsx` history, `ShiftRow` counts | numeric differences, print |
| Six drawers incl. safe not counted | Have | `drawers`, `ensure_drawers` | module switches to hide drawers |
| Drawer transfer | Have | `transfer_drawer` | readable errors (not raw codes) |
| Drawer adjust: opening / correct / add / withdraw | Partial | `adjust_drawer` supports only "set to value" | add the three missing types (R30) |
| Balance control log | Partial | `audit_log`, ledger rows | dedicated screen filtered to controlled balance ops (B6) |
| Shift gate on all money pages | Partial | trigger only on `sales_invoices` + functions that need a session | apply to every money function (phase 2) |
| Custom aggregate drawer cards | Missing | none | low priority, settings phase |
| Old `open_cash_session`/`close_cash_session` | Risk | still callable (0006-0008) | revoke after phase 2; they skip the other drawers |

### A3. Inventory and serials (S 6)
| Volt function | Status | Where | Gap |
|---|---|---|---|
| Product list with cost, price, profit, stock, supplier | Partial | `Products.tsx`, `Inventory.tsx`, `stock_levels` view | supplier column, average-cost badge, sort by last supply |
| Product add (category template, units, tracking mode, warranty, wholesale, min stock) | Partial | `products` + `variants` (color, storage, condition, warranty_months, reorder_level) | typed category templates, units, internal-serial mode, wholesale, default min 5 (phase 3) |
| Opening stock without cash or debt | Have | `adjust_stock` / `register_devices` mode `existing` | UI: quantity at product creation |
| Serial (IMEI) inventory, statuses, trace | Better | `devices`, `device_events`, `trace_device`, `Devices.tsx`; statuses in_stock/sold/inspection/damaged | add `missing`, `reserved`, `returned_to_supplier`, `archived`, `repair` statuses; IMEI format check |
| Batches and prices | Partial | `variant_costs` moving average (0004, 0009); serial cost per unit in `devices.cost` | no lots; decision F6. Average does not recompute when a serial leaves (B9) |
| Damaged items with reason | Partial | `write_off_device` (serial only, reason required); `adjust_stock` for non-serial | damaged-items screen with reason, employee, supplier-return flag (phase 4) |
| Stock count sessions (full / partial / smart), scan, review reasons | Missing | `count_adjustment` movement type exists, no function or screen | phase 4 |
| Shortage book | Missing | `reorder_level` only | phase 4 |
| Labels (barcode, spec), price list, Excel import/export | Missing | none (CSV in a few lists) | phase 3 |
| Stock reservation for web orders | Better | `stock_reservations`, `place_online_order` (0005) | keep |
| Shift needed for inventory writes | Different | none required | decision F3 |

### A4. Supply and suppliers (S 6.2, 7)
| Volt function | Status | Where | Gap |
|---|---|---|---|
| Supplier card with debt, types (goods / services) | Partial | `suppliers`, `supplier_balances` view, `Suppliers.tsx` | type field, archive |
| Supply order: receive + pay-now + remaining debt in one step | Partial | PO flow `purchase_orders` -> `receive_purchase_order`; invoice separate (`create_supplier_invoice`) | quick-supply function (R12); today receipt creates no debt |
| Pricing modes on supply (keep / new for added qty / apply to all) | Missing | `receive_purchase_order` only updates average cost | phase 4 |
| Weighted average cost | Have | `receive_purchase_order`, `register_devices` (round 2 dp) | T01 test; fix serial departures |
| Pay supplier from any drawer or wallet | Partial | `pay_supplier` methods cash/card/transfer/wallet; cash always PRD (`mirror_cash_movement`) | choose drawer/account (R13) |
| Supplier invoices checked against goods received | Better | `supplier_invoices.expected_amount`, approval on mismatch (0008) | keep |
| Approval on large payment | Better | `supplier_payment_threshold` 20,000 | keep |
| Supply log, cancel locked after later events | Partial | PO cancel (`cancel_purchase_order`) | rule R14 |
| Supplier report | Partial | `SupplierAccounts.tsx` | single ledger so paid column includes supply-time payments (T02) |

### A5. Customers, debts, KYC (S 0.4, 7)
| Volt function | Status | Where | Gap |
|---|---|---|---|
| Customer entity, categories, search, import/export | Missing | free text on invoices (`customer_name/phone`), repairs (`customer_name`, `customer_phone` regex) | `customers` (phase 1) |
| Five debt sources + credit balance, net debt | Missing | none | `customer_ledger`, `customer_balances` (R01) |
| Transaction history per customer | Missing | `RepairStatement.tsx` covers repairs by phone only | phase 1 |
| Collect debt into a chosen drawer or wallet | Missing | none | R28 |
| KYC (ID, address, guarantor, work, consent, images) | Missing | none | `customer_kyc`, private storage, owner/manager only |
| Marketing opt-out switch | Missing | none | column on customers |
| Duplicate protection | Better | Volt allows duplicates | warn on same phone |

### A6. Returns and warranty (S 4, 5)
| Volt function | Status | Where | Gap |
|---|---|---|---|
| Return by invoice / barcode / serial | Partial | `ReturnDialog.tsx` from an invoice, `create_return` (0009) | search by serial/barcode, standalone return screen |
| Condition at return (good back to stock, damaged not) | Partial | lines go to `inspection`; `resolve_return_line` later (Inventory tab) | condition at return time (R11); keep inspection for devices |
| Discount pro-rating | Have | `ratio = total / subtotal` in `create_return` | T12 (value-weighted, equals Volt on its example) |
| Refund method cash / wallet / credit | Partial | cash/card/transfer/wallet | credit-balance refund (needs customers) |
| Manual reduction of refund (floor = cost, manager) | Missing | none | R11 |
| Manual return without invoice | Missing (Volt: from source only) | none | decision G |
| Approval on large returns | Better | `return_approval_threshold` 2,000 (cashier needs owner) | keep, swap to PIN token |
| Returns archive and KPIs | Missing | list inside `Inventory.tsx` inspection tab | phase 6 |
| Warranty checker by IMEI | Partial | `trace_device` (Devices.tsx), `check_repair_warranty` (WarrantyChecker.tsx, repairs only) | one checker for sales + repairs, days not months (B13) |
| Warranty on sold device | Partial | `devices.warranty_until` from `variants.warranty_months` | days |

### A7. Maintenance (S 8)
| Volt function | Status | Where | Gap |
|---|---|---|---|
| Ticket intake (customer, brand/model, IMEI, problem, expected date/price) | Partial | `RepairIntake.tsx`, `repair_orders` (0011) | customer picker, brand list, expected price |
| Board of 5 columns | Better | `RepairBoard.tsx` groups our 10 statuses | never clicked through (BUILD-ORDER), verify in phase 0 |
| Status machine | Better | `repair_orders_flow_guard`, 10 statuses incl. customer approval, quote | map to Volt labels |
| Notes, spare parts, labour, total | Partial | `submit_repair_quote`, `repair_parts`, `repair_order_parts` | parts are a separate catalog with price only (no cost, no link to inventory): profit not computable (B11) |
| Parts deducted from stock | Partial | consumed when approved/available (`repair_consume_parts`) | own stock ledger `repair_part_movements`, not `stock_movements` |
| Close ticket with payment, warranty days, drawer = MNT | Partial | `deliver_repair`, `record_repair_payment` (cash -> MNT) | card/transfer/wallet into accounts (phase 7), partial pay -> debt (phase 8) |
| Partial payment becomes customer debt | Missing | delivery with balance only by owner/manager with reason | R16 |
| Cancel delivered ticket (reverse cash, parts, debt) | Missing | none | R17 |
| Reject + void rejected | Partial | `unrepairable`, `cancelled` | parts restored on cancel (`repair_sync_requests` path), verify |
| Receipts, warranty label, combined invoice | Partial | `CombinedInvoice.tsx` (print only), `lib/print.ts` | receipt and warranty label templates |
| Customer statement | Have | `RepairStatement.tsx` | by customer id |
| Templates | Partial | `repair_templates` (service lines: labour, warranty days) | Volt templates are brand lists; ours are service lines (different, both useful) |
| Lock code | Better | not stored (decision in BUILD-ORDER) | keep |
| Warranty search | Have | `check_repair_warranty`, `WarrantyChecker.tsx` | merge with device warranty |
| Repair profit in reports | Missing | `owner_summary` ignores repairs | R15 |

### A8. Trade-in (S 9)
| Volt function | Status | Where | Gap |
|---|---|---|---|
| Buy a used device from customer/supplier, 3-step wizard | Missing | none (`register_devices` mode `new` is the nearest) | phase 9 |
| Payment: drawer / wallet / credit / multi-source | Missing | | R18, R19 |
| Contract with seller ID snapshot, signed scan upload | Missing | | private storage |
| Cancel (owner/manager, reason, compensating entry) | Missing | | R18 |
| Report | Missing | | report 12 |

### A9. Installments (S 10)
| Volt function | Status | Where | Gap |
|---|---|---|---|
| Plan: price override with interest, down payment, n, period, schedule | Missing | none | R20 |
| Collect partial/full into a chosen drawer or wallet, receipt | Missing | | R21 |
| Cancel collection | Missing | | R21 |
| Manual installment | Missing | | R22 |
| Overdue rule (due date <= today), KPIs, by-customer view | Missing | | |

### A10. In / Out ledger (S 11)
| Volt function | Status | Where | Gap |
|---|---|---|---|
| Separate customer list and ledger | Missing | | decision F11: reuse `customers` |
| Ledger-only vs drawer-linked movements | Missing | | R31 |
| Cancel with audit copy | Missing | | |

### A11. Wallets, send/receive (S 12)
| Volt function | Status | Where | Gap |
|---|---|---|---|
| Wallet and machine accounts with limits (daily/monthly), min balance | Missing | `sales_payments.method` is only a label | `money_accounts` (phase 2/7) |
| Six send/receive modes with commission | Missing | | R22-R25 |
| Limit counting across sends, receives, transfers, withdrawals | Missing | | R26 |
| Pending rows and cancel pending | Missing | | |
| Wallet-to-wallet transfer | Missing | | |

### A12. Bills and machines (S 13)
| Volt function | Status | Where | Gap |
|---|---|---|---|
| Quick services, bill cash / credit, repeat 1-20 | Missing | | R27 |
| Machine operation (account + commission, drawer MCH) | Missing | | R27 |
| Log and report | Missing | | report 17 |

### A13. Expenses and withdrawals (S 15)
| Volt function | Status | Where | Gap |
|---|---|---|---|
| Immediate cash-out from a chosen drawer or wallet | Partial | `create_expense` + `pay_expense` (payable model; cash always PRD) | B7: source choice, one-step (R29) |
| Categories | Have | `expense_categories` (12) | rename to match if wanted |
| Approval above a threshold | Better | `expense_approval_threshold` 5,000 | keep |
| Undo | Better | none in Volt | add reversal (E) |

### A14. Employee accounts and attendance (S 18)
| Volt function | Status | Where | Gap |
|---|---|---|---|
| Salary ledger: accrual, pay, advance, bonus, deduction, correction | Missing | | R33 |
| Attendance (daily table, hours, delay, overtime) | Missing | | phase 10; Volt check-in not confirmed working |
| Team members with roles | Partial | `user_roles`, `profiles`, owner adds roles in app | create staff by phone, quick PIN |

### A15. Tax reminders (S 17)
| Volt function | Status | Where | Gap |
|---|---|---|---|
| Reminder list, chips, paid / reopen / delete, call/copy | Missing | | phase 10 (no money effect) |

### A16. Team and permissions (S 0.1)
| Volt function | Status | Where | Gap |
|---|---|---|---|
| Owner / manager / cashier / custom with 15 page toggles | Partial | 7 roles enforced by RLS (`roles.ts` is UI only) | per-user page overrides enforced in the database (phase 10) |
| Cashier defaults (dashboard, balances, inventory, in/out, expenses, attendance blocked) | Partial | `NAV` roles | match in the seed matrix |
| Manager PIN, lockout, one-time tokens, staff security screen | Better | 0015, `Security.tsx`, `ApproverPin.tsx` | wire into discount/refund/cancel |

### A17. Reports: all 18 (S 21, B Step 12)
| # | Volt report | Status | Our base | Note |
|---|---|---|---|---|
| 1 | Comprehensive | Partial | `owner_summary` (sales, returns, COGS, expenses) | add bills, maintenance, commissions, supplies, sources split (T37) |
| 2 | Sales | Partial | `sales_invoices`, `Transactions.tsx` | booked vs collected, top products |
| 3 | Returns | Partial | `sales_returns` | profit lost |
| 4 | Stock valuation | Missing | `stock_levels`, `variant_costs` | cost, expected sales, expected profit |
| 5 | Product movement | Missing | `stock_movements` | sales, returns, maintenance, supply per product |
| 6 | Expenses and withdrawals | Partial | `expense_balances` | by source and shift |
| 7 | Customer debts | Missing | needs phase 1 | five sources |
| 8 | Suppliers | Partial | `supplier_balances` | |
| 9 | Peak hours and days | Missing | timestamps exist | Cairo time, week starts Saturday |
| 10 | Time trends | Missing | | |
| 11 | Total capital | Missing | drawers + accounts + stock + debts | T37; add employee liability |
| 12 | Trade-in | Missing | phase 9 | |
| 13 | Employee accounts | Missing | phase 10 | |
| 14 | In/Out | Missing | phase 9 | |
| 15 | Installments and collection | Missing | phase 9 | |
| 16 | Send and receive | Missing | phase 7 | |
| 17 | Bills and services | Missing | phase 7 | |
| 18 | Maintenance | Missing | `repair_orders` + parts cost | needs B13 |

### A18. Notifications, tasks, control log (S 16, 19)
| Volt function | Status | Where | Gap |
|---|---|---|---|
| Notification bell (stock alerts, recent activity, shortage) | Missing | `approval_requests`, dashboard stats only | `notifications` table (phase 12) |
| Tasks and reminders | Missing | | `tasks` |
| Control log (balance operations only) | Partial | see A2 | B6 |
| Audit of everything | Better | `audit_log` append-only, `AuditLog.tsx`, `security_events` | keep |

### A19. Settings and printing (S 20)
| Volt function | Status | Where | Gap |
|---|---|---|---|
| Store data, invoice footers (7), invoice look, paper sizes, label sizes | Missing | `app_settings` is numeric only (0006) | `store_settings` jsonb (phase 13) |
| Module switches (wallets, maintenance, installments, bills) | Missing | | settings flags |
| Spec templates (= categories) | Missing | `categories` (name only) | phase 3 |
| Data reset / account deletion | Not wanted | | do not build |

### A20. WhatsApp (S 19)
| Volt function | Status | Where | Gap |
|---|---|---|---|
| Send invoice/receipt/status message | Partial | `CustomerContact.tsx` builds a message text for repairs; whatsapp digits helper in `lib/repairs.ts` | deep link everywhere (phase 13) |
| Campaigns with opt-out | Missing | | later, opt-out column in phase 1 |

### A21. Web catalog, idle lock, security
| Volt function | Status | Where | Gap |
|---|---|---|---|
| Public catalog | Better | `apps/storefront`, `catalog_items`, reserve-and-confirm orders, Turnstile + IP limit (0010) | Volt's catalog was disabled on the trial |
| Idle lock with PIN | Missing | `is_current_session_valid`, force logout (0015) | UI idle lock (phase 10) |
| Login by phone + password, 4-digit quick PIN | Different | email + password (`Login.tsx`), 6-8 digit manager PIN | keep; add cashier quick-switch (decision F13) |
| Rate limits, lockout, security events | Better | 0015 | extend to new functions |

---
## B. Corrections to earlier assumptions
Each item: what Volt really does (evidence) -> what the old plan or our code assumed -> change.

1. **Shift differences are a note and an alert, not an expense** (S 2.1, 2.3; B Step 5, 13). The count replaces the balance; nothing goes to expenses or profit. Our `close_shift` already replaces the balance by a ledger row (good) but nothing alerts the owner and old plan text says "owner alert" only in a table. Change: add `shift_alerts` + banner (R03); make sure `owner_summary` and every report never include `closing_adjust/opening_adjust`; `transactions_feed` shows `cash_session` rows as a feed line, keep it out of any profit total.
2. **Credit sale profit is split pro rata** (S 0.5; T08, T38). Old plan had no profit pools and `owner_summary` books full profit on the invoice date. Both views are right: reports show booked profit (Volt report 1 counts the full installment profit on the sale day), dashboard shows realised cash profit and deferred credit profit. Change: new `profit_origins` (phase 1) and a "realised" card; keep `owner_summary` as booked.
3. **Uncoded sale puts only profit in the drawer** (S 3.6; T09). Old plan: "needs reason, shows in daily report". Change: R07; the ledger row is `uncoded_profit`; the sale never touches stock; cannot be returned.
4. **Which drawer each money flow hits** (S 22). Our `mirror_cash_movement` sends every cash sale, refund, expense and supplier payment to PRD. Volt: expenses and supplier payments hit the drawer or wallet the user chooses; installment down payment goes to PRD but collection goes to the chosen drawer (default INS); trade-in cash default PRD but selectable; maintenance always MNT; bills MCH; wallet cash side WAL; debt collection chosen; employee payment chosen; in/out chosen incl. SAFE. Change: add `drawer_id` / `account_id` parameters to expense, supplier payment and refund functions; the trigger stays only for the default PRD case (phase 2).
5. **Customer debt has five sources, not seven** (S 0.4; T34). Old plan listed product, wallet, bills, maintenance, installments, manual, service. A manual installment is an installments debt; "service" is the bills source. Credit balances ("له") net against the products figure in Volt lists but the collect dialog shows the gross products figure (4,700 vs 4,200, B Step 10.9): inconsistent. Change: one ledger with `source` in (products, wallets, bills, maintenance, installments) plus `credit` entries; every screen shows gross per source and net, never mixes.
6. **The control log records only balance operations** (S 16; B Step 10.7). Old plan: "Control log: Have (audit)". Volt logs wallet opening balance, drawer transfer, wallet transfer, drawer add/withdraw/correct; NOT sales, send/receive, bills, installments, expenses, collections, supplier payments, trade-in, shift counts. Our `audit_log` records far more (row-level, append-only). Change: keep `audit_log`; add a screen "balance control log" that is a filtered view of drawer/account ledger kinds with before and after balances; do not copy Volt's omissions (E5).
7. **Expenses are an immediate cash-out, not a payable invoice** (S 15). Old plan marked Expenses "Have". Our model (0006): expense row, then `pay_expense`, approval status, `owner_summary` subtracts the booked total. Volt: one step, subtract from a chosen drawer or wallet, wallet limits apply. Change: add a "paid now" mode (R29); keep the payable mode for rent and supplier-style bills; net result uses expenses paid in the period (decision F9).
8. **Wallet send/receive has six modes and a fixed money matrix** (S 12; T23-T26). Old plan: "cash+wallet mode". Change: R22-R25. The old plan item "refill wallet from supplier" was not observed in Volt (not in S or B): drop it or confirm.
9. **Average cost must follow the units that leave** (S 0.6; T13). Our `variant_costs` updates on receipt and registration only. When a serial leaves through `write_off_device` or a count, the average stays stale. Change: for serial products compute valuation from `devices.cost` of `in_stock` units (we already store cost per unit; sale lines already use the average of the chosen devices, `create_sale` 0009); for plain products the moving average is unchanged by a removal at average cost.
10. **Returns: condition is chosen at return time** (S 4; T12). Ours sends every line to inspection first and `owner_summary` reverses COGS only after `resolve_return_line` marks it sellable, so the loss shows 140 until inspected, then 40. Volt shows -40 at once for a good item. Change: `create_return` takes condition per line; good goes to stock immediately; keep inspection as an optional state for serial devices. Profit effect of a damaged return is not stated in Volt (G): default = full refund is a loss (no stock back).
11. **Maintenance parts are inventory products with cost** (S 8.2, 8.3; T15). Ours: `repair_parts` has only `unit_price` and its own stock ledger, so repair profit (labour + price - cost) cannot be computed and parts are not in supply/valuation. Change: add `unit_cost` snapshot per consumed part (moving average at consumption) and either link `repair_parts` to `variants` or give it a receipt flow into the supplier ledger (phase 8). The label `labor_cost` in `repair_orders` is the customer's labour charge; keep the name or rename in a view.
12. **Delivery with a balance becomes customer debt** (S 8.3; T16). Ours: only owner/manager can deliver with a balance, with a written reason, no debt record (0018 `deliver_repair`). Change: allow it for cashier within a setting, create a maintenance debt, split profit pro rata (R16).
13. **Warranty is counted in days** (S 5, 8.3). Ours: `variants.warranty_months` and `devices.warranty_until = business_date + months`. Repairs already use days. Change: store days; show months as a helper (F14). The checker must search sold devices and repairs together; Volt's checker misses maintenance (B Step 7.10).
14. **Held baskets**: Volt does not restore the customer and works in retail mode only; ours stores customer, notes, discount (0020). Keep ours. Open question: Volt's list is per store, ours per user (G).
15. **Shift gate scope**: Volt blocks POS, wallets, maintenance, bills, returns, trade-in, balances and every inventory write without a shift (S 0.2). Ours gates only sales and functions that need a session. Change: gate every money function; inventory stock-only writes stay open (F3).
16. **Return approval**: Volt lets cashiers return freely; ours needs owner approval for cashier returns and manager returns at or above 2,000 (`return_approval_threshold`). Keep (Better), replace the owner round-trip by a PIN token where the owner is not present.
17. **Roles**: Volt custom permissions are 15 page toggles (S 0.1) and the spec does not prove the server enforces them. Ours are database roles. Change: per-user overrides stored in a table and checked inside functions (phase 10), not only in `NAV`.
18. **Time zone**: Volt shows supply-log and notification times in UTC (S header, B Step 3, 11.6). We use Cairo: `business_date` default uses `Africa/Cairo` (0006), `lib/time.ts`. No change, add a test that a sale at 23:30 Cairo lands on that Cairo date.
19. **Old plan counts "~17 reports"**: Volt has 18 (S 21). Table A17 lists all.
20. **Employee accounts are not expenses and not in capital** (S 18, T33, T37). Old plan: "dues, advances, payments". Change: R33; we add the liability to our capital report as its own line (E12).

---
## C. Business rules to implement
Format: rule, formula, worked example, vector. "Booked" profit = on the document date; "realised" = on money received.

**Ledger design used by all rules.** Every operation writes one `money_events` header (id = group id, kind, ref, shift, actor, idempotency key, reversed_by) and its lines: `drawer_movements` (existing), `account_movements` (wallets/machines, new), `customer_ledger`, `supplier_ledger` entries, `profit_entries`. Undo = `reverse_money_event` writing compensating lines in the current shift.

R01 **Customer debt** = sum of ledger entries per source (products, wallets, bills, maintenance, installments); credits are negative entries; net = sum of sources - credits. Example T34: 4,200 + 405 + 105 + 150 + 5,850 = 10,710.
R02 **Profit pools.** For an origin (sale, maintenance, installment plan, bill, wallet op) with `profit P`, `total T`, `paid_now p`: cash = round(P*p/T, 2), credit = P - cash. A collection `c` of that origin's debt `D0` realises round(credit_pool*c/D0, 2) (last collection takes the remainder); cancelling restores exactly. T08: P=700, T=5,700, p=1,000 -> 122.81 / 577.19. T38 replays the whole scenario.
R03 **Shift count differences.** Counted replaces balance; difference = counted - expected, stored on the shift, ledger row `opening_adjust`/`closing_adjust`, alert when negative, never an expense or profit. Skipped drawer keeps its balance and is excluded from the counted total. T04, T05.
R04 **Shift close snapshot** stores stock value at cost = sum(on hand x average cost, serial: sum of in-stock device cost). T05 (1,960).
R05 **Credit sale.** Needs a customer. Payment legs: cash (drawer), account (wallet/machine), credit. Debt = total - sum(paid legs). Cash legs only reach PRD. T08: PRD +1,000, products debt +4,700.
R06 **Multi-pay.** Legs must sum to the invoice total; credit leg counts as debt. Cash -> PRD, wallet/machine leg -> that account's balance (Volt behaviour not observed, G). T11.
R07 **Uncoded sale.** Cash only; inputs name, cost c, price p, reason; drawer PRD +(p - c); profit +(p - c); no stock; not returnable. T09: 120, 80 -> +40.
R08 **Wholesale.** Mode picks `wholesale_price` (fallback retail); line records the price used. T10: 5 x 30, profit 50.
R09 **Discount rule.** Line price may not fall below unit cost unless a manager PIN token is used; fixed discount <= invoice profit; percent <= 100; discount <= total. T07: 6,000/5,000 -> 1,000 ok, 1,001 blocked.
R10 **Offer.** Percent discount = min(percent x total, cap); applied at cart level; removable. T11: min(30, 20) = 20.
R11 **Return.** Refund per line = unit price - invoice discount x (line value / subtotal) (equals Volt's qty share on its example); manual reduction only manager/owner, floor = unit cost; condition good -> stock +qty, damaged -> no stock; cash refund -> PRD; method "credit" only with a customer; profit effect = -(refund - cost) for good items. T12: 150 - 10 = 140, effect -40.
R12 **Quick supply.** One call: lines (product, qty, cost, serials), pricing mode, payment source (drawer, account, none), paid now <= total. Writes stock/devices, supplier debt = total - paid, drawer/account movement, average cost. T01, T02.
R13 **Supplier payment** from a chosen drawer or account; amount <= debt; source balance >= amount; wallet usage counts toward limits. T02.
R14 **Supply cancel** allowed only while no later event touches the order (payment, sale of the received units, count); otherwise use a supplier return/adjustment. Volt locks it; unstated detail in G.
R15 **Maintenance profit** = labour + sum(part price - part cost). T15: 100 + (40-20) = 120. Report net = revenue - parts cost.
R16 **Maintenance close.** Paid p <= total T into MNT (cash) or the chosen account; debt T - p (maintenance source); profit pools by R02. Warranty end = start + days. T15, T16.
R17 **Cancel delivered maintenance.** Parts back to stock at their recorded cost, cash taken back from MNT, debt zeroed, ticket back to in progress, profit reversed. Manager PIN. T17.
R18 **Trade-in cash.** Stock +1 serial at price paid, no supplier, drawer/wallet -price, no profit until sold; contract snapshot of seller ID; cancel owner/manager, reason <= 500, compensating entry in the current shift. T18.
R19 **Trade-in on credit.** Customer debt reduced by the amount (FIFO origins) or credit stored if no debt; realises pools by R02. T19: 577.19 x 500/4,700 = 61.40.
R20 **Installment plan.** Total (price + interest) T, down d, n, period; installment = (T - d)/n, last takes the rounding remainder; due dates step by the period from the first date (month-end clamp); down payment -> PRD; debt T - d; booked profit T - cost; overdue = due <= today. T20.
R21 **Installment collection.** Amount <= remaining, > 0; drawer chosen; reduces debt; realises pool; cancel reverses all four (drawer, debt, row status, pool). T21.
R22 **Wallet instant receive** A, commission C: wallet +A, WAL -(A - C), profit +C. T23.
R23 **Wallet instant send**: wallet -A, WAL +(A + C), profit +C. T24.
R24 **Send on credit**: wallet -A, WAL 0, wallets debt +(A + C), profit +C deferred. T25.
R25 **Receive on credit**: wallet 0, WAL -(A - C), wallets debt +A, status pending, cancel reverses. T26. Modes "customer to wallet (credit)" and "cash received, send later" are customer-credit modes whose formulas were not observed (G).
R26 **Wallet limits.** Daily/monthly used = sends + receives (when the wallet moves) + transfers out + withdrawals/expenses from it; new operation refused if used + amount > limit; WAL must hold the cash for receive. T27.
R27 **Bills and machines.** Cash bill: account -cost, MCH +(cost + C), profit C. Credit bill: account -cost, bills debt +(cost + C), profit deferred. Machine operation: account +(A + C), MCH -A, profit C. T28.
R28 **Debt collection.** One source per collection; amount <= that source's balance (and <= net); chosen drawer or account; realises pools FIFO by origin; T32. Allocation order when many origins is not stated (G); default oldest first.
R29 **Expense / withdrawal.** Paid-now: chosen drawer or wallet - amount; wallet counts toward limits; category; no approval below the threshold (ours: keep 5,000). T30.
R30 **Drawer adjustment types.** opening, correct (set), add, withdraw; reason required for all but opening; large ones need a PIN token. T29.
R31 **In/Out.** Ledger-only changes only the customer's in/out totals; drawer-linked also moves the chosen drawer; cancel reverses once and keeps a copy. T31.
R32 **Debt and credit netting display** never hides a source: show gross per source, credits, net.
R33 **Employee ledger.** Monthly accrual on the due day up to today; pay/advance take cash from a chosen drawer and reduce the balance; bonus adds; deduction subtracts; correction +/-; balance > 0 = store owes the employee. Not an expense. T33.
R34 **Stock loss** (count shortage, damaged, lost serial, parts used) removes stock at cost, no cash; not in profit (Volt); we also report it as its own line (E9). T13, T14.
R35 **Bundle.** market = sum(price x qty); cost = sum(cost x qty); margin = price - cost; saving = (market - price)/market; stock = min over components of floor(stock/qty). T35.
R36 **Warranty.** End = sale date + product warranty days; maintenance end = delivery date + days. T36.
R37 **Capital** = drawers + SAFE + accounts + stock value + customer debts - customer credits - supplier debts (and our extra line: - employee liability). T37.
R38 **Idempotency, shift, PIN, rate limit** on every money function (T40).

### C-bis. Money effect per operation (drawer by drawer)
`+/-` is the drawer ledger; "acct" = wallet or machine account; "debt" = customer ledger; "sup" = supplier ledger.
| Operation | Drawer effect | Account / debt | Stock | Profit |
|---|---|---|---|---|
| Shift open / close count | counted drawer: row for (counted - expected) | account counted at close replaces balance | none | none, alert if short |
| Cash sale | PRD +total | none | -qty | booked and realised |
| Credit sale (paid p of T) | PRD +p | products debt +(T - p) | -qty | booked P; cash P*p/T |
| Multi-pay | cash leg PRD; wallet/machine legs go to that acct (unverified) | credit leg = debt | -qty | by legs |
| Uncoded sale | PRD +(price - cost) | none | none | +(price - cost) |
| Return (cash) | PRD -refund | none | +qty if good | -(refund - cost) |
| Return (wallet / credit) | none | acct -refund / customer credit +refund | +qty if good | same |
| Quick supply (paid p from drawer D) | D -p | sup +(T - p) | +qty, avg cost | none |
| Supplier payment | chosen drawer -x (or acct -x) | sup -x | none | none |
| Expense / withdrawal | chosen drawer -x | or acct -x | none | subtracts in net result |
| In/Out ledger-only | none | customer in/out totals | none | none |
| In/Out drawer-linked | chosen drawer -/+x | totals | none | none |
| Maintenance close (cash p of T) | MNT +p | maint debt +(T - p); or acct +p | parts out earlier | labour + (price - cost) |
| Maintenance cancel delivered | MNT -paid | debt zeroed | parts back | reversed |
| Trade-in cash | chosen drawer -price (default PRD) | none | +1 serial | none |
| Trade-in wallet | none | acct -price | +1 | none |
| Trade-in credit | none | debt -x or credit +x | +1 | realises pool |
| Installment plan | PRD +down | installments debt +(T - down) | -qty | booked T - cost |
| Installment collection | chosen drawer +x (default INS) or acct +x | debt -x | none | realises pool |
| Debt collection | chosen drawer +x or acct +x | that source -x | none | realises pool |
| Wallet instant receive | WAL -(A - C) | acct +A | none | +C |
| Wallet instant send | WAL +(A + C) | acct -A | none | +C |
| Wallet send on credit | none | acct -A; wallets debt +(A + C) | none | +C deferred |
| Wallet receive on credit | WAL -(A - C) | wallets debt +A | none | see G |
| Wallet to wallet | none | from -x, to +x; counts to source limit | none | none |
| Machine operation | MCH -A | acct +(A + C) | none | +C |
| Bill cash | MCH +(cost + C) | acct -cost | none | +C |
| Bill credit | none | acct -cost; bills debt +(cost + C) | none | +C deferred |
| Drawer transfer | from -x, to +x | none | none | none |
| Drawer adjust (add / withdraw / correct) | +x / -x / set | none | none | none |
| Wallet opening balance | none | acct = amount (logged) | none | none |
| Employee pay / advance | chosen drawer -x | employee balance -x | none | none (not an expense) |
| Stock count, damaged, lost serial | none | none | -qty at cost | none |
| Undo of any of the above | exact compensating rows, current shift | | | pools restored |

---
## D. Phased build plan
Order: foundations (customers and debts, drawers wiring, catalog, supplier ledger), selling and returns, wallets/bills/machines, maintenance completion, installments / in-out / trade-in, people, reports, notifications, settings/printing/WhatsApp, offline and multi-branch.
Each phase ends with its tests green on staging (rolled-back SQL files, as now) and a short click-through. Sizes: S under 1 week, M 1-2 weeks, L 3-4 weeks, XL more.

### Phase 0: stabilise what we built (S)
- Goal: trust the base before adding to it.
- Do: commit migrations 0011-0020, tests, `lib/drawers.ts`, repair components. Click through on staging with real logins: shifts screen (open, close with difference and note, transfer, adjust with PIN), maintenance board and repairs tabs (intake, quote, approval, parts, payment, delivery, statement, templates, combined invoice, warranty checker). Apply 0020 on staging and run a SQL test for it (hold, resume, cap of 20, cashier sees only own).
- Fix list found while reading: add idempotency key to `create_sale`; revoke `open_cash_session`/`close_cash_session`; remove the first-active-branch shortcut from new code (take branch from the user's role row); make `repair_orders` cancel return parts (verify).
- Tests: existing 13 files, plus `held_baskets_test.sql`.
- Security: re-run `get_advisors` (security) after each migration; RLS on `held_baskets` already set.
- Needs verification: shifts screen and all maintenance screens were typechecked, never clicked (BUILD-ORDER).
- Depends on: nothing.

### Phase 1: customers, KYC, debts and profit pools (L) (foundation 1)
- Goal: one customer record and a five-source debt ledger that sales, maintenance, installments, wallets and bills will use.
- Database (`0021_customers.sql`):
  - `customers` (name, phone unique-warn, category_id, notes, marketing_opt_out, archived_at), `customer_categories` (name <= 80, delete only when unused), `customer_kyc` (ID type/number/expiry, address, city, second phone, emergency, guarantor fields, employer, job, income, consent flag + date, image paths in private storage).
  - `money_events` header and `customer_ledger` (append-only: customer_id, source, amount signed, kind sale_credit / collection / credit_note / reversal / adjustment, ref, session, event id). View `customer_balances` (per source, credits, net).
  - `profit_origins` (origin type/ref, booked profit, total, debt0, cash_pool, credit_pool, customer, status) and `profit_entries`; function `realise_profit(origin, amount, sign)` implementing R02 with the remainder rule.
  - Functions: `create_customer` (duplicate phone warning), `update_customer`, `archive_customer`, `save_kyc`, `collect_customer_debt(customer, source, amount, drawer|account, idem)` (R28), `reverse_money_event(event, reason, override)`.
  - Link: add `customer_id` (nullable) to `sales_invoices`, `repair_orders`; backfill by exact phone match; keep text columns as snapshot.
  - RLS: staff read name/phone/net; KYC only owner/manager; ledger read owner/manager/accountant and cashier for own customer view; writes only by functions.
  - Idempotency: every function takes a uuid key. Rate limit: 30/min for collection and reversal. Audit: triggers on all tables. PIN: debt adjustment, write-off, reversal of a collection.
- Screens: `Customers.tsx` (list with five debt columns and net, KPIs, categories, search, import/export CSV, row menu), customer dialog with KYC tabs, history per source with CSV, collect-debt dialog, customer picker component used by POS and repairs (replace free text in `RepairIntake.tsx`).
- Tests: `customers_test.sql` using T34, T32 (balances part), T38 rows for R02 including cancel; `rls` checks that cashier cannot read KYC.
- Security notes: KYC images in a private bucket with signed URLs; never in `audit_log` payloads (audit_row copies row JSON: exclude KYC number from audit or hash it).
- Depends on: phase 0.

### Phase 2: drawers wiring, accounts and shift upgrades (L) (foundation 2)
- Goal: every money flow chooses its drawer or account and is undoable; shifts alert.
- Database (`0022_money_flows.sql`):
  - `money_accounts` (kind wallet/machine, name, phone/code, daily_limit, monthly_limit, min_balance, color, active) + `account_movements` (append-only) + `account_balances`, `account_usage(account, day)` for limits. Opening balance row (logged, no drawer).
  - Extend `drawer_movements.kind` with: `uncoded_profit, debt_collection, installment_down, installment_collection, tradein, tradein_cancel, wallet_cash, bill_cash, machine_cash, inout, employee, reversal`.
  - Payment source type: `(drawer_id | account_id)` argument added to `create_expense`/`pay_expense` (paid-now mode), `pay_supplier`, refunds, repair payments. Trigger `mirror_cash_movement` keeps default PRD only when no source given.
  - `adjust_drawer` gets type (opening/correct/add/withdraw); `balance_control_log` view (drawer + account kinds that Volt logs, with before/after via window sum).
  - `shift_no` sequence; `shift_alerts` (shift, drawer/account, amount, reviewed_by/at); close_shift/open_shift write alerts for negative differences; closing snapshot adds stock value, receivables, payables (R04). Close step 2 for accounts (count or skip).
  - Gate: `require_open_shift()` on all money functions; setting `require_open_shift` kept.
- Screens: Cash.tsx: "open for employee" select (function already has `p_for`), account step in close wizard, numeric difference column, print shift report; dashboard banner "shortage" with review button; Balances page (drawer cards, accounts cards with limit bars, transfer between accounts, adjust types); Control log screen.
- Tests: extend `drawers_test.sql` with T05, T29, T39 (drawer replay up to this phase); `account_test.sql` (limits R26, opening balance); idempotency and PIN vectors T40.
- Security: PIN token for large adjustments stays; accounts RLS read for owner/manager/accountant/cashier (balance only), writes by function; rate limits `drawer_move` shared.
- Depends on: phase 1 (money_events, reversal).

### Phase 3: catalog: categories, templates, units, pricing (M) (foundation 3)
- Goal: products as Volt shops expect, without breaking variants.
- Database: `category_templates` + `template_fields` (type short/long text, number, yes-no, list; required; internal), values in `variants.attributes jsonb`; `units` (21 Arabic units, locked for serial products); `products.tracking_mode` (none / imei / internal serial); `variants.wholesale_price`, `reorder_level` default 5; barcode generator function; `price_overrides` not needed. IMEI-mode serial check (15 digits + Luhn) while internal mode accepts any unique code.
- Screens: Products dialog with template fields, quantity = serial count rule (counter n / qty), category manager, CSV/Excel export and import (preview, row errors), labels (barcode/price, 50x28 default) via `printDocument`, price list.
- Tests: `catalog_test.sql` (tracking mode vs quantity, template required field, unique barcode, wholesale price), T03.
- Security: import is a function with row cap (5,000) and size limit; cost fields hidden from roles without `CAN_SEE_COST`.
- Depends on: phase 0. Can run in parallel with phase 2.

### Phase 4: supply, supplier ledger, average cost, losses and counts (L) (foundation 4)
- Goal: one-step supply with payment and debt, accurate cost, and the loss workflows.
- Database (`0023_supply.sql`): `receive_supply(supplier, lines, pricing_mode, source, paid, idem)` (R12) creating a `supplier_invoice` + stock + devices + payment event; `supplier_ledger` view from invoices and payments (single "paid" figure, T02); pricing modes keep / new-for-added / apply-to-all; `variant_costs` recompute for serial products from `devices.cost` (B9); `stock_counts`, `stock_count_lines`, `stock_count_scans`, `approve_stock_count` (reasons: damaged, missing, stolen, entry error, surplus; unscanned serial -> `missing`); `damaged_items` view/table with reason, employee, supplier-return flag; `shortage_book`; supplier type goods/services; archive. PO flow stays for approval-heavy purchases and calls the same receive core.
- Screens: Supply wizard (3 steps), supply log with invoice print, supplier page with pay dialog (source select with balances), damaged items tab, stock count (start, scan, manual list, review, approve), shortage book.
- Tests: `supply_test.sql` (T01, T02, T13, T14, supply cancel rule R14), existing `purchasing_flow_test`, `supplier_ledger_test` still pass.
- Security: approval for supplier payment >= 20,000 stays; stock-count approval needs manager; counts irreversible except by a new adjustment with reason (E).
- Depends on: phases 2 (sources) and 3.

### Phase 5: selling (POS rebuild) and held baskets (L)
- Goal: the cashier screen.
- Database (`0024_pos.sql`): `create_sale` v2 (idempotency key, customer_id, price mode, line price with floor check, payment legs incl. credit and accounts, offer id, uncoded flag); `offers` (percent+cap / fixed / buy X get Y, dates, max use), `bundles`, `bundle_items`; `uncoded_sales` (name, cost, price, reason); apply 0020 and extend it with customer_id; `void_sale` (same shift, PIN, compensating events) optional; sales log view with `paid`, `credit`, `cash_profit`.
- Screens: new `Pos.tsx` (grid, cart, scan, retail/wholesale toggle, discount dialog with live before/after, offers tab, bundles tab, payment buttons cash / credit / multi, uncoded dialog, tax/service receipt dialog, held baskets list and resume), sales log with period/type/shift filters and customer statement, invoice with previous balance. Wire `ApproverPin` into discount below floor.
- Tests: `pos_test.sql`: T06-T11, T08 (debt, pools, PRD), T39 up to the sale steps, T40; keep `sales_expenses_cash_test` green.
- Security: price and discount only through the function; rate limit 60/min; serial uniqueness server-side; negative-stock block (already in `apply_sale`).
- Depends on: phases 1-3.

### Phase 6: returns and warranty (M)
- Goal: returns with condition, credit refund and one warranty checker.
- Database: `create_return` v2 (condition per line, refund method incl. credit, manual reduction with floor and role check, profit effect stored); search by invoice/barcode/serial; days-based warranty (migrate months x 30); `check_warranty(term)` merging `devices` and `repair_orders`; returns archive view.
- Screens: Returns page (new return, warranty checker, archive, KPIs: today, pending supplier, week, shift), receipt `RET-...`.
- Tests: T12, T36 + existing `returns_test`.
- Security: manager PIN for manual reduction; approval thresholds kept.
- Depends on: phases 1, 5.

### Phase 7: wallets, bills, machines (L)
- Goal: send/receive, bills and machine operations on top of `money_accounts`.
- Database: `wallet_operations` (direction, mode, amount, commission, customer, status, event id), `process_wallet_operation` for 4 verified modes (R22-R25) and the 2 unverified modes behind a setting; `cancel_pending_wallet_operation`; `transfer_between_accounts`; `bill_services` (quick services), `pay_bill` (cash/credit, repeat count), `machine_operation`; daily/monthly limit check function reading `account_usage`.
- Screens: Send/Receive (form with live limit remaining, log), Bills (quick services chips, pay form, log), Balances (accounts, add wallet/machine), all with readable errors.
- Tests: `wallets_test.sql`: T23-T28, T26 cancel, T27 limit, T39 wallet part.
- Security: customer mandatory for credit modes; PIN above a threshold for large operations; rate limit 30/min.
- Depends on: phases 1, 2.

### Phase 8: maintenance completion (M)
- Goal: connect the built maintenance module to money, cost and customers.
- Database: `repair_order_parts.unit_cost` snapshot; link `repair_parts` to `variants` (or supply flow for parts); profit per order in a view; `deliver_repair` v2 (debt, pools, non-cash into accounts); `cancel_delivered_repair` (R17, PIN); customer_id on orders; brand list table; expected price field.
- Screens: Repairs/Maintenance: customer picker, brand/model, close-and-pay dialog with method accounts, cancel with PIN, receipt and warranty label print, statement by customer.
- Tests: extend `repair_money_test.sql` (13 checks now) with T15-T17; maintenance report vector T37.
- Security: lock code still not stored; delivery with debt limited by setting.
- Depends on: phases 1, 2, 4 (cost), 7 (accounts).
- Verification still needed: board drag/status mapping, parts consumption on approval, statement CSV.

### Phase 9: installments, in/out, trade-in (L)
- Goal: the three remaining money modules.
- Database: `installment_plans`, `installments` (schedule, paid, status), `create_installment_plan` (R20), `collect_installment` / `cancel_installment_collection` (R21), manual installment; `inout_entries` (ledger-only or drawer-linked, cancel with audit copy) on `customers`; `trade_ins` + `create_trade_in` (modes drawer / wallet / credit / multi), `cancel_trade_in` (cash only by default; credit with PIN), `trade_in_contracts` (ID snapshot, signed scan path).
- Screens: Installments (KPIs, by installment / by customer, collect dialog, receipt), In/Out, Trade-in wizard + contract print + upload.
- Tests: T18-T22, T31, T38 rows for installment, T39 full replay.
- Security: owner/manager for trade-in cancel; contract images private; seller ID required (F12).
- Depends on: phases 1, 2, 5.

### Phase 10: people: accounts, attendance, tax, permissions, idle lock (M)
- Database: `employee_accounts`, `employee_ledger` (accrual job by Cairo date, ops pay/advance/bonus/deduction/correction), `attendance_employees`, `attendance_records` (hours, delay, early leave, overtime), `tax_reminders`, `user_page_permissions` + `has_page(page)` used by functions and RLS for the 15 pages, staff creation by Supabase admin function (edge) with phone + password + optional quick PIN.
- Screens: Employee accounts, Attendance (daily, employees, reports), Tax reminders, Team + permission matrix, idle lock (lock after N minutes, unlock by PIN or password, signs out after M).
- Tests: T33; permission checks per page; accrual idempotency (run twice, one accrual).
- Security: salary data owner/manager/accountant only; idle lock is UI, session validity stays in the database (`is_current_session_valid`).
- Depends on: phases 2, 5.

### Phase 11: reports and dashboard (L)
- Goal: the 18 reports and the dashboard cards.
- Database: report functions (security definer, role checked, date range <= 400 days like `owner_summary`), `dashboard_summary` (drawers, cash profit, credit profit, customer debt, supplier debt, accounts with usage, banners), views per report; all on Cairo dates.
- Screens: Reports hub, each report with period/shift/employee filters, CSV and print, click through to source records (E).
- Tests: `reports_test.sql` rebuilds the scenario and asserts T37, T38, T39 final state (17,230).
- Depends on: phases 1-10 (each report as its module lands; 1-6 and 11 first for reports 1-5, 7, 8).

### Phase 12: notifications, tasks, alerts (S)
- `notifications` (kind: stock low, shift shortage, overdue installment, due tax, supplier payment, debt), per-user read state, `tasks` (title, details, priority, remind_at); dashboard banners from the same tables; mark all read; Cairo times.
- Tests: generation rules (low stock at or below `reorder_level`, overdue = due <= today).
- Depends on: phases 2, 9, 10.

### Phase 13: settings, printing, WhatsApp (M)
- `store_settings` jsonb (store data, tax number, module switches, 7 footer texts, invoice theme options, paper sizes 58/80/A4/A5/custom, label sizes 58x40/50x40/50x28/38x25); templates in `lib/print.ts`; spec-template editor already in phase 3; WhatsApp: deep link (`wa.me`) buttons on invoice, receipt, repair status, installment receipt; campaigns later through the official business API only, with `marketing_opt_out` and daily cap.
- Tests: template rendering snapshot, opt-out honoured.
- Depends on: phase 5 and later for each printable.

### Phase 14: offline POS and multi-branch (XL)
- Multi-branch first: replace the "first active branch" lookup everywhere with the user's assigned branch (`user_roles.branch_id`), branch on drawers/shifts/accounts/stock, branch transfer (`transfer_in/out` already exist in `movement_type`), per-branch reports.
- Offline: service worker + IndexedDB queue of sales/returns/holds, each with its idempotency key (exists from phase 5), price snapshot, sync order by timestamp, server rejects on serial already sold or stock short and returns a conflict list for the cashier; no offline for PIN overrides, supplier payments or transfers.
- Tests: replay a queued day twice (idempotent), conflict cases.
- Depends on: phase 5 and 11.

**Where the existing pieces land:** held baskets (0020) -> phase 0 apply + phase 5 screen. Shifts screen -> phase 0 verify, phase 2 extend. Maintenance screens -> phase 0 verify, phase 8 complete. Security screen -> phase 0 verify, phase 10 extend. Storefront -> unchanged (Better).

---
## E. Where we should be better than Volt
| # | Volt weakness (evidence) | Our approach |
|---|---|---|
| E1 | Supply log and notifications in UTC while POS is Cairo (S header, B Step 3, 11.6) | all timestamps shown with `formatCairo`; `business_date` in Cairo; test T-time at 23:30 |
| E2 | Raw codes in toasts: `INSUFFICIENT_DRAWER_BALANCE`, `insufficient_funds:...`, `pending`, `waiting_parts` (S 0.9) | map every function error to Arabic text in one table (`lib/errors.ts`) |
| E3 | Balances stale until reload (B Step 10) | TanStack Query invalidation after each mutation (pattern already used) |
| E4 | Sales log "total" shows only the cash received for credit sales, profit shows the cash share (S 3.5, T08) | show total, paid, debt, booked profit and realised profit as separate columns |
| E5 | Control log omits sales, collections, supplier payments, trade-in, shift counts (S 16) | `audit_log` (append-only) already covers rows; add the balance log view plus a full "money events" view |
| E6 | Some records cannot be undone: completed wallet ops, bills, machine ops, expenses, supplier payments, drawer moves, employee payments, returns, counts (B Step 14) | `reverse_money_event` for all, compensating rows, reason, PIN above a threshold, always in the current shift, original kept |
| E7 | Quantity vs serial: product quantity must equal the number of typed IMEIs, no IMEI format check, internal ids look like IMEIs (S 6.1; B Step 8.1) | tracking mode explicit; IMEI mode validates 15 digits + Luhn; internal mode allowed and labelled |
| E8 | Shift close: no confirmation, skipped drawers dropped from the total, no numeric difference column, report button does nothing (B Step 13) | confirmation with summary, numeric differences, printed report, reviewer sign-off on alerts |
| E9 | Stock shortage, damaged and lost serials never reach profit reports (B Step 12 report 1 note) | separate "stock losses at cost" line in the owner report and capital change; net result unchanged unless the owner chooses (F8) |
| E10 | Capital formula ignores employee liability (B report 11 vs 13) | extra liability line (R37) |
| E11 | Supplier report "paid" misses payments made inside the supply (B report 8) | one supplier ledger, T02 |
| E12 | Duplicate customers allowed, KYC unvalidated (B Step 4, 9b) | duplicate phone warning, optional merge, ID number length check for national ID |
| E13 | Maintenance warranty not found by the warranty checker; lock code shown on the ticket (B Step 7, 7.10) | one checker; lock code never stored |
| E14 | Maintenance cancel after delivery returns cash but customer credit unclear (B Step 14) | explicit choice: cash back or credit, shown in the confirmation |
| E15 | Credit trade-in cannot be cancelled; multi-source cannot be reversed (S 9) | compensating reversal per leg with PIN |
| E16 | Collect-debt tile click did not register; deposit drawer pre-selected silently (B Step 10.9) | explicit required selection, shown balance after |
| E17 | Balances KPIs (profit/receive/send today) undecodable (S 14) | each KPI defined in one SQL view with a stated formula |
| E18 | Permissions seen are page toggles; server enforcement unproven (S 0.1) | RLS and function checks per role and page |
| E19 | No drill-down from reports | every report row links to its record |
| E20 | Single store only | branch-aware schema (phase 14) |
| E21 | Idempotency, rate limits, PIN lockout not observed in Volt | already in our functions; extend to every new one |

---
## F. Owner decisions needed (recommended default first)
1. **Uncoded sale**: drawer gets profit only (Volt) or full price? Default: Volt rule behind a setting, reason and cost recorded, manager PIN above 1,000.
2. **Credit sales**: customer mandatory, credit limit per customer? Default: customer mandatory, limit field per customer (0 = no limit), PIN to exceed.
3. **Shift gate on stock-only inventory writes**? Default: gate only money-moving functions; allow add product and count without a shift.
4. **Cashier powers**: discount below cost floor, returns, manual refund reduction. Default: below-floor and reduction need manager PIN; returns allowed up to 2,000 without approval after a PIN.
5. **Dashboard profit**: show realised cash and deferred credit (Volt) next to booked profit? Default: both, labelled.
6. **Batches / FIFO** needed? Default: no lots; moving average per variant, per-unit cost for serials (matches Volt's average).
7. **Installment interest**: flat markup on total (Volt) or rate and late fees? Default: flat markup, no late fee.
8. **Stock losses in net result**: Volt excludes them. Default: show as a separate line, net result excludes, toggle in settings.
9. **Expenses in net result**: paid in period (Volt) or booked? Default: paid in period; payable bills shown separately.
10. **Wallet and bills limits**: Volt counts sends, receives, transfers and withdrawals against one limit. Default: same.
11. **In/Out customers**: separate list (Volt) or the main customers table? Default: main table with a flag.
12. **Trade-in**: seller national ID and signed contract mandatory? Default: yes for any price (stolen-device protection).
13. **Cashier login**: separate staff accounts with quick PIN switch at the till? Default: yes, 4-6 digit till PIN stored hashed, distinct from the manager PIN.
14. **Warranty unit**: days (Volt) or months? Default: days.
15. **WhatsApp**: deep links now, official business API later? Default: yes; no unofficial session automation.
16. **Cash / safe handling**: who may touch SAFE? Default: owner and manager only (already so).

---
## G. Risks and what could not be verified in Volt
Copied from S section 23 and grouped; handling for each.
| Group | Not verified (reason) | How we handle it |
|---|---|---|
| Access and security | team creation, cashier login, permission overrides in action, idle lock, PIN unlock, logout flows (passwords forbidden) | build to our own rules (phase 10); do not claim Volt parity; test idle lock ourselves |
| Output | printing, PDF, CSV/Excel import/export, labels, WhatsApp send/campaigns/link, public links page, digital catalog (forbidden or disabled) | design our own templates; wa.me links; test print on the real paper and label printer before phase 13 closes |
| Receipt-only dialogs | tax/service invoice not submitted (S 17, A 4) | build as no-effect receipt; confirm with owner what the paper must contain |
| Attendance | check-in/out not recorded in two tries | build from the visible columns (required, done, delay, early, deficit, overtime); owner to confirm formulas |
| Wallets | modes "customer to wallet" and "cash received, send later", bill/purchase paid by wallet or machine, supplier payment from a wallet, POS wallet payment, wallet refund | implement the four verified modes first; the others behind a setting with our own consistent formula (customer credit) and an owner sign-off |
| Maintenance | ticket edit button, drag and drop, wallet/machine payment on close, full credit close | build our own; test with owner |
| Profit pools | arithmetic after undo, receive-on-credit commission, debt-collection pool shift (+5/-5 observed), balances KPIs undecodable | R02 is our definition; accept that our pool numbers may differ from Volt on these cases; show formulas in the UI |
| Lists | category deletion, archive/restore of customers/suppliers, stock "deleted items" log | archive with restore; no hard delete |
| Stock | stock-count types partial/smart, offer types fixed/buy-X-get-Y, offer bundles, price-list printing, units other than piece | implement from the visible labels; confirm rules with owner |
| Supply and returns | supply cancel (button locked), supplier "services" type, manual return without invoice | R14 rule; manual return behind manager PIN and a warning |
| Notifications and plan | rules beyond three kinds seen, trial expiry | our own rules in phase 12; no subscription system (not copied on purpose) |
| Our own open points | multi-line return discount (qty vs value share); which origin a collection pays first; wallet/machine legs in POS multi-pay; profit effect of a damaged return; whether held baskets are per user in Volt (spec silent) | defaults in R11, R28, R06, B10, B14; each gets a test and is listed for owner review |
| Evidence limit | everything came from one trial store with one employee and no real customers; numbers are single observations | test vectors pin only observed numbers; formulas marked "ours" are labelled |
