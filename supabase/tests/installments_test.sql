-- Installments, in/out and trade-in (0033, rules R18-R21).
-- Run on STAGING after 0001-0033. Everything is rolled back: the last block raises the results as an error on purpose.
-- Expected: every line "= true".

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;
create temp table t_ids(k text primary key, v text);
grant all on t_ids to public;
create temp table t_base(k text primary key, v numeric);
grant all on t_base to public;

insert into auth.users (id, aud, role, email) values
 ('00000000-0000-0000-0000-0000000033a1','authenticated','authenticated','t-owner33@test.invalid'),
 ('00000000-0000-0000-0000-0000000033b1','authenticated','authenticated','t-manager33@test.invalid'),
 ('00000000-0000-0000-0000-0000000033c1','authenticated','authenticated','t-cashier33@test.invalid');
insert into public.user_roles(user_id, role) values
 ('00000000-0000-0000-0000-0000000033a1','owner'),
 ('00000000-0000-0000-0000-0000000033b1','manager'),
 ('00000000-0000-0000-0000-0000000033c1','cashier');
insert into public.manager_pins(user_id, pin_hash) values ('00000000-0000-0000-0000-0000000033a1', extensions.crypt('1234', extensions.gen_salt('bf')));
update public.cash_sessions set status = 'closed', closed_at = now() where status = 'open';

-- a serial-tracked item (internal serial) and a plain item with stock for one credit sale
insert into public.products(id, name, track_serial) values ('00000000-0000-0000-0000-00000000a033', 'هاتف مستعمل اختبار 33', true);
insert into public.variants(id, product_id, sku, price) values ('00000000-0000-0000-0000-00000000b033', '00000000-0000-0000-0000-00000000a033', 'T33-SER', 4000);
insert into public.products(id, name) values ('00000000-0000-0000-0000-00000000a034', 'منتج بيع آجل اختبار 33');
insert into public.variants(id, product_id, sku, price) values ('00000000-0000-0000-0000-00000000b034', '00000000-0000-0000-0000-00000000a034', 'T33-PLAIN', 5700);
insert into public.variant_costs(variant_id, cost) values ('00000000-0000-0000-0000-00000000b034', 5000);
insert into public.stock_movements(variant_id, branch_id, movement_type, qty)
values ('00000000-0000-0000-0000-00000000b034', (select id from public.branches where is_active order by created_at limit 1), 'adjustment', 5);

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
create or replace function pg_temp.dd(c text) returns numeric language sql as $$ select pg_temp.bal(c) - (select v from t_base where k = c) $$;
create or replace function pg_temp.did(c text) returns uuid language sql as $$ select id from public.drawers where code = c and branch_id = pg_temp.branch() $$;
create or replace function pg_temp.abal(a uuid) returns numeric language sql as $$ select coalesce(sum(amount),0) from public.account_movements where account_id = a $$;
create or replace function pg_temp.debt(c uuid) returns numeric language sql as $$ select coalesce(sum(amount),0) from public.customer_ledger where customer_id = c $$;
create or replace function pg_temp.src(c uuid, s text) returns numeric language sql as $$
  select coalesce((select balance from public.customer_source_balances where customer_id = c and source = s), 0) $$;
create or replace function pg_temp.inst(p uuid, n int) returns uuid language sql as $$ select id from public.installments where plan_id = p and seq = n $$;
create or replace function pg_temp.token() returns uuid language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033b1');
  r := public.request_override('00000000-0000-0000-0000-0000000033a1', '1234', 'إلغاء شراء مستعمل');
  reset role;
  return (r->>'token')::uuid;
end $$;

