-- Device (serial / IMEI) tracking test for 0009. Run in the Supabase SQL Editor AFTER 0001-0009.
-- Fake data in ONE transaction that is ROLLED BACK. Expected: every row ok = true.
-- The first result row is a SUMMARY (passed / failed); the rest are the individual checks.

begin;

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;
create temp table t_ids(k text primary key, v uuid);
grant all on t_ids to public;

insert into auth.users (id, aud, role, email) values
 ('00000000-0000-0000-0000-0000000000a1','authenticated','authenticated','t-owner2@test.invalid'),
 ('00000000-0000-0000-0000-0000000000b1','authenticated','authenticated','t-manager@test.invalid'),
 ('00000000-0000-0000-0000-0000000000c1','authenticated','authenticated','t-cashier@test.invalid'),
 ('00000000-0000-0000-0000-0000000000d1','authenticated','authenticated','t-warehouse@test.invalid');
insert into public.user_roles(user_id, role) values
 ('00000000-0000-0000-0000-0000000000a1','owner'),
 ('00000000-0000-0000-0000-0000000000b1','manager'),
 ('00000000-0000-0000-0000-0000000000c1','cashier'),
 ('00000000-0000-0000-0000-0000000000d1','warehouse');

update public.cash_sessions set status = 'closed', closed_at = now() where status = 'open';

-- fixtures: tracked, published phone (price 1000, warranty 12 months); supplier; a SENT order for 2 units
insert into public.suppliers(id, name, phone) values ('00000000-0000-0000-0000-00000000f001','[اختبار] مورد أجهزة','01000000008');
insert into public.products(id, name, track_serial, is_published) values ('00000000-0000-0000-0000-00000000a001','هاتف تتبع اختبار', true, true);
insert into public.variants(id, product_id, sku, price, warranty_months) values ('00000000-0000-0000-0000-00000000a101','00000000-0000-0000-0000-00000000a001','D-SKU-1', 1000, 12);
insert into public.purchase_orders(id, supplier_id, branch_id, created_by) values
 ('00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-00000000f001',(select id from public.branches where is_active order by created_at limit 1),'00000000-0000-0000-0000-0000000000b1');
insert into public.purchase_order_lines(id, po_id, variant_id, qty_ordered, unit_cost)
values ('00000000-0000-0000-0000-00000000c0a1','00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-00000000a101', 2, 650);
update public.purchase_orders set status = 'sent' where id = '00000000-0000-0000-0000-00000000b001';

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create or replace function pg_temp.rec(t text, ok boolean, d text default '') returns void
language sql as $$ insert into t_results(test, ok, detail) values (t, ok, d); $$;
create or replace function pg_temp.stock() returns int language sql as $$
  select coalesce(sum(qty),0)::int from public.stock_movements where variant_id = '00000000-0000-0000-0000-00000000a101' $$;
create or replace function pg_temp.dstatus(s text) returns text language sql as $$
  select status::text from public.devices where serial = s $$;
create or replace function pg_temp.sale_lines(serials text[]) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('variant_id','00000000-0000-0000-0000-00000000a101','serials', to_jsonb(serials))) $$;
create or replace function pg_temp.pay(a numeric) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('method','cash','amount', a)) $$;

-- 1. manager registers 3 new devices: stock 3, three in_stock devices, cost 600
do $$ declare n int; c numeric; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  n := public.register_devices('00000000-0000-0000-0000-00000000a101', '["imei-aaaaa1","IMEI-AAAAA2"," IMEI-AAAAA3 "]'::jsonb, 600, 'new'); reset role;
  select cost into c from public.variant_costs where variant_id = '00000000-0000-0000-0000-00000000a101';
  perform pg_temp.rec('register 3 devices: stock 3, normalised serials, cost 600',
    n = 3 and pg_temp.stock() = 3 and pg_temp.dstatus('IMEI-AAAAA3') = 'in_stock' and c = 600, 'stock='||pg_temp.stock());
end $$;

-- 2. duplicates and bad serials are refused
do $$ declare f1 boolean := false; f2 boolean := false; f3 boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin perform public.register_devices('00000000-0000-0000-0000-00000000a101', '["IMEI-AAAAA1"]'::jsonb, 600, 'new'); exception when others then f1 := true; end;
  begin perform public.register_devices('00000000-0000-0000-0000-00000000a101', '["AB"]'::jsonb, 600, 'new'); exception when others then f2 := true; end;
  begin perform public.register_devices('00000000-0000-0000-0000-00000000a101', '["IMEI-ZZZZZ1","imei-zzzzz1"]'::jsonb, 600, 'new'); exception when others then f3 := true; end;
  reset role;
  perform pg_temp.rec('duplicate / short / repeated serials refused', f1 and f2 and f3 and pg_temp.stock() = 3);
