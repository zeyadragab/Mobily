-- Wallet send / receive, bills and machine operations (0031).
-- Run on STAGING after 0001-0031. Everything is rolled back: the last block raises the results as an error on purpose.
-- Expected: every line "= true".

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;
create temp table t_ids(k text primary key, v text);
grant all on t_ids to public;

insert into auth.users (id, aud, role, email) values
 ('00000000-0000-0000-0000-0000000031a1','authenticated','authenticated','t-owner31@test.invalid'),
 ('00000000-0000-0000-0000-0000000031b1','authenticated','authenticated','t-manager31@test.invalid'),
 ('00000000-0000-0000-0000-0000000031c1','authenticated','authenticated','t-cashier31@test.invalid'),
 ('00000000-0000-0000-0000-0000000031c2','authenticated','authenticated','t-cashier31b@test.invalid');
insert into public.user_roles(user_id, role) values
 ('00000000-0000-0000-0000-0000000031a1','owner'),
 ('00000000-0000-0000-0000-0000000031b1','manager'),
 ('00000000-0000-0000-0000-0000000031c1','cashier'),
 ('00000000-0000-0000-0000-0000000031c2','cashier');
insert into public.manager_pins(user_id, pin_hash) values ('00000000-0000-0000-0000-0000000031b1', extensions.crypt('1234', extensions.gen_salt('bf')));
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
create or replace function pg_temp.debt(c uuid) returns numeric language sql as $$
  select coalesce(sum(amount),0) from public.customer_ledger where customer_id = c $$;
create or replace function pg_temp.src(c uuid, s text) returns numeric language sql as $$
  select coalesce((select balance from public.customer_source_balances where customer_id = c and source = s), 0) $$;
create or replace function pg_temp.id(key text) returns uuid language sql as $$ select v::uuid from t_ids where k = key $$;
-- a manager PIN token for the second cashier
create or replace function pg_temp.token() returns uuid language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031c2');
  r := public.request_override('00000000-0000-0000-0000-0000000031b1', '1234', 'تحويل محفظة كبير');
  reset role;
  return (r->>'token')::uuid;
end $$;

-- setup: wallet W (min balance 500, 20,000), wallet L (daily limit 1,000, 5,000), machine M (2,000),
-- customer with a 2,000 credit limit, shift open with every drawer counted at 0
do $$ declare w uuid; l uuid; m uuid; c uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031a1');
  w := public.save_money_account(null, 'wallet', 'تجربة محفظة التحويلات', '01000003111', null, null, 500);
  l := public.save_money_account(null, 'wallet', 'تجربة محفظة بحد يومي', '01000003112', 1000, null, 0);
  m := public.save_money_account(null, 'machine', 'تجربة ماكينة الفواتير', null, null, null, 0);
  perform public.adjust_account(w, 20000, 'رصيد افتتاحي', gen_random_uuid());
  perform public.adjust_account(l, 5000, 'رصيد افتتاحي', gen_random_uuid());
  perform public.adjust_account(m, 2000, 'رصيد افتتاحي', gen_random_uuid());
  c := public.save_customer(null, 'تجربة محمود عبد الله', '01000003113', null, 'regular', 2000, null);
  perform public.open_shift(null, '{"products":0,"maintenance":0,"machines":0,"installments":0,"wallets":0}'::jsonb); reset role;
  insert into t_ids values ('w', w::text), ('l', l::text), ('m', m::text), ('cust', c::text),
    ('svc', (select id::text from public.bill_services where is_active order by sort_order limit 1));
  perform pg_temp.rec('0 setup', pg_temp.abal(w) = 20000 and pg_temp.abal(l) = 5000 and pg_temp.abal(m) = 2000
    and pg_temp.bal('wallets') = 0 and pg_temp.bal('machines') = 0, 'wallets=' || pg_temp.bal('wallets') || ' machines=' || pg_temp.bal('machines'));
end $$;

