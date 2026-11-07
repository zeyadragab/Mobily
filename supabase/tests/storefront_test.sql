-- Storefront test for 0005. Run in the Supabase SQL Editor AFTER 0001-0005.
-- Fake data in ONE transaction that is ROLLED BACK. Expected: every row ok = true.

begin;

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;

insert into auth.users (id, aud, role, email) values
 ('00000000-0000-0000-0000-0000000000b1','authenticated','authenticated','t-manager@test.invalid'),
 ('00000000-0000-0000-0000-0000000000c1','authenticated','authenticated','t-cashier@test.invalid');
insert into public.user_roles(user_id, role) values
 ('00000000-0000-0000-0000-0000000000b1','manager'),
 ('00000000-0000-0000-0000-0000000000c1','cashier');

insert into public.branches(id, name) values ('00000000-0000-0000-0000-00000000e001','فرع اختبار') on conflict do nothing;
insert into public.products(id, name, is_published) values
 ('00000000-0000-0000-0000-00000000a001','هاتف منشور', true),
 ('00000000-0000-0000-0000-00000000a002','هاتف غير منشور', false);
insert into public.variants(id, product_id, sku, price) values
 ('00000000-0000-0000-0000-00000000a101','00000000-0000-0000-0000-00000000a001','W-SKU-1', 1000),
 ('00000000-0000-0000-0000-00000000a102','00000000-0000-0000-0000-00000000a002','W-SKU-2', 500);
insert into public.variant_costs(variant_id, cost) values ('00000000-0000-0000-0000-00000000a101', 600);
-- exactly ONE unit of the published variant, 3 of the unpublished
insert into public.stock_movements(variant_id, branch_id, movement_type, qty) values
 ('00000000-0000-0000-0000-00000000a101','00000000-0000-0000-0000-00000000e001','adjustment', 1),
 ('00000000-0000-0000-0000-00000000a102','00000000-0000-0000-0000-00000000e001','adjustment', 3);

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
end $$;
create or replace function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
end $$;
create or replace function pg_temp.rec(t text, ok boolean, d text default '') returns void
language sql as $$ insert into t_results(test, ok, detail) values (t, ok, d); $$;

-- 1. anon sees only published variants, with no cost column
do $$ declare n int; c int; begin
  perform pg_temp.as_anon();
  select count(*) into n from public.catalog_items where variant_id in
    ('00000000-0000-0000-0000-00000000a101','00000000-0000-0000-0000-00000000a102');
  select count(*) into c from information_schema.columns
   where table_schema='public' and table_name='catalog_items' and column_name ilike '%cost%';
  reset role;
  perform pg_temp.rec('anon sees published only, no cost column', n = 1 and c = 0, 'rows='||n||' costcols='||c);
end $$;

-- 2. anon cannot read base tables
do $$ declare a int := 0; b int := 0; c int := 0; begin
  perform pg_temp.as_anon();
  begin select count(*) into a from public.online_orders; exception when others then a := 0; end;
  begin select count(*) into b from public.variant_costs; exception when others then b := 0; end;
  begin select count(*) into c from public.stock_movements; exception when others then c := 0; end;
  reset role;
  perform pg_temp.rec('anon cannot read orders/costs/stock', a = 0 and b = 0 and c = 0);
end $$;

-- 3. anon cannot order an unpublished item
do $$ declare f boolean := false; begin
  perform pg_temp.as_service();
  begin perform public.place_online_order('عميل','01012345678',null,'pickup',null,
    jsonb_build_array(jsonb_build_object('variant_id','00000000-0000-0000-0000-00000000a102','qty',1)));
  exception when others then f := true; end; reset role;
  perform pg_temp.rec('unpublished item cannot be ordered', f);
end $$;

-- 4. FIRST buyer of the last piece succeeds
create temp table t_order(num text, tok text);
grant all on t_order to public;
do $$ declare r jsonb; begin
  perform pg_temp.as_service();
  r := public.place_online_order('عميل أول','01011111111',null,'pickup',null,
    jsonb_build_array(jsonb_build_object('variant_id','00000000-0000-0000-0000-00000000a101','qty',1)));
  reset role;
  insert into t_order values (r->>'order_number', r->>'access_token');
  perform pg_temp.rec('first buyer reserves the last piece', (r->>'total')::numeric = 1000, r::text);
end $$;

-- 5. SECOND buyer of the same piece is refused
do $$ declare f boolean := false; begin
  perform pg_temp.as_service();
  begin perform public.place_online_order('عميل ثان','01022222222',null,'pickup',null,
    jsonb_build_array(jsonb_build_object('variant_id','00000000-0000-0000-0000-00000000a101','qty',1)));
  exception when others then f := true; end; reset role;
  perform pg_temp.rec('second buyer refused (no double sale)', f);
end $$;

