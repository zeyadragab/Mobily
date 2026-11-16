-- 0033: Phase 9 of docs/VOLT-GAP-PLAN.md — installments, the in/out (amanat) ledger and trade-in (buying used devices).
--   * An installment plan is a schedule over a customer debt. The customer's single balance stays in customer_ledger.
--   * In/out is money a person leaves with the shop or takes; it is kept apart from sales debt (its own table).
--   * A trade-in puts one serial device in stock at the price paid, with no supplier.
--   * Every operation needs an open shift, an idempotency key and is rate limited. Cancel = compensating entries.
-- Money = numeric(14,2). RLS on every table. Writes go through functions only. Needs 0031 (helpers and ledger kinds).

insert into public.app_settings(key, value) values ('tradein_cashier_limit', 5000) on conflict (key) do nothing;

-- =====================================================================================================
-- INSTALLMENTS
-- =====================================================================================================
create sequence public.installment_plan_seq;
create table public.installment_plans (
  id uuid primary key default gen_random_uuid(),
  plan_no text not null unique default ('IP-' || lpad(nextval('public.installment_plan_seq')::text, 6, '0')),
  customer_id uuid not null references public.customers(id),
  invoice_id uuid references public.sales_invoices(id),
  description text check (description is null or char_length(description) <= 200),
  principal numeric(14,2) not null check (principal > 0),
  interest numeric(14,2) not null default 0 check (interest >= 0),
  down_payment numeric(14,2) not null default 0 check (down_payment >= 0),
  installment_count int not null check (installment_count between 1 and 60),
  period text not null check (period in ('week','month')),
  first_due date not null,
  status text not null default 'active' check (status in ('active','done','cancelled')),
  session_id uuid not null references public.cash_sessions(id),
  idempotency_key uuid not null unique,
  business_date date not null default ((now() at time zone 'Africa/Cairo')::date),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  cancelled_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  cancel_reason text
);
create index on public.installment_plans (customer_id);
create unique index installment_plans_one_per_invoice on public.installment_plans (invoice_id)
  where invoice_id is not null and status <> 'cancelled';

create table public.installments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.installment_plans(id),
  seq int not null check (seq >= 1),
  due_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  paid numeric(14,2) not null default 0 check (paid >= 0),
  status text not null default 'due' check (status in ('due','partial','paid','cancelled')),
  unique (plan_id, seq),
  check (paid <= amount)
);
create index on public.installments (due_date) where status in ('due','partial');

create sequence public.installment_collection_seq;
create table public.installment_collections (
  id uuid primary key default gen_random_uuid(),
  receipt_no text not null unique default ('IC-' || lpad(nextval('public.installment_collection_seq')::text, 6, '0')),
  installment_id uuid not null references public.installments(id),
  plan_id uuid not null references public.installment_plans(id),
  customer_id uuid not null references public.customers(id),
  amount numeric(14,2) not null check (amount > 0),
  method text not null check (method in ('cash','card','transfer','wallet')),
  drawer_code text,
  account_id uuid references public.money_accounts(id),
  status text not null default 'active' check (status in ('active','cancelled')),
  session_id uuid not null references public.cash_sessions(id),
  idempotency_key uuid not null unique,
  business_date date not null default ((now() at time zone 'Africa/Cairo')::date),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  cancelled_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  cancel_reason text
);
create index on public.installment_collections (plan_id);
create index on public.installment_collections (business_date desc, created_at desc);

alter table public.installment_plans enable row level security;
alter table public.installments enable row level security;
alter table public.installment_collections enable row level security;
create policy installment_plans_read on public.installment_plans for select to authenticated
  using (public.has_any_role(array['owner','manager','cashier','accountant']::public.app_role[]));
create policy installments_read on public.installments for select to authenticated
  using (public.has_any_role(array['owner','manager','cashier','accountant']::public.app_role[]));
create policy installment_collections_read on public.installment_collections for select to authenticated
  using (public.has_any_role(array['owner','manager','cashier','accountant']::public.app_role[]));
create trigger audit_installment_plans after insert or update or delete on public.installment_plans
  for each row execute function public.audit_row();
create trigger audit_installments after insert or update or delete on public.installments
  for each row execute function public.audit_row();
