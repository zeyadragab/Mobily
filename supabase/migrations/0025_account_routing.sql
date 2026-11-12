-- 0025: card / wallet / transfer money from sales, refunds and repairs lands in the chosen account.
-- Before this only expenses, supplier payments and debt collection could pick an account.
-- Needs 0024. Without an account the payment is only recorded (as before).

alter table public.sales_payments add column account_id uuid references public.money_accounts(id);
alter table public.sales_refunds add column account_id uuid references public.money_accounts(id);
alter table public.sales_returns add column refund_account_id uuid references public.money_accounts(id);
alter table public.repair_payments add column account_id uuid references public.money_accounts(id);

create or replace function public.valid_account(p uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  if p is null then return null; end if;
  if not exists (select 1 from public.money_accounts a where a.id = p and a.is_active) then raise exception 'invalid account'; end if;
  return p;
end $$;
revoke all on function public.valid_account(uuid) from public, anon, authenticated;

-- ---------- sales: each payment may carry {"account": "<uuid>"} ----------
create or replace function public.apply_sale(p_invoice uuid, p_payments jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare inv public.sales_invoices; l record; onhand int; reserved int; sess uuid; pay jsonb; wm int; n int; acct uuid;
begin
  select * into inv from public.sales_invoices where id = p_invoice for update;
  for l in select * from public.sales_invoice_lines where invoice_id = p_invoice order by variant_id loop
    perform 1 from public.variants where id = l.variant_id for update;
    select coalesce(sum(qty),0) into onhand from public.stock_movements where variant_id = l.variant_id;
    select coalesce(sum(qty),0) into reserved from public.stock_reservations
     where variant_id = l.variant_id and released_at is null and expires_at > now();
    if l.qty > onhand - reserved then raise exception 'not enough stock'; end if;
    insert into public.stock_movements(variant_id, branch_id, movement_type, qty, unit_cost, ref_type, ref_id, note)
    values (l.variant_id, inv.branch_id, 'sale', -l.qty, l.unit_cost, 'sale', inv.id, inv.invoice_number);

    if l.serials is not null then
      select warranty_months into wm from public.variants where id = l.variant_id;
      update public.devices
         set status = 'sold', sale_invoice_id = inv.id, sale_line_id = l.id, sold_at = now(),
             warranty_until = (inv.business_date + make_interval(months => wm))::date
       where variant_id = l.variant_id and serial = any(l.serials) and status = 'in_stock';
      get diagnostics n = row_count;
      if n <> l.qty then raise exception 'device not available'; end if;
      perform public.device_event(l.serials, 'sold', 'sale', inv.id, inv.invoice_number);
    end if;
  end loop;
  for pay in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    sess := null; acct := null;
    if pay->>'method' = 'cash' then
      select id into sess from public.cash_sessions where branch_id = inv.branch_id and status = 'open';
      if sess is null then raise exception 'no open cash session'; end if;
    elsif pay->>'method' <> 'credit' then
      acct := public.valid_account(nullif(pay->>'account', '')::uuid);
    end if;
    insert into public.sales_payments(invoice_id, method, amount, session_id, account_id)
    values (p_invoice, pay->>'method', round((pay->>'amount')::numeric, 2), sess, acct);
  end loop;
end $$;
revoke all on function public.apply_sale(uuid, jsonb) from public, anon, authenticated;

-- ---------- returns: the refund account is saved on the return, so a return that waits for approval keeps it ----------
create or replace function public.apply_return(p_return uuid)
returns void language plpgsql security definer set search_path = public as $$
declare ret public.sales_returns; sess uuid; rl record;
begin
  select * into ret from public.sales_returns where id = p_return for update;
  if ret.refund_total > 0 then
    if ret.refund_method = 'cash' then
      select id into sess from public.cash_sessions where branch_id = ret.branch_id and status = 'open';
      if sess is null then raise exception 'no open cash session'; end if;
    end if;
    insert into public.sales_refunds(return_id, method, amount, session_id, account_id)
    values (p_return, ret.refund_method, ret.refund_total, sess,
            case when ret.refund_method = 'cash' then null else ret.refund_account_id end);
  end if;
  for rl in select * from public.sales_return_lines where return_id = p_return and serials is not null loop
    update public.devices set status = 'inspection' where serial = any(rl.serials) and status = 'sold';
    perform public.device_event(rl.serials, 'returned', 'sale_return', p_return, ret.return_number);
  end loop;
end $$;
revoke all on function public.apply_return(uuid) from public, anon, authenticated;

create or replace function public.set_return_account()
returns trigger language plpgsql security definer set search_path = public as $$
declare ac text := nullif(current_setting('app.refund_account', true), '');
begin
  if new.refund_method <> 'cash' and ac is not null then new.refund_account_id := public.valid_account(ac::uuid); end if;
  return new;
end $$;
revoke all on function public.set_return_account() from public, anon, authenticated;
create trigger set_return_account before insert on public.sales_returns
  for each row execute function public.set_return_account();

create or replace function public.create_return_from(
  p_invoice uuid, p_lines jsonb, p_reason text, p_method text, p_account uuid default null)
returns public.sales_returns
language plpgsql security definer set search_path = public as $$
declare r public.sales_returns;
begin
  perform set_config('app.refund_account', coalesce(p_account::text, ''), true);
  r := public.create_return(p_invoice, p_lines, p_reason, p_method);
  perform set_config('app.refund_account', '', true);
  return r;
end $$;
revoke all on function public.create_return_from(uuid, jsonb, text, text, uuid) from public, anon;
grant execute on function public.create_return_from(uuid, jsonb, text, text, uuid) to authenticated;

-- ---------- one mirror for every money table ----------
create or replace function public.mirror_cash_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare br uuid; sess uuid; amt numeric(14,2); k text; rt text; rid text; d uuid;
        dcode text := 'products'; chosen boolean := false; acct uuid; m text := 'cash'; bal numeric(14,2); a public.money_accounts;
begin
  if tg_table_name = 'sales_payments' then
    m := new.method; acct := new.account_id;
    sess := new.session_id; amt := new.amount; k := 'sale'; rt := 'sales_invoice'; rid := new.invoice_id::text;
  elsif tg_table_name = 'sales_refunds' then
    m := new.method; acct := new.account_id;
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

  if m = 'credit' then return new; end if;
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

-- ---------- repairs: payment / deposit / refund with an account ----------
drop function public.record_repair_payment(uuid, numeric, text, text, text, uuid);
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
revoke all on function public.record_repair_payment(uuid, numeric, text, text, text, uuid, uuid) from public, anon;
grant execute on function public.record_repair_payment(uuid, numeric, text, text, text, uuid, uuid) to authenticated;
