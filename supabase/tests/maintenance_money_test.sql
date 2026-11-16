-- Maintenance completion (0032, rules R15 / R16 / R17): part cost snapshot, profit, delivery on the customer's account,
-- cancel after delivery, customer link at intake, brand list.
-- Run on STAGING after 0001-0032. Everything is rolled back: the last block raises the results as an error on purpose.
-- Expected: every line "= true".

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;
create temp table t_ids(k text primary key, v text);
grant all on t_ids to public;

insert into auth.users (id, aud, role, email) values
 ('00000000-0000-0000-0000-0000000032a1','authenticated','authenticated','t-owner32@test.invalid'),
 ('00000000-0000-0000-0000-0000000032b1','authenticated','authenticated','t-manager32@test.invalid'),
 ('00000000-0000-0000-0000-0000000032c1','authenticated','authenticated','t-cashier32@test.invalid');
insert into public.user_roles(user_id, role) values
 ('00000000-0000-0000-0000-0000000032a1','owner'),
 ('00000000-0000-0000-0000-0000000032b1','manager'),
 ('00000000-0000-0000-0000-0000000032c1','cashier');
insert into public.manager_pins(user_id, pin_hash) values ('00000000-0000-0000-0000-0000000032a1', extensions.crypt('1234', extensions.gen_salt('bf')));
update public.cash_sessions set status = 'closed', closed_at = now() where status = 'open';

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;
create or replace function pg_temp.rec(t text, ok boolean, d text default '') returns void
language sql as $$ insert into t_results(test, ok, detail) values (t, ok, d); $$;
create or replace function pg_temp.id(key text) returns uuid language sql as $$ select v::uuid from t_ids where k = key $$;
create or replace function pg_temp.maint() returns numeric language sql as $$
  select coalesce(sum(m.amount),0) from public.drawer_movements m join public.drawers d on d.id = m.drawer_id
   where d.code = 'maintenance' and d.branch_id = (select id from public.branches where is_active order by created_at limit 1) $$;
create or replace function pg_temp.debt(c uuid) returns numeric language sql as $$
  select coalesce(sum(amount),0) from public.customer_ledger where customer_id = c $$;
create or replace function pg_temp.rev(o uuid) returns int language sql as $$ select revision from public.repair_orders where id = o $$;
create or replace function pg_temp.branch() returns uuid language sql as $$
  select id from public.branches where is_active order by created_at limit 1 $$;
create or replace function pg_temp.token() returns uuid language plpgsql as $$
declare r jsonb;
begin
  -- the token belongs to whoever asks (the manager) and the approver must be someone else (the owner)
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000032b1');
  r := public.request_override('00000000-0000-0000-0000-0000000032a1', '1234', 'إلغاء تسليم');
  reset role;
  return (r->>'token')::uuid;
end $$;

-- setup: part (price 200, cost 120, 5 in stock), customer with a 5,000 limit, shift open,
-- R1 = ready, quote 1,000 (labour 800 + 1 part 200), customer linked; R2 = ready, quote 500, no customer
do $$ declare p uuid; c uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000032a1');
  p := public.save_repair_part(gen_random_uuid(), 'تجربة شاشة 32', 'T32-SCR', 200, true);
  perform public.set_repair_part_cost(p, 120);
  perform public.adjust_repair_part_stock(p, pg_temp.branch(), 5, 'receipt', 'اختبار');
  c := public.save_customer(null, 'تجربة صيانة 32', '01000003201', null, 'regular', 5000, null);
  perform public.open_shift(null, '{}'::jsonb); reset role;
  insert into t_ids values ('part', p::text), ('cust', c::text),
    ('r1', '00000000-0000-0000-0000-00000000f001'), ('r2', '00000000-0000-0000-0000-00000000f002');
  insert into public.repair_orders(id, branch_id, customer_id, customer_name, customer_phone, device_model, serial, complaint, intake_condition,
                                   custody_location, status, labor_cost, parts_cost, quoted_at, customer_decision, received_by)
  values ('00000000-0000-0000-0000-00000000f001', pg_temp.branch(), c, 'تجربة صيانة 32', '01000003201', 'iPhone 13', 'SN-32-AAA', 'شاشة', 'خدوش',
          'الورشة', 'ready', 800, 200, now(), 'approved', '00000000-0000-0000-0000-0000000032b1'),
         ('00000000-0000-0000-0000-00000000f002', pg_temp.branch(), null, 'عميل بلا حساب', '01000003299', 'Galaxy A54', 'SN-32-BBB', 'بطارية', 'سليم',
          'الورشة', 'ready', 500, 0, now(), 'approved', '00000000-0000-0000-0000-0000000032b1');
  insert into public.repair_order_parts(order_id, part_id, qty, unit_price) values ('00000000-0000-0000-0000-00000000f001', p, 1, 200);
  perform pg_temp.rec('0 setup', (select unit_cost from public.repair_order_parts where order_id = pg_temp.id('r1')) = 120
    and (select cost from public.repair_parts where id = p) = 120, 'line cost taken from the part on insert');
