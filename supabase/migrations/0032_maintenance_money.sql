-- 0032: Phase 8 of docs/VOLT-GAP-PLAN.md — maintenance completion (rules R15, R16, R17, R36).
--   * A repair order can be linked to a registered customer (customer_id); the text name / phone stay as a snapshot.
--   * Spare parts get a cost. Each order line keeps the cost of the day (unit_cost), so
--     profit = labour + sum(part price - part cost) (R15). Cost is hidden from cashier and technician.
--   * Delivery with an unpaid rest: with a registered customer the rest becomes customer debt, source "maintenance" (R16).
--     Without a customer the old rule stays: owner / manager only, with a written reason.
--   * cancel_delivered_repair (R17): money back from where it went, debt reversed, parts back to stock,
--     order back to work, warranty cleared. Owner, or manager with a PIN token.
--   * repair_brands: the brand list used at intake.
-- Money = numeric(14,2). RLS on every table. Writes go through functions only. Needs 0031.

-- ---------- columns ----------
alter table public.repair_orders
  add column customer_id uuid references public.customers(id),
  add column expected_price numeric(14,2) check (expected_price >= 0),
  add column brand text check (char_length(brand) <= 60),
  add column credit_amount numeric(14,2) not null default 0 check (credit_amount >= 0),
  add column delivered_from public.repair_status;
create index repair_orders_customer_idx on public.repair_orders (customer_id) where customer_id is not null;

update public.repair_orders o set customer_id = c.id
  from public.customers c where c.phone = o.customer_phone and o.customer_id is null;

alter table public.repair_parts add column cost numeric(14,2) not null default 0 check (cost >= 0);
alter table public.repair_order_parts add column unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0);

alter table public.repair_part_movements drop constraint repair_part_movements_reason_check;
alter table public.repair_part_movements add constraint repair_part_movements_reason_check
  check (reason in ('receipt', 'repair_use', 'adjustment', 'repair_cancel'));

-- Cost columns are not readable by the app roles directly: only through the functions and the view below.
revoke select on public.repair_parts, public.repair_order_parts from authenticated;
grant select (id, name, sku, unit_price, is_active, created_at) on public.repair_parts to authenticated;
grant select (id, order_id, part_id, qty, unit_price, consumed_at) on public.repair_order_parts to authenticated;

-- Every new order line keeps the part cost of that day.
create or replace function public.repair_order_parts_cost()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.unit_cost := coalesce((select p.cost from public.repair_parts p where p.id = new.part_id), 0);
  return new;
end $$;
create trigger repair_order_parts_cost before insert on public.repair_order_parts
  for each row execute function public.repair_order_parts_cost();

-- ---------- part cost (owner / manager write, accountant reads) ----------
create or replace function public.set_repair_part_cost(p_part uuid, p_cost numeric)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('repair_part_cost', 30, 60);
  if p_cost is null or round(p_cost, 2) < 0 then raise exception 'invalid amount'; end if;
  update public.repair_parts p set cost = round(p_cost, 2) where p.id = p_part;
  if not found then raise exception 'part unavailable'; end if;
end $$;