create trigger audit_installment_collections after insert or update or delete on public.installment_collections
  for each row execute function public.audit_row();

-- Mode A (p_invoice given): schedule the credit part still owed on a sale. That debt is already in the ledger
--   (sale_credit), so only the interest is added. p_principal is ignored and p_down must be 0.
-- Mode B (no invoice, owner / manager): a manual plan. Ledger +(principal + interest); the down payment is collected
--   at once into the products drawer.
-- Each installment = round((total - down) / n, 2); the last one takes the remainder. Monthly dates clamp to month end.
create or replace function public.create_installment_plan(
  p_customer uuid, p_invoice uuid, p_description text, p_principal numeric, p_interest numeric, p_down numeric,
  p_count int, p_period text, p_first_due date, p_idem uuid)
returns public.installment_plans
language plpgsql security definer set search_path = public as $$
declare v_plan public.installment_plans; v_inv public.sales_invoices; v_cust uuid := p_customer; v_s uuid;
        v_principal numeric(14,2); v_interest numeric(14,2) := round(coalesce(p_interest, 0), 2);
        v_down numeric(14,2) := round(coalesce(p_down, 0), 2); v_credit numeric(14,2); v_bal numeric(14,2);
        v_base numeric(14,2); v_each numeric(14,2); v_last numeric(14,2); i int;
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_invoice is null and not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_idem is null then raise exception 'idempotency key required'; end if;
  select * into v_plan from public.installment_plans p where p.idempotency_key = p_idem;
  if found then return v_plan; end if;
  perform public.enforce_rate_limit('installment', 30, 60);
  if p_count is null or p_count < 1 or p_count > 60 then raise exception 'invalid installment count'; end if;
  if p_period is null or p_period not in ('week','month') then raise exception 'invalid period'; end if;
  if p_first_due is null then raise exception 'invalid date'; end if;
  if v_interest < 0 or v_down < 0 then raise exception 'invalid amount'; end if;
  v_s := public.m_session();

  if p_invoice is not null then
    select * into v_inv from public.sales_invoices si where si.id = p_invoice;
    if not found or v_inv.status <> 'completed' or v_inv.customer_id is null
       or (p_customer is not null and p_customer <> v_inv.customer_id) then
      raise exception 'invoice not eligible';
    end if;
    v_cust := v_inv.customer_id;
    if v_down <> 0 then raise exception 'invalid amount'; end if;
    perform 1 from public.customers c where c.id = v_cust for update;
    if exists (select 1 from public.installment_plans p where p.invoice_id = p_invoice and p.status <> 'cancelled') then
      raise exception 'invoice already scheduled';
    end if;
    select coalesce(sum(l.amount), 0) into v_credit from public.customer_ledger l
     where l.ref_type = 'sales_invoice' and l.ref_id = v_inv.id::text;
    v_credit := v_credit - coalesce((select sum(r.debt_reduction) from public.sales_returns r
                                      where r.invoice_id = v_inv.id and r.status = 'completed'), 0);
    select coalesce(sum(l.amount), 0) into v_bal from public.customer_ledger l where l.customer_id = v_cust;
    v_principal := least(v_credit, v_bal);
    if v_principal is null or v_principal <= 0 then raise exception 'no credit to schedule'; end if;
  else
    if v_cust is null then raise exception 'customer required'; end if;
    perform 1 from public.customers c where c.id = v_cust and c.is_active for update;
    if not found then raise exception 'customer not found'; end if;
    v_principal := round(p_principal, 2);
    if v_principal is null or v_principal <= 0 then raise exception 'invalid amount'; end if;
    if v_down >= v_principal + v_interest then raise exception 'invalid amount'; end if;
  end if;

  v_base := v_principal + v_interest - v_down;
  v_each := round(v_base / p_count, 2);
  v_last := v_base - v_each * (p_count - 1);
  if v_each <= 0 or v_last <= 0 then raise exception 'invalid amount'; end if;

  insert into public.installment_plans(customer_id, invoice_id, description, principal, interest, down_payment,
                                       installment_count, period, first_due, session_id, idempotency_key)
  values (v_cust, p_invoice, nullif(left(trim(coalesce(p_description, '')), 200), ''), v_principal, v_interest, v_down,
          p_count, p_period, p_first_due, v_s, p_idem)
  returning * into v_plan;

  if p_invoice is not null then
    if v_interest > 0 then
      perform public.m_customer_entry(v_cust, v_interest, 'installment', 'installments', 'installment_plan', v_plan.id::text, v_plan.plan_no);
    end if;
  else
    if v_down > 0 then
      perform public.m_drawer_move('products', v_down, 'installment_down', 'installment_plan', v_plan.id::text, v_plan.plan_no);
      perform public.m_customer_entry(v_cust, -v_down, 'payment', 'installments', 'installment_plan', v_plan.id::text, v_plan.plan_no, 'cash');
    end if;
    perform public.m_customer_entry(v_cust, v_principal + v_interest, 'installment', 'installments', 'installment_plan', v_plan.id::text, v_plan.plan_no);
  end if;

  for i in 1..p_count loop
    insert into public.installments(plan_id, seq, due_date, amount)
    values (v_plan.id, i,
            case when p_period = 'week' then p_first_due + (i - 1) * 7
                 else (p_first_due + make_interval(months => i - 1))::date end,
            case when i = p_count then v_last else v_each end);
  end loop;
  return v_plan;
