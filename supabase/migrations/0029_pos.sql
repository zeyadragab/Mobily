-- 0029 (Phase 5): selling. Wholesale / retail price mode, per-line price override with a floor, offers
-- (percent with cap, fixed, buy X get Y, bundle), uncoded sales, a sales log with paid / credit / profit.
-- Needs 0009 (create_sale), 0015 (override tokens), 0021 (create_sale_once), 0022 (customers), 0027 (wholesale price).
-- create_sale keeps its signature; the new choices travel in line fields and transaction-local settings:
--   app.sale_price_mode ('retail'|'wholesale'), app.sale_offer (uuid), app.sale_override (override token).

insert into public.app_settings(key, value) values ('uncoded_pin_threshold', 1000) on conflict (key) do nothing;

alter table public.sales_invoices
  add column price_mode text not null default 'retail' check (price_mode in ('retail','wholesale')),
  add column offer_id uuid,
  add column offer_discount numeric(14,2) not null default 0 check (offer_discount >= 0);
alter table public.sales_invoice_lines add column list_price numeric(14,2);

-- ---------- offers ----------
create table public.offers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  kind text not null check (kind in ('percent','fixed','bxgy','bundle')),
  value numeric(14,2) not null check (value >= 0),            -- percent, fixed amount, or the bundle price
  cap numeric(14,2) check (cap is null or cap > 0),           -- maximum discount for kind percent
  variant_id uuid references public.variants(id),             -- percent: limit to one item; bxgy: the item
  category_id uuid references public.categories(id),          -- percent: limit to one category
  buy_qty int check (buy_qty is null or buy_qty >= 1),
  get_qty int check (get_qty is null or get_qty >= 1),
  starts_on date,
  ends_on date,
  max_uses int check (max_uses is null or max_uses >= 1),
  uses int not null default 0,
  is_active boolean not null default true,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  check (kind <> 'percent' or value between 0.01 and 100),
  check (kind <> 'bxgy' or (variant_id is not null and buy_qty is not null and get_qty is not null)),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create table public.offer_items (
  offer_id uuid not null references public.offers(id) on delete cascade,
  variant_id uuid not null references public.variants(id),
  qty int not null check (qty > 0),
  primary key (offer_id, variant_id)
);
alter table public.offers enable row level security;
alter table public.offer_items enable row level security;
create policy offers_read on public.offers for select to authenticated using (public.is_staff());
create policy offers_write on public.offers for all to authenticated
  using (public.has_any_role(array['owner','manager']::public.app_role[]))
  with check (public.has_any_role(array['owner','manager']::public.app_role[]));
create policy offer_items_read on public.offer_items for select to authenticated using (public.is_staff());
create policy offer_items_write on public.offer_items for all to authenticated
  using (public.has_any_role(array['owner','manager']::public.app_role[]))
  with check (public.has_any_role(array['owner','manager']::public.app_role[]));
create trigger audit_offers after insert or update or delete on public.offers for each row execute function public.audit_row();

