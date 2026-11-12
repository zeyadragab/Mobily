-- Security hardening test for 0015. Run in the Supabase SQL Editor AFTER 0001-0015, on STAGING.
-- Fake data in ONE transaction that is ROLLED BACK. Expected: every row ok = true.

begin;

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;

insert into auth.users (id, aud, role, email) values
 ('00000000-0000-0000-0000-0000000000a1','authenticated','authenticated','t-owner3@test.invalid'),
 ('00000000-0000-0000-0000-0000000000b1','authenticated','authenticated','t-manager3@test.invalid'),
 ('00000000-0000-0000-0000-0000000000c1','authenticated','authenticated','t-cashier3@test.invalid');
insert into public.user_roles(user_id, role) values
 ('00000000-0000-0000-0000-0000000000a1','owner'),
 ('00000000-0000-0000-0000-0000000000b1','manager'),
 ('00000000-0000-0000-0000-0000000000c1','cashier');

update public.cash_sessions set status = 'closed', closed_at = now() where status = 'open';
insert into public.products(id, name) values ('00000000-0000-0000-0000-00000000a002','هاتف اختبار أمان');
insert into public.variants(id, product_id, sku, price) values
 ('00000000-0000-0000-0000-00000000a102','00000000-0000-0000-0000-00000000a002','SEC-SKU-1', 1000);
insert into public.variant_costs(variant_id, cost) values ('00000000-0000-0000-0000-00000000a102', 600);
insert into public.stock_movements(variant_id, branch_id, movement_type, qty)
values ('00000000-0000-0000-0000-00000000a102',
        (select id from public.branches where is_active order by created_at limit 1), 'adjustment', 200);

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;
create or replace function pg_temp.rec(t text, ok boolean, d text default '') returns void
language sql as $$ insert into t_results(test, ok, detail) values (t, ok, d); $$;
create or replace function pg_temp.items(q int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('variant_id','00000000-0000-0000-0000-00000000a102','qty',q)) $$;
create or replace function pg_temp.pay(m text, a numeric) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('method', m, 'amount', a)) $$;

-- 1. shift gate: a card sale with no open drawer is refused
do $$ declare f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin perform public.create_sale(null,null,0,null, pg_temp.items(1), pg_temp.pay('card',1000));
  exception when others then f := sqlerrm like '%no open shift%'; end; reset role;
  perform pg_temp.rec('sale refused when no shift is open', f);
end $$;

-- 2. after the cashier opens the drawer the same sale works
do $$ declare ok boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform public.open_cash_session(100);
  perform public.create_sale(null,null,0,null, pg_temp.items(1), pg_temp.pay('card',1000));
  ok := true; reset role;
  perform pg_temp.rec('sale works once a shift is open', ok);
end $$;

-- 3. rate limit: 60 sales per minute per user, the 61st is refused
do $$ declare n int := 1; f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin
    loop
      exit when n >= 70;
      perform public.create_sale(null,null,0,null, pg_temp.items(1), pg_temp.pay('card',1000));
      n := n + 1;
    end loop;
  exception when others then f := sqlerrm like '%rate limit exceeded%'; end; reset role;
  perform pg_temp.rec('61st sale in a minute is refused', f and n between 55 and 61, 'sales before block: ' || n);
end $$;

-- 4. PIN: cashier cannot set one; manager can; weak PINs are refused
do $$ declare a boolean := false; w boolean := false; s boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin perform public.set_my_pin('482913'); exception when others then a := true; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin perform public.set_my_pin('111111'); exception when others then w := true; end;
  begin perform public.set_my_pin('12ab56'); exception when others then s := true; end;
  perform public.set_my_pin('482913'); reset role;
  perform pg_temp.rec('cashier cannot set a PIN; weak/non-numeric PINs refused; manager can', a and w and s);
end $$;

-- 5. PIN hash is never readable through the API
do $$ declare n int := 0; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  begin select count(*) into n from public.manager_pins; exception when others then n := 0; end; reset role;
  perform pg_temp.rec('manager_pins unreadable by any API role', n = 0);