end $$;

-- 3. linking more devices than untracked stock is refused; manual adjustment of a tracked item is refused
do $$ declare f1 boolean := false; f2 boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin perform public.register_devices('00000000-0000-0000-0000-00000000a101', '["IMEI-EXIST1"]'::jsonb, 600, 'existing'); exception when others then f1 := true; end;
  begin perform public.adjust_stock('00000000-0000-0000-0000-00000000a101', (select id from public.branches where is_active order by created_at limit 1), 1, 'x'); exception when others then f2 := true; end;
  reset role;
  perform pg_temp.rec('no extra devices or manual stock edits on tracked items', f1 and f2);
end $$;

-- 4. sale rules: needs serials, unavailable serial refused, valid serial sells that exact device
do $$ declare f1 boolean := false; f2 boolean := false; inv public.sales_invoices; d public.devices; cost numeric; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform public.open_cash_session(100);
  begin perform public.create_sale(null,null,0,null, '[{"variant_id":"00000000-0000-0000-0000-00000000a101","qty":1}]'::jsonb, pg_temp.pay(1000)); exception when others then f1 := true; end;
  begin perform public.create_sale(null,null,0,null, pg_temp.sale_lines(array['IMEI-NOPE99']), pg_temp.pay(1000)); exception when others then f2 := true; end;
  inv := public.create_sale('عميل','01011111111',0,null, pg_temp.sale_lines(array['imei-aaaaa1']), pg_temp.pay(1000)); reset role;
  insert into t_ids values ('inv', inv.id);
  select * into d from public.devices where serial = 'IMEI-AAAAA1';
  select unit_cost into cost from public.sales_invoice_lines where invoice_id = inv.id;
  perform pg_temp.rec('sale by serial: device sold, warranty set, stock 2, cost 600',
    f1 and f2 and d.status = 'sold' and d.sale_invoice_id = inv.id and d.warranty_until > current_date + 300 and pg_temp.stock() = 2 and cost = 600,
    d.status||' warranty='||d.warranty_until);
end $$;

-- 5. the same device cannot be sold twice; cashier sees only available serials
do $$ declare f boolean := false; n int; has_sold boolean; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin perform public.create_sale(null,null,0,null, pg_temp.sale_lines(array['IMEI-AAAAA1']), pg_temp.pay(1000)); exception when others then f := true; end;
  select count(*), bool_or(serial = 'IMEI-AAAAA1') into n, has_sold from public.available_serials('00000000-0000-0000-0000-00000000a101'); reset role;
  perform pg_temp.rec('device cannot be sold twice; available list excludes it', f and n = 2 and not coalesce(has_sold,false), 'available='||n);
end $$;

-- 6. return rules: a serial from another line/unsold is refused; the right serial goes to inspection, not stock
do $$ declare inv uuid; lid uuid; f boolean := false; r public.sales_returns; begin
  select v into inv from t_ids where k = 'inv';
  select id into lid from public.sales_invoice_lines where invoice_id = inv;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin perform public.create_return(inv, jsonb_build_array(jsonb_build_object('invoice_line_id', lid, 'serials', jsonb_build_array('IMEI-AAAAA2'))), 'x', 'cash'); exception when others then f := true; end;
  r := public.create_return(inv, jsonb_build_array(jsonb_build_object('invoice_line_id', lid, 'serials', jsonb_build_array('IMEI-AAAAA1'))), 'عيب', 'cash'); reset role;
  insert into t_ids values ('ret', r.id);
  perform pg_temp.rec('return by serial: wrong serial refused, device to inspection, stock unchanged',
    f and r.status = 'completed' and pg_temp.dstatus('IMEI-AAAAA1') = 'inspection' and pg_temp.stock() = 2, pg_temp.dstatus('IMEI-AAAAA1'));
end $$;

-- 7. warehouse validates the device: back in stock and sellable again; full history is kept
do $$ declare rl uuid; t jsonb; ev text; begin
  select id into rl from public.sales_return_lines where return_id = (select v from t_ids where k = 'ret');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  perform public.resolve_return_line(rl, 'sellable'); reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  t := public.trace_device('imei-aaaaa1'); reset role;
  select string_agg(e->>'event', ',') into ev from jsonb_array_elements(t->'events') e;
  perform pg_temp.rec('inspection -> sellable: in stock again, trace shows full history',
    pg_temp.dstatus('IMEI-AAAAA1') = 'in_stock' and pg_temp.stock() = 3 and ev = 'registered,sold,returned,inspected_sellable', coalesce(ev, 'no events'));
