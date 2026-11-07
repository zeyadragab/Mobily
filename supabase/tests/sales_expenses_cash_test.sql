-- Sales / expenses / cash drawer test for 0006. Run in the Supabase SQL Editor AFTER 0001-0006.
-- Fake data in ONE transaction that is ROLLED BACK. Expected: every row ok = true.

begin;

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;

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

-- fixtures: one variant, price 1000, cost 600, stock 10. Close any real open drawer (rolled back anyway).
update public.cash_sessions set status = 'closed', closed_at = now() where status = 'open';
insert into public.products(id, name) values ('00000000-0000-0000-0000-00000000a001','هاتف اختبار مبيعات');
insert into public.variants(id, product_id, sku, price) values
 ('00000000-0000-0000-0000-00000000a101','00000000-0000-0000-0000-00000000a001','S-SKU-1', 1000);
insert into public.variant_costs(variant_id, cost) values ('00000000-0000-0000-0000-00000000a101', 600);
insert into public.stock_movements(variant_id, branch_id, movement_type, qty)
values ('00000000-0000-0000-0000-00000000a101',
        (select id from public.branches where is_active order by created_at limit 1), 'adjustment', 10);

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create or replace function pg_temp.rec(t text, ok boolean, d text default '') returns void
language sql as $$ insert into t_results(test, ok, detail) values (t, ok, d); $$;
create or replace function pg_temp.items(q int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('variant_id','00000000-0000-0000-0000-00000000a101','qty',q)) $$;
create or replace function pg_temp.pay(m text, a numeric) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('method', m, 'amount', a)) $$;
create or replace function pg_temp.stock() returns int language sql as $$
  select coalesce(sum(qty),0)::int from public.stock_movements where variant_id = '00000000-0000-0000-0000-00000000a101' $$;

create temp table t_ids(k text primary key, v uuid);
grant all on t_ids to public;

-- 1. cash sale without an open drawer is refused
do $$ declare f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin perform public.create_sale(null,null,0,null, pg_temp.items(1), pg_temp.pay('cash',1000));
  exception when others then f := true; end; reset role;
  perform pg_temp.rec('cash sale refused without open drawer', f and pg_temp.stock() = 10);
end $$;

-- 2. cashier opens the drawer; a second open is refused
do $$ declare f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform public.open_cash_session(100);
  begin perform public.open_cash_session(50); exception when others then f := true; end; reset role;
  perform pg_temp.rec('drawer opens once', f);
end $$;

-- 3. sale of 2 units paid in cash completes, stock drops, payment is tied to the session
do $$ declare inv public.sales_invoices; n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  inv := public.create_sale('عميل','01011111111',0,null, pg_temp.items(2), pg_temp.pay('cash',2000)); reset role;
  select count(*) into n from public.sales_payments where invoice_id = inv.id and session_id is not null;
  perform pg_temp.rec('sale completes: stock 8, payment linked to drawer',
    inv.status = 'completed' and inv.total = 2000 and pg_temp.stock() = 8 and n = 1, inv.status||' stock='||pg_temp.stock());
end $$;

-- 4. payments that do not equal the total are refused
do $$ declare f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin perform public.create_sale(null,null,0,null, pg_temp.items(1), pg_temp.pay('cash',999));
  exception when others then f := true; end; reset role;
  perform pg_temp.rec('payment total must match invoice total', f);
end $$;

-- 5. cannot sell more than in stock
do $$ declare f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin perform public.create_sale(null,null,0,null, pg_temp.items(99), pg_temp.pay('cash',99000));
  exception when others then f := true; end; reset role;
  perform pg_temp.rec('overselling refused', f and pg_temp.stock() = 8);
end $$;

-- 6. small discount (3%) needs no approval
do $$ declare inv public.sales_invoices; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  inv := public.create_sale(null,null,30,null, pg_temp.items(1), pg_temp.pay('card',970)); reset role;
  perform pg_temp.rec('3% discount completes directly', inv.status = 'completed' and pg_temp.stock() = 7, inv.status);
end $$;

-- 7. big discount (20%) waits for the owner: stock untouched, approval request created
do $$ declare inv public.sales_invoices; s0 int; n int; begin
  s0 := pg_temp.stock();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  inv := public.create_sale(null,null,200,null, pg_temp.items(1), pg_temp.pay('cash',800)); reset role;
  insert into t_ids values ('pending1', inv.id);
  select count(*) into n from public.approval_requests where subject_id = inv.id and action_type = 'sale.discount' and status = 'submitted';
  perform pg_temp.rec('20% discount waits for owner, stock untouched', inv.status = 'pending_approval' and pg_temp.stock() = s0 and n = 1, inv.status);
end $$;

-- 8. owner approves -> invoice completes, stock drops, payment recorded
do $$ declare rid uuid; iid uuid; st text; n int; begin
  select v into iid from t_ids where k = 'pending1';
  select approval_id into rid from public.sales_invoices where id = iid;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  perform public.decide_approval(rid, 'approved', 'ok'); reset role;
  select status into st from public.sales_invoices where id = iid;
  select count(*) into n from public.sales_payments where invoice_id = iid;
  perform pg_temp.rec('owner approval completes the sale', st = 'completed' and pg_temp.stock() = 6 and n = 1, st||' stock='||pg_temp.stock());
end $$;

