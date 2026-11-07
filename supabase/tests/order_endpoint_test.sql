-- Order endpoint lockdown test for 0010. Run AFTER 0001-0010. Rolled back; nothing is kept.
-- Expected: first row "SUMMARY: 7 passed, 0 failed".

begin;

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;
create temp table t_ids(k text primary key, v text);
grant all on t_ids to public;

insert into auth.users (id, aud, role, email) values
 ('00000000-0000-0000-0000-0000000000c1','authenticated','authenticated','t-cashier@test.invalid');
insert into public.user_roles(user_id, role) values ('00000000-0000-0000-0000-0000000000c1','cashier');

insert into public.branches(id, name) values ('00000000-0000-0000-0000-00000000e001','فرع اختبار') on conflict do nothing;
insert into public.products(id, name, is_published) values ('00000000-0000-0000-0000-00000000a001','هاتف اختبار نقطة الطلب', true);
insert into public.variants(id, product_id, sku, price) values ('00000000-0000-0000-0000-00000000a101','00000000-0000-0000-0000-00000000a001','E-SKU-1', 1000);
insert into public.stock_movements(variant_id, branch_id, movement_type, qty)
values ('00000000-0000-0000-0000-00000000a101', (select id from public.branches where is_active order by created_at limit 1), 'adjustment', 5);

create or replace function pg_temp.rec(t text, ok boolean, d text default '') returns void
language sql as $$ insert into t_results(test, ok, detail) values (t, ok, d); $$;
create or replace function pg_temp.items() returns jsonb language sql as $$
  select '[{"variant_id":"00000000-0000-0000-0000-00000000a101","qty":1}]'::jsonb $$;

-- 1. anonymous visitors (bots) cannot call the order function directly
do $$ declare f boolean := false; msg text := ''; begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform public.place_online_order('بوت','01012345678',null,'pickup',null, pg_temp.items()); exception when others then f := true; msg := sqlerrm; end;
  reset role;
  perform pg_temp.rec('anon cannot call place_online_order directly', f, msg);
end $$;

-- 2. logged-in staff cannot call it directly either (orders only come through the Edge Function)
do $$ declare f boolean := false; begin
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000c1','role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.place_online_order('موظف','01012345678',null,'pickup',null, pg_temp.items()); exception when others then f := true; end;
  reset role;
  perform pg_temp.rec('authenticated cannot call place_online_order directly', f);
end $$;

-- 3. the service role (the Edge Function) can place an order
do $$ declare r jsonb; begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  r := public.place_online_order('عميل','01012345678',null,'pickup',null, pg_temp.items());
  reset role;
  insert into t_ids values ('num', r->>'order_number'), ('tok', r->>'access_token');
  perform pg_temp.rec('service role can place an order', (r->>'total')::numeric = 1000, r->>'order_number');
end $$;

-- 4. customers can still track their order with the secret token (and only with it)
do $$ declare ok jsonb; bad jsonb; begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  select public.track_order((select v from t_ids where k = 'num'), (select v from t_ids where k = 'tok')) into ok;
  select public.track_order((select v from t_ids where k = 'num'), 'wrong-token') into bad;
  reset role;
  perform pg_temp.rec('anon can still track with the right token only', ok->>'status' = 'reserved' and bad is null);
end $$;

-- 5. nobody except the service role can read or write the attempts table
do $$ declare a int := 0; f1 boolean := false; f2 boolean := false; begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin select count(*) into a from public.order_attempts; exception when others then a := 0; end;
  begin insert into public.order_attempts(ip) values ('1.2.3.4'); exception when others then f1 := true; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000c1','role','authenticated')::text, true);
  set local role authenticated;
  begin insert into public.order_attempts(ip) values ('1.2.3.4'); exception when others then f2 := true; end;
  reset role;
  perform pg_temp.rec('order_attempts is closed to anon and authenticated', a = 0 and f1 and f2);
end $$;

-- 6. the service role can record and count attempts (what the rate limit uses)
do $$ declare n int; begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  insert into public.order_attempts(ip) values ('9.9.9.9'), ('9.9.9.9'), ('8.8.8.8');
  select count(*) into n from public.order_attempts where ip = '9.9.9.9' and at > now() - interval '1 hour';
  reset role;
  perform pg_temp.rec('service role can count attempts per IP', n = 2, 'n='||n);
end $$;

-- 7. the public catalog is still readable by anon (the website keeps working)
do $$ declare n int; begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  select count(*) into n from public.catalog_items where variant_id = '00000000-0000-0000-0000-00000000a101';
  reset role;
  perform pg_temp.rec('public catalog still readable by anon', n = 1, 'rows='||n);
end $$;

select n, test, ok, detail from (
  select 0 as n, 'SUMMARY: ' || count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' as test,
         coalesce(bool_and(ok), false) as ok, '' as detail from t_results
  union all select n, test, ok, detail from t_results
) x order by n;

rollback;