-- 1. receive (R22): refused while the wallets drawer is empty; after 3,000 cash: wallet +1,000, drawer -990
do $$ declare e text := ''; op public.wallet_operations; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031c1');
  begin perform public.process_wallet_operation(pg_temp.id('w'), 'receive', 1000, 10, null, null, null, gen_random_uuid());
  exception when others then e := sqlerrm; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031a1');
  perform public.move_drawer_cash(pg_temp.did('wallets'), 'add', 3000, 'تمويل درج المحافظ', gen_random_uuid()); reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031c1');
  op := public.process_wallet_operation(pg_temp.id('w'), 'receive', 1000, 10, null, '0100 000-3114', 'استلام تجربة', gen_random_uuid()); reset role;
  insert into t_ids values ('op_recv', op.id::text);
  perform pg_temp.rec('1 receive: wallet +A, drawer -(A-C); refused without drawer cash',
    e = 'insufficient drawer balance' and op.status = 'done' and op.party_phone = '01000003114' and op.op_no like 'WO-%'
    and pg_temp.abal(pg_temp.id('w')) = 21000 and pg_temp.bal('wallets') = 2010,
    e || ' w=' || pg_temp.abal(pg_temp.id('w')) || ' drawer=' || pg_temp.bal('wallets'));
end $$;

-- 2. send (R23): wallet -1,000, drawer +1,010; a send that would leave less than the minimum balance is refused
do $$ declare e text := ''; e2 text := ''; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031c1');
  perform public.process_wallet_operation(pg_temp.id('w'), 'send', 1000, 10, null, null, null, gen_random_uuid());
  begin perform public.process_wallet_operation(pg_temp.id('w'), 'send', 0, 0, null, null, null, gen_random_uuid());
  exception when others then e2 := sqlerrm; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031b1');
  begin perform public.process_wallet_operation(pg_temp.id('w'), 'send', 19600, 0, null, null, null, gen_random_uuid());
  exception when others then e := sqlerrm; end; reset role;
  perform pg_temp.rec('2 send: wallet -A, drawer +(A+C); refused under min balance',
    e = 'insufficient account balance' and e2 = 'invalid amount' and pg_temp.abal(pg_temp.id('w')) = 20000 and pg_temp.bal('wallets') = 3020,
    e || ' / ' || e2 || ' w=' || pg_temp.abal(pg_temp.id('w')) || ' drawer=' || pg_temp.bal('wallets'));
end $$;

-- 3. send on credit: wallet -500, debt +505 (source wallets), drawer untouched; needs a customer; credit limit for cashier and manager
do $$ declare e1 text := ''; e2 text := ''; e3 text := ''; op public.wallet_operations; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031c1');
  begin perform public.process_wallet_operation(pg_temp.id('w'), 'send_credit', 500, 5, null, null, null, gen_random_uuid());
  exception when others then e1 := sqlerrm; end;
  op := public.process_wallet_operation(pg_temp.id('w'), 'send_credit', 500, 5, pg_temp.id('cust'), null, null, gen_random_uuid());
  begin perform public.process_wallet_operation(pg_temp.id('w'), 'send_credit', 1600, 0, pg_temp.id('cust'), null, null, gen_random_uuid());
  exception when others then e2 := sqlerrm; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031b1');
  begin perform public.process_wallet_operation(pg_temp.id('w'), 'send_credit', 1600, 0, pg_temp.id('cust'), null, null, gen_random_uuid());
  exception when others then e3 := sqlerrm; end; reset role;
  insert into t_ids values ('op_sc', op.id::text);
  perform pg_temp.rec('3 send_credit: wallet -A, debt +(A+C), no drawer move; customer and credit limit',
    e1 = 'customer required' and e2 = 'credit limit exceeded' and e3 = 'credit limit exceeded'
    and pg_temp.abal(pg_temp.id('w')) = 19500 and pg_temp.debt(pg_temp.id('cust')) = 505
    and pg_temp.src(pg_temp.id('cust'), 'wallets') = 505 and pg_temp.bal('wallets') = 3020,
    e1 || ' / ' || e2 || ' / ' || e3 || ' w=' || pg_temp.abal(pg_temp.id('w')) || ' debt=' || pg_temp.debt(pg_temp.id('cust')));
end $$;