end $$;

-- Collect all or part of one installment. Cash goes to the chosen drawer (default: installments),
-- other methods go to the chosen wallet / machine account.
create or replace function public.collect_installment(
  p_installment uuid, p_amount numeric, p_method text, p_drawer text default 'installments',
  p_account uuid default null, p_idem uuid default null)
returns public.installment_collections
language plpgsql security definer set search_path = public as $$
declare v_col public.installment_collections; v_i public.installments; v_plan public.installment_plans;
        v_amt numeric(14,2) := round(p_amount, 2); v_s uuid; v_paid numeric(14,2);
        v_drawer text := coalesce(nullif(trim(coalesce(p_drawer, '')), ''), 'installments');
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_idem is null then raise exception 'idempotency key required'; end if;
  select * into v_col from public.installment_collections c where c.idempotency_key = p_idem;
  if found then return v_col; end if;
  perform public.enforce_rate_limit('installment', 30, 60);
  if p_method is null or p_method not in ('cash','card','transfer','wallet') then raise exception 'invalid payment'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'invalid amount'; end if;
  if p_method <> 'cash' and p_account is null then raise exception 'invalid account'; end if;
  select i.plan_id into v_plan.id from public.installments i where i.id = p_installment;
  if not found then raise exception 'installment not found'; end if;
  select * into v_plan from public.installment_plans p where p.id = v_plan.id for update;
  select * into v_i from public.installments i where i.id = p_installment for update;
  if v_plan.status <> 'active' or v_i.status not in ('due','partial') then raise exception 'installment not open'; end if;
  if v_amt > v_i.amount - v_i.paid then raise exception 'amount exceeds remaining'; end if;
  v_s := public.m_session();

  insert into public.installment_collections(installment_id, plan_id, customer_id, amount, method, drawer_code, account_id, session_id, idempotency_key)
  values (v_i.id, v_plan.id, v_plan.customer_id, v_amt, p_method, case when p_method = 'cash' then v_drawer end,
          case when p_method <> 'cash' then p_account end, v_s, p_idem)
  returning * into v_col;

  if p_method = 'cash' then
    perform public.m_drawer_move(v_drawer, v_amt, 'installment_collection', 'installment_collection', v_col.id::text, v_col.receipt_no || ' ' || v_plan.plan_no);
  else
    perform public.m_account_move(p_account, v_amt, 'installment_collection', 'installment_collection', v_col.id::text, v_col.receipt_no || ' ' || v_plan.plan_no);
  end if;
  perform public.m_customer_entry(v_plan.customer_id, -v_amt, 'payment', 'installments', 'installment_collection', v_col.id::text,
                                  v_col.receipt_no || ' ' || v_plan.plan_no, p_method);

  v_paid := v_i.paid + v_amt;
  update public.installments set paid = v_paid, status = case when v_paid >= v_i.amount then 'paid' else 'partial' end
   where id = v_i.id;
  if not exists (select 1 from public.installments i where i.plan_id = v_plan.id and i.status in ('due','partial')) then
    update public.installment_plans set status = 'done' where id = v_plan.id;
  end if;
  return v_col;
