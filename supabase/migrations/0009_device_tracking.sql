-- 0009: per-device (serial / IMEI) tracking for products flagged "track_serial".
-- A tracked device is received with its serial, sold by serial, returned by serial, and fully traceable.
-- Stock quantities stay in the ledger; devices add identity. Manual stock edits are blocked for tracked items.

alter table public.variants add column if not exists warranty_months int not null default 0 check (warranty_months >= 0);

create type public.device_status as enum ('in_stock','sold','inspection','damaged');

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.variants(id),
  serial text not null check (char_length(serial) between 5 and 40 and serial = upper(serial)),
  status public.device_status not null default 'in_stock',
  cost numeric(14,2) not null default 0 check (cost >= 0),
  supplier_id uuid references public.suppliers(id),
  po_id uuid references public.purchase_orders(id),
  branch_id uuid references public.branches(id),
  received_at timestamptz not null default now(),
  sale_invoice_id uuid references public.sales_invoices(id),
  sale_line_id uuid references public.sales_invoice_lines(id),
  online_order_id uuid references public.online_orders(id),
  sold_at timestamptz,
  warranty_until date,
  created_by uuid default auth.uid() references public.profiles(id)
);
create unique index devices_serial_key on public.devices (serial);
create index on public.devices (variant_id, status);
create index on public.devices (sale_line_id);

create table public.device_events (
  id bigint generated always as identity primary key,
  device_id uuid not null references public.devices(id) on delete cascade,
  event text not null,
  ref_type text,
  ref_id uuid,
  detail text,
  at timestamptz not null default clock_timestamp(),
  actor uuid default auth.uid()
);
create index on public.device_events (device_id, at);

alter table public.sales_invoice_lines add column if not exists serials text[];
alter table public.sales_return_lines add column if not exists serials text[];

-- ---------- helpers ----------
create or replace function public.norm_serial(s text) returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(s, ''), '\s+', '', 'g')) $$;

