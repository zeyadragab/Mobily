# Volt test vectors (appendix to VOLT-GAP-PLAN.md)

Worked examples taken from the observed Volt trial run of 2026-11-10 (store "phonestore"). Each block is one rule and can become one SQL test.
Sources: `B` = `D:\Work\volt-study\explore\B-SCENARIO.md` (section name given), `S` = `D:\Work\volt-study\explore\VOLT-FULL-SPEC.md` (section number given).
Money is EGP, `numeric(14,2)`. "Drawer" names: PRD products, MNT maintenance, INS installments, MCH machines, WAL e-wallets drawer, SAFE.
Rounding rule used by every vector (our decision, Volt shows rounded cards only): `cash_share = round(profit * paid / total, 2)`; `credit_share = profit - cash_share`; a later collection realises `round(origin_credit_pool * amount / origin_debt, 2)`; the last collection of an origin takes the remainder so the pools always sum to the profit.
Vectors marked **(ours)** are not Volt behaviour: they pin our own safeguards.

## T01 Weighted average cost on supply
Source: B Step 3 (part a) supply order; S 0.6.
| step | input | expected |
|---|---|---|
| start | phone stock 2 @ 5,000 | avg 5,000 |
| supply | +1 @ 4,800 | avg = (2*5,000 + 1*4,800)/3 = 4,933.33 (2 dp); profit shown on row = 6,000 - 4,933.33 = 1,066.67 |
| stock value | charger 10 @ 100, cable 50 @ 20, phone 3 @ 4,933.33 | 1,000 + 1,000 + 14,800 = 16,800 |
| capital after supply | drawers 17,900, stock 16,800, supplier debt 3,800 | 17,900 + 16,800 - 3,800 = 30,900 |

## T02 Supply order and supplier payment
Source: B Step 3 (part a) supply order; B Step 10.10; S 6.2, 7.
| operation | inputs | drawer | stock | supplier debt |
|---|---|---|---|---|
| supply | lines 4,800 + 50 x 20 = 5,800; paid 2,000 from PRD | PRD 9,900 -> 7,900 | phone +1 (IMEI ...003), cable +50 | 0 -> 3,800 |
| supplier payment | 1,000 from PRD | PRD 3,600 -> 2,600 | none | 3,800 -> 2,800 |
| rejects | pay 5,000 when debt is 3,800 | none | none | refused: amount larger than debt |
| rejects | pay from a source holding less than the amount | none | none | refused: source balance too low |
| supplier report | supply 5,800, paid from supplier page 1,000 | | | current debt 2,800 (Volt report shows paid 1,000 only: the 2,000 paid inside the supply is missing from its "paid" column, ours must show 3,000) |

## T03 Product opening stock moves nothing
Source: B Step 3 (part a) product 1; S 6.1.
| operation | inputs | drawer | supplier debt | stock |
|---|---|---|---|---|
| add product with opening qty | charger buy 100, sell 150, qty 10 | none | none | +10 |

## T04 Shift open with a counted difference
Source: B Step 5; S 2.1.
| inputs | expected |
|---|---|
| PRD system 10,000, counted 9,900; MNT 10,000 counted 10,000; MCH/INS/WAL counted 0 | PRD becomes 9,900 (ledger row -100 `opening_adjust`); shift stores `{products: expected 10,000, counted 9,900, difference -100}` |
| accounting | no expense row, no profit change, not in the balance control log; shortage alert raised for the shift |
| safe | not part of the opening count |

## T05 Shift close: shortage, surplus, skipped drawer, wallet and machine accounts
Source: B Step 13; S 2.3.
| item | system | counted | result |
|---|---|---|---|
| PRD | 4,500 | 4,450 | -50 shortage, balance replaced by 4,450 |
| MNT | 10,100 | 10,100 | match |
| MCH | 548 | 550 | +2 surplus, no alert |
| INS | 300 | 300 | match |
| WAL drawer | 1,530 | skipped | unchanged 1,530, label "not counted" |
| machine account | 2,875 | 2,870 | -5 shortage |
| wallet account | 4,640 | 4,640 | match |
| live total in the wizard | counted drawers 4,450+10,100+550+300 = 15,400, plus SAFE 300 | | 15,700 (skipped drawer excluded) |
| alert text | | | shortage 50 in PRD and 5 in the machine; nothing for the +2 |
| after close | drawers PRD 4,450, MNT 10,100, INS 300, MCH 550, WAL 1,530, SAFE 300 | | total 17,230 |
| stock snapshot at close | cable 43 x 20 + charger 6 x 100 + used phone 500 | | 1,960 (cost snapshot stored on the shift) |

