-- Supplier ledger test for 0008. Run in the Supabase SQL Editor AFTER 0001-0008.
-- Fake data in ONE transaction that is ROLLED BACK. Expected: every row ok = true.

begin;

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;
create temp table t_ids(k text primary key, v uuid);
grant all on t_ids to public;

insert into auth.users (id, aud, role, email) values
 ('00000000-0000-0000-0000-0000000000a1','authenticated','authenticated','t-owner2@test.invalid'),
 ('00000000-0000-0000-0000-0000000000b1','authenticated','authenticated','t-manager@test.invalid'),
 ('00000000-0000-0000-0000-0000000000c1','authenticated','authenticated','t-cashier@test.invalid'),
 ('00000000-0000-0000-0000-0000000000e1','authenticated','authenticated','t-accountant@test.invalid');
insert into public.user_roles(user_id, role) values
 ('00000000-0000-0000-0000-0000000000a1','owner'),
 ('00000000-0000-0000-0000-0000000000b1','manager'),
 ('00000000-0000-0000-0000-0000000000c1','cashier'),
 ('00000000-0000-0000-0000-0000000000e1','accountant');

update public.cash_sessions set status = 'closed', closed_at = now() where status = 'open';

-- fixtures: supplier S, a received order (10 x 700 = 7000), and a draft order
insert into public.suppliers(id, name, phone) values ('00000000-0000-0000-0000-00000000f001','[اختبار] مورد دفتر','01000000009');
insert into public.products(id, name) values ('00000000-0000-0000-0000-00000000a001','صنف اختبار مورد');
insert into public.variants(id, product_id, sku, price) values ('00000000-0000-0000-0000-00000000a101','00000000-0000-0000-0000-00000000a001','L-SKU-1', 1000);
insert into public.purchase_orders(id, supplier_id, branch_id, created_by) values
 ('00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-00000000f001',(select id from public.branches where is_active order by created_at limit 1),'00000000-0000-0000-0000-0000000000b1'),
 ('00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-00000000f001',(select id from public.branches where is_active order by created_at limit 1),'00000000-0000-0000-0000-0000000000b1');
insert into public.purchase_order_lines(po_id, variant_id, qty_ordered, qty_received, unit_cost)
values ('00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-00000000a101', 10, 10, 700);
update public.purchase_orders set status = 'received' where id = '00000000-0000-0000-0000-00000000b001';

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create or replace function pg_temp.rec(t text, ok boolean, d text default '') returns void
language sql as $$ insert into t_results(test, ok, detail) values (t, ok, d); $$;
create or replace function pg_temp.bal() returns numeric language sql as $$
  select balance from public.supplier_balances where supplier_id = '00000000-0000-0000-0000-00000000f001' $$;

-- 1. invoice matching the received goods (7000) is open at once
do $$ declare i public.supplier_invoices; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  i := public.create_supplier_invoice('00000000-0000-0000-0000-00000000f001','00000000-0000-0000-0000-00000000b001','INV-100', null, current_date + 30, 7000, null); reset role;
  insert into t_ids values ('inv1', i.id);
  perform pg_temp.rec('matching invoice is open, balance 7000', i.status = 'open' and i.expected_amount = 7000 and pg_temp.bal() = 7000, i.status||' bal='||pg_temp.bal());
end $$;

-- 2. invoice that differs from what was received waits for the owner and is not in the balance yet
do $$ declare i public.supplier_invoices; st text; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  i := public.create_supplier_invoice('00000000-0000-0000-0000-00000000f001','00000000-0000-0000-0000-00000000b001','INV-101', null, current_date + 30, 7500, 'فرق في السعر'); reset role;
  perform pg_temp.rec('mismatched invoice waits for owner, not in balance', i.status = 'pending_approval' and pg_temp.bal() = 7000, i.status||' bal='||pg_temp.bal());
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  perform public.decide_approval(i.approval_id, 'approved', 'ok'); reset role;
  select status into st from public.supplier_invoices where id = i.id;
  perform pg_temp.rec('owner approval opens the invoice, balance 14500', st = 'open' and pg_temp.bal() = 14500, st||' bal='||pg_temp.bal());
end $$;

-- 3. duplicate invoice number refused; invoice on an order with nothing received refused
do $$ declare f1 boolean := false; msg text := ''; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin perform public.create_supplier_invoice('00000000-0000-0000-0000-00000000f001', null, 'INV-100', null, null, 100, null); exception when others then f1 := true; end;
  begin perform public.create_supplier_invoice('00000000-0000-0000-0000-00000000f001','00000000-0000-0000-0000-00000000b002','INV-102', null, null, 100, null); exception when others then msg := sqlerrm; end;
  reset role;
  perform pg_temp.rec('duplicate number and unreceived order refused', f1 and msg like '%no received goods%', msg);
end $$;