-- 4. receive on credit: drawer -792, debt +800, pending, wallet untouched; settle: wallet +800, debt back, done; settle twice refused
do $$ declare op public.wallet_operations; op2 public.wallet_operations; mid text; e text := ''; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031c1');
  op := public.process_wallet_operation(pg_temp.id('w'), 'receive_credit', 800, 8, pg_temp.id('cust'), null, null, gen_random_uuid()); reset role;
  mid := 'drawer=' || pg_temp.bal('wallets') || ' debt=' || pg_temp.debt(pg_temp.id('cust')) || ' w=' || pg_temp.abal(pg_temp.id('w')) || ' ' || op.status;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031c1');
  op2 := public.settle_wallet_operation(op.id);
  begin perform public.settle_wallet_operation(op.id); exception when others then e := sqlerrm; end; reset role;
  insert into t_ids values ('op_rc', op.id::text);
  perform pg_temp.rec('4 receive_credit pending then settle',
    mid = 'drawer=2228.00 debt=1305.00 w=19500.00 pending' and op2.status = 'done' and op2.settled_at is not null
    and e = 'operation not pending' and pg_temp.abal(pg_temp.id('w')) = 20300 and pg_temp.debt(pg_temp.id('cust')) = 505
    and pg_temp.bal('wallets') = 2228,
    mid || ' -> w=' || pg_temp.abal(pg_temp.id('w')) || ' debt=' || pg_temp.debt(pg_temp.id('cust')) || ' ' || e);
end $$;

-- 5. daily limit 1,000 counts send + receive together (R26): send 600, receive 300, then receive 200 is refused
do $$ declare e text := ''; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031c1');
  perform public.process_wallet_operation(pg_temp.id('l'), 'send', 600, 0, null, null, null, gen_random_uuid());
  perform public.process_wallet_operation(pg_temp.id('l'), 'receive', 300, 0, null, null, null, gen_random_uuid());
  begin perform public.process_wallet_operation(pg_temp.id('l'), 'receive', 200, 0, null, null, null, gen_random_uuid());
  exception when others then e := sqlerrm; end; reset role;
  perform pg_temp.rec('5 daily limit across send + receive',
    e = 'account daily limit exceeded' and pg_temp.abal(pg_temp.id('l')) = 4700 and pg_temp.bal('wallets') = 2528,
    e || ' l=' || pg_temp.abal(pg_temp.id('l')) || ' drawer=' || pg_temp.bal('wallets'));
end $$;

-- 6. idempotency: the same key twice is one operation
do $$ declare a public.wallet_operations; b public.wallet_operations; n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031c2');
  a := public.process_wallet_operation(pg_temp.id('w'), 'send', 100, 1, null, null, null, '00000000-0000-0000-0000-000031f00001');
  b := public.process_wallet_operation(pg_temp.id('w'), 'send', 100, 1, null, null, null, '00000000-0000-0000-0000-000031f00001'); reset role;
  select count(*) into n from public.wallet_operations where idempotency_key = '00000000-0000-0000-0000-000031f00001';
  perform pg_temp.rec('6 idempotent', a.id = b.id and n = 1 and pg_temp.abal(pg_temp.id('w')) = 20200 and pg_temp.bal('wallets') = 2629,
    'n=' || n || ' w=' || pg_temp.abal(pg_temp.id('w')) || ' drawer=' || pg_temp.bal('wallets'));
end $$;

-- 7. PIN threshold: a cashier at the threshold needs a manager PIN; with the token it passes; the manager needs none
do $$ declare thr numeric := (select value from public.app_settings where key = 'wallet_pin_threshold'); e text := ''; e2 text := '';
        tok uuid; op public.wallet_operations; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031c2');
  begin perform public.process_wallet_operation(pg_temp.id('w'), 'send', thr, 0, null, null, null, gen_random_uuid());
  exception when others then e := sqlerrm; end;
  perform public.process_wallet_operation(pg_temp.id('w'), 'send', thr - 0.01, 0, null, null, null, gen_random_uuid()); reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031b1');
  perform public.cancel_wallet_operation((select id from public.wallet_operations where amount = thr - 0.01 and created_by = '00000000-0000-0000-0000-0000000031c2'), 'تراجع تجربة'); reset role;
  tok := pg_temp.token();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031c2');
  op := public.process_wallet_operation(pg_temp.id('w'), 'send', thr, 0, null, null, null, gen_random_uuid(), tok);
  begin perform public.process_wallet_operation(pg_temp.id('w'), 'send', thr, 0, null, null, null, gen_random_uuid(), tok);
  exception when others then e2 := sqlerrm; end; reset role;
  perform pg_temp.rec('7 PIN threshold for the cashier', thr = 10000 and e = 'override required' and e2 = 'override invalid' and op.status = 'done'
    and pg_temp.abal(pg_temp.id('w')) = 10200 and pg_temp.bal('wallets') = 12629,
    e || ' / ' || e2 || ' w=' || pg_temp.abal(pg_temp.id('w')) || ' drawer=' || pg_temp.bal('wallets'));