end $$;

-- 6. override: right PIN gives a token; token works once; cashier cannot reuse it twice
do $$ declare r jsonb; tok uuid; a uuid; f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  r := public.request_override('00000000-0000-0000-0000-0000000000b1', '482913', 'خصم كبير لعميل دائم');
  tok := (r->>'token')::uuid;
  a := public.consume_override(tok);
  begin perform public.consume_override(tok); exception when others then f := true; end; reset role;
  perform pg_temp.rec('override token is issued and spent exactly once',
    (r->>'ok')::boolean and a = '00000000-0000-0000-0000-0000000000b1' and f);
end $$;

-- 7. a manager cannot approve their own request
do $$ declare r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r := public.request_override('00000000-0000-0000-0000-0000000000b1', '482913', 'اختبار'); reset role;
  perform pg_temp.rec('self-approval refused', not (r->>'ok')::boolean and r->>'reason' = 'invalid');
end $$;

-- 8. five wrong PINs lock the approver; even the right PIN is refused while locked
do $$ declare r jsonb; i int; last jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  for i in 1..5 loop
    last := public.request_override('00000000-0000-0000-0000-0000000000b1', '000999', 'اختبار');
  end loop;
  r := public.request_override('00000000-0000-0000-0000-0000000000b1', '482913', 'اختبار'); reset role;
  perform pg_temp.rec('5 wrong PINs lock the approver for 15 minutes',
    last->>'reason' = 'locked' and r->>'reason' = 'locked' and not (r->>'ok')::boolean, last::text);
end $$;

-- 9. events were recorded and only owner/accountant can read them
do $$ declare own int := 0; cash int := 0; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  select count(*) into own from public.security_events where kind in ('pin_failed','pin_locked','override_issued','pin_set'); reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  select count(*) into cash from public.security_events; reset role;
  perform pg_temp.rec('security events logged; cashier cannot read them', own >= 6 and cash = 0, 'owner sees ' || own);
end $$;

-- 10. owner unlocks the PIN; the right PIN works again
do $$ declare r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  perform public.unlock_pin('00000000-0000-0000-0000-0000000000b1'); reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  r := public.request_override('00000000-0000-0000-0000-0000000000b1', '482913', 'بعد فك القفل'); reset role;
  perform pg_temp.rec('owner unlock restores approval', (r->>'ok')::boolean);
end $$;

-- 11. force logout: only the owner; the old token stops being valid
do $$ declare c boolean := false; before_ok boolean; after_ok boolean; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin perform public.force_logout_user('00000000-0000-0000-0000-0000000000b1'); exception when others then c := true; end;
  before_ok := public.is_current_session_valid(); reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  perform public.force_logout_user('00000000-0000-0000-0000-0000000000c1'); reset role;
  -- the cashier's token was issued BEFORE force_logout_at (iat is a few ms earlier), so it is now invalid
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000c1','role','authenticated','iat', extract(epoch from now())::bigint - 60)::text, true);
  set local role authenticated; after_ok := public.is_current_session_valid(); reset role;
  perform pg_temp.rec('only owner can force logout; older tokens become invalid', c and before_ok and not after_ok);
end $$;

-- 12. anon blocked from every new function and table
do $$ declare f1 boolean := false; f2 boolean := false; f3 boolean := false; n int := 0; begin
  set local role anon;
  begin perform public.request_override('00000000-0000-0000-0000-0000000000b1','482913','x'); exception when others then f1 := true; end;
  begin perform public.list_staff_security(); exception when others then f2 := true; end;
  begin perform public.set_my_pin('482913'); exception when others then f3 := true; end;
  begin select count(*) into n from public.security_events; exception when others then n := 0; end;
  reset role;
  perform pg_temp.rec('anon blocked from PIN, staff and event data', f1 and f2 and f3 and n = 0);
end $$;

select n, test, ok, detail from (
  select 0 as n, 'SUMMARY: ' || count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' as test,
         coalesce(bool_and(ok), false) as ok, '' as detail from t_results
  union all select n, test, ok, detail from t_results
) x order by n;

rollback;