-- 4. cashier can neither create invoices nor pay nor read balances
do $$ declare f1 boolean := false; f2 boolean := false; n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin perform public.create_supplier_invoice('00000000-0000-0000-0000-00000000f001', null, 'X-1', null, null, 10, null); exception when others then f1 := true; end;
  begin perform public.pay_supplier('00000000-0000-0000-0000-00000000f001', null, 10, 'transfer'); exception when others then f2 := true; end;
  select count(*) into n from public.supplier_balances; reset role;
  perform pg_temp.rec('cashier blocked from supplier ledger', f1 and f2 and n = 0, 'rows='||n);
end $$;

-- 5. partial payment by the accountant; overpaying the invoice is refused
do $$ declare i uuid; rem numeric; f boolean := false; begin
  select v into i from t_ids where k = 'inv1';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
  perform public.pay_supplier('00000000-0000-0000-0000-00000000f001', i, 3000, 'transfer');
  begin perform public.pay_supplier('00000000-0000-0000-0000-00000000f001', i, 5000, 'transfer'); exception when others then f := true; end; reset role;
  select remaining into rem from public.supplier_invoice_balances where id = i;
  perform pg_temp.rec('partial payment: remaining 4000, overpay refused', rem = 4000 and f and pg_temp.bal() = 11500, 'remaining='||rem||' bal='||pg_temp.bal());
end $$;

-- 6. cash payment needs an open drawer, then is tied to it
do $$ declare i uuid; f boolean := false; n int; begin
  select v into i from t_ids where k = 'inv1';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin perform public.pay_supplier('00000000-0000-0000-0000-00000000f001', i, 1000, 'cash'); exception when others then f := true; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform public.open_cash_session(500); reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.pay_supplier('00000000-0000-0000-0000-00000000f001', i, 1000, 'cash'); reset role;
  select count(*) into n from public.supplier_payments where method = 'cash' and session_id is not null and amount = 1000;
  perform pg_temp.rec('cash payment needs the drawer and is linked to it', f and n = 1 and pg_temp.bal() = 10500, 'bal='||pg_temp.bal());
end $$;

-- 7. big payment (>= 20000) by manager waits for owner; balance unchanged until approved
do $$ declare big public.supplier_invoices; p public.supplier_payments; st text; before_bal numeric; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  big := public.create_supplier_invoice('00000000-0000-0000-0000-00000000f001', null, 'INV-BIG', null, null, 30000, null);
  before_bal := pg_temp.bal();
  p := public.pay_supplier('00000000-0000-0000-0000-00000000f001', big.id, 25000, 'transfer'); reset role;
  perform pg_temp.rec('big payment waits for owner, balance unchanged', p.status = 'pending_approval' and pg_temp.bal() = before_bal, p.status);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  perform public.decide_approval(p.approval_id, 'approved', 'ok'); reset role;
  select status into st from public.supplier_payments where id = p.id;
  perform pg_temp.rec('owner approval completes the payment', st = 'completed' and pg_temp.bal() = before_bal - 25000, st||' bal='||pg_temp.bal());
end $$;

-- 8. advance payment (no invoice) lowers the balance; owner pays directly
do $$ declare b numeric; begin
  b := pg_temp.bal();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  perform public.pay_supplier('00000000-0000-0000-0000-00000000f001', null, 500, 'wallet'); reset role;
  perform pg_temp.rec('advance payment lowers the balance', pg_temp.bal() = b - 500, 'bal='||pg_temp.bal());
end $$;

-- 9. balance equals open invoices minus completed payments (7000 + 7500 + 30000 - 3000 - 1000 - 25000 - 500 = 15000)
do $$ declare calc numeric; begin
  select coalesce((select sum(amount) from public.supplier_invoices where status = 'open'), 0)
       - coalesce((select sum(amount) from public.supplier_payments where status = 'completed'), 0) into calc;
  perform pg_temp.rec('balance = invoices - payments = 15000', calc = 15000 and pg_temp.bal() = 15000, 'calc='||calc||' view='||pg_temp.bal());
end $$;

-- 10. drawer expected cash subtracts the cash payment to the supplier (500 - 1000 < 0, so count 0 needs a note)
do $$ declare s public.cash_sessions; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  s := public.close_cash_session(0, 'اختبار'); reset role;
  perform pg_temp.rec('drawer expected = 500 - 1000 supplier cash', s.expected_cash = -500 and s.difference = 500, 'expected='||s.expected_cash);
end $$;

-- 11. feed shows supplier invoices/payments to the owner; anon is blocked
do $$ declare o int; f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  select count(*) into o from public.transactions_feed where kind in ('supplier_invoice','supplier_payment'); reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform public.pay_supplier('00000000-0000-0000-0000-00000000f001', null, 1, 'cash'); exception when others then f := true; end; reset role;
  perform pg_temp.rec('feed lists supplier entries, anon blocked', o >= 6 and f, 'feed='||o);
end $$;

select n, test, ok, detail from (
  select 0 as n, 'SUMMARY: ' || count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' as test,
         coalesce(bool_and(ok), false) as ok, '' as detail from t_results
  union all select n, test, ok, detail from t_results
) x order by n;

rollback;