-- 9. rejected discount voids the invoice, stock untouched
do $$ declare inv public.sales_invoices; rid uuid; st text; s0 int; begin
  s0 := pg_temp.stock();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  inv := public.create_sale(null,null,300,null, pg_temp.items(1), pg_temp.pay('cash',700)); reset role;
  select approval_id into rid from public.sales_invoices where id = inv.id;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  perform public.decide_approval(rid, 'rejected', 'no'); reset role;
  select status into st from public.sales_invoices where id = inv.id;
  perform pg_temp.rec('rejected discount voids invoice', st = 'void' and pg_temp.stock() = s0, st);
end $$;

-- 10. cashier cannot see owner numbers; accountant can
do $$ declare f boolean := false; ok boolean := true; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin perform public.owner_summary(current_date, current_date); exception when others then f := true; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
  begin perform public.owner_summary(current_date, current_date); exception when others then ok := false; end; reset role;
  perform pg_temp.rec('owner_summary: cashier blocked, accountant allowed', f and ok);
end $$;

-- 11. expense below threshold: partial payment shows remaining; overpay refused
do $$ declare ex public.expenses; cat uuid; f boolean := false; rem numeric; begin
  select id into cat from public.expense_categories where name = 'كهرباء';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  ex := public.create_expense(cat, 'فاتورة كهرباء', 'شركة الكهرباء', 1200, null, current_date + 7, 'EL-1', null);
  perform public.pay_expense(ex.id, 500, 'cash');
  begin perform public.pay_expense(ex.id, 800, 'cash'); exception when others then f := true; end; reset role;
  select remaining into rem from public.expense_balances where id = ex.id;
  perform pg_temp.rec('expense: partial payment, remaining 700, overpay refused', ex.status = 'open' and rem = 700 and f, 'remaining='||rem);
end $$;

-- 12. big expense by manager waits for owner; cannot be paid until approved
do $$ declare ex public.expenses; cat uuid; f boolean := false; st text; begin
  select id into cat from public.expense_categories where name = 'إيجار';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  ex := public.create_expense(cat, 'إيجار الشهر', 'المالك', 6000, null, null, null, null);
  begin perform public.pay_expense(ex.id, 6000, 'transfer'); exception when others then f := true; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  perform public.decide_approval(ex.approval_id, 'approved', 'ok'); reset role;
  select status into st from public.expenses where id = ex.id;
  perform pg_temp.rec('big expense: unpayable until owner approves', ex.status = 'pending_approval' and f and st = 'open', ex.status||' -> '||st);
end $$;

-- 13. cashier cannot read or create expenses
do $$ declare n int; f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  select count(*) into n from public.expenses;
  begin perform public.create_expense((select id from public.expense_categories limit 1),'x',null,10,null,null,null,null);
  exception when others then f := true; end; reset role;
  perform pg_temp.rec('cashier cannot read/create expenses', n = 0 and f);
end $$;

-- 14. close drawer: difference needs a note; expected = opening + cash sales - cash expenses
do $$ declare s public.cash_sessions; f boolean := false; exp_calc numeric; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin perform public.close_cash_session(1000); exception when others then f := true; end;
  s := public.close_cash_session(1000, 'عدم تطابق للاختبار'); reset role;
  select 100
       + coalesce((select sum(amount) from public.sales_payments where session_id = s.id and method = 'cash'),0)
       - coalesce((select sum(amount) from public.expense_payments where session_id = s.id and method = 'cash'),0)
    into exp_calc;
  perform pg_temp.rec('drawer close: note required on difference, expected correct',
    f and s.expected_cash = exp_calc and s.difference = 1000 - exp_calc and s.status = 'closed',
    'expected='||s.expected_cash||' calc='||exp_calc||' diff='||s.difference);
end $$;

-- 15. owner summary matches the invoices
do $$ declare r jsonb; direct numeric; begin
  select coalesce(sum(total),0) into direct from public.sales_invoices
   where status = 'completed' and business_date = (now() at time zone 'Africa/Cairo')::date and created_by in
    ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  r := public.owner_summary((now() at time zone 'Africa/Cairo')::date, (now() at time zone 'Africa/Cairo')::date); reset role;
  perform pg_temp.rec('owner_summary sales >= our test sales and has gross profit',
    (r->>'sales')::numeric >= direct and direct = 2000 + 970 + 800 and (r->>'gross_profit') is not null, r::text);
end $$;

-- 16. owner sees the expense in the feed; cashier does not
do $$ declare o int; c int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  select count(*) into o from public.transactions_feed where kind = 'expense'; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  select count(*) into c from public.transactions_feed where kind = 'expense'; reset role;
  perform pg_temp.rec('transactions feed respects roles', o >= 2 and c = 0, 'owner='||o||' cashier='||c);
end $$;

-- 17. anon cannot call any of the new functions or read the feed
do $$ declare f1 boolean := false; f2 boolean := false; n int := 0; begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform public.create_sale(null,null,0,null, pg_temp.items(1), pg_temp.pay('card',1000)); exception when others then f1 := true; end;
  begin perform public.owner_summary(current_date, current_date); exception when others then f2 := true; end;
  begin select count(*) into n from public.transactions_feed; exception when others then n := 0; end;
  reset role;
  perform pg_temp.rec('anon blocked from sales/summary/feed', f1 and f2 and n = 0);
end $$;

select n, test, ok, detail from (
  select 0 as n, 'SUMMARY: ' || count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' as test,
         coalesce(bool_and(ok), false) as ok, '' as detail from t_results
  union all select n, test, ok, detail from t_results
) x order by n;

rollback;
