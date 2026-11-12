-- 0022: customers, identity details (KYC), the customer debt ledger and credit (آجل) sales.
-- Phase 1 of docs/VOLT-GAP-PLAN.md.
-- Rules:
--   * A customer balance is never stored. It is the sum of an append-only ledger (+ = owes us, - = paid).
--   * A sale may be paid partly or fully "on credit": payment method 'credit'. It needs a registered
--     customer, and the customer's balance may not pass credit_limit (the owner may pass it).
--   * Identity details live in a separate table that cashiers cannot read.
--   * Collecting a debt in cash goes into the products drawer and needs an open shift.
--   * Mistakes are fixed by a reversing entry, never by editing or deleting.
-- Money = numeric(14,2). RLS on every table. Writes go through functions only. Needs 0021.

create sequence public.customer_seq;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('C-' || lpad(nextval('public.customer_seq')::text, 5, '0')),
  name text not null check (length(trim(name)) between 2 and 120),
  phone text not null unique check (phone ~ '^\+?[0-9]{7,15}$'),
  phone2 text check (phone2 is null or phone2 ~ '^\+?[0-9]{7,15}$'),
  category text not null default 'regular' check (category in ('regular','vip','wholesale','technician')),
  credit_limit numeric(14,2) not null default 0 check (credit_limit >= 0),
  notes text,
  is_active boolean not null default true,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.customers (lower(name));

