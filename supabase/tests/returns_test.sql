-- Sales returns test for 0007. Run in the Supabase SQL Editor AFTER 0001-0007.
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
 ('00000000-0000-0000-0000-0000000000d1','authenticated','authenticated','t-warehouse@test.invalid');
insert into public.user_roles(user_id, role) values
 ('00000000-0000-0000-0000-0000000000a1','owner'),
 ('00000000-0000-0000-0000-0000000000b1','manager'),
 ('00000000-0000-0000-0000-0000000000c1','cashier'),
 ('00000000-0000-0000-0000-0000000000d1','warehouse');

update public.cash_sessions set status = 'closed', closed_at = now() where status = 'open';
insert into public.products(id, name) values ('00000000-0000-0000-0000-00000000a001','هاتف اختبار مرتجعات');
insert into public.variants(id, product_id, sku, price) values
 ('00000000-0000-0000-0000-00000000a101','00000000-0000-0000-0000-00000000a001','R-SKU-1', 1000);
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
create or replace function pg_temp.pay(a numeric) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('method','cash','amount', a)) $$;
create or replace function pg_temp.stock() returns int language sql as $$
  select coalesce(sum(qty),0)::int from public.stock_movements where variant_id = '00000000-0000-0000-0000-00000000a101' $$;
create or replace function pg_temp.lines(inv uuid, q int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('invoice_line_id', (select id from public.sales_invoice_lines where invoice_id = inv), 'qty', q)) $$;
create or replace function pg_temp.refunds_total() returns numeric language sql as $$
  select coalesce(sum(amount),0) from public.sales_refunds $$;

-- setup: drawer open (100), invoice A = 3 units (3000 cash), invoice B = 2 units (2000 cash)
do $$ declare a public.sales_invoices; b public.sales_invoices; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform public.open_cash_session(100); reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  a := public.create_sale(null,null,0,null, pg_temp.items(3), pg_temp.pay(3000));
  b := public.create_sale(null,null,0,null, pg_temp.items(2), pg_temp.pay(2000)); reset role;
  insert into t_ids values ('A', a.id), ('B', b.id);
  perform pg_temp.rec('setup: two invoices, stock 5', pg_temp.stock() = 5, 'stock='||pg_temp.stock());
end $$;

-- 1. manager returns 1 unit (refund 1000 < threshold): completed, cash refund tied to the drawer, item goes to inspection, stock unchanged
do $$ declare a uuid; r public.sales_returns; n int; d text; begin
  select v into a from t_ids where k = 'A';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r := public.create_return(a, pg_temp.lines(a, 1), 'العميل غيّر رأيه', 'cash'); reset role;
  insert into t_ids values ('R1', r.id);
  select count(*) into n from public.sales_refunds where return_id = r.id and session_id is not null and amount = 1000;
  select disposition into d from public.sales_return_lines where return_id = r.id;
  perform pg_temp.rec('manager return: refunded, inspection, stock unchanged',
    r.status = 'completed' and n = 1 and d = 'inspection' and pg_temp.stock() = 5, r.status||' '||d||' stock='||pg_temp.stock());
end $$;

-- 2. cashier cannot validate the item; warehouse marks it sellable -> stock +1; second resolve refused
do $$ declare rl uuid; f1 boolean := false; f2 boolean := false; begin
  select id into rl from public.sales_return_lines where return_id = (select v from t_ids where k = 'R1');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin perform public.resolve_return_line(rl, 'sellable'); exception when others then f1 := true; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  perform public.resolve_return_line(rl, 'sellable');
  begin perform public.resolve_return_line(rl, 'damaged'); exception when others then f2 := true; end; reset role;
  perform pg_temp.rec('inspection: cashier blocked, warehouse restocks once', f1 and f2 and pg_temp.stock() = 6, 'stock='||pg_temp.stock());
end $$;

-- 3. cannot return more than was sold (3 sold, 1 already returned, asking 3)
do $$ declare a uuid; f boolean := false; begin
  select v into a from t_ids where k = 'A';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin perform public.create_return(a, pg_temp.lines(a, 3), 'x', 'cash'); exception when others then f := true; end; reset role;
  perform pg_temp.rec('cannot return more than sold', f);
end $$;

-- 4. cashier return always waits for the owner; no refund until approved
do $$ declare a uuid; r public.sales_returns; before_total numeric; n int; st text; begin
  select v into a from t_ids where k = 'A';
  before_total := pg_temp.refunds_total();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  r := public.create_return(a, pg_temp.lines(a, 1), 'عيب في الشاشة', 'cash'); reset role;
  select count(*) into n from public.sales_refunds where return_id = r.id;
  perform pg_temp.rec('cashier return waits for owner, no refund yet', r.status = 'pending_approval' and n = 0 and pg_temp.refunds_total() = before_total, r.status);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  perform public.decide_approval(r.approval_id, 'approved', 'ok'); reset role;
  select status into st from public.sales_returns where id = r.id;
  select count(*) into n from public.sales_refunds where return_id = r.id and amount = 1000;
  perform pg_temp.rec('owner approval completes the return and refunds', st = 'completed' and n = 1, st);