## T06 Cash sale
Source: B Step 6.1; S 3.4.
| inputs | PRD | stock | profit |
|---|---|---|---|
| charger 150 (cost 100), cash | 7,900 -> 8,050 (+150) | 9 -> 8 | +50 (cash pool 50) |

## T07 Manual discount floor
Source: B Step 6.2 discount dialog; S 3.2.
| phone price 6,000, cost 5,000 | result |
|---|---|
| fixed 1,000 | allowed (sells at cost, profit 0) |
| fixed 1,001 | blocked: price below purchase price |
| fixed 1,500 | blocked: price below purchase price |
| 1000 % | blocked: discount above invoice total and above 100 % |
| 5 % | applied: discount 300, total 5,700, profit 700 |
| (ours) discount above the floor with a manager PIN token | allowed, token consumed once, event logged |

## T08 Credit sale with partial payment and profit split
Source: B Step 6.2 credit; S 0.5, 3.4.
| inputs | PRD | customer | profit | stock/serial |
|---|---|---|---|---|
| phone 6,000 - 5 % = 5,700, cost 5,000, paid 1,000, 4,700 on credit | +1,000 (only the cash part) | products debt +4,700 | booked 700; cash pool +122.81; credit pool +577.19 | stock 2 -> 1, IMEI ...001 `sold` |
| sales log row (Volt) | | | shows total 1,000 and profit 122.81 (a weakness) | |
| sales log row (ours) | | | total 5,700, paid 1,000, debt 4,700, profit 700 | |
| invoice footer | previous balance 0, credit on this invoice 4,700, balance after 4,700 | | | |
| rejects | credit sale without a customer | | refused | |

## T09 Uncoded sale
Source: B Step 6.3; S 3.6.
| inputs | PRD | stock | profit |
|---|---|---|---|
| name, buy 80, sell 120, cash only | +40 (profit only, not +120) | none | +40; row flagged uncoded; cannot be returned or cancelled |
| invoice | total 120, paid cash 120 | | |

## T10 Wholesale sale
Source: B Step 6.4.
| inputs | PRD | stock | profit |
|---|---|---|---|
| cable, wholesale mode, 5 x 30 (retail 40, cost 20) | +150 | 48 -> 43 | +50 |

## T11 Promotion with cap and multi-pay
Source: B Step 6.5; S 3.2.
| inputs | expected |
|---|---|
| 2 chargers = 300; offer 10 % cap 20 | 10 % = 30, capped to 20, total 280, profit 280 - 200 = 80 |
| multi-pay cash 280 | PRD +280; stock 8 -> 6; payments must equal 280 ("matches invoice") |
| offer button with an empty cart | disabled |

## T12 Return with pro-rated discount
Source: B Step 6.7; S 4.
| inputs | expected |
|---|---|
| invoice INV (2 chargers, 300, discount 20, total 280); return 1, good condition, cash | refund = 150 - 20 x 1/2 = 140 (equal to 150 x 280/300) |
| drawer | PRD 9,520 -> 9,380 (-140) |
| stock | 6 -> 7 (good) |
| profit | -40 (= refund 140 - cost 100); report "returns" 140, "profit lost" 40 |
| manual reduction | allowed only for manager/owner, floor = cost 100 |
| refund method "credit" | only when the invoice has a customer |
| report effect | product profit 2,520 - 40 = 2,480 (see T38) |

## T13 Stock count shortage and lost serial
Source: B Step 3 (part b) stock count; S 6.6.
| inputs | expected |
|---|---|
| phone: IMEI ...001 and ...002 scanned, ...003 not scanned (cost 4,800); cable counted 48 of 50; charger 9 of 9; bundle 0 | reasons "missing" for both |
| stock | phone 3 -> 2 (IMEI ...003 `missing`), cable 50 -> 48 |
| average cost | phone avg back to 5,000 (the 4,800 unit left) |
| money | no drawer change, no profit change, no expense; shortage at cost = 4,800 + 2 x 20 = 4,840 |
| stock value | 16,700 -> 11,860 = 2 x 5,000 + 48 x 20 + 9 x 100 |
| capital | 17,900 + 11,860 - 3,800 = 25,960 |
| rejects | approved count cannot be undone (Volt); (ours) correction only by a new adjustment with reason |

