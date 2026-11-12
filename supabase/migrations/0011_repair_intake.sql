create type public.repair_status as enum (
  'received', 'diagnosing', 'awaiting_approval', 'awaiting_part', 'repairing',
  'testing', 'ready', 'cancelled', 'unrepairable', 'delivered'
);

create table public.repair_orders (
  id uuid primary key,
  order_number bigint generated always as identity unique,
  branch_id uuid not null references public.branches(id),
  device_id uuid references public.devices(id),
  customer_name text not null check (char_length(customer_name) between 1 and 120),
  customer_phone text not null check (customer_phone ~ '^\+?[0-9]{7,15}$'),
  device_model text not null check (char_length(device_model) between 1 and 120),
  serial text check (char_length(serial) between 5 and 40),
  imei1 text check (imei1 ~ '^[0-9]{15}$'),
  imei2 text check (imei2 ~ '^[0-9]{15}$' and imei2 is distinct from imei1),
  missing_identifier_reason text check (char_length(missing_identifier_reason) between 1 and 250),
  identifiers text[] generated always as (array_remove(array[serial, imei1, imei2], null)) stored,
  search_text text generated always as (
    'RP-' || order_number::text || ' ' || customer_name || ' ' || customer_phone || ' ' || device_model || ' '
    || coalesce(serial, '') || ' ' || coalesce(imei1, '') || ' ' || coalesce(imei2, '')
  ) stored,
  complaint text not null check (char_length(complaint) between 1 and 1500),
  intake_condition text not null check (char_length(intake_condition) between 1 and 1500),
  accessories text check (char_length(accessories) <= 500),
  diagnosis text check (char_length(diagnosis) <= 1500),
  technician text check (char_length(technician) <= 120),
  custody_location text not null check (char_length(custody_location) between 1 and 200),
  status public.repair_status not null default 'received',
  due_at timestamptz,
  due_day date generated always as ((due_at at time zone 'Africa/Cairo')::date) stored,
  received_at timestamptz not null default clock_timestamp(),
  received_by uuid not null references public.profiles(id),
  delivered_at timestamptz,
  revision integer not null default 1,
  check (serial is not null or imei1 is not null or imei2 is not null or missing_identifier_reason is not null),
  check ((status = 'delivered') = (delivered_at is not null))
);

create index repair_orders_branch_number_idx on public.repair_orders (branch_id, order_number desc);
create index repair_orders_open_identifiers_idx on public.repair_orders using gin (identifiers) where delivered_at is null;

create table public.repair_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.repair_orders(id),
  status public.repair_status not null,
  due_at timestamptz,
  custody_location text not null,
  technician text,
  diagnosis text,
  note text check (char_length(note) <= 1000),
  actor_id uuid not null references public.profiles(id),
  actor_name text not null,
  occurred_at timestamptz not null default clock_timestamp()
);
create index repair_events_order_idx on public.repair_events (order_id, id desc);

create function public.can_access_repairs(p_branch uuid, p_write boolean)
returns boolean language sql stable security invoker set search_path = public as $$
  select public.has_role_in_branch('owner', p_branch)
      or public.has_role_in_branch('manager', p_branch)
      or public.has_role_in_branch('cashier', p_branch)
      or (not p_write and public.has_role_in_branch('accountant', p_branch));
$$;

alter table public.repair_orders enable row level security;
alter table public.repair_events enable row level security;
revoke all on public.repair_orders, public.repair_events from public, anon, authenticated;
grant select on public.repair_orders, public.repair_events to authenticated;

create policy repair_orders_read on public.repair_orders for select to authenticated
  using (public.can_access_repairs(branch_id, false));
create policy repair_events_read on public.repair_events for select to authenticated
  using (exists (select 1 from public.repair_orders r where r.id = order_id));

create trigger audit_repair_orders after insert or update on public.repair_orders
  for each row execute function public.audit_row(
    'customer_name', 'customer_phone', 'serial', 'imei1', 'imei2', 'identifiers', 'search_text',
    'complaint', 'intake_condition', 'accessories', 'diagnosis', 'missing_identifier_reason', 'custody_location'
  );

create function public.repair_branches()
returns table(id uuid, name text, can_receive boolean, can_update boolean)
language sql stable security invoker set search_path = public as $$
  select b.id, b.name, b.is_active and public.can_access_repairs(b.id, true), public.can_access_repairs(b.id, true)
  from public.branches b where public.can_access_repairs(b.id, false) order by b.name;
$$;

