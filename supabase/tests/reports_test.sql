-- Reports (0039). Run on STAGING after 0001-0039. Everything is rolled back: the last block raises the results as an error on purpose.
-- Expected: every line "= true".

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;

insert into auth.users (id, aud, role, email) values
 ('00000000-0000-0000-0000-0000000039a1','authenticated','authenticated','t-owner39@test.invalid'),
 ('00000000-0000-0000-0000-0000000039b1','authenticated','authenticated','t-manager39@test.invalid'),
 ('00000000-0000-0000-0000-0000000039c1','authenticated','authenticated','t-cashier39@test.invalid'),
 ('00000000-0000-0000-0000-0000000039d1','authenticated','authenticated','t-accountant39@test.invalid');
insert into public.user_roles(user_id, role) values
 ('00000000-0000-0000-0000-0000000039a1','owner'),
 ('00000000-0000-0000-0000-0000000039b1','manager'),
 ('00000000-0000-0000-0000-0000000039c1','cashier'),
 ('00000000-0000-0000-0000-0000000039d1','accountant');

create temp table t_ids(k text primary key, v text);
grant all on t_ids to public;
create temp table t_snap(k text primary key, v jsonb);
grant all on t_snap to public;
update public.cash_sessions set status = 'closed', closed_at = now() where status = 'open';
insert into public.products(id, name) values ('00000000-0000-0000-0000-00000000a039', 'منتج تقارير 39');
insert into public.variants(id, product_id, sku, price) values ('00000000-0000-0000-0000-00000000b039', '00000000-0000-0000-0000-00000000a039', 'RP39-1', 100);
insert into public.variant_costs(variant_id, cost) values ('00000000-0000-0000-0000-00000000b039', 60);
insert into public.stock_movements(variant_id, branch_id, movement_type, qty, unit_cost)
values ('00000000-0000-0000-0000-00000000b039', (select id from public.branches where is_active order by created_at limit 1), 'adjustment', 50, 0);

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;
create or replace function pg_temp.rec(t text, ok boolean, d text default '') returns void
language sql as $$ insert into t_results(test, ok, detail) values (t, ok, d); $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return ''; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.kpi(r jsonb, lbl text) returns numeric language sql as $$
  select (jsonb_path_query_first(r->'kpis', '$[*] ? (@.label == $l)', jsonb_build_object('l', lbl))->>'value')::numeric $$;

-- 1. all 18 reports run and have the expected shape (a wide range so real staging data is included)
do $$ declare r jsonb; names text[] := array['report_comprehensive','report_sales','report_returns','report_product_movement','report_expenses','report_suppliers',
  'report_peak','report_trends','report_tradein','report_employees','report_inout','report_installments','report_wallet_ops','report_bills','report_maintenance'];
  nm text; bad text := ''; n int := 0; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000039a1');
  foreach nm in array names loop
    begin
      execute format('select public.%I(%L, %L)', nm, date '2026-01-01', date '2026-11-30') into r;
      if jsonb_typeof(r->'kpis') <> 'array' or jsonb_typeof(r->'tables') <> 'array' then bad := bad || nm || ' shape; '; end if;
      n := n + 1;
    exception when others then bad := bad || nm || ': ' || sqlerrm || '; '; end;
  end loop;
  foreach nm in array array['report_stock_valuation','report_customer_debts','report_capital'] loop
    begin
      execute format('select public.%I()', nm) into r;
      if jsonb_typeof(r->'kpis') <> 'array' or jsonb_typeof(r->'tables') <> 'array' then bad := bad || nm || ' shape; '; end if;
      n := n + 1;
    exception when others then bad := bad || nm || ': ' || sqlerrm || '; '; end;
  end loop;
  reset role;
  perform pg_temp.rec('1 all 18 reports run for the owner', bad = '' and n = 18, 'ran=' || n || ' ' || bad);
end $$;

-- 2. who may run reports: owner, manager, accountant yes; cashier no; range over 400 days refused
do $$ declare f_c text; f_m text; f_a text; f_r text; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000039c1');
  f_c := pg_temp.err('select public.report_sales(date ''2026-11-01'', date ''2026-11-30'')');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000039b1');
  f_m := pg_temp.err('select public.report_sales(date ''2026-11-01'', date ''2026-11-30'')');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000039d1');
  f_a := pg_temp.err('select public.report_capital()');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000039a1');
  f_r := pg_temp.err('select public.report_sales(date ''2025-01-01'', date ''2026-11-30'')');
  reset role;
  perform pg_temp.rec('2 roles and range', f_c like '%not allowed%' and f_m = '' and f_a = '' and f_r like '%invalid range%', f_c || ' | ' || f_m || ' | ' || f_a || ' | ' || f_r);
