-- People: employee accounts, attendance, page permissions, tax reminders (0034).
-- Run on STAGING after 0001-0034. Everything is rolled back: the last block raises the results as an error on purpose.
-- Expected: every line "= true".

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;
create temp table t_ids(k text primary key, v text);
grant all on t_ids to public;
create temp table t_base(k text primary key, v numeric);
grant all on t_base to public;

insert into auth.users (id, aud, role, email) values
 ('00000000-0000-0000-0000-0000000034a1','authenticated','authenticated','t-owner34@test.invalid'),
 ('00000000-0000-0000-0000-0000000034b1','authenticated','authenticated','t-manager34@test.invalid'),
 ('00000000-0000-0000-0000-0000000034c1','authenticated','authenticated','t-cashier34@test.invalid'),
 ('00000000-0000-0000-0000-0000000034d1','authenticated','authenticated','t-emp34@test.invalid');
insert into public.user_roles(user_id, role) values
 ('00000000-0000-0000-0000-0000000034a1','owner'),
 ('00000000-0000-0000-0000-0000000034b1','manager'),
 ('00000000-0000-0000-0000-0000000034c1','cashier'),
 ('00000000-0000-0000-0000-0000000034d1','cashier');
insert into public.manager_pins(user_id, pin_hash) values ('00000000-0000-0000-0000-0000000034a1', extensions.crypt('1234', extensions.gen_salt('bf')));
update public.cash_sessions set status = 'closed', closed_at = now() where status = 'open';

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;
create or replace function pg_temp.rec(t text, ok boolean, d text default '') returns void
language sql as $$ insert into t_results(test, ok, detail) values (t, ok, d); $$;
create or replace function pg_temp.id(key text) returns uuid language sql as $$ select v::uuid from t_ids where k = key $$;
create or replace function pg_temp.branch() returns uuid language sql as $$ select id from public.branches where is_active order by created_at limit 1 $$;
create or replace function pg_temp.bal(c text) returns numeric language sql as $$
  select coalesce(sum(m.amount),0) from public.drawer_movements m join public.drawers d on d.id = m.drawer_id
   where d.code = c and d.branch_id = pg_temp.branch() $$;
create or replace function pg_temp.did(c text) returns uuid language sql as $$ select id from public.drawers where code = c and branch_id = pg_temp.branch() $$;
create or replace function pg_temp.ebal(e uuid) returns numeric language sql as $$ select coalesce(sum(amount),0) from public.employee_ledger where employee_id = e $$;
create or replace function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return ''; exception when others then return sqlerrm; end $$;

-- setup: shift open, products drawer funded with 20,000; employee E (3,000 a month, pay day 1, started on the 1st two months ago)
do $$ declare e uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000034a1');
  perform public.open_shift(null, '{}'::jsonb);
  perform public.move_drawer_cash(pg_temp.did('products'), 'add', 20000, 'تمويل اختبار', gen_random_uuid());
  e := public.save_employee_account(null, 'موظف تجربة 34', '01000003401', 'بائع', 3000, 1,
         (date_trunc('month', (now() at time zone 'Africa/Cairo')::date) - interval '2 months')::date,
         '00000000-0000-0000-0000-0000000034d1', true);
  reset role;
  insert into t_ids values ('e', e::text);
  insert into t_base values ('products', pg_temp.bal('products'));
  perform pg_temp.rec('0 setup: three monthly accruals on creation', pg_temp.ebal(e) = 9000
    and (select count(*) from public.employee_ledger where employee_id = e and kind = 'accrual') = 3, 'bal=' || pg_temp.ebal(e));
end $$;

-- 1. a second accrual run adds nothing; a cashier cannot create accounts
do $$ declare n int; f text; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000034a1');
  n := public.run_salary_accruals();
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000034c1');
  f := pg_temp.err('select public.save_employee_account(null, ''x y'', null, null, 100, 1, current_date, null, true)');
  reset role;
  perform pg_temp.rec('1 accruals are idempotent; cashier refused', n = 0 and pg_temp.ebal(pg_temp.id('e')) = 9000 and f like '%not allowed%', 'n=' || n || ' f=' || f);
end $$;

