-- 0028 (Phase 4): supply in one step (goods + invoice + optional payment), stock counts, damaged goods, shortage book.
-- Needs 0008 (supplier ledger), 0009 (devices), 0024 (pay_supplier_from), 0027 (catalog).

alter type public.device_status add value if not exists 'missing';

-- ---------- one-step supply ----------
create table public.supply_requests (
  idem_key uuid primary key,
  invoice_id uuid references public.supplier_invoices(id),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.supply_requests enable row level security;   -- no policies: functions only

-- p_lines: [{variant_id, qty, unit_cost, serials?: [...], new_price?, new_wholesale?}]
-- p_pricing: 'keep' leaves selling prices alone, 'apply' sets new_price / new_wholesale on each line that has them.
-- Cost: serial items use the average of the devices in stock, others the moving average (as purchase orders do).
-- The invoice is the supplier debt. p_paid (optional) is paid now from a drawer (cash) or an account (other methods).
create or replace function public.receive_supply(
  p_supplier uuid, p_invoice_no text, p_date date, p_due date, p_lines jsonb, p_pricing text,
  p_paid numeric, p_method text, p_drawer text, p_account uuid, p_idem uuid, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare inv public.supplier_invoices; existing uuid; br uuid; l jsonb; vid uuid; q int; c numeric(14,2); s text[];
        onhand int; oc numeric; newc numeric(14,2); total numeric(14,2); tracked boolean; num text; paid numeric(14,2);
begin
  if not public.has_any_role(array['owner','manager','warehouse']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_idem is null then raise exception 'idempotency key required'; end if;
  insert into public.supply_requests(idem_key) values (p_idem) on conflict do nothing;
  if not found then
    select invoice_id into existing from public.supply_requests where idem_key = p_idem;
    if existing is null then raise exception 'supply already in progress'; end if;
    return existing;
  end if;
  perform public.enforce_rate_limit('receive_supply', 30, 60);
  if p_pricing not in ('keep','apply') then raise exception 'invalid pricing mode'; end if;
  if not exists (select 1 from public.suppliers where id = p_supplier and status = 'active') then raise exception 'supplier not found'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 200 then raise exception 'invalid lines'; end if;
  paid := round(coalesce(p_paid, 0), 2);
  if paid < 0 then raise exception 'invalid amount'; end if;
  if paid > 0 and not public.has_any_role(array['owner','manager','accountant']::public.app_role[]) then raise exception 'not allowed'; end if;

  select coalesce(sum((x->>'qty')::int * round((x->>'unit_cost')::numeric, 2)), 0) into total from jsonb_array_elements(p_lines) x;
  if total <= 0 then raise exception 'invalid amount'; end if;
  if paid > total then raise exception 'payment exceeds remaining'; end if;

  br := (select id from public.branches where is_active order by created_at limit 1);
  num := coalesce(nullif(trim(coalesce(p_invoice_no, '')), ''), 'SUP-' || to_char(now() at time zone 'Africa/Cairo', 'YYMMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));
  begin
    insert into public.supplier_invoices(supplier_id, invoice_number, invoice_date, due_date, amount, status, notes)
    values (p_supplier, num, coalesce(p_date, (now() at time zone 'Africa/Cairo')::date), p_due, total, 'open', nullif(trim(coalesce(p_note, '')), ''))
    returning * into inv;
  exception when unique_violation then raise exception 'invoice number exists';
  end;

  for l in select * from jsonb_array_elements(p_lines) loop
    vid := (l->>'variant_id')::uuid; q := (l->>'qty')::int; c := round((l->>'unit_cost')::numeric, 2);
    if q is null or q <= 0 or q > 100000 or c is null or c < 0 then raise exception 'invalid lines'; end if;
    perform 1 from public.variants where id = vid and is_active for update;
    if not found then raise exception 'invalid item'; end if;
    tracked := public.variant_tracked(vid);
    select coalesce(sum(qty), 0) into onhand from public.stock_movements where variant_id = vid;
    select cost into oc from public.variant_costs where variant_id = vid;

    if tracked then
      s := public.parse_serials(l->'serials');
      if coalesce(array_length(s, 1), 0) <> q then raise exception 'serials count must equal quantity'; end if;
      insert into public.devices(variant_id, serial, cost, supplier_id, branch_id)
      select vid, x, c, p_supplier, br from unnest(s) x;
      perform public.device_event(s, 'received', 'supply', inv.id, inv.invoice_number);
      select round(avg(cost), 2) into newc from public.devices where variant_id = vid and status = 'in_stock';
    else
      newc := case when onhand <= 0 then c else round((onhand * coalesce(oc, 0) + q * c) / (onhand + q), 2) end;
    end if;
    insert into public.variant_costs(variant_id, cost) values (vid, coalesce(newc, c))
      on conflict (variant_id) do update set cost = excluded.cost, updated_at = now();
    insert into public.stock_movements(variant_id, branch_id, movement_type, qty, unit_cost, ref_type, ref_id, note)
    values (vid, br, 'purchase_receipt', q, c, 'supply', inv.id, inv.invoice_number);

    if p_pricing = 'apply' and nullif(l->>'new_price', '') is not null then
      update public.variants set price = round((l->>'new_price')::numeric, 2),
             wholesale_price = coalesce(round(nullif(l->>'new_wholesale', '')::numeric, 2), wholesale_price)
       where id = vid;
    end if;
  end loop;

  if paid > 0 then
    perform public.pay_supplier_from(p_supplier, inv.id, paid, p_method, 'دفعة عند التوريد ' || inv.invoice_number, p_drawer, p_account);
  end if;
  update public.supply_requests set invoice_id = inv.id where idem_key = p_idem;
  return inv.id;
end $$;
revoke all on function public.receive_supply(uuid, text, date, date, jsonb, text, numeric, text, text, uuid, uuid, text) from public, anon;
grant execute on function public.receive_supply(uuid, text, date, date, jsonb, text, numeric, text, text, uuid, uuid, text) to authenticated;

-- ---------- damaged goods ----------
create table public.damaged_items (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.variants(id),
  qty int not null check (qty > 0),
  reason text not null check (char_length(trim(reason)) between 1 and 300),
  source text not null default 'manual' check (source in ('manual','count')),
  return_to_supplier boolean not null default false,
  supplier_id uuid references public.suppliers(id),
  returned_at timestamptz,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create index on public.damaged_items (variant_id);
alter table public.damaged_items enable row level security;
create policy damaged_read on public.damaged_items for select to authenticated
  using (public.has_any_role(array['owner','manager','warehouse','accountant']::public.app_role[]));
create trigger audit_damaged_items after insert or update on public.damaged_items
  for each row execute function public.audit_row();

-- untracked items only; serial items are written off with write_off_device
create or replace function public.record_damage(p_variant uuid, p_qty int, p_reason text, p_return boolean default false, p_supplier uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare br uuid; onhand int; did uuid;
begin
  if not public.has_any_role(array['owner','manager','warehouse']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'invalid quantity'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason required'; end if;
  if public.variant_tracked(p_variant) then raise exception 'use device write-off'; end if;
  if p_return and p_supplier is null then raise exception 'supplier required'; end if;
  br := (select id from public.branches where is_active order by created_at limit 1);
  perform 1 from public.variants where id = p_variant for update;
  select coalesce(sum(qty), 0) into onhand from public.stock_movements where variant_id = p_variant;
  if p_qty > onhand then raise exception 'not enough stock'; end if;
  insert into public.stock_movements(variant_id, branch_id, movement_type, qty, note)
  values (p_variant, br, 'adjustment', -p_qty, 'تالف: ' || trim(p_reason));
  insert into public.damaged_items(variant_id, qty, reason, return_to_supplier, supplier_id)
  values (p_variant, p_qty, trim(p_reason), coalesce(p_return, false), p_supplier) returning damaged_items.id into did;
  return did;
end $$;
revoke all on function public.record_damage(uuid, int, text, boolean, uuid) from public, anon;
grant execute on function public.record_damage(uuid, int, text, boolean, uuid) to authenticated;

create or replace function public.mark_damage_returned(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_any_role(array['owner','manager','warehouse']::public.app_role[]) then raise exception 'not allowed'; end if;
  update public.damaged_items set returned_at = now() where id = p_id and return_to_supplier and returned_at is null;
  if not found then raise exception 'not found'; end if;
end $$;
revoke all on function public.mark_damage_returned(uuid) from public, anon;
grant execute on function public.mark_damage_returned(uuid) to authenticated;

-- ---------- stock counts ----------
create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  status text not null default 'open' check (status in ('open','approved','cancelled')),
  note text check (char_length(note) <= 300),
  category_id uuid references public.categories(id),
  started_by uuid default auth.uid() references public.profiles(id),
  started_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz
);
create unique index stock_counts_one_open on public.stock_counts (branch_id) where status = 'open';
create table public.stock_count_lines (
  id bigint generated always as identity primary key,
  count_id uuid not null references public.stock_counts(id) on delete cascade,
  variant_id uuid not null references public.variants(id),
  system_qty int not null,
  counted_qty int check (counted_qty is null or counted_qty >= 0),
  reason text check (reason in ('damaged','missing','stolen','entry_error','surplus','other')),
  unique (count_id, variant_id)
);
create table public.stock_count_scans (
  id bigint generated always as identity primary key,
  count_id uuid not null references public.stock_counts(id) on delete cascade,
  variant_id uuid not null references public.variants(id),
  serial text not null,
  scanned_at timestamptz not null default now(),
  unique (count_id, serial)
);
alter table public.stock_counts enable row level security;
alter table public.stock_count_lines enable row level security;
alter table public.stock_count_scans enable row level security;
create policy sc_read on public.stock_counts for select to authenticated
  using (public.has_any_role(array['owner','manager','warehouse','accountant']::public.app_role[]));
create policy scl_read on public.stock_count_lines for select to authenticated
  using (public.has_any_role(array['owner','manager','warehouse','accountant']::public.app_role[]));
create policy scs_read on public.stock_count_scans for select to authenticated
  using (public.has_any_role(array['owner','manager','warehouse','accountant']::public.app_role[]));
create trigger audit_stock_counts after insert or update on public.stock_counts
  for each row execute function public.audit_row();

create or replace function public.start_stock_count(p_note text default null, p_category uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare br uuid; cid uuid;
begin
  if not public.has_any_role(array['owner','manager','warehouse']::public.app_role[]) then raise exception 'not allowed'; end if;
  br := (select b.id from public.branches b where b.is_active order by b.created_at limit 1);
  if exists (select 1 from public.stock_counts where branch_id = br and status = 'open') then raise exception 'a count is already open'; end if;
  insert into public.stock_counts(branch_id, note, category_id) values (br, nullif(trim(coalesce(p_note, '')), ''), p_category) returning stock_counts.id into cid;
  insert into public.stock_count_lines(count_id, variant_id, system_qty)
  select cid, v.id, coalesce((select sum(m.qty) from public.stock_movements m where m.variant_id = v.id and m.branch_id = br), 0)
    from public.variants v join public.products p on p.id = v.product_id
   where v.is_active and p.is_active and (p_category is null or p.category_id = p_category);
  return cid;
end $;

create or replace function public.save_count_line(p_count uuid, p_variant uuid, p_counted int, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_any_role(array['owner','manager','warehouse']::public.app_role[]) then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.stock_counts where id = p_count and status = 'open') then raise exception 'count is not open'; end if;
  if public.variant_tracked(p_variant) then raise exception 'use scanning for serial items'; end if;
  if p_counted is not null and p_counted < 0 then raise exception 'invalid quantity'; end if;
  update public.stock_count_lines set counted_qty = p_counted, reason = nullif(trim(coalesce(p_reason, '')), '')
   where count_id = p_count and variant_id = p_variant;
  if not found then raise exception 'item not in this count'; end if;
end $$;

create or replace function public.scan_count_serial(p_count uuid, p_serial text)
returns int language plpgsql security definer set search_path = public as $$
declare d public.devices; s text := public.norm_serial(p_serial); n int;
begin
  if not public.has_any_role(array['owner','manager','warehouse']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('count_scan', 300, 60);
  if not exists (select 1 from public.stock_counts where id = p_count and status = 'open') then raise exception 'count is not open'; end if;
  select * into d from public.devices where serial = s and status = 'in_stock';
  if not found then raise exception 'serial not in stock'; end if;
  if not exists (select 1 from public.stock_count_lines where count_id = p_count and variant_id = d.variant_id) then raise exception 'item not in this count'; end if;
  insert into public.stock_count_scans(count_id, variant_id, serial) values (p_count, d.variant_id, s) on conflict do nothing;
  select count(*) into n from public.stock_count_scans where count_id = p_count and variant_id = d.variant_id;
  update public.stock_count_lines set counted_qty = n where count_id = p_count and variant_id = d.variant_id;
  return n;
end $$;

create or replace function public.approve_stock_count(p_count uuid)
returns int language plpgsql security definer set search_path = public as $$
declare c public.stock_counts; l record; diff int; changed int := 0; sc text[];
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  select * into c from public.stock_counts where id = p_count for update;
  if not found or c.status <> 'open' then raise exception 'count is not open'; end if;
  if exists (select 1 from public.stock_count_lines where count_id = p_count and counted_qty is not null
                and counted_qty <> system_qty and coalesce(trim(reason), '') = '') then
    raise exception 'reason required for every difference';
  end if;
  for l in select * from public.stock_count_lines where count_id = p_count and counted_qty is not null order by id loop
    diff := l.counted_qty - (select coalesce(sum(qty), 0) from public.stock_movements where variant_id = l.variant_id and branch_id = c.branch_id);
    if diff = 0 then continue; end if;
    insert into public.stock_movements(variant_id, branch_id, movement_type, qty, ref_type, ref_id, note)
    values (l.variant_id, c.branch_id, 'count_adjustment', diff, 'stock_count', c.id, 'جرد: ' || coalesce(l.reason, ''));
    changed := changed + 1;
    if diff < 0 and public.variant_tracked(l.variant_id) then
      select array_agg(d.serial) into sc from public.devices d
       where d.variant_id = l.variant_id and d.status = 'in_stock'
         and not exists (select 1 from public.stock_count_scans s where s.count_id = p_count and s.serial = d.serial);
      if sc is not null then
        update public.devices set status = 'missing' where serial = any(sc);
        perform public.device_event(sc, 'missing', 'stock_count', c.id, coalesce(l.reason, ''));
      end if;
    end if;
    if l.reason = 'damaged' and diff < 0 and not public.variant_tracked(l.variant_id) then
      insert into public.damaged_items(variant_id, qty, reason, source) values (l.variant_id, -diff, 'جرد', 'count');
    end if;
  end loop;
  update public.stock_counts set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_count;
  return changed;
end $$;

create or replace function public.cancel_stock_count(p_count uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  update public.stock_counts set status = 'cancelled' where id = p_count and status = 'open';
  if not found then raise exception 'count is not open'; end if;
end $$;
revoke all on function public.start_stock_count(text, uuid), public.save_count_line(uuid, uuid, int, text), public.scan_count_serial(uuid, text),
  public.approve_stock_count(uuid), public.cancel_stock_count(uuid) from public, anon;
grant execute on function public.start_stock_count(text, uuid), public.save_count_line(uuid, uuid, int, text), public.scan_count_serial(uuid, text),
  public.approve_stock_count(uuid), public.cancel_stock_count(uuid) to authenticated;

-- ---------- shortage book: what to buy next ----------
create table public.shortage_book (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 200),
  variant_id uuid references public.variants(id),
  note text check (char_length(note) <= 300),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table public.shortage_book enable row level security;
create policy sb_read on public.shortage_book for select to authenticated using (public.is_staff());
create policy sb_add on public.shortage_book for insert to authenticated
  with check (public.is_staff() and created_by = auth.uid());
create policy sb_update on public.shortage_book for update to authenticated
  using (public.has_any_role(array['owner','manager','warehouse']::public.app_role[]))
  with check (public.has_any_role(array['owner','manager','warehouse']::public.app_role[]));
create policy sb_delete on public.shortage_book for delete to authenticated
  using (public.has_any_role(array['owner','manager','warehouse']::public.app_role[]));