## T14 Damaged item
Source: B Step 3 (part b) damaged item.
| inputs | expected |
|---|---|
| charger qty 1 (cost 100), reason "broken in transport" | stock 10 -> 9; stock value -100 (16,800 -> 16,700); no drawer change; no profit change; reason required |

## T15 Maintenance closed, paid in full cash
Source: B Step 7.5 MNT-3667; S 8.3.
| inputs | expected |
|---|---|
| part cable price 40 (cost 20) + labour 100 = total 140; warranty 30 days; cash 140 | MNT +140 (10,000 -> 10,140); PRD unchanged |
| profit | 100 + (40 - 20) = 120 (toast shows 120); cash pool +120 |
| stock | part deducted when added (cable 43 -> 42) |
| warranty | start 2026-11-10, end 2026-12-10 |

## T16 Maintenance closed with a debt
Source: B Step 7.5 MNT-3668; S 8.3.
| inputs | expected |
|---|---|
| part charger 170 (price edited from 150, cost 100) + labour 80 = 250; paid cash 100 | MNT +100 (10,140 -> 10,240); customer maintenance debt +150 |
| profit | 80 + (170 - 100) = 150; cash pool +60 (150 x 100/250); credit pool +90 |
| customer net debt | 4,700 -> 4,850 |
| statement (maintenance) | delivered 390 (140 + 250), paid at delivery 240, later payments 0, remaining 150 |

## T17 Cancel a delivered maintenance ticket
Source: B Step 14 (maintenance row); S 8.4.
| inputs | expected |
|---|---|
| cancel MNT-3667 (cash 140 collected) | MNT 10,240 -> 10,100 (-140, cash taken back); part back to stock (cable 42 -> 43); ticket back to "in progress"; cash pool -120; maintenance report loses that revenue/profit |
| customer debt | unchanged (Volt shows no visible credit although the dialog says payments become credit; ours must show one or the other) |
| rejected ticket void | part back to stock (cable 41 -> 42), ticket stays in the log as cancelled with 0 |

## T18 Trade-in paid in cash and cancelled
Source: B Step 8.1, Step 14 (trade-in row); S 9.
| operation | inputs | PRD | stock | profit |
|---|---|---|---|---|
| purchase | used phone, buy 3,000, expected sell 4,000, cash from PRD | 9,380 -> 6,380 (-3,000) | +1 serial, cost 3,000, no supplier | none until sold |
| cancel (owner/manager, reason <= 500 chars) | | 1,300 -> 4,300 (+3,000 compensating entry in the current shift) | product archived | none |
| rejects | cashier cancels | refused | | |
| report 12 | received 2, cost 3,500 (3,000 + 500), expected sell 4,700, expected profit 1,200 | | | |

## T19 Trade-in on customer credit netted against a debt
Source: B Step 8.3; S 0.4, 9.
| inputs | expected |
|---|---|
| customer owes products debt 4,700; buy used phone 500 on credit | no drawer change; products debt 4,700 -> 4,200; stock +1 (cost 500) |
| profit pools | credit pool realised 577.19 x 500/4,700 = 61.40 moves to cash pool |
| no debt case | the 500 is stored as customer credit ("له") |
| cancel | not allowed for credit purchases (Volt); (ours) allowed with PIN, reverses the netting |

## T20 Installment plan
Source: B Step 9.1; S 10.
| inputs | expected |
|---|---|
| phone 6,000 (cost 5,000) + interest 600 = 6,600; down payment 600; 6 monthly; first date 10 Nov | installment = (6,600 - 600)/6 = 1,000; due 10 Nov, 10 Dec, 10 Jan, 10 Feb, 10 Mar, 10 Apr |
| drawer | PRD +600 (down payment goes to PRD, not INS) |
| debt | installments source +6,000 |
| stock | phone 1 -> 0, IMEI sold |
| profit | booked 1,600 (6,600 - 5,000); cash pool +145.45 (1,600 x 600/6,600); credit pool +1,454.55 |
| first installment due today | status "overdue" (due date <= today) |
| KPIs | upcoming 6,000, overdue 1,000 |