-- setup: wallet W (30,000), customers C1 (limit 100,000) and C2 (50,000), shift open, products drawer funded with 20,000
do $$ declare w uuid; c1 uuid; c2 uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033a1');
  w := public.save_money_account(null, 'wallet', 'تجربة محفظة أقساط 33', '01000003301', null, null, 0);
  perform public.adjust_account(w, 30000, 'رصيد افتتاحي', gen_random_uuid());
  c1 := public.save_customer(null, 'تجربة أقساط 33 أ', '01000003302', null, 'regular', 100000, null);
  c2 := public.save_customer(null, 'تجربة أقساط 33 ب', '01000003303', null, 'regular', 50000, null);
  perform public.open_shift(null, '{}'::jsonb);
  perform public.move_drawer_cash(pg_temp.did('products'), 'add', 20000, 'تمويل اختبار', gen_random_uuid());
  reset role;
  insert into t_ids values ('w', w::text), ('c1', c1::text), ('c2', c2::text);
  insert into t_base values ('products', pg_temp.bal('products')), ('installments', pg_temp.bal('installments'));
  perform pg_temp.rec('0 setup', pg_temp.abal(w) = 30000 and pg_temp.debt(c1) = 0 and pg_temp.debt(c2) = 0, 'products=' || pg_temp.bal('products'));
end $$;

-- 1. manual plan (R20): 1,000 + 100 interest - 200 down over 3 months from Jan 31 -> 3 x 300 on Jan 31, Feb 28, Mar 31
do $$ declare p public.installment_plans; p2 public.installment_plans; n int; f1 text := ''; f2 text := ''; f3 text := ''; f4 text := ''; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033c1');
  begin perform public.create_installment_plan(pg_temp.id('c1'), null, 'x', 1000, 0, 0, 3, 'month', date '2026-01-31', gen_random_uuid()); exception when others then f1 := sqlerrm; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033a1');
  p := public.create_installment_plan(pg_temp.id('c1'), null, 'خطة يدوية', 1000, 100, 200, 3, 'month', date '2026-01-31', '00000000-0000-0000-0000-000033f00001');
  p2 := public.create_installment_plan(pg_temp.id('c1'), null, 'خطة يدوية', 1000, 100, 200, 3, 'month', date '2026-01-31', '00000000-0000-0000-0000-000033f00001');
  begin perform public.create_installment_plan(pg_temp.id('c1'), null, 'x', 1000, 0, 0, 0, 'month', date '2026-01-31', gen_random_uuid()); exception when others then f2 := sqlerrm; end;
  begin perform public.create_installment_plan(pg_temp.id('c1'), null, 'x', 1000, 100, 1100, 3, 'month', date '2026-01-31', gen_random_uuid()); exception when others then f3 := sqlerrm; end;
  begin perform public.create_installment_plan(pg_temp.id('c1'), null, 'x', 1000, 0, 0, 3, 'year', date '2026-01-31', gen_random_uuid()); exception when others then f4 := sqlerrm; end;
  reset role;
  select count(*) into n from public.installment_plans where idempotency_key = '00000000-0000-0000-0000-000033f00001';
  insert into t_ids values ('plan1', p.id::text);
  perform pg_temp.rec('1 manual plan: schedule, down payment, debt; cashier refused; idempotent; bad input refused',
    p.status = 'active' and p.plan_no like 'IP-%' and p.id = p2.id and n = 1 and f1 = 'not allowed' and f2 = 'invalid installment count'
    and f3 = 'invalid amount' and f4 = 'invalid period'
    and (select array_agg(amount order by seq) from public.installments where plan_id = p.id) = array[300, 300, 300]::numeric[]
    and (select array_agg(due_date order by seq) from public.installments where plan_id = p.id) = array[date '2026-01-31', date '2026-02-28', date '2026-03-31']
    and pg_temp.dd('products') = 200 and pg_temp.debt(pg_temp.id('c1')) = 900 and pg_temp.src(pg_temp.id('c1'), 'installments') = 900,
    f1 || ' / ' || f2 || ' / ' || f3 || ' / ' || f4 || ' drawer+=' || pg_temp.dd('products') || ' debt=' || pg_temp.debt(pg_temp.id('c1')));
end $$;

