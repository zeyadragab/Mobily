-- Drawers and shifts test for 0016. Run in the Supabase SQL Editor AFTER 0001-0016, on STAGING.
-- Fake data in ONE transaction that is ROLLED BACK. Expected: every row ok = true.
-- Needs migration 0015 too (PIN + override tokens).

begin;

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;

insert into auth.users (id, aud, role, email) values
 ('00000000-0000-0000-0000-0000000000a1','authenticated','authenticated','t-owner4@test.invalid'),
 ('00000000-0000-0000-0000-0000000000b1','authenticated','authenticated','t-manager4@test.invalid'),
 ('00000000-0000-0000-0000-0000000000c1','authenticated','authenticated','t-cashier4@test.invalid');
insert into public.user_roles(user_id, role) values
 ('00000000-0000-0000-0000-0000000000a1','owner'),
 ('00000000-0000-0000-0000-0000000000b1','manager'),
 ('00000000-0000-0000-0000-0000000000c1','cashier');

update public.cash_sessions set status = 'closed', closed_at = now() where status = 'open';
insert into public.products(id, name) values ('00000000-0000-0000-0000-00000000a003','هاتف اختبار أدراج');
insert into public.variants(id, product_id, sku, price) values
 ('00000000-0000-0000-0000-00000000a103','00000000-0000-0000-0000-00000000a003','DRW-SKU-1', 1000);
insert into public.variant_costs(variant_id, cost) values ('00000000-0000-0000-0000-00000000a103', 600);
insert into public.stock_movements(variant_id, branch_id, movement_type, qty)
values ('00000000-0000-0000-0000-00000000a103',
        (select id from public.branches where is_active order by created_at limit 1), 'adjustment', 20);

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;
create or replace function pg_temp.rec(t text, ok boolean, d text default '') returns void
language sql as $$ insert into t_results(test, ok, detail) values (t, ok, d); $$;
create or replace function pg_temp.bal(c text) returns numeric language sql as $$
  select coalesce(sum(m.amount),0) from public.drawer_movements m join public.drawers d on d.id = m.drawer_id
   where d.code = c and d.branch_id = (select id from public.branches where is_active order by created_at limit 1) $$;
create or replace function pg_temp.did(c text) returns uuid language sql as $$
  select id from public.drawers where code = c and branch_id = (select id from public.branches where is_active order by created_at limit 1) $$;
create or replace function pg_temp.items(q int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('variant_id','00000000-0000-0000-0000-00000000a103','qty',q)) $$;
create or replace function pg_temp.pay(m text, a numeric) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('method', m, 'amount', a)) $$;

-- baseline of the safe (it is never counted, so we assert changes against it)
create temp table t_base(k text primary key, v numeric);
grant all on t_base to public;
insert into t_base values ('safe', pg_temp.bal('safe'));

-- 0. six drawers exist for the branch
do $$ declare n int; begin
  select count(*) into n from public.drawers where branch_id = (select id from public.branches where is_active order by created_at limit 1);
  perform pg_temp.rec('6 drawers per branch', n = 6, n::text);
end $$;

-- 1. cashier opens a shift: products counted 100, wallets 50, others skipped
do $$ declare s public.cash_sessions; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  s := public.open_shift(null, '{"products":100,"wallets":50}'::jsonb); reset role;
  perform pg_temp.rec('shift opens; counted drawers take the counted value',
    s.status = 'open' and s.opening_balance = 100 and pg_temp.bal('products') = 100 and pg_temp.bal('wallets') = 50,
    'products=' || pg_temp.bal('products') || ' wallets=' || pg_temp.bal('wallets'));
end $$;

-- 2. a second open is refused; an unknown drawer key is refused
do $$ declare f1 boolean := false; f2 boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin perform public.open_shift(null, '{}'::jsonb); exception when others then f1 := true; end;
  begin perform public.open_shift(null, '{"safe":5}'::jsonb); exception when others then f2 := true; end; reset role;
  perform pg_temp.rec('second open and unknown drawer key refused', f1 and f2);
end $$;

-- 3. a cash sale is mirrored into the products drawer
do $$ declare inv public.sales_invoices; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  inv := public.create_sale(null, null, 0, null, pg_temp.items(2), pg_temp.pay('cash', 2000)); reset role;
  perform pg_temp.rec('cash sale lands in the products drawer', pg_temp.bal('products') = 2100, 'products=' || pg_temp.bal('products'));
end $$;

-- 4. a card sale does NOT touch any drawer
do $$ declare inv public.sales_invoices; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  inv := public.create_sale(null, null, 0, null, pg_temp.items(1), pg_temp.pay('card', 1000)); reset role;
  perform pg_temp.rec('card sale leaves drawers unchanged', pg_temp.bal('products') = 2100);
end $$;

-- 5. transfers: cashier cannot touch the safe; manager can; repeat key = no second transfer
do $$ declare f boolean := false; g1 uuid; g2 uuid; idem uuid := '00000000-0000-0000-0000-0000000f0001'; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin perform public.transfer_drawer(pg_temp.did('products'), pg_temp.did('safe'), 500, 'اختبار', gen_random_uuid()); exception when others then f := true; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  g1 := public.transfer_drawer(pg_temp.did('products'), pg_temp.did('safe'), 500, 'إيداع بالخزنة', idem);
  g2 := public.transfer_drawer(pg_temp.did('products'), pg_temp.did('safe'), 500, 'إيداع بالخزنة', idem); reset role;
  perform pg_temp.rec('safe transfer: cashier refused, manager ok, repeat key moves money once',
    f and g1 = g2 and pg_temp.bal('products') = 1600 and pg_temp.bal('safe') - (select v from t_base where k = 'safe') = 500,
    'products=' || pg_temp.bal('products'));