-- ---------- uncoded sales (an item that is not in the catalog) ----------
create table public.uncoded_sales (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.sales_invoices(id),
  name text not null check (char_length(trim(name)) between 1 and 120),
  qty int not null check (qty > 0),
  unit_price numeric(14,2) not null check (unit_price > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  reason text not null check (char_length(trim(reason)) between 1 and 200),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create index on public.uncoded_sales (invoice_id);
alter table public.uncoded_sales enable row level security;
create policy uncoded_read on public.uncoded_sales for select to authenticated
  using (public.has_any_role(array['owner','manager','accountant']::public.app_role[]));
create trigger uncoded_append_only before update or delete on public.uncoded_sales
  for each row execute function public.audit_block_mutation();

-- ---------- create_sale v2 ----------
-- Lines: {"variant_id","qty"|"serials","price"?}  or  {"uncoded":{"name","qty","price","cost","reason"}}
-- Price below the list price: a cashier may go down to the max discount %, a manager down to cost; below that
-- (or below cost for a manager) a manager PIN override token is needed. The owner is never blocked.
create or replace function public.create_sale(
  p_customer_name text, p_customer_phone text, p_discount numeric, p_notes text, p_lines jsonb, p_payments jsonb)
returns public.sales_invoices
language plpgsql security definer set search_path = public as $$
declare
  br uuid; it record; v public.variants; pr public.products; inv public.sales_invoices; o public.offers;
  sub numeric(14,2) := 0; disc numeric(14,2); odisc numeric(14,2) := 0; tot numeric(14,2); lim numeric; need_appr boolean;
  ucost numeric(14,2); vname text; req uuid; q int; s text[]; cnt int;
  mode text := coalesce(nullif(current_setting('app.sale_price_mode', true), ''), 'retail');
  v_offer uuid := nullif(current_setting('app.sale_offer', true), '')::uuid;
  tok uuid := nullif(current_setting('app.sale_override', true), '')::uuid;
  listp numeric(14,2); up numeric(14,2); need_override boolean := false; is_owner boolean := public.has_role('owner');
  is_boss boolean := public.has_any_role(array['owner','manager']::public.app_role[]);
  unc jsonb; ucthr numeric; elig numeric(14,2); grps int; nn int; bsum numeric(14,2); bi record; inq int;
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 50 then raise exception 'invalid lines'; end if;
  if mode not in ('retail','wholesale') then raise exception 'invalid price mode'; end if;
  br := (select id from public.branches where is_active order by created_at limit 1);
  disc := round(coalesce(p_discount, 0), 2);
  if disc < 0 then raise exception 'invalid discount'; end if;
  lim := coalesce((select value from public.app_settings where key = 'max_discount_pct'), 5);
  ucthr := coalesce((select value from public.app_settings where key = 'uncoded_pin_threshold'), 1000);

  insert into public.sales_invoices(branch_id, customer_name, customer_phone, notes, price_mode)
  values (br, nullif(trim(coalesce(p_customer_name,'')),''), nullif(trim(coalesce(p_customer_phone,'')),''), nullif(trim(coalesce(p_notes,'')),''), mode)
  returning * into inv;

  for it in select value as x from jsonb_array_elements(p_lines) where value ? 'variant_id' order by value->>'variant_id' loop
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
    listp := case when mode = 'wholesale' and v.wholesale_price is not null then v.wholesale_price else v.price end;
    up := listp;
    if nullif(it.x->>'price', '') is not null then
      up := round((it.x->>'price')::numeric, 2);
      if up < 0 then raise exception 'invalid price'; end if;
      if up < listp and not is_owner then
        if up < round(ucost, 2) then need_override := true;                                 -- below cost
        elsif not is_boss and up < round(listp * (1 - lim / 100), 2) then need_override := true;   -- cashier beyond the max discount
        end if;
      end if;
    end if;
    vname := pr.name || coalesce(' ' || v.storage, '') || coalesce(' ' || v.color, '');
    insert into public.sales_invoice_lines(invoice_id, variant_id, name_snapshot, qty, unit_price, unit_cost, serials, list_price)
    values (inv.id, v.id, vname, q, up, round(ucost, 2), s, listp);
    sub := sub + q * up;
  end loop;

  for it in select value as x from jsonb_array_elements(p_lines) where value ? 'uncoded' loop
    unc := it.x->'uncoded';
    q := coalesce(nullif(unc->>'qty', '')::int, 1);
    if q < 1 or q > 1000 or coalesce(unc->>'price', '') !~ '^[0-9]+(\.[0-9]{1,2})?$' or coalesce(unc->>'cost', '') !~ '^[0-9]+(\.[0-9]{1,2})?$'
       or round((unc->>'price')::numeric, 2) <= 0 then raise exception 'invalid uncoded item'; end if;
    if coalesce(trim(unc->>'name'), '') = '' or coalesce(trim(unc->>'reason'), '') = '' then raise exception 'uncoded reason required'; end if;
    insert into public.uncoded_sales(invoice_id, name, qty, unit_price, unit_cost, reason)
    values (inv.id, trim(unc->>'name'), q, round((unc->>'price')::numeric, 2), round((unc->>'cost')::numeric, 2), trim(unc->>'reason'));
    sub := sub + q * round((unc->>'price')::numeric, 2);
    if not is_boss and q * round((unc->>'price')::numeric, 2) >= ucthr then need_override := true; end if;
  end loop;
  if sub <= 0 then raise exception 'invalid lines'; end if;

  if need_override then
    if tok is null then raise exception 'override required'; end if;
    perform public.consume_override(tok);
  end if;

  -- offer
  if v_offer is not null then
    select * into o from public.offers where id = v_offer for update;
    if not found or not o.is_active then raise exception 'offer unavailable'; end if;
    if (o.starts_on is not null and o.starts_on > (now() at time zone 'Africa/Cairo')::date)
       or (o.ends_on is not null and o.ends_on < (now() at time zone 'Africa/Cairo')::date)
       or (o.max_uses is not null and o.uses >= o.max_uses) then raise exception 'offer unavailable'; end if;
    if o.kind = 'percent' then
      select coalesce(sum(l.qty * l.unit_price), 0) into elig
        from public.sales_invoice_lines l join public.variants vv on vv.id = l.variant_id join public.products pp on pp.id = vv.product_id
       where l.invoice_id = inv.id and (o.variant_id is null or l.variant_id = o.variant_id) and (o.category_id is null or pp.category_id = o.category_id);
      odisc := round(elig * o.value / 100, 2);
      if o.cap is not null then odisc := least(odisc, o.cap); end if;
    elsif o.kind = 'fixed' then
      odisc := least(o.value, sub);
    elsif o.kind = 'bxgy' then
      select coalesce(sum(l.qty), 0), coalesce(max(l.unit_price), 0) into inq, up from public.sales_invoice_lines l where l.invoice_id = inv.id and l.variant_id = o.variant_id;
      grps := inq / (o.buy_qty + o.get_qty);
      odisc := grps * o.get_qty * up;
    else
      nn := null; bsum := 0;
      for bi in select oi.variant_id, oi.qty from public.offer_items oi where oi.offer_id = o.id loop
        select coalesce(sum(l.qty), 0), coalesce(max(l.unit_price), 0) into inq, up from public.sales_invoice_lines l where l.invoice_id = inv.id and l.variant_id = bi.variant_id;
        nn := least(coalesce(nn, inq / bi.qty), inq / bi.qty);
        bsum := bsum + bi.qty * up;
      end loop;
      odisc := greatest(0, coalesce(nn, 0) * (bsum - o.value));
    end if;
    if odisc <= 0 then raise exception 'offer does not apply'; end if;
    odisc := least(odisc, sub);
    update public.offers set uses = uses + 1 where id = o.id;
  end if;

  if disc + odisc > sub then raise exception 'discount exceeds subtotal'; end if;
  tot := sub - disc - odisc;
  perform public.check_payments(p_payments, tot);

  need_appr := disc > 0 and disc > sub * lim / 100 and not is_owner;

  update public.sales_invoices
     set subtotal = sub, discount = disc + odisc, offer_id = o.id, offer_discount = odisc, total = tot,
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

-- ---------- create_sale_once with the new choices ----------
drop function public.create_sale_once(uuid, text, text, numeric, text, jsonb, jsonb, uuid, uuid);
create or replace function public.create_sale_once(
  p_idem uuid, p_customer_name text, p_customer_phone text, p_discount numeric, p_notes text,
  p_lines jsonb, p_payments jsonb, p_held uuid default null, p_customer uuid default null,
  p_price_mode text default 'retail', p_offer uuid default null, p_override uuid default null)
returns public.sales_invoices
language plpgsql security definer set search_path = public as $$
declare inv public.sales_invoices; existing uuid;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  if p_idem is null then raise exception 'idempotency key required'; end if;
  insert into public.sale_requests(user_id, idem_key) values (auth.uid(), p_idem) on conflict do nothing;
  if not found then
    select r.invoice_id into existing from public.sale_requests r where r.user_id = auth.uid() and r.idem_key = p_idem;
    select * into inv from public.sales_invoices where id = existing;
    if not found then raise exception 'sale already in progress'; end if;
    return inv;
  end if;
  perform public.enforce_rate_limit('create_sale', 60, 60);
  perform set_config('app.sale_customer', coalesce(p_customer::text, ''), true);
  perform set_config('app.sale_price_mode', coalesce(p_price_mode, 'retail'), true);
  perform set_config('app.sale_offer', coalesce(p_offer::text, ''), true);
  perform set_config('app.sale_override', coalesce(p_override::text, ''), true);
  inv := public.create_sale(p_customer_name, p_customer_phone, p_discount, p_notes, p_lines, p_payments);
  perform set_config('app.sale_customer', '', true);
  perform set_config('app.sale_price_mode', '', true);
  perform set_config('app.sale_offer', '', true);
  perform set_config('app.sale_override', '', true);
  update public.sale_requests set invoice_id = inv.id where user_id = auth.uid() and idem_key = p_idem;
  if p_held is not null then perform public.discard_basket(p_held); end if;
  return inv;
end $$;
revoke all on function public.create_sale_once(uuid, text, text, numeric, text, jsonb, jsonb, uuid, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.create_sale_once(uuid, text, text, numeric, text, jsonb, jsonb, uuid, uuid, text, uuid, uuid) to authenticated;

-- ---------- sales log: paid / credit / profit (profit only for owner, manager, accountant) ----------
create view public.sales_log with (security_invoker = true) as
  select i.id, i.invoice_number, i.business_date, i.created_at, i.created_by, i.status, i.customer_name, i.customer_phone, i.customer_id,
         i.subtotal, i.discount, i.offer_discount, i.total, i.price_mode,
         coalesce((select sum(p.amount) from public.sales_payments p where p.invoice_id = i.id and p.method <> 'credit'), 0)::numeric(14,2) as paid,
         coalesce((select sum(p.amount) from public.sales_payments p where p.invoice_id = i.id and p.method = 'credit'), 0)::numeric(14,2) as credit,
         case when public.has_any_role(array['owner','manager','accountant']::public.app_role[]) then
           (i.total - coalesce((select sum(l.qty * l.unit_cost) from public.sales_invoice_lines l where l.invoice_id = i.id), 0)
                    - coalesce((select sum(u.qty * u.unit_cost) from public.uncoded_sales u where u.invoice_id = i.id), 0))::numeric(14,2)
         end as profit,
         exists (select 1 from public.uncoded_sales u where u.invoice_id = i.id) as has_uncoded
    from public.sales_invoices i;
revoke all on public.sales_log from public, anon;
grant select on public.sales_log to authenticated;
