-- Run after migrations 0001–0011. All fixtures roll back. Any failed check raises an error.
begin;

insert into public.branches (id, name) values
  ('11000000-0000-0000-0000-000000000001', 'Repair test A'),
  ('11000000-0000-0000-0000-000000000002', 'Repair test B');
insert into auth.users (id, aud, role, email) values
  ('11000000-0000-0000-0000-000000000010', 'authenticated', 'authenticated', 'repair-cashier@test.invalid'),
  ('11000000-0000-0000-0000-000000000020', 'authenticated', 'authenticated', 'repair-accountant@test.invalid'),
  ('11000000-0000-0000-0000-000000000030', 'authenticated', 'authenticated', 'repair-other-branch@test.invalid');
insert into public.user_roles (user_id, role, branch_id) values
  ('11000000-0000-0000-0000-000000000010', 'cashier', '11000000-0000-0000-0000-000000000001'),
  ('11000000-0000-0000-0000-000000000020', 'accountant', '11000000-0000-0000-0000-000000000001'),
  ('11000000-0000-0000-0000-000000000030', 'manager', '11000000-0000-0000-0000-000000000002');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000010","role":"authenticated"}', true);

do $$
declare
  v_order uuid := '11000000-0000-0000-0000-000000000100';
  v_branch uuid := '11000000-0000-0000-0000-000000000001';
  v_other_branch uuid := '11000000-0000-0000-0000-000000000002';
  v_due timestamp := date_trunc('minute', (clock_timestamp() at time zone 'Africa/Cairo') + interval '1 day');
  v_intake jsonb := jsonb_build_object('customer_name', 'Test Customer', 'customer_phone', '01000000000',
    'device_model', 'Test phone', 'serial', ' rep-12345 ', 'imei1', '123456789012345',
    'complaint', 'Screen', 'intake_condition', 'Scratched', 'custody_location', 'Intake shelf', 'due_at', v_due);
  v_update jsonb := '{"status":"cancelled","note":"Customer cancelled","custody_location":"Intake shelf"}';
begin
  perform public.receive_repair(v_order, v_branch, v_intake);
  perform public.receive_repair(v_order, v_branch, v_intake);
  if not exists (select 1 from public.repair_orders where id = v_order and serial = 'REP-12345'
    and due_at = (v_due at time zone 'Africa/Cairo') and due_day = v_due::date
    and search_text like '%RP-%REP-12345%') or (select count(*) from public.repair_events where order_id = v_order) <> 1 then
    raise exception 'intake, normalized serial, Cairo deadline, search or retry failed';
  end if;

  begin
    perform public.receive_repair(gen_random_uuid(), v_branch, (v_intake - 'serial' - 'imei1') || '{"imei2":"123456789012345"}');
    raise exception 'duplicate IMEI accepted';
  exception when raise_exception then if sqlerrm <> 'repair already open' then raise; end if;
  end;
  begin
    perform public.receive_repair(gen_random_uuid(), v_other_branch, v_intake);
    raise exception 'cross-branch intake accepted';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if;
  end;
  begin
    update public.repair_orders set status = 'ready' where id = v_order;
    raise exception 'direct update accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.update_repair(v_order, 1, v_update || '{"status":"delivered"}');
    raise exception 'invalid transition accepted';
  exception when raise_exception then if sqlerrm <> 'invalid repair status transition' then raise; end if;
  end;

  perform public.update_repair(v_order, 1, v_update);
  if not exists (select 1 from public.repair_orders where id = v_order and status = 'cancelled' and delivered_at is null) then
    raise exception 'cancelled device left custody before collection';
  end if;
  begin
    perform public.update_repair(v_order, 1, v_update);
    raise exception 'stale revision accepted';
  exception when raise_exception then if sqlerrm <> 'repair has changed' then raise; end if;
  end;

  perform public.update_repair(v_order, 2, v_update || '{"status":"delivered","custody_location":"Customer","note":"Returned device"}');
  if not exists (select 1 from public.repair_orders where id = v_order and delivered_at is not null and revision = 3)
    or (select count(*) from public.repair_events where order_id = v_order) <> 3 then
    raise exception 'delivery or event log failed';
  end if;
  perform public.receive_repair(gen_random_uuid(), v_branch, v_intake);

  perform set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000020","role":"authenticated"}', true);
  if not exists (select 1 from public.repair_orders where id = v_order) then raise exception 'accountant cannot read'; end if;
  begin
    perform public.update_repair(v_order, 3, v_update);
    raise exception 'accountant can write';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if;
  end;

  perform set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000030","role":"authenticated"}', true);
  if exists (select 1 from public.repair_orders where id = v_order)
    or exists (select 1 from public.repair_events where order_id = v_order) then raise exception 'cross-branch data leak'; end if;
end $$;

select 'Repair intake checks passed' as result;
rollback;
