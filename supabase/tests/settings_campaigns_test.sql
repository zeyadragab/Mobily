-- Store settings, numeric limits, marketing opt-out and WhatsApp campaigns (0037).
-- Run on STAGING after 0001-0040. Everything is rolled back: the last block raises the results as an error on purpose.
-- Expected: every line "= true".

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;
create temp table t_ids(k text primary key, v text);
grant all on t_ids to public;

insert into auth.users (id, aud, role, email) values
 ('00000000-0000-0000-0000-0000000037a1','authenticated','authenticated','t-owner37@test.invalid'),
 ('00000000-0000-0000-0000-0000000037b1','authenticated','authenticated','t-manager37@test.invalid'),
 ('00000000-0000-0000-0000-0000000037c1','authenticated','authenticated','t-cashier37@test.invalid');
insert into public.user_roles(user_id, role) values
 ('00000000-0000-0000-0000-0000000037a1','owner'),
 ('00000000-0000-0000-0000-0000000037b1','manager'),
 ('00000000-0000-0000-0000-0000000037c1','cashier');

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;
create or replace function pg_temp.rec(t text, ok boolean, d text default '') returns void
language sql as $$ insert into t_results(test, ok, detail) values (t, ok, d); $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return ''; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.id(key text) returns uuid language sql as $$ select v::uuid from t_ids where k = key $$;

-- 1. store settings: owner and manager save, a cashier reads but cannot save, bad keys and values are refused
do $$ declare o jsonb; m jsonb; f_c text; f_k text; f_p text; f_t text; seen int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000037a1');
  o := public.save_store_settings(jsonb_build_object('store_name', 'محل اختبار 37', 'paper', 'A5', 'modules', jsonb_build_object('bills', false)));
  f_k := pg_temp.err('select public.save_store_settings(''{"hack":"x"}''::jsonb)');
  f_p := pg_temp.err('select public.save_store_settings(''{"paper":"A3"}''::jsonb)');
  f_t := pg_temp.err('select public.save_store_settings(jsonb_build_object(''footer_sale'', repeat(''x'', 501)))');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000037b1');
  m := public.save_store_settings('{"phone":"0100000037"}'::jsonb);
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000037c1');
  f_c := pg_temp.err('select public.save_store_settings(''{"phone":"1"}''::jsonb)');
  select count(*) into seen from public.store_settings;
  reset role;
  perform pg_temp.rec('1 owner saves name, paper and a module switch', o->>'store_name' = 'محل اختبار 37' and o->>'paper' = 'A5' and (o->'modules'->>'bills')::boolean = false
    and (o->'modules'->>'wallets')::boolean = true, -- 0040: a partial modules object keeps the other switches
    o::text);
  perform pg_temp.rec('1b settings merge and refusals', m->>'store_name' = 'محل اختبار 37' and m->>'phone' = '0100000037' and f_c like '%not allowed%'
    and f_k like '%invalid settings%' and f_p like '%invalid settings%' and f_t like '%invalid settings%' and seen = 1,
    coalesce(f_c,'') || ' | ' || f_k || ' | ' || f_p || ' | ' || f_t || ' seen=' || seen);
end $$;

-- 2. numeric limits: only the owner; unknown keys and a discount over 100 are refused
do $$ declare f_m text; f_k text; f_d text; v numeric; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000037a1');
  perform public.save_app_setting('max_discount_pct', 7);
  f_k := pg_temp.err('select public.save_app_setting(''no_such_key'', 5)');
  f_d := pg_temp.err('select public.save_app_setting(''max_discount_pct'', 101)');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000037b1');
  f_m := pg_temp.err('select public.save_app_setting(''max_discount_pct'', 9)');
  reset role;
  select value into v from public.app_settings where key = 'max_discount_pct';
  perform pg_temp.rec('2 limits: owner only, validated', v = 7 and f_m like '%not allowed%' and f_k like '%invalid settings%' and f_d like '%invalid amount%',
    'v=' || v || ' ' || f_m || ' | ' || f_k || ' | ' || f_d);
end $$;