-- 2. the last installment takes the rounding remainder; a plan nobody paid into can be cancelled (reasons, roles, twice)
do $$ declare p public.installment_plans; e1 text := ''; e2 text := ''; e3 text := ''; e4 text := ''; tot numeric; w1 date[]; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033a1');
  p := public.create_installment_plan(pg_temp.id('c2'), null, null, 1000, 0, 0, 7, 'week', date '2026-02-01', gen_random_uuid()); reset role;
  select sum(amount) into tot from public.installments where plan_id = p.id;
  select array_agg(due_date order by seq) into w1 from public.installments where plan_id = p.id;
  perform pg_temp.rec('2a remainder on the last installment',
    tot = 1000 and (select amount from public.installments where plan_id = p.id and seq = 1) = 142.86
    and (select amount from public.installments where plan_id = p.id and seq = 7) = 142.84
    and w1[2] = date '2026-02-08' and w1[7] = date '2026-03-15' and pg_temp.debt(pg_temp.id('c2')) = 1000, 'total=' || tot);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033c1');
  begin perform public.cancel_installment_plan(p.id, 'خطأ'); exception when others then e1 := sqlerrm; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033b1');
  begin perform public.cancel_installment_plan(p.id, '  '); exception when others then e2 := sqlerrm; end;
  perform public.cancel_installment_plan(p.id, 'الخطة اتسجلت بالغلط');
  begin perform public.cancel_installment_plan(p.id, 'مرة ثانية'); exception when others then e3 := sqlerrm; end;
  reset role;
  perform pg_temp.rec('2b cancel plan: roles, reason, debt reversed, installments cancelled, once',
    e1 = 'not allowed' and e2 = 'reason required' and e3 = 'plan not active'
    and pg_temp.debt(pg_temp.id('c2')) = 0 and (select status from public.installment_plans where id = p.id) = 'cancelled'
    and not exists (select 1 from public.installments where plan_id = p.id and status <> 'cancelled'),
    e1 || ' / ' || e2 || ' / ' || e3 || ' debt=' || pg_temp.debt(pg_temp.id('c2')));
end $$;

-- 3. collect (R21): partial 100 then rest 200 of installment 1 in cash (installments drawer), too much refused,
--    installment 2 through the wallet, same key twice = one collection
do $$ declare c1 public.installment_collections; c1b public.installment_collections; c2 public.installment_collections; c3 public.installment_collections;
        e1 text := ''; e2 text := ''; n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033c1');
  c1 := public.collect_installment(pg_temp.inst(pg_temp.id('plan1'), 1), 100, 'cash', 'installments', null, '00000000-0000-0000-0000-000033f00011');
  c1b := public.collect_installment(pg_temp.inst(pg_temp.id('plan1'), 1), 100, 'cash', 'installments', null, '00000000-0000-0000-0000-000033f00011');
  begin perform public.collect_installment(pg_temp.inst(pg_temp.id('plan1'), 1), 250, 'cash', 'installments', null, gen_random_uuid()); exception when others then e1 := sqlerrm; end;
  c2 := public.collect_installment(pg_temp.inst(pg_temp.id('plan1'), 1), 200, 'cash', 'installments', null, gen_random_uuid());
  begin perform public.collect_installment(pg_temp.inst(pg_temp.id('plan1'), 2), 300, 'wallet', 'installments', null, gen_random_uuid()); exception when others then e2 := sqlerrm; end;
  c3 := public.collect_installment(pg_temp.inst(pg_temp.id('plan1'), 2), 300, 'wallet', 'installments', pg_temp.id('w'), gen_random_uuid());
  reset role;
  select count(*) into n from public.installment_collections where idempotency_key = '00000000-0000-0000-0000-000033f00011';
  insert into t_ids values ('col_wallet', c3.id::text), ('col_cash2', c2.id::text);
  perform pg_temp.rec('3 collections: cash partial + rest, wallet; idempotent; over-collection and missing account refused',
    c1.id = c1b.id and n = 1 and c1.receipt_no like 'IC-%' and e1 = 'amount exceeds remaining' and e2 = 'invalid account'
    and (select status = 'paid' and paid = 300 from public.installments where id = pg_temp.inst(pg_temp.id('plan1'), 1))
    and (select status = 'paid' from public.installments where id = pg_temp.inst(pg_temp.id('plan1'), 2))
    and pg_temp.dd('installments') = 300 and pg_temp.abal(pg_temp.id('w')) = 30300 and pg_temp.debt(pg_temp.id('c1')) = 300,
    e1 || ' / ' || e2 || ' inst_drawer+=' || pg_temp.dd('installments') || ' w=' || pg_temp.abal(pg_temp.id('w')) || ' debt=' || pg_temp.debt(pg_temp.id('c1')));
