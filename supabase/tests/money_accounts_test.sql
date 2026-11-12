-- Accounts, payment source, drawer cash moves, shift alerts, control log (0024).
-- Run on STAGING after 0001-0024. Everything is rolled back: the last block raises the results as an error on purpose.
-- Expected: every line "= true".

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;
create temp table t_ids(k text primary key, v text);
grant all on t_ids to public;

insert into auth.users (id, aud, role, email) values
 ('00000000-0000-0000-0000-0000000000a8','authenticated','authenticated','t-owner8@test.invalid'),
 ('00000000-0000-0000-0000-0000000000b8','authenticated','authenticated','t-manager8@test.invalid'),
 ('00000000-0000-0000-0000-0000000000c8','authenticated','authenticated','t-cashier8@test.invalid');
insert into public.user_roles(user_id, role) values
 ('00000000-0000-0000-0000-0000000000a8','owner'),
 ('00000000-0000-0000-0000-0000000000b8','manager'),
 ('00000000-0000-0000-0000-0000000000c8','cashier');
update public.cash_sessions set status = 'closed', closed_at = now() where status = 'open';

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
create or replace function pg_temp.abal(a uuid) returns numeric language sql as $$
  select coalesce(sum(amount),0) from public.account_movements where account_id = a $$;
create or replace function pg_temp.id(key text) returns uuid language sql as $$ select v::uuid from t_ids where k = key $$;

-- 1. accounts: cashier refused, manager creates a wallet (daily limit 1,000) and a machine
do $$ declare f boolean := false; w uuid; m uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c8');
  begin perform public.save_money_account(null, 'wallet', 'تجربة محفظة', null, null, null, 0); exception when others then f := true; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b8');
  w := public.save_money_account(null, 'wallet', 'تجربة محفظة', '01000000081', 1000, null, 0);
  m := public.save_money_account(null, 'machine', 'تجربة ماكينة', null, null, null, 0); reset role;
  insert into t_ids values ('w', w::text), ('m', m::text);
  perform pg_temp.rec('1 accounts: manager only', f and w is not null and m is not null);
end $$;

-- 2. opening balance 3,000 (owner: no PIN), repeat click changes nothing, later change is an "adjustment"
do $$ declare k1 text; k2 text; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a8');
  perform public.adjust_account(pg_temp.id('w'), 3000, 'رصيد افتتاحي', '00000000-0000-0000-0000-00000000f001');
  perform public.adjust_account(pg_temp.id('w'), 3000, 'رصيد افتتاحي', '00000000-0000-0000-0000-00000000f001');
  perform public.adjust_account(pg_temp.id('w'), 3100, 'تصحيح', gen_random_uuid());
  perform public.adjust_account(pg_temp.id('w'), 3000, 'تصحيح', gen_random_uuid()); reset role;
  select kind into k1 from public.account_movements where account_id = pg_temp.id('w') order by id limit 1;
  select kind into k2 from public.account_movements where account_id = pg_temp.id('w') order by id desc limit 1;
  perform pg_temp.rec('2 opening then adjustment, idempotent', pg_temp.abal(pg_temp.id('w')) = 3000 and k1 = 'opening' and k2 = 'adjustment', k1 || '/' || k2);
end $$;

-- 3. transfer 600 ok; 500 more passes the daily limit (600 + 500 > 1,000); taking more than the balance is refused
do $$ declare f1 boolean := false; f2 boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b8');
  perform public.transfer_account(pg_temp.id('w'), pg_temp.id('m'), 600, null, gen_random_uuid());
  begin perform public.transfer_account(pg_temp.id('w'), pg_temp.id('m'), 500, null, gen_random_uuid()); exception when others then f1 := true; end;
  begin perform public.transfer_account(pg_temp.id('m'), pg_temp.id('w'), 700, null, gen_random_uuid()); exception when others then f2 := true; end; reset role;
  perform pg_temp.rec('3 transfer, daily limit, no overdraft', f1 and f2 and pg_temp.abal(pg_temp.id('w')) = 2400 and pg_temp.abal(pg_temp.id('m')) = 600,
    pg_temp.abal(pg_temp.id('w')) || ' / ' || pg_temp.abal(pg_temp.id('m')));
end $$;

-- 4. shift opens with a number; add 500 / withdraw 200 on the maintenance drawer; overdraw and cashier refused
do $$ declare s public.cash_sessions; f1 boolean := false; f2 boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c8');
  s := public.open_shift(null, '{"products":1000,"maintenance":0,"installments":0}'::jsonb);
  begin perform public.move_drawer_cash(pg_temp.did('maintenance'), 'add', 10, 'x', gen_random_uuid()); exception when others then f1 := true; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b8');
  perform public.move_drawer_cash(pg_temp.did('maintenance'), 'add', 500, 'تمويل الدرج', gen_random_uuid());
  perform public.move_drawer_cash(pg_temp.did('maintenance'), 'withdraw', 200, 'سحب', gen_random_uuid());
  begin perform public.move_drawer_cash(pg_temp.did('maintenance'), 'withdraw', 9999, 'سحب', gen_random_uuid()); exception when others then f2 := true; end; reset role;
  perform pg_temp.rec('4 shift number; add / withdraw cash', s.shift_no > 0 and f1 and f2 and pg_temp.bal('maintenance') = 300, 'W-' || s.shift_no || ' mnt=' || pg_temp.bal('maintenance'));
