-- Repair money / delivery / warranty test for 0018. Run in the Supabase SQL Editor AFTER 0001-0018, on STAGING.
-- Fake data in ONE transaction that is ROLLED BACK. Expected: every row ok = true.

begin;

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;

insert into auth.users (id, aud, role, email) values
 ('00000000-0000-0000-0000-0000000000a1','authenticated','authenticated','t-owner5@test.invalid'),
 ('00000000-0000-0000-0000-0000000000b1','authenticated','authenticated','t-manager5@test.invalid'),
 ('00000000-0000-0000-0000-0000000000c1','authenticated','authenticated','t-cashier5@test.invalid'),
 ('00000000-0000-0000-0000-0000000000d1','authenticated','authenticated','t-tech5@test.invalid');
insert into public.user_roles(user_id, role) values
 ('00000000-0000-0000-0000-0000000000a1','owner'),
 ('00000000-0000-0000-0000-0000000000b1','manager'),
 ('00000000-0000-0000-0000-0000000000c1','cashier'),
 ('00000000-0000-0000-0000-0000000000d1','technician');

update public.cash_sessions set status = 'closed', closed_at = now() where status = 'open';

-- two ready repairs: R1 quote 1000 (800 labor + 200 parts), R2 quote 500
insert into public.repair_orders(id, branch_id, customer_name, customer_phone, device_model, serial, complaint, intake_condition,
                                 custody_location, status, labor_cost, parts_cost, quoted_at, customer_decision, received_by)
select '00000000-0000-0000-0000-00000000e001', (select id from public.branches where is_active order by created_at limit 1),
       'عميل اختبار', '01012345678', 'iPhone 13', 'SN-12345-X', 'شاشة مكسورة', 'خدوش', 'الورشة', 'ready',
       800, 200, now(), 'approved', '00000000-0000-0000-0000-0000000000b1';
insert into public.repair_orders(id, branch_id, customer_name, customer_phone, device_model, serial, complaint, intake_condition,
                                 custody_location, status, labor_cost, parts_cost, quoted_at, customer_decision, received_by)
select '00000000-0000-0000-0000-00000000e002', (select id from public.branches where is_active order by created_at limit 1),
       'عميل ثاني', '01099999999', 'Galaxy A54', 'SN-77777-Y', 'بطارية', 'سليم', 'الورشة', 'ready',
       500, 0, now(), 'approved', '00000000-0000-0000-0000-0000000000b1';

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
create or replace function pg_temp.rev(o uuid) returns int language sql as $$ select revision from public.repair_orders where id = o $$;

create temp table t_base(k text primary key, v numeric);
grant all on t_base to public;
insert into t_base values ('maint', pg_temp.bal('maintenance'));

-- 1. cashier opens a shift (no counts)
do $$ declare s public.cash_sessions; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  s := public.open_shift(null, '{}'::jsonb); reset role;
  perform pg_temp.rec('shift opened', s.status = 'open');
end $$;

-- 2. a priced, unpaid repair cannot be delivered (function) ...
do $$ declare f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin perform public.deliver_repair('00000000-0000-0000-0000-00000000e001', pg_temp.rev('00000000-0000-0000-0000-00000000e001'), 30, 'تسليم');
  exception when others then f := sqlerrm like '%repair balance due%'; end; reset role;
  perform pg_temp.rec('deliver_repair refused while a balance is due', f);
end $$;

-- 3. ... nor through the old update_repair back door
do $$ declare f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  begin perform public.update_repair('00000000-0000-0000-0000-00000000e001', pg_temp.rev('00000000-0000-0000-0000-00000000e001'),
        '{"status":"delivered","custody_location":"العميل","note":"محاولة تسليم"}'::jsonb);
  exception when others then f := sqlerrm like '%repair balance due%'; end; reset role;
  perform pg_temp.rec('update_repair cannot mark an unpaid priced repair delivered', f);
end $$;