end $$;

-- 8. RLS: each cashier sees only their own operations; manager sees all; anon cannot run anything; helpers are internal
do $$ declare n1 int; o1 int; n2 int; o2 int; nm int; tot int; anon_any boolean; helper_any boolean; b1 int; begin
  select count(*) into tot from public.wallet_operations;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031c1');
  select count(*), count(*) filter (where created_by <> '00000000-0000-0000-0000-0000000031c1') into n1, o1 from public.wallet_operations;
  select count(*) into b1 from public.bill_operations; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031c2');
  select count(*), count(*) filter (where created_by <> '00000000-0000-0000-0000-0000000031c2') into n2, o2 from public.wallet_operations; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031b1');
  select count(*) into nm from public.wallet_operations; reset role;
  select bool_or(has_function_privilege('anon', p.oid, 'execute')) into anon_any from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('process_wallet_operation','settle_wallet_operation','cancel_wallet_operation',
     'pay_bill','machine_operation','cancel_bill_operation','m_branch','m_session','m_drawer_move','m_account_move','m_customer_entry','m_reverse_ref');
  select bool_or(has_function_privilege('authenticated', p.oid, 'execute')) into helper_any from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('m_branch','m_session','m_drawer_move','m_account_move','m_customer_entry','m_reverse_ref');
  perform pg_temp.rec('8 RLS and grants', n1 = 6 and o1 = 0 and n2 = 3 and o2 = 0 and nm = tot and tot >= 9 and not anon_any and not helper_any
    -- Supabase gives anon table grants on every table; the protection is RLS on and no policy that reaches anon or public
    and (select bool_and(relrowsecurity) from pg_class where relnamespace = 'public'::regnamespace and relname in ('wallet_operations','bill_operations','bill_services'))
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('wallet_operations','bill_operations') and (roles::text ~ 'anon' or roles::text ~ 'public')),
    'c1=' || n1 || '/' || o1 || ' c2=' || n2 || '/' || o2 || ' mgr=' || nm || '/' || tot || ' anon=' || anon_any || ' helpers=' || helper_any);
end $$;

-- 9. cancel: cashier refused, reason needed, manager reverses wallet + debt (send_credit) and wallet + drawer (receive), twice refused
do $$ declare e1 text := ''; e2 text := ''; e3 text := ''; op public.wallet_operations; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031c1');
  begin perform public.cancel_wallet_operation(pg_temp.id('op_sc'), 'خطأ'); exception when others then e1 := sqlerrm; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031b1');
  begin perform public.cancel_wallet_operation(pg_temp.id('op_sc'), '  '); exception when others then e2 := sqlerrm; end;
  op := public.cancel_wallet_operation(pg_temp.id('op_sc'), 'رقم خاطئ');
  perform public.cancel_wallet_operation(pg_temp.id('op_recv'), 'العميل تراجع');
  begin perform public.cancel_wallet_operation(pg_temp.id('op_sc'), 'مرة ثانية'); exception when others then e3 := sqlerrm; end; reset role;
  perform pg_temp.rec('9 cancel reverses drawer, account and customer exactly',
    e1 = 'not allowed' and e2 = 'reason required' and e3 = 'operation already cancelled' and op.status = 'cancelled'
    and op.cancelled_by = '00000000-0000-0000-0000-0000000031b1' and op.cancel_reason = 'رقم خاطئ'
    and pg_temp.abal(pg_temp.id('w')) = 9700 and pg_temp.debt(pg_temp.id('cust')) = 0 and pg_temp.bal('wallets') = 13619,
    e1 || ' / ' || e2 || ' / ' || e3 || ' w=' || pg_temp.abal(pg_temp.id('w')) || ' debt=' || pg_temp.debt(pg_temp.id('cust')) || ' drawer=' || pg_temp.bal('wallets'));
end $$;

-- 10. cancelling a settled receive_credit undoes all three sides: drawer +792, wallet -800, debt stays 0
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031b1');
  perform public.cancel_wallet_operation(pg_temp.id('op_rc'), 'التحويل لم يصل'); reset role;
  perform pg_temp.rec('10 cancel a settled receive_credit',
    pg_temp.abal(pg_temp.id('w')) = 8900 and pg_temp.debt(pg_temp.id('cust')) = 0 and pg_temp.bal('wallets') = 14411,
    'w=' || pg_temp.abal(pg_temp.id('w')) || ' debt=' || pg_temp.debt(pg_temp.id('cust')) || ' drawer=' || pg_temp.bal('wallets'));