end $$;

-- 4. cancel a collection: cashier refused, reason needed, manager reverses wallet + debt + status; twice refused;
--    a plan with active collections cannot be cancelled
do $$ declare e1 text := ''; e2 text := ''; e3 text := ''; e4 text := ''; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033c1');
  begin perform public.cancel_installment_collection(pg_temp.id('col_wallet'), 'خطأ'); exception when others then e1 := sqlerrm; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033b1');
  begin perform public.cancel_installment_collection(pg_temp.id('col_wallet'), ' '); exception when others then e2 := sqlerrm; end;
  perform public.cancel_installment_collection(pg_temp.id('col_wallet'), 'التحويل لم يصل');
  begin perform public.cancel_installment_collection(pg_temp.id('col_wallet'), 'مرة ثانية'); exception when others then e3 := sqlerrm; end;
  begin perform public.cancel_installment_plan(pg_temp.id('plan1'), 'x'); exception when others then e4 := sqlerrm; end; reset role;
  perform pg_temp.rec('4 cancel collection restores account, debt and the installment',
    e1 = 'not allowed' and e2 = 'reason required' and e3 = 'collection already cancelled' and e4 = 'plan has collections'
    and pg_temp.abal(pg_temp.id('w')) = 30000 and pg_temp.debt(pg_temp.id('c1')) = 600
    and (select status = 'due' and paid = 0 from public.installments where id = pg_temp.inst(pg_temp.id('plan1'), 2))
    and (select status = 'cancelled' and cancel_reason = 'التحويل لم يصل' from public.installment_collections where id = pg_temp.id('col_wallet')),
    e1 || ' / ' || e2 || ' / ' || e3 || ' / ' || e4 || ' w=' || pg_temp.abal(pg_temp.id('w')) || ' debt=' || pg_temp.debt(pg_temp.id('c1')));
end $$;

-- 5. pay everything: plan becomes done and debt 0; cancelling the last collection reopens the plan
do $$ declare last_col public.installment_collections; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033c1');
  perform public.collect_installment(pg_temp.inst(pg_temp.id('plan1'), 2), 300, 'cash', 'installments', null, gen_random_uuid());
  last_col := public.collect_installment(pg_temp.inst(pg_temp.id('plan1'), 3), 300, 'cash', 'installments', null, gen_random_uuid()); reset role;
  perform pg_temp.rec('5a all paid: plan done, debt 0',
    (select status from public.installment_plans where id = pg_temp.id('plan1')) = 'done' and pg_temp.debt(pg_temp.id('c1')) = 0
    and pg_temp.dd('installments') = 900, 'debt=' || pg_temp.debt(pg_temp.id('c1')));
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033b1');
  perform public.cancel_installment_collection(last_col.id, 'قبض بالغلط'); reset role;
  perform pg_temp.rec('5b cancelling the last collection reopens the plan',
    (select status from public.installment_plans where id = pg_temp.id('plan1')) = 'active'
    and (select status from public.installments where id = pg_temp.inst(pg_temp.id('plan1'), 3)) = 'due'
    and pg_temp.debt(pg_temp.id('c1')) = 300 and pg_temp.dd('installments') = 600, 'debt=' || pg_temp.debt(pg_temp.id('c1')));
end $$;