## T21 Installment collection and its cancellation
Source: B Step 9.2, Step 14; S 10.
| operation | inputs | drawer | debt | pools |
|---|---|---|---|---|
| collect | 400 of installment 1 into INS | INS 0 -> 400 | 6,000 -> 5,600 | cash +96.97, credit -96.97 (1,454.55 x 400/6,000) |
| rejects | 1,500 when 1,000 remain | refused: more than remaining | | |
| rejects | 0 | refused: enter a valid amount | | |
| cancel collection | same record | INS -400 | debt +400, row back to upcoming/overdue, "collected this month" back to 0 | exact reversal (+96.97 credit, -96.97 cash) |

## T22 Manual installment
Source: B Step 9.3.
| inputs | expected |
|---|---|
| amount 250, due 2026-11-01 (past allowed) | installments debt +250; status overdue; no drawer, no profit effect |

## T23 Wallet: instant receive
Source: B Step 10.2 row a; S 12.
| inputs | wallet | WAL drawer | profit |
|---|---|---|---|
| receive A=1,000, commission C=10, full instant | 5,000 -> 6,000 (+A) | 2,000 -> 1,010 (-(A-C) = -990) | +10; daily usage +1,000 |

## T24 Wallet: instant send
Source: B Step 10.2 row b.
| inputs | wallet | WAL drawer | profit |
|---|---|---|---|
| send A=500, C=20, full instant | 6,000 -> 5,500 (-A) | 1,010 -> 1,530 (+(A+C) = +520) | +20 |

## T25 Wallet: send on credit (wallet only)
Source: B Step 10.2 row d.
| inputs | wallet | WAL drawer | customer | profit |
|---|---|---|---|---|
| send A=300, C=5, mode "wallet only (credit)", customer required | 5,500 -> 5,200 | unchanged | wallets debt +305 | credit pool +5; daily usage +300 |

## T26 Wallet: receive on credit and cancelling the pending row
Source: B Step 10.2 row e, Step 14; S 12.
| operation | wallet | WAL drawer | customer | notes |
|---|---|---|---|---|
| receive A=400, C=10, "credit" mode | unchanged 5,200 (not counted in the daily limit) | 1,530 -> 1,140 (-(A-C) = -390) | wallets debt +400 (305 -> 705) | status "pending" |
| cancel pending | unchanged | 1,140 -> 1,530 (+390) | wallets debt -400 (observed 405 -> 5, after the 300 collection of T32) | reverses wallet, drawer and debt; completed rows have no cancel |
| profit pools after cancel | | | | observed +33 cash / -43 credit, formula NOT derived (see plan G); do not assert |

## T27 Wallet limits and drawer cash check
Source: B Step 10.1-10.2, Step 10.5, Step 10.8; S 12.
| wallet daily limit 3,000, monthly 20,000 | expected |
|---|---|
| after receive 1,000 and send 500 | usage 1,500, remaining 1,500 |
| send 2,000 | blocked inline: exceeds remaining daily limit (1,500) |
| usage counts | sends + receives + wallet-to-wallet transfers (500) + withdrawals/expenses from the wallet (60); not the credit-mode receive |
| receive 1,000 with WAL drawer at 0 | refused: drawer balance 0.00, required 990 |
| drawer transfer 99,999 above the balance | refused (ours: readable Arabic message, not a raw code) |

## T28 Payment machine operation and bills
Source: B Step 10.3; S 13.
| operation | inputs | machine account | MCH drawer | customer | profit |
|---|---|---|---|---|---|
| machine operation | A=600, C=15 | +615 (2,000 -> 2,615) | -600 (1,000 -> 400) | | +15 |
| bill, cash | cost 140, C=8 | -140 (-> 2,475) | +148 (400 -> 548) | | +8 |
| bill, credit | cost 100, C=5, customer | -100 (-> 2,375) | unchanged | bills debt +105 | credit pool +5 |
| machine account trace | 2,000 + 615 - 140 - 100 | | | | 2,375; after a 500 wallet-to-machine transfer 2,875 |
| report 17 | bills + machine ops | | | | 3 operations, value 868 (615+148+105), profit 28 |

## T29 Drawer transfer and adjustment types
Source: B Step 10.4, 10.6; S 14.
| operation | inputs | effect |
|---|---|---|
| transfer | PRD -> WAL 2,000 | PRD 6,780 -> 4,780, WAL 0 -> 2,000; one control-log entry with both balances |
| transfer | PRD -> MCH 1,000 | PRD 4,780 -> 3,780, MCH 0 -> 1,000 |
| adjust "add" | SAFE +300 | SAFE 0 -> 300 |
| adjust "withdraw" | PRD -50 | 3,780 -> 3,730 |
| adjust "correct" (set) | PRD set 3,700 | 3,730 -> 3,700, logged change -30 |
| (ours) idempotency | the same transfer key sent twice | moves money once (drawers_test) |
| (ours) PIN | transfer or adjustment >= 5,000 by a manager | needs a one-time override token; owner exempt |