-- 4. cash deposit goes to the maintenance drawer
do $$ declare id1 uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  id1 := public.record_repair_payment('00000000-0000-0000-0000-00000000e001', 400, 'cash', 'deposit', null, '00000000-0000-0000-0000-00000000f101'); reset role;
  perform pg_temp.rec('cash deposit lands in the maintenance drawer',
    id1 is not null and pg_temp.bal('maintenance') - (select v from t_base where k = 'maint') = 400,
    'maint delta=' || (pg_temp.bal('maintenance') - (select v from t_base where k = 'maint')));
end $$;

-- 5. repeat key = same payment, no double money; overpay refused
do $$ declare a uuid; b uuid; f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  a := public.record_repair_payment('00000000-0000-0000-0000-00000000e001', 400, 'cash', 'deposit', null, '00000000-0000-0000-0000-00000000f101');
  begin perform public.record_repair_payment('00000000-0000-0000-0000-00000000e001', 700, 'card', 'payment', null, gen_random_uuid());
  exception when others then f := sqlerrm like '%payment exceeds balance%'; end; reset role;
  perform pg_temp.rec('repeat key moves money once; paying more than the balance refused',
    f and pg_temp.bal('maintenance') - (select v from t_base where k = 'maint') = 400);
end $$;

-- 6. a card payment does not touch the drawer; balance reaches zero
do $$ declare r record; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform public.record_repair_payment('00000000-0000-0000-0000-00000000e001', 600, 'card', 'payment', null, gen_random_uuid());
  select * into r from public.repair_balances where order_id = '00000000-0000-0000-0000-00000000e001'; reset role;
  perform pg_temp.rec('card payment: drawer unchanged, remaining 0',
    r.paid = 1000 and r.remaining = 0 and pg_temp.bal('maintenance') - (select v from t_base where k = 'maint') = 400,
    'paid=' || r.paid || ' remaining=' || r.remaining);
end $$;

-- 7. technician cannot take money or read payments
do $$ declare f boolean := false; n int := 0; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  begin perform public.record_repair_payment('00000000-0000-0000-0000-00000000e002', 100, 'card', 'payment', null, gen_random_uuid());
  exception when others then f := true; end;
  select count(*) into n from public.repair_payments; reset role;
  perform pg_temp.rec('technician cannot record or read payments', f and n = 0);
end $$;

-- 8. delivery once paid, with a 30 day warranty
do $$ declare o public.repair_orders; f boolean := false; ev text; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform public.deliver_repair('00000000-0000-0000-0000-00000000e001', pg_temp.rev('00000000-0000-0000-0000-00000000e001'), 30, 'استلم العميل الجهاز');
  begin perform public.deliver_repair('00000000-0000-0000-0000-00000000e001', pg_temp.rev('00000000-0000-0000-0000-00000000e001'), 30, 'مرة تانية');
  exception when others then f := true; end; reset role;
  select * into o from public.repair_orders where id = '00000000-0000-0000-0000-00000000e001';
  select note into ev from public.repair_events where order_id = o.id order by id desc limit 1;
  perform pg_temp.rec('paid repair is delivered with warranty; second delivery refused',
    o.status = 'delivered' and o.delivered_at is not null and o.warranty_days = 30
      and o.warranty_until = (now() at time zone 'Africa/Cairo')::date + 30 and f and ev like '%ضمان 30%',
    coalesce(ev, 'no event'));
end $$;

-- 9. warranty lookup by serial, expiry, unknown, too short
do $$ declare a record; b record; n int; f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  select * into a from public.check_repair_warranty('sn-12345-x');
  reset role;
  update public.repair_orders set warranty_until = (now() at time zone 'Africa/Cairo')::date - 1 where id = '00000000-0000-0000-0000-00000000e001';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  select * into b from public.check_repair_warranty('RP-' || (select order_number from public.repair_orders where id = '00000000-0000-0000-0000-00000000e001')::text);
  select count(*) into n from public.check_repair_warranty('NOT-A-REAL-SERIAL');
  begin perform public.check_repair_warranty('ab'); exception when others then f := true; end; reset role;
  perform pg_temp.rec('warranty lookup: valid by serial, expired by RP number, unknown empty, short refused',
    a.is_valid and a.days_left = 30 and b.is_valid = false and b.days_left = 0 and n = 0 and f);