end $$;

-- 2b. a small scenario with known numbers; every report figure is compared as a before / after difference
--     sale 1: 3 x 100 = 300 (100 cash + 200 credit, profit 120); sale 2: 2 x 100 cash (profit 80); sale 3: 1 x 100 on credit (profit 40)
--     return: 2 pieces of sale 1 (value 200 taken off the debt, profit lost 80)
create or replace function pg_temp.item(q int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('variant_id','00000000-0000-0000-0000-00000000b039','qty',q)) $$;
create or replace function pg_temp.snap(lbl text) returns void language plpgsql as $$
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000039a1');
  insert into t_snap values (lbl, jsonb_build_object(
    'sales', public.report_sales(date '2026-01-01', date '2026-11-30'), 'returns', public.report_returns(date '2026-01-01', date '2026-11-30'),
    'comp', public.report_comprehensive(date '2026-01-01', date '2026-11-30'), 'debts', public.report_customer_debts(),
    'peak', public.report_peak(date '2026-01-01', date '2026-11-30'), 'cap', public.report_capital(), 'stock', public.report_stock_valuation()));
  reset role;
end $$;
create or replace function pg_temp.delta(rep text, lbl text) returns numeric language sql as $$
  select pg_temp.kpi((select v->rep from t_snap where k = 'after'), lbl) - pg_temp.kpi((select v->rep from t_snap where k = 'before'), lbl) $$;
create or replace function pg_temp.peak_total(snap text) returns numeric language sql as $$
  select coalesce(sum((e->>'invoices')::numeric),0) from jsonb_array_elements((select v->'peak'->'tables'->1->'rows' from t_snap where k = snap)) e $$;

do $$ declare c uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000039b1');
  perform public.open_cash_session(100);
  c := public.save_customer(null, 'عميل تقارير 39', '01000000039', null, 'regular', 5000, null);
  reset role;
  insert into t_ids values ('cust', c::text);
  perform pg_temp.snap('before');
end $$;

do $$ declare i1 public.sales_invoices; r public.sales_returns; c uuid := (select v::uuid from t_ids where k = 'cust'); begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000039b1');
  i1 := public.create_sale_once(gen_random_uuid(), null, null, 0, null, pg_temp.item(3),
    jsonb_build_array(jsonb_build_object('method','cash','amount',100), jsonb_build_object('method','credit','amount',200)), null, c);
  perform public.create_sale_once(gen_random_uuid(), null, null, 0, null, pg_temp.item(2), jsonb_build_array(jsonb_build_object('method','cash','amount',200)));
  perform public.create_sale_once(gen_random_uuid(), null, null, 0, null, pg_temp.item(1), jsonb_build_array(jsonb_build_object('method','credit','amount',100)), null, c);
  r := public.create_return_from(i1.id, jsonb_build_array(jsonb_build_object(
         'invoice_line_id', (select id from public.sales_invoice_lines where invoice_id = i1.id), 'qty', 2, 'condition', 'new')), 'تقارير', 'cash');
  reset role;
  perform pg_temp.snap('after');
  perform pg_temp.rec('2b setup: sales and return done', r.status = 'completed' and r.debt_reduction = 200, 'debt_reduction=' || r.debt_reduction);
end $$;

do $$ begin
  perform pg_temp.rec('2c sales report: 3 invoices, 600 total, 300 credit, 240 profit',
    pg_temp.delta('sales', 'عدد الفواتير') = 3 and pg_temp.delta('sales', 'إجمالي المبيعات') = 600 and pg_temp.delta('sales', 'آجل') = 300
    and pg_temp.delta('sales', 'الربح (دفتري)') = 240,
    pg_temp.delta('sales', 'عدد الفواتير') || '/' || pg_temp.delta('sales', 'إجمالي المبيعات') || '/' || pg_temp.delta('sales', 'آجل') || '/' || pg_temp.delta('sales', 'الربح (دفتري)'));
  perform pg_temp.rec('2d returns report: 1 return, 200 value, 80 profit lost',
    pg_temp.delta('returns', 'عدد المرتجعات') = 1 and pg_temp.delta('returns', 'قيمة المرتجعات') = 200 and pg_temp.delta('returns', 'ربح ضائع') = 80,
    pg_temp.delta('returns', 'عدد المرتجعات') || '/' || pg_temp.delta('returns', 'قيمة المرتجعات') || '/' || pg_temp.delta('returns', 'ربح ضائع'));
  perform pg_temp.rec('2e comprehensive: net sales +400, product profit +40 (returned goods wait in inspection, so their cost stays in COGS until resolved)',
    pg_temp.delta('comp', 'صافي المبيعات') = 400 and pg_temp.delta('comp', 'ربح المنتجات') = 40,
    pg_temp.delta('comp', 'صافي المبيعات') || '/' || pg_temp.delta('comp', 'ربح المنتجات'));
  perform pg_temp.rec('2f customer debts +100 (200 + 100 credit minus 200 returned)', pg_temp.delta('debts', 'إجمالي الديون') = 100, pg_temp.delta('debts', 'إجمالي الديون')::text);
  perform pg_temp.rec('2g peak report counts the 3 invoices', pg_temp.peak_total('after') - pg_temp.peak_total('before') = 3,
    (pg_temp.peak_total('after') - pg_temp.peak_total('before'))::text);
  perform pg_temp.rec('2h stock valuation: 6 sold, the 2 returned pieces are in inspection, so on-hand value drops by 360',
    pg_temp.delta('stock', 'قيمة المخزون بالتكلفة') = -360 and pg_temp.delta('cap', 'مخزون بالتكلفة') = -360,
    pg_temp.delta('stock', 'قيمة المخزون بالتكلفة') || '/' || pg_temp.delta('cap', 'مخزون بالتكلفة'));