end $$;

-- Undo one collection: money back out of the drawer / account, the debt returns, the installment reopens.
create or replace function public.cancel_installment_collection(p_collection uuid, p_reason text)
returns public.installment_collections
language plpgsql security definer set search_path = public as $$
declare v_col public.installment_collections; v_i public.installments; v_paid numeric(14,2);
        v_reason text := left(trim(coalesce(p_reason, '')), 200);
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('installment', 30, 60);
  if v_reason = '' then raise exception 'reason required'; end if;
  select c.plan_id into v_col.plan_id from public.installment_collections c where c.id = p_collection;
  if not found then raise exception 'collection already cancelled'; end if;
  perform 1 from public.installment_plans p where p.id = v_col.plan_id for update;
  select * into v_col from public.installment_collections c where c.id = p_collection for update;
  if v_col.status <> 'active' then raise exception 'collection already cancelled'; end if;
  perform public.m_reverse_ref('installment_collection', v_col.id::text, v_reason);
  select * into v_i from public.installments i where i.id = v_col.installment_id for update;
  v_paid := greatest(v_i.paid - v_col.amount, 0);
  update public.installments set paid = v_paid, status = case when v_paid > 0 then 'partial' else 'due' end where id = v_i.id;
  update public.installment_plans set status = 'active' where id = v_col.plan_id and status = 'done';
  update public.installment_collections set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = v_reason
   where id = v_col.id returning * into v_col;
  return v_col;
end $$;

-- Cancel a plan nobody has paid into: the interest / manual debt and the down payment are reversed.
create or replace function public.cancel_installment_plan(p_plan uuid, p_reason text)
returns public.installment_plans
language plpgsql security definer set search_path = public as $$
declare v_plan public.installment_plans; v_reason text := left(trim(coalesce(p_reason, '')), 200);
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('installment', 30, 60);
  if v_reason = '' then raise exception 'reason required'; end if;
  select * into v_plan from public.installment_plans p where p.id = p_plan for update;
  if not found or v_plan.status <> 'active' then raise exception 'plan not active'; end if;
  if exists (select 1 from public.installment_collections c where c.plan_id = v_plan.id and c.status = 'active') then
    raise exception 'plan has collections';
  end if;
  perform public.m_reverse_ref('installment_plan', v_plan.id::text, v_reason);
  update public.installments set status = 'cancelled' where plan_id = v_plan.id;
  update public.installment_plans set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = v_reason
   where id = v_plan.id returning * into v_plan;
  return v_plan;
end $$;

-- One row per installment with its plan and customer. Overdue = due date <= today (Cairo) and not fully paid.
create or replace view public.installments_due with (security_invoker = true) as
  select i.id, i.plan_id, p.plan_no, p.status as plan_status, p.customer_id, c.name as customer_name, c.phone as customer_phone,
         p.description, p.invoice_id, i.seq, p.installment_count, i.due_date, i.amount, i.paid,
         (i.amount - i.paid)::numeric(14,2) as remaining, i.status,
         (i.status in ('due','partial') and i.due_date <= (now() at time zone 'Africa/Cairo')::date) as overdue,
         case when i.status in ('due','partial') and i.due_date <= (now() at time zone 'Africa/Cairo')::date
              then ((now() at time zone 'Africa/Cairo')::date - i.due_date) else 0 end as days_late
    from public.installments i
    join public.installment_plans p on p.id = i.plan_id
    join public.customers c on c.id = p.customer_id;
revoke all on public.installments_due from anon;
grant select on public.installments_due to authenticated;

-- =====================================================================================================
-- IN / OUT (amanat)
-- =====================================================================================================
create sequence public.inout_seq;
create table public.inout_entries (
  id uuid primary key default gen_random_uuid(),
  entry_no text not null unique default ('IO-' || lpad(nextval('public.inout_seq')::text, 6, '0')),
  customer_id uuid not null references public.customers(id),
  direction text not null check (direction in ('in','out')),          -- in = the shop received, out = the shop gave
  amount numeric(14,2) not null check (amount > 0),
  drawer_code text check (drawer_code is null or drawer_code in ('products','maintenance','machines','installments','wallets','safe')),
  note text check (note is null or char_length(note) <= 200),
  status text not null default 'active' check (status in ('active','cancelled')),
  session_id uuid not null references public.cash_sessions(id),
  idempotency_key uuid not null unique,
  business_date date not null default ((now() at time zone 'Africa/Cairo')::date),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  cancelled_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  cancel_reason text
);
create index on public.inout_entries (customer_id, created_at desc);
alter table public.inout_entries enable row level security;
create policy inout_entries_read on public.inout_entries for select to authenticated
  using (public.has_any_role(array['owner','manager','accountant']::public.app_role[]));