create table public.customer_kyc (
  customer_id uuid primary key references public.customers(id),
  national_id text check (national_id is null or national_id ~ '^[0-9]{14}$'),
  address text,
  guarantor_name text,
  guarantor_phone text check (guarantor_phone is null or guarantor_phone ~ '^\+?[0-9]{7,15}$'),
  guarantor_national_id text check (guarantor_national_id is null or guarantor_national_id ~ '^[0-9]{14}$'),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create table public.customer_ledger (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.customers(id),
  amount numeric(14,2) not null check (amount <> 0),
  kind text not null check (kind in
    ('sale_credit','repair_credit','installment','used_credit','manual_debt','payment','return_credit','reversal')),
  method text check (method is null or method in ('cash','card','transfer','wallet')),
  session_id uuid references public.cash_sessions(id),
  ref_type text,
  ref_id text,
  note text,
  reverses bigint unique references public.customer_ledger(id),
  idempotency_key uuid unique,
  business_date date not null default ((now() at time zone 'Africa/Cairo')::date),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.customer_ledger (customer_id, id desc);
create trigger customer_ledger_append_only before update or delete on public.customer_ledger
  for each row execute function public.audit_block_mutation();

alter table public.customers enable row level security;
alter table public.customer_kyc enable row level security;
alter table public.customer_ledger enable row level security;
create policy customers_read on public.customers for select to authenticated
  using (public.has_any_role(array['owner','manager','cashier','accountant']::public.app_role[]));
create policy customer_kyc_read on public.customer_kyc for select to authenticated
  using (public.has_any_role(array['owner','manager','accountant']::public.app_role[]));
create policy customer_ledger_read on public.customer_ledger for select to authenticated
  using (public.has_any_role(array['owner','manager','cashier','accountant']::public.app_role[]));
create trigger audit_customers after insert or update or delete on public.customers
  for each row execute function public.audit_row();
create trigger audit_customer_kyc after insert or update or delete on public.customer_kyc
  for each row execute function public.audit_row();

create view public.customer_balances with (security_invoker = true) as
  select c.id as customer_id, coalesce(sum(l.amount), 0)::numeric(14,2) as balance, max(l.created_at) as last_activity
    from public.customers c left join public.customer_ledger l on l.customer_id = c.id
   group by c.id;

-- ---------- drawer ledger: two new kinds ----------
alter table public.drawer_movements drop constraint drawer_movements_kind_check;
alter table public.drawer_movements add constraint drawer_movements_kind_check check (kind in
  ('opening_adjust','closing_adjust','sale','refund','expense','supplier_payment','transfer_in','transfer_out',
   'adjustment','repair_payment','repair_refund','debt_collection','debt_refund'));

-- ---------- save a customer ----------
-- A cashier may add and edit customers but can never set a credit limit or stop a customer.
create or replace function public.save_customer(
  p_id uuid, p_name text, p_phone text, p_phone2 text, p_category text,
  p_credit_limit numeric, p_notes text, p_active boolean default true)
returns uuid
language plpgsql security definer set search_path = public as $$
declare boss boolean := public.has_any_role(array['owner','manager']::public.app_role[]); cid uuid;
        ph text := regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g');
        ph2 text := nullif(regexp_replace(coalesce(p_phone2, ''), '[\s-]', '', 'g'), '');
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('save_customer', 30, 60);
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'invalid customer name'; end if;
  if ph !~ '^\+?[0-9]{7,15}$' or (ph2 is not null and ph2 !~ '^\+?[0-9]{7,15}$') then raise exception 'invalid phone'; end if;
  if coalesce(p_category, 'regular') not in ('regular','vip','wholesale','technician') then raise exception 'invalid category'; end if;
  if p_credit_limit is not null and p_credit_limit < 0 then raise exception 'invalid amount'; end if;
  if exists (select 1 from public.customers c where c.phone = ph and c.id is distinct from p_id) then
    raise exception 'customer phone exists';
  end if;
  if p_id is null then
    insert into public.customers(name, phone, phone2, category, credit_limit, notes)
    values (trim(p_name), ph, ph2, coalesce(p_category, 'regular'),
            case when boss then round(coalesce(p_credit_limit, 0), 2) else 0 end, nullif(trim(coalesce(p_notes, '')), ''))
    returning id into cid;
  else
    update public.customers c set
      name = trim(p_name), phone = ph, phone2 = ph2, category = coalesce(p_category, c.category),
      credit_limit = case when boss then round(coalesce(p_credit_limit, c.credit_limit), 2) else c.credit_limit end,
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      is_active = case when boss then coalesce(p_active, c.is_active) else c.is_active end,
      updated_at = now()
     where c.id = p_id returning c.id into cid;
    if cid is null then raise exception 'customer not found'; end if;
  end if;
  return cid;
end $$;

create or replace function public.save_customer_kyc(
  p_customer uuid, p_national_id text, p_address text,
  p_guarantor_name text, p_guarantor_phone text, p_guarantor_national_id text)
returns void
language plpgsql security definer set search_path = public as $$
declare nid text := nullif(trim(coalesce(p_national_id, '')), '');
        gnid text := nullif(trim(coalesce(p_guarantor_national_id, '')), '');
        gph text := nullif(regexp_replace(coalesce(p_guarantor_phone, ''), '[\s-]', '', 'g'), '');
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('save_customer', 30, 60);
  if (nid is not null and nid !~ '^[0-9]{14}$') or (gnid is not null and gnid !~ '^[0-9]{14}$') then
    raise exception 'invalid national id';
  end if;
  if gph is not null and gph !~ '^\+?[0-9]{7,15}$' then raise exception 'invalid phone'; end if;
  if not exists (select 1 from public.customers where id = p_customer) then raise exception 'customer not found'; end if;
  insert into public.customer_kyc(customer_id, national_id, address, guarantor_name, guarantor_phone, guarantor_national_id)
  values (p_customer, nid, nullif(trim(coalesce(p_address, '')), ''), nullif(trim(coalesce(p_guarantor_name, '')), ''), gph, gnid)
  on conflict (customer_id) do update set
    national_id = excluded.national_id, address = excluded.address, guarantor_name = excluded.guarantor_name,
    guarantor_phone = excluded.guarantor_phone, guarantor_national_id = excluded.guarantor_national_id,
    updated_by = auth.uid(), updated_at = now();
end $$;

-- ---------- credit sales ----------
alter table public.sales_invoices add column customer_id uuid references public.customers(id);
create index on public.sales_invoices (customer_id);

-- create_sale_once (0021) passes the chosen customer through a transaction-local setting.
create or replace function public.sale_set_customer()
returns trigger language plpgsql security definer set search_path = public as $$
declare c text := nullif(current_setting('app.sale_customer', true), ''); cu public.customers;
begin
  if c is null or new.customer_id is not null then return new; end if;
  select * into cu from public.customers where id = c::uuid;
  if not found or not cu.is_active then raise exception 'customer not found'; end if;
  new.customer_id := cu.id;
  new.customer_name := coalesce(new.customer_name, cu.name);
  new.customer_phone := coalesce(new.customer_phone, cu.phone);
  return new;
end $$;
create trigger sale_set_customer before insert on public.sales_invoices
  for each row execute function public.sale_set_customer();

alter table public.sales_payments drop constraint sales_payments_method_check;
alter table public.sales_payments add constraint sales_payments_method_check
  check (method in ('cash','card','transfer','wallet','credit'));

create or replace function public.check_payments(p_payments jsonb, p_total numeric)
returns void language plpgsql set search_path = public as $$
declare it jsonb; s numeric(14,2) := 0; a numeric(14,2);
begin
  if p_total = 0 then return; end if;
  if jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 then
    raise exception 'payments required';
  end if;
  for it in select * from jsonb_array_elements(p_payments) loop
    if (it->>'method') not in ('cash','card','transfer','wallet','credit') then raise exception 'invalid payment method'; end if;
    a := round((it->>'amount')::numeric, 2);
    if a is null or a <= 0 then raise exception 'invalid payment amount'; end if;
    s := s + a;
  end loop;
  if s <> p_total then raise exception 'payments must equal the invoice total'; end if;
end $$;

-- The credit part of a sale becomes customer debt, inside the same transaction as the sale.
create or replace function public.sale_credit_to_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
declare inv public.sales_invoices; cu public.customers; bal numeric(14,2);
begin
  if new.method <> 'credit' then return new; end if;
  select * into inv from public.sales_invoices where id = new.invoice_id;
  if inv.customer_id is null then raise exception 'customer required for credit sale'; end if;
  select * into cu from public.customers where id = inv.customer_id for update;
  if not cu.is_active then raise exception 'customer not found'; end if;
  select coalesce(sum(amount), 0) into bal from public.customer_ledger where customer_id = cu.id;
  if bal + new.amount > cu.credit_limit and not public.has_role('owner') then raise exception 'credit limit exceeded'; end if;
  insert into public.customer_ledger(customer_id, amount, kind, ref_type, ref_id, note, business_date)
  values (cu.id, new.amount, 'sale_credit', 'sales_invoice', inv.id::text, inv.invoice_number, inv.business_date);
  return new;
end $$;
create trigger sale_credit_to_ledger after insert on public.sales_payments
  for each row execute function public.sale_credit_to_ledger();

-- ---------- collect a debt ----------
create or replace function public.collect_customer_debt(
  p_customer uuid, p_amount numeric, p_method text, p_note text, p_idem uuid)
returns bigint
language plpgsql security definer set search_path = public as $$
declare lid bigint; amt numeric(14,2); bal numeric(14,2); br uuid; sess uuid; d uuid; cu public.customers;
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_idem is null then raise exception 'idempotency key required'; end if;
  select id into lid from public.customer_ledger where idempotency_key = p_idem;
  if lid is not null then return lid; end if;
  perform public.enforce_rate_limit('customer_payment', 30, 60);
  if p_method not in ('cash','card','transfer','wallet') then raise exception 'invalid payment'; end if;
  if p_amount is null or round(p_amount, 2) <= 0 then raise exception 'invalid amount'; end if;
  amt := round(p_amount, 2);
  select * into cu from public.customers where id = p_customer for update;
  if not found then raise exception 'customer not found'; end if;
  select coalesce(sum(amount), 0) into bal from public.customer_ledger where customer_id = p_customer;
  if amt > bal then raise exception 'payment exceeds balance'; end if;
  if p_method = 'cash' then
    br := (select b.id from public.branches b where b.is_active order by b.created_at limit 1);
    select id into sess from public.cash_sessions where branch_id = br and status = 'open';
    if sess is null then raise exception 'no open cash session'; end if;
    perform public.ensure_drawers(br);
    select id into d from public.drawers where branch_id = br and code = 'products';
  end if;
  insert into public.customer_ledger(customer_id, amount, kind, method, session_id, note, idempotency_key)
  values (p_customer, -amt, 'payment', p_method, sess, nullif(trim(coalesce(p_note, '')), ''), p_idem)
  returning id into lid;
  if p_method = 'cash' then
    insert into public.drawer_movements(drawer_id, session_id, amount, kind, ref_type, ref_id, note)
    values (d, sess, amt, 'debt_collection', 'customer_ledger', lid::text, cu.code || ' ' || cu.name);
  end if;
  return lid;
end $$;

-- ---------- opening balance / manual debt (owner or manager, written reason) ----------
create or replace function public.add_customer_debt(p_customer uuid, p_amount numeric, p_note text, p_idem uuid)
returns bigint
language plpgsql security definer set search_path = public as $$
declare lid bigint;
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_idem is null then raise exception 'idempotency key required'; end if;
  select id into lid from public.customer_ledger where idempotency_key = p_idem;
  if lid is not null then return lid; end if;
  perform public.enforce_rate_limit('customer_payment', 30, 60);
  if p_amount is null or round(p_amount, 2) <= 0 then raise exception 'invalid amount'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'reason required'; end if;
  if not exists (select 1 from public.customers where id = p_customer) then raise exception 'customer not found'; end if;
  insert into public.customer_ledger(customer_id, amount, kind, note, idempotency_key)
  values (p_customer, round(p_amount, 2), 'manual_debt', trim(p_note), p_idem) returning id into lid;
  return lid;
end $$;

-- ---------- reverse a collection or a manual debt ----------
create or replace function public.reverse_customer_entry(p_id bigint, p_reason text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare e public.customer_ledger; lid bigint; br uuid; sess uuid; d uuid; dbal numeric(14,2);
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('customer_payment', 30, 60);
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason required'; end if;
  select * into e from public.customer_ledger where id = p_id for update;
  if not found or e.kind not in ('payment','manual_debt') then raise exception 'entry cannot be reversed'; end if;
  if exists (select 1 from public.customer_ledger where reverses = p_id) then raise exception 'entry already reversed'; end if;
  if e.kind = 'payment' and e.method = 'cash' then
    br := (select b.id from public.branches b where b.is_active order by b.created_at limit 1);
    select id into sess from public.cash_sessions where branch_id = br and status = 'open';
    if sess is null then raise exception 'no open cash session'; end if;
    select id into d from public.drawers where branch_id = br and code = 'products';
    select coalesce(sum(amount), 0) into dbal from public.drawer_movements where drawer_id = d;
    if dbal < -e.amount then raise exception 'insufficient drawer balance'; end if;
  end if;
  insert into public.customer_ledger(customer_id, amount, kind, method, session_id, note, reverses)
  values (e.customer_id, -e.amount, 'reversal', e.method, sess, trim(p_reason), p_id) returning id into lid;
  if d is not null then
    insert into public.drawer_movements(drawer_id, session_id, amount, kind, ref_type, ref_id, note)
    values (d, sess, e.amount, 'debt_refund', 'customer_ledger', lid::text, trim(p_reason));
  end if;
  return lid;
end $$;

-- ---------- profit split: collected now vs still on credit ----------
-- cash share of the profit = profit * (paid now / total); the rest waits until the debt is collected.
create view public.sale_profit_split with (security_invoker = true) as
  select i.id as invoice_id, i.invoice_number, i.business_date, i.customer_id, i.total,
         p.credit, pr.profit,
         case when i.total = 0 then pr.profit
              else round(pr.profit * (i.total - p.credit) / i.total, 2) end as cash_profit,
         pr.profit - case when i.total = 0 then pr.profit
              else round(pr.profit * (i.total - p.credit) / i.total, 2) end as deferred_profit
    from public.sales_invoices i
    cross join lateral (select coalesce(sum(sp.amount) filter (where sp.method = 'credit'), 0)::numeric(14,2) as credit
                          from public.sales_payments sp where sp.invoice_id = i.id) p
    cross join lateral (select (coalesce(sum(l.qty * (l.unit_price - l.unit_cost)), 0) - i.discount)::numeric(14,2) as profit
                          from public.sales_invoice_lines l where l.invoice_id = i.id) pr
   where i.status = 'completed';

revoke all on function public.sale_set_customer() from public, anon, authenticated;
revoke all on function public.sale_credit_to_ledger() from public, anon, authenticated;
revoke all on function public.save_customer(uuid, text, text, text, text, numeric, text, boolean) from public, anon;
revoke all on function public.save_customer_kyc(uuid, text, text, text, text, text) from public, anon;
revoke all on function public.collect_customer_debt(uuid, numeric, text, text, uuid) from public, anon;
revoke all on function public.add_customer_debt(uuid, numeric, text, uuid) from public, anon;
revoke all on function public.reverse_customer_entry(bigint, text) from public, anon;
grant execute on function public.save_customer(uuid, text, text, text, text, numeric, text, boolean) to authenticated;
grant execute on function public.save_customer_kyc(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.collect_customer_debt(uuid, numeric, text, text, uuid) to authenticated;
grant execute on function public.add_customer_debt(uuid, numeric, text, uuid) to authenticated;
grant execute on function public.reverse_customer_entry(bigint, text) to authenticated;
revoke all on public.customer_balances, public.sale_profit_split from anon;
grant select on public.customer_balances, public.sale_profit_split to authenticated;