create or replace function public.repair_part_costs()
returns table(part_id uuid, cost numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_any_role(array['owner','manager','accountant']::public.app_role[]) then raise exception 'not allowed'; end if;
  return query select p.id, p.cost from public.repair_parts p;
end $$;

-- Parts cost of one order. Null for roles that may not see cost.
create or replace function public.repair_order_cost(p_order uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select case when public.has_any_role(array['owner','manager','accountant']::public.app_role[])
              and exists (select 1 from public.repair_orders o where o.id = p_order and public.can_access_repairs(o.branch_id, false))
         then coalesce((select sum(l.qty * l.unit_cost) from public.repair_order_parts l where l.order_id = p_order), 0)::numeric(14,2) end;
$$;

-- R15: profit = labour + sum(part price - part cost) = quote total - parts cost. "realized" once the device is delivered.
create view public.repair_profit with (security_invoker = true) as
  select o.id as order_id, o.order_number, o.branch_id, o.customer_id, o.status, o.delivered_at,
         o.labor_cost, o.parts_cost as parts_price, o.quote_total, o.credit_amount,
         x.cost as parts_cost,
         (o.quote_total - x.cost)::numeric(14,2) as profit,
         (o.status = 'delivered') as realized
    from public.repair_orders o
    cross join lateral (select public.repair_order_cost(o.id) as cost) x;
revoke all on public.repair_profit from public, anon;
grant select on public.repair_profit to authenticated;

-- The rest that moved to the customer's account is no longer due on the repair itself.
create or replace view public.repair_balances with (security_invoker = true) as
  select o.id as order_id, o.quote_total,
         coalesce(p.paid, 0)::numeric(14,2) as paid,
         (o.quote_total - coalesce(p.paid, 0) - o.credit_amount)::numeric(14,2) as remaining,
         o.credit_amount as on_account
    from public.repair_orders o
    left join (select order_id, sum(case when kind = 'refund' then -amount else amount end) as paid
                 from public.repair_payments group by order_id) p on p.order_id = o.id;

-- ---------- brand list ----------
create table public.repair_brands (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 60),
  name_ar text check (char_length(name_ar) <= 60),
  is_active boolean not null default true,
  sort int not null default 100,
  created_at timestamptz not null default now()
);
create unique index repair_brands_name_idx on public.repair_brands (lower(trim(name)));
alter table public.repair_brands enable row level security;
revoke all on public.repair_brands from public, anon, authenticated;
grant select on public.repair_brands to authenticated;
create policy repair_brands_read on public.repair_brands for select to authenticated
  using (public.has_any_role(array['owner','manager','cashier','accountant','technician']::public.app_role[]));
create trigger audit_repair_brands after insert or update or delete on public.repair_brands
  for each row execute function public.audit_row();

insert into public.repair_brands(name, name_ar, sort) values
  ('Apple', 'آبل', 1), ('Samsung', 'سامسونج', 2), ('Xiaomi', 'شاومي', 3), ('Redmi', 'ريدمي', 4), ('Poco', 'بوكو', 5),
  ('Oppo', 'أوبو', 6), ('Realme', 'ريلمي', 7), ('Vivo', 'فيفو', 8), ('Huawei', 'هواوي', 9), ('Honor', 'هونر', 10),
  ('Infinix', 'إنفينكس', 11), ('Tecno', 'تكنو', 12), ('Itel', 'آيتل', 13), ('Nokia', 'نوكيا', 14), ('Motorola', 'موتورولا', 15),
  ('OnePlus', 'ون بلس', 16), ('Google Pixel', 'جوجل بيكسل', 17), ('Lenovo', 'لينوفو', 18), ('Sony', 'سوني', 19),
  ('Nothing', 'ناثينج', 20), ('Other', 'أخرى', 999);

create or replace function public.save_repair_brand(p_id uuid, p_name text, p_name_ar text, p_active boolean default true)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); v_name text := trim(coalesce(p_name, ''));
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('repair_brand', 30, 60);
  if char_length(v_name) < 1 or char_length(v_name) > 60 then raise exception 'invalid brand'; end if;
  if exists (select 1 from public.repair_brands b where lower(trim(b.name)) = lower(v_name) and b.id <> v_id) then
    raise exception 'brand exists';
  end if;
  insert into public.repair_brands(id, name, name_ar, is_active)
  values (v_id, v_name, nullif(trim(coalesce(p_name_ar, '')), ''), coalesce(p_active, true))
  on conflict (id) do update set name = excluded.name, name_ar = excluded.name_ar, is_active = excluded.is_active;
  return v_id;
end $$;

