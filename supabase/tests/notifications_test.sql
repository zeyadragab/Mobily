-- Notifications, tasks and alerts (0041).
-- Run on STAGING after 0001-0041. Everything is rolled back: the last block raises the results as an error on purpose.
-- Expected: every line "= true".

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;
create temp table t_ids(k text primary key, v text);
grant all on t_ids to public;

insert into auth.users (id, aud, role, email) values
 ('00000000-0000-0000-0000-0000000041a1','authenticated','authenticated','t-owner41@test.invalid'),
 ('00000000-0000-0000-0000-0000000041c1','authenticated','authenticated','t-cashier41@test.invalid'),
 ('00000000-0000-0000-0000-0000000041d1','authenticated','authenticated','t-warehouse41@test.invalid');
insert into public.user_roles(user_id, role) values
 ('00000000-0000-0000-0000-0000000041a1','owner'),
 ('00000000-0000-0000-0000-0000000041c1','cashier'),
 ('00000000-0000-0000-0000-0000000041d1','warehouse');

insert into public.products(id, name) values ('00000000-0000-0000-0000-00000000a041', 'منتج إشعارات 41');
insert into public.variants(id, product_id, sku, price, reorder_level)
values ('00000000-0000-0000-0000-00000000b041', '00000000-0000-0000-0000-00000000a041', 'NT41-1', 100, 10);
insert into public.stock_movements(variant_id, branch_id, movement_type, qty, unit_cost)
values ('00000000-0000-0000-0000-00000000b041', (select id from public.branches where is_active order by created_at limit 1), 'adjustment', 3, 0);

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

-- 1. low stock: one open alert however often the rules run; closes by itself when stock comes back
do $$ declare n1 int; n2 int; w_sees int; c_sees int; closed int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000041a1');
  perform public.refresh_notifications();
  perform public.refresh_notifications();
  reset role;
  select count(*) into n1 from public.notifications where dedupe_key = 'low_stock:00000000-0000-0000-0000-00000000b041' and resolved_at is null;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000041d1');
  select count(*) into w_sees from public.notifications where dedupe_key = 'low_stock:00000000-0000-0000-0000-00000000b041';
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000041c1');
  select count(*) into c_sees from public.notifications where dedupe_key = 'low_stock:00000000-0000-0000-0000-00000000b041';
  reset role;
  perform pg_temp.rec('1a low stock: one open alert after two runs; warehouse sees it, cashier does not', n1 = 1 and w_sees = 1 and c_sees = 0,
    n1 || '/' || w_sees || '/' || c_sees);
  insert into public.stock_movements(variant_id, branch_id, movement_type, qty, unit_cost)
  values ('00000000-0000-0000-0000-00000000b041', (select id from public.branches where is_active order by created_at limit 1), 'adjustment', 20, 0);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000041a1');
  perform public.refresh_notifications();
  reset role;
  select count(*) into closed from public.notifications where dedupe_key = 'low_stock:00000000-0000-0000-0000-00000000b041' and resolved_at is not null;
  select count(*) into n2 from public.notifications where dedupe_key = 'low_stock:00000000-0000-0000-0000-00000000b041' and resolved_at is null;
  perform pg_temp.rec('1b stock back above the level closes the alert', closed = 1 and n2 = 0, closed || '/' || n2);
end $$;

-- 2. shift difference: owner sees it, cashier does not; it stays after a second run
do $$ declare o_sees int; c_sees int; v_sess uuid; begin
  insert into public.cash_sessions(branch_id, opening_balance, status, closed_at, expected_cash, counted_cash, difference, opened_by)
  values ((select id from public.branches where is_active order by created_at limit 1), 0, 'closed', now(), 100, 50, -50,
          '00000000-0000-0000-0000-0000000041a1')
  returning id into v_sess;
  insert into t_ids values ('sess', v_sess::text);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000041a1');
  perform public.refresh_notifications();
  perform public.refresh_notifications();
  select count(*) into o_sees from public.notifications where dedupe_key = 'shift:' || v_sess::text;
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000041c1');
  select count(*) into c_sees from public.notifications where dedupe_key = 'shift:' || v_sess::text;
  reset role;
  perform pg_temp.rec('2 shift difference: owner sees one alert, cashier none', o_sees = 1 and c_sees = 0, o_sees || '/' || c_sees);
end $$;

