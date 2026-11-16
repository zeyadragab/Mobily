-- Returns v2: credit invoices, credit refund, manual reduction, conditions, search, warranty checker, archive (0030).
-- Run on STAGING after 0001-0030. Everything is rolled back: the last block raises the results as an error on purpose.
-- Expected: every line "= true".

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;
create temp table t_ids(k text primary key, v text);
grant all on t_ids to public;

insert into auth.users (id, aud, role, email) values
 ('00000000-0000-0000-0000-0000000000b3','authenticated','authenticated','t-manager3@test.invalid'),
 ('00000000-0000-0000-0000-0000000000c3','authenticated','authenticated','t-cashier3@test.invalid');
insert into public.user_roles(user_id, role) values
 ('00000000-0000-0000-0000-0000000000b3','manager'),
 ('00000000-0000-0000-0000-0000000000c3','cashier');
insert into public.manager_pins(user_id, pin_hash) values ('00000000-0000-0000-0000-0000000000b3', extensions.crypt('1234', extensions.gen_salt('bf')));
update public.cash_sessions set status = 'closed', closed_at = now() where status = 'open';

insert into public.products(id, name) values ('00000000-0000-0000-0000-00000000a003', 'منتج مرتجعات 2');
insert into public.products(id, name, track_serial) values ('00000000-0000-0000-0000-00000000a013', 'جهاز مرتجعات 2', true);
insert into public.variants(id, product_id, sku, price, barcode, warranty_months) values
 ('00000000-0000-0000-0000-00000000a103', '00000000-0000-0000-0000-00000000a003', 'RV2-1', 100, '6009999000013', 0),
 ('00000000-0000-0000-0000-00000000a113', '00000000-0000-0000-0000-00000000a013', 'RV2-T', 3000, null, 12);
insert into public.variant_costs(variant_id, cost) values ('00000000-0000-0000-0000-00000000a103', 60), ('00000000-0000-0000-0000-00000000a113', 2000);
insert into public.stock_movements(variant_id, branch_id, movement_type, qty, unit_cost)
select v, (select id from public.branches where is_active order by created_at limit 1), 'adjustment', q, 0
  from (values ('00000000-0000-0000-0000-00000000a103'::uuid, 50), ('00000000-0000-0000-0000-00000000a113'::uuid, 2)) x(v, q);
insert into public.devices(variant_id, serial, cost, branch_id) values
 ('00000000-0000-0000-0000-00000000a113', 'RV2IMEI0001', 2000, (select id from public.branches where is_active order by created_at limit 1)),
 ('00000000-0000-0000-0000-00000000a113', 'RV2IMEI0002', 2000, (select id from public.branches where is_active order by created_at limit 1));

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;
create or replace function pg_temp.rec(t text, ok boolean, d text default '') returns void
language sql as $$ insert into t_results(test, ok, detail) values (t, ok, d); $$;
create or replace function pg_temp.id(key text) returns uuid language sql as $$ select v::uuid from t_ids where k = key $$;
create or replace function pg_temp.item(q int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('variant_id','00000000-0000-0000-0000-00000000a103','qty',q)) $$;
create or replace function pg_temp.rl(inv uuid, q int, cond text default null) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('invoice_line_id', (select id from public.sales_invoice_lines where invoice_id = inv and variant_id = '00000000-0000-0000-0000-00000000a103'), 'qty', q)
         || case when cond is null then '{}'::jsonb else jsonb_build_object('condition', cond) end) $$;
create or replace function pg_temp.bal() returns numeric language sql as $$
  select coalesce(sum(amount), 0) from public.customer_ledger where customer_id = pg_temp.id('cust') $$;
create or replace function pg_temp.token() returns uuid language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
  r := public.request_override('00000000-0000-0000-0000-0000000000b3', '1234', 'اختبار خصم مرتجع');
  reset role;
  return (r->>'token')::uuid;
end $$;