## T30 Expense and withdrawal
Source: B Step 10.8; S 15.
| operation | inputs | effect |
|---|---|---|
| expense from drawer | rent 100 from PRD | PRD 3,700 -> 3,600; expenses total 100 |
| withdrawal from wallet | 60 from wallet account | wallet 4,700 -> 4,640; wallet daily usage +60 |
| report 1 | expenses 160 (100 + 60) | net result = profit before expenses - 160; employee payments not included |
| empty form | | refused: fill all required fields |

## T31 In/Out ledger
Source: B Step 9b, Step 14; S 11.
| operation | inputs | effect |
|---|---|---|
| in, ledger only | 500 | customer in-total 500, no drawer change |
| out, drawer-linked | 200 from PRD | PRD 6,980 -> 6,780; out-total 200 |
| cancel the out | reason | PRD 4,300 -> 4,500 (+200 once); row kept as cancelled; copy kept for audit |
| report 14 | | in 500, out 200 -> net 300 owed to customers |

## T32 Customer debt collection
Source: B Step 10.9; S 7.
| inputs | expected |
|---|---|
| customer net 11,010 = products 4,700 + maintenance 150 + wallets 705 + bills 105 + installments 5,850 (list row shows products 4,200 because the 500 trade-in credit is netted there) | |
| collect 300 of the wallets debt into INS | INS 400 -> 700; wallets debt 705 -> 405; net 11,010 -> 10,710 |
| pools | observed cash +5 / credit -5 (850 -> 855, 1,973 -> 1,968); formula not derivable from the spec (see plan G) |
| rejects | amount above the net debt | |

## T33 Employee account
Source: B Step 11.2; S 18.
| operation | inputs | effect |
|---|---|---|
| create | salary 3,000, due day 1, start 2026-11-01, opening 0 | accrual 3,000 booked at once (balance owed to employee 3,000) |
| pay | 1,000 from PRD | balance 2,000; PRD 2,600 -> 1,600 |
| advance | 300 from PRD | balance 1,700; PRD 1,600 -> 1,300 |
| accounting | | not an expense, not in profit, not in the capital formula (Volt); (ours) show the 1,700 as a liability line |
| empty save | | refused: complete name, salary and start date |

## T34 Customer net debt, five sources
Source: B Step 12 report 7; S 0.4.
| source | amount |
|---|---|
| products (net of 500 credit) | 4,200 |
| wallets | 405 |
| bills | 105 |
| maintenance | 150 |
| installments | 5,850 |
| net | 10,710 (4,200 + 405 + 105 + 150 + 5,850); balances owed to customers 0 |

## T35 Bundle arithmetic
Source: B Step 3 (part b) bundle; S 6.8.
| inputs | expected |
|---|---|
| cable (40, cost 20) + charger (150, cost 100), price 170 | market value 190; cost 120; margin 170 - 120 = 50; saving (190 - 170)/190 = 10.5 % (shown 11 %) |
| only the cable | saving -325 % ((40 - 170)/40) shown as a warning |

## T36 Warranty dates
Source: B Step 6.6, Step 7.5; S 5, 8.3.
| item | expected |
|---|---|
| phone sold 2026-11-10, product warranty 365 days | warranty end 2027-11-10, "valid, 365 days left" |
| unsold IMEI | customer "cash customer", "not sold yet" |
| unknown number | "no record found" |
| repaired device, warranty 30 days from 2026-11-10 | ends 2026-12-10; Volt's checker does NOT find it (maintenance warranty only on the delivery invoice); (ours) one checker finds both |