-- 6. plan from a credit invoice (mode A): the debt is already on the ledger, only the interest is added
do $$ declare inv public.sales_invoices; p public.installment_plans; e1 text := ''; e2 text := ''; e3 text := ''; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033c1');
  inv := public.create_sale_once('00000000-0000-0000-0000-000033f00021', null, null, 0, null,
    jsonb_build_array(jsonb_build_object('variant_id', '00000000-0000-0000-0000-00000000b034', 'qty', 1)),
    '[{"method":"cash","amount":1000},{"method":"credit","amount":4700}]'::jsonb, null, pg_temp.id('c1'));
  p := public.create_installment_plan(null, inv.id, 'أقساط فاتورة', 0, 300, 0, 4, 'week', date '2026-03-01', gen_random_uuid());
  begin perform public.create_installment_plan(null, inv.id, 'مرة ثانية', 0, 0, 0, 2, 'week', date '2026-03-01', gen_random_uuid()); exception when others then e1 := sqlerrm; end;
  begin perform public.create_installment_plan(null, inv.id, 'x', 0, 0, 100, 2, 'week', date '2026-03-01', gen_random_uuid()); exception when others then e2 := sqlerrm; end;
  begin perform public.create_installment_plan(pg_temp.id('c2'), inv.id, 'x', 0, 0, 0, 2, 'week', date '2026-03-01', gen_random_uuid()); exception when others then e3 := sqlerrm; end;
  reset role;
  insert into t_ids values ('plan2', p.id::text);
  perform pg_temp.rec('6 plan from invoice: principal = credit part, interest added to debt, one plan per invoice',
    p.principal = 4700 and p.interest = 300 and p.invoice_id = inv.id
    and (select array_agg(amount order by seq) from public.installments where plan_id = p.id) = array[1250, 1250, 1250, 1250]::numeric[]
    and pg_temp.debt(pg_temp.id('c1')) = 300 + 4700 + 300 and e1 in ('invoice already scheduled', 'rate limit exceeded') and e2 = 'invalid amount' and e3 = 'invoice not eligible',
    e1 || ' / ' || e2 || ' / ' || e3 || ' debt=' || pg_temp.debt(pg_temp.id('c1')) || ' principal=' || p.principal);
end $$;

-- 7. cancel that plan: only the interest line is reversed (the sale debt stays)
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033b1');
  perform public.cancel_installment_plan(pg_temp.id('plan2'), 'العميل غيّر رأيه'); reset role;
  perform pg_temp.rec('7 cancel invoice plan: interest reversed, sale debt stays',
    pg_temp.debt(pg_temp.id('c1')) = 5000 and (select status from public.installment_plans where id = pg_temp.id('plan2')) = 'cancelled',
    'debt=' || pg_temp.debt(pg_temp.id('c1')));
end $$;

-- 8. trade-in, cash (R18): device in stock at 2,000, drawer -2,000, seller id kept apart; cashier limit, bad id, duplicate serial,
--    same key twice, non-serial item
do $$ declare t public.trade_ins; t2 public.trade_ins; e1 text := ''; e2 text := ''; e3 text := ''; e4 text := ''; n int; d public.devices; before_p numeric := pg_temp.dd('products'); begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033c1');
  t := public.create_trade_in('00000000-0000-0000-0000-00000000b033', ' t33-ser-0001 ', 2000, 'cash', null, null, null, 'بائع تجربة', '0101 234-5678', '29001011234567', 'القاهرة', 'خدوش بسيطة', 2500, '00000000-0000-0000-0000-000033f00031');
  t2 := public.create_trade_in('00000000-0000-0000-0000-00000000b033', 'T33-SER-0001', 2000, 'cash', null, null, null, 'بائع تجربة', null, '29001011234567', null, null, null, '00000000-0000-0000-0000-000033f00031');
  begin perform public.create_trade_in('00000000-0000-0000-0000-00000000b033', 'T33-SER-0002', 5000, 'cash', null, null, null, 'بائع', null, '29001011234567', null, null, null, gen_random_uuid()); exception when others then e1 := sqlerrm; end;
  begin perform public.create_trade_in('00000000-0000-0000-0000-00000000b033', 'T33-SER-0003', 1000, 'cash', null, null, null, 'بائع', null, '123', null, null, null, gen_random_uuid()); exception when others then e2 := sqlerrm; end;
  begin perform public.create_trade_in('00000000-0000-0000-0000-00000000b033', 't33-ser-0001', 1000, 'cash', null, null, null, 'بائع', null, '29001011234567', null, null, null, gen_random_uuid()); exception when others then e3 := sqlerrm; end;
  begin perform public.create_trade_in('00000000-0000-0000-0000-00000000b034', 'T33-SER-0004', 1000, 'cash', null, null, null, 'بائع', null, '29001011234567', null, null, null, gen_random_uuid()); exception when others then e4 := sqlerrm; end;
  reset role;
  select count(*) into n from public.trade_ins where idempotency_key = '00000000-0000-0000-0000-000033f00031';
  select * into d from public.devices where id = t.device_id;
  insert into t_ids values ('ti1', t.id::text), ('dev1', t.device_id::text);
  perform pg_temp.rec('8 trade-in cash: device in stock at the price, drawer out, validations, idempotent',
    t.id = t2.id and n = 1 and t.trade_no like 'TI-%' and t.seller_phone = '01012345678' and d.serial = 'T33-SER-0001' and d.status = 'in_stock' and d.cost = 2000
    and d.supplier_id is null and e1 = 'tradein limit exceeded' and e2 = 'invalid national id' and e3 = 'serial already registered' and e4 = 'item is not serial-tracked'
    and pg_temp.dd('products') = before_p - 2000
    and (select cost from public.variant_costs where variant_id = '00000000-0000-0000-0000-00000000b033') = 2000
    and (select count(*) from public.stock_movements where ref_type = 'trade_in' and ref_id = t.id and qty = 1) = 1
    and (select national_id from public.trade_in_sellers where trade_in_id = t.id) = '29001011234567',
    e1 || ' / ' || e2 || ' / ' || e3 || ' / ' || e4 || ' drawer+=' || pg_temp.dd('products'));
