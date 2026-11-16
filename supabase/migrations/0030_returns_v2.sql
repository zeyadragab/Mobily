-- 0030 (Phase 6): returns and warranty.
-- Return condition per line, refund to the customer account (credit), automatic debt reduction on credit invoices,
-- manual reduction of the refund (restocking fee) with a reason and a manager PIN for cashiers, invoice search by
-- number / phone / serial / barcode, one warranty checker for sold devices and finished repairs, returns archive.
-- Needs 0007, 0009, 0015 (override tokens), 0022 (customer ledger), 0025 (refund account).
-- Replaces the 0023 guard: returns on invoices that had a credit part are now allowed.

drop trigger if exists block_credit_invoice_return on public.sales_returns;
drop function if exists public.block_credit_invoice_return();

alter table public.sales_returns drop constraint sales_returns_refund_method_check;
alter table public.sales_returns add constraint sales_returns_refund_method_check
  check (refund_method in ('cash','card','transfer','wallet','credit'));
alter table public.sales_returns
  add column debt_reduction numeric(14,2) not null default 0 check (debt_reduction >= 0),   -- taken off the customer's debt
  add column manual_reduction numeric(14,2) not null default 0 check (manual_reduction >= 0), -- kept by the shop (e.g. restocking fee)
  add column reduction_reason text;
alter table public.sales_return_lines
  add column condition text not null default 'new' check (condition in ('new','used','damaged'));

-- ---------- create_return v2 ----------
-- Lines: {"invoice_line_id","qty"|"serials","condition"?}. Choices travel in transaction-local settings (see create_return_from):
--   app.refund_account (0025), app.return_reduction, app.return_reduction_reason, app.return_override.
create or replace function public.create_return(p_invoice uuid, p_lines jsonb, p_reason text, p_method text)
returns public.sales_returns
language plpgsql security definer set search_path = public as $$
declare
  inv public.sales_invoices; ret public.sales_returns; it record; l public.sales_invoice_lines;
  already int; ratio numeric; refund numeric(14,2) := 0; thr numeric; need_appr boolean; req uuid;
  q int; s text[]; cnt int; cond text;
  red numeric(14,2) := coalesce(nullif(current_setting('app.return_reduction', true), '')::numeric, 0);
  red_reason text := nullif(trim(coalesce(current_setting('app.return_reduction_reason', true), '')), '');
  tok uuid := nullif(current_setting('app.return_override', true), '')::uuid;
  is_boss boolean := public.has_any_role(array['owner','manager']::public.app_role[]);
  net numeric(14,2); dred numeric(14,2) := 0; payout numeric(14,2); credit_paid numeric(14,2); prior numeric(14,2); bal numeric(14,2);
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'reason required'; end if;
  if p_method not in ('cash','card','transfer','wallet','credit') then raise exception 'invalid payment method'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'no lines'; end if;

  select * into inv from public.sales_invoices where id = p_invoice for update;
  if not found or inv.status <> 'completed' then raise exception 'invoice not returnable'; end if;
  if p_method = 'credit' and inv.customer_id is null then raise exception 'customer required for credit refund'; end if;
  ratio := case when inv.subtotal > 0 then inv.total / inv.subtotal else 1 end;

  insert into public.sales_returns(invoice_id, branch_id, reason, refund_method)
  values (p_invoice, inv.branch_id, trim(p_reason), p_method) returning * into ret;

  for it in select value as x from jsonb_array_elements(p_lines) order by value->>'invoice_line_id' loop
    select * into l from public.sales_invoice_lines where id = (it.x->>'invoice_line_id')::uuid and invoice_id = p_invoice for update;
    if not found then raise exception 'line does not belong to invoice'; end if;
    cond := coalesce(nullif(it.x->>'condition', ''), 'new');
    if cond not in ('new','used','damaged') then raise exception 'invalid condition'; end if;
    s := null;
    if l.serials is not null then
      s := public.parse_serials(it.x->'serials');
      q := coalesce(array_length(s, 1), 0);
      if q < 1 then raise exception 'serial numbers required'; end if;
      if not (s <@ l.serials) then raise exception 'device does not belong to this line'; end if;
      select count(*) into cnt from public.devices where serial = any(s) and sale_line_id = l.id and status = 'sold';
      if cnt <> q then raise exception 'device does not belong to this line'; end if;
      if exists (select 1 from public.sales_return_lines rl join public.sales_returns r on r.id = rl.return_id
                  where rl.invoice_line_id = l.id and r.status = 'pending_approval' and rl.serials && s) then
        raise exception 'device is in a pending return';
      end if;
    else
      q := (it.x->>'qty')::int;
      if q is null or q < 1 then raise exception 'invalid quantity'; end if;
    end if;
    select coalesce(sum(rl.qty), 0) into already
      from public.sales_return_lines rl join public.sales_returns r on r.id = rl.return_id
     where rl.invoice_line_id = l.id and r.status in ('completed','pending_approval') and r.id <> ret.id;
    if already + q > l.qty then raise exception 'return exceeds sold quantity'; end if;
    insert into public.sales_return_lines(return_id, invoice_line_id, variant_id, name_snapshot, qty, unit_price, unit_cost, serials, condition)
    values (ret.id, l.id, l.variant_id, l.name_snapshot, q, l.unit_price, l.unit_cost, s, cond);
    refund := refund + round(q * l.unit_price * ratio, 2);
  end loop;

  -- manual reduction (the shop keeps part of the refund)
  if red < 0 or red > refund then raise exception 'invalid reduction'; end if;
  if red > 0 then
    if red_reason is null then raise exception 'reduction reason required'; end if;
    if not is_boss then
      if tok is null then raise exception 'override required'; end if;
      perform public.consume_override(tok);
    end if;
  end if;
  net := refund - red;

  -- credit: to the customer's account, or automatically against what is still owed on this invoice
  if p_method = 'credit' then
    dred := net;
  elsif inv.customer_id is not null then
    select coalesce(sum(amount), 0) into credit_paid from public.sales_payments where invoice_id = p_invoice and method = 'credit';
    select coalesce(sum(debt_reduction), 0) into prior from public.sales_returns
     where invoice_id = p_invoice and status in ('completed','pending_approval') and id <> ret.id;
    select coalesce(sum(amount), 0) into bal from public.customer_ledger where customer_id = inv.customer_id;
    dred := greatest(0, least(net, credit_paid - prior, bal));
  end if;
  payout := net - dred;

  thr := coalesce((select value from public.app_settings where key = 'return_approval_threshold'), 2000);
  need_appr := not public.has_role('owner') and (not public.has_role('manager') or net >= thr);

  update public.sales_returns
     set refund_total = payout, debt_reduction = dred, manual_reduction = red, reduction_reason = case when red > 0 then red_reason end,
         status = case when need_appr then 'pending_approval' else 'completed' end
   where id = ret.id returning * into ret;

  if need_appr then
    insert into public.approval_requests
      (action_type, subject_entity, subject_id, requested_by, amount, reason, payload_hash, idempotency_key, branch_id)
    values ('sale.return', 'sale_return', ret.id, auth.uid(), net,
            'مرتجع ' || ret.return_number || ' على فاتورة ' || inv.invoice_number || ' بقيمة ' || net || ' - ' || trim(p_reason),
            md5(ret.id::text || ':' || net), 'return-' || ret.id || '-v1', ret.branch_id)
    returning id into req;
    update public.sales_returns set approval_id = req where id = ret.id returning * into ret;
  else
    perform public.apply_return(ret.id);
  end if;
  return ret;