end $$;

-- 1. R15: the line keeps the cost of the day; a later cost change does not touch it; profit = quote - parts cost
do $$ declare e text := ''; cashier_cost numeric; owner_cost numeric; prof numeric; real boolean; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000032a1');
  perform public.set_repair_part_cost(pg_temp.id('part'), 150);
  owner_cost := public.repair_order_cost(pg_temp.id('r1'));
  select profit, realized into prof, real from public.repair_profit where order_id = pg_temp.id('r1');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000032c1');
  cashier_cost := public.repair_order_cost(pg_temp.id('r1'));
  begin perform cost from public.repair_parts limit 1; exception when others then e := sqlerrm; end;
  reset role;
  perform pg_temp.rec('1 cost snapshot, profit, cost hidden from the cashier',
    (select unit_cost from public.repair_order_parts where order_id = pg_temp.id('r1')) = 120
    and owner_cost = 120 and prof = 880 and not real and cashier_cost is null and e like 'permission denied%',
    'owner_cost=' || owner_cost || ' profit=' || prof || ' cashier=' || coalesce(cashier_cost::text, 'null') || ' ' || e);
end $$;

-- 2. R16: deposit 300 cash; delivery with a customer and "balance on account": the rest (700) becomes debt, source maintenance
do $$ declare base numeric := pg_temp.maint(); e1 text := ''; ob jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000032c1');
  perform public.record_repair_payment(pg_temp.id('r1'), 300, 'cash', 'deposit', null, gen_random_uuid());
  begin perform public.deliver_repair(pg_temp.id('r1'), pg_temp.rev(pg_temp.id('r1')), 30, null, false);
  exception when others then e1 := sqlerrm; end;
  perform public.deliver_repair(pg_temp.id('r1'), pg_temp.rev(pg_temp.id('r1')), 30, null, true); reset role;
  insert into t_ids values ('base', base::text);
  perform pg_temp.rec('2 delivery on the customer account',
    e1 = 'repair balance due' and pg_temp.maint() = base + 300
    and (select status = 'delivered' and credit_amount = 700 and warranty_days = 30 and delivered_from = 'ready' and warranty_until is not null
           from public.repair_orders where id = pg_temp.id('r1'))
    and pg_temp.debt(pg_temp.id('cust')) = 700
    and (select balance from public.customer_source_balances where customer_id = pg_temp.id('cust') and source = 'maintenance') = 700
    and (select remaining = 0 and on_account = 700 and paid = 300 from public.repair_balances where order_id = pg_temp.id('r1'))
    and (select consumed_at is not null from public.repair_order_parts where order_id = pg_temp.id('r1')),
    e1 || ' drawer+=' || (pg_temp.maint() - base) || ' debt=' || pg_temp.debt(pg_temp.id('cust')));
end $$;

-- 3. what moved to the account cannot be paid again on the repair; the debt is limited by the credit limit (owner passes it)
do $$ declare e text := ''; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000032c1');
  begin perform public.record_repair_payment(pg_temp.id('r1'), 10, 'cash', 'payment', null, gen_random_uuid());
  exception when others then e := sqlerrm; end; reset role;
  perform pg_temp.rec('3 no second payment on an order whose rest is on account', e = 'payment exceeds balance', e);
end $$;