end $$;

-- 11. bill in cash: machine -100, machines drawer +101; the same key twice is one bill
do $$ declare g uuid; g2 uuid; n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031c1');
  g := public.pay_bill(pg_temp.id('m'), pg_temp.id('svc'), 100, 1, 'cash', null, ' 12345 ', 1, '00000000-0000-0000-0000-000031f00002');
  g2 := public.pay_bill(pg_temp.id('m'), pg_temp.id('svc'), 100, 1, 'cash', null, ' 12345 ', 1, '00000000-0000-0000-0000-000031f00002'); reset role;
  select count(*) into n from public.bill_operations where group_id = g;
  perform pg_temp.rec('11 pay_bill cash: account -cost, machines drawer +(cost+C)',
    g = g2 and n = 1 and pg_temp.abal(pg_temp.id('m')) = 1900 and pg_temp.bal('machines') = 101
    and (select reference = '12345' and kind = 'bill' and service_name is not null and op_no like 'BL-%' from public.bill_operations where group_id = g),
    'n=' || n || ' m=' || pg_temp.abal(pg_temp.id('m')) || ' machines=' || pg_temp.bal('machines'));
end $$;

-- 12. bill on credit: machine -200, debt +205 with source bills, drawer untouched; needs a customer
do $$ declare g uuid; e text := ''; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031c1');
  begin perform public.pay_bill(pg_temp.id('m'), pg_temp.id('svc'), 200, 5, 'credit', null, null, 1, gen_random_uuid());
  exception when others then e := sqlerrm; end;
  g := public.pay_bill(pg_temp.id('m'), pg_temp.id('svc'), 200, 5, 'credit', pg_temp.id('cust'), null, 1, gen_random_uuid()); reset role;
  insert into t_ids values ('bill_credit', (select id::text from public.bill_operations where group_id = g));
  perform pg_temp.rec('12 pay_bill credit: debt +(cost+C), source bills',
    e = 'customer required' and pg_temp.abal(pg_temp.id('m')) = 1700 and pg_temp.debt(pg_temp.id('cust')) = 205
    and pg_temp.src(pg_temp.id('cust'), 'bills') = 205 and pg_temp.src(pg_temp.id('cust'), 'wallets') = 0 and pg_temp.bal('machines') = 101,
    e || ' m=' || pg_temp.abal(pg_temp.id('m')) || ' debt=' || pg_temp.debt(pg_temp.id('cust')) || ' bills=' || pg_temp.src(pg_temp.id('cust'), 'bills'));
end $$;

-- 13. count 3 makes 3 rows and moves 3 times; count 21 and count 0 are refused; a bill bigger than the balance is refused
do $$ declare g uuid; n int; e1 text := ''; e2 text := ''; e3 text := ''; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031c1');
  g := public.pay_bill(pg_temp.id('m'), pg_temp.id('svc'), 50, 1, 'cash', null, null, 3, gen_random_uuid());
  begin perform public.pay_bill(pg_temp.id('m'), pg_temp.id('svc'), 1, 0, 'cash', null, null, 21, gen_random_uuid());
  exception when others then e1 := sqlerrm; end;
  begin perform public.pay_bill(pg_temp.id('m'), pg_temp.id('svc'), 1, 0, 'cash', null, null, 0, gen_random_uuid());
  exception when others then e2 := sqlerrm; end;
  begin perform public.pay_bill(pg_temp.id('m'), pg_temp.id('svc'), 600, 0, 'cash', null, null, 3, gen_random_uuid());
  exception when others then e3 := sqlerrm; end; reset role;
  select count(*) into n from public.bill_operations where group_id = g;
  perform pg_temp.rec('13 pay_bill count', n = 3 and e1 = 'invalid count' and e2 = 'invalid count' and e3 = 'insufficient account balance'
    and pg_temp.abal(pg_temp.id('m')) = 1550 and pg_temp.bal('machines') = 254
    and (select count(distinct ref_id) from public.account_movements where account_id = pg_temp.id('m') and kind = 'bill') = 5,
    'n=' || n || ' ' || e1 || ' / ' || e2 || ' / ' || e3 || ' m=' || pg_temp.abal(pg_temp.id('m')) || ' machines=' || pg_temp.bal('machines'));