-- 2. pay 1,000 from the products drawer; the same key twice moves money once
do $$ declare idem_key uuid := gen_random_uuid(); r1 public.employee_ledger; r2 public.employee_ledger; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000034a1');
  r1 := public.employee_operation(pg_temp.id('e'), 'pay', 1000, 'products', null, 'راتب', idem_key);
  r2 := public.employee_operation(pg_temp.id('e'), 'pay', 1000, 'products', null, 'راتب', idem_key);
  reset role;
  insert into t_ids values ('pay1', r1.id::text);
  perform pg_temp.rec('2 pay: balance and drawer move once', r1.id = r2.id and pg_temp.ebal(pg_temp.id('e')) = 8000
    and pg_temp.bal('products') - (select v from t_base where k = 'products') = -1000, 'bal=' || pg_temp.ebal(pg_temp.id('e')));
end $$;

-- 3. limits: pay above the balance, advance above one salary below zero, correction without a reason, no source
do $$ declare f1 text; f2 text; f3 text; f4 text; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000034a1');
  f1 := pg_temp.err(format('select public.employee_operation(%L, ''pay'', 8000.01, ''products'', null, null, %L)', pg_temp.id('e'), gen_random_uuid()));
  f2 := pg_temp.err(format('select public.employee_operation(%L, ''advance'', 11000.01, ''products'', null, null, %L)', pg_temp.id('e'), gen_random_uuid()));
  f3 := pg_temp.err(format('select public.employee_operation(%L, ''correction'', 50, null, null, null, %L)', pg_temp.id('e'), gen_random_uuid()));
  f4 := pg_temp.err(format('select public.employee_operation(%L, ''pay'', 10, null, null, null, %L)', pg_temp.id('e'), gen_random_uuid()));
  reset role;
  perform pg_temp.rec('3 limits and validation', f1 like '%exceeds%' and f2 like '%advance exceeds%' and f3 like '%reason%' and f4 like '%source%',
    f1 || ' | ' || f2 || ' | ' || f3 || ' | ' || f4);
end $$;

-- 4. manager: a pay at or above the PIN threshold needs a token; bonus and deduction move no cash
do $$ declare f text; b numeric; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000034b1');
  f := pg_temp.err(format('select public.employee_operation(%L, ''pay'', 6000, ''products'', null, null, %L)', pg_temp.id('e'), gen_random_uuid()));
  perform public.employee_operation(pg_temp.id('e'), 'bonus', 500, null, null, 'مكافأة', gen_random_uuid());
  perform public.employee_operation(pg_temp.id('e'), 'deduction', 200, null, null, 'خصم', gen_random_uuid());
  reset role;
  b := pg_temp.ebal(pg_temp.id('e'));
  perform pg_temp.rec('4 manager PIN rule; bonus and deduction', f like '%override required%' and b = 8300
    and pg_temp.bal('products') - (select v from t_base where k = 'products') = -1000, f || ' bal=' || b);
end $$;