end $$;

-- 9. trade-in on credit (R19) reduces the customer's debt; by wallet takes it from the account; a manager may pass the cashier limit
do $$ declare e1 text := ''; ta public.trade_ins; tb public.trade_ins; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033b1');
  begin perform public.create_trade_in('00000000-0000-0000-0000-00000000b033', 'T33-SER-0005', 2500, 'credit', null, null, null, 'بائع', null, '29001011234567', null, null, null, gen_random_uuid()); exception when others then e1 := sqlerrm; end;
  ta := public.create_trade_in('00000000-0000-0000-0000-00000000b033', 'T33-SER-0005', 2500, 'credit', null, null, pg_temp.id('c1'), 'بائع', null, '29001011234567', null, null, null, gen_random_uuid());
  tb := public.create_trade_in('00000000-0000-0000-0000-00000000b033', 'T33-SER-0006', 7000, 'account', null, pg_temp.id('w'), null, 'بائع', null, '29001011234567', null, null, null, gen_random_uuid());
  reset role;
  insert into t_ids values ('ti_credit', ta.id::text), ('ti_acct', tb.id::text);
  perform pg_temp.rec('9 trade-in on credit and by account',
    e1 = 'customer required' and pg_temp.debt(pg_temp.id('c1')) = 5000 - 2500 and pg_temp.abal(pg_temp.id('w')) = 30000 - 7000
    and ta.pay = 'credit' and tb.pay = 'account' and pg_temp.src(pg_temp.id('c1'), 'products') = 4700 - 2500,
    e1 || ' debt=' || pg_temp.debt(pg_temp.id('c1')) || ' w=' || pg_temp.abal(pg_temp.id('w')));
end $$;

