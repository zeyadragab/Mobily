# Volt parity plan — our own version, every function

Source of facts: Volt 3.0 (Store package) read from its shipped files, its public pages and a live walk-through of an empty trial account on 2026-11-10 (notes and screenshots in `D:\Work\volt-study\`, outside this repo).
Rule: we copy **functions and workflows**, never Volt's code, name, logo, mascot or Arabic texts. Everything below is our own implementation on our stack (Supabase + React admin).
Status key: **Have** = already in this repo · **Partial** · **Missing** · **Done** = built, not yet run on a real DB.
"Better" = what we do beyond Volt.

## Phase 0 — foundation (Done in code)
| Function | Status |
|---|---|
| Roles, branches, audit log, approvals engine | Have |
| Rate limits, shift gate, manager PIN + lockout, override tokens, security log, force logout | Done (0015, not yet verified on DB) |

## Phase 1 — shifts and money containers (next)
| Volt function | Ours | Better |
|---|---|---|
| Open shift: choose employee, count 5 drawers (products, maintenance, payment machines, installments, wallets), skip allowed | Partial: one cash session per branch | Count per drawer, default = expected balance, difference shown live |
| Close shift: count drawers, wallet reconciliation, notes, stock value snapshot, difference history | Partial: one counted amount | Snapshot of receivables, payables, stock value; owner alert on difference |
| Drawers: products, maintenance, machines, installments, wallets, safe (carries over) | Missing | Every payment row carries `drawer_id`; drawer balance = sum of movements (no editable balance) |
| Adjust drawer balance, transfer between drawers, transfer between wallets | Missing | Needs PIN approval above a limit; every move is an audit event |
| Control log of controlled balance operations | Have (audit) | Dedicated screen with filters |

## Phase 2 — selling
| Volt function | Ours | Better |
|---|---|---|
| POS: products, bundles, offers, retail/wholesale price, barcode, optional customer | Have (Sales) / Partial | Keyboard-first, scan field always focused |
| Held baskets | Missing | Per user, survives refresh |
| Sell an uncoded item | Missing | Needs reason, shows in daily report |
| Tax / service invoice | Missing | |
| Sales log and customer statement | Partial | Search by IMEI, invoice, phone |
| Promotions and bundle prices, PC-builder bundles | Missing | |
| Invoice printing (A4, thermal), invoice texts, display settings, WhatsApp send | Missing | One template editor with live preview |
| Customer returns, warranty checker | Have (returns) / Missing (warranty) | Warranty lookup by IMEI |

## Phase 3 — inventory
| Volt function | Ours | Better |
|---|---|---|
| Products, categories, spec templates, units, tracking mode, wholesale price, min stock | Have / Partial | |
| Serial/IMEI stock | Have (Devices) | Full history of one device |
| Damaged stock, move serial to damaged, supplier return of damaged | Missing | |
| Supply log and orders, supplier payments, supplier returns by batch | Have / Partial | |
| Stock count (audit) by scan, shortage book | Missing | Scan-to-count on phone camera |
| Labels with barcode/QR, price list, CSV export, Excel import | Missing | |

## Phase 4 — customers, debts, installments
| Volt function | Ours | Better |
|---|---|---|
| Customers and suppliers as one contacts screen, categories | Partial (suppliers only) | |
| Customer debt split by type (product, wallet, bills, maintenance, installments, manual, service) + credit balance | Missing | One customer page, one net balance |
| Customer ID check (KYC): ID, address, guarantor, employer, income | Missing | Private storage, owner/manager only |
| Installments: schedule, collect, overdue, void payment | Missing | Auto reminders |
| In/Out ledger (money in/out per customer) | Missing | |
| Settle customer balance, void settlement | Missing | |

## Phase 5 — wallets, bills, machines
| Volt function | Ours | Better |
|---|---|---|
| Wallets with daily/monthly limits, send/receive with commission, cash+wallet mode | Missing | Limit warnings before the operation |
| Bills and quick services, payment machine accounts, machine cash operations | Missing | |
| Refill wallet from supplier | Missing | |

## Phase 6 — repairs and trade-in
| Volt function | Ours | Better |
|---|---|---|
| Repair tickets, 5 statuses, parts, labor, warranty, close with payment, void | Have (Repairs, Maintenance) | Technician board already built |
| Repair templates, brand list, combined invoice, public tracking link | Partial | Customer tracking page + WhatsApp update |
| Trade-in: seller record, device spec snapshot, contract, multi-source payout, cancel | Missing | Signed contract upload |

## Phase 7 — people and control
| Volt function | Ours | Better |
|---|---|---|
| Employees, roles, per-screen permission overrides | Partial (roles) | Matrix editor |
| Employee accounts (dues, advances, payments) | Missing | |
| Attendance, corrections log | Missing | |
| Expenses and withdrawals | Have | |
| Mobile-tax reminders | Missing | |
| Notifications and reminders | Missing | |

## Phase 8 — reports and channels
| Volt function | Ours | Better |
|---|---|---|
| ~17 reports (overall, sales, returns, inventory, product movement, expenses, customer debt, suppliers, peak hours, trends, capital, trade-in, employees, in/out, installments, transfers, bills, maintenance) | Partial (owner summary, transactions feed) | Every report: filters, export, one click to the source record |
| WhatsApp campaigns, number check, progress | Missing | Opt-out list, rate limit |
| Public web catalog | Have (storefront) | |
| Offline POS that syncs later | Missing | Not in Volt's feature list |
| Multi-branch, branch stock transfer | Partial | |

## Security items to keep in every phase
RLS on every table; money functions in the database; idempotency key on every payment; audit event on every change; rate limits; PIN approval for exceptions; Cairo time; NOT VERIFIED list in `BUILD-ORDER.md` kept current.

## Not copied on purpose
Volt's code, name, logo, mascot, wording, subscription system, store-admin portal.
