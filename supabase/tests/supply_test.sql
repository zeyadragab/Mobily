-- Supply in one step, damaged goods, stock counts, shortage book (0028).
-- Run on STAGING after 0001-0028. Everything is rolled back: the last block raises the results as an error on purpose.
-- Expected: every line "= true".

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;
create temp table t_ids(k text primary key, v text);
grant all on t_ids to public;

insert into auth.users (id, aud, role, email) values
 ('00000000-0000-0000-0000-0000000000b5','authenticated','authenticated','t-manager5@test.invalid'),
 ('00000000-0000-0000-0000-0000000000c5','authenticated','authenticated','t-cashier5@test.invalid'),
 ('00000000-0000-0000-0000-0000000000d5','authenticated','authenticated','t-warehouse5@test.invalid');
insert into public.user_roles(user_id, role) values
 ('00000000-0000-0000-0000-0000000000b5','manager'),
 ('00000000-0000-0000-0000-0000000000c5','cashier'),
 ('00000000-0000-0000-0000-0000000000d5','warehouse');
update public.cash_sessions set status = 'closed', closed_at = now() where status = 'open';

insert into public.suppliers(id, name, phone) values ('00000000-0000-0000-0000-00000000f005', 'مورد اختبار توريد', '01000000005');
insert into public.products(id, name) values ('00000000-0000-0000-0000-00000000a005', 'منتج توريد عادي');
insert into public.products(id, name, track_serial) values ('00000000-0000-0000-0000-00000000a006', 'جهاز توريد', true);
insert into public.variants(id, product_id, sku, price) values
 ('00000000-0000-0000-0000-00000000a105', '00000000-0000-0000-0000-00000000a005', 'SUP-U', 150),
 ('00000000-0000-0000-0000-00000000a106', '00000000-0000-0000-0000-00000000a006', 'SUP-T', 5000);
insert into public.variant_costs(variant_id, cost) values ('00000000-0000-0000-0000-00000000a105', 100);
insert into public.stock_movements(variant_id, branch_id, movement_type, qty, unit_cost)
values ('00000000-0000-0000-0000-00000000a105', (select id from public.branches where is_active order by created_at limit 1), 'adjustment', 10, 100);

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;
create or replace function pg_temp.rec(t text, ok boolean, d text default '') returns void
language sql as $$ insert into t_results(test, ok, detail) values (t, ok, d); $$;
create or replace function pg_temp.stock(v uuid) returns int language sql as $$
  select coalesce(sum(qty), 0)::int from public.stock_movements where variant_id = v $$;
create or replace function pg_temp.id(key text) returns uuid language sql as $$ select v::uuid from t_ids where k = key $$;

-- 1. warehouse receives 10 x 120 on top of 10 x 100: stock 20, average cost 110, invoice 1,200 open, new price applied
do $$ declare inv uuid; c numeric; p numeric; amt numeric; st text; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d5');
  inv := public.receive_supply('00000000-0000-0000-0000-00000000f005', 'INV-T1', null, null,
    '[{"variant_id":"00000000-0000-0000-0000-00000000a105","qty":10,"unit_cost":120,"new_price":200}]'::jsonb,
    'apply', 0, null, null, null, '00000000-0000-0000-0000-00000000e501'); reset role;
  insert into t_ids values ('inv1', inv::text);
  select cost into c from public.variant_costs where variant_id = '00000000-0000-0000-0000-00000000a105';
  select price into p from public.variants where id = '00000000-0000-0000-0000-00000000a105';
  select amount, status into amt, st from public.supplier_invoices where id = inv;
  perform pg_temp.rec('1 supply: stock, average cost, price, invoice', pg_temp.stock('00000000-0000-0000-0000-00000000a105') = 20 and c = 110 and p = 200 and amt = 1200 and st = 'open',
    'stock=' || pg_temp.stock('00000000-0000-0000-0000-00000000a105') || ' cost=' || c);
end $$;

-- 2. same key again: same invoice, nothing doubled
do $$ declare inv uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d5');
  inv := public.receive_supply('00000000-0000-0000-0000-00000000f005', 'INV-T1', null, null,
    '[{"variant_id":"00000000-0000-0000-0000-00000000a105","qty":10,"unit_cost":120}]'::jsonb,
    'keep', 0, null, null, null, '00000000-0000-0000-0000-00000000e501'); reset role;
  perform pg_temp.rec('2 supply is idempotent', inv = pg_temp.id('inv1') and pg_temp.stock('00000000-0000-0000-0000-00000000a105') = 20
    and (select count(*) from public.supplier_invoices where supplier_id = '00000000-0000-0000-0000-00000000f005') = 1);