-- 10. cancel trade-in (R18): cashier refused, manager needs the owner's PIN token, the owner does not; device leaves stock,
--     money comes back; twice refused; the same phone can be bought again afterwards
do $$ declare e1 text := ''; e2 text := ''; e3 text := ''; tok uuid; ti public.trade_ins; before_p numeric; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033c1');
  begin perform public.cancel_trade_in(pg_temp.id('ti1'), 'خطأ', null); exception when others then e1 := sqlerrm; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033b1');
  begin perform public.cancel_trade_in(pg_temp.id('ti1'), 'خطأ في التسجيل', null); exception when others then e2 := sqlerrm; end; reset role;
  before_p := pg_temp.dd('products');
  tok := pg_temp.token();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033b1');
  perform public.cancel_trade_in(pg_temp.id('ti1'), 'الجهاز مسروق', tok);
  begin perform public.cancel_trade_in(pg_temp.id('ti1'), 'مرة ثانية', null); exception when others then e3 := sqlerrm; end; reset role;
  perform pg_temp.rec('10a cancel by manager with the owner PIN: device out, drawer back',
    e1 = 'not allowed' and e2 = 'override required' and e3 = 'trade-in already cancelled'
    and (select status from public.devices where id = pg_temp.id('dev1')) = 'damaged'
    and pg_temp.dd('products') = before_p + 2000
    and (select status = 'cancelled' and cancel_reason = 'الجهاز مسروق' from public.trade_ins where id = pg_temp.id('ti1')),
    e1 || ' / ' || e2 || ' / ' || e3 || ' drawer+=' || pg_temp.dd('products'));
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033a1');
  perform public.cancel_trade_in(pg_temp.id('ti_credit'), 'تراجع البائع', null); reset role;
  perform pg_temp.rec('10b owner cancels a credit trade-in without a PIN: debt returns',
    pg_temp.debt(pg_temp.id('c1')) = 5000 and pg_temp.src(pg_temp.id('c1'), 'products') = 4700, 'debt=' || pg_temp.debt(pg_temp.id('c1')));
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033c1');
  ti := public.create_trade_in('00000000-0000-0000-0000-00000000b033', 'T33-SER-0001', 1800, 'cash', null, null, null, 'بائع جديد', null, '29001011234567', null, null, null, gen_random_uuid()); reset role;
  perform pg_temp.rec('10c the same device can be bought again after a cancel',
    ti.device_id = pg_temp.id('dev1') and (select status = 'in_stock' and cost = 1800 from public.devices where id = ti.device_id)
    and (select count(*) from public.trade_ins where device_id = ti.device_id and status = 'active') = 1, 'status ok');
end $$;

-- 11. privacy: a cashier sees only own trade-ins and never the seller id; the id is not in the audit log
do $$ declare n_c int; o_c int; s_c int; s_o int; leaked boolean; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033c1');
  select count(*), count(*) filter (where created_by <> '00000000-0000-0000-0000-0000000033c1') into n_c, o_c from public.trade_ins;
  select count(*) into s_c from public.trade_in_sellers; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033b1');
  select count(*) into s_o from public.trade_in_sellers; reset role;
  select exists (select 1 from public.audit_log a where a::text like '%29001011234567%') into leaked;
  perform pg_temp.rec('11 cashier: own trade-ins only, no seller ids; ids not in the audit log',
    n_c = 2 and o_c = 0 and s_c = 0 and s_o >= 4 and not leaked, 'cashier=' || n_c || '/' || o_c || ' sellers cashier=' || s_c || ' manager=' || s_o || ' leaked=' || leaked);
end $$;