create or replace function public.parse_serials(j jsonb) returns text[]
language plpgsql immutable as $$
declare res text[] := '{}'; s text; x jsonb;
begin
  if j is null or jsonb_typeof(j) <> 'array' then return '{}'; end if;
  for x in select * from jsonb_array_elements(j) loop
    s := public.norm_serial(x #>> '{}');
    if char_length(s) < 5 or char_length(s) > 40 then raise exception 'invalid serial: %', s; end if;
    if s = any(res) then raise exception 'duplicate serial in list: %', s; end if;
    res := res || s;
  end loop;
  return res;
end $$;

create or replace function public.variant_tracked(vid uuid) returns boolean language sql stable as $$
  select coalesce((select p.track_serial from public.variants v join public.products p on p.id = v.product_id where v.id = vid), false) $$;

create or replace function public.device_event(p_serials text[], p_event text, p_ref_type text, p_ref_id uuid, p_detail text)
returns void language sql security definer set search_path = public as $$
  insert into public.device_events(device_id, event, ref_type, ref_id, detail)
  select id, p_event, p_ref_type, p_ref_id, p_detail from public.devices where serial = any(p_serials) $$;
revoke all on function public.device_event(text[], text, text, uuid, text) from public, anon, authenticated;

-- ---------- receiving: serials are required for tracked items ----------
create or replace function public.receive_purchase_order(p_po uuid, p_lines jsonb)
returns public.purchase_orders
language plpgsql security definer set search_path = public as $$
declare
  po public.purchase_orders; it jsonb; l public.purchase_order_lines;
  q int; onhand int; oc numeric; newc numeric(14,2); pending int; s text[];
begin
  if not public.has_any_role(array['owner','manager','warehouse']::public.app_role[]) then raise exception 'not allowed'; end if;
  select * into po from public.purchase_orders where id = p_po for update;
  if not found then raise exception 'order not found'; end if;
  if po.status not in ('sent','partially_received') then raise exception 'order is not open for receiving'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'no lines to receive'; end if;

  perform set_config('app.po_receiving', 'on', true);
  for it in select * from jsonb_array_elements(p_lines) loop
    q := (it->>'qty')::int;
    if q is null or q <= 0 then continue; end if;
    select * into l from public.purchase_order_lines where id = (it->>'line_id')::uuid and po_id = p_po for update;
    if not found then raise exception 'line does not belong to this order'; end if;
    if l.qty_received + q > l.qty_ordered then raise exception 'received quantity exceeds ordered quantity'; end if;

    if public.variant_tracked(l.variant_id) then
      s := public.parse_serials(it->'serials');
      if coalesce(array_length(s, 1), 0) <> q then raise exception 'serial numbers must match received quantity'; end if;
      insert into public.devices(variant_id, serial, cost, supplier_id, po_id, branch_id)
      select l.variant_id, x, l.unit_cost, po.supplier_id, p_po, po.branch_id from unnest(s) x;
      perform public.device_event(s, 'received', 'purchase_order', p_po, po.po_number);
    end if;

    select coalesce(sum(qty),0) into onhand from public.stock_movements where variant_id = l.variant_id;
    select cost into oc from public.variant_costs where variant_id = l.variant_id;
    newc := case when onhand <= 0 then l.unit_cost
                 else round((onhand * coalesce(oc,0) + q * l.unit_cost) / (onhand + q), 2) end;
    insert into public.variant_costs(variant_id, cost) values (l.variant_id, newc)
      on conflict (variant_id) do update set cost = excluded.cost, updated_at = now();
    insert into public.stock_movements(variant_id, branch_id, movement_type, qty, unit_cost, ref_type, ref_id, note)
    values (l.variant_id, po.branch_id, 'purchase_receipt', q, l.unit_cost, 'purchase_order', p_po, po.po_number);
    update public.purchase_order_lines set qty_received = qty_received + q where id = l.id;
  end loop;

  select count(*) into pending from public.purchase_order_lines where po_id = p_po and qty_received < qty_ordered;
  update public.purchase_orders
     set status = case when pending = 0 then 'received' else 'partially_received' end::public.po_status
   where id = p_po returning * into po;
  return po;
end $$;

-- ---------- stock adjustment: not for tracked items ----------
create or replace function public.adjust_stock(p_variant uuid, p_branch uuid, p_delta int, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare onhand int;
begin
  if not public.has_any_role(array['owner','manager','warehouse']::public.app_role[]) then raise exception 'not allowed'; end if;
  if public.variant_tracked(p_variant) then raise exception 'tracked variant: use device registration'; end if;
  if p_delta = 0 then raise exception 'delta must not be zero'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'reason required'; end if;
  select coalesce(sum(qty),0) into onhand from public.stock_movements where variant_id = p_variant and branch_id = p_branch;
  if onhand + p_delta < 0 then raise exception 'stock cannot go negative'; end if;
  insert into public.stock_movements(variant_id, branch_id, movement_type, qty, note) values (p_variant, p_branch, 'adjustment', p_delta, p_reason);
end $$;

-- ---------- register / write off devices ----------
-- mode 'existing': link serials to units already counted in stock (no stock change).
-- mode 'new': new stock without a purchase order (adds to stock).
create or replace function public.register_devices(p_variant uuid, p_serials jsonb, p_cost numeric, p_mode text, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare s text[]; n int; br uuid; onhand int; tracked_in int; untracked int; oc numeric; newc numeric(14,2);
begin
  if not public.has_any_role(array['owner','manager','warehouse']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_mode not in ('existing','new') then raise exception 'invalid mode'; end if;
  if not public.variant_tracked(p_variant) then raise exception 'item is not serial-tracked'; end if;
  if p_cost is null or p_cost < 0 then raise exception 'invalid cost'; end if;
  s := public.parse_serials(p_serials);
  n := coalesce(array_length(s, 1), 0);
  if n = 0 then raise exception 'serial numbers required'; end if;
  br := (select id from public.branches where is_active order by created_at limit 1);
  perform 1 from public.variants where id = p_variant for update;

  select coalesce(sum(qty),0) into onhand from public.stock_movements where variant_id = p_variant;
  select count(*) into tracked_in from public.devices where variant_id = p_variant and status = 'in_stock';
  untracked := onhand - tracked_in;

  if p_mode = 'existing' then
    if n > untracked then raise exception 'more devices than untracked stock'; end if;
  end if;

  insert into public.devices(variant_id, serial, cost, branch_id)
  select p_variant, x, round(p_cost, 2), br from unnest(s) x;
  perform public.device_event(s, 'registered', 'registration', null, coalesce(p_note, p_mode));

  if p_mode = 'new' then
    select cost into oc from public.variant_costs where variant_id = p_variant;
    newc := case when onhand <= 0 then round(p_cost, 2)
                 else round((onhand * coalesce(oc,0) + n * p_cost) / (onhand + n), 2) end;
    insert into public.variant_costs(variant_id, cost) values (p_variant, newc)
      on conflict (variant_id) do update set cost = excluded.cost, updated_at = now();
    insert into public.stock_movements(variant_id, branch_id, movement_type, qty, unit_cost, note)
    values (p_variant, br, 'adjustment', n, round(p_cost, 2), coalesce(p_note, 'تسجيل أجهزة'));
  end if;
  return n;
end $$;

create or replace function public.write_off_device(p_device uuid, p_reason text)
returns public.devices language plpgsql security definer set search_path = public as $$
declare d public.devices;
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'reason required'; end if;
  select * into d from public.devices where id = p_device for update;
  if not found or d.status <> 'in_stock' then raise exception 'device is not in stock'; end if;
  update public.devices set status = 'damaged' where id = p_device returning * into d;
  insert into public.stock_movements(variant_id, branch_id, movement_type, qty, unit_cost, note)
  values (d.variant_id, coalesce(d.branch_id, (select id from public.branches where is_active order by created_at limit 1)),
          'adjustment', -1, d.cost, 'جهاز تالف ' || d.serial || ': ' || trim(p_reason));
  perform public.device_event(array[d.serial], 'written_off', 'adjustment', null, trim(p_reason));
  return d;
end $$;

-- ---------- sales: tracked items are sold by serial ----------
create or replace function public.apply_sale(p_invoice uuid, p_payments jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare inv public.sales_invoices; l record; onhand int; reserved int; sess uuid; pay jsonb; wm int; n int;
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
    sess := null;
    if pay->>'method' = 'cash' then
      select id into sess from public.cash_sessions where branch_id = inv.branch_id and status = 'open';
      if sess is null then raise exception 'no open cash session'; end if;
    end if;
    insert into public.sales_payments(invoice_id, method, amount, session_id)
    values (p_invoice, pay->>'method', round((pay->>'amount')::numeric, 2), sess);
  end loop;
end $$;
revoke all on function public.apply_sale(uuid, jsonb) from public, anon, authenticated;

-- p_lines: [{"variant_id": "...", "qty": 2}]  or for tracked items [{"variant_id": "...", "serials": ["IMEI1", ...]}]
create or replace function public.create_sale(
  p_customer_name text, p_customer_phone text, p_discount numeric, p_notes text, p_lines jsonb, p_payments jsonb)
returns public.sales_invoices
language plpgsql security definer set search_path = public as $$
declare
  br uuid; it record; v public.variants; pr public.products; inv public.sales_invoices;
  sub numeric(14,2) := 0; disc numeric(14,2); tot numeric(14,2); lim numeric; need_appr boolean;
  ucost numeric(14,2); vname text; req uuid; q int; s text[]; cnt int;
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 50 then raise exception 'invalid lines'; end if;
  br := (select id from public.branches where is_active order by created_at limit 1);
  disc := round(coalesce(p_discount, 0), 2);
  if disc < 0 then raise exception 'invalid discount'; end if;

  insert into public.sales_invoices(branch_id, customer_name, customer_phone, notes)
  values (br, nullif(trim(coalesce(p_customer_name,'')),''), nullif(trim(coalesce(p_customer_phone,'')),''), nullif(trim(coalesce(p_notes,'')),''))
  returning * into inv;

  for it in select value as x from jsonb_array_elements(p_lines) order by value->>'variant_id' loop
    select * into v from public.variants where id = (it.x->>'variant_id')::uuid for update;
    if not found or not v.is_active then raise exception 'item unavailable'; end if;
    select * into pr from public.products where id = v.product_id;
    s := null;
    if pr.track_serial then
      s := public.parse_serials(it.x->'serials');
      q := coalesce(array_length(s, 1), 0);
      if q < 1 then raise exception 'serial numbers required'; end if;
      select count(*), coalesce(avg(d.cost), 0) into cnt, ucost
        from public.devices d where d.variant_id = v.id and d.serial = any(s) and d.status = 'in_stock';
      if cnt <> q then raise exception 'device not available'; end if;
    else
      q := (it.x->>'qty')::int;
      if q is null or q < 1 or q > 1000 then raise exception 'invalid quantity'; end if;
      select vc.cost into ucost from public.variant_costs vc where vc.variant_id = v.id;
      ucost := coalesce(ucost, 0);
    end if;
    vname := pr.name || coalesce(' ' || v.storage, '') || coalesce(' ' || v.color, '');
    insert into public.sales_invoice_lines(invoice_id, variant_id, name_snapshot, qty, unit_price, unit_cost, serials)
    values (inv.id, v.id, vname, q, v.price, round(ucost, 2), s);
    sub := sub + q * v.price;
  end loop;

  if disc > sub then raise exception 'discount exceeds subtotal'; end if;
  tot := sub - disc;
  perform public.check_payments(p_payments, tot);

  lim := coalesce((select value from public.app_settings where key = 'max_discount_pct'), 5);
  need_appr := disc > 0 and disc > sub * lim / 100 and not public.has_role('owner');

  update public.sales_invoices
     set subtotal = sub, discount = disc, total = tot,
         status = case when need_appr then 'pending_approval' else 'completed' end,
         pending_payments = case when need_appr then p_payments end
   where id = inv.id returning * into inv;

  if need_appr then
    insert into public.approval_requests
      (action_type, subject_entity, subject_id, requested_by, amount, reason, payload_hash, idempotency_key, branch_id)
    values ('sale.discount', 'sale', inv.id, auth.uid(), disc,
            'خصم ' || disc || ' على فاتورة ' || inv.invoice_number || ' (إجمالي ' || sub || ')',
            md5(inv.id::text || ':' || disc || ':' || sub), 'sale-' || inv.id || '-v1', br)
    returning id into req;
    update public.sales_invoices set approval_id = req where id = inv.id returning * into inv;
  else
    perform public.apply_sale(inv.id, p_payments);
  end if;
  return inv;
end $$;

-- ---------- returns: tracked devices go to inspection ----------
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
    insert into public.sales_refunds(return_id, method, amount, session_id) values (p_return, ret.refund_method, ret.refund_total, sess);
  end if;
  for rl in select * from public.sales_return_lines where return_id = p_return and serials is not null loop
    update public.devices set status = 'inspection' where serial = any(rl.serials) and status = 'sold';
    perform public.device_event(rl.serials, 'returned', 'sale_return', p_return, ret.return_number);
  end loop;
end $$;
revoke all on function public.apply_return(uuid) from public, anon, authenticated;

-- p_lines: [{"invoice_line_id": "...", "qty": 1}] or for tracked items [{"invoice_line_id": "...", "serials": ["..."]}]
create or replace function public.create_return(p_invoice uuid, p_lines jsonb, p_reason text, p_method text)
returns public.sales_returns
language plpgsql security definer set search_path = public as $$
declare
  inv public.sales_invoices; ret public.sales_returns; it record; l public.sales_invoice_lines;
  already int; ratio numeric; refund numeric(14,2) := 0; thr numeric; need_appr boolean; req uuid;
  q int; s text[]; cnt int;
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'reason required'; end if;
  if p_method not in ('cash','card','transfer','wallet') then raise exception 'invalid payment method'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'no lines'; end if;

  select * into inv from public.sales_invoices where id = p_invoice for update;
  if not found or inv.status <> 'completed' then raise exception 'invoice not returnable'; end if;
  ratio := case when inv.subtotal > 0 then inv.total / inv.subtotal else 1 end;

  insert into public.sales_returns(invoice_id, branch_id, reason, refund_method)
  values (p_invoice, inv.branch_id, trim(p_reason), p_method) returning * into ret;

  for it in select value as x from jsonb_array_elements(p_lines) order by value->>'invoice_line_id' loop
    select * into l from public.sales_invoice_lines where id = (it.x->>'invoice_line_id')::uuid and invoice_id = p_invoice for update;
    if not found then raise exception 'line does not belong to invoice'; end if;
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
    insert into public.sales_return_lines(return_id, invoice_line_id, variant_id, name_snapshot, qty, unit_price, unit_cost, serials)
    values (ret.id, l.id, l.variant_id, l.name_snapshot, q, l.unit_price, l.unit_cost, s);
    refund := refund + round(q * l.unit_price * ratio, 2);
  end loop;

  thr := coalesce((select value from public.app_settings where key = 'return_approval_threshold'), 2000);
  need_appr := not public.has_role('owner') and (not public.has_role('manager') or refund >= thr);

  update public.sales_returns set refund_total = refund, status = case when need_appr then 'pending_approval' else 'completed' end
   where id = ret.id returning * into ret;

  if need_appr then
    insert into public.approval_requests
      (action_type, subject_entity, subject_id, requested_by, amount, reason, payload_hash, idempotency_key, branch_id)
    values ('sale.return', 'sale_return', ret.id, auth.uid(), refund,
            'مرتجع ' || ret.return_number || ' على فاتورة ' || inv.invoice_number || ' بقيمة ' || refund || ' - ' || trim(p_reason),
            md5(ret.id::text || ':' || refund), 'return-' || ret.id || '-v1', ret.branch_id)
    returning id into req;
    update public.sales_returns set approval_id = req where id = ret.id returning * into ret;
  else
    perform public.apply_return(ret.id);
  end if;
  return ret;
end $$;

create or replace function public.resolve_return_line(p_line uuid, p_result text)
returns public.sales_return_lines
language plpgsql security definer set search_path = public as $$
declare l public.sales_return_lines; ret public.sales_returns;
begin
  if not public.has_any_role(array['owner','manager','warehouse']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_result not in ('sellable','damaged') then raise exception 'invalid result'; end if;
  select * into l from public.sales_return_lines where id = p_line for update;
  if not found then raise exception 'line not found'; end if;
  select * into ret from public.sales_returns where id = l.return_id;
  if ret.status <> 'completed' or l.disposition <> 'inspection' then raise exception 'line is not awaiting inspection'; end if;

  if p_result = 'sellable' then
    insert into public.stock_movements(variant_id, branch_id, movement_type, qty, unit_cost, ref_type, ref_id, note)
    values (l.variant_id, ret.branch_id, 'return', l.qty, l.unit_cost, 'sale_return', ret.id, ret.return_number);
  end if;
  if l.serials is not null then
    if p_result = 'sellable' then
      update public.devices set status = 'in_stock', sale_invoice_id = null, sale_line_id = null, online_order_id = null,
             sold_at = null, warranty_until = null where serial = any(l.serials) and status = 'inspection';
    else
      update public.devices set status = 'damaged' where serial = any(l.serials) and status = 'inspection';
    end if;
    perform public.device_event(l.serials, case when p_result = 'sellable' then 'inspected_sellable' else 'inspected_damaged' end,
                                'sale_return', ret.id, ret.return_number);
  end if;
  update public.sales_return_lines set disposition = p_result, resolved_by = auth.uid(), resolved_at = now()
   where id = p_line returning * into l;
  return l;
end $$;

-- ---------- web orders: tracked items need serials at delivery ----------
drop function if exists public.set_online_order_status(uuid, text, text);
-- p_serials: {"<variant_id>": ["IMEI1", ...]} for tracked items, needed when status = 'delivered'
create or replace function public.set_online_order_status(p_order uuid, p_status text, p_reason text default null, p_serials jsonb default null)
returns public.online_orders
language plpgsql security definer set search_path = public as $$
declare ord public.online_orders; l record; onhand int; s text[]; wm int; n int;
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.expire_online_orders();
  select * into ord from public.online_orders where id = p_order for update;
  if not found then raise exception 'order not found'; end if;

  if not ((ord.status = 'reserved'  and p_status in ('confirmed','cancelled'))
       or (ord.status = 'confirmed' and p_status in ('ready','cancelled'))
       or (ord.status = 'ready'     and p_status in ('delivered','cancelled'))) then
    raise exception 'invalid transition % -> %', ord.status, p_status;
  end if;
  if p_status = 'cancelled' and coalesce(trim(p_reason),'') = '' then raise exception 'reason required'; end if;

  if p_status = 'confirmed' then
    update public.stock_reservations set expires_at = 'infinity' where order_id = ord.id and released_at is null;
  elsif p_status = 'cancelled' then
    update public.stock_reservations set released_at = now() where order_id = ord.id and released_at is null;
  elsif p_status = 'delivered' then
    for l in select * from public.online_order_lines where order_id = ord.id loop
      select coalesce(sum(qty),0) into onhand from public.stock_movements where variant_id = l.variant_id;
      if onhand < l.qty then raise exception 'stock cannot go negative'; end if;
      if public.variant_tracked(l.variant_id) then
        s := public.parse_serials(p_serials -> l.variant_id::text);
        if coalesce(array_length(s, 1), 0) <> l.qty then raise exception 'serial numbers must match received quantity'; end if;
        select warranty_months into wm from public.variants where id = l.variant_id;
        update public.devices
           set status = 'sold', online_order_id = ord.id, sold_at = now(),
               warranty_until = ((now() at time zone 'Africa/Cairo')::date + make_interval(months => wm))::date
         where variant_id = l.variant_id and serial = any(s) and status = 'in_stock';
        get diagnostics n = row_count;
        if n <> l.qty then raise exception 'device not available'; end if;
        perform public.device_event(s, 'sold', 'online_order', ord.id, ord.order_number);
      end if;
      insert into public.stock_movements(variant_id, branch_id, movement_type, qty, ref_type, ref_id, note)
      values (l.variant_id, (select id from public.branches where is_active order by created_at limit 1),
              'sale', -l.qty, 'online_order', ord.id, ord.order_number);
    end loop;
    update public.stock_reservations set released_at = now() where order_id = ord.id and released_at is null;
  end if;

  update public.online_orders
     set status = p_status::public.online_status, handled_by = auth.uid(),
         cancel_reason = case when p_status = 'cancelled' then p_reason else cancel_reason end
   where id = ord.id returning * into ord;
  return ord;
end $$;

-- ---------- lookups ----------
create or replace function public.available_serials(p_variant uuid)
returns table(serial text) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_any_role(array['owner','manager','cashier','warehouse','accountant']::public.app_role[]) then raise exception 'not allowed'; end if;
  return query select d.serial from public.devices d where d.variant_id = p_variant and d.status = 'in_stock'
                order by d.received_at, d.serial limit 300;
end $$;

create or replace function public.trace_device(p_serial text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d public.devices; full_view boolean;
begin
  if not public.has_any_role(array['owner','manager','cashier','warehouse','accountant']::public.app_role[]) then raise exception 'not allowed'; end if;
  select * into d from public.devices where serial = public.norm_serial(p_serial);
  if not found then return null; end if;
  full_view := public.has_any_role(array['owner','manager','accountant','warehouse']::public.app_role[]);
  return jsonb_build_object(
    'serial', d.serial, 'status', d.status,
    'item', (select p.name || coalesce(' ' || v.storage, '') || coalesce(' ' || v.color, '')
               from public.variants v join public.products p on p.id = v.product_id where v.id = d.variant_id),
    'cost', case when full_view then d.cost end,
    'supplier', case when full_view then (select name from public.suppliers where id = d.supplier_id) end,
    'po_number', (select po_number from public.purchase_orders where id = d.po_id),
    'received_at', d.received_at, 'sold_at', d.sold_at, 'warranty_until', d.warranty_until,
    'invoice_number', (select invoice_number from public.sales_invoices where id = d.sale_invoice_id),
    'online_order', (select order_number from public.online_orders where id = d.online_order_id),
    'customer', case when full_view then
        (select concat_ws(' · ', i.customer_name, i.customer_phone) from public.sales_invoices i where i.id = d.sale_invoice_id) end,
    'events', (select coalesce(jsonb_agg(jsonb_build_object('event', e.event, 'at', e.at, 'detail', e.detail) order by e.at, e.id), '[]'::jsonb)
                 from public.device_events e where e.device_id = d.id));
end $$;

-- ---------- grants + RLS ----------
revoke all on function public.register_devices(uuid,jsonb,numeric,text,text) from public, anon;
revoke all on function public.write_off_device(uuid,text) from public, anon;
revoke all on function public.set_online_order_status(uuid,text,text,jsonb) from public, anon;
revoke all on function public.available_serials(uuid) from public, anon;
revoke all on function public.trace_device(text) from public, anon;
grant execute on function public.register_devices(uuid,jsonb,numeric,text,text) to authenticated;
grant execute on function public.write_off_device(uuid,text) to authenticated;
grant execute on function public.set_online_order_status(uuid,text,text,jsonb) to authenticated;
grant execute on function public.available_serials(uuid) to authenticated;
grant execute on function public.trace_device(text) to authenticated;

alter table public.devices enable row level security;
alter table public.device_events enable row level security;
create policy devices_read on public.devices for select to authenticated
  using (public.has_any_role(array['owner','manager','accountant','warehouse']::public.app_role[]));
create policy device_events_read on public.device_events for select to authenticated
  using (public.has_any_role(array['owner','manager','accountant','warehouse']::public.app_role[]));