end $$;

-- 5. expense 100 paid in cash from the maintenance drawer: products untouched
do $$ declare ex public.expenses; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a8');
  ex := public.create_expense((select id from public.expense_categories limit 1), 'مصروف تجربة 1', null, 100, null, null, null, null);
  perform public.pay_expense_from(ex.id, 100, 'cash', null, 'maintenance'); reset role;
  perform pg_temp.rec('5 expense from a chosen drawer', pg_temp.bal('maintenance') = 200 and pg_temp.bal('products') = 1000,
    'mnt=' || pg_temp.bal('maintenance') || ' prd=' || pg_temp.bal('products'));
end $$;

-- 6. expense 150 paid from the wallet account; an expense bigger than the drawer is refused; no choice = products drawer
do $$ declare ex public.expenses; ex2 public.expenses; f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a8');
  ex := public.create_expense((select id from public.expense_categories limit 1), 'مصروف تجربة 2', null, 150, null, null, null, null);
  perform public.pay_expense_from(ex.id, 150, 'wallet', null, null, pg_temp.id('w'));
  ex2 := public.create_expense((select id from public.expense_categories limit 1), 'مصروف تجربة 3', null, 900, null, null, null, null);
  begin perform public.pay_expense_from(ex2.id, 900, 'cash', null, 'maintenance'); exception when others then f := true; end;
  perform public.pay_expense(ex2.id, 400, 'cash'); reset role;
  perform pg_temp.rec('6 expense from an account; drawer cannot go negative; default = products',
    f and pg_temp.abal(pg_temp.id('w')) = 2250 and pg_temp.bal('products') = 600 and pg_temp.bal('maintenance') = 200,
    'w=' || pg_temp.abal(pg_temp.id('w')) || ' prd=' || pg_temp.bal('products'));
end $$;

-- 7. debt collection: 300 cash into the installments drawer, 200 by wallet into the wallet account
do $$ declare c uuid; a bigint; b bigint; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b8');
  c := public.save_customer(null, 'عميل تجربة حسابات', '01000000082', null, 'regular', 0, null);
  perform public.add_customer_debt(c, 1000, 'رصيد افتتاحي', gen_random_uuid()); reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c8');
  a := public.collect_customer_debt(c, 300, 'cash', null, gen_random_uuid(), 'installments');
  b := public.collect_customer_debt(c, 200, 'wallet', null, gen_random_uuid(), null, pg_temp.id('w')); reset role;
  insert into t_ids values ('cust', c::text), ('payw', b::text);
  perform pg_temp.rec('7 collection into a chosen drawer / account',
    pg_temp.bal('installments') = 300 and pg_temp.abal(pg_temp.id('w')) = 2450 and (select sum(amount) from public.customer_ledger where customer_id = c) = 500,
    'ins=' || pg_temp.bal('installments') || ' w=' || pg_temp.abal(pg_temp.id('w')));
end $$;

-- 8. reversing the wallet collection takes the money back out of the wallet
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b8');
  perform public.reverse_customer_entry((select v::bigint from t_ids where k = 'payw'), 'خطأ في التحصيل'); reset role;
  perform pg_temp.rec('8 reversal returns money from the same account',
    pg_temp.abal(pg_temp.id('w')) = 2250 and (select sum(amount) from public.customer_ledger where customer_id = pg_temp.id('cust')) = 700,
    'w=' || pg_temp.abal(pg_temp.id('w')));
end $$;

-- 9. control log: the wallet opening shows before 0 / after 3,000; expenses are not in it
do $$ declare r record; n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a8');
  select * into r from public.balance_control_log where scope = 'account' and kind = 'opening' and target = 'تجربة محفظة';
  select count(*) into n from public.balance_control_log where kind in ('expense','sale','debt_collection'); reset role;
  perform pg_temp.rec('9 control log before / after', r.balance_before = 0 and r.balance_after = 3000 and n = 0, r.balance_before || ' -> ' || r.balance_after);
end $$;

-- 10. closing 50 short raises an alert; the cashier cannot review; the manager reviews once
do $$ declare s public.cash_sessions; al public.shift_alerts; f1 boolean := false; f2 boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c8');
  s := public.close_shift('{"products":550}'::jsonb, 'عجز 50 للاختبار'); reset role;
  select * into al from public.shift_alerts where session_id = s.id and phase = 'close' and drawer_code = 'products';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c8');
  begin perform public.review_shift_alert(al.id, 'تمام'); exception when others then f1 := true; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b8');
  perform public.review_shift_alert(al.id, 'تمت المراجعة مع الكاشير');
  begin perform public.review_shift_alert(al.id, 'مرة ثانية'); exception when others then f2 := true; end; reset role;
  perform pg_temp.rec('10 shortage alert and review', al.difference = -50 and f1 and f2
    and (select reviewed_at is not null from public.shift_alerts where id = al.id), 'diff=' || al.difference);
end $$;

do $$ declare j text; begin
  select string_agg(test || ' = ' || ok || ' [' || detail || ']', E'\n' order by n) into j from t_results;
  raise exception E'RESULTS (rolled back)\n%', j;
end $$;