create trigger audit_inout_entries after insert or update or delete on public.inout_entries
  for each row execute function public.audit_row();

-- p_drawer null = ledger only (nothing moves). With a drawer: in adds the cash to it, out takes it from it.
create or replace function public.create_inout(
  p_customer uuid, p_direction text, p_amount numeric, p_drawer text, p_note text, p_idem uuid)
returns public.inout_entries
language plpgsql security definer set search_path = public as $$
declare v_e public.inout_entries; v_amt numeric(14,2) := round(p_amount, 2); v_s uuid;
        v_drawer text := nullif(trim(coalesce(p_drawer, '')), '');
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_idem is null then raise exception 'idempotency key required'; end if;
  select * into v_e from public.inout_entries e where e.idempotency_key = p_idem;
  if found then return v_e; end if;
  perform public.enforce_rate_limit('inout', 30, 60);
  if p_direction is null or p_direction not in ('in','out') then raise exception 'invalid direction'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'invalid amount'; end if;
  if v_drawer is not null and v_drawer not in ('products','maintenance','machines','installments','wallets','safe') then
    raise exception 'invalid drawers';
  end if;
  if p_customer is null then raise exception 'customer required'; end if;
  if not exists (select 1 from public.customers c where c.id = p_customer and c.is_active) then raise exception 'customer not found'; end if;
  v_s := public.m_session();
  insert into public.inout_entries(customer_id, direction, amount, drawer_code, note, session_id, idempotency_key)
  values (p_customer, p_direction, v_amt, v_drawer, nullif(left(trim(coalesce(p_note, '')), 200), ''), v_s, p_idem)
  returning * into v_e;
  if v_drawer is not null then
    perform public.m_drawer_move(v_drawer, case when p_direction = 'in' then v_amt else -v_amt end, 'inout', 'inout', v_e.id::text, v_e.entry_no);
  end if;
  return v_e;
end $$;

create or replace function public.cancel_inout(p_id uuid, p_reason text)
returns public.inout_entries
language plpgsql security definer set search_path = public as $$
declare v_e public.inout_entries; v_reason text := left(trim(coalesce(p_reason, '')), 200);
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('inout', 30, 60);
  if v_reason = '' then raise exception 'reason required'; end if;
  select * into v_e from public.inout_entries e where e.id = p_id for update;
  if not found or v_e.status <> 'active' then raise exception 'entry already cancelled'; end if;
  perform public.m_session();
  perform public.m_reverse_ref('inout', v_e.id::text, v_reason);
  update public.inout_entries set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = v_reason
   where id = v_e.id returning * into v_e;
  return v_e;
end $$;

-- net > 0: the shop holds money for this person. net < 0: the person holds money of the shop.
create or replace view public.inout_balances with (security_invoker = true) as
  select e.customer_id, c.name as customer_name, c.phone as customer_phone,
         coalesce(sum(e.amount) filter (where e.direction = 'in'), 0)::numeric(14,2) as total_in,
         coalesce(sum(e.amount) filter (where e.direction = 'out'), 0)::numeric(14,2) as total_out,
         (coalesce(sum(e.amount) filter (where e.direction = 'in'), 0)
          - coalesce(sum(e.amount) filter (where e.direction = 'out'), 0))::numeric(14,2) as net,
         count(*)::int as entries, max(e.created_at) as last_at
    from public.inout_entries e join public.customers c on c.id = e.customer_id
   where e.status = 'active'
   group by e.customer_id, c.name, c.phone;
revoke all on public.inout_balances from anon;
grant select on public.inout_balances to authenticated;

