-- Purchasing flow test for 0004. Run in the Supabase SQL Editor AFTER 0001-0004.
-- Fake users + fake data inside ONE transaction that is ROLLED BACK. Expected: every row ok = true.

begin;

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;

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

-- fixtures (as superuser)
insert into public.branches(id, name) values ('00000000-0000-0000-0000-00000000e001','فرع اختبار')
  on conflict do nothing;
insert into public.suppliers(id, name, phone) values ('00000000-0000-0000-0000-00000000f001','مورد اختبار','01000000000');
insert into public.products(id, name) values ('00000000-0000-0000-0000-00000000a001','هاتف اختبار');
insert into public.variants(id, product_id, sku, price) values
 ('00000000-0000-0000-0000-00000000a101','00000000-0000-0000-0000-00000000a001','T-SKU-1', 1000);
insert into public.variant_costs(variant_id, cost) values ('00000000-0000-0000-0000-00000000a101', 0);

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create or replace function pg_temp.rec(t text, ok boolean, d text default '') returns void
language sql as $$ insert into t_results(test, ok, detail) values (t, ok, d); $$;

-- 1. cashier cannot read costs
do $$ declare n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  select count(*) into n from public.variant_costs; reset role;
  perform pg_temp.rec('cashier cannot read variant_costs', n = 0, 'rows='||n);
end $$;

-- 2. cashier cannot read suppliers or purchase orders
do $$ declare n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  select count(*) into n from public.suppliers; reset role;
  perform pg_temp.rec('cashier cannot read suppliers', n = 0, 'rows='||n);
end $$;

-- 3. cashier cannot adjust stock
do $$ declare failed boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin perform public.adjust_stock('00000000-0000-0000-0000-00000000a101','00000000-0000-0000-0000-00000000e001', 5, 'x');
  exception when others then failed := true; end; reset role;
  perform pg_temp.rec('cashier cannot adjust stock', failed);
end $$;

-- 4. cashier cannot write products
do $$ declare failed boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin insert into public.products(name) values ('hack'); exception when others then failed := true; end; reset role;
  perform pg_temp.rec('cashier cannot create product', failed);
end $$;

-- 5. manager creates a draft PO with a line
do $$ declare ok boolean := true; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin
    insert into public.purchase_orders(id, supplier_id, branch_id)
    values ('00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-00000000f001','00000000-0000-0000-0000-00000000e001');
    insert into public.purchase_order_lines(po_id, variant_id, qty_ordered, unit_cost)
    values ('00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-00000000a101', 10, 700);
  exception when others then ok := false; end; reset role;
  perform pg_temp.rec('manager can create draft PO + line', ok);
end $$;

-- 6. manager cannot force a status directly
do $$ declare n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin update public.purchase_orders set status = 'sent' where id = '00000000-0000-0000-0000-00000000b001';
  exception when others then null; end;
  get diagnostics n = row_count; reset role;
  perform pg_temp.rec('manager cannot set status=sent directly',
    (select status from public.purchase_orders where id = '00000000-0000-0000-0000-00000000b001') = 'draft');
end $$;

-- 7. manager submits -> pending_approval, total = 7000
do $$ declare s text; t numeric; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.submit_purchase_order('00000000-0000-0000-0000-00000000b001'); reset role;
  select status::text, total into s, t from public.purchase_orders where id = '00000000-0000-0000-0000-00000000b001';
  perform pg_temp.rec('submit -> pending_approval, total 7000', s = 'pending_approval' and t = 7000, s||' '||t);
end $$;

-- 8. lines are locked after submit
do $$ declare failed boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin update public.purchase_order_lines set qty_ordered = 99 where po_id = '00000000-0000-0000-0000-00000000b001';
  exception when others then failed := true; end; reset role;
  perform pg_temp.rec('lines locked after submit', failed or
    (select qty_ordered from public.purchase_order_lines where po_id = '00000000-0000-0000-0000-00000000b001') = 10);
end $$;

-- 9. manager cannot send before approval
do $$ declare failed boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin perform public.send_purchase_order('00000000-0000-0000-0000-00000000b001');
  exception when others then failed := true; end; reset role;
  perform pg_temp.rec('cannot send before owner approval', failed);
end $$;

-- 10. owner approves -> PO becomes approved
do $$ declare s text; rid uuid; begin
  select approval_id into rid from public.purchase_orders where id = '00000000-0000-0000-0000-00000000b001';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  perform public.decide_approval(rid, 'approved', 'ok'); reset role;
  select status::text into s from public.purchase_orders where id = '00000000-0000-0000-0000-00000000b001';
  perform pg_temp.rec('owner approval moves PO to approved', s = 'approved', s);
end $$;

-- 11. warehouse cannot send; manager sends once
do $$ declare f boolean := false; s text; f2 boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  begin perform public.send_purchase_order('00000000-0000-0000-0000-00000000b001'); exception when others then f := true; end;
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.send_purchase_order('00000000-0000-0000-0000-00000000b001');
  begin perform public.send_purchase_order('00000000-0000-0000-0000-00000000b001'); exception when others then f2 := true; end;
  reset role;
  select status::text into s from public.purchase_orders where id = '00000000-0000-0000-0000-00000000b001';
  perform pg_temp.rec('warehouse cannot send; manager sends exactly once', f and f2 and s = 'sent', s);
