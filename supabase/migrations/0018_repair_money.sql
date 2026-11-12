-- 0018: repair money, delivery and warranty (maintenance module, built from docs/REPAIR-DASHBOARD-PLAN.md section 2 + 4
-- and the Volt parity plan). Needs 0011, 0013, 0015, 0016.
--  * repair_payments: deposits, payments and refunds against a repair quote. Append-only.
--    Cash goes into the MAINTENANCE drawer (ledger from 0016) and needs an open shift.
--  * deliver_repair: the only way to hand a device back. A priced repair must be paid in full; an owner/manager may
--    deliver with a balance only with a written reason (recorded in the repair log).
--  * A trigger stops update_repair from marking a priced, unpaid repair as delivered.
--  * Warranty: days + end date set at delivery; check_repair_warranty finds a delivered repair by IMEI, serial or RP number.
--  * repair_templates: reusable service lines (name, default labor, default warranty days).
-- Money = numeric(14,2). RLS on every table. Writes go through functions only.

-- ---------- drawer ledger: two new movement kinds ----------
alter table public.drawer_movements drop constraint drawer_movements_kind_check;
alter table public.drawer_movements add constraint drawer_movements_kind_check check (kind in
  ('opening_adjust','closing_adjust','sale','refund','expense','supplier_payment','transfer_in','transfer_out',
   'adjustment','repair_payment','repair_refund'));

-- ---------- warranty columns ----------
alter table public.repair_orders
  add column warranty_days int check (warranty_days between 0 and 365),
  add column warranty_until date,
  add column delivered_by uuid references public.profiles(id);

-- ---------- payments ----------
create table public.repair_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.repair_orders(id),
  kind text not null check (kind in ('deposit','payment','refund')),
  method text not null check (method in ('cash','card','transfer','wallet')),
  amount numeric(14,2) not null check (amount > 0),
  session_id uuid references public.cash_sessions(id),
  note text check (char_length(note) <= 300),
  idempotency_key uuid not null unique,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create index on public.repair_payments (order_id, created_at);
create index on public.repair_payments (session_id);
create trigger repair_payments_append_only before update or delete on public.repair_payments
  for each row execute function public.audit_block_mutation();
create trigger audit_repair_payments after insert on public.repair_payments
  for each row execute function public.audit_row();
alter table public.repair_payments enable row level security;
revoke all on public.repair_payments from public, anon, authenticated;
grant select on public.repair_payments to authenticated;
create policy repair_payments_read on public.repair_payments for select to authenticated
  using (public.has_any_role(array['owner','manager','cashier','accountant']::public.app_role[])
         and exists (select 1 from public.repair_orders r where r.id = order_id));

create view public.repair_balances with (security_invoker = true) as
  select o.id as order_id, o.quote_total,
         coalesce(p.paid, 0)::numeric(14,2) as paid,
         (o.quote_total - coalesce(p.paid, 0))::numeric(14,2) as remaining
    from public.repair_orders o
    left join (select order_id, sum(case when kind = 'refund' then -amount else amount end) as paid
                 from public.repair_payments group by order_id) p on p.order_id = o.id;
revoke all on public.repair_balances from public, anon;
grant select on public.repair_balances to authenticated;