-- ---------- intake: same signature; p_intake may now carry customer_id, expected_price and brand ----------
create or replace function public.receive_repair(p_id uuid, p_branch uuid, p_intake jsonb)
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
  v_cust_id uuid := nullif(trim(p_intake->>'customer_id'), '')::uuid;
  v_cust public.customers;
  v_name text := nullif(trim(p_intake->>'customer_name'), '');
  v_phone text := nullif(trim(p_intake->>'customer_phone'), '');
  v_expected numeric(14,2) := round(nullif(trim(p_intake->>'expected_price'), '')::numeric, 2);
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

  -- registered customer: the chosen one, or the active customer with exactly this phone
  if v_cust_id is not null then
    select * into v_cust from public.customers c where c.id = v_cust_id and c.is_active;
    if not found then raise exception 'customer not found'; end if;
  elsif v_phone is not null then
    select * into v_cust from public.customers c where c.phone = v_phone and c.is_active order by c.created_at limit 1;
  end if;
  if v_expected < 0 then raise exception 'invalid amount'; end if;

  select id into v_device from public.devices
  where branch_id = p_branch and status = 'sold' and serial = any(v_identifiers)
  order by array_position(v_identifiers, serial) limit 1;
  select full_name into v_actor from public.profiles where id = auth.uid();

  insert into public.repair_orders (
    id, branch_id, device_id, customer_name, customer_phone, device_model, serial, imei1, imei2,
    missing_identifier_reason, complaint, intake_condition, accessories, technician, custody_location, due_at, received_by,
    customer_id, expected_price, brand
  ) values (
    p_id, p_branch, v_device, coalesce(v_name, v_cust.name), coalesce(v_phone, v_cust.phone),
    trim(p_intake->>'device_model'), v_serial, v_imei1, v_imei2, nullif(trim(p_intake->>'missing_identifier_reason'), ''),
    trim(p_intake->>'complaint'), trim(p_intake->>'intake_condition'), nullif(trim(p_intake->>'accessories'), ''),
    nullif(trim(p_intake->>'technician'), ''), trim(p_intake->>'custody_location'),
    nullif(p_intake->>'due_at', '')::timestamp at time zone 'Africa/Cairo', auth.uid(),
    v_cust.id, v_expected, nullif(trim(p_intake->>'brand'), '')
  ) returning * into v_order;

  if v_order.due_at < v_order.received_at then raise exception 'repair intake date in past'; end if;
  insert into public.repair_events (order_id, status, due_at, custody_location, technician, actor_id, actor_name)
  values (p_id, v_order.status, v_order.due_at, v_order.custody_location, v_order.technician, auth.uid(), v_actor);
  return p_id;
end;
$$;