end $$;

-- 12. warehouse receives partially: stock +4, status partially_received
do $$ declare s text; q int; lid uuid; begin
  select id into lid from public.purchase_order_lines where po_id = '00000000-0000-0000-0000-00000000b001';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  perform public.receive_purchase_order('00000000-0000-0000-0000-00000000b001',
    jsonb_build_array(jsonb_build_object('line_id', lid, 'qty', 4))); reset role;
  select status::text into s from public.purchase_orders where id = '00000000-0000-0000-0000-00000000b001';
  select coalesce(sum(qty),0) into q from public.stock_movements where variant_id = '00000000-0000-0000-0000-00000000a101';
  perform pg_temp.rec('partial receive adds only received qty', s = 'partially_received' and q = 4, s||' stock='||q);
end $$;

-- 13. cannot receive more than ordered
do $$ declare f boolean := false; lid uuid; begin
  select id into lid from public.purchase_order_lines where po_id = '00000000-0000-0000-0000-00000000b001';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  begin perform public.receive_purchase_order('00000000-0000-0000-0000-00000000b001',
    jsonb_build_array(jsonb_build_object('line_id', lid, 'qty', 7))); exception when others then f := true; end;
  reset role;
  perform pg_temp.rec('cannot over-receive', f);
end $$;

-- 14. receive the rest -> received, stock 10, cost = 700
do $$ declare s text; q int; c numeric; lid uuid; begin
  select id into lid from public.purchase_order_lines where po_id = '00000000-0000-0000-0000-00000000b001';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  perform public.receive_purchase_order('00000000-0000-0000-0000-00000000b001',
    jsonb_build_array(jsonb_build_object('line_id', lid, 'qty', 6))); reset role;
  select status::text into s from public.purchase_orders where id = '00000000-0000-0000-0000-00000000b001';
  select coalesce(sum(qty),0) into q from public.stock_movements where variant_id = '00000000-0000-0000-0000-00000000a101';
  select cost into c from public.variant_costs where variant_id = '00000000-0000-0000-0000-00000000a101';
  perform pg_temp.rec('full receive -> received, stock 10, cost 700', s = 'received' and q = 10 and c = 700, s||' '||q||' '||c);
end $$;

-- 15. stock cannot go negative on adjustment
do $$ declare f boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  begin perform public.adjust_stock('00000000-0000-0000-0000-00000000a101','00000000-0000-0000-0000-00000000e001', -50, 'test');
  exception when others then f := true; end; reset role;
  perform pg_temp.rec('negative stock blocked', f);
end $$;

-- 16. owner-created PO is auto-approved (no one else could approve it)
do $$ declare s text; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  insert into public.purchase_orders(id, supplier_id, branch_id)
  values ('00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-00000000f001','00000000-0000-0000-0000-00000000e001');
  insert into public.purchase_order_lines(po_id, variant_id, qty_ordered, unit_cost)
  values ('00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-00000000a101', 2, 650);
  perform public.submit_purchase_order('00000000-0000-0000-0000-00000000b002'); reset role;
  select status::text into s from public.purchase_orders where id = '00000000-0000-0000-0000-00000000b002';
  perform pg_temp.rec('owner PO is auto-approved', s = 'approved', s);
end $$;

-- 17. rejected PO is editable and can be resubmitted as a new version
do $$ declare rid uuid; s text; v int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  insert into public.purchase_orders(id, supplier_id, branch_id)
  values ('00000000-0000-0000-0000-00000000b003','00000000-0000-0000-0000-00000000f001','00000000-0000-0000-0000-00000000e001');
  insert into public.purchase_order_lines(po_id, variant_id, qty_ordered, unit_cost)
  values ('00000000-0000-0000-0000-00000000b003','00000000-0000-0000-0000-00000000a101', 1, 800);
  perform public.submit_purchase_order('00000000-0000-0000-0000-00000000b003'); reset role;
  select approval_id into rid from public.purchase_orders where id = '00000000-0000-0000-0000-00000000b003';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  perform public.decide_approval(rid, 'rejected', 'too expensive'); reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  update public.purchase_order_lines set unit_cost = 600 where po_id = '00000000-0000-0000-0000-00000000b003';
  perform public.submit_purchase_order('00000000-0000-0000-0000-00000000b003'); reset role;
  select status::text into s from public.purchase_orders where id = '00000000-0000-0000-0000-00000000b003';
  select max(version) into v from public.approval_requests where subject_id = '00000000-0000-0000-0000-00000000b003';
  perform pg_temp.rec('rejected PO can be fixed and resubmitted (v2)', s = 'pending_approval' and v = 2, s||' v'||v);
end $$;

-- 18. every PO status change is in the audit log (timeline source)
do $$ declare n int; begin
  select count(*) into n from public.audit_log
   where entity = 'purchase_orders' and entity_id = '00000000-0000-0000-0000-00000000b001';
  perform pg_temp.rec('PO history recorded in audit_log', n >= 5, 'events='||n);
end $$;

select n, test, ok, detail from (
  select 0 as n, 'SUMMARY: ' || count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' as test,
         coalesce(bool_and(ok), false) as ok, '' as detail from t_results
  union all select n, test, ok, detail from t_results
) x order by n;

rollback;
