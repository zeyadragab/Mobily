-- 0031: Phase 7 of docs/VOLT-GAP-PLAN.md — wallet send/receive, bills and payment-machine operations.
-- Also the shared money helpers and ledger kinds used by phases 8-10 (maintenance, installments, in/out, trade-in, staff).
--   * Every operation needs an open shift, an idempotency key and is rate limited.
--   * Cash side goes to the wallets drawer (send/receive) or the machines drawer (bills, machine operations).
--   * Credit modes need a registered customer; the debt goes to the customer ledger with its source.
--   * Cancel = compensating entries in the current shift, never an edit or delete.
-- Money = numeric(14,2). RLS on every table. Writes go through functions only. Needs 0030.

-- ---------- ledger kinds for this phase and the next ones ----------
alter table public.drawer_movements drop constraint drawer_movements_kind_check;
alter table public.drawer_movements add constraint drawer_movements_kind_check check (kind in
  ('opening_adjust','closing_adjust','sale','refund','expense','supplier_payment','transfer_in','transfer_out',
   'adjustment','repair_payment','repair_refund','debt_collection','debt_refund','cash_add','cash_withdraw',
   'wallet_cash','bill_cash','machine_cash','installment_down','installment_collection','tradein','inout','employee','reversal'));

alter table public.account_movements drop constraint account_movements_kind_check;
alter table public.account_movements add constraint account_movements_kind_check check (kind in
  ('opening','adjustment','transfer_in','transfer_out','expense','supplier_payment','debt_collection','debt_refund',
   'sale','refund','repair_payment','wallet_send','wallet_receive','bill','machine_op','reversal',
   'installment_collection','tradein','inout','employee'));

alter table public.customer_ledger drop constraint customer_ledger_kind_check;
alter table public.customer_ledger add constraint customer_ledger_kind_check check (kind in
  ('sale_credit','repair_credit','installment','used_credit','manual_debt','payment','return_credit','reversal',
   'wallet_credit','bill_credit','wallet_settle'));