end $$;

-- 6. not enough money in the drawer
do $$ declare f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin perform public.transfer_drawer(pg_temp.did('wallets'), pg_temp.did('products'), 99999, null, gen_random_uuid());
  exception when others then f := sqlerrm like '%insufficient drawer balance%'; end; reset role;
  perform pg_temp.rec('transfer above the drawer balance refused', f);
end $$;

-- 7. PIN threshold: big transfer needs a manager token; token works once; owner is exempt
do $$ declare f1 boolean := false; f2 boolean := false; r jsonb; tok uuid; begin
  update public.app_settings set value = 1000 where key = 'drawer_transfer_pin_threshold';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.set_my_pin('482913'); reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin perform public.transfer_drawer(pg_temp.did('products'), pg_temp.did('wallets'), 1500, null, gen_random_uuid());
  exception when others then f1 := sqlerrm like '%override required%'; end;
  r := public.request_override('00000000-0000-0000-0000-0000000000b1', '482913', 'تحويل كبير');
  tok := (r->>'token')::uuid;
  perform public.transfer_drawer(pg_temp.did('products'), pg_temp.did('wallets'), 1500, null, gen_random_uuid(), tok);
  begin perform public.transfer_drawer(pg_temp.did('wallets'), pg_temp.did('products'), 1200, null, gen_random_uuid(), tok);
  exception when others then f2 := true; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  perform public.transfer_drawer(pg_temp.did('wallets'), pg_temp.did('products'), 1200, 'المالك', gen_random_uuid()); reset role;
  perform pg_temp.rec('PIN needed above threshold, token single-use, owner exempt',
    f1 and (r->>'ok')::boolean and f2 and pg_temp.bal('products') = 1300 and pg_temp.bal('wallets') = 350,
    'products=' || pg_temp.bal('products') || ' wallets=' || pg_temp.bal('wallets'));
end $$;

-- 8. adjust: cashier refused; reason required; no-change refused; manager adjusts
do $$ declare c boolean := false; r boolean := false; z boolean := false; res numeric; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin perform public.adjust_drawer(pg_temp.did('wallets'), 400, 'x', gen_random_uuid()); exception when others then c := true; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin perform public.adjust_drawer(pg_temp.did('wallets'), 400, '  ', gen_random_uuid()); exception when others then r := true; end;
  begin perform public.adjust_drawer(pg_temp.did('wallets'), 350, 'لا تغيير', gen_random_uuid()); exception when others then z := sqlerrm like '%no change%'; end;
  res := public.adjust_drawer(pg_temp.did('wallets'), 400, 'جرد المحافظ', gen_random_uuid()); reset role;
  perform pg_temp.rec('adjust: cashier refused, reason required, no-change refused, manager sets balance',
    c and r and z and res = 400 and pg_temp.bal('wallets') = 400);
end $$;

-- 9. close: a difference needs a note; with a note it is recorded and the drawer takes the counted value
do $$ declare f boolean := false; s public.cash_sessions; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin perform public.close_shift('{"products":1250,"wallets":400}'::jsonb, null); exception when others then f := sqlerrm like '%note required%'; end;
  s := public.close_shift('{"products":1250,"wallets":400}'::jsonb, 'نقص في درج المنتجات'); reset role;
  perform pg_temp.rec('close: note required for a difference; difference and counts saved',
    f and s.status = 'closed' and s.difference = -50 and pg_temp.bal('products') = 1250
      and (s.closing_counts->'products'->>'difference')::numeric = -50,
    'difference=' || coalesce(s.difference::text, 'null') || ' products=' || pg_temp.bal('products'));
end $$;

-- 10. balances carry over: the next shift opens at the closing count; the safe is untouched by shifts
do $$ declare s public.cash_sessions; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  s := public.open_shift(null, '{}'::jsonb); reset role;
  perform pg_temp.rec('next shift carries the balance over; safe unchanged',
    s.opening_balance = 1250 and pg_temp.bal('safe') - (select v from t_base where k = 'safe') = 500);
end $$;

-- 11. visibility and abuse: ledger is append-only; cashier cannot read raw movements; anon is blocked
do $$ declare f1 boolean := false; n int := 0; f2 boolean := false; f3 boolean := false; bal_rows int := 0; begin
  begin update public.drawer_movements set amount = 1 where true; exception when others then f1 := true; end;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  select count(*) into n from public.drawer_movements;
  select count(*) into bal_rows from public.drawer_balances(); reset role;
  set local role anon;
  begin perform public.drawer_balances(); exception when others then f2 := true; end;
  begin perform public.open_shift(null, '{}'::jsonb); exception when others then f3 := true; end;
  reset role;
  perform pg_temp.rec('ledger append-only; cashier sees balances not raw rows; anon blocked',
    f1 and n = 0 and bal_rows = 6 and f2 and f3);
end $$;

select n, test, ok, detail from (
  select 0 as n, 'SUMMARY: ' || count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' as test,
         coalesce(bool_and(ok), false) as ok, '' as detail from t_results
  union all select n, test, ok, detail from t_results
) x order by n;

rollback;