-- 4. delivery with an unpaid rest and no customer: cashier refused; manager needs the flag and a written reason
do $$ declare e1 text := ''; e2 text := ''; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000032c1');
  begin perform public.deliver_repair(pg_temp.id('r2'), pg_temp.rev(pg_temp.id('r2')), 0, null, true);
  exception when others then e1 := sqlerrm; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000032b1');
  begin perform public.deliver_repair(pg_temp.id('r2'), pg_temp.rev(pg_temp.id('r2')), 0, null, true);
  exception when others then e2 := sqlerrm; end;
  perform public.deliver_repair(pg_temp.id('r2'), pg_temp.rev(pg_temp.id('r2')), 0, 'العميل يسدد غدًا', true); reset role;
  perform pg_temp.rec('4 unpaid rest without a customer: manager with a reason only',
    e1 = 'repair balance due' and e2 = 'repair balance due'
    and (select status = 'delivered' and credit_amount = 0 from public.repair_orders where id = pg_temp.id('r2')),
    e1 || ' / ' || e2);
end $$;

-- 5. R17: cancel after delivery. Cashier refused; manager needs a PIN token; reason needed; one token works once
do $$ declare e1 text := ''; e2 text := ''; e3 text := ''; e4 text := ''; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000032c1');
  begin perform public.cancel_delivered_repair(pg_temp.id('r1'), 'خطأ', null); exception when others then e1 := sqlerrm; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000032b1');
  begin perform public.cancel_delivered_repair(pg_temp.id('r1'), 'خطأ في التسليم', null); exception when others then e2 := sqlerrm; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000032a1');
  begin perform public.cancel_delivered_repair(pg_temp.id('r1'), '   ', null); exception when others then e3 := sqlerrm; end;
  begin perform public.cancel_delivered_repair(pg_temp.id('r2'), 'x', null); perform public.cancel_delivered_repair(pg_temp.id('r2'), 'x', null);
  exception when others then e4 := sqlerrm; end; reset role;
  perform pg_temp.rec('5 cancel guards', e1 = 'not allowed' and e2 = 'override required' and e3 = 'reason required' and e4 = 'order not delivered',
    e1 || ' / ' || e2 || ' / ' || e3 || ' / ' || e4);
end $$;

-- 6. owner cancels R1: deposit refunded from the drawer, debt reversed, part back in stock, back to repairing, warranty cleared
do $$ declare base numeric := (select v::numeric from t_ids where k = 'base'); begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000032a1');
  perform public.cancel_delivered_repair(pg_temp.id('r1'), 'تسليم بالخطأ', null); reset role;
  perform pg_temp.rec('6 cancel restores drawer, debt, stock and status',
    pg_temp.maint() = base and pg_temp.debt(pg_temp.id('cust')) = 0
    and (select balance from public.customer_source_balances where customer_id = pg_temp.id('cust') and source = 'maintenance') = 0
    and (select status = 'repairing' and delivered_at is null and credit_amount = 0 and warranty_until is null and warranty_days is null
           from public.repair_orders where id = pg_temp.id('r1'))
    and (select consumed_at is null and unit_cost = 120 from public.repair_order_parts where order_id = pg_temp.id('r1'))
    and public.repair_part_on_hand(pg_temp.id('part'), pg_temp.branch()) = 5
    and (select count(*) from public.repair_payments where order_id = pg_temp.id('r1') and kind = 'refund' and amount = 300) = 1,
    'drawer=' || pg_temp.maint() || ' base=' || base || ' debt=' || pg_temp.debt(pg_temp.id('cust')));
end $$;

-- 7. a manager can cancel with a PIN token (R2 had no money): token is single use
do $$ declare tok uuid; e text := ''; begin
  tok := pg_temp.token();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000032b1');
  perform public.cancel_delivered_repair(pg_temp.id('r2'), 'تسليم بالخطأ', tok);
  begin perform public.cancel_delivered_repair(pg_temp.id('r2'), 'مرة ثانية', tok); exception when others then e := sqlerrm; end; reset role;
  perform pg_temp.rec('7 manager cancel with a PIN token; the token works once',
    (select status = 'repairing' from public.repair_orders where id = pg_temp.id('r2')) and e = 'order not delivered', e);
end $$;