-- =====================================================================================================
-- TRADE-IN (buy a used device from a person)
-- =====================================================================================================
create sequence public.trade_in_seq;
create table public.trade_ins (
  id uuid primary key default gen_random_uuid(),
  trade_no text not null unique default ('TI-' || lpad(nextval('public.trade_in_seq')::text, 6, '0')),
  variant_id uuid not null references public.variants(id),
  serial text not null,
  price numeric(14,2) not null check (price > 0),
  expected_price numeric(14,2) check (expected_price is null or expected_price >= 0),
  pay text not null check (pay in ('cash','account','credit')),
  drawer_code text,
  account_id uuid references public.money_accounts(id),
  customer_id uuid references public.customers(id),
  seller_name text not null check (char_length(trim(seller_name)) between 2 and 120),
  seller_phone text check (seller_phone is null or seller_phone ~ '^\+?[0-9]{7,15}$'),
  condition_note text check (condition_note is null or char_length(condition_note) <= 300),
  device_id uuid not null references public.devices(id),
  status text not null default 'active' check (status in ('active','cancelled')),
  session_id uuid not null references public.cash_sessions(id),
  idempotency_key uuid not null unique,
  business_date date not null default ((now() at time zone 'Africa/Cairo')::date),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  cancelled_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  cancel_reason text,
  check (pay <> 'credit' or customer_id is not null),
  check (pay <> 'account' or account_id is not null)
);
create index on public.trade_ins (business_date desc, created_at desc);
create index on public.trade_ins (device_id);

-- The seller's national id is sensitive: its own table, hidden from cashiers, and not audited (see below).
create table public.trade_in_sellers (
  trade_in_id uuid primary key references public.trade_ins(id),
  national_id text not null check (national_id ~ '^[0-9]{14}$'),
  address text check (address is null or char_length(address) <= 200),
  created_at timestamptz not null default now()
);

alter table public.trade_ins enable row level security;
alter table public.trade_in_sellers enable row level security;
create policy trade_ins_read on public.trade_ins for select to authenticated
  using (public.has_any_role(array['owner','manager','accountant']::public.app_role[])
         or (public.has_role('cashier') and created_by = auth.uid()));
create policy trade_in_sellers_read on public.trade_in_sellers for select to authenticated
  using (public.has_any_role(array['owner','manager','accountant']::public.app_role[]));
create trigger audit_trade_ins after insert or update or delete on public.trade_ins
  for each row execute function public.audit_row();
-- No audit trigger on trade_in_sellers here. 0038 adds one that leaves national_id and address out of the audit copy
-- (audit_row() drops the columns named in its trigger arguments). The trade_ins row is audited and records who bought what.
-- (An earlier version of this comment wrongly said audit_row() ignores its arguments.)

-- The device enters stock at cost = price, the same way a supplied device does (devices row, 'received' event,
-- purchase_receipt movement, cost = average of the devices in stock), with no supplier.
-- cash -> drawer (default products) -price; account -> wallet / machine -price; credit -> the customer's debt -price.
-- A cashier may buy only below the 'tradein_cashier_limit' setting.
create or replace function public.create_trade_in(
  p_variant uuid, p_serial text, p_price numeric, p_pay text, p_drawer text, p_account uuid, p_customer uuid,
  p_seller_name text, p_seller_phone text, p_seller_national_id text, p_seller_address text,
  p_condition text, p_expected numeric, p_idem uuid)