do $$ declare c uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
  perform public.open_cash_session(100);
  c := public.save_customer(null, 'عميل مرتجعات', '01000000093', null, 'regular', 5000, null); reset role;
  insert into t_ids values ('cust', c::text);
  perform pg_temp.rec('setup: shift and customer', c is not null);
end $$;

-- 1. credit invoice: 3 x 100, 100 cash + 200 credit. Returning 2 pieces cancels the 200 debt, nothing is paid out.
do $$ declare inv public.sales_invoices; r public.sales_returns; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
  inv := public.create_sale_once(gen_random_uuid(), null, null, 0, null, pg_temp.item(3),
    jsonb_build_array(jsonb_build_object('method','cash','amount',100), jsonb_build_object('method','credit','amount',200)), null, pg_temp.id('cust'));
  insert into t_ids values ('inv1', inv.id::text);
  r := public.create_return_from(inv.id, pg_temp.rl(inv.id, 2), 'العميل رجّع', 'cash'); reset role;
  perform pg_temp.rec('1 return on a credit invoice reduces the debt', r.status = 'completed' and r.debt_reduction = 200 and r.refund_total = 0
    and pg_temp.bal() = 0 and not exists (select 1 from public.sales_refunds where return_id = r.id), 'bal=' || pg_temp.bal());
end $$;

-- 2. the last piece: nothing left on credit, so 100 is paid out in cash
do $$ declare r public.sales_returns; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
  r := public.create_return_from(pg_temp.id('inv1'), pg_temp.rl(pg_temp.id('inv1'), 1), 'القطعة الأخيرة', 'cash'); reset role;
  perform pg_temp.rec('2 rest is paid out', r.debt_reduction = 0 and r.refund_total = 100
    and exists (select 1 from public.sales_refunds where return_id = r.id and amount = 100 and method = 'cash'), 'refund=' || r.refund_total);
end $$;

-- 3. refund to the customer account: ledger credit (balance goes negative), no cash out; needs a customer
do $$ declare inv public.sales_invoices; r public.sales_returns; inv2 public.sales_invoices; f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
  inv := public.create_sale_once(gen_random_uuid(), null, null, 0, null, pg_temp.item(1), jsonb_build_array(jsonb_build_object('method','cash','amount',100)), null, pg_temp.id('cust'));
  r := public.create_return_from(inv.id, pg_temp.rl(inv.id, 1), 'رصيد للعميل', 'credit');
  inv2 := public.create_sale_once(gen_random_uuid(), null, null, 0, null, pg_temp.item(1), jsonb_build_array(jsonb_build_object('method','cash','amount',100)));
  begin perform public.create_return_from(inv2.id, pg_temp.rl(inv2.id, 1), 'بدون عميل', 'credit'); exception when others then f := true; end; reset role;
  perform pg_temp.rec('3 credit refund', r.refund_total = 0 and r.debt_reduction = 100 and pg_temp.bal() = -100 and f, 'bal=' || pg_temp.bal());
end $$;

-- 4. manual reduction by a manager: 20 kept by the shop; more than the refund and no reason are refused
do $$ declare inv public.sales_invoices; r public.sales_returns; f1 boolean := false; f2 boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
  inv := public.create_sale_once(gen_random_uuid(), null, null, 0, null, pg_temp.item(1), jsonb_build_array(jsonb_build_object('method','cash','amount',100)));
  begin perform public.create_return_from(inv.id, pg_temp.rl(inv.id, 1), 'x', 'cash', null, 150, 'رسوم'); exception when others then f1 := true; end;
  begin perform public.create_return_from(inv.id, pg_temp.rl(inv.id, 1), 'x', 'cash', null, 20, null); exception when others then f2 := true; end;
  r := public.create_return_from(inv.id, pg_temp.rl(inv.id, 1, 'used'), 'مستعمل', 'cash', null, 20, 'رسوم جهاز مستعمل'); reset role;
  perform pg_temp.rec('4 manual reduction', f1 and f2 and r.refund_total = 80 and r.manual_reduction = 20 and r.reduction_reason = 'رسوم جهاز مستعمل'
    and exists (select 1 from public.sales_return_lines where return_id = r.id and condition = 'used'), 'refund=' || r.refund_total);