-- 5. reverse: only the owner, needs a reason, puts the drawer money back, cannot be done twice
do $$ declare f1 text; f2 text; f3 text; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000034b1');
  f1 := pg_temp.err(format('select public.reverse_employee_entry(%s, ''x'')', (select v from t_ids where k = 'pay1')));
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000034a1');
  f2 := pg_temp.err(format('select public.reverse_employee_entry(%s, '''')', (select v from t_ids where k = 'pay1')));
  perform public.reverse_employee_entry((select v from t_ids where k = 'pay1')::bigint, 'خطأ في الإدخال');
  f3 := pg_temp.err(format('select public.reverse_employee_entry(%s, ''again'')', (select v from t_ids where k = 'pay1')));
  reset role;
  perform pg_temp.rec('5 reverse restores balance and drawer', f1 like '%not allowed%' and f2 like '%reason%' and f3 like '%already reversed%'
    and pg_temp.ebal(pg_temp.id('e')) = 9300 and pg_temp.bal('products') = (select v from t_base where k = 'products'), f1 || ' | ' || f2 || ' | ' || f3);
end $$;

-- 6. the ledger is append only
do $$ declare f text; begin
  f := pg_temp.err('update public.employee_ledger set note = ''x''');
  perform pg_temp.rec('6 ledger append only', f <> '', f);
end $$;

-- 7. attendance in Cairo time: in 10:30 (30 late), out 22:15 (15 overtime) on a 10:00-22:00 shift
do $$ declare d date := (now() at time zone 'Africa/Cairo')::date - 1; r public.attendance_records; f text; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000034b1');
  perform public.attendance_check(pg_temp.id('e'), 'in', ((d + time '10:30') at time zone 'Africa/Cairo'));
  f := pg_temp.err(format('select public.attendance_check(%L, ''in'', %L)', pg_temp.id('e'), ((d + time '11:00') at time zone 'Africa/Cairo')));
  r := public.attendance_check(pg_temp.id('e'), 'out', ((d + time '22:15') at time zone 'Africa/Cairo'));
  reset role;
  perform pg_temp.rec('7 attendance minutes', r.late_minutes = 30 and r.overtime_minutes = 15 and r.early_leave_minutes = 0 and f like '%already checked in%',
    'late=' || r.late_minutes || ' ot=' || r.overtime_minutes || ' f=' || f);
end $$;

-- 8. an employee checks in for himself only; another cashier cannot; the employee sees only his own rows
do $$ declare r public.attendance_records; f text; own int; others int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000034c1');
  f := pg_temp.err(format('select public.attendance_check(%L, ''in'')', pg_temp.id('e')));
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000034d1');
  r := public.attendance_check(pg_temp.id('e'), 'in');
  select count(*) into own from public.employee_ledger;
  select count(*) into others from public.employee_accounts where id <> pg_temp.id('e');
  reset role;
  perform pg_temp.rec('8 self check-in only; own rows only', f like '%not allowed%' and r.check_in is not null and own > 0 and others = 0,
    'f=' || f || ' own=' || own || ' others=' || others);
end $$;

-- 9. page permissions: the owner restricts a manager from one page; the owner cannot be restricted; a cashier cannot set them
do $$ declare f1 text; f2 text; f3 text; ok_before boolean; ok_after boolean; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000034b1');
  ok_before := public.has_page('/employee-accounts');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000034a1');
  perform public.set_page_permission('00000000-0000-0000-0000-0000000034b1', '/employee-accounts', false);
  f1 := pg_temp.err('select public.set_page_permission(''00000000-0000-0000-0000-0000000034a1'', ''/team'', false)');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000034b1');
  ok_after := public.has_page('/employee-accounts');
  f2 := pg_temp.err(format('select public.save_employee_account(null, ''xx yy'', null, null, 100, 1, current_date, null, true)'));
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000034c1');
  f3 := pg_temp.err('select public.set_page_permission(''00000000-0000-0000-0000-0000000034b1'', ''/team'', true)');
  reset role;
  perform pg_temp.rec('9 page permissions', ok_before and not ok_after and f1 like '%cannot restrict owner%' and f2 like '%not allowed%' and f3 like '%not allowed%',
    f1 || ' | ' || f2 || ' | ' || f3);
end $$;

-- 10. tax reminders: bad IMEI refused, valid one saved, paid, reopened; anon cannot reach anything
do $$ declare id1 uuid; f text; t public.tax_reminders; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000034c1');
  f := pg_temp.err('select public.save_tax_reminder(null, ''عميل ضريبة'', ''01000003499'', ''هاتف'', ''490154203237519'', 1500, current_date + 3, null)');
  id1 := public.save_tax_reminder(null, 'عميل ضريبة', '01000003499', 'هاتف', '490154203237518', 1500, current_date + 3, 'ملاحظة');
  t := public.set_tax_reminder_status(id1, 'paid');
  reset role;
  perform pg_temp.rec('10 tax reminders', f like '%imei%' and t.status = 'paid', f || ' status=' || t.status);
end $$;

-- 11. anon cannot execute the new functions; RLS on every new table
do $$ declare anon_any boolean; rls_all boolean; begin
  select bool_or(has_function_privilege('anon', p.oid, 'execute')) into anon_any from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('has_page','my_page_permissions','set_page_permission','list_team','run_salary_accruals',
     'save_employee_account','employee_operation','reverse_employee_entry','attendance_employees','attendance_check','save_attendance',
     'save_tax_reminder','set_tax_reminder_status','m_employee_accrue');
  select bool_and(relrowsecurity) into rls_all from pg_class where relnamespace = 'public'::regnamespace
    and relname in ('user_page_permissions','employee_accounts','employee_ledger','attendance_records','tax_reminders');
  perform pg_temp.rec('11 anon cannot execute; RLS on', not anon_any and rls_all
    and not has_table_privilege('anon', 'public.employee_balances', 'select') and not has_table_privilege('anon', 'public.attendance_monthly', 'select'),
    'anon=' || anon_any || ' rls=' || rls_all);
end $$;

do $$ declare j text; begin
  select string_agg(test || ' = ' || ok || ' [' || detail || ']', E'\n' order by n) into j from t_results;
  raise exception E'RESULTS (rolled back)\n%', j;
end $$;