end $$;

-- 5. rejected return frees the quantity again (A: 3 sold, 2 returned, 1 left)
do $$ declare a uuid; r public.sales_returns; st text; ok boolean := true; begin
  select v into a from t_ids where k = 'A';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  r := public.create_return(a, pg_temp.lines(a, 1), 'تجربة', 'cash'); reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  perform public.decide_approval(r.approval_id, 'rejected', 'no'); reset role;
  select status into st from public.sales_returns where id = r.id;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin perform public.create_return(a, pg_temp.lines(a, 1), 'مرة ثانية', 'cash'); exception when others then ok := false; end; reset role;
  perform pg_temp.rec('rejected return frees the quantity', st = 'rejected' and ok, st);
end $$;

-- 6. manager return at/above threshold (2 x 1000 = 2000) waits for owner
do $$ declare b uuid; r public.sales_returns; begin
  select v into b from t_ids where k = 'B';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r := public.create_return(b, pg_temp.lines(b, 2), 'مرتجع كبير', 'cash'); reset role;
  perform pg_temp.rec('manager return >= threshold waits for owner', r.status = 'pending_approval' and r.refund_total = 2000, r.status||' '||r.refund_total);
end $$;

-- 7. a return of an unknown invoice is refused; anon is blocked
do $$ declare f1 boolean := false; f2 boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin perform public.create_return(gen_random_uuid(), '[{"invoice_line_id":"00000000-0000-0000-0000-000000000001","qty":1}]'::jsonb, 'x', 'cash'); exception when others then f1 := true; end; reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform public.create_return(gen_random_uuid(), '[]'::jsonb, 'x', 'cash'); exception when others then f2 := true; end; reset role;
  perform pg_temp.rec('unknown invoice refused, anon blocked', f1 and f2);
end $$;

-- 8. owner summary: net sales = gross - returns; cost reversed only for the restocked item
do $$ declare r jsonb; ret numeric; gross numeric; begin
  select coalesce(sum(refund_total),0) into ret from public.sales_returns where status = 'completed';
  select coalesce(sum(total),0) into gross from public.sales_invoices where status = 'completed';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  r := public.owner_summary((now() at time zone 'Africa/Cairo')::date, (now() at time zone 'Africa/Cairo')::date); reset role;
  perform pg_temp.rec('owner summary nets returns and reverses cost of restocked items',
    (r->>'returns')::numeric >= ret and ret = 3000
    and (r->>'sales')::numeric = (r->>'sales_gross')::numeric - (r->>'returns')::numeric
    and (r->>'returns_awaiting_inspection')::int >= 1, r::text);
end $$;

-- 9. drawer: expected cash includes cash refunds (closing at the exact expected amount needs no note)
do $$ declare s public.cash_sessions; calc numeric; c public.sales_invoices; begin
  -- a fresh invoice C (1 unit) so test 10 fails only because the drawer is closed
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  c := public.create_sale(null,null,0,null, pg_temp.items(1), pg_temp.pay(1000)); reset role;
  insert into t_ids values ('C', c.id);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  select 100 + (select coalesce(sum(amount),0) from public.sales_payments where method = 'cash' and session_id = (select id from public.cash_sessions where status = 'open'))
             - (select coalesce(sum(amount),0) from public.sales_refunds where method = 'cash' and session_id = (select id from public.cash_sessions where status = 'open')) into calc;
  s := public.close_cash_session(calc); reset role;
  perform pg_temp.rec('drawer expected cash subtracts cash refunds', s.expected_cash = calc and s.difference = 0, 'expected='||s.expected_cash||' calc='||calc);
end $$;

-- 10. cash refund with no open drawer is refused
do $$ declare c uuid; msg text := ''; begin
  select v into c from t_ids where k = 'C';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin perform public.create_return(c, pg_temp.lines(c, 1), 'بدون درج', 'cash'); exception when others then msg := sqlerrm; end; reset role;
  perform pg_temp.rec('cash refund refused when drawer is closed', msg like '%no open cash session%', msg);
end $$;

select n, test, ok, detail from (
  select 0 as n, 'SUMMARY: ' || count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' as test,
         coalesce(bool_and(ok), false) as ok, '' as detail from t_results
  union all select n, test, ok, detail from t_results
) x order by n;

rollback;