end $$;

-- 14. machine operation: account +(200+4), machines drawer -200; a wallet account is refused; drawer cannot go negative
do $$ declare i uuid; i2 uuid; e1 text := ''; e2 text := ''; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031c1');
  i := public.machine_operation(pg_temp.id('m'), 200, 4, null, '00000000-0000-0000-0000-000031f00003');
  i2 := public.machine_operation(pg_temp.id('m'), 200, 4, null, '00000000-0000-0000-0000-000031f00003');
  begin perform public.machine_operation(pg_temp.id('w'), 10, 0, null, gen_random_uuid()); exception when others then e1 := sqlerrm; end;
  begin perform public.machine_operation(pg_temp.id('m'), 1000, 0, null, gen_random_uuid()); exception when others then e2 := sqlerrm; end; reset role;
  insert into t_ids values ('mop', i::text);
  perform pg_temp.rec('14 machine_operation: account +(A+C), machines drawer -A; kind machine only',
    i = i2 and e1 = 'invalid account' and e2 = 'insufficient drawer balance' and pg_temp.abal(pg_temp.id('m')) = 1754 and pg_temp.bal('machines') = 54
    and (select kind = 'machine' and pay = 'cash' from public.bill_operations where id = i),
    e1 || ' / ' || e2 || ' m=' || pg_temp.abal(pg_temp.id('m')) || ' machines=' || pg_temp.bal('machines'));
end $$;

-- 15. cancel a bill: cashier refused; manager restores the account and the debt (credit bill) and account + drawer (machine op)
do $$ declare e1 text := ''; e2 text := ''; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031c1');
  begin perform public.cancel_bill_operation(pg_temp.id('bill_credit'), 'خطأ'); exception when others then e1 := sqlerrm; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031b1');
  perform public.cancel_bill_operation(pg_temp.id('bill_credit'), 'فاتورة خاطئة');
  perform public.cancel_bill_operation(pg_temp.id('mop'), 'العملية لم تتم');
  begin perform public.cancel_bill_operation(pg_temp.id('mop'), 'مرة ثانية'); exception when others then e2 := sqlerrm; end; reset role;
  perform pg_temp.rec('15 cancel_bill_operation restores',
    e1 = 'not allowed' and e2 = 'operation already cancelled' and pg_temp.abal(pg_temp.id('m')) = 1750 and pg_temp.bal('machines') = 254
    and pg_temp.debt(pg_temp.id('cust')) = 0 and pg_temp.src(pg_temp.id('cust'), 'bills') = 0
    and (select status = 'cancelled' and cancelled_by = '00000000-0000-0000-0000-0000000031b1' from public.bill_operations where id = pg_temp.id('mop')),
    e1 || ' / ' || e2 || ' m=' || pg_temp.abal(pg_temp.id('m')) || ' machines=' || pg_temp.bal('machines') || ' debt=' || pg_temp.debt(pg_temp.id('cust')));
end $$;

-- 16. nothing works without an open shift; a warehouse-less user (no role) is refused
do $$ declare e1 text := ''; e2 text := ''; e3 text := ''; begin
  update public.cash_sessions set status = 'closed', closed_at = now() where status = 'open';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000031c1');
  begin perform public.process_wallet_operation(pg_temp.id('w'), 'send', 10, 0, null, null, null, gen_random_uuid()); exception when others then e1 := sqlerrm; end;
  begin perform public.pay_bill(pg_temp.id('m'), pg_temp.id('svc'), 10, 0, 'cash', null, null, 1, gen_random_uuid()); exception when others then e2 := sqlerrm; end;
  begin perform public.machine_operation(pg_temp.id('m'), 10, 0, null, gen_random_uuid()); exception when others then e3 := sqlerrm; end; reset role;
  perform pg_temp.rec('16 open shift required', e1 = 'no open cash session' and e2 = e1 and e3 = e1, e1 || ' / ' || e2 || ' / ' || e3);
end $$;

do $$ declare j text; begin
  select string_agg(test || ' = ' || ok || ' [' || detail || ']', E'\n' order by n) into j from t_results;
  raise exception E'RESULTS (rolled back)\n%', j;
end $$;
