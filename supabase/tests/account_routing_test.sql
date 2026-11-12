-- Card / wallet money from sales, refunds and repairs lands in an account (0025).
-- Run on STAGING after 0001-0025. Everything is rolled back: the last block raises the results as an error on purpose.
-- Expected: every line "= true".

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;
create temp table t_ids(k text primary key, v text);
grant all on t_ids to public;

insert into auth.users (id, aud, role, email) values
 ('00000000-0000-0000-0000-0000000000a9','authenticated','authenticated','t-owner9@test.invalid'),
 ('00000000-0000-0000-0000-0000000000b9','authenticated','authenticated','t-manager9@test.invalid');
insert into public.user_roles(user_id, role) values
 ('00000000-0000-0000-0000-0000000000a9','owner'),
 ('00000000-0000-0000-0000-0000000000b9','manager');
update public.cash_sessions set status = 'closed', closed_at = now() where status = 'open';

insert into public.products(id, name) values ('00000000-0000-0000-0000-00000000a009','هاتف اختبار حسابات');
insert into public.variants(id, product_id, sku, price) values
 ('00000000-0000-0000-0000-00000000a109','00000000-0000-0000-0000-00000000a009','AR-SKU-1', 1000);
insert into public.variant_costs(variant_id, cost) values ('00000000-0000-0000-0000-00000000a109', 600);
insert into public.stock_movements(variant_id, branch_id, movement_type, qty)
values ('00000000-0000-0000-0000-00000000a109',
        (select id from public.branches where is_active order by created_at limit 1), 'adjustment', 10);
insert into public.repair_orders(id, branch_id, customer_name, customer_phone, device_model, serial, complaint, intake_condition,
                                 custody_location, status, labor_cost, parts_cost, quoted_at, customer_decision, received_by)
select '00000000-0000-0000-0000-00000000e009', (select id from public.branches where is_active order by created_at limit 1),
       'عميل اختبار', '01012345678', 'iPhone 13', 'SN-99999-Z', 'شاشة', 'سليم', 'الورشة', 'ready',
       400, 100, now(), 'approved', '00000000-0000-0000-0000-0000000000b9';

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;
create or replace function pg_temp.rec(t text, ok boolean, d text default '') returns void
language sql as $$ insert into t_results(test, ok, detail) values (t, ok, d); $$;
create or replace function pg_temp.abal(a uuid) returns numeric language sql as $$
  select coalesce(sum(amount),0) from public.account_movements where account_id = a $$;
create or replace function pg_temp.id(key text) returns uuid language sql as $$ select v::uuid from t_ids where k = key $$;
create or replace function pg_temp.items(q int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('variant_id','00000000-0000-0000-0000-00000000a109','qty',q)) $$;

-- setup: a machine account and a wallet account (manager)
do $$ declare m uuid; w uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b9');
  perform public.open_cash_session(100);
  m := public.save_money_account(null, 'machine', 'ماكينة اختبار', null, null, null, 0);
  w := public.save_money_account(null, 'wallet', 'محفظة اختبار', '01000000099', null, null, 0); reset role;
  insert into t_ids values ('m', m::text), ('w', w::text);
  perform pg_temp.rec('setup: two accounts', m is not null and w is not null);
end $$;

-- 1. card sale 3,000 to the machine: the machine balance grows by 3,000, no drawer touched
do $$ declare inv public.sales_invoices; d0 numeric; d1 numeric; begin
  select coalesce(sum(amount),0) into d0 from public.drawer_movements;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b9');
  inv := public.create_sale(null, null, 0, null, pg_temp.items(3),
    jsonb_build_array(jsonb_build_object('method','card','amount',3000,'account',pg_temp.id('m')))); reset role;
  insert into t_ids values ('inv', inv.id::text);
  select coalesce(sum(amount),0) into d1 from public.drawer_movements;
  perform pg_temp.rec('1 card sale credits the machine', pg_temp.abal(pg_temp.id('m')) = 3000 and d0 = d1
    and exists (select 1 from public.sales_payments where invoice_id = inv.id and account_id = pg_temp.id('m')),
    'bal=' || pg_temp.abal(pg_temp.id('m')));
end $$;