end $$;

-- the debt part is booked when the return is applied (immediately, or at approval)
create or replace function public.apply_return(p_return uuid)
returns void language plpgsql security definer set search_path = public as $$
declare ret public.sales_returns; sess uuid; rl record; inv public.sales_invoices;
begin
  select * into ret from public.sales_returns where id = p_return for update;
  select * into inv from public.sales_invoices where id = ret.invoice_id;
  if ret.refund_total > 0 then
    if ret.refund_method = 'cash' then
      select id into sess from public.cash_sessions where branch_id = ret.branch_id and status = 'open';
      if sess is null then raise exception 'no open cash session'; end if;
    end if;
    insert into public.sales_refunds(return_id, method, amount, session_id, account_id)
    values (p_return, ret.refund_method, ret.refund_total, sess,
            case when ret.refund_method = 'cash' then null else ret.refund_account_id end);
  end if;
  if ret.debt_reduction > 0 then
    insert into public.customer_ledger(customer_id, amount, kind, ref_type, ref_id, note)
    values (inv.customer_id, -ret.debt_reduction, 'return_credit', 'sales_return', ret.id::text, ret.return_number || ' / ' || inv.invoice_number);
  end if;
  for rl in select * from public.sales_return_lines where return_id = p_return and serials is not null loop
    update public.devices set status = 'inspection' where serial = any(rl.serials) and status = 'sold';
    perform public.device_event(rl.serials, 'returned', 'sale_return', p_return, ret.return_number);
  end loop;
end $$;
revoke all on function public.apply_return(uuid) from public, anon, authenticated;

-- create_return_from v2: refund account (0025) plus the manual reduction and its PIN token
drop function public.create_return_from(uuid, jsonb, text, text, uuid);
create or replace function public.create_return_from(
  p_invoice uuid, p_lines jsonb, p_reason text, p_method text, p_account uuid default null,
  p_reduction numeric default 0, p_reduction_reason text default null, p_override uuid default null)
