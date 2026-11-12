-- 0024: Phase 2 of docs/VOLT-GAP-PLAN.md — money goes to the right place.
--   * Wallet and payment-machine accounts with an append-only ledger, limits and transfers.
--   * Expenses, supplier payments and debt collection can choose the drawer (cash) or the account (non-cash).
--     No choice = the old behaviour (cash -> products drawer, non-cash -> nothing).
--   * Drawer "add cash" / "withdraw cash" next to the existing "set to value" correction.
--   * Shift number (W-000N), shift alerts for every count difference, with a "reviewed" step.
--   * Balance control log: opening / closing counts, transfers, corrections, with before and after.
-- Money = numeric(14,2). RLS on every table. Writes go through functions only. Needs 0022.

-- ---------- accounts ----------
create table public.money_accounts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  kind text not null check (kind in ('wallet','machine')),
  name text not null check (length(trim(name)) between 2 and 80),
  number text,
  daily_limit numeric(14,2) check (daily_limit is null or daily_limit > 0),
  monthly_limit numeric(14,2) check (monthly_limit is null or monthly_limit > 0),
  min_balance numeric(14,2) not null default 0 check (min_balance >= 0),
  is_active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (branch_id, kind, name)
);

create table public.account_movements (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.money_accounts(id),
  amount numeric(14,2) not null check (amount <> 0),
  kind text not null check (kind in
    ('opening','adjustment','transfer_in','transfer_out','expense','supplier_payment','debt_collection','debt_refund',
     'sale','refund','repair_payment','wallet_send','wallet_receive','bill','machine_op','reversal')),
  ref_type text,
  ref_id text,
  group_id uuid,
  note text,
  idempotency_key uuid unique,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.account_movements (account_id, id desc);
create trigger account_movements_append_only before update or delete on public.account_movements
  for each row execute function public.audit_block_mutation();

alter table public.money_accounts enable row level security;
alter table public.account_movements enable row level security;
create policy money_accounts_read on public.money_accounts for select to authenticated
  using (public.has_any_role(array['owner','manager','cashier','accountant']::public.app_role[]));
create policy account_movements_read on public.account_movements for select to authenticated
  using (public.has_any_role(array['owner','manager','accountant']::public.app_role[]));
create trigger audit_money_accounts after insert or update or delete on public.money_accounts
  for each row execute function public.audit_row();

-- Balance and limit usage. Readable by cashiers too (they must see the balance before a transfer),
-- so it is a function, not a view over the restricted ledger.
create or replace function public.account_balances()
returns table(id uuid, kind text, name text, number text, daily_limit numeric, monthly_limit numeric,
              min_balance numeric, is_active boolean, balance numeric, used_today numeric, used_month numeric)
language plpgsql stable security definer set search_path = public as $$
declare today date := (now() at time zone 'Africa/Cairo')::date;
begin
  if not public.has_any_role(array['owner','manager','cashier','accountant']::public.app_role[]) then raise exception 'not allowed'; end if;
  return query
    select a.id, a.kind, a.name, a.number, a.daily_limit, a.monthly_limit, a.min_balance, a.is_active,
      coalesce((select sum(m.amount) from public.account_movements m where m.account_id = a.id), 0)::numeric,
      coalesce((select sum(abs(m.amount)) from public.account_movements m where m.account_id = a.id
                 and m.kind in ('transfer_out','wallet_send','wallet_receive')
                 and (m.created_at at time zone 'Africa/Cairo')::date = today), 0)::numeric,
      coalesce((select sum(abs(m.amount)) from public.account_movements m where m.account_id = a.id
                 and m.kind in ('transfer_out','wallet_send','wallet_receive')
                 and date_trunc('month', m.created_at at time zone 'Africa/Cairo') = date_trunc('month', today::timestamp)), 0)::numeric
    from public.money_accounts a
    where a.branch_id = (select b.id from public.branches b where b.is_active order by b.created_at limit 1)
    order by a.kind desc, a.name;
end $$;

create or replace function public.save_money_account(
  p_id uuid, p_kind text, p_name text, p_number text, p_daily_limit numeric, p_monthly_limit numeric,
  p_min_balance numeric, p_active boolean default true)
returns uuid
language plpgsql security definer set search_path = public as $$
declare aid uuid; br uuid;
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('account_move', 30, 60);
  if p_kind not in ('wallet','machine') then raise exception 'invalid account'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'invalid account'; end if;
  if coalesce(p_daily_limit, 1) <= 0 or coalesce(p_monthly_limit, 1) <= 0 or coalesce(p_min_balance, 0) < 0 then raise exception 'invalid amount'; end if;
  br := (select b.id from public.branches b where b.is_active order by b.created_at limit 1);
  if exists (select 1 from public.money_accounts a where a.branch_id = br and a.kind = p_kind and a.name = trim(p_name) and a.id is distinct from p_id) then
    raise exception 'account name exists';
  end if;
  if p_id is null then
    insert into public.money_accounts(branch_id, kind, name, number, daily_limit, monthly_limit, min_balance)
    values (br, p_kind, trim(p_name), nullif(trim(coalesce(p_number, '')), ''), round(p_daily_limit, 2), round(p_monthly_limit, 2), round(coalesce(p_min_balance, 0), 2))
    returning money_accounts.id into aid;
  else
    update public.money_accounts a set name = trim(p_name), number = nullif(trim(coalesce(p_number, '')), ''),
      daily_limit = round(p_daily_limit, 2), monthly_limit = round(p_monthly_limit, 2),
      min_balance = round(coalesce(p_min_balance, 0), 2), is_active = coalesce(p_active, a.is_active)
     where a.id = p_id returning a.id into aid;
    if aid is null then raise exception 'invalid account'; end if;
  end if;
  return aid;
end $$;

-- Set the real balance (first time = opening balance). Owner/manager, written reason, PIN above the threshold.
create or replace function public.adjust_account(p_account uuid, p_target numeric, p_note text, p_idem uuid, p_override uuid default null)
returns numeric
language plpgsql security definer set search_path = public as $$
declare a public.money_accounts; bal numeric(14,2); delta numeric(14,2); thr numeric; first boolean;
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_idem is null then raise exception 'idempotency key required'; end if;
  if exists (select 1 from public.account_movements where idempotency_key = p_idem) then
    return (select coalesce(sum(amount), 0) from public.account_movements where account_id = p_account);
  end if;
  perform public.enforce_rate_limit('account_move', 30, 60);
  if coalesce(trim(p_note), '') = '' then raise exception 'reason required'; end if;
  if p_target is null or p_target < 0 then raise exception 'invalid amount'; end if;
  select * into a from public.money_accounts where id = p_account and is_active for update;
  if not found then raise exception 'invalid account'; end if;
  first := not exists (select 1 from public.account_movements where account_id = a.id);
  select coalesce(sum(amount), 0) into bal from public.account_movements where account_id = a.id;
  delta := round(p_target, 2) - bal;
  if delta = 0 then raise exception 'no change'; end if;
  thr := coalesce((select value from public.app_settings where key = 'drawer_transfer_pin_threshold'), 5000);
  if abs(delta) >= thr and not public.has_role('owner') then
    if p_override is null then raise exception 'override required'; end if;
    perform public.consume_override(p_override);
  end if;
  insert into public.account_movements(account_id, amount, kind, note, idempotency_key)
  values (a.id, delta, case when first then 'opening' else 'adjustment' end, trim(p_note), p_idem);
  return round(p_target, 2);
end $$;

-- Move money between two accounts. Counts toward the source account's daily and monthly limits.
create or replace function public.transfer_account(p_from uuid, p_to uuid, p_amount numeric, p_note text, p_idem uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare f public.money_accounts; t public.money_accounts; amt numeric(14,2); bal numeric(14,2); g uuid;
        today date := (now() at time zone 'Africa/Cairo')::date; used numeric(14,2);
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_idem is null then raise exception 'idempotency key required'; end if;
  select group_id into g from public.account_movements where idempotency_key = p_idem;
  if found then return g; end if;
  g := gen_random_uuid();
  perform public.enforce_rate_limit('account_move', 30, 60);
  if p_from is null or p_to is null or p_from = p_to then raise exception 'invalid account'; end if;
  if p_amount is null or round(p_amount, 2) <= 0 then raise exception 'invalid amount'; end if;
  amt := round(p_amount, 2);
  -- lock in a fixed order so two opposite transfers cannot deadlock
  perform 1 from public.money_accounts where id in (p_from, p_to) order by id for update;
  select * into f from public.money_accounts where id = p_from and is_active;
  if not found then raise exception 'invalid account'; end if;
  select * into t from public.money_accounts where id = p_to and is_active;
  if not found or t.branch_id <> f.branch_id then raise exception 'invalid account'; end if;
  select coalesce(sum(amount), 0) into bal from public.account_movements where account_id = f.id;
  if bal - amt < f.min_balance then raise exception 'insufficient account balance'; end if;
  if f.daily_limit is not null then
    select coalesce(sum(abs(amount)), 0) into used from public.account_movements
     where account_id = f.id and kind in ('transfer_out','wallet_send','wallet_receive')
       and (created_at at time zone 'Africa/Cairo')::date = today;
    if used + amt > f.daily_limit then raise exception 'account daily limit exceeded'; end if;
  end if;
  if f.monthly_limit is not null then
    select coalesce(sum(abs(amount)), 0) into used from public.account_movements
     where account_id = f.id and kind in ('transfer_out','wallet_send','wallet_receive')
       and date_trunc('month', created_at at time zone 'Africa/Cairo') = date_trunc('month', today::timestamp);
    if used + amt > f.monthly_limit then raise exception 'account monthly limit exceeded'; end if;
  end if;
  insert into public.account_movements(account_id, amount, kind, group_id, note, idempotency_key)
  values (f.id, -amt, 'transfer_out', g, nullif(trim(coalesce(p_note, '')), ''), p_idem);
  insert into public.account_movements(account_id, amount, kind, group_id, note)
  values (t.id, amt, 'transfer_in', g, nullif(trim(coalesce(p_note, '')), ''));
  return g;
end $$;

-- ---------- drawer ledger: new kinds ----------
alter table public.drawer_movements drop constraint drawer_movements_kind_check;
alter table public.drawer_movements add constraint drawer_movements_kind_check check (kind in
  ('opening_adjust','closing_adjust','sale','refund','expense','supplier_payment','transfer_in','transfer_out',
   'adjustment','repair_payment','repair_refund','debt_collection','debt_refund','cash_add','cash_withdraw'));

-- Add cash to a drawer / take cash out of it (owner or manager, reason, PIN above the threshold).
create or replace function public.move_drawer_cash(
  p_drawer uuid, p_type text, p_amount numeric, p_note text, p_idem uuid, p_override uuid default null)
returns numeric
language plpgsql security definer set search_path = public as $$
declare d public.drawers; s public.cash_sessions; bal numeric(14,2); amt numeric(14,2); thr numeric;
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_idem is null then raise exception 'idempotency key required'; end if;
  if exists (select 1 from public.drawer_movements where idempotency_key = p_idem) then
    return (select coalesce(sum(amount), 0) from public.drawer_movements where drawer_id = p_drawer);
  end if;
  perform public.enforce_rate_limit('drawer_move', 30, 60);
  if p_type not in ('add','withdraw') then raise exception 'invalid drawers'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'reason required'; end if;
  if p_amount is null or round(p_amount, 2) <= 0 then raise exception 'invalid amount'; end if;
  amt := round(p_amount, 2);
  select * into d from public.drawers where id = p_drawer and is_active for update;
  if not found then raise exception 'invalid drawers'; end if;
  select * into s from public.cash_sessions where branch_id = d.branch_id and status = 'open';
  if not found then raise exception 'no open cash session'; end if;
  select coalesce(sum(amount), 0) into bal from public.drawer_movements where drawer_id = d.id;
  if p_type = 'withdraw' and bal < amt then raise exception 'insufficient drawer balance'; end if;
  thr := coalesce((select value from public.app_settings where key = 'drawer_transfer_pin_threshold'), 5000);
  if amt >= thr and not public.has_role('owner') then
    if p_override is null then raise exception 'override required'; end if;
    perform public.consume_override(p_override);
  end if;
  insert into public.drawer_movements(drawer_id, session_id, amount, kind, ref_type, ref_id, note, idempotency_key)
  values (d.id, s.id, case when p_type = 'add' then amt else -amt end,
          case when p_type = 'add' then 'cash_add' else 'cash_withdraw' end, 'drawer', d.id::text, trim(p_note), p_idem);
  return bal + case when p_type = 'add' then amt else -amt end;
end $$;

-- ---------- payment source: which drawer (cash) or which account (non-cash) ----------
alter table public.expense_payments add column drawer_code text, add column account_id uuid references public.money_accounts(id);
alter table public.supplier_payments add column drawer_code text, add column account_id uuid references public.money_accounts(id);

-- The *_from wrappers pass the choice through transaction-local settings; it is saved on the payment row,
-- so a supplier payment that waits for approval still uses the chosen source when it completes.
create or replace function public.set_payment_source()
returns trigger language plpgsql security definer set search_path = public as $$
declare dc text := nullif(current_setting('app.pay_drawer', true), '');
        ac text := nullif(current_setting('app.pay_account', true), '');
begin
  if new.method = 'cash' and dc is not null then
    if not exists (select 1 from public.drawers d where d.code = dc and d.is_active) then raise exception 'invalid drawers'; end if;
    if dc = 'safe' and not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
    new.drawer_code := dc;
  elsif new.method <> 'cash' and ac is not null then
    if not exists (select 1 from public.money_accounts a where a.id = ac::uuid and a.is_active) then raise exception 'invalid account'; end if;
    new.account_id := ac::uuid;
  end if;
  return new;
end $$;
create trigger set_payment_source before insert on public.expense_payments
  for each row execute function public.set_payment_source();
create trigger set_payment_source before insert on public.supplier_payments
  for each row execute function public.set_payment_source();

create or replace function public.mirror_cash_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare br uuid; sess uuid; amt numeric(14,2); k text; rt text; rid text; d uuid;
        dcode text := 'products'; chosen boolean := false; acct uuid; m text := 'cash'; bal numeric(14,2); a public.money_accounts;
begin
  if tg_table_name = 'sales_payments' then
    if new.method <> 'cash' then return new; end if;
    sess := new.session_id; amt := new.amount; k := 'sale'; rt := 'sales_invoice'; rid := new.invoice_id::text;
  elsif tg_table_name = 'sales_refunds' then
    if new.method <> 'cash' then return new; end if;
    sess := new.session_id; amt := -new.amount; k := 'refund'; rt := 'sales_return'; rid := new.return_id::text;
  elsif tg_table_name = 'expense_payments' then
    m := new.method; acct := new.account_id; chosen := new.drawer_code is not null; dcode := coalesce(new.drawer_code, 'products');
    sess := new.session_id; amt := -new.amount; k := 'expense'; rt := 'expense'; rid := new.expense_id::text;
  elsif tg_table_name = 'supplier_payments' then
    if new.status <> 'completed' then return new; end if;
    if tg_op = 'UPDATE' then
      if old.status = 'completed' then return new; end if;
    end if;
    m := new.method; acct := new.account_id; chosen := new.drawer_code is not null; dcode := coalesce(new.drawer_code, 'products');
    sess := new.session_id; amt := -new.amount; k := 'supplier_payment'; rt := 'supplier_payment'; rid := new.id::text;
  else
    return new;
  end if;

  if m <> 'cash' then
    if acct is null then return new; end if;            -- non-cash with no account chosen: nothing to move
    select * into a from public.money_accounts where id = acct for update;
    select coalesce(sum(amount), 0) into bal from public.account_movements where account_id = acct;
    if bal + amt < a.min_balance then raise exception 'insufficient account balance'; end if;
    insert into public.account_movements(account_id, amount, kind, ref_type, ref_id) values (acct, amt, k, rt, rid);
    return new;
  end if;

  br := coalesce((select branch_id from public.cash_sessions where id = sess),
                 (select id from public.branches where is_active order by created_at limit 1));
  perform public.ensure_drawers(br);
  select id into d from public.drawers where branch_id = br and code = dcode;
  if chosen then
    select coalesce(sum(amount), 0) into bal from public.drawer_movements where drawer_id = d;
    if bal + amt < 0 then raise exception 'insufficient drawer balance'; end if;
  end if;
  insert into public.drawer_movements(drawer_id, session_id, amount, kind, ref_type, ref_id)
  values (d, sess, amt, k, rt, rid);
  return new;
end $$;
revoke all on function public.mirror_cash_movement() from public, anon, authenticated;
revoke all on function public.set_payment_source() from public, anon, authenticated;

create or replace function public.pay_expense_from(
  p_expense uuid, p_amount numeric, p_method text, p_note text, p_drawer text default null, p_account uuid default null)
returns public.expense_payments
language plpgsql security definer set search_path = public as $$
declare pay public.expense_payments;
begin
  perform set_config('app.pay_drawer', coalesce(p_drawer, ''), true);
  perform set_config('app.pay_account', coalesce(p_account::text, ''), true);
  pay := public.pay_expense(p_expense, p_amount, p_method, p_note);
  perform set_config('app.pay_drawer', '', true);
  perform set_config('app.pay_account', '', true);
  return pay;
end $$;

create or replace function public.pay_supplier_from(
  p_supplier uuid, p_invoice uuid, p_amount numeric, p_method text, p_note text,
  p_drawer text default null, p_account uuid default null)
returns public.supplier_payments
language plpgsql security definer set search_path = public as $$
declare pay public.supplier_payments;
begin
  perform set_config('app.pay_drawer', coalesce(p_drawer, ''), true);
  perform set_config('app.pay_account', coalesce(p_account::text, ''), true);
  pay := public.pay_supplier(p_supplier, p_invoice, p_amount, p_method, p_note);
  perform set_config('app.pay_drawer', '', true);
  perform set_config('app.pay_account', '', true);
  return pay;
end $$;

-- Debt collection: choose the drawer for cash, or the account for wallet / card / transfer.
drop function public.collect_customer_debt(uuid, numeric, text, text, uuid);
create or replace function public.collect_customer_debt(
  p_customer uuid, p_amount numeric, p_method text, p_note text, p_idem uuid,
  p_drawer text default 'products', p_account uuid default null)
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
    if coalesce(p_drawer, 'products') = 'safe' and not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
    select id into d from public.drawers where branch_id = br and code = coalesce(p_drawer, 'products') and is_active;
    if d is null then raise exception 'invalid drawers'; end if;
  elsif p_account is not null then
    if not exists (select 1 from public.money_accounts a where a.id = p_account and a.is_active) then raise exception 'invalid account'; end if;
  end if;
  insert into public.customer_ledger(customer_id, amount, kind, method, session_id, note, idempotency_key)
  values (p_customer, -amt, 'payment', p_method, sess, nullif(trim(coalesce(p_note, '')), ''), p_idem)
  returning id into lid;
  if p_method = 'cash' then
    insert into public.drawer_movements(drawer_id, session_id, amount, kind, ref_type, ref_id, note)
    values (d, sess, amt, 'debt_collection', 'customer_ledger', lid::text, cu.code || ' ' || cu.name);
  elsif p_account is not null then
    insert into public.account_movements(account_id, amount, kind, ref_type, ref_id, note)
    values (p_account, amt, 'debt_collection', 'customer_ledger', lid::text, cu.code || ' ' || cu.name);
  end if;
  return lid;
end $$;

-- A reversal must take the money back from where the collection put it.
create or replace function public.reverse_customer_entry(p_id bigint, p_reason text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare e public.customer_ledger; lid bigint; sess uuid; d uuid; dbal numeric(14,2); acct uuid; a public.money_accounts;
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('customer_payment', 30, 60);
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason required'; end if;
  select * into e from public.customer_ledger where id = p_id for update;
  if not found or e.kind not in ('payment','manual_debt') then raise exception 'entry cannot be reversed'; end if;
  if exists (select 1 from public.customer_ledger where reverses = p_id) then raise exception 'entry already reversed'; end if;
  if e.kind = 'payment' then
    select m.drawer_id into d from public.drawer_movements m
     where m.ref_type = 'customer_ledger' and m.ref_id = p_id::text and m.kind = 'debt_collection';
    select m.account_id into acct from public.account_movements m
     where m.ref_type = 'customer_ledger' and m.ref_id = p_id::text and m.kind = 'debt_collection';
    if d is not null then
      select s.id into sess from public.cash_sessions s join public.drawers dr on dr.branch_id = s.branch_id
       where dr.id = d and s.status = 'open';
      if sess is null then raise exception 'no open cash session'; end if;
      select coalesce(sum(amount), 0) into dbal from public.drawer_movements where drawer_id = d;
      if dbal < -e.amount then raise exception 'insufficient drawer balance'; end if;
    elsif acct is not null then
      select * into a from public.money_accounts where id = acct for update;
      select coalesce(sum(amount), 0) into dbal from public.account_movements where account_id = acct;
      if dbal + e.amount < a.min_balance then raise exception 'insufficient account balance'; end if;
    end if;
  end if;
  insert into public.customer_ledger(customer_id, amount, kind, method, session_id, note, reverses)
  values (e.customer_id, -e.amount, 'reversal', e.method, sess, trim(p_reason), p_id) returning id into lid;
  if d is not null then
    insert into public.drawer_movements(drawer_id, session_id, amount, kind, ref_type, ref_id, note)
    values (d, sess, e.amount, 'debt_refund', 'customer_ledger', lid::text, trim(p_reason));
  elsif acct is not null then
    insert into public.account_movements(account_id, amount, kind, ref_type, ref_id, note)
    values (acct, e.amount, 'debt_refund', 'customer_ledger', lid::text, trim(p_reason));
  end if;
  return lid;
end $$;

-- ---------- shift number and shift alerts ----------
create sequence public.shift_seq;
alter table public.cash_sessions add column shift_no bigint not null default nextval('public.shift_seq');
create unique index on public.cash_sessions (shift_no);

create table public.shift_alerts (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.cash_sessions(id),
  phase text not null check (phase in ('open','close')),
  drawer_code text not null,
  difference numeric(14,2) not null,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  unique (session_id, phase, drawer_code)
);
alter table public.shift_alerts enable row level security;
create policy shift_alerts_read on public.shift_alerts for select to authenticated
  using (public.has_any_role(array['owner','manager','accountant']::public.app_role[]));

create or replace function public.raise_shift_alerts()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.opening_counts is not null and (tg_op = 'INSERT' or new.opening_counts is distinct from old.opening_counts) then
    for r in select key, (value->>'difference')::numeric as diff from jsonb_each(new.opening_counts)
              where jsonb_typeof(value) = 'object' and coalesce((value->>'difference')::numeric, 0) <> 0 loop
      insert into public.shift_alerts(session_id, phase, drawer_code, difference) values (new.id, 'open', r.key, r.diff)
      on conflict do nothing;
    end loop;
  end if;
  if new.closing_counts is not null and (tg_op = 'INSERT' or new.closing_counts is distinct from old.closing_counts) then
    for r in select key, (value->>'difference')::numeric as diff from jsonb_each(new.closing_counts)
              where jsonb_typeof(value) = 'object' and coalesce((value->>'difference')::numeric, 0) <> 0 loop
      insert into public.shift_alerts(session_id, phase, drawer_code, difference) values (new.id, 'close', r.key, r.diff)
      on conflict do nothing;
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.raise_shift_alerts() from public, anon, authenticated;
create trigger raise_shift_alerts after insert or update on public.cash_sessions
  for each row execute function public.raise_shift_alerts();

-- The person who ran the shift cannot review their own difference.
create or replace function public.review_shift_alert(p_id bigint, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare al public.shift_alerts; s public.cash_sessions;
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'reason required'; end if;
  select * into al from public.shift_alerts where id = p_id for update;
  if not found or al.reviewed_at is not null then raise exception 'alert already reviewed'; end if;
  select * into s from public.cash_sessions where id = al.session_id;
  if coalesce(s.opened_for, s.opened_by) = auth.uid() and not public.has_role('owner') then raise exception 'requester cannot approve'; end if;
  update public.shift_alerts set reviewed_by = auth.uid(), reviewed_at = now(), review_note = trim(p_note) where id = p_id;
end $$;

-- ---------- balance control log ----------
create view public.balance_control_log with (security_invoker = true) as
  select * from (
    select 'drawer'::text as scope, 'D' || m.id as id, d.name as target, m.kind, m.amount,
           (sum(m.amount) over (partition by m.drawer_id order by m.id) - m.amount)::numeric(14,2) as balance_before,
           (sum(m.amount) over (partition by m.drawer_id order by m.id))::numeric(14,2) as balance_after,
           m.note, m.created_by, m.created_at
      from public.drawer_movements m join public.drawers d on d.id = m.drawer_id
    union all
    select 'account', 'A' || m.id, a.name, m.kind, m.amount,
           (sum(m.amount) over (partition by m.account_id order by m.id) - m.amount)::numeric(14,2),
           (sum(m.amount) over (partition by m.account_id order by m.id))::numeric(14,2),
           m.note, m.created_by, m.created_at
      from public.account_movements m join public.money_accounts a on a.id = m.account_id
  ) x
  where x.kind in ('opening_adjust','closing_adjust','transfer_in','transfer_out','adjustment','cash_add','cash_withdraw','opening');

-- ---------- grants ----------
revoke all on function public.account_balances() from public, anon;
revoke all on function public.save_money_account(uuid, text, text, text, numeric, numeric, numeric, boolean) from public, anon;
revoke all on function public.adjust_account(uuid, numeric, text, uuid, uuid) from public, anon;
revoke all on function public.transfer_account(uuid, uuid, numeric, text, uuid) from public, anon;
revoke all on function public.move_drawer_cash(uuid, text, numeric, text, uuid, uuid) from public, anon;
revoke all on function public.pay_expense_from(uuid, numeric, text, text, text, uuid) from public, anon;
revoke all on function public.pay_supplier_from(uuid, uuid, numeric, text, text, text, uuid) from public, anon;
revoke all on function public.collect_customer_debt(uuid, numeric, text, text, uuid, text, uuid) from public, anon;
revoke all on function public.review_shift_alert(bigint, text) from public, anon;
grant execute on function public.account_balances() to authenticated;
grant execute on function public.save_money_account(uuid, text, text, text, numeric, numeric, numeric, boolean) to authenticated;
grant execute on function public.adjust_account(uuid, numeric, text, uuid, uuid) to authenticated;
grant execute on function public.transfer_account(uuid, uuid, numeric, text, uuid) to authenticated;
grant execute on function public.move_drawer_cash(uuid, text, numeric, text, uuid, uuid) to authenticated;
grant execute on function public.pay_expense_from(uuid, numeric, text, text, text, uuid) to authenticated;
grant execute on function public.pay_supplier_from(uuid, uuid, numeric, text, text, text, uuid) to authenticated;
grant execute on function public.collect_customer_debt(uuid, numeric, text, text, uuid, text, uuid) to authenticated;
grant execute on function public.review_shift_alert(bigint, text) to authenticated;
revoke all on public.balance_control_log from anon;
grant select on public.balance_control_log to authenticated;