-- 6. catalog now shows 0 available
do $$ declare a int; begin
  perform pg_temp.as_anon();
  select available into a from public.catalog_items where variant_id = '00000000-0000-0000-0000-00000000a101';
  reset role;
  perform pg_temp.rec('availability drops to 0 while reserved', a = 0, 'available='||a);
end $$;

-- 7. tracking: right token works, wrong token returns null
do $$ declare ok jsonb; bad jsonb; begin
  perform pg_temp.as_anon();
  select public.track_order(num, tok) into ok from t_order;
  select public.track_order(num, 'wrong-token') into bad from t_order;
  reset role;
  perform pg_temp.rec('track works only with the right token', ok->>'status' = 'reserved' and bad is null);
end $$;

-- 8. invalid input is rejected (qty 6, bad phone, delivery without address)
do $$ declare f1 boolean := false; f2 boolean := false; f3 boolean := false; begin
  perform pg_temp.as_service();
  begin perform public.place_online_order('عميل','01033333333',null,'pickup',null,
    jsonb_build_array(jsonb_build_object('variant_id','00000000-0000-0000-0000-00000000a102','qty',6))); exception when others then f1 := true; end;
  begin perform public.place_online_order('عميل','12',null,'pickup',null,
    jsonb_build_array(jsonb_build_object('variant_id','00000000-0000-0000-0000-00000000a101','qty',1))); exception when others then f2 := true; end;
  begin perform public.place_online_order('عميل','01033333333','x','delivery',null,
    jsonb_build_array(jsonb_build_object('variant_id','00000000-0000-0000-0000-00000000a101','qty',1))); exception when others then f3 := true; end;
  reset role;
  perform pg_temp.rec('invalid qty / phone / address rejected', f1 and f2 and f3);
end $$;

-- 9. cashier cancels -> piece is released -> new buyer succeeds
do $$ declare oid uuid; r jsonb; begin
  select id into oid from public.online_orders where order_number = (select num from t_order);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform public.set_online_order_status(oid, 'cancelled', 'العميل لم يرد'); reset role;
  perform pg_temp.as_service();
  r := public.place_online_order('عميل ثالث','01044444444',null,'pickup',null,
    jsonb_build_array(jsonb_build_object('variant_id','00000000-0000-0000-0000-00000000a101','qty',1)));
  reset role;
  insert into t_order values (r->>'order_number', r->>'access_token');
  perform pg_temp.rec('cancel releases the piece for the next buyer', r->>'order_number' is not null);
end $$;

-- 10. staff flow: confirm -> ready -> delivered creates a sale movement and clears reservation
do $$ declare oid uuid; s text; q int; res int; begin
  select id into oid from public.online_orders where phone = '01044444444';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform public.set_online_order_status(oid, 'confirmed');
  perform public.set_online_order_status(oid, 'ready');
  perform public.set_online_order_status(oid, 'delivered'); reset role;
  select status::text into s from public.online_orders where id = oid;
  select coalesce(sum(qty),0) into q from public.stock_movements where variant_id = '00000000-0000-0000-0000-00000000a101';
  select count(*) into res from public.stock_reservations where order_id = oid and released_at is null;
  perform pg_temp.rec('delivered: stock 0, reservation cleared', s = 'delivered' and q = 0 and res = 0, s||' stock='||q||' res='||res);
end $$;

-- 11. invalid transition and anon staff call are refused
do $$ declare oid uuid; f1 boolean := false; f2 boolean := false; begin
  select id into oid from public.online_orders where phone = '01044444444';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin perform public.set_online_order_status(oid, 'ready'); exception when others then f1 := true; end; reset role;
  perform pg_temp.as_anon();
  begin perform public.set_online_order_status(oid, 'cancelled', 'x'); exception when others then f2 := true; end; reset role;
  perform pg_temp.rec('bad transition and anon staff call refused', f1 and f2);
end $$;

-- 12. per-phone limit: 4th open order from one phone is refused
do $$ declare i int; f boolean := false; begin
  insert into public.stock_movements(variant_id, branch_id, movement_type, qty)
  values ('00000000-0000-0000-0000-00000000a101','00000000-0000-0000-0000-00000000e001','adjustment', 10);
  perform pg_temp.as_service();
  for i in 1..3 loop
    perform public.place_online_order('عميل','01055555555',null,'pickup',null,
      jsonb_build_array(jsonb_build_object('variant_id','00000000-0000-0000-0000-00000000a101','qty',1)));
  end loop;
  begin perform public.place_online_order('عميل','01055555555',null,'pickup',null,
      jsonb_build_array(jsonb_build_object('variant_id','00000000-0000-0000-0000-00000000a101','qty',1)));
  exception when others then f := true; end;
  reset role;
  perform pg_temp.rec('max 3 open orders per phone', f);
end $$;

select n, test, ok, detail from (
  select 0 as n, 'SUMMARY: ' || count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' as test,
         coalesce(bool_and(ok), false) as ok, '' as detail from t_results
  union all select n, test, ok, detail from t_results
) x order by n;

rollback;
