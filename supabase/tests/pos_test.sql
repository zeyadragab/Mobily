-- POS: wholesale mode, price floor with manager PIN, offers, bundles, uncoded sale, sales log (0029).
-- Run on STAGING after 0001-0029. Everything is rolled back: the last block raises the results as an error on purpose.
-- Expected: every line "= true".

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;
create temp table t_ids(k text primary key, v text);
grant all on t_ids to public;

insert into auth.users (id, aud, role, email) values
 ('00000000-0000-0000-0000-0000000000a4','authenticated','authenticated','t-owner4@test.invalid'),
 ('00000000-0000-0000-0000-0000000000b4','authenticated','authenticated','t-manager4@test.invalid'),
 ('00000000-0000-0000-0000-0000000000c4','authenticated','authenticated','t-cashier4@test.invalid');
insert into public.user_roles(user_id, role) values
 ('00000000-0000-0000-0000-0000000000a4','owner'),
 ('00000000-0000-0000-0000-0000000000b4','manager'),
 ('00000000-0000-0000-0000-0000000000c4','cashier');
insert into public.manager_pins(user_id, pin_hash) values ('00000000-0000-0000-0000-0000000000b4', extensions.crypt('1234', extensions.gen_salt('bf')));
update public.cash_sessions set status = 'closed', closed_at = now() where status = 'open';

insert into public.products(id, name) values ('00000000-0000-0000-0000-00000000a004', 'منتج نقطة بيع');
insert into public.variants(id, product_id, sku, price, wholesale_price) values
 ('00000000-0000-0000-0000-00000000a104', '00000000-0000-0000-0000-00000000a004', 'POS-1', 100, 80),
 ('00000000-0000-0000-0000-00000000a204', '00000000-0000-0000-0000-00000000a004', 'POS-2', 200, null);
insert into public.variant_costs(variant_id, cost) values
 ('00000000-0000-0000-0000-00000000a104', 60), ('00000000-0000-0000-0000-00000000a204', 150);
insert into public.stock_movements(variant_id, branch_id, movement_type, qty, unit_cost)
select v, (select id from public.branches where is_active order by created_at limit 1), 'adjustment', 100, 0
  from (values ('00000000-0000-0000-0000-00000000a104'::uuid), ('00000000-0000-0000-0000-00000000a204'::uuid)) x(v);

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;
create or replace function pg_temp.rec(t text, ok boolean, d text default '') returns void
language sql as $$ insert into t_results(test, ok, detail) values (t, ok, d); $$;
create or replace function pg_temp.id(key text) returns uuid language sql as $$ select v::uuid from t_ids where k = key $$;
create or replace function pg_temp.line(vid text, q int, price numeric default null) returns jsonb language sql as $$
  select jsonb_build_object('variant_id', vid, 'qty', q) || case when price is null then '{}'::jsonb else jsonb_build_object('price', price) end $$;
create or replace function pg_temp.cash(a numeric) returns jsonb language sql as $$ select jsonb_build_array(jsonb_build_object('method','cash','amount',a)) $$;
-- a manager PIN token for the cashier
create or replace function pg_temp.token() returns uuid language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c4');
  r := public.request_override('00000000-0000-0000-0000-0000000000b4', '1234', 'اختبار سعر');
  reset role;
  return (r->>'token')::uuid;
end $$;

do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c4');
  perform public.open_cash_session(100); reset role;
  perform pg_temp.rec('setup: open shift', exists (select 1 from public.cash_sessions where status = 'open'));
end $$;

-- 1. wholesale mode uses the wholesale price (item without one keeps the retail price)
do $$ declare inv public.sales_invoices; l1 numeric; l2 numeric; lp numeric; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c4');
  inv := public.create_sale_once(gen_random_uuid(), null, null, 0, null,
    jsonb_build_array(pg_temp.line('00000000-0000-0000-0000-00000000a104', 2), pg_temp.line('00000000-0000-0000-0000-00000000a204', 1)),
    pg_temp.cash(360), null, null, 'wholesale', null, null); reset role;
  select unit_price, list_price into l1, lp from public.sales_invoice_lines where invoice_id = inv.id and variant_id = '00000000-0000-0000-0000-00000000a104';
  select unit_price into l2 from public.sales_invoice_lines where invoice_id = inv.id and variant_id = '00000000-0000-0000-0000-00000000a204';
  perform pg_temp.rec('1 wholesale price mode', l1 = 80 and lp = 80 and l2 = 200 and inv.total = 360 and inv.price_mode = 'wholesale', 'total=' || inv.total);
end $$;