-- 12. in / out: manager only; 'in' with a drawer adds cash, 'out' ledger-only moves nothing; balances view; cancel reverses
do $$ declare a public.inout_entries; b public.inout_entries; e1 text := ''; e2 text := ''; e3 text := ''; e4 text := ''; e5 text := ''; nb numeric; base_p numeric := pg_temp.dd('products'); nc int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033c1');
  begin perform public.create_inout(pg_temp.id('c2'), 'in', 100, null, 'x', gen_random_uuid()); exception when others then e1 := sqlerrm; end;
  select count(*) into nc from public.inout_entries; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033b1');
  a := public.create_inout(pg_temp.id('c2'), 'in', 500, 'products', 'أمانة نقدية', '00000000-0000-0000-0000-000033f00041');
  perform public.create_inout(pg_temp.id('c2'), 'in', 500, 'products', 'أمانة نقدية', '00000000-0000-0000-0000-000033f00041');
  b := public.create_inout(pg_temp.id('c2'), 'out', 200, null, 'دفترية', gen_random_uuid());
  begin perform public.create_inout(pg_temp.id('c2'), 'in', 0, null, null, gen_random_uuid()); exception when others then e2 := sqlerrm; end;
  begin perform public.create_inout(pg_temp.id('c2'), 'in', 10, 'nowhere', null, gen_random_uuid()); exception when others then e3 := sqlerrm; end;
  begin perform public.create_inout(pg_temp.id('c2'), 'sideways', 10, null, null, gen_random_uuid()); exception when others then e4 := sqlerrm; end;
  select net into nb from public.inout_balances where customer_id = pg_temp.id('c2'); reset role;
  perform pg_temp.rec('12a in / out: drawer only when asked, balance, validations, cashier refused and blind',
    e1 = 'not allowed' and nc = 0 and e2 = 'invalid amount' and e3 = 'invalid drawers' and e4 = 'invalid direction'
    and pg_temp.dd('products') = base_p + 500 and nb = 300 and a.entry_no like 'IO-%'
    and (select count(*) from public.inout_entries where idempotency_key = '00000000-0000-0000-0000-000033f00041') = 1,
    e1 || ' / ' || e2 || ' / ' || e3 || ' / ' || e4 || ' net=' || coalesce(nb::text, 'null') || ' drawer+=' || (pg_temp.dd('products') - base_p));
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033c1');
  begin perform public.cancel_inout(a.id, 'خطأ'); exception when others then e5 := sqlerrm; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033b1');
  perform public.cancel_inout(a.id, 'اتسجلت بالغلط');
  begin perform public.cancel_inout(a.id, 'مرة ثانية'); exception when others then e1 := sqlerrm; end;
  select net into nb from public.inout_balances where customer_id = pg_temp.id('c2'); reset role;
  perform pg_temp.rec('12b cancel in/out: drawer and balance restored, once',
    e5 = 'not allowed' and e1 = 'entry already cancelled' and pg_temp.dd('products') = base_p and nb = -200, e5 || ' / ' || e1 || ' net=' || coalesce(nb::text, 'null'));
end $$;

-- 13. nothing works without an open shift
do $$ declare e1 text := ''; e2 text := ''; e3 text := ''; e4 text := ''; begin
  update public.cash_sessions set status = 'closed', closed_at = now() where status = 'open';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033c1');
  begin perform public.collect_installment(pg_temp.inst(pg_temp.id('plan1'), 3), 10, 'cash', 'installments', null, gen_random_uuid()); exception when others then e1 := sqlerrm; end;
  begin perform public.create_trade_in('00000000-0000-0000-0000-00000000b033', 'T33-SER-0099', 1000, 'cash', null, null, null, 'بائع', null, '29001011234567', null, null, null, gen_random_uuid()); exception when others then e2 := sqlerrm; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000033b1');
  begin perform public.create_inout(pg_temp.id('c2'), 'in', 10, null, null, gen_random_uuid()); exception when others then e3 := sqlerrm; end;
  begin perform public.create_installment_plan(pg_temp.id('c2'), null, null, 100, 0, 0, 2, 'week', date '2026-05-01', gen_random_uuid()); exception when others then e4 := sqlerrm; end; reset role;
  perform pg_temp.rec('13 open shift required', e1 = 'no open cash session' and e2 = e1 and e3 = e1 and e4 = e1, e1 || ' / ' || e2 || ' / ' || e3 || ' / ' || e4);
end $$;

-- 14. grants: anon cannot run any function or read the views; RLS on every new table
do $$ declare anon_any boolean; rls_all boolean; begin
  select bool_or(has_function_privilege('anon', p.oid, 'execute')) into anon_any from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('create_installment_plan','collect_installment','cancel_installment_collection',
     'cancel_installment_plan','create_inout','cancel_inout','create_trade_in','cancel_trade_in');
  select bool_and(relrowsecurity) into rls_all from pg_class where relnamespace = 'public'::regnamespace
    and relname in ('installment_plans','installments','installment_collections','inout_entries','trade_ins','trade_in_sellers');
  perform pg_temp.rec('14 anon cannot execute, views closed, RLS on', not anon_any and rls_all
    and not has_table_privilege('anon', 'public.installments_due', 'select') and not has_table_privilege('anon', 'public.inout_balances', 'select'),
    'anon=' || anon_any || ' rls=' || rls_all);
end $$;

do $$ declare j text; begin
  select string_agg(test || ' = ' || ok || ' [' || detail || ']', E'\n' order by n) into j from t_results;
  raise exception E'RESULTS (rolled back)\n%', j;
end $$;