end $$;

-- 3. serial items: count must match, duplicates refused, then 2 devices received at 3,000
do $$ declare f1 boolean := false; f2 boolean := false; inv uuid; n int; c numeric; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d5');
  begin perform public.receive_supply('00000000-0000-0000-0000-00000000f005', 'INV-T2', null, null,
    '[{"variant_id":"00000000-0000-0000-0000-00000000a106","qty":2,"unit_cost":3000,"serials":["SUPSER-001","SUPSER-002","SUPSER-003"]}]'::jsonb,
    'keep', 0, null, null, null, gen_random_uuid()); exception when others then f1 := true; end;
  begin perform public.receive_supply('00000000-0000-0000-0000-00000000f005', 'INV-T2', null, null,
    '[{"variant_id":"00000000-0000-0000-0000-00000000a106","qty":2,"unit_cost":3000,"serials":["SUPSER-001","SUPSER-001"]}]'::jsonb,
    'keep', 0, null, null, null, gen_random_uuid()); exception when others then f2 := true; end;
  inv := public.receive_supply('00000000-0000-0000-0000-00000000f005', 'INV-T2', null, null,
    '[{"variant_id":"00000000-0000-0000-0000-00000000a106","qty":2,"unit_cost":3000,"serials":["SUPSER-001","SUPSER-002"]}]'::jsonb,
    'keep', 0, null, null, null, gen_random_uuid()); reset role;
  select count(*) into n from public.devices where serial in ('SUPSER-001','SUPSER-002') and supplier_id = '00000000-0000-0000-0000-00000000f005' and cost = 3000;
  select cost into c from public.variant_costs where variant_id = '00000000-0000-0000-0000-00000000a106';
  perform pg_temp.rec('3 serial supply', f1 and f2 and n = 2 and c = 3000 and pg_temp.stock('00000000-0000-0000-0000-00000000a106') = 2
    and (select amount = 6000 from public.supplier_invoices where id = inv), 'n=' || n);
end $$;

-- 4. paying while receiving: warehouse cannot pay; manager pays 500 cash from the products drawer; the rest stays as debt
do $$ declare f boolean := false; inv uuid; rem numeric; drw numeric; d0 numeric; begin
  select coalesce(sum(amount), 0) into d0 from public.drawer_movements where kind = 'supplier_payment';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b5');
  perform public.open_cash_session(1000); reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d5');
  begin perform public.receive_supply('00000000-0000-0000-0000-00000000f005', 'INV-T3', null, null,
    '[{"variant_id":"00000000-0000-0000-0000-00000000a105","qty":1,"unit_cost":100}]'::jsonb, 'keep', 50, 'cash', null, null, gen_random_uuid());
  exception when others then f := true; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b5');
  inv := public.receive_supply('00000000-0000-0000-0000-00000000f005', 'INV-T4', null, null,
    '[{"variant_id":"00000000-0000-0000-0000-00000000a105","qty":10,"unit_cost":120}]'::jsonb, 'keep', 500, 'cash', null, null, gen_random_uuid()); reset role;
  select remaining into rem from public.supplier_invoice_balances where id = inv;
  select coalesce(sum(amount), 0) - d0 into drw from public.drawer_movements where kind = 'supplier_payment';
  perform pg_temp.rec('4 pay at supply: role, drawer, remaining debt', f and rem = 700 and drw = -500, 'rem=' || rem || ' drawer=' || drw);
end $$;

-- 5. paying more than the invoice is refused and leaves no trace
do $$ declare f boolean := false; n0 int; n1 int; begin
  select count(*) into n0 from public.supplier_invoices;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b5');
  begin perform public.receive_supply('00000000-0000-0000-0000-00000000f005', 'INV-T5', null, null,
    '[{"variant_id":"00000000-0000-0000-0000-00000000a105","qty":1,"unit_cost":100}]'::jsonb, 'keep', 101, 'cash', null, null, gen_random_uuid());
  exception when others then f := true; end; reset role;
  select count(*) into n1 from public.supplier_invoices;
  perform pg_temp.rec('5 overpayment refused', f and n0 = n1);
