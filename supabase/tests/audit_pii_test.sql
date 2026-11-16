-- Identity data stays out of audit_log (0038).
-- Run on STAGING after 0001-0038. Everything is rolled back: the last block raises the results as an error on purpose.
-- Expected: every line "= true".

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;

insert into auth.users (id, aud, role, email) values ('00000000-0000-0000-0000-0000000038a1','authenticated','authenticated','t-owner38@test.invalid');
insert into public.user_roles(user_id, role) values ('00000000-0000-0000-0000-0000000038a1','owner');
update public.cash_sessions set status = 'closed', closed_at = now() where status = 'open';
insert into public.products(id, name, track_serial) values ('00000000-0000-0000-0000-00000000a038', 'هاتف اختبار تدقيق 38', true);
insert into public.variants(id, product_id, sku, price) values ('00000000-0000-0000-0000-00000000b038', '00000000-0000-0000-0000-00000000a038', 'T38-SER', 1000);

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;
create or replace function pg_temp.rec(t text, ok boolean, d text default '') returns void
language sql as $$ insert into t_results(test, ok, detail) values (t, ok, d); $$;

-- distinctive values: if any of them shows up in audit_log, the check fails
do $$ declare c uuid; k1 int; k2 int; leak boolean; has_who boolean; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000038a1');
  c := public.save_customer(null, 'تجربة تدقيق 38', '01000003801', null, 'regular', 1000, null);
  perform public.save_customer_kyc(c, '29901011234561', 'شارع الاختبار 38', 'ضامن اختبار 38', '01022223838', '28801011234562');
  perform public.save_customer_kyc(c, '29901011234563', 'شارع الاختبار 38 ب', 'ضامن اختبار 38', '01022223838', '28801011234562');
  reset role;
  select count(*) into k1 from public.audit_log where entity = 'customer_kyc'
    and (after->>'customer_id' = c::text or before->>'customer_id' = c::text);
  select exists (select 1 from public.audit_log a where a.entity = 'customer_kyc' and a::text ~ '(2990101123456|2880101123456|شارع الاختبار 38|ضامن اختبار 38|01022223838)') into leak;
  select bool_and(after ? 'customer_id' and after ? 'updated_at') into has_who from public.audit_log where entity = 'customer_kyc' and after->>'customer_id' = c::text;
  perform pg_temp.rec('1 customer_kyc is audited without identity columns', k1 >= 1 and not leak and has_who,
    'rows=' || k1 || ' leak=' || leak || ' keeps_customer_and_time=' || coalesce(has_who::text, 'null'));
end $$;

do $$ declare t public.trade_ins; n int; leak boolean; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000038a1');
  perform public.open_shift(null, '{}'::jsonb);
  perform public.move_drawer_cash((select id from public.drawers where code = 'products' and branch_id = (select id from public.branches where is_active order by created_at limit 1)),
                                  'add', 1000, 'تمويل اختبار', gen_random_uuid());
  t := public.create_trade_in('00000000-0000-0000-0000-00000000b038', 'T38-SER-0001', 100, 'cash', null, null, null, 'بائع اختبار 38', '01033334444',
                              '29701011234569', 'عنوان البائع 38', 'سليم', null, gen_random_uuid());
  reset role;
  select count(*) into n from public.audit_log where entity = 'trade_in_sellers' and after->>'trade_in_id' = t.id::text;
  select exists (select 1 from public.audit_log a where a.entity in ('trade_in_sellers', 'trade_ins') and a::text ~ '(2970101123456|عنوان البائع 38)') into leak;
  perform pg_temp.rec('2 trade_in_sellers is audited without national id and address', n >= 1 and not leak, 'rows=' || n || ' leak=' || leak);
end $$;

do $$ declare j text; begin
  select string_agg(test || ' = ' || ok || ' [' || detail || ']', E'\n' order by n) into j from t_results;
  raise exception E'RESULTS (rolled back)\n%', j;
end $$;