-- 2. cashier price override: within 5% ok, beyond needs a manager PIN token, with the token ok, token spent once
do $$ declare ok1 boolean := false; f1 boolean := false; f2 boolean := false; tok uuid; inv public.sales_invoices; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c4');
  begin perform public.create_sale_once(gen_random_uuid(), null, null, 0, null, jsonb_build_array(pg_temp.line('00000000-0000-0000-0000-00000000a104', 1, 96)), pg_temp.cash(96)); ok1 := true; exception when others then ok1 := false; end;
  begin perform public.create_sale_once(gen_random_uuid(), null, null, 0, null, jsonb_build_array(pg_temp.line('00000000-0000-0000-0000-00000000a104', 1, 90)), pg_temp.cash(90)); exception when others then f1 := true; end;
  reset role;
  tok := pg_temp.token();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c4');
  inv := public.create_sale_once(gen_random_uuid(), null, null, 0, null, jsonb_build_array(pg_temp.line('00000000-0000-0000-0000-00000000a104', 1, 90)), pg_temp.cash(90), null, null, 'retail', null, tok);
  begin perform public.create_sale_once(gen_random_uuid(), null, null, 0, null, jsonb_build_array(pg_temp.line('00000000-0000-0000-0000-00000000a104', 1, 90)), pg_temp.cash(90), null, null, 'retail', null, tok); exception when others then f2 := true; end;
  reset role;
  perform pg_temp.rec('2 price override and PIN token', ok1 and f1 and inv.total = 90 and f2, ok1::text || f1::text || f2::text);
end $$;

-- 3. below cost: cashier needs a token, manager needs a token too, owner does not
do $$ declare f1 boolean := false; f2 boolean := false; ok boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b4');
  begin perform public.create_sale_once(gen_random_uuid(), null, null, 0, null, jsonb_build_array(pg_temp.line('00000000-0000-0000-0000-00000000a104', 1, 50)), pg_temp.cash(50)); exception when others then f1 := true; end;
  begin perform public.create_sale_once(gen_random_uuid(), null, null, 0, null, jsonb_build_array(pg_temp.line('00000000-0000-0000-0000-00000000a104', 1, 70)), pg_temp.cash(70)); f2 := true; exception when others then f2 := false; end;
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a4');
  begin perform public.create_sale_once(gen_random_uuid(), null, null, 0, null, jsonb_build_array(pg_temp.line('00000000-0000-0000-0000-00000000a104', 1, 50)), pg_temp.cash(50)); ok := true; exception when others then ok := false; end;
  reset role;
  perform pg_temp.rec('3 below cost: manager blocked, above cost ok, owner free', f1 and f2 and ok, f1::text || f2::text || ok::text);
end $$;

-- 4. percent offer 10% capped at 15, then expired and used-up offers are refused
do $$ declare o1 uuid; o2 uuid; o3 uuid; inv public.sales_invoices; f1 boolean := false; f2 boolean := false; f3 boolean := false; begin
  insert into public.offers(name, kind, value, cap) values ('خصم 10', 'percent', 10, 15) returning id into o1;
  insert into public.offers(name, kind, value, ends_on) values ('منتهي', 'percent', 10, ((now() at time zone 'Africa/Cairo')::date - 1)) returning id into o2;
  insert into public.offers(name, kind, value, max_uses) values ('مرة واحدة', 'fixed', 5, 1) returning id into o3;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c4');
  inv := public.create_sale_once(gen_random_uuid(), null, null, 0, null, jsonb_build_array(pg_temp.line('00000000-0000-0000-0000-00000000a204', 1)), pg_temp.cash(185), null, null, 'retail', o1, null);
  begin perform public.create_sale_once(gen_random_uuid(), null, null, 0, null, jsonb_build_array(pg_temp.line('00000000-0000-0000-0000-00000000a204', 1)), pg_temp.cash(180), null, null, 'retail', o2, null); exception when others then f1 := true; end;
  perform public.create_sale_once(gen_random_uuid(), null, null, 0, null, jsonb_build_array(pg_temp.line('00000000-0000-0000-0000-00000000a204', 1)), pg_temp.cash(195), null, null, 'retail', o3, null);
  begin perform public.create_sale_once(gen_random_uuid(), null, null, 0, null, jsonb_build_array(pg_temp.line('00000000-0000-0000-0000-00000000a204', 1)), pg_temp.cash(195), null, null, 'retail', o3, null); exception when others then f2 := true; end;
  reset role;
  perform pg_temp.rec('4 percent offer with cap, expiry and max uses', inv.total = 185 and inv.offer_discount = 15 and f1 and f2
    and (select uses = 1 from public.offers where id = o1), 'total=' || inv.total);
end $$;

-- 5. buy 2 get 1 on POS-1: three pieces, one free
do $$ declare o uuid; inv public.sales_invoices; begin
  insert into public.offers(name, kind, value, variant_id, buy_qty, get_qty) values ('اشتري 2 والثالث مجاني', 'bxgy', 0, '00000000-0000-0000-0000-00000000a104', 2, 1) returning id into o;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c4');
  inv := public.create_sale_once(gen_random_uuid(), null, null, 0, null, jsonb_build_array(pg_temp.line('00000000-0000-0000-0000-00000000a104', 3)), pg_temp.cash(200), null, null, 'retail', o, null); reset role;
  perform pg_temp.rec('5 buy X get Y', inv.total = 200 and inv.offer_discount = 100, 'total=' || inv.total);