-- 8. link an order to a customer (cashier); refused while a debt sits on it is covered by 2/3; unlink with null
do $$ declare e text := ''; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000032c1');
  perform public.set_repair_customer(pg_temp.id('r2'), pg_temp.id('cust'));
  perform pg_temp.rec('8a link', (select customer_id = pg_temp.id('cust') from public.repair_orders where id = pg_temp.id('r2')));
  perform public.set_repair_customer(pg_temp.id('r2'), null);
  begin perform public.set_repair_customer(pg_temp.id('r2'), gen_random_uuid()); exception when others then e := sqlerrm; end; reset role;
  perform pg_temp.rec('8b unlink; unknown customer refused', (select customer_id is null from public.repair_orders where id = pg_temp.id('r2')) and e = 'customer not found', e);
end $$;

-- 9. intake: customer_id fills name and phone; brand and expected price saved; a matching phone links the customer on its own
do $$ declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); oa public.repair_orders; ob public.repair_orders; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000032c1');
  perform public.receive_repair(a, pg_temp.branch(), jsonb_build_object(
    'customer_id', pg_temp.id('cust'), 'device_model', 'Redmi 12', 'serial', 'SN-32-CCC', 'complaint', 'لا يشحن', 'intake_condition', 'سليم',
    'custody_location', 'الورشة', 'brand', 'Redmi', 'expected_price', '350', 'due_at', to_char(now() at time zone 'Africa/Cairo' + interval '2 days', 'YYYY-MM-DD"T"HH24:MI')));
  perform public.receive_repair(b, pg_temp.branch(), jsonb_build_object(
    'customer_phone', '01000003201', 'customer_name', 'اسم مكتوب', 'device_model', 'Oppo A17', 'serial', 'SN-32-DDD', 'complaint', 'شاشة', 'intake_condition', 'سليم',
    'custody_location', 'الورشة', 'due_at', to_char(now() at time zone 'Africa/Cairo' + interval '2 days', 'YYYY-MM-DD"T"HH24:MI')));
  reset role;
  select * into oa from public.repair_orders where id = a;
  select * into ob from public.repair_orders where id = b;
  perform pg_temp.rec('9 intake with customer, brand, expected price; phone match',
    oa.customer_id = pg_temp.id('cust') and oa.customer_name = 'تجربة صيانة 32' and oa.customer_phone = '01000003201'
    and oa.brand = 'Redmi' and oa.expected_price = 350 and ob.customer_id = pg_temp.id('cust') and ob.customer_name = 'اسم مكتوب',
    coalesce(oa.customer_name, '-') || ' / ' || coalesce(ob.customer_name, '-'));
end $$;

-- 10. brand list: seeded, cashier cannot edit, manager adds, duplicate refused
do $$ declare n int; e1 text := ''; e2 text := ''; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000032c1');
  select count(*) into n from public.repair_brands;
  begin perform public.save_repair_brand(null, 'TestBrand32', null, true); exception when others then e1 := sqlerrm; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000032b1');
  perform public.save_repair_brand(null, 'TestBrand32', 'ماركة تجربة', true);
  begin perform public.save_repair_brand(null, ' testbrand32 ', null, true); exception when others then e2 := sqlerrm; end; reset role;
  perform pg_temp.rec('10 brands', n >= 21 and e1 = 'not allowed' and e2 = 'brand exists', n || ' / ' || e1 || ' / ' || e2);
end $$;

-- 11. grants: anon cannot run the new functions or read the cost view; the cashier sees no part cost in the profit view
do $$ declare anon_any boolean; c_cost numeric; begin
  select bool_or(has_function_privilege('anon', p.oid, 'execute')) into anon_any from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('set_repair_part_cost','repair_part_costs','repair_order_cost',
     'save_repair_brand','set_repair_customer','cancel_delivered_repair','repair_order_parts_cost');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000032c1');
  select parts_cost into c_cost from public.repair_profit where order_id = pg_temp.id('r1'); reset role;
  perform pg_temp.rec('11 grants and cost hidden in the view', not anon_any and c_cost is null
    and not has_table_privilege('anon', 'public.repair_profit', 'select'), 'anon=' || anon_any || ' cashier_cost=' || coalesce(c_cost::text, 'null'));
end $$;

do $$ declare j text; begin
  select string_agg(test || ' = ' || ok || ' [' || detail || ']', E'\n' order by n) into j from t_results;
  raise exception E'RESULTS (rolled back)\n%', j;
end $$;
