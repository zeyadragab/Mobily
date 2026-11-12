-- Run after migrations 0001–0013. All fixtures roll back. Any failed check raises an error.
begin;

insert into public.branches (id, name) values ('13000000-0000-0000-0000-000000000001', 'Maintenance test');
insert into auth.users (id, aud, role, email) values
  ('13000000-0000-0000-0000-000000000010', 'authenticated', 'authenticated', 'mw-cashier@test.invalid'),
  ('13000000-0000-0000-0000-000000000020', 'authenticated', 'authenticated', 'mw-tech@test.invalid'),
  ('13000000-0000-0000-0000-000000000030', 'authenticated', 'authenticated', 'mw-manager@test.invalid');
insert into public.user_roles (user_id, role, branch_id) values
  ('13000000-0000-0000-0000-000000000010', 'cashier', '13000000-0000-0000-0000-000000000001'),
  ('13000000-0000-0000-0000-000000000020', 'technician', '13000000-0000-0000-0000-000000000001'),
  ('13000000-0000-0000-0000-000000000030', 'manager', '13000000-0000-0000-0000-000000000001');
insert into public.repair_parts (id, name, unit_price) values ('13000000-0000-0000-0000-000000000900', 'Test screen', 100);

set local role authenticated;

do $$
declare
  v_branch uuid := '13000000-0000-0000-0000-000000000001';
  v_part uuid := '13000000-0000-0000-0000-000000000900';
  v_order uuid := '13000000-0000-0000-0000-000000000100';
  v_order2 uuid := '13000000-0000-0000-0000-000000000101';
  v_request uuid;
  v_intake jsonb := jsonb_build_object('customer_name', 'MW Customer', 'customer_phone', '01000000001',
    'device_model', 'MW phone', 'serial', 'MW-12345', 'complaint', 'No display', 'intake_condition', 'Cracked',
    'custody_location', 'Intake shelf');
  v_diag jsonb := '{"status":"diagnosing","note":"Start","custody_location":"Intake shelf","technician":"Tech","diagnosis":""}';
  v_quote jsonb := jsonb_build_object('diagnosis', 'Display dead', 'labor_cost', '50',
    'parts', jsonb_build_array(jsonb_build_object('part_id', v_part, 'qty', 2)));
begin
  -- cashier receives
  perform set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-000000000010","role":"authenticated"}', true);
  perform public.receive_repair(v_order, v_branch, v_intake);

  -- technician sees it, starts diagnosing and quotes; stock is empty so a manager request opens
  perform set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-000000000020","role":"authenticated"}', true);
  if not exists (select 1 from public.repair_orders where id = v_order) then raise exception 'technician cannot read order'; end if;
  perform public.update_repair(v_order, 1, v_diag);
  if public.submit_repair_quote(v_order, 2, v_quote) <> 1 then raise exception 'shortage did not open a request'; end if;
  if not exists (select 1 from public.repair_orders where id = v_order and status = 'awaiting_approval'
      and quote_total = 250 and customer_informed_at is null) then raise exception 'quote not stored'; end if;
  begin
    perform public.record_customer_decision(v_order, 3, 'approved', 'x');
    raise exception 'technician recorded customer decision';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if;
  end;

  -- cashier informs, then records approval: parts missing, so the order waits
  perform set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-000000000010","role":"authenticated"}', true);
  perform public.record_customer_decision(v_order, 3, 'informed', 'Called customer');
  perform public.record_customer_decision(v_order, 4, 'approved', 'Customer agreed');
  if not exists (select 1 from public.repair_orders where id = v_order and status = 'awaiting_part' and customer_decision = 'approved')
    then raise exception 'approval with missing parts did not wait for the part'; end if;
  select id into v_request from public.repair_part_requests where order_id = v_order and status = 'pending';
  begin
    perform public.decide_repair_part_request(v_request, 'approved', null);
    raise exception 'cashier decided a part request';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if;
  end;
  begin
    perform public.update_repair(v_order, 5, '{"status":"repairing","note":"Skip","custody_location":"Intake shelf","technician":"Tech"}');
    raise exception 'repair started without parts';
  exception when raise_exception then if sqlerrm <> 'parts not available' then raise; end if;
  end;

  -- manager approves and receives: stock goes in and out, the repair starts
  perform set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-000000000030","role":"authenticated"}', true);
  perform public.decide_repair_part_request(v_request, 'approved', 'ok');
  perform public.receive_repair_part_request(v_request);
  if not exists (select 1 from public.repair_orders where id = v_order and status = 'repairing')
    or not exists (select 1 from public.repair_order_parts where order_id = v_order and consumed_at is not null)
    or coalesce((select on_hand from public.repair_part_levels where part_id = v_part and branch_id = v_branch), 0) <> 0
    then raise exception 'receipt did not start the repair or consume stock'; end if;

  -- the customer approval step cannot be skipped
  perform set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-000000000010","role":"authenticated"}', true);
  perform public.receive_repair(v_order2, v_branch, v_intake || '{"serial":"MW-67890"}');
  perform set_config('request.jwt.claims', '{"sub":"13000000-0000-0000-0000-000000000020","role":"authenticated"}', true);
  perform public.update_repair(v_order2, 1, v_diag);
  perform public.update_repair(v_order2, 2, '{"status":"awaiting_approval","note":"Skip quote","custody_location":"Intake shelf","technician":"Tech"}');
  begin
    perform public.update_repair(v_order2, 3, '{"status":"repairing","note":"Skip","custody_location":"Intake shelf","technician":"Tech"}');
    raise exception 'repair started without customer approval';
  exception when raise_exception then if sqlerrm <> 'customer approval required' then raise; end if;
  end;
end $$;

select 'Maintenance workflow checks passed' as result;
rollback;