returns public.sales_returns
language plpgsql security definer set search_path = public as $$
declare r public.sales_returns;
begin
  perform public.enforce_rate_limit('create_return', 30, 60);
  perform set_config('app.refund_account', coalesce(p_account::text, ''), true);
  perform set_config('app.return_reduction', coalesce(round(p_reduction, 2), 0)::text, true);
  perform set_config('app.return_reduction_reason', coalesce(p_reduction_reason, ''), true);
  perform set_config('app.return_override', coalesce(p_override::text, ''), true);
  r := public.create_return(p_invoice, p_lines, p_reason, p_method);
  perform set_config('app.refund_account', '', true);
  perform set_config('app.return_reduction', '', true);
  perform set_config('app.return_reduction_reason', '', true);
  perform set_config('app.return_override', '', true);
  return r;
end $$;
revoke all on function public.create_return_from(uuid, jsonb, text, text, uuid, numeric, text, uuid) from public, anon;
grant execute on function public.create_return_from(uuid, jsonb, text, text, uuid, numeric, text, uuid) to authenticated;

-- ---------- find an invoice to return: number, phone, device serial / IMEI, or barcode ----------
create or replace function public.find_returnable_invoices(p_term text)
returns setof uuid language sql stable set search_path = public as $$
  select i.id from public.sales_invoices i
   where i.status = 'completed' and char_length(trim(coalesce(p_term, ''))) >= 3
     and (i.invoice_number ilike '%' || trim(p_term) || '%'
          or i.customer_phone like trim(p_term) || '%'
          or i.customer_name ilike '%' || trim(p_term) || '%'
          or exists (select 1 from public.sales_invoice_lines l where l.invoice_id = i.id and l.serials @> array[public.norm_serial(p_term)])
          or exists (select 1 from public.sales_invoice_lines l join public.variants v on v.id = l.variant_id where l.invoice_id = i.id and v.barcode = trim(p_term)))
   order by i.created_at desc limit 20 $$;
grant execute on function public.find_returnable_invoices(text) to authenticated;

-- ---------- one warranty checker: sold devices and finished repairs ----------
create or replace function public.check_warranty(p_term text)
returns table(kind text, ref text, item text, customer text, since date, warranty_until date, is_valid boolean, days_left int, serial text)
language plpgsql stable security definer set search_path = public as $$
declare t text := upper(trim(coalesce(p_term, ''))); today date := (now() at time zone 'Africa/Cairo')::date;
begin
  if not public.has_any_role(array['owner','manager','cashier','accountant','technician']::public.app_role[]) then raise exception 'not allowed'; end if;
  if char_length(t) < 5 or char_length(t) > 40 then raise exception 'invalid search'; end if;
  return query
    select 'sale'::text, i.invoice_number, (pr.name || coalesce(' ' || v.storage, '') || coalesce(' ' || v.color, ''))::text,
           coalesce(i.customer_name, ''), d.sold_at::date, d.warranty_until,
           (d.warranty_until is not null and d.warranty_until >= today), greatest(0, coalesce(d.warranty_until - today, 0)), d.serial
      from public.devices d
      join public.variants v on v.id = d.variant_id join public.products pr on pr.id = v.product_id
      join public.sales_invoices i on i.id = d.sale_invoice_id
     where d.status = 'sold' and (d.serial = public.norm_serial(t) or upper(i.invoice_number) = t)
     order by d.sold_at desc limit 10;
  return query
    select 'repair'::text, 'RP-' || r.order_number::text, r.device_model, r.customer_name, r.delivered_at::date, r.warranty_until,
           (r.warranty_until is not null and r.warranty_until >= today), greatest(0, coalesce(r.warranty_until - today, 0)),
           coalesce(r.imei1, r.serial)
      from public.repair_orders r
     where r.delivered_at is not null and public.can_access_repairs(r.branch_id, false)
       and (r.identifiers @> array[t] or ('RP-' || r.order_number::text) = t)
     order by r.delivered_at desc limit 5;
end $$;
revoke all on function public.check_warranty(text) from public, anon;
grant execute on function public.check_warranty(text) to authenticated;

-- ---------- returns archive ----------
create view public.returns_archive with (security_invoker = true) as
  select r.id, r.return_number, r.business_date, r.created_at, r.status, r.reason, r.refund_method, r.refund_total, r.debt_reduction,
         r.manual_reduction, r.reduction_reason, r.created_by, i.invoice_number, i.customer_name, i.customer_phone,
         (select coalesce(sum(l.qty), 0) from public.sales_return_lines l where l.return_id = r.id)::int as items,
         (select count(*) from public.sales_return_lines l where l.return_id = r.id and l.disposition = 'inspection')::int as pending_inspection
    from public.sales_returns r join public.sales_invoices i on i.id = r.invoice_id;
revoke all on public.returns_archive from public, anon;
grant select on public.returns_archive to authenticated;