end $$;

-- 8. trace hides cost/supplier/customer from the cashier, shows them to the manager
do $$ declare c jsonb; m jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  c := public.trace_device('IMEI-AAAAA1'); reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  m := public.trace_device('IMEI-AAAAA1'); reset role;
  perform pg_temp.rec('trace: cashier sees no cost, manager does',
    (c->>'cost') is null and (c->>'item') is not null and (m->>'cost')::numeric = 600, c::text);
end $$;

-- 9. receiving a tracked purchase order needs exactly the right serials
do $$ declare f boolean := false; s text; sup text; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  begin perform public.receive_purchase_order('00000000-0000-0000-0000-00000000b001',
    '[{"line_id":"00000000-0000-0000-0000-00000000c0a1","qty":2,"serials":["IMEI-BBBBB1"]}]'::jsonb); exception when others then f := true; end;
  perform public.receive_purchase_order('00000000-0000-0000-0000-00000000b001',
    '[{"line_id":"00000000-0000-0000-0000-00000000c0a1","qty":2,"serials":["IMEI-BBBBB1","IMEI-BBBBB2"]}]'::jsonb); reset role;
  select status::text into s from public.purchase_orders where id = '00000000-0000-0000-0000-00000000b001';
  select name into sup from public.suppliers where id = (select supplier_id from public.devices where serial = 'IMEI-BBBBB2');
  perform pg_temp.rec('PO receiving: wrong serial count refused; devices linked to supplier and order',
    f and s = 'received' and pg_temp.stock() = 5 and sup like '%مورد أجهزة%' and
    (select po_id from public.devices where serial = 'IMEI-BBBBB1') = '00000000-0000-0000-0000-00000000b001', 'stock='||pg_temp.stock());
end $$;

-- 10. write-off: only manager/owner; device becomes damaged and stock drops
do $$ declare f boolean := false; dev uuid; begin
  select id into dev from public.devices where serial = 'IMEI-AAAAA2';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin perform public.write_off_device(dev, 'x'); exception when others then f := true; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.write_off_device(dev, 'سقط وانكسر'); reset role;
  perform pg_temp.rec('write-off: cashier blocked; device damaged, stock 4', f and pg_temp.dstatus('IMEI-AAAAA2') = 'damaged' and pg_temp.stock() = 4, 'stock='||pg_temp.stock());
end $$;

-- 11. web order delivery of a tracked item needs the serial
do $$ declare r jsonb; oid uuid; f boolean := false; ooid uuid; begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  r := public.place_online_order('عميل ويب','01099999999',null,'pickup',null,
        '[{"variant_id":"00000000-0000-0000-0000-00000000a101","qty":1}]'::jsonb); reset role;
  select id into oid from public.online_orders where order_number = r->>'order_number';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform public.set_online_order_status(oid, 'confirmed');
  perform public.set_online_order_status(oid, 'ready');
  begin perform public.set_online_order_status(oid, 'delivered'); exception when others then f := true; end;
  perform public.set_online_order_status(oid, 'delivered', null, '{"00000000-0000-0000-0000-00000000a101": ["IMEI-BBBBB1"]}'::jsonb); reset role;
  select online_order_id into ooid from public.devices where serial = 'IMEI-BBBBB1';
  perform pg_temp.rec('web delivery: serial required, device linked to the order, stock 3',
    f and ooid = oid and pg_temp.dstatus('IMEI-BBBBB1') = 'sold' and pg_temp.stock() = 3, 'stock='||pg_temp.stock());
end $$;

-- 12. cashier cannot read the devices table or register devices; anon is blocked
do $$ declare n int; f1 boolean := false; f2 boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  select count(*) into n from public.devices;
  begin perform public.register_devices('00000000-0000-0000-0000-00000000a101', '["IMEI-CCCCC1"]'::jsonb, 1, 'new'); exception when others then f1 := true; end; reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform public.trace_device('IMEI-AAAAA1'); exception when others then f2 := true; end; reset role;
  perform pg_temp.rec('cashier blocked from devices table/registration; anon blocked from trace', n = 0 and f1 and f2, 'rows='||n);
end $$;

-- Result: row 0 is the SUMMARY, then every check (failures are easy to spot in the ok column).
select n, test, ok, detail from (
  select 0 as n, 'SUMMARY: ' || count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' as test,
         coalesce(bool_and(ok), false) as ok, '' as detail
    from t_results
  union all
  select n, test, ok, detail from t_results
) x order by n;

rollback;
