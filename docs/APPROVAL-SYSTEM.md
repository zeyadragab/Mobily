# Approval system — recommendations

What exists today: owner approvals queue (discount over 5%, expense over 5,000, returns over 2,000, supplier payment over 20,000, purchase orders), separation of duties (the requester cannot approve their own request), one-time execution, manager PIN with one-time override tokens (5 minutes), rate limits, append-only audit and security logs.

## Recommended model: three levels by risk
| Level | When | How | Who |
|---|---|---|---|
| 1. Instant | Small, daily, low risk | No approval, logged only | Cashier |
| 2. PIN at the counter | Medium risk, customer is waiting | Manager types their PIN on the cashier screen (token valid 5 minutes, one use) | Manager or owner |
| 3. Queue | High risk or large money | Request waits; owner approves from phone; nothing moves until then | Owner |

## Proposed matrix (defaults, all editable in settings)
| Action | Level 1 | Level 2 (PIN) | Level 3 (owner) |
|---|---|---|---|
| Sale discount | up to 5% | 5% to 15% | above 15% or below cost |
| Price override on a line | no | yes, never below cost | below cost |
| Cash refund / return | no | up to 2,000 | above 2,000 |
| Credit sale | within customer limit | no | above the limit |
| Expense | up to 500 | 500 to 5,000 | above 5,000 |
| Drawer transfer / adjustment | up to 5,000 | above 5,000 | anything touching the safe by a non-manager |
| Shift close with a difference | up to 50 (note only) | 50 to 500 | above 500 |
| Void an invoice, reverse a debt entry | no | same day | older than today |
| Supplier payment | up to 20,000 (manager) | no | above 20,000 |
| Stock write-off / damaged | no | up to 1,000 cost | above 1,000 |
| Deliver a repair with unpaid balance | no | yes, with a reason | no |

## Rules that make it safe
1. The requester can never approve their own request (already enforced in the database).
2. The approved request stores a snapshot (amounts, items). If anything changes afterwards the approval is void (already done for purchase orders; extend to sales).
3. Every approval expires: PIN tokens 5 minutes, queue requests 48 hours.
4. A reason is required from the requester, and a comment is required to reject.
5. All thresholds live in `app_settings`, changed by the owner only, and each change is audited.
6. Approver sees the context: who, what, margin after discount, customer balance, last 3 similar requests by the same employee.

## Better than the old system
- Owner gets a notification (WhatsApp link or push) with approve / reject, instead of being called to the shop.
- Weekly report: approvals per employee, average discount, rejected requests, PIN failures.
- Second approver for very large amounts (owner + accountant) when the owner wants it.
- Delegation: the owner can hand level 3 to a manager for a fixed period (travel), logged, auto-expiring.
- Alerts on patterns: many discounts just under the limit, repeated voids, refunds without a matching sale day.

## Build order
1. Wire the PIN prompt (`ApproverPin`) into discount and refund in the sales screen (backend is ready).
2. Move thresholds into a settings screen.
3. Add expiry + snapshot check to sale approvals.
4. Notifications and the weekly approvals report.