## T37 Reports: formulas
Source: B Step 12; S 21.
| report | inputs | expected |
|---|---|---|
| comprehensive (profit) | product profit 2,480 + bills/services 28 + maintenance 270 + send/receive commissions 45 | 2,823 before expenses |
| comprehensive (net) | 2,823 - expenses and withdrawals 160 | 2,663 |
| product profit | sales profit 2,520 (50+700+40+50+80+1,600) - return loss 40 | 2,480 |
| sales minus supply | sales 13,000 - supplies 5,800 - used purchases 3,500 - returns 140 | 3,560 |
| sales report | 6 sales, booked 13,000, profit 2,520 | average 2,166.67; margin 2,520/13,000 = 19.38 %; collected 2,300 (150+1,000+120+150+280+600); credit sales 4,700; installment sales 6,600 |
| capital | drawers+safe 14,228 + wallets 4,640 + machines 2,875 + stock 4,940 + customer debts 10,710 - customer credits 0 - suppliers 2,800 | 34,593 (employee liability 1,700 not included in Volt) |
| product movement (charger) | sold 130 profit, returned -40, maintenance parts +70 | net 160 |
| maintenance report | labour 100 + 80, parts price 40 + 170, parts cost 20 + 100 | revenue 390, profit 270 (180 + 90) |
| stock valuation | used 3,000 + used 500 + cable 42 x 20 + charger 6 x 100 | 4,940; expected sales 7,280; expected profit 2,340 |

## T38 Profit pools replay (cash / credit), exact decimals
Source: B Step 6-9, Step 14; S 0.5.
| after | cash pool | credit pool | displayed in Volt |
|---|---|---|---|
| charger sale +50 | 50.00 | 0 | 50 / 0 |
| credit phone sale | 172.81 | 577.19 | 173 / 577 |
| uncoded +40, wholesale +50, promo +80 | 342.81 | 577.19 | 343 / 577 |
| return -40 | 302.81 | 577.19 | 303 / 577 |
| MNT-3667 +120 | 422.81 | 577.19 | 423 / 577 |
| MNT-3668 (+60 / +90) | 482.81 | 667.19 | 483 / 667 |
| trade-in credit 500 (+61.40 / -61.40) | 544.21 | 605.79 | 544 / 606 |
| installment plan (+145.45 / +1,454.55) | 689.66 | 2,060.34 | 690 / 2,060 |
| collection 400 (+96.97 / -96.97) | 786.63 | 1,963.37 | 787 / 1,963 |
Check: pools sum = booked profit not yet written off at every row.

## T39 Replay: products drawer from the whole scenario
Source: B Step 3 to Step 14; S 24.
Start PRD 9,900 (after the opening count). Apply in order and assert after each step:
| step | delta | PRD |
|---|---|---|
| supply, paid from PRD | -2,000 | 7,900 |
| cash sale charger | +150 | 8,050 |
| credit phone sale, paid part | +1,000 | 9,050 |
| uncoded sale | +40 | 9,090 |
| wholesale cable | +150 | 9,240 |
| promo sale multi-pay cash | +280 | 9,520 |
| return | -140 | 9,380 |
| trade-in cash | -3,000 | 6,380 |
| installment down payment | +600 | 6,980 |
| in/out out 200 drawer-linked | -200 | 6,780 |
| transfer to WAL | -2,000 | 4,780 |
| transfer to MCH | -1,000 | 3,780 |
| adjust withdraw | -50 | 3,730 |
| adjust correct to 3,700 | -30 | 3,700 |
| rent | -100 | 3,600 |
| supplier payment | -1,000 | 2,600 |
| employee pay | -1,000 | 1,600 |
| employee advance | -300 | 1,300 |
| cancel trade-in | +3,000 | 4,300 |
| cancel in/out | +200 | 4,500 |
| close count 4,450 | -50 | 4,450 |
Other drawers in the same run: MNT 10,000 -> 10,140 -> 10,240 -> 10,100; INS 0 -> 400 -> 700 -> 300; MCH 0 -> 1,000 -> 400 -> 548 -> 550 (close); WAL 0 -> 2,000 -> 1,010 -> 1,530 -> 1,140 -> 1,530; SAFE 0 -> 300. Final total 17,230 (S 24).

## T40 (ours) Safeguards every money function must pass
Source: our migrations 0015, 0016, 0018 and `supabase/tests/drawers_test.sql`, `security_hardening_test.sql`, `repair_money_test.sql`.
| check | expected |
|---|---|
| same idempotency key twice | one set of ledger rows, same answer |
| no open shift | money operation refused |
| cashier calls a manager-only function | refused |
| amount at or above the PIN threshold, no token | refused; with a valid token: allowed once; second use refused |
| more than the rate limit in a window | refused, nothing half-saved |
| drawer ledger update/delete | refused (append-only) |
| every undo | writes a compensating row in the current shift linked to the original; original untouched |
