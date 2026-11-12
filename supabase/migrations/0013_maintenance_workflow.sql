-- 0013 Maintenance workflow: cashier intake -> technician diagnosis & quote -> parts check
-- (shortage becomes a manager request) -> cashier informs customer and records the decision
-- -> repair. Run after 0012. All writes go through the functions below; tables are read-only
-- to clients and RLS is the real enforcement.

-- ---------- access: technician works on repairs in their branch ----------
create or replace function public.can_access_repairs(p_branch uuid, p_write boolean)
returns boolean language sql stable security invoker set search_path = public as $$
  select public.has_role_in_branch('owner', p_branch)
      or public.has_role_in_branch('manager', p_branch)
      or public.has_role_in_branch('cashier', p_branch)
      or public.has_role_in_branch('technician', p_branch)
      or (not p_write and public.has_role_in_branch('accountant', p_branch));
$$;

-- ---------- quote + customer decision columns ----------
alter table public.repair_orders
  add column labor_cost numeric(14,2) not null default 0 check (labor_cost >= 0),
  add column parts_cost numeric(14,2) not null default 0 check (parts_cost >= 0),
  add column quote_total numeric(14,2) generated always as (labor_cost + parts_cost) stored,
  add column quoted_at timestamptz,
  add column quoted_by uuid references public.profiles(id),
  add column customer_informed_at timestamptz,
  add column customer_informed_by uuid references public.profiles(id),
  add column customer_decision text check (customer_decision in ('approved', 'declined'));

-- ---------- spare parts catalog and its own stock ledger ----------
create table public.repair_parts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  sku text check (char_length(sku) <= 60),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index repair_parts_name_idx on public.repair_parts (lower(trim(name))) where is_active;

create table public.repair_part_movements (
  id bigint generated always as identity primary key,
  part_id uuid not null references public.repair_parts(id),
  branch_id uuid not null references public.branches(id),
  qty int not null check (qty <> 0),
  reason text not null check (reason in ('receipt', 'repair_use', 'adjustment')),
  order_id uuid references public.repair_orders(id),
  note text check (char_length(note) <= 300),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index repair_part_movements_part_idx on public.repair_part_movements (part_id, branch_id);

create view public.repair_part_levels with (security_invoker = true) as
  select part_id, branch_id, sum(qty)::int as on_hand
  from public.repair_part_movements group by part_id, branch_id;

create table public.repair_order_parts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.repair_orders(id),
  part_id uuid not null references public.repair_parts(id),
  qty int not null check (qty between 1 and 50),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  consumed_at timestamptz,
  unique (order_id, part_id)
);
create index repair_order_parts_order_idx on public.repair_order_parts (order_id);

create type public.repair_part_request_status as enum ('pending', 'approved', 'rejected', 'received', 'cancelled');

create table public.repair_part_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.repair_orders(id),
  branch_id uuid not null references public.branches(id),
  part_id uuid not null references public.repair_parts(id),
  qty int not null check (qty > 0),
  status public.repair_part_request_status not null default 'pending',
  requested_by uuid not null default auth.uid() references public.profiles(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 500),
  received_at timestamptz
);
create index repair_part_requests_status_idx on public.repair_part_requests (status, requested_at desc);
create index repair_part_requests_order_idx on public.repair_part_requests (order_id);

-- ---------- RLS: read only; every write is a function below ----------
alter table public.repair_parts enable row level security;
alter table public.repair_part_movements enable row level security;
alter table public.repair_order_parts enable row level security;
alter table public.repair_part_requests enable row level security;
revoke all on public.repair_parts, public.repair_part_movements, public.repair_order_parts,
  public.repair_part_requests, public.repair_part_levels from public, anon, authenticated;
grant select on public.repair_parts, public.repair_part_movements, public.repair_order_parts,
  public.repair_part_requests, public.repair_part_levels to authenticated;

create policy repair_parts_read on public.repair_parts for select to authenticated
  using (public.has_any_role(array['owner','manager','cashier','technician','accountant']::public.app_role[]));
create policy repair_part_movements_read on public.repair_part_movements for select to authenticated
  using (public.can_access_repairs(branch_id, false));
create policy repair_order_parts_read on public.repair_order_parts for select to authenticated
  using (exists (select 1 from public.repair_orders r where r.id = order_id));
create policy repair_part_requests_read on public.repair_part_requests for select to authenticated
  using (exists (select 1 from public.repair_orders r where r.id = order_id));

create trigger audit_repair_parts after insert or update on public.repair_parts
  for each row execute function public.audit_row();
create trigger audit_repair_part_requests after insert or update on public.repair_part_requests
  for each row execute function public.audit_row();
create trigger audit_repair_order_parts after insert or update or delete on public.repair_order_parts
  for each row execute function public.audit_row();

