-- Customers, credit sales, debt ledger, sale idempotency and held baskets (0020-0022).
-- Run on STAGING after 0001-0022. Fake data in ONE transaction that is ROLLED BACK. Expected: every row ok = true.
-- Numbers follow docs/volt-test-vectors.md: profit 700, paid 1,000 of 5,700 -> 122.81 collected / 577.19 on credit.

begin;

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;
create temp table t_ids(k text primary key, v text);
grant all on t_ids to public;

insert into auth.users (id, aud, role, email) values
 ('00000000-0000-0000-0000-0000000000a7','authenticated','authenticated','t-owner7@test.invalid'),
 ('00000000-0000-0000-0000-0000000000b7','authenticated','authenticated','t-manager7@test.invalid'),
 ('00000000-0000-0000-0000-0000000000c7','authenticated','authenticated','t-cashier7@test.invalid');
insert into public.user_roles(user_id, role) values
 ('00000000-0000-0000-0000-0000000000a7','owner'),
 ('00000000-0000-0000-0000-0000000000b7','manager'),
 ('00000000-0000-0000-0000-0000000000c7','cashier');

update public.cash_sessions set status = 'closed', closed_at = now() where status = 'open';
insert into public.products(id, name) values ('00000000-0000-0000-0000-00000000a007','هاتف اختبار آجل');
insert into public.variants(id, product_id, sku, price) values
 ('00000000-0000-0000-0000-00000000a107','00000000-0000-0000-0000-00000000a007','CRD-SKU-1', 5700);
insert into public.variant_costs(variant_id, cost) values ('00000000-0000-0000-0000-00000000a107', 5000);
insert into public.stock_movements(variant_id, branch_id, movement_type, qty)
values ('00000000-0000-0000-0000-00000000a107',
        (select id from public.branches where is_active order by created_at limit 1), 'adjustment', 20);

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
create or replace function pg_temp.debt(c uuid) returns numeric language sql as $$
  select coalesce(sum(amount),0) from public.customer_ledger where customer_id = c $$;
create or replace function pg_temp.items(q int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('variant_id','00000000-0000-0000-0000-00000000a107','qty',q)) $$;
create or replace function pg_temp.cid() returns uuid language sql as $$ select v::uuid from t_ids where k = 'cust' $$;

-- 1. a cashier adds a customer; the credit limit they typed is ignored (stays 0)
do $$ declare c uuid; lim numeric; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
  c := public.save_customer(null, 'عميل تجربة آجل', '0100 000 0071', null, 'regular', 9000, null); reset role;
  insert into t_ids values ('cust', c::text);
  select credit_limit into lim from public.customers where id = c;
  perform pg_temp.rec('cashier adds customer, cannot set credit limit', lim = 0, lim::text);
end $$;

-- 2. the same phone twice is refused
do $$ declare f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
  begin perform public.save_customer(null, 'مكرر', '01000000071', null, 'regular', 0, null); exception when others then f := true; end; reset role;
  perform pg_temp.rec('duplicate phone refused', f);
end $$;

-- 3. identity details: cashier cannot write or read; manager can; a wrong national id is refused
do $$ declare f1 boolean := false; f2 boolean := false; n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
  begin perform public.save_customer_kyc(pg_temp.cid(), '29001010100011', 'القاهرة', null, null, null); exception when others then f1 := true; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
  begin perform public.save_customer_kyc(pg_temp.cid(), '123', null, null, null, null); exception when others then f2 := true; end;
  perform public.save_customer_kyc(pg_temp.cid(), '29001010100011', 'القاهرة', 'ضامن تجربة', '01000000072', null); reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
  select count(*) into n from public.customer_kyc; reset role;
  perform pg_temp.rec('identity details: manager only, validated, hidden from cashier', f1 and f2 and n = 0, 'cashier sees ' || n);
end $$;

-- 4. manager sets a credit limit of 6,000
do $$ declare lim numeric; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
  perform public.save_customer(pg_temp.cid(), 'عميل تجربة آجل', '01000000071', null, 'vip', 6000, null); reset role;
  select credit_limit into lim from public.customers where id = pg_temp.cid();
  perform pg_temp.rec('manager sets credit limit', lim = 6000, lim::text);
end $$;

-- 5. a credit sale without a registered customer is refused
do $$ declare f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
  perform public.open_shift(null, '{"products":100}'::jsonb);
  begin perform public.create_sale_once(gen_random_uuid(), 'بدون تسجيل', null, 0, null, pg_temp.items(1),
    '[{"method":"credit","amount":5700}]'::jsonb); exception when others then f := true; end; reset role;
  perform pg_temp.rec('credit sale needs a registered customer', f);
end $$;

-- 6. 5,700 sale: 1,000 cash + 4,700 on credit
do $$ declare inv public.sales_invoices; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
  inv := public.create_sale_once('00000000-0000-0000-0000-00000000e001', null, null, 0, null, pg_temp.items(1),
    '[{"method":"cash","amount":1000},{"method":"credit","amount":4700}]'::jsonb, null, pg_temp.cid()); reset role;
  insert into t_ids values ('inv', inv.id::text);
  perform pg_temp.rec('credit sale: debt 4,700, drawer +1,000, customer on invoice',
    pg_temp.debt(pg_temp.cid()) = 4700 and pg_temp.bal('products') = 1100 and inv.customer_id = pg_temp.cid() and inv.customer_name is not null,
    'debt=' || pg_temp.debt(pg_temp.cid()) || ' drawer=' || pg_temp.bal('products'));