-- 3. campaign recipients skip opted-out customers; every send is counted against the daily cap
do $$ declare c1 uuid; c2 uuid; c3 uuid; camp uuid; has1 boolean; has2 boolean; has3 boolean; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000037b1');
  c1 := public.save_customer(null, 'عميل حملة 37 أ', '01000003701', null, 'regular', 0, null);
  c2 := public.save_customer(null, 'عميل حملة 37 ب', '01000003702', null, 'regular', 0, null);
  c3 := public.save_customer(null, 'عميل حملة 37 ج', '01000003703', null, 'regular', 0, null);
  perform public.set_marketing_opt_out(c2, true);
  camp := public.create_wa_campaign('حملة اختبار 37', 'أهلا {الاسم} عرض جديد عندنا', 'regular');
  reset role;
  insert into t_ids values ('c1', c1::text), ('c2', c2::text), ('c3', c3::text), ('camp', camp::text);
  select exists(select 1 from public.wa_campaign_recipients where campaign_id = camp and customer_id = c1),
         exists(select 1 from public.wa_campaign_recipients where campaign_id = camp and customer_id = c2),
         exists(select 1 from public.wa_campaign_recipients where campaign_id = camp and customer_id = c3) into has1, has2, has3;
  perform pg_temp.rec('3 recipients: opted-out customer is left out', has1 and not has2 and has3, has1 || '/' || has2 || '/' || has3);
end $$;

do $$ declare f_out text; f_again text; f_cap text; sent boolean; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000037b1');
  perform public.mark_wa_sent(pg_temp.id('camp'), pg_temp.id('c1'));
  f_again := pg_temp.err(format('select public.mark_wa_sent(%L, %L)', pg_temp.id('camp'), pg_temp.id('c1')));
  f_out := pg_temp.err(format('select public.mark_wa_sent(%L, %L)', pg_temp.id('camp'), pg_temp.id('c2')));
  reset role;
  select sent_at is not null into sent from public.wa_campaign_recipients where campaign_id = pg_temp.id('camp') and customer_id = pg_temp.id('c1');
  perform pg_temp.rec('3b sent once; a second send and an opted-out customer are refused', sent and f_again like '%recipient not found%' and f_out like '%opted out%',
    f_again || ' | ' || f_out);
  -- the cap: the owner sets today's cap to the number already sent, the next send is refused
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000037a1');
  perform public.save_app_setting('wa_daily_cap', (select count(*) from public.wa_campaign_recipients where (sent_at at time zone 'Africa/Cairo')::date = (now() at time zone 'Africa/Cairo')::date));
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000037b1');
  f_cap := pg_temp.err(format('select public.mark_wa_sent(%L, %L)', pg_temp.id('camp'), pg_temp.id('c3')));
  reset role;
  perform pg_temp.rec('3c daily cap blocks the next send', f_cap like '%daily message cap%', f_cap);
end $$;

-- 4. a cashier cannot create or read campaigns; anon cannot execute any of the new functions; RLS on the new tables
do $$ declare f_c text; seen int; anon_any boolean; rls_all boolean; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000037c1');
  f_c := pg_temp.err('select public.create_wa_campaign(''x y'', ''رسالة اختبار'', ''all'')');
  select count(*) into seen from public.wa_campaigns;
  reset role;
  select bool_or(has_function_privilege('anon', p.oid, 'execute')) into anon_any from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('save_store_settings','save_app_setting','set_marketing_opt_out','create_wa_campaign','mark_wa_sent');
  select bool_and(relrowsecurity) into rls_all from pg_class where relnamespace = 'public'::regnamespace
    and relname in ('store_settings','wa_campaigns','wa_campaign_recipients');
  perform pg_temp.rec('4 cashier closed out; anon closed; RLS on', f_c like '%not allowed%' and seen = 0 and not anon_any and rls_all,
    f_c || ' seen=' || seen || ' anon=' || anon_any || ' rls=' || rls_all);
end $$;

do $$ declare j text; begin
  select string_agg(test || ' = ' || ok || ' [' || detail || ']', E'\n' order by n) into j from t_results;
  raise exception E'RESULTS (rolled back)\n%', j;
end $$;