-- ---------- flow guard: nobody can skip the customer's approval or missing parts ----------
create function public.repair_orders_flow_guard()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status and new.status = 'repairing'
     and old.status in ('diagnosing', 'awaiting_approval', 'awaiting_part') then
    if new.quoted_at is null or new.customer_decision is distinct from 'approved' then
      raise exception 'customer approval required';
    end if;
    if exists (select 1 from public.repair_order_parts where order_id = new.id and consumed_at is null) then
      raise exception 'parts not available';
    end if;
  end if;
  return new;
end $$;
create trigger repair_orders_flow_guard before update on public.repair_orders
  for each row execute function public.repair_orders_flow_guard();

-- ---------- internal helpers (not callable by clients) ----------
create function public.repair_part_on_hand(p_part uuid, p_branch uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(qty), 0)::int from public.repair_part_movements where part_id = p_part and branch_id = p_branch;
$$;

create function public.repair_log(p_order uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.repair_orders; v_actor text;
begin
  select * into o from public.repair_orders where id = p_order;
  select full_name into v_actor from public.profiles where id = auth.uid();
  insert into public.repair_events (order_id, status, due_at, custody_location, technician, diagnosis, note, actor_id, actor_name)
  values (o.id, o.status, o.due_at, o.custody_location, o.technician, o.diagnosis, p_note, auth.uid(), coalesce(v_actor, ''));
end $$;

-- Open a manager request for every line that stock (plus already open requests) cannot cover.
create function public.repair_sync_requests(p_order uuid)
returns int language plpgsql security definer set search_path = public as $$
declare o public.repair_orders; l record; v_short int; v_made int := 0;
begin
  select * into o from public.repair_orders where id = p_order;
  for l in select * from public.repair_order_parts where order_id = p_order and consumed_at is null order by part_id loop
    v_short := l.qty - public.repair_part_on_hand(l.part_id, o.branch_id) - coalesce((
      select sum(qty) from public.repair_part_requests
      where order_id = p_order and part_id = l.part_id and status in ('pending', 'approved')), 0);
    if v_short > 0 then
      insert into public.repair_part_requests (order_id, branch_id, part_id, qty)
      values (p_order, o.branch_id, l.part_id, v_short);
      v_made := v_made + 1;
    end if;
  end loop;
  return v_made;
end $$;

-- Take in-stock parts out of stock for this order. True when every line is covered.
create function public.repair_consume_parts(p_order uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare o public.repair_orders; l record;
begin
  select * into o from public.repair_orders where id = p_order;
  for l in select * from public.repair_order_parts where order_id = p_order and consumed_at is null order by part_id loop
    perform pg_advisory_xact_lock(hashtextextended('repair-part:' || l.part_id::text || ':' || o.branch_id::text, 0));
    if public.repair_part_on_hand(l.part_id, o.branch_id) >= l.qty then
      insert into public.repair_part_movements (part_id, branch_id, qty, reason, order_id, note)
      values (l.part_id, o.branch_id, -l.qty, 'repair_use', p_order, 'RP-' || o.order_number);
      update public.repair_order_parts set consumed_at = clock_timestamp() where id = l.id;
    end if;
  end loop;
  perform public.repair_sync_requests(p_order);
  return not exists (select 1 from public.repair_order_parts where order_id = p_order and consumed_at is null);
end $$;

-- ---------- catalog and stock (owner / manager) ----------
create function public.save_repair_part(p_id uuid, p_name text, p_sku text, p_price numeric, p_active boolean)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  insert into public.repair_parts (id, name, sku, unit_price, is_active)
  values (p_id, trim(p_name), nullif(trim(p_sku), ''), p_price, coalesce(p_active, true))
  on conflict (id) do update set name = excluded.name, sku = excluded.sku,
    unit_price = excluded.unit_price, is_active = excluded.is_active;
  return p_id;
end $$;

create function public.adjust_repair_part_stock(p_part uuid, p_branch uuid, p_qty int, p_reason text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_role_in_branch('owner', p_branch) or public.has_role_in_branch('manager', p_branch)) then
    raise exception 'not allowed';
  end if;
  if p_reason not in ('receipt', 'adjustment') or p_qty is null or p_qty = 0 then raise exception 'invalid quantity'; end if;
  if p_reason = 'receipt' and p_qty < 0 then raise exception 'invalid quantity'; end if;
  if p_reason = 'adjustment' and nullif(trim(p_note), '') is null then raise exception 'reason required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('repair-part:' || p_part::text || ':' || p_branch::text, 0));
  if public.repair_part_on_hand(p_part, p_branch) + p_qty < 0 then raise exception 'stock cannot go negative'; end if;
  insert into public.repair_part_movements (part_id, branch_id, qty, reason, note)
  values (p_part, p_branch, p_qty, p_reason, nullif(trim(p_note), ''));
end $$;

-- ---------- technician: diagnosis + quote ----------
-- p_quote = {"diagnosis": text, "labor_cost": number, "parts": [{"part_id": uuid, "qty": int}]}
-- Returns how many manager requests were opened for parts missing from stock.
create function public.submit_repair_quote(p_id uuid, p_revision int, p_quote jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  o public.repair_orders;
  v_diag text := nullif(trim(p_quote->>'diagnosis'), '');
  v_labor numeric(14,2) := coalesce(nullif(p_quote->>'labor_cost', '')::numeric, 0);
  v_item jsonb; v_part public.repair_parts; v_qty int; v_cost numeric(14,2) := 0;
  v_seen uuid[] := '{}'; v_requests int; v_actor text; l record;
begin
  select * into o from public.repair_orders where id = p_id for update;
  if not found or not (public.has_role_in_branch('owner', o.branch_id)
    or public.has_role_in_branch('manager', o.branch_id) or public.has_role_in_branch('technician', o.branch_id)) then
    raise exception 'not allowed';
  end if;
  if o.revision is distinct from p_revision then raise exception 'repair has changed'; end if;
  if o.status not in ('diagnosing', 'awaiting_approval') then raise exception 'invalid repair status transition'; end if;
  if v_diag is null or char_length(v_diag) > 1500 then raise exception 'diagnosis required'; end if;
  if v_labor < 0 then raise exception 'invalid cost'; end if;

  -- a re-quote undoes any earlier stock use and withdraws requests nobody has answered yet
  for l in select * from public.repair_order_parts where order_id = p_id and consumed_at is not null loop
    insert into public.repair_part_movements (part_id, branch_id, qty, reason, order_id, note)
    values (l.part_id, o.branch_id, l.qty, 'adjustment', p_id, 'RP-' || o.order_number || ' re-quote');
  end loop;
  update public.repair_part_requests set status = 'cancelled' where order_id = p_id and status = 'pending';
  delete from public.repair_order_parts where order_id = p_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_quote->'parts', '[]'::jsonb)) loop
    select * into v_part from public.repair_parts where id = (v_item->>'part_id')::uuid and is_active;
    if not found then raise exception 'part unavailable'; end if;
    v_qty := (v_item->>'qty')::int;
    if v_qty is null or v_qty < 1 or v_qty > 50 then raise exception 'invalid quantity'; end if;
    if v_part.id = any(v_seen) then raise exception 'duplicate part'; end if;
    v_seen := v_seen || v_part.id;
    insert into public.repair_order_parts (order_id, part_id, qty, unit_price) values (p_id, v_part.id, v_qty, v_part.unit_price);
    v_cost := v_cost + v_qty * v_part.unit_price;
  end loop;

  select full_name into v_actor from public.profiles where id = auth.uid();
  update public.repair_orders set diagnosis = v_diag, labor_cost = v_labor, parts_cost = v_cost,
    quoted_at = clock_timestamp(), quoted_by = auth.uid(), customer_informed_at = null, customer_informed_by = null,
    customer_decision = null, status = 'awaiting_approval', technician = coalesce(technician, nullif(v_actor, '')),
    revision = revision + 1
  where id = p_id;

  v_requests := public.repair_sync_requests(p_id);
  perform public.repair_log(p_id, 'تم التشخيص والتسعير. الإجمالي ' || (v_labor + v_cost)::text || ' جنيه'
    || case when v_requests > 0 then ' · اتفتح ' || v_requests::text || ' طلب قطع للمدير لنقص المخزون' else '' end);
  return v_requests;
end $$;

-- ---------- cashier: inform the customer and record the answer ----------
-- p_decision: informed (told, still thinking) | approved | declined
create function public.record_customer_decision(p_id uuid, p_revision int, p_decision text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.repair_orders; v_note text := nullif(trim(p_note), ''); v_all boolean;
begin
  select * into o from public.repair_orders where id = p_id for update;
  if not found or not (public.has_role_in_branch('owner', o.branch_id)
    or public.has_role_in_branch('manager', o.branch_id) or public.has_role_in_branch('cashier', o.branch_id)) then
    raise exception 'not allowed';
  end if;
  if o.revision is distinct from p_revision then raise exception 'repair has changed'; end if;
  if o.status <> 'awaiting_approval' or o.quoted_at is null or p_decision not in ('informed', 'approved', 'declined') then
    raise exception 'invalid repair status transition';
  end if;
  if v_note is null then raise exception 'reason required'; end if;

  if p_decision = 'informed' then
    update public.repair_orders set customer_informed_at = clock_timestamp(), customer_informed_by = auth.uid(),
      revision = revision + 1 where id = p_id;
    perform public.repair_log(p_id, 'تم إبلاغ العميل بالتشخيص والتكلفة · ' || v_note);
  elsif p_decision = 'declined' then
    update public.repair_part_requests set status = 'cancelled' where order_id = p_id and status in ('pending', 'approved');
    update public.repair_orders set customer_informed_at = coalesce(customer_informed_at, clock_timestamp()),
      customer_informed_by = coalesce(customer_informed_by, auth.uid()), customer_decision = 'declined',
      status = 'cancelled', revision = revision + 1 where id = p_id;
    perform public.repair_log(p_id, 'العميل رفض الإصلاح · ' || v_note);
  else
    v_all := public.repair_consume_parts(p_id);
    update public.repair_orders set customer_informed_at = coalesce(customer_informed_at, clock_timestamp()),
      customer_informed_by = coalesce(customer_informed_by, auth.uid()), customer_decision = 'approved',
      status = case when v_all then 'repairing'::public.repair_status else 'awaiting_part'::public.repair_status end,
      revision = revision + 1 where id = p_id;
    perform public.repair_log(p_id, 'العميل وافق على الإصلاح · ' || v_note
      || case when v_all then '' else ' · بانتظار وصول القطع' end);
  end if;
end $$;

-- ---------- manager: approve / reject / receive part requests ----------
create function public.decide_repair_part_request(p_request uuid, p_decision text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.repair_part_requests; v_name text; v_note text := nullif(trim(p_note), '');
begin
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid decision'; end if;
  select * into r from public.repair_part_requests where id = p_request for update;
  if not found or not (public.has_role_in_branch('owner', r.branch_id) or public.has_role_in_branch('manager', r.branch_id)) then
    raise exception 'not allowed';
  end if;
  if r.status <> 'pending' then raise exception 'request is not pending'; end if;
  if r.requested_by = auth.uid() then raise exception 'requester cannot approve own request'; end if;
  if p_decision = 'rejected' and v_note is null then raise exception 'reason required'; end if;
  update public.repair_part_requests set status = p_decision::public.repair_part_request_status,
    decided_by = auth.uid(), decided_at = clock_timestamp(), decision_note = v_note where id = p_request;
  select name into v_name from public.repair_parts where id = r.part_id;
  perform public.repair_log(r.order_id, case when p_decision = 'approved' then 'المدير وافق على طلب القطعة ' else 'المدير رفض طلب القطعة ' end
    || v_name || ' × ' || r.qty::text || coalesce(' · ' || v_note, ''));
end $$;

create function public.receive_repair_part_request(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.repair_part_requests; o public.repair_orders; v_name text; v_all boolean;
begin
  select * into r from public.repair_part_requests where id = p_request;
  if not found then raise exception 'not allowed'; end if;
  select * into o from public.repair_orders where id = r.order_id for update;
  select * into r from public.repair_part_requests where id = p_request for update;
  if not (public.has_role_in_branch('owner', r.branch_id) or public.has_role_in_branch('manager', r.branch_id)) then
    raise exception 'not allowed';
  end if;
  if r.status <> 'approved' then raise exception 'request is not approved'; end if;

  perform pg_advisory_xact_lock(hashtextextended('repair-part:' || r.part_id::text || ':' || r.branch_id::text, 0));
  insert into public.repair_part_movements (part_id, branch_id, qty, reason, order_id, note)
  values (r.part_id, r.branch_id, r.qty, 'receipt', r.order_id, 'RP-' || o.order_number);
  update public.repair_part_requests set status = 'received', received_at = clock_timestamp() where id = p_request;
  select name into v_name from public.repair_parts where id = r.part_id;

  if o.customer_decision = 'approved' then
    v_all := public.repair_consume_parts(o.id);
    if v_all and o.status = 'awaiting_part' then
      update public.repair_orders set status = 'repairing', revision = revision + 1 where id = o.id;
    end if;
  end if;
  perform public.repair_log(o.id, 'وصلت القطعة ' || v_name || ' × ' || r.qty::text);
end $$;

revoke all on function public.repair_part_on_hand(uuid, uuid), public.repair_log(uuid, text),
  public.repair_sync_requests(uuid), public.repair_consume_parts(uuid),
  public.save_repair_part(uuid, text, text, numeric, boolean),
  public.adjust_repair_part_stock(uuid, uuid, int, text, text),
  public.submit_repair_quote(uuid, int, jsonb),
  public.record_customer_decision(uuid, int, text, text),
  public.decide_repair_part_request(uuid, text, text),
  public.receive_repair_part_request(uuid) from public, anon, authenticated;
grant execute on function public.save_repair_part(uuid, text, text, numeric, boolean),
  public.adjust_repair_part_stock(uuid, uuid, int, text, text),
  public.submit_repair_quote(uuid, int, jsonb),
  public.record_customer_decision(uuid, int, text, text),
  public.decide_repair_part_request(uuid, text, text),
  public.receive_repair_part_request(uuid) to authenticated;