returns public.trade_ins
language plpgsql security definer set search_path = public as $$
declare v_t public.trade_ins; v_id uuid := gen_random_uuid(); v_no text; v_s uuid; v_br uuid := public.m_branch();
        v_price numeric(14,2) := round(p_price, 2); v_serial text := public.norm_serial(p_serial);
        v_nid text := regexp_replace(coalesce(p_seller_national_id, ''), '\s', '', 'g');
        v_ph text := nullif(regexp_replace(coalesce(p_seller_phone, ''), '[\s-]', '', 'g'), '');
        v_drawer text := coalesce(nullif(trim(coalesce(p_drawer, '')), ''), 'products');
        v_boss boolean := public.has_any_role(array['owner','manager']::public.app_role[]);
        v_mode text; v_d public.devices; v_dev uuid; v_cost numeric(14,2); v_limit numeric;
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_idem is null then raise exception 'idempotency key required'; end if;
  select * into v_t from public.trade_ins t where t.idempotency_key = p_idem;
  if found then return v_t; end if;
  perform public.enforce_rate_limit('tradein', 30, 60);
  if v_price is null or v_price <= 0 then raise exception 'invalid amount'; end if;
  if p_expected is not null and p_expected < 0 then raise exception 'invalid amount'; end if;
  if p_pay is null or p_pay not in ('cash','account','credit') then raise exception 'invalid payment'; end if;
  v_limit := coalesce((select s.value from public.app_settings s where s.key = 'tradein_cashier_limit'), 5000);
  if not v_boss and v_price >= v_limit then raise exception 'tradein limit exceeded'; end if;
  if char_length(trim(coalesce(p_seller_name, ''))) < 2 then raise exception 'seller name required'; end if;
  if v_nid !~ '^[0-9]{14}$' then raise exception 'invalid national id'; end if;
  if v_ph is not null and v_ph !~ '^\+?[0-9]{7,15}$' then raise exception 'invalid phone'; end if;
  if p_pay = 'credit' and p_customer is null then raise exception 'customer required'; end if;
  if p_pay = 'account' and p_account is null then raise exception 'invalid account'; end if;
  if char_length(v_serial) < 5 or char_length(v_serial) > 40 then raise exception 'invalid serial'; end if;

  select p.tracking_mode into v_mode from public.variants v join public.products p on p.id = v.product_id
   where v.id = p_variant and v.is_active and p.is_active;
  if not found then raise exception 'invalid item'; end if;
  if v_mode = 'none' then raise exception 'item is not serial-tracked'; end if;
  perform 1 from public.variants v where v.id = p_variant for update;
  v_s := public.m_session();

  -- the device: new, or one whose only history is a cancelled trade-in (the same phone bought again)
  select * into v_d from public.devices d where d.serial = v_serial for update;
  if found then
    if v_d.status <> 'damaged' or v_d.sale_invoice_id is not null or v_d.online_order_id is not null or v_d.po_id is not null
       or v_d.supplier_id is not null
       or not exists (select 1 from public.trade_ins t where t.device_id = v_d.id and t.status = 'cancelled')
       or exists (select 1 from public.trade_ins t where t.device_id = v_d.id and t.status = 'active') then
      raise exception 'serial already registered';
    end if;
    if v_mode = 'imei' and not public.luhn_valid(v_serial) then raise exception 'invalid imei'; end if;
    update public.devices set status = 'in_stock', variant_id = p_variant, cost = v_price, branch_id = v_br, received_at = now()
     where id = v_d.id;
    v_dev := v_d.id;
  else
    insert into public.devices(variant_id, serial, cost, branch_id) values (p_variant, v_serial, v_price, v_br)
    returning devices.id into v_dev;
  end if;

  insert into public.trade_ins(id, variant_id, serial, price, expected_price, pay, drawer_code, account_id, customer_id,
                               seller_name, seller_phone, condition_note, device_id, session_id, idempotency_key)
  values (v_id, p_variant, v_serial, v_price, round(p_expected, 2), p_pay, case when p_pay = 'cash' then v_drawer end,
          case when p_pay = 'account' then p_account end, p_customer, trim(p_seller_name), v_ph,
          nullif(left(trim(coalesce(p_condition, '')), 300), ''), v_dev, v_s, p_idem)
  returning * into v_t;
  v_no := v_t.trade_no;
  insert into public.trade_in_sellers(trade_in_id, national_id, address)
  values (v_id, v_nid, nullif(left(trim(coalesce(p_seller_address, '')), 200), ''));

  perform public.device_event(array[v_serial], 'received', 'trade_in', v_id, v_no);
  select round(avg(d.cost), 2) into v_cost from public.devices d where d.variant_id = p_variant and d.status = 'in_stock';
  insert into public.variant_costs(variant_id, cost) values (p_variant, coalesce(v_cost, v_price))
    on conflict (variant_id) do update set cost = excluded.cost, updated_at = now();
  insert into public.stock_movements(variant_id, branch_id, movement_type, qty, unit_cost, ref_type, ref_id, note)
  values (p_variant, v_br, 'purchase_receipt', 1, v_price, 'trade_in', v_id, v_no);

  if p_pay = 'cash' then
    perform public.m_drawer_move(v_drawer, -v_price, 'tradein', 'trade_in', v_id::text, v_no);
  elsif p_pay = 'account' then
    perform public.m_account_move(p_account, -v_price, 'tradein', 'trade_in', v_id::text, v_no);
  else
    perform public.m_customer_entry(p_customer, -v_price, 'used_credit', 'products', 'trade_in', v_id::text, v_no);
  end if;
  return v_t;