end $$;

-- 6. bundle POS-1 + POS-2 for 250 (list 300): two bundles in the cart give 100 off; missing item = no offer
do $$ declare o uuid; inv public.sales_invoices; f boolean := false; begin
  insert into public.offers(name, kind, value) values ('باقة', 'bundle', 250) returning id into o;
  insert into public.offer_items(offer_id, variant_id, qty) values (o, '00000000-0000-0000-0000-00000000a104', 1), (o, '00000000-0000-0000-0000-00000000a204', 1);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c4');
  inv := public.create_sale_once(gen_random_uuid(), null, null, 0, null, jsonb_build_array(pg_temp.line('00000000-0000-0000-0000-00000000a104', 2), pg_temp.line('00000000-0000-0000-0000-00000000a204', 2)), pg_temp.cash(500), null, null, 'retail', o, null);
  begin perform public.create_sale_once(gen_random_uuid(), null, null, 0, null, jsonb_build_array(pg_temp.line('00000000-0000-0000-0000-00000000a104', 2)), pg_temp.cash(200), null, null, 'retail', o, null); exception when others then f := true; end;
  reset role;
  perform pg_temp.rec('6 bundle offer', inv.total = 500 and inv.offer_discount = 100 and f, 'total=' || inv.total);
end $$;

-- 7. uncoded item: cashier below the limit ok and recorded; at or above the limit needs a token
do $$ declare inv public.sales_invoices; f boolean := false; inv2 public.sales_invoices; tok uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c4');
  inv := public.create_sale_once(gen_random_uuid(), null, null, 0, null,
    jsonb_build_array(jsonb_build_object('uncoded', jsonb_build_object('name', 'كابل بدون كود', 'qty', 1, 'price', 500, 'cost', 300, 'reason', 'صنف جديد لم يُسجل'))), pg_temp.cash(500));
  begin perform public.create_sale_once(gen_random_uuid(), null, null, 0, null,
    jsonb_build_array(jsonb_build_object('uncoded', jsonb_build_object('name', 'جهاز', 'qty', 1, 'price', 1500, 'cost', 900, 'reason', 'x'))), pg_temp.cash(1500)); exception when others then f := true; end;
  reset role;
  tok := pg_temp.token();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c4');
  inv2 := public.create_sale_once(gen_random_uuid(), null, null, 0, null,
    jsonb_build_array(jsonb_build_object('uncoded', jsonb_build_object('name', 'جهاز', 'qty', 1, 'price', 1500, 'cost', 900, 'reason', 'x'))), pg_temp.cash(1500), null, null, 'retail', null, tok);
  reset role;
  perform pg_temp.rec('7 uncoded sale', inv.total = 500 and f and inv2.total = 1500 and (select count(*) from public.uncoded_sales where invoice_id in (inv.id, inv2.id)) = 2);
end $$;

-- 8. sales log: paid, credit, and profit shown to a manager but not to a cashier
do $$ declare inv public.sales_invoices; pm numeric; pc numeric; pd numeric; cr numeric; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b4');
  inv := public.create_sale_once(gen_random_uuid(), null, null, 0, null, jsonb_build_array(pg_temp.line('00000000-0000-0000-0000-00000000a204', 1)), pg_temp.cash(200));
  select profit, paid, credit into pm, pd, cr from public.sales_log where id = inv.id; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c4');
  select profit into pc from public.sales_log where id = inv.id; reset role;
  perform pg_temp.rec('8 sales log profit by role', pm = 50 and pd = 200 and cr = 0 and pc is null, 'manager profit=' || coalesce(pm::text, 'null'));
end $$;

-- 9. the same key returns the same invoice (new parameters do not break it)
do $$ declare k uuid := gen_random_uuid(); a public.sales_invoices; b public.sales_invoices; s0 int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c4');
  a := public.create_sale_once(k, null, null, 0, null, jsonb_build_array(pg_temp.line('00000000-0000-0000-0000-00000000a104', 1)), pg_temp.cash(100), null, null, 'retail', null, null);
  b := public.create_sale_once(k, null, null, 0, null, jsonb_build_array(pg_temp.line('00000000-0000-0000-0000-00000000a104', 1)), pg_temp.cash(100), null, null, 'retail', null, null); reset role;
  perform pg_temp.rec('9 idempotent', a.id = b.id);
end $$;

do $$ declare j text; begin
  select string_agg(test || ' = ' || ok || ' [' || detail || ']', E'\n' order by n) into j from t_results;
  raise exception E'RESULTS (rolled back)\n%', j;
end $$;