end $$;

-- 7. the same key again returns the same invoice and sells nothing new
do $$ declare inv public.sales_invoices; n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
  inv := public.create_sale_once('00000000-0000-0000-0000-00000000e001', null, null, 0, null, pg_temp.items(1),
    '[{"method":"cash","amount":1000},{"method":"credit","amount":4700}]'::jsonb, null, pg_temp.cid()); reset role;
  select count(*) into n from public.sales_invoices where customer_id = pg_temp.cid();
  perform pg_temp.rec('double click: one invoice only',
    inv.id::text = (select v from t_ids where k = 'inv') and n = 1 and pg_temp.debt(pg_temp.cid()) = 4700, 'invoices=' || n);
end $$;

-- 8. profit 700 split by the paid share: 122.81 collected, 577.19 waiting
do $$ declare r record; begin
  select * into r from public.sale_profit_split where invoice_id = (select v::uuid from t_ids where k = 'inv');
  perform pg_temp.rec('profit split cash / credit', r.profit = 700 and r.cash_profit = 122.81 and r.deferred_profit = 577.19,
    r.profit || ' / ' || r.cash_profit || ' / ' || r.deferred_profit);
end $$;

-- 9. passing the credit limit is refused for a cashier (4,700 + 5,700 > 6,000)
do $$ declare f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
  begin perform public.create_sale_once(gen_random_uuid(), null, null, 0, null, pg_temp.items(1),
    '[{"method":"credit","amount":5700}]'::jsonb, null, pg_temp.cid()); exception when others then f := true; end; reset role;
  perform pg_temp.rec('credit limit enforced', f and pg_temp.debt(pg_temp.cid()) = 4700);
end $$;

-- 10. collect 1,000 in cash: debt 3,700, drawer +1,000; repeat click changes nothing; overpaying is refused
do $$ declare a bigint; b bigint; f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
  a := public.collect_customer_debt(pg_temp.cid(), 1000, 'cash', null, '00000000-0000-0000-0000-00000000e002');
  b := public.collect_customer_debt(pg_temp.cid(), 1000, 'cash', null, '00000000-0000-0000-0000-00000000e002');
  begin perform public.collect_customer_debt(pg_temp.cid(), 3700.01, 'cash', null, gen_random_uuid()); exception when others then f := true; end; reset role;
  insert into t_ids values ('pay', a::text);
  perform pg_temp.rec('collection: idempotent, drawer updated, overpay refused',
    a = b and f and pg_temp.debt(pg_temp.cid()) = 3700 and pg_temp.bal('products') = 2100,
    'debt=' || pg_temp.debt(pg_temp.cid()) || ' drawer=' || pg_temp.bal('products'));
end $$;

-- 11. reversal: cashier refused; manager reverses once (debt back to 4,700, drawer -1,000); twice refused
do $$ declare f1 boolean := false; f2 boolean := false; p bigint := (select v::bigint from t_ids where k = 'pay'); begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
  begin perform public.reverse_customer_entry(p, 'خطأ'); exception when others then f1 := true; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
  perform public.reverse_customer_entry(p, 'تحصيل مسجل بالخطأ');
  begin perform public.reverse_customer_entry(p, 'مرة ثانية'); exception when others then f2 := true; end; reset role;
  perform pg_temp.rec('reversal: manager only, once, money returns',
    f1 and f2 and pg_temp.debt(pg_temp.cid()) = 4700 and pg_temp.bal('products') = 1100,
    'debt=' || pg_temp.debt(pg_temp.cid()) || ' drawer=' || pg_temp.bal('products'));
end $$;

-- 12. manual debt: cashier refused; manager needs a reason
do $$ declare f1 boolean := false; f2 boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
  begin perform public.add_customer_debt(pg_temp.cid(), 300, 'رصيد افتتاحي', gen_random_uuid()); exception when others then f1 := true; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
  begin perform public.add_customer_debt(pg_temp.cid(), 300, ' ', gen_random_uuid()); exception when others then f2 := true; end;
  perform public.add_customer_debt(pg_temp.cid(), 300, 'رصيد افتتاحي', gen_random_uuid()); reset role;
  perform pg_temp.rec('manual debt: manager with a reason', f1 and f2 and pg_temp.debt(pg_temp.cid()) = 5000, pg_temp.debt(pg_temp.cid())::text);
end $$;

-- 13. the ledger cannot be edited or deleted, even by the database owner role used here
do $$ declare f1 boolean := false; f2 boolean := false; begin
  begin update public.customer_ledger set amount = 1 where customer_id = pg_temp.cid(); exception when others then f1 := true; end;
  begin delete from public.customer_ledger where customer_id = pg_temp.cid(); exception when others then f2 := true; end;
  perform pg_temp.rec('ledger is append-only', f1 and f2);
end $$;

-- 14. held basket: parked, then removed when the sale is saved
do $$ declare h uuid; n1 int; n2 int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
  h := public.hold_basket('عميل راجع', null, null, 0, null, pg_temp.items(1));
  select count(*) into n1 from public.held_baskets where id = h;
  perform public.create_sale_once(gen_random_uuid(), null, null, 0, null, pg_temp.items(1),
    '[{"method":"cash","amount":5700}]'::jsonb, h);
  select count(*) into n2 from public.held_baskets where id = h; reset role;
  perform pg_temp.rec('held basket removed by the sale', n1 = 1 and n2 = 0, n1 || ' -> ' || n2);
end $$;

select n, test, ok, detail from t_results order by n;
rollback;