-- 2. card sale without an account: recorded only, no movement
do $$ declare inv public.sales_invoices; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b9');
  inv := public.create_sale(null, null, 0, null, pg_temp.items(1), jsonb_build_array(jsonb_build_object('method','card','amount',1000))); reset role;
  perform pg_temp.rec('2 no account: recorded, nothing moves', pg_temp.abal(pg_temp.id('m')) = 3000);
end $$;

-- 3. a bad / unknown account id is refused and nothing is saved
do $$ declare f boolean := false; n0 int; n1 int; begin
  select count(*) into n0 from public.sales_invoices;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b9');
  begin
    perform public.create_sale(null, null, 0, null, pg_temp.items(1),
      jsonb_build_array(jsonb_build_object('method','card','amount',1000,'account',gen_random_uuid())));
  exception when others then f := true; end; reset role;
  select count(*) into n1 from public.sales_invoices;
  perform pg_temp.rec('3 unknown account refused', f and n0 = n1);
end $$;

-- 4. refund 1,000 by card from the machine (manager, below the approval threshold)
do $$ declare r public.sales_returns; inv uuid := pg_temp.id('inv'); begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b9');
  r := public.create_return_from(inv,
    jsonb_build_array(jsonb_build_object('invoice_line_id', (select id from public.sales_invoice_lines where invoice_id = inv), 'qty', 1)),
    'اختبار مرتجع', 'card', pg_temp.id('m')); reset role;
  perform pg_temp.rec('4 card refund debits the machine', r.status = 'completed' and pg_temp.abal(pg_temp.id('m')) = 2000,
    r.status || ' bal=' || pg_temp.abal(pg_temp.id('m')));
end $$;

-- 5. repair deposit 200 by wallet credits the wallet; a refund of 50 (manager) debits it
do $$ declare p1 uuid; p2 uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b9');
  p1 := public.record_repair_payment('00000000-0000-0000-0000-00000000e009', 200, 'wallet', 'deposit', null, gen_random_uuid(), pg_temp.id('w'));
  p2 := public.record_repair_payment('00000000-0000-0000-0000-00000000e009', 50, 'wallet', 'refund', 'خصم متفق عليه', gen_random_uuid(), pg_temp.id('w')); reset role;
  perform pg_temp.rec('5 repair wallet deposit and refund', pg_temp.abal(pg_temp.id('w')) = 150, 'bal=' || pg_temp.abal(pg_temp.id('w')));
end $$;

-- 6. a repair refund bigger than the wallet balance is refused (min balance 0)
do $$ declare f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b9');
  perform public.record_repair_payment('00000000-0000-0000-0000-00000000e009', 100, 'wallet', 'payment', null, gen_random_uuid(), pg_temp.id('w'));
  perform public.adjust_account(pg_temp.id('w'), 10, 'تصحيح', gen_random_uuid());
  begin
    perform public.record_repair_payment('00000000-0000-0000-0000-00000000e009', 100, 'wallet', 'refund', 'سبب', gen_random_uuid(), pg_temp.id('w'));
  exception when others then f := true; end; reset role;
  perform pg_temp.rec('6 refund over the account balance refused', f and pg_temp.abal(pg_temp.id('w')) = 10, 'bal=' || pg_temp.abal(pg_temp.id('w')));
end $$;

-- 7. repair repeat click (same key) does not move the account twice
do $$ declare k uuid := gen_random_uuid(); b0 numeric; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b9');
  perform public.record_repair_payment('00000000-0000-0000-0000-00000000e009', 10, 'wallet', 'payment', null, k, pg_temp.id('w'));
  b0 := pg_temp.abal(pg_temp.id('w'));
  perform public.record_repair_payment('00000000-0000-0000-0000-00000000e009', 10, 'wallet', 'payment', null, k, pg_temp.id('w')); reset role;
  perform pg_temp.rec('7 repair payment is idempotent', pg_temp.abal(pg_temp.id('w')) = b0, 'bal=' || b0);
end $$;

do $$ declare j text; begin
  select string_agg(test || ' = ' || ok || ' [' || detail || ']', E'\n' order by n) into j from t_results;
  raise exception E'RESULTS (rolled back)\n%', j;
end $$;