end $$;

-- 6. damaged goods: 3 pieces out of stock with a reason; too many, no reason, serial items refused
do $$ declare s0 int; f1 boolean := false; f2 boolean := false; f3 boolean := false; begin
  s0 := pg_temp.stock('00000000-0000-0000-0000-00000000a105');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d5');
  perform public.record_damage('00000000-0000-0000-0000-00000000a105', 3, 'سقط من الرف', false, null);
  begin perform public.record_damage('00000000-0000-0000-0000-00000000a105', 9999, 'x', false, null); exception when others then f1 := true; end;
  begin perform public.record_damage('00000000-0000-0000-0000-00000000a105', 1, '  ', false, null); exception when others then f2 := true; end;
  begin perform public.record_damage('00000000-0000-0000-0000-00000000a106', 1, 'x', false, null); exception when others then f3 := true; end; reset role;
  perform pg_temp.rec('6 damaged goods', pg_temp.stock('00000000-0000-0000-0000-00000000a105') = s0 - 3 and f1 and f2 and f3
    and exists (select 1 from public.damaged_items where qty = 3));
end $$;

-- 7. stock count: one open count; counted 15 needs a reason; only manager approves; stock becomes the counted figure
do $$ declare cnt uuid; f1 boolean := false; f2 boolean := false; f3 boolean := false; f4 boolean := false; ch int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d5');
  cnt := public.start_stock_count('جرد اختبار', null);
  insert into t_ids values ('cnt', cnt::text);
  begin perform public.start_stock_count('ثاني', null); exception when others then f1 := true; end;
  perform public.save_count_line(cnt, '00000000-0000-0000-0000-00000000a105', 15, null);
  begin perform public.approve_stock_count(cnt); exception when others then f2 := true; end;
  begin perform public.save_count_line(cnt, '00000000-0000-0000-0000-00000000a106', 1, 'x'); exception when others then f3 := true; end;
  perform public.save_count_line(cnt, '00000000-0000-0000-0000-00000000a105', 15, 'missing'); reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b5');
  ch := public.approve_stock_count(cnt);
  begin perform public.approve_stock_count(cnt); exception when others then f4 := true; end; reset role;
  perform pg_temp.rec('7 count: single open, reason, role, approve once', f1 and f2 and f3 and f4 and ch = 1
    and pg_temp.stock('00000000-0000-0000-0000-00000000a105') = 15
    and (select status = 'approved' from public.stock_counts where id = cnt), 'stock=' || pg_temp.stock('00000000-0000-0000-0000-00000000a105'));
end $$;

-- 8. serial count: scanning one of two devices; the other becomes "missing" and stock follows
do $$ declare cnt uuid; n int; f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d5');
  cnt := public.start_stock_count(null, null);
  n := public.scan_count_serial(cnt, 'supser-001');
  begin perform public.scan_count_serial(cnt, 'NOT-A-DEVICE'); exception when others then f := true; end;
  reset role;
  update public.stock_count_lines set reason = 'missing' where count_id = cnt and variant_id = '00000000-0000-0000-0000-00000000a106';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b5');
  perform public.approve_stock_count(cnt); reset role;
  perform pg_temp.rec('8 serial count marks the unscanned device missing', n = 1 and f and pg_temp.stock('00000000-0000-0000-0000-00000000a106') = 1
    and (select status::text from public.devices where serial = 'SUPSER-002') = 'missing'
    and (select status::text from public.devices where serial = 'SUPSER-001') = 'in_stock', 'stock=' || pg_temp.stock('00000000-0000-0000-0000-00000000a106'));
end $$;

-- 9. shortage book: anyone on staff adds; only warehouse / managers change it
do $$ declare f boolean := false; n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c5');
  insert into public.shortage_book(name, note) values ('شاحن سريع', 'العميل سأل عنه 3 مرات');
  update public.shortage_book set resolved_at = now(); get diagnostics n = row_count; reset role;
  perform pg_temp.rec('9 shortage book', n = 0 and exists (select 1 from public.shortage_book where name = 'شاحن سريع' and resolved_at is null));
end $$;

do $$ declare j text; begin
  select string_agg(test || ' = ' || ok || ' [' || detail || ']', E'\n' order by n) into j from t_results;
  raise exception E'RESULTS (rolled back)\n%', j;
end $$;