-- 3. tax reminder due today: cashier sees it until the owner locks /mobile-tax for them; paid closes it
do $$ declare t_id uuid; before_n int; locked_n int; after_n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000041a1');
  t_id := public.save_tax_reminder(null, 'عميل ضريبة 41', '01000004101', 'هاتف', null, 500, (now() at time zone 'Africa/Cairo')::date, null);
  perform public.refresh_notifications();
  reset role;
  insert into t_ids values ('tax', t_id::text);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000041c1');
  select count(*) into before_n from public.notifications where dedupe_key = 'tax:' || t_id::text;
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000041a1');
  perform public.set_page_permission('00000000-0000-0000-0000-0000000041c1', '/mobile-tax', false);
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000041c1');
  select count(*) into locked_n from public.notifications where dedupe_key = 'tax:' || t_id::text;
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000041a1');
  perform public.set_tax_reminder_status(t_id, 'paid');
  perform public.refresh_notifications();
  select count(*) into after_n from public.notifications where dedupe_key = 'tax:' || t_id::text and resolved_at is null;
  reset role;
  perform pg_temp.rec('3 tax alert: seen, hidden by the page lock, closed when paid', before_n = 1 and locked_n = 0 and after_n = 0,
    before_n || '/' || locked_n || '/' || after_n);
end $$;

-- 4. tasks: a reminder that has come becomes an alert for the assignee only; closing the task closes the alert
do $$ declare t_id uuid; c_sees int; o_sees int; f_other text; f_close text; closed int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000041a1');
  t_id := public.create_task('اتصل بالمورد 41', 'تأكيد ميعاد التسليم', 'high', now() - interval '1 minute', '00000000-0000-0000-0000-0000000041c1');
  perform public.refresh_notifications();
  select count(*) into o_sees from public.notifications where dedupe_key = 'task:' || t_id::text;
  reset role;
  insert into t_ids values ('task', t_id::text);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000041c1');
  select count(*) into c_sees from public.notifications where dedupe_key = 'task:' || t_id::text and severity = 'critical';
  -- a cashier may not give work to someone else, nor see a task of others
  f_other := pg_temp.err('select public.create_task(''مهمة'', null, ''normal'', null, ''00000000-0000-0000-0000-0000000041a1'')');
  perform public.close_task(t_id, 'done');
  reset role;
  select count(*) into closed from public.notifications where dedupe_key = 'task:' || t_id::text and resolved_at is not null;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000041d1');
  f_close := pg_temp.err(format('select public.close_task(%L, %L)', t_id, 'cancelled'));
  reset role;
  perform pg_temp.rec('4 task reminder: assignee only, critical for high priority, closed with the task; cashier cannot assign to others',
    c_sees = 1 and o_sees = 0 and closed = 1 and f_other like '%not allowed%' and f_close like '%not allowed%',
    c_sees || '/' || o_sees || '/' || closed || ' | ' || f_other || ' | ' || f_close);
end $$;

-- 5. read state is per user: reading as the owner does not read it for anyone else
do $$ declare u0 int; u1 int; u_c int; marked int; u2 int; f text; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000041a1');
  u0 := public.my_unread_notifications();
  perform public.mark_notification_read((select id from public.notifications where dedupe_key = 'shift:' || pg_temp.id('sess')::text));
  u1 := public.my_unread_notifications();
  marked := public.mark_all_notifications_read();
  u2 := public.my_unread_notifications();
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000041d1');
  f := pg_temp.err(format('select public.mark_notification_read(%L)',
         (select id from public.notifications where dedupe_key = 'shift:' || pg_temp.id('sess')::text)));
  reset role;
  perform pg_temp.rec('5 read state: one read lowers the count by one; read all brings it to 0; a user cannot read what they cannot see',
    u1 = u0 - 1 and u2 = 0 and f like '%notification not found%', u0 || '/' || u1 || '/' || u2 || ' | ' || f);
end $$;

-- 6. anon closed, RLS on, a notification cannot be written directly
do $$ declare anon_any boolean; rls_all boolean; f_ins text; f_upd text; begin
  select bool_or(has_function_privilege('anon', p.oid, 'execute')) into anon_any from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('refresh_notifications','create_task','close_task',
     'my_unread_notifications','mark_notification_read','mark_all_notifications_read','can_see_notification');
  select bool_and(relrowsecurity) into rls_all from pg_class where relnamespace = 'public'::regnamespace
    and relname in ('notifications','notification_reads','tasks');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000041a1');
  f_ins := pg_temp.err('insert into public.notifications(kind, title, audience, dedupe_key) values (''low_stock'', ''x'', ''{owner}'', ''hack:1'')');
  f_upd := pg_temp.err('update public.notifications set resolved_at = now()');
  reset role;
  perform pg_temp.rec('6 anon closed, RLS on, no direct writes', not anon_any and rls_all and f_ins <> '' and f_upd = '',
    'anon=' || anon_any || ' rls=' || rls_all || ' ins=' || f_ins || ' upd=[' || f_upd || ']');
end $$;

do $$ declare j text; begin
  select string_agg(test || ' = ' || ok || ' [' || detail || ']', E'\n' order by n) into j from t_results;
  raise exception E'RESULTS (rolled back)\n%', j;
end $$;