end $$;

-- 3. cross-checks against the older owner_summary and independent sums
do $$ declare s jsonb; o jsonb; c jsonb; sv jsonb; cap jsonb; cd jsonb; indep numeric; cap_stock numeric; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000039a1');
  s := public.report_sales(date '2026-01-01', date '2026-11-30');
  o := public.owner_summary(date '2026-01-01', date '2026-11-30');
  sv := public.report_stock_valuation();
  cap := public.report_capital();
  cd := public.report_customer_debts();
  c := public.report_comprehensive(date '2026-01-01', date '2026-11-30');
  reset role;
  perform pg_temp.rec('3a sales total equals owner_summary gross sales', pg_temp.kpi(s, 'إجمالي المبيعات') = (o->>'sales_gross')::numeric,
    pg_temp.kpi(s, 'إجمالي المبيعات') || ' vs ' || (o->>'sales_gross'));
  cap_stock := pg_temp.kpi(cap, 'مخزون بالتكلفة');
  perform pg_temp.rec('3b capital stock equals stock valuation', cap_stock = pg_temp.kpi(sv, 'قيمة المخزون بالتكلفة'), cap_stock || ' vs ' || pg_temp.kpi(sv, 'قيمة المخزون بالتكلفة'));
  select coalesce(sum(b),0) into indep from (select sum(amount) as b from public.customer_ledger group by customer_id having sum(amount) > 0) x;
  perform pg_temp.rec('3c customer debts equal the ledger', pg_temp.kpi(cd, 'إجمالي الديون') = indep, pg_temp.kpi(cd, 'إجمالي الديون') || ' vs ' || indep);
  perform pg_temp.rec('3d comprehensive net equals its own last-but-one line',
    pg_temp.kpi(c, 'صافي النتيجة') = (select (e->>'amount')::numeric from jsonb_array_elements(c->'tables'->0->'rows') e where e->>'item' = 'صافي النتيجة'),
    pg_temp.kpi(c, 'صافي النتيجة')::text);
  perform pg_temp.rec('3e sales gross profit not above sales',
    pg_temp.kpi(c, 'ربح المنتجات') <= pg_temp.kpi(c, 'صافي المبيعات') + 0.005, pg_temp.kpi(c, 'ربح المنتجات') || ' / ' || pg_temp.kpi(c, 'صافي المبيعات'));
end $$;

-- 4. the owner can lock the reports page on a manager: the report is then refused
do $$ declare f text; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000039a1');
  perform public.set_page_permission('00000000-0000-0000-0000-0000000039b1', '/reports', false);
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000039b1');
  f := pg_temp.err('select public.report_capital()');
  reset role;
  perform pg_temp.rec('4 page lock blocks reports', f like '%not allowed%', f);
end $$;

-- 5. anon cannot execute any report; the helpers are closed to everyone
do $$ declare anon_any boolean; helper_open boolean; begin
  select bool_or(has_function_privilege('anon', p.oid, 'execute')) into anon_any from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'report\_%';
  select bool_or(has_function_privilege('authenticated', p.oid, 'execute')) into helper_open from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('rep_guard','rep_kpi','rep_tbl');
  perform pg_temp.rec('5 anon closed, helpers closed', not anon_any and not helper_open, 'anon=' || anon_any || ' helpers=' || helper_open);
end $$;

do $$ declare j text; begin
  select string_agg(test || ' = ' || ok || ' [' || detail || ']', E'\n' order by n) into j from t_results;
  raise exception E'RESULTS (rolled back)\n%', j;
end $$;