end $$;

-- Only while the device is still in stock. The device leaves stock the way a write-off does
-- (status damaged, adjustment -1 at its cost) and every money line is reversed in the current shift.
create or replace function public.cancel_trade_in(p_id uuid, p_reason text, p_override uuid default null)
returns public.trade_ins
language plpgsql security definer set search_path = public as $$
declare v_t public.trade_ins; v_d public.devices; v_cost numeric(14,2); v_reason text := left(trim(coalesce(p_reason, '')), 500);
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('tradein', 30, 60);
  if v_reason = '' then raise exception 'reason required'; end if;
  select * into v_t from public.trade_ins t where t.id = p_id for update;
  if not found or v_t.status <> 'active' then raise exception 'trade-in already cancelled'; end if;
  select * into v_d from public.devices d where d.id = v_t.device_id for update;
  if v_d.status <> 'in_stock' then raise exception 'device is not in stock'; end if;
  perform public.m_session();
  if not public.has_role('owner') then
    if p_override is null then raise exception 'override required'; end if;
    perform public.consume_override(p_override);
  end if;

  update public.devices set status = 'damaged' where id = v_d.id;
  insert into public.stock_movements(variant_id, branch_id, movement_type, qty, unit_cost, ref_type, ref_id, note)
  values (v_d.variant_id, coalesce(v_d.branch_id, public.m_branch()), 'adjustment', -1, v_d.cost, 'trade_in', v_t.id,
          'إلغاء شراء مستعمل ' || v_t.trade_no || ': ' || left(v_reason, 200));
  perform public.device_event(array[v_d.serial], 'tradein_cancelled', 'trade_in', v_t.id, left(v_reason, 200));
  select round(avg(d.cost), 2) into v_cost from public.devices d where d.variant_id = v_d.variant_id and d.status = 'in_stock';
  if v_cost is not null then
    update public.variant_costs set cost = v_cost, updated_at = now() where variant_id = v_d.variant_id;
  end if;
  perform public.m_reverse_ref('trade_in', v_t.id::text, left(v_reason, 200));
  update public.trade_ins set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = v_reason
   where id = v_t.id returning * into v_t;
  return v_t;
end $$;

-- ---------- grants ----------
revoke all on function public.create_installment_plan(uuid, uuid, text, numeric, numeric, numeric, int, text, date, uuid) from public, anon;
revoke all on function public.collect_installment(uuid, numeric, text, text, uuid, uuid) from public, anon;
revoke all on function public.cancel_installment_collection(uuid, text) from public, anon;
revoke all on function public.cancel_installment_plan(uuid, text) from public, anon;
revoke all on function public.create_inout(uuid, text, numeric, text, text, uuid) from public, anon;
revoke all on function public.cancel_inout(uuid, text) from public, anon;
revoke all on function public.create_trade_in(uuid, text, numeric, text, text, uuid, uuid, text, text, text, text, text, numeric, uuid) from public, anon;
revoke all on function public.cancel_trade_in(uuid, text, uuid) from public, anon;
grant execute on function public.create_installment_plan(uuid, uuid, text, numeric, numeric, numeric, int, text, date, uuid) to authenticated;
grant execute on function public.collect_installment(uuid, numeric, text, text, uuid, uuid) to authenticated;
grant execute on function public.cancel_installment_collection(uuid, text) to authenticated;
grant execute on function public.cancel_installment_plan(uuid, text) to authenticated;
grant execute on function public.create_inout(uuid, text, numeric, text, text, uuid) to authenticated;
grant execute on function public.cancel_inout(uuid, text) to authenticated;
grant execute on function public.create_trade_in(uuid, text, numeric, text, text, uuid, uuid, text, text, text, text, text, numeric, uuid) to authenticated;
grant execute on function public.cancel_trade_in(uuid, text, uuid) to authenticated;