-- ---------- record a payment / deposit / refund ----------
create or replace function public.record_repair_payment(
  p_order uuid, p_amount numeric, p_method text, p_kind text, p_note text, p_idem uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.repair_orders; sess uuid; paid numeric(14,2); amt numeric(14,2);
        pid uuid; d uuid; dbal numeric(14,2); actor text;
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_idem is null then raise exception 'idempotency key required'; end if;
  select id into pid from public.repair_payments where idempotency_key = p_idem;
  if pid is not null then return pid; end if;                       -- repeat click: same answer
  perform public.enforce_rate_limit('repair_payment', 30, 60);
  if p_kind not in ('deposit','payment','refund') or p_method not in ('cash','card','transfer','wallet') then
    raise exception 'invalid payment';
  end if;
  if p_amount is null or round(p_amount, 2) <= 0 then raise exception 'invalid amount'; end if;
  amt := round(p_amount, 2);
  select * into o from public.repair_orders r where r.id = p_order and public.can_access_repairs(r.branch_id, true) for update;
  if not found then raise exception 'not allowed'; end if;
  if o.quoted_at is null then raise exception 'repair not quoted'; end if;
  select coalesce(sum(case when kind = 'refund' then -amount else amount end), 0) into paid
    from public.repair_payments where order_id = p_order;
  if p_kind = 'refund' then
    if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
    if coalesce(trim(p_note), '') = '' then raise exception 'reason required'; end if;
    if amt > paid then raise exception 'refund exceeds paid'; end if;
  elsif amt > o.quote_total - paid then
    raise exception 'payment exceeds balance';
  end if;

  if p_method = 'cash' then
    select id into sess from public.cash_sessions where branch_id = o.branch_id and status = 'open';
    if sess is null then raise exception 'no open cash session'; end if;
    perform public.ensure_drawers(o.branch_id);
    select id into d from public.drawers where branch_id = o.branch_id and code = 'maintenance';
    if p_kind = 'refund' then
      select coalesce(sum(amount), 0) into dbal from public.drawer_movements where drawer_id = d;
      if dbal < amt then raise exception 'insufficient drawer balance'; end if;
    end if;
  end if;

  insert into public.repair_payments(order_id, kind, method, amount, session_id, note, idempotency_key)
  values (p_order, p_kind, p_method, amt, sess, nullif(trim(coalesce(p_note, '')), ''), p_idem)
  returning id into pid;

  if p_method = 'cash' then
    insert into public.drawer_movements(drawer_id, session_id, amount, kind, ref_type, ref_id, note)
    values (d, sess, case when p_kind = 'refund' then -amt else amt end,
            case when p_kind = 'refund' then 'repair_refund' else 'repair_payment' end,
            'repair_order', o.id::text, 'RP-' || o.order_number);
  end if;

  select full_name into actor from public.profiles where id = auth.uid();
  insert into public.repair_events (order_id, status, due_at, custody_location, technician, diagnosis, note, actor_id, actor_name)
  values (o.id, o.status, o.due_at, o.custody_location, o.technician, o.diagnosis,
          case p_kind when 'deposit' then 'عربون ' when 'refund' then 'مردود ' else 'دفعة ' end || amt || ' (' || p_method || ')'
            || coalesce(' - ' || nullif(trim(coalesce(p_note, '')), ''), ''),
          auth.uid(), coalesce(actor, ''));
  return pid;
end $$;

-- ---------- hand the device back ----------
create or replace function public.deliver_repair(
  p_id uuid, p_revision int, p_warranty_days int, p_note text, p_allow_balance boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare o public.repair_orders; paid numeric(14,2); remaining numeric(14,2); wd int; actor text;
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  select * into o from public.repair_orders r where r.id = p_id and public.can_access_repairs(r.branch_id, true) for update;
  if not found then raise exception 'not allowed'; end if;
  if o.revision is distinct from p_revision then raise exception 'repair has changed'; end if;
  if o.status not in ('ready','cancelled','unrepairable') then raise exception 'invalid repair status transition'; end if;
  select coalesce(sum(case when kind = 'refund' then -amount else amount end), 0) into paid
    from public.repair_payments where order_id = p_id;
  remaining := o.quote_total - paid;
  if remaining > 0 then
    if not (p_allow_balance and public.has_any_role(array['owner','manager']::public.app_role[])
            and coalesce(trim(p_note), '') <> '') then
      raise exception 'repair balance due';
    end if;
  end if;
  wd := case when o.status = 'ready' then coalesce(p_warranty_days, 0) else 0 end;
  if wd < 0 or wd > 365 then raise exception 'invalid warranty'; end if;
  select full_name into actor from public.profiles where id = auth.uid();

  perform set_config('app.deliver_ok', 'on', true);
  update public.repair_orders
     set status = 'delivered', delivered_at = clock_timestamp(), delivered_by = auth.uid(), revision = revision + 1,
         warranty_days = wd,
         warranty_until = case when wd > 0 then (clock_timestamp() at time zone 'Africa/Cairo')::date + wd end
   where id = p_id;
  insert into public.repair_events (order_id, status, due_at, custody_location, technician, diagnosis, note, actor_id, actor_name)
  values (p_id, 'delivered', o.due_at, o.custody_location, o.technician, o.diagnosis,
          'تسليم للعميل' || case when wd > 0 then ' · ضمان ' || wd || ' يوم' else '' end
            || case when remaining > 0 then ' · تسليم بمتبقي ' || remaining else '' end
            || coalesce(' · ' || nullif(trim(coalesce(p_note, '')), ''), ''),
          auth.uid(), coalesce(actor, ''));
end $$;

-- update_repair must not be a back door: a priced repair with an unpaid balance cannot be marked delivered there.
create or replace function public.repair_delivery_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare paid numeric(14,2);
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered'
     and coalesce(current_setting('app.deliver_ok', true), '') <> 'on' then
    select coalesce(sum(case when kind = 'refund' then -amount else amount end), 0) into paid
      from public.repair_payments where order_id = new.id;
    if new.labor_cost + new.parts_cost > paid then raise exception 'repair balance due'; end if;
  end if;
  return new;
end $$;
create trigger repair_orders_delivery_guard before update on public.repair_orders
  for each row execute function public.repair_delivery_guard();

-- ---------- warranty lookup ----------
create or replace function public.check_repair_warranty(p_term text)
returns table(order_number bigint, device_model text, customer_name text, delivered_at timestamptz,
              warranty_days int, warranty_until date, is_valid boolean, days_left int)
language plpgsql stable security definer set search_path = public as $$
declare t text := upper(trim(coalesce(p_term, '')));
begin
  if not public.has_any_role(array['owner','manager','cashier','accountant','technician']::public.app_role[]) then
    raise exception 'not allowed';
  end if;
  if char_length(t) < 5 or char_length(t) > 40 then raise exception 'invalid search'; end if;
  return query
    select r.order_number, r.device_model, r.customer_name, r.delivered_at, r.warranty_days, r.warranty_until,
           (r.warranty_until is not null and r.warranty_until >= (now() at time zone 'Africa/Cairo')::date),
           greatest(0, coalesce(r.warranty_until - (now() at time zone 'Africa/Cairo')::date, 0))
      from public.repair_orders r
     where r.delivered_at is not null and public.can_access_repairs(r.branch_id, false)
       and (r.identifiers @> array[t] or ('RP-' || r.order_number::text) = t)
     order by r.delivered_at desc limit 5;
end $$;

-- ---------- service templates ----------
create table public.repair_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  default_labor numeric(14,2) not null default 0 check (default_labor >= 0),
  default_warranty_days int not null default 0 check (default_warranty_days between 0 and 365),
  notes text check (char_length(notes) <= 300),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index repair_templates_name_idx on public.repair_templates (lower(trim(name))) where is_active;
alter table public.repair_templates enable row level security;
revoke all on public.repair_templates from public, anon, authenticated;
grant select on public.repair_templates to authenticated;
create policy repair_templates_read on public.repair_templates for select to authenticated
  using (public.has_any_role(array['owner','manager','cashier','accountant','technician']::public.app_role[]));
create trigger audit_repair_templates after insert or update or delete on public.repair_templates
  for each row execute function public.audit_row();

create or replace function public.save_repair_template(
  p_id uuid, p_name text, p_labor numeric, p_warranty_days int, p_notes text, p_active boolean)
returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid := coalesce(p_id, gen_random_uuid());
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('repair_template', 30, 60);
  insert into public.repair_templates(id, name, default_labor, default_warranty_days, notes, is_active)
  values (tid, trim(p_name), coalesce(p_labor, 0), coalesce(p_warranty_days, 0), nullif(trim(coalesce(p_notes, '')), ''), coalesce(p_active, true))
  on conflict (id) do update set name = excluded.name, default_labor = excluded.default_labor,
    default_warranty_days = excluded.default_warranty_days, notes = excluded.notes, is_active = excluded.is_active;
  return tid;
end $$;

-- ---------- grants ----------
revoke all on function public.record_repair_payment(uuid, numeric, text, text, text, uuid) from public, anon;
revoke all on function public.deliver_repair(uuid, int, int, text, boolean) from public, anon;
revoke all on function public.check_repair_warranty(text) from public, anon;
revoke all on function public.save_repair_template(uuid, text, numeric, int, text, boolean) from public, anon;
revoke all on function public.repair_delivery_guard() from public, anon, authenticated;
grant execute on function public.record_repair_payment(uuid, numeric, text, text, text, uuid) to authenticated;
grant execute on function public.deliver_repair(uuid, int, int, text, boolean) to authenticated;
grant execute on function public.check_repair_warranty(text) to authenticated;
grant execute on function public.save_repair_template(uuid, text, numeric, int, text, boolean) to authenticated;