-- Where the debt came from (Volt's five sources). Old rows are product sales unless their kind says otherwise.
alter table public.customer_ledger add column source text not null default 'products'
  check (source in ('products','wallets','bills','maintenance','installments','other'));

create or replace view public.customer_source_balances with (security_invoker = true) as
  select l.customer_id, l.source, sum(l.amount)::numeric(14,2) as balance
    from public.customer_ledger l group by l.customer_id, l.source;
revoke all on public.customer_source_balances from anon;
grant select on public.customer_source_balances to authenticated;

insert into public.app_settings(key, value) values ('wallet_pin_threshold', 10000) on conflict (key) do nothing;

-- ---------- shared helpers (internal: only other functions call them) ----------
create or replace function public.m_branch() returns uuid
language sql stable security definer set search_path = public as $$
  select b.id from public.branches b where b.is_active order by b.created_at limit 1 $$;

create or replace function public.m_session() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_s uuid;
begin
  select s.id into v_s from public.cash_sessions s where s.branch_id = public.m_branch() and s.status = 'open';
  if v_s is null then raise exception 'no open cash session'; end if;
  return v_s;
end $$;

-- Cash in or out of a drawer by code. Refuses to take more than the drawer holds.
create or replace function public.m_drawer_move(
  p_code text, p_amount numeric, p_kind text, p_ref_type text, p_ref_id text, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_d uuid; v_bal numeric(14,2); v_s uuid := public.m_session(); v_br uuid := public.m_branch();
begin
  if p_amount is null or round(p_amount, 2) = 0 then return; end if;
  perform public.ensure_drawers(v_br);
  select d.id into v_d from public.drawers d where d.branch_id = v_br and d.code = p_code and d.is_active for update;
  if v_d is null then raise exception 'invalid drawers'; end if;
  if p_code = 'safe' and not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_amount < 0 then
    select coalesce(sum(m.amount), 0) into v_bal from public.drawer_movements m where m.drawer_id = v_d;
    if v_bal + p_amount < 0 then raise exception 'insufficient drawer balance'; end if;
  end if;
  insert into public.drawer_movements(drawer_id, session_id, amount, kind, ref_type, ref_id, note)
  values (v_d, v_s, round(p_amount, 2), p_kind, p_ref_type, p_ref_id, p_note);
end $$;

-- Money in or out of a wallet / machine account. p_limits = this movement counts toward the daily and monthly limits.
create or replace function public.m_account_move(
  p_account uuid, p_amount numeric, p_kind text, p_ref_type text, p_ref_id text, p_note text default null, p_limits boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare v_a public.money_accounts; v_bal numeric(14,2); v_used numeric(14,2); v_amt numeric(14,2) := round(p_amount, 2);
        v_today date := (now() at time zone 'Africa/Cairo')::date;
begin
  if v_amt is null or v_amt = 0 then return; end if;
  select * into v_a from public.money_accounts a where a.id = p_account and a.is_active for update;
  if not found then raise exception 'invalid account'; end if;
  if v_amt < 0 then
    select coalesce(sum(m.amount), 0) into v_bal from public.account_movements m where m.account_id = v_a.id;
    if v_bal + v_amt < v_a.min_balance then raise exception 'insufficient account balance'; end if;
  end if;
  if p_limits and v_a.daily_limit is not null then
    select coalesce(sum(abs(m.amount)), 0) into v_used from public.account_movements m
     where m.account_id = v_a.id and m.kind in ('transfer_out','wallet_send','wallet_receive')
       and (m.created_at at time zone 'Africa/Cairo')::date = v_today;
    if v_used + abs(v_amt) > v_a.daily_limit then raise exception 'account daily limit exceeded'; end if;
  end if;
  if p_limits and v_a.monthly_limit is not null then
    select coalesce(sum(abs(m.amount)), 0) into v_used from public.account_movements m
     where m.account_id = v_a.id and m.kind in ('transfer_out','wallet_send','wallet_receive')
       and date_trunc('month', m.created_at at time zone 'Africa/Cairo') = date_trunc('month', v_today::timestamp);
    if v_used + abs(v_amt) > v_a.monthly_limit then raise exception 'account monthly limit exceeded'; end if;
  end if;
  insert into public.account_movements(account_id, amount, kind, ref_type, ref_id, note)
  values (v_a.id, v_amt, p_kind, p_ref_type, p_ref_id, p_note);
end $$;

-- Customer ledger entry. A positive amount is new debt: the customer must be active and inside the credit limit
-- (the owner may pass the limit). Returns the ledger id.
create or replace function public.m_customer_entry(
  p_customer uuid, p_amount numeric, p_kind text, p_source text, p_ref_type text, p_ref_id text, p_note text default null,
  p_method text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_c public.customers; v_bal numeric(14,2); v_id bigint; v_amt numeric(14,2) := round(p_amount, 2);
begin
  if p_customer is null then raise exception 'customer required'; end if;
  select * into v_c from public.customers c where c.id = p_customer for update;
  if not found then raise exception 'customer not found'; end if;
  if v_amt > 0 then
    if not v_c.is_active then raise exception 'customer not found'; end if;
    select coalesce(sum(l.amount), 0) into v_bal from public.customer_ledger l where l.customer_id = v_c.id;
    if v_bal + v_amt > v_c.credit_limit and not public.has_role('owner') then raise exception 'credit limit exceeded'; end if;
  end if;
  insert into public.customer_ledger(customer_id, amount, kind, source, method, session_id, ref_type, ref_id, note)
  values (v_c.id, v_amt, p_kind, p_source, p_method,
          (select s.id from public.cash_sessions s where s.branch_id = public.m_branch() and s.status = 'open'),
          p_ref_type, p_ref_id, p_note)
  returning id into v_id;
  return v_id;
end $$;

-- Undo every ledger line written for one document (drawer, account, customer), in the current shift.
create or replace function public.m_reverse_ref(p_ref_type text, p_ref_id text, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare r record; v_s uuid := public.m_session(); v_bal numeric(14,2); v_a public.money_accounts;
begin
  for r in select m.drawer_id, sum(m.amount) as amt from public.drawer_movements m
            where m.ref_type = p_ref_type and m.ref_id = p_ref_id group by m.drawer_id having sum(m.amount) <> 0 loop
    perform 1 from public.drawers d where d.id = r.drawer_id for update;
    select coalesce(sum(m.amount), 0) into v_bal from public.drawer_movements m where m.drawer_id = r.drawer_id;
    if v_bal - r.amt < 0 then raise exception 'insufficient drawer balance'; end if;
    insert into public.drawer_movements(drawer_id, session_id, amount, kind, ref_type, ref_id, note)
    values (r.drawer_id, v_s, -r.amt, 'reversal', p_ref_type, p_ref_id, p_reason);
  end loop;
  for r in select m.account_id, sum(m.amount) as amt from public.account_movements m
            where m.ref_type = p_ref_type and m.ref_id = p_ref_id group by m.account_id having sum(m.amount) <> 0 loop
    select * into v_a from public.money_accounts a where a.id = r.account_id for update;
    select coalesce(sum(m.amount), 0) into v_bal from public.account_movements m where m.account_id = r.account_id;
    if v_bal - r.amt < v_a.min_balance then raise exception 'insufficient account balance'; end if;
    insert into public.account_movements(account_id, amount, kind, ref_type, ref_id, note)
    values (r.account_id, -r.amt, 'reversal', p_ref_type, p_ref_id, p_reason);
  end loop;
  for r in select l.id, l.customer_id, l.amount, l.source, l.method from public.customer_ledger l
            where l.ref_type = p_ref_type and l.ref_id = p_ref_id and l.kind <> 'reversal'
              and not exists (select 1 from public.customer_ledger x where x.reverses = l.id) loop
    insert into public.customer_ledger(customer_id, amount, kind, source, method, session_id, ref_type, ref_id, note, reverses)
    values (r.customer_id, -r.amount, 'reversal', r.source, r.method, v_s, p_ref_type, p_ref_id, p_reason, r.id);
  end loop;
end $$;

revoke all on function public.m_branch() from public, anon, authenticated;
revoke all on function public.m_session() from public, anon, authenticated;
revoke all on function public.m_drawer_move(text, numeric, text, text, text, text) from public, anon, authenticated;
revoke all on function public.m_account_move(uuid, numeric, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.m_customer_entry(uuid, numeric, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.m_reverse_ref(text, text, text) from public, anon, authenticated;

-- ---------- wallet send / receive ----------
create sequence public.wallet_op_seq;
create table public.wallet_operations (
  id uuid primary key default gen_random_uuid(),
  op_no text not null unique default ('WO-' || lpad(nextval('public.wallet_op_seq')::text, 6, '0')),
  account_id uuid not null references public.money_accounts(id),
  mode text not null check (mode in ('receive','send','send_credit','receive_credit')),
  amount numeric(14,2) not null check (amount > 0),
  commission numeric(14,2) not null default 0 check (commission >= 0),
  customer_id uuid references public.customers(id),
  party_phone text check (party_phone is null or party_phone ~ '^\+?[0-9]{7,15}$'),
  status text not null default 'done' check (status in ('done','pending','cancelled')),
  session_id uuid not null references public.cash_sessions(id),
  note text,
  idempotency_key uuid not null unique,
  business_date date not null default ((now() at time zone 'Africa/Cairo')::date),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  cancel_reason text,
  check (mode not in ('send_credit','receive_credit') or customer_id is not null)
);
create index on public.wallet_operations (business_date desc, created_at desc);
create index on public.wallet_operations (customer_id);
alter table public.wallet_operations enable row level security;
create policy wallet_operations_read on public.wallet_operations for select to authenticated
  using (public.has_any_role(array['owner','manager','accountant']::public.app_role[])
         or (public.has_role('cashier') and created_by = auth.uid()));
create trigger audit_wallet_operations after insert or update or delete on public.wallet_operations
  for each row execute function public.audit_row();

-- receive        : customer sends A to our wallet and takes cash.   wallet +A, wallets drawer -(A - C)
-- send           : customer pays cash and we send A.                wallet -A, wallets drawer +(A + C)
-- send_credit    : we send A now, the customer pays later.          wallet -A, customer debt +(A + C)
-- receive_credit : we hand over the cash now, the transfer comes later. drawer -(A - C), debt +A, status pending
create or replace function public.process_wallet_operation(
  p_account uuid, p_mode text, p_amount numeric, p_commission numeric, p_customer uuid, p_party_phone text,
  p_note text, p_idem uuid, p_override uuid default null)
returns public.wallet_operations
language plpgsql security definer set search_path = public as $$
declare v_op public.wallet_operations; v_amt numeric(14,2); v_com numeric(14,2); v_thr numeric; v_s uuid;
        v_ph text := nullif(regexp_replace(coalesce(p_party_phone, ''), '[\s-]', '', 'g'), '');
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_idem is null then raise exception 'idempotency key required'; end if;
  select * into v_op from public.wallet_operations w where w.idempotency_key = p_idem;
  if found then return v_op; end if;
  perform public.enforce_rate_limit('wallet_op', 30, 60);
  if p_mode not in ('receive','send','send_credit','receive_credit') then raise exception 'invalid operation'; end if;
  v_amt := round(p_amount, 2); v_com := round(coalesce(p_commission, 0), 2);
  if v_amt is null or v_amt <= 0 or v_com < 0 then raise exception 'invalid amount'; end if;
  if p_mode in ('receive','receive_credit') and v_com >= v_amt then raise exception 'invalid amount'; end if;
  if v_ph is not null and v_ph !~ '^\+?[0-9]{7,15}$' then raise exception 'invalid phone'; end if;
  if p_mode in ('send_credit','receive_credit') and p_customer is null then raise exception 'customer required'; end if;
  if not exists (select 1 from public.money_accounts a where a.id = p_account and a.is_active and a.kind = 'wallet') then
    raise exception 'invalid account';
  end if;
  v_s := public.m_session();
  v_thr := coalesce((select value from public.app_settings where key = 'wallet_pin_threshold'), 10000);
  if v_amt >= v_thr and not public.has_any_role(array['owner','manager']::public.app_role[]) then
    if p_override is null then raise exception 'override required'; end if;
    perform public.consume_override(p_override);
  end if;

  insert into public.wallet_operations(account_id, mode, amount, commission, customer_id, party_phone, status, session_id, note, idempotency_key)
  values (p_account, p_mode, v_amt, v_com, p_customer, v_ph, case when p_mode = 'receive_credit' then 'pending' else 'done' end,
          v_s, nullif(trim(coalesce(p_note, '')), ''), p_idem)
  returning * into v_op;

  if p_mode = 'receive' then
    perform public.m_account_move(p_account, v_amt, 'wallet_receive', 'wallet_operation', v_op.id::text, v_op.op_no, true);
    perform public.m_drawer_move('wallets', -(v_amt - v_com), 'wallet_cash', 'wallet_operation', v_op.id::text, v_op.op_no);
  elsif p_mode = 'send' then
    perform public.m_account_move(p_account, -v_amt, 'wallet_send', 'wallet_operation', v_op.id::text, v_op.op_no, true);
    perform public.m_drawer_move('wallets', v_amt + v_com, 'wallet_cash', 'wallet_operation', v_op.id::text, v_op.op_no);
  elsif p_mode = 'send_credit' then
    perform public.m_account_move(p_account, -v_amt, 'wallet_send', 'wallet_operation', v_op.id::text, v_op.op_no, true);
    perform public.m_customer_entry(p_customer, v_amt + v_com, 'wallet_credit', 'wallets', 'wallet_operation', v_op.id::text, v_op.op_no);
  else
    perform public.m_drawer_move('wallets', -(v_amt - v_com), 'wallet_cash', 'wallet_operation', v_op.id::text, v_op.op_no);
    perform public.m_customer_entry(p_customer, v_amt, 'wallet_credit', 'wallets', 'wallet_operation', v_op.id::text, v_op.op_no);
  end if;
  return v_op;
end $$;

-- The late transfer of a "receive on credit" arrived: wallet +A, the customer's debt -A.
create or replace function public.settle_wallet_operation(p_id uuid)
returns public.wallet_operations
language plpgsql security definer set search_path = public as $$
declare v_op public.wallet_operations;
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('wallet_op', 30, 60);
  select * into v_op from public.wallet_operations w where w.id = p_id for update;
  if not found or v_op.status <> 'pending' then raise exception 'operation not pending'; end if;
  perform public.m_session();
  perform public.m_account_move(v_op.account_id, v_op.amount, 'wallet_receive', 'wallet_operation', v_op.id::text, v_op.op_no, true);
  perform public.m_customer_entry(v_op.customer_id, -v_op.amount, 'wallet_settle', 'wallets', 'wallet_operation', v_op.id::text, v_op.op_no, 'wallet');
  update public.wallet_operations set status = 'done', settled_at = now() where id = p_id returning * into v_op;
  return v_op;
end $$;

create or replace function public.cancel_wallet_operation(p_id uuid, p_reason text)
returns public.wallet_operations
language plpgsql security definer set search_path = public as $$
declare v_op public.wallet_operations;
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('wallet_op', 30, 60);
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason required'; end if;
  select * into v_op from public.wallet_operations w where w.id = p_id for update;
  if not found or v_op.status = 'cancelled' then raise exception 'operation already cancelled'; end if;
  perform public.m_reverse_ref('wallet_operation', v_op.id::text, left(trim(p_reason), 200));
  update public.wallet_operations set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = left(trim(p_reason), 200)
   where id = p_id returning * into v_op;
  return v_op;
end $$;

-- ---------- bills, services and machine operations ----------
create table public.bill_services (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 2 and 60),
  default_commission numeric(14,2) not null default 0 check (default_commission >= 0),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.bill_services enable row level security;
create policy bill_services_read on public.bill_services for select to authenticated
  using (public.has_any_role(array['owner','manager','cashier','accountant']::public.app_role[]));
create policy bill_services_write on public.bill_services for all to authenticated
  using (public.has_any_role(array['owner','manager']::public.app_role[]))
  with check (public.has_any_role(array['owner','manager']::public.app_role[]));
create trigger audit_bill_services after insert or update or delete on public.bill_services
  for each row execute function public.audit_row();
insert into public.bill_services(name, default_commission, sort_order) values
  ('فاتورة كهرباء', 5, 1), ('فاتورة مياه', 5, 2), ('فاتورة غاز', 5, 3), ('إنترنت منزلي', 5, 4),
  ('تليفون أرضي', 5, 5), ('شحن رصيد', 1, 6), ('باقات موبايل', 2, 7), ('خدمات أخرى', 5, 8)
on conflict (name) do nothing;

create sequence public.bill_op_seq;
create table public.bill_operations (
  id uuid primary key default gen_random_uuid(),
  op_no text not null unique default ('BL-' || lpad(nextval('public.bill_op_seq')::text, 6, '0')),
  kind text not null check (kind in ('bill','machine')),
  account_id uuid not null references public.money_accounts(id),
  service_id uuid references public.bill_services(id),
  service_name text,
  amount numeric(14,2) not null check (amount > 0),
  commission numeric(14,2) not null default 0 check (commission >= 0),
  pay text not null default 'cash' check (pay in ('cash','credit')),
  customer_id uuid references public.customers(id),
  reference text,
  status text not null default 'done' check (status in ('done','cancelled')),
  group_id uuid not null,
  session_id uuid not null references public.cash_sessions(id),
  idempotency_key uuid unique,
  business_date date not null default ((now() at time zone 'Africa/Cairo')::date),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  cancelled_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  cancel_reason text,
  check (pay <> 'credit' or customer_id is not null)
);
create index on public.bill_operations (business_date desc, created_at desc);
alter table public.bill_operations enable row level security;
create policy bill_operations_read on public.bill_operations for select to authenticated
  using (public.has_any_role(array['owner','manager','accountant']::public.app_role[])
         or (public.has_role('cashier') and created_by = auth.uid()));
create trigger audit_bill_operations after insert or update or delete on public.bill_operations
  for each row execute function public.audit_row();

-- Pay a bill for a customer from a machine / wallet balance.
-- cash   : account -cost, machines drawer +(cost + commission)
-- credit : account -cost, customer debt +(cost + commission)
-- p_count repeats the same bill 1-20 times (for example 5 top-ups). Returns the group id.
create or replace function public.pay_bill(
  p_account uuid, p_service uuid, p_amount numeric, p_commission numeric, p_pay text, p_customer uuid,
  p_reference text, p_count int, p_idem uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_g uuid; v_amt numeric(14,2); v_com numeric(14,2); v_s uuid; v_n int := coalesce(p_count, 1); i int;
        v_id uuid; v_no text; v_name text;
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_idem is null then raise exception 'idempotency key required'; end if;
  select b.group_id into v_g from public.bill_operations b where b.idempotency_key = p_idem;
  if found then return v_g; end if;
  perform public.enforce_rate_limit('bill_op', 30, 60);
  v_amt := round(p_amount, 2); v_com := round(coalesce(p_commission, 0), 2);
  if v_amt is null or v_amt <= 0 or v_com < 0 then raise exception 'invalid amount'; end if;
  if v_n < 1 or v_n > 20 then raise exception 'invalid count'; end if;
  if coalesce(p_pay, 'cash') not in ('cash','credit') then raise exception 'invalid payment'; end if;
  if p_pay = 'credit' and p_customer is null then raise exception 'customer required'; end if;
  select s.name into v_name from public.bill_services s where s.id = p_service and s.is_active;
  if v_name is null then raise exception 'invalid service'; end if;
  if not exists (select 1 from public.money_accounts a where a.id = p_account and a.is_active) then raise exception 'invalid account'; end if;
  v_s := public.m_session();
  v_g := gen_random_uuid();
  for i in 1..v_n loop
    insert into public.bill_operations(kind, account_id, service_id, service_name, amount, commission, pay, customer_id, reference,
                                       group_id, session_id, idempotency_key)
    values ('bill', p_account, p_service, v_name, v_amt, v_com, coalesce(p_pay, 'cash'), p_customer,
            nullif(trim(coalesce(p_reference, '')), ''), v_g, v_s, case when i = 1 then p_idem end)
    returning id, op_no into v_id, v_no;
    perform public.m_account_move(p_account, -v_amt, 'bill', 'bill_operation', v_id::text, v_no || ' ' || v_name);
    if coalesce(p_pay, 'cash') = 'cash' then
      perform public.m_drawer_move('machines', v_amt + v_com, 'bill_cash', 'bill_operation', v_id::text, v_no || ' ' || v_name);
    else
      perform public.m_customer_entry(p_customer, v_amt + v_com, 'bill_credit', 'bills', 'bill_operation', v_id::text, v_no || ' ' || v_name);
    end if;
  end loop;
  return v_g;
end $$;

-- Customer takes cash through the payment machine: account +(A + C), machines drawer -A.
create or replace function public.machine_operation(
  p_account uuid, p_amount numeric, p_commission numeric, p_reference text, p_idem uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_amt numeric(14,2); v_com numeric(14,2); v_s uuid; v_id uuid; v_no text;
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_idem is null then raise exception 'idempotency key required'; end if;
  select b.id into v_id from public.bill_operations b where b.idempotency_key = p_idem;
  if found then return v_id; end if;
  perform public.enforce_rate_limit('bill_op', 30, 60);
  v_amt := round(p_amount, 2); v_com := round(coalesce(p_commission, 0), 2);
  if v_amt is null or v_amt <= 0 or v_com < 0 then raise exception 'invalid amount'; end if;
  if not exists (select 1 from public.money_accounts a where a.id = p_account and a.is_active and a.kind = 'machine') then
    raise exception 'invalid account';
  end if;
  v_s := public.m_session();
  insert into public.bill_operations(kind, account_id, service_name, amount, commission, pay, reference, group_id, session_id, idempotency_key)
  values ('machine', p_account, 'سحب من ماكينة', v_amt, v_com, 'cash', nullif(trim(coalesce(p_reference, '')), ''), gen_random_uuid(), v_s, p_idem)
  returning id, op_no into v_id, v_no;
  perform public.m_account_move(p_account, v_amt + v_com, 'machine_op', 'bill_operation', v_id::text, v_no);
  perform public.m_drawer_move('machines', -v_amt, 'machine_cash', 'bill_operation', v_id::text, v_no);
  return v_id;
end $$;

create or replace function public.cancel_bill_operation(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_op public.bill_operations;
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('bill_op', 30, 60);
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason required'; end if;
  select * into v_op from public.bill_operations b where b.id = p_id for update;
  if not found or v_op.status = 'cancelled' then raise exception 'operation already cancelled'; end if;
  perform public.m_reverse_ref('bill_operation', v_op.id::text, left(trim(p_reason), 200));
  update public.bill_operations set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = left(trim(p_reason), 200)
   where id = p_id;
end $$;

-- ---------- grants ----------
revoke all on function public.process_wallet_operation(uuid, text, numeric, numeric, uuid, text, text, uuid, uuid) from public, anon;
revoke all on function public.settle_wallet_operation(uuid) from public, anon;
revoke all on function public.cancel_wallet_operation(uuid, text) from public, anon;
revoke all on function public.pay_bill(uuid, uuid, numeric, numeric, text, uuid, text, int, uuid) from public, anon;
revoke all on function public.machine_operation(uuid, numeric, numeric, text, uuid) from public, anon;
revoke all on function public.cancel_bill_operation(uuid, text) from public, anon;
grant execute on function public.process_wallet_operation(uuid, text, numeric, numeric, uuid, text, text, uuid, uuid) to authenticated;
grant execute on function public.settle_wallet_operation(uuid) to authenticated;
grant execute on function public.cancel_wallet_operation(uuid, text) to authenticated;
grant execute on function public.pay_bill(uuid, uuid, numeric, numeric, text, uuid, text, int, uuid) to authenticated;
grant execute on function public.machine_operation(uuid, numeric, numeric, text, uuid) to authenticated;
grant execute on function public.cancel_bill_operation(uuid, text) to authenticated;