-- Link an existing open or delivered order to a registered customer (or unlink with null). Not while a debt is on it.
create or replace function public.set_repair_customer(p_order uuid, p_customer uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_o public.repair_orders; v_c public.customers;
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('repair_customer', 30, 60);
  select * into v_o from public.repair_orders r where r.id = p_order and public.can_access_repairs(r.branch_id, true) for update;
  if not found then raise exception 'not allowed'; end if;
  if v_o.credit_amount > 0 then raise exception 'repair has customer debt'; end if;
  if p_customer is not null then
    select * into v_c from public.customers c where c.id = p_customer and c.is_active;
    if not found then raise exception 'customer not found'; end if;
  end if;
  update public.repair_orders r set customer_id = p_customer, revision = r.revision + 1 where r.id = p_order;
  perform public.repair_log(p_order, case when p_customer is null then 'فك ربط الأمر بحساب العميل'
    else 'ربط الأمر بحساب العميل ' || v_c.name || ' (' || v_c.code || ')' end);
end $$;

-- ---------- payments: what moved to the customer's account cannot be paid again on the repair ----------
create or replace function public.record_repair_payment(
  p_order uuid, p_amount numeric, p_method text, p_kind text, p_note text, p_idem uuid, p_account uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.repair_orders; sess uuid; paid numeric(14,2); amt numeric(14,2);
        pid uuid; d uuid; dbal numeric(14,2); actor text; acct uuid; abal numeric(14,2); a public.money_accounts;
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
  elsif amt > o.quote_total - paid - o.credit_amount then
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
  else
    acct := public.valid_account(p_account);
    if acct is not null and p_kind = 'refund' then
      select * into a from public.money_accounts where id = acct for update;
      select coalesce(sum(amount), 0) into abal from public.account_movements where account_id = acct;
      if abal - amt < a.min_balance then raise exception 'insufficient account balance'; end if;
    end if;
  end if;

  insert into public.repair_payments(order_id, kind, method, amount, session_id, note, idempotency_key, account_id)
  values (p_order, p_kind, p_method, amt, sess, nullif(trim(coalesce(p_note, '')), ''), p_idem, acct)
  returning id into pid;

  if p_method = 'cash' then
    insert into public.drawer_movements(drawer_id, session_id, amount, kind, ref_type, ref_id, note)
    values (d, sess, case when p_kind = 'refund' then -amt else amt end,
            case when p_kind = 'refund' then 'repair_refund' else 'repair_payment' end,
            'repair_order', o.id::text, 'RP-' || o.order_number);
  elsif acct is not null then
    insert into public.account_movements(account_id, amount, kind, ref_type, ref_id, note)
    values (acct, case when p_kind = 'refund' then -amt else amt end, 'repair_payment',
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

-- ---------- hand the device back (R16) ----------
-- Unpaid rest + registered customer + p_allow_balance: the rest goes on the customer's account (inside the credit
-- limit; the owner may pass it). Unpaid rest without a customer: owner / manager only, with a written reason.
create or replace function public.deliver_repair(
  p_id uuid, p_revision int, p_warranty_days int, p_note text, p_allow_balance boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare v_o public.repair_orders; v_paid numeric(14,2); v_rem numeric(14,2); v_wd int; v_actor text;
        v_debt numeric(14,2) := 0; v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  select * into v_o from public.repair_orders r where r.id = p_id and public.can_access_repairs(r.branch_id, true) for update;
  if not found then raise exception 'not allowed'; end if;
  if v_o.revision is distinct from p_revision then raise exception 'repair has changed'; end if;
  if v_o.status not in ('ready','cancelled','unrepairable') then raise exception 'invalid repair status transition'; end if;
  select coalesce(sum(case when p.kind = 'refund' then -p.amount else p.amount end), 0) into v_paid
    from public.repair_payments p where p.order_id = p_id;
  v_rem := v_o.quote_total - v_paid;
  if v_rem > 0 then
    if v_o.customer_id is not null and coalesce(p_allow_balance, false) then
      perform public.enforce_rate_limit('repair_credit', 30, 60);
      perform public.m_customer_entry(v_o.customer_id, v_rem, 'repair_credit', 'maintenance', 'repair_order', v_o.id::text,
                                      'RP-' || v_o.order_number);
      v_debt := v_rem;
    elsif not (coalesce(p_allow_balance, false) and public.has_any_role(array['owner','manager']::public.app_role[])
               and v_note is not null) then
      raise exception 'repair balance due';
    end if;
  end if;
  v_wd := case when v_o.status = 'ready' then coalesce(p_warranty_days, 0) else 0 end;
  if v_wd < 0 or v_wd > 365 then raise exception 'invalid warranty'; end if;
  -- parts that went back to stock when an earlier delivery was cancelled leave the stock again
  if v_o.status = 'ready' and exists (select 1 from public.repair_order_parts l where l.order_id = p_id and l.consumed_at is null) then
    if not public.repair_consume_parts(p_id) then raise exception 'parts not available'; end if;
  end if;
  select pr.full_name into v_actor from public.profiles pr where pr.id = auth.uid();

  perform set_config('app.deliver_ok', 'on', true);
  update public.repair_orders r
     set status = 'delivered', delivered_at = clock_timestamp(), delivered_by = auth.uid(), revision = r.revision + 1,
         warranty_days = v_wd,
         warranty_until = case when v_wd > 0 then (clock_timestamp() at time zone 'Africa/Cairo')::date + v_wd end,
         credit_amount = v_debt, delivered_from = v_o.status
   where r.id = p_id;
  perform set_config('app.deliver_ok', '', true);
  insert into public.repair_events (order_id, status, due_at, custody_location, technician, diagnosis, note, actor_id, actor_name)
  values (p_id, 'delivered', v_o.due_at, v_o.custody_location, v_o.technician, v_o.diagnosis,
          'تسليم للعميل' || case when v_wd > 0 then ' · ضمان ' || v_wd || ' يوم' else '' end
            || case when v_debt > 0 then ' · المتبقي ' || v_debt || ' على حساب العميل'
                    when v_rem > 0 then ' · تسليم بمتبقي ' || v_rem else '' end
            || coalesce(' · ' || v_note, ''),
          auth.uid(), coalesce(v_actor, ''));
end $$;

-- ---------- cancel a delivered repair (R17) ----------
-- Owner, or manager with a PIN token. Works in the open shift with compensating entries only:
-- money back from the maintenance drawer / the account it went to, the repair debt reversed, parts back to stock,
-- order back to "repairing" (or to cancelled / unrepairable if that is how it was handed back), warranty cleared.
create or replace function public.cancel_delivered_repair(p_order uuid, p_reason text, p_override uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_o public.repair_orders; v_reason text := nullif(trim(coalesce(p_reason, '')), ''); v_s uuid;
        v_back public.repair_status; v_tag text; v_left numeric(14,2); v_amt numeric(14,2); v_total numeric(14,2);
        r record;
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('repair_cancel', 30, 60);
  select * into v_o from public.repair_orders o where o.id = p_order and public.can_access_repairs(o.branch_id, true) for update;
  if not found then raise exception 'not allowed'; end if;
  if v_o.status <> 'delivered' then raise exception 'order not delivered'; end if;
  if v_reason is null then raise exception 'reason required'; end if;
  if char_length(v_reason) > 250 then raise exception 'reason too long'; end if;
  if not public.has_role('owner') then
    if p_override is null then raise exception 'override required'; end if;
    perform public.consume_override(p_override);
  end if;
  v_s := public.m_session();
  v_tag := 'إلغاء تسليم RP-' || v_o.order_number || ' · ' || v_reason;

  -- 1. payments: one refund row per method / account that still holds money of this order
  select coalesce(sum(case when p.kind = 'refund' then -p.amount else p.amount end), 0) into v_total
    from public.repair_payments p where p.order_id = v_o.id;
  v_left := greatest(v_total, 0);
  for r in select p.method, p.account_id, sum(case when p.kind = 'refund' then -p.amount else p.amount end) as net
             from public.repair_payments p where p.order_id = v_o.id
            group by p.method, p.account_id
           having sum(case when p.kind = 'refund' then -p.amount else p.amount end) > 0
            order by p.method, p.account_id loop
    v_amt := least(r.net, v_left);
    if v_amt > 0 then
      insert into public.repair_payments(order_id, kind, method, amount, session_id, note, idempotency_key, account_id)
      values (v_o.id, 'refund', r.method, v_amt, case when r.method = 'cash' then v_s end, v_tag, gen_random_uuid(), r.account_id);
      v_left := v_left - v_amt;
    end if;
  end loop;
  -- 2. drawer, account and customer ledger: compensating entries for everything booked on this order
  perform public.m_reverse_ref('repair_order', v_o.id::text, v_tag);

  -- 3. where the order goes back to
  v_back := coalesce(v_o.delivered_from,
    (select e.status from public.repair_events e where e.order_id = v_o.id and e.status <> 'delivered' order by e.id desc limit 1),
    'ready');
  if v_back not in ('cancelled', 'unrepairable') then v_back := 'repairing'; end if;

  -- 4. parts back to stock at the cost recorded on the order line
  if v_back = 'repairing' then
    for r in select l.id, l.part_id, l.qty, l.unit_cost from public.repair_order_parts l
              where l.order_id = v_o.id and l.consumed_at is not null order by l.part_id loop
      perform pg_advisory_xact_lock(hashtextextended('repair-part:' || r.part_id::text || ':' || v_o.branch_id::text, 0));
      insert into public.repair_part_movements(part_id, branch_id, qty, reason, order_id, note)
      values (r.part_id, v_o.branch_id, r.qty, 'repair_cancel', v_o.id, 'RP-' || v_o.order_number || ' · تكلفة ' || r.unit_cost);
      update public.repair_order_parts l set consumed_at = null where l.id = r.id;
    end loop;
  end if;

  update public.repair_orders o
     set status = v_back, delivered_at = null, delivered_by = null, delivered_from = null,
         warranty_days = null, warranty_until = null, credit_amount = 0, revision = o.revision + 1
   where o.id = v_o.id;
  perform public.repair_log(v_o.id, 'إلغاء التسليم · ' || v_reason
    || case when v_total > 0 then ' · رجع للعميل ' || v_total else '' end
    || case when v_o.credit_amount > 0 then ' · اتشال من حساب العميل ' || v_o.credit_amount else '' end);
end $$;

-- ---------- grants ----------
revoke all on function public.repair_order_parts_cost() from public, anon, authenticated;
revoke all on function public.set_repair_part_cost(uuid, numeric) from public, anon;
revoke all on function public.repair_part_costs() from public, anon;
revoke all on function public.repair_order_cost(uuid) from public, anon;
revoke all on function public.save_repair_brand(uuid, text, text, boolean) from public, anon;
revoke all on function public.set_repair_customer(uuid, uuid) from public, anon;
revoke all on function public.cancel_delivered_repair(uuid, text, uuid) from public, anon;
grant execute on function public.set_repair_part_cost(uuid, numeric) to authenticated;
grant execute on function public.repair_part_costs() to authenticated;
grant execute on function public.repair_order_cost(uuid) to authenticated;
grant execute on function public.save_repair_brand(uuid, text, text, boolean) to authenticated;
grant execute on function public.set_repair_customer(uuid, uuid) to authenticated;
grant execute on function public.cancel_delivered_repair(uuid, text, uuid) to authenticated;