end $$;

-- 10. refunds: cashier refused, reason required, cannot exceed paid, manager refunds cash from the drawer
do $$ declare c boolean := false; r boolean := false; x boolean := false; id1 uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin perform public.record_repair_payment('00000000-0000-0000-0000-00000000e001', 50, 'cash', 'refund', 'خطأ', gen_random_uuid()); exception when others then c := true; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin perform public.record_repair_payment('00000000-0000-0000-0000-00000000e001', 50, 'cash', 'refund', '  ', gen_random_uuid()); exception when others then r := true; end;
  begin perform public.record_repair_payment('00000000-0000-0000-0000-00000000e001', 5000, 'cash', 'refund', 'كبير', gen_random_uuid()); exception when others then x := sqlerrm like '%refund exceeds paid%'; end;
  id1 := public.record_repair_payment('00000000-0000-0000-0000-00000000e001', 100, 'cash', 'refund', 'خصم اتفاق', gen_random_uuid()); reset role;
  perform pg_temp.rec('refund: cashier refused, reason required, capped at paid, manager refunds from drawer',
    c and r and x and id1 is not null and pg_temp.bal('maintenance') - (select v from t_base where k = 'maint') = 300,
    'maint delta=' || (pg_temp.bal('maintenance') - (select v from t_base where k = 'maint')));
end $$;

-- 11. delivering with a balance: cashier cannot; owner can with a written reason
do $$ declare c boolean := false; o public.repair_orders; ev text; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin perform public.deliver_repair('00000000-0000-0000-0000-00000000e002', pg_temp.rev('00000000-0000-0000-0000-00000000e002'), 0, 'عميل دائم', true); exception when others then c := true; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  perform public.deliver_repair('00000000-0000-0000-0000-00000000e002', pg_temp.rev('00000000-0000-0000-0000-00000000e002'), 0, 'عميل دائم يدفع الأسبوع القادم', true); reset role;
  select * into o from public.repair_orders where id = '00000000-0000-0000-0000-00000000e002';
  select note into ev from public.repair_events where order_id = o.id order by id desc limit 1;
  perform pg_temp.rec('delivery with balance: cashier refused, owner allowed and it is written in the log',
    c and o.status = 'delivered' and ev like '%تسليم بمتبقي 500%', coalesce(ev, 'no event'));
end $$;

-- 12. templates: cashier cannot save; manager can; technician can read; duplicate name refused
do $$ declare c boolean := false; d boolean := false; n int := 0; tid uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin perform public.save_repair_template(null, 'تغيير شاشة', 350, 30, null, true); exception when others then c := true; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  tid := public.save_repair_template(null, 'تغيير شاشة', 350, 30, 'شاشة أصلية', true);
  begin perform public.save_repair_template(null, ' تغيير شاشة ', 100, 0, null, true); exception when others then d := true; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  select count(*) into n from public.repair_templates; reset role;
  perform pg_temp.rec('templates: cashier refused, manager saves, duplicate refused, technician reads', c and d and tid is not null and n = 1);
end $$;

-- 13. append-only payments; anon blocked
do $$ declare f1 boolean := false; f2 boolean := false; f3 boolean := false; begin
  begin update public.repair_payments set amount = 1 where true; exception when others then f1 := true; end;
  set local role anon;
  begin perform public.record_repair_payment('00000000-0000-0000-0000-00000000e001', 1, 'cash', 'payment', null, gen_random_uuid()); exception when others then f2 := true; end;
  begin perform public.check_repair_warranty('SN-12345-X'); exception when others then f3 := true; end;
  reset role;
  perform pg_temp.rec('payments append-only; anon blocked from payments and warranty lookup', f1 and f2 and f3);
end $$;

select n, test, ok, detail from (
  select 0 as n, 'SUMMARY: ' || count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' as test,
         coalesce(bool_and(ok), false) as ok, '' as detail from t_results
  union all select n, test, ok, detail from t_results
) x order by n;

rollback;