end $$;

-- 5. a cashier needs a manager PIN token for a reduction; an unknown condition is refused
do $$ declare inv public.sales_invoices; r public.sales_returns; f1 boolean := false; f2 boolean := false; tok uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
  inv := public.create_sale_once(gen_random_uuid(), null, null, 0, null, pg_temp.item(1), jsonb_build_array(jsonb_build_object('method','cash','amount',100)));
  begin perform public.create_return_from(inv.id, pg_temp.rl(inv.id, 1), 'x', 'cash', null, 10, 'رسوم'); exception when others then f1 := true; end;
  begin perform public.create_return_from(inv.id, pg_temp.rl(inv.id, 1, 'weird'), 'x', 'cash'); exception when others then f2 := true; end;
  reset role;
  tok := pg_temp.token();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
  r := public.create_return_from(inv.id, pg_temp.rl(inv.id, 1), 'x', 'cash', null, 10, 'رسوم', tok); reset role;
  perform pg_temp.rec('5 cashier reduction needs a PIN, bad condition refused', f1 and f2 and r.manual_reduction = 10 and r.status = 'pending_approval', r.status);
end $$;

-- 6. finding an invoice by number, phone, device serial and barcode
do $$ declare inv public.sales_invoices; a boolean; b boolean; c boolean; d boolean; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
  inv := public.create_sale_once(gen_random_uuid(), 'مشتري جهاز', '01000000094',  0, null,
    jsonb_build_array(jsonb_build_object('variant_id','00000000-0000-0000-0000-00000000a113','serials', jsonb_build_array('RV2IMEI0001'))),
    jsonb_build_array(jsonb_build_object('method','cash','amount',3000)));
  insert into t_ids values ('dev', inv.id::text);
  a := inv.id in (select public.find_returnable_invoices(inv.invoice_number));
  b := inv.id in (select public.find_returnable_invoices('01000000094'));
  c := inv.id in (select public.find_returnable_invoices('rv2imei0001'));
  d := exists (select 1 from public.find_returnable_invoices('6009999000013')); reset role;
  perform pg_temp.rec('6 invoice search', a and b and c and d, a::text || b::text || c::text || d::text);
end $$;

-- 7. warranty checker: serial and invoice number find the sold device (12 months), unknown or short terms do not
do $$ declare n1 int; n2 int; v boolean; dl int; f boolean := false; n3 int; invno text; begin
  select invoice_number into invno from public.sales_invoices where id = pg_temp.id('dev');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
  select count(*), bool_or(is_valid), max(days_left) into n1, v, dl from public.check_warranty('rv2imei0001');
  select count(*) into n2 from public.check_warranty(invno);
  select count(*) into n3 from public.check_warranty('NOSUCHSERIAL99');
  begin perform public.check_warranty('abc'); exception when others then f := true; end; reset role;
  perform pg_temp.rec('7 warranty checker', n1 = 1 and v and dl > 300 and n2 = 1 and n3 = 0 and f, 'days=' || coalesce(dl::text, 'null'));
end $$;

-- 8. returns archive lists the returns with their items
do $$ declare n int; m int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
  select count(*), coalesce(sum(items), 0) into n, m from public.returns_archive where reason in ('العميل رجّع', 'القطعة الأخيرة', 'رصيد للعميل'); reset role;
  perform pg_temp.rec('8 returns archive', n = 3 and m = 4, 'n=' || n || ' items=' || m);
end $$;

do $$ declare j text; begin
  select string_agg(test || ' = ' || ok || ' [' || detail || ']', E'\n' order by n) into j from t_results;
  raise exception E'RESULTS (rolled back)\n%', j;
end $$;
