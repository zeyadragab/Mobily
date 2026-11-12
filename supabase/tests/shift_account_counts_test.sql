-- Accounts counted at shift close, stock value in the snapshot (0026).
-- Run on STAGING after 0001-0026. Everything is rolled back: the last block raises the results as an error on purpose.
-- Expected: every line "= true".

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;
create temp table t_ids(k text primary key, v text);
grant all on t_ids to public;

insert into auth.users (id, aud, role, email) values
 ('00000000-0000-0000-0000-0000000000a7','authenticated','authenticated','t-owner7@test.invalid'),
 ('00000000-0000-0000-0000-0000000000c7','authenticated','authenticated','t-cashier7@test.invalid');
insert into public.user_roles(user_id, role) values
 ('00000000-0000-0000-0000-0000000000a7','owner'),
 ('00000000-0000-0000-0000-0000000000c7','cashier');
update public.cash_sessions set status = 'closed', closed_at = now() where status = 'open';

insert into public.products(id, name) values ('00000000-0000-0000-0000-00000000a007','هاتف اختبار إغلاق');
insert into public.variants(id, product_id, sku, price) values
 ('00000000-0000-0000-0000-00000000a107','00000000-0000-0000-0000-00000000a007','SC-SKU-1', 1000);
insert into public.variant_costs(variant_id, cost) values ('00000000-0000-0000-0000-00000000a107', 600);
insert into public.stock_movements(variant_id, branch_id, movement_type, qty)
values ('00000000-0000-0000-0000-00000000a107',
        (select id from public.branches where is_active order by created_at limit 1), 'adjustment', 5);

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

-- setup: two accounts, wallet = 500, machine = 800; shift open
do $$ declare w uuid; m uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
  w := public.save_money_account(null, 'wallet', 'محفظة إغلاق', null, null, null, 0);
  m := public.save_money_account(null, 'machine', 'ماكينة إغلاق', null, null, null, 0);
  perform public.adjust_account(w, 500, 'افتتاحي', gen_random_uuid());
  perform public.adjust_account(m, 800, 'افتتاحي', gen_random_uuid()); reset role;
  insert into t_ids values ('w', w::text), ('m', m::text);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
  perform public.open_cash_session(100); reset role;
  perform pg_temp.rec('setup: accounts and an open shift', pg_temp.abal(w) = 500 and pg_temp.abal(m) = 800);
end $$;

-- 1. a difference with no note is refused and nothing changes
do $$ declare f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
  begin perform public.close_shift('{}'::jsonb, null, jsonb_build_object(pg_temp.id('w')::text, 450)); exception when others then f := true; end; reset role;
  perform pg_temp.rec('1 difference needs a note', f and pg_temp.abal(pg_temp.id('w')) = 500
    and exists (select 1 from public.cash_sessions where status = 'open'));
end $$;

-- 2. an unknown account in the counts is refused
do $$ declare f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
  begin perform public.close_shift('{}'::jsonb, 'x', jsonb_build_object(gen_random_uuid()::text, 10)); exception when others then f := true; end; reset role;
  perform pg_temp.rec('2 unknown account refused', f and exists (select 1 from public.cash_sessions where status = 'open'));
end $$;

-- 3. close: wallet counted 450 (-50) with a note; machine skipped (stays 800)
do $$ declare s public.cash_sessions; n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
  s := public.close_shift('{}'::jsonb, 'نقص في المحفظة', jsonb_build_object(pg_temp.id('w')::text, 450)); reset role;
  insert into t_ids values ('s', s.id::text);
  select count(*) into n from public.account_movements where account_id = pg_temp.id('w') and kind = 'adjustment' and amount = -50 and ref_type = 'cash_session';
  perform pg_temp.rec('3 wallet corrected to 450, machine untouched', s.status = 'closed' and n = 1
    and pg_temp.abal(pg_temp.id('w')) = 450 and pg_temp.abal(pg_temp.id('m')) = 800, 'w=' || pg_temp.abal(pg_temp.id('w')));
end $$;

-- 4. the shift record keeps the counts, a numeric stock value, and the alert is raised for review
do $$ declare s public.cash_sessions; begin
  select * into s from public.cash_sessions where id = pg_temp.id('s');
  perform pg_temp.rec('4 counts, stock value and alert saved',
    (s.closing_account_counts -> pg_temp.id('w')::text ->> 'difference')::numeric = -50
    and (s.closing_account_counts -> pg_temp.id('m')::text ->> 'counted') is null
    and (s.closing_snapshot ->> 'stock_value')::numeric >= 3000
    and (s.closing_snapshot -> 'accounts' ->> pg_temp.id('w')::text)::numeric = 450
    and exists (select 1 from public.shift_alerts where session_id = s.id and drawer_code = 'acct:' || pg_temp.id('w')::text and difference = -50 and reviewed_at is null)
    and s.shift_no > 0, 'stock=' || (s.closing_snapshot ->> 'stock_value'));
end $$;

do $$ declare j text; begin
  select string_agg(test || ' = ' || ok || ' [' || detail || ']', E'\n' order by n) into j from t_results;
  raise exception E'RESULTS (rolled back)\n%', j;
end $$;