create function public.receive_repair(p_id uuid, p_branch uuid, p_intake jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_serial text := nullif(public.norm_serial(p_intake->>'serial'), '');
  v_imei1 text := nullif(trim(p_intake->>'imei1'), '');
  v_imei2 text := nullif(trim(p_intake->>'imei2'), '');
  v_identifiers text[] := array_remove(array[v_serial, v_imei1, v_imei2], null);
  v_identifier text;
  v_order public.repair_orders;
  v_device uuid;
  v_actor text;
begin
  if not public.can_access_repairs(p_branch, true) or not exists (
    select 1 from public.branches where id = p_branch and is_active
  ) then raise exception 'not allowed'; end if;

  perform pg_advisory_xact_lock(hashtextextended('repair-intake:' || p_id::text, 0));
  if exists (select 1 from public.repair_orders where id = p_id and branch_id = p_branch and received_by = auth.uid()) then
    return p_id;
  end if;
  for v_identifier in select distinct unnest(v_identifiers) order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('repair-device:' || p_branch::text || ':' || v_identifier, 0));
  end loop;
  if exists (select 1 from public.repair_orders where branch_id = p_branch and delivered_at is null and identifiers && v_identifiers) then
    raise exception 'repair already open';
  end if;

  select id into v_device from public.devices
  where branch_id = p_branch and status = 'sold' and serial = any(v_identifiers)
  order by array_position(v_identifiers, serial) limit 1;
  select full_name into v_actor from public.profiles where id = auth.uid();

  insert into public.repair_orders (
    id, branch_id, device_id, customer_name, customer_phone, device_model, serial, imei1, imei2,
    missing_identifier_reason, complaint, intake_condition, accessories, technician, custody_location, due_at, received_by
  ) values (
    p_id, p_branch, v_device, trim(p_intake->>'customer_name'), trim(p_intake->>'customer_phone'),
    trim(p_intake->>'device_model'), v_serial, v_imei1, v_imei2, nullif(trim(p_intake->>'missing_identifier_reason'), ''),
    trim(p_intake->>'complaint'), trim(p_intake->>'intake_condition'), nullif(trim(p_intake->>'accessories'), ''),
    nullif(trim(p_intake->>'technician'), ''), trim(p_intake->>'custody_location'),
    nullif(p_intake->>'due_at', '')::timestamp at time zone 'Africa/Cairo', auth.uid()
  ) returning * into v_order;

  if v_order.due_at < v_order.received_at then raise exception 'repair intake date in past'; end if;
  insert into public.repair_events (order_id, status, due_at, custody_location, technician, actor_id, actor_name)
  values (p_id, v_order.status, v_order.due_at, v_order.custody_location, v_order.technician, auth.uid(), v_actor);
  return p_id;
end;
$$;

create function public.update_repair(p_id uuid, p_revision int, p_update jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_order public.repair_orders;
  v_status public.repair_status := (p_update->>'status')::public.repair_status;
  v_due timestamptz;
  v_location text := trim(p_update->>'custody_location');
  v_note text := nullif(trim(p_update->>'note'), '');
  v_diagnosis text := nullif(trim(p_update->>'diagnosis'), '');
  v_technician text := nullif(trim(p_update->>'technician'), '');
  v_actor text;
begin
  select * into v_order from public.repair_orders r
  where r.id = p_id and public.can_access_repairs(r.branch_id, true) for update;
  if not found then raise exception 'not allowed'; end if;
  if v_order.revision is distinct from p_revision then raise exception 'repair has changed'; end if;
  if v_order.status = 'delivered' or v_status is null or not (
    v_status = v_order.status or case v_order.status
      when 'received' then v_status in ('diagnosing','cancelled')
      when 'diagnosing' then v_status in ('awaiting_approval','unrepairable','cancelled')
      when 'awaiting_approval' then v_status in ('repairing','awaiting_part','diagnosing','cancelled')
      when 'awaiting_part' then v_status in ('repairing','awaiting_approval','unrepairable','cancelled')
      when 'repairing' then v_status in ('testing','awaiting_part','awaiting_approval','unrepairable','cancelled')
      when 'testing' then v_status in ('ready','repairing','unrepairable','cancelled')
      when 'ready' then v_status in ('delivered','testing')
      when 'cancelled' then v_status = 'delivered'
      when 'unrepairable' then v_status = 'delivered'
      else false end
  ) then raise exception 'invalid repair status transition'; end if;

  v_due := case when p_update ? 'due_at'
    then nullif(p_update->>'due_at', '')::timestamp at time zone 'Africa/Cairo'
    else v_order.due_at end;
  if v_due < v_order.received_at and v_due is distinct from v_order.due_at then
    raise exception 'repair intake date in past';
  end if;
  if v_note is null and (v_status is distinct from v_order.status or v_due is distinct from v_order.due_at
      or v_location is distinct from v_order.custody_location or v_technician is distinct from v_order.technician
      or v_diagnosis is distinct from v_order.diagnosis) then
    raise exception 'reason required';
  end if;
  if v_note is null then return; end if;

  select full_name into v_actor from public.profiles where id = auth.uid();
  update public.repair_orders set status = v_status, due_at = v_due, custody_location = v_location,
    technician = v_technician, diagnosis = v_diagnosis, revision = revision + 1,
    delivered_at = case when v_status = 'delivered' then clock_timestamp() end
  where id = p_id;
  insert into public.repair_events (order_id, status, due_at, custody_location, technician, diagnosis, note, actor_id, actor_name)
  values (p_id, v_status, v_due, v_location, v_technician, v_diagnosis, v_note, auth.uid(), v_actor);
end;
$$;

revoke all on function public.can_access_repairs(uuid, boolean), public.repair_branches(),
  public.receive_repair(uuid, uuid, jsonb), public.update_repair(uuid, integer, jsonb) from public, anon;
grant execute on function public.can_access_repairs(uuid, boolean), public.repair_branches(),
  public.receive_repair(uuid, uuid, jsonb), public.update_repair(uuid, integer, jsonb) to authenticated;
