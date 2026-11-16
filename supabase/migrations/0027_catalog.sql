-- 0027 (Phase 3): catalog. Category fields (templates), units, tracking mode with IMEI check,
-- wholesale price, barcode generator, safe bulk import.
-- Needs 0004 (catalog) and 0009 (devices). Existing code keeps working: products.track_serial stays in sync.

-- ---------- units ----------
create table public.units (
  name text primary key check (char_length(name) between 1 and 30),
  sort_order int not null default 0
);
alter table public.units enable row level security;
create policy units_read on public.units for select to authenticated using (public.is_staff());
insert into public.units(name, sort_order) values
 ('قطعة',1),('علبة',2),('كرتونة',3),('دستة',4),('زوج',5),('طقم',6),('متر',7),('سم',8),('لتر',9),('جرام',10),('كيلو',11),
 ('طن',12),('عبوة',13),('شريط',14),('كيس',15),('رول',16),('لفة',17),('باكت',18),('زجاجة',19),('جهاز',20),('ساعة',21);

-- ---------- tracking mode ----------
alter table public.products
  add column tracking_mode text not null default 'none' check (tracking_mode in ('none','imei','serial')),
  add column unit text not null default 'قطعة' references public.units(name);
update public.products set tracking_mode = 'serial' where track_serial;

create or replace function public.sync_tracking_mode()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.tracking_mode = 'none' and new.track_serial then new.tracking_mode := 'serial'; end if;
  elsif new.tracking_mode is not distinct from old.tracking_mode and new.track_serial is distinct from old.track_serial then
    new.tracking_mode := case when new.track_serial then 'serial' else 'none' end;
  end if;
  new.track_serial := new.tracking_mode <> 'none';
  if new.tracking_mode <> 'none' then new.unit := 'قطعة'; end if;   -- serial products are always counted by piece
  return new;
end $$;
create trigger sync_tracking_mode before insert or update on public.products
  for each row execute function public.sync_tracking_mode();

create or replace function public.luhn_valid(t text)
returns boolean language plpgsql immutable as $$
declare i int; d int; s int := 0; alt boolean := false;
begin
  if t !~ '^[0-9]{15}$' then return false; end if;
  for i in reverse 15..1 loop
    d := substr(t, i, 1)::int;
    if alt then d := d * 2; if d > 9 then d := d - 9; end if; end if;
    s := s + d; alt := not alt;
  end loop;
  return s % 10 = 0;
end $$;

create or replace function public.check_device_serial()
returns trigger language plpgsql security definer set search_path = public as $$
declare mode text;
begin
  select p.tracking_mode into mode from public.variants v join public.products p on p.id = v.product_id where v.id = new.variant_id;
  if mode = 'imei' and not public.luhn_valid(new.serial) then raise exception 'invalid imei'; end if;
  return new;
end $$;
revoke all on function public.check_device_serial() from public, anon, authenticated;
create trigger check_device_serial before insert on public.devices
  for each row execute function public.check_device_serial();

-- ---------- variants: wholesale price and spec values ----------
alter table public.variants
  add column wholesale_price numeric(14,2) check (wholesale_price is null or wholesale_price >= 0),
  add column attributes jsonb not null default '{}'::jsonb;

-- ---------- category spec fields ----------
create table public.category_fields (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 60),
  kind text not null check (kind in ('short','long','number','yesno','list')),
  required boolean not null default false,
  internal boolean not null default false,        -- internal fields are not shown on the storefront
  options text[],
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (category_id, label),
  check ((kind = 'list' and options is not null and cardinality(options) between 1 and 50) or (kind <> 'list'))
);
create index on public.category_fields (category_id, sort_order);
alter table public.category_fields enable row level security;
create policy cf_read on public.category_fields for select to authenticated using (public.is_staff());
create policy cf_write on public.category_fields for all to authenticated
  using (public.has_any_role(array['owner','manager']::public.app_role[]))
  with check (public.has_any_role(array['owner','manager']::public.app_role[]));
create trigger audit_category_fields after insert or update or delete on public.category_fields
  for each row execute function public.audit_row();
create trigger audit_categories after insert or update or delete on public.categories
  for each row execute function public.audit_row();

-- values must follow the category's fields; checked on insert and when the values change
create or replace function public.check_variant_attributes()
returns trigger language plpgsql security definer set search_path = public as $$
declare cat uuid; f record; k text; val jsonb;
begin
  if tg_op = 'UPDATE' and new.attributes is not distinct from old.attributes then return new; end if;
  if new.attributes is null or jsonb_typeof(new.attributes) <> 'object' then raise exception 'invalid attributes'; end if;
  if (select count(*) from jsonb_object_keys(new.attributes)) > 40 then raise exception 'invalid attributes'; end if;
  select p.category_id into cat from public.products p where p.id = new.product_id;
  for k in select jsonb_object_keys(new.attributes) loop
    if not exists (select 1 from public.category_fields cf where cf.category_id = cat and cf.label = k) then
      raise exception 'unknown attribute';
    end if;
  end loop;
  for f in select * from public.category_fields where category_id = cat loop
    val := new.attributes -> f.label;
    if val is null or val = 'null'::jsonb or val = '""'::jsonb then
      if f.required then raise exception 'required field missing'; end if;
      continue;
    end if;
    if f.kind = 'number' and not (jsonb_typeof(val) = 'number' or (jsonb_typeof(val) = 'string' and (val #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$')) then
      raise exception 'invalid field value';
    elsif f.kind = 'yesno' and jsonb_typeof(val) <> 'boolean' then
      raise exception 'invalid field value';
    elsif f.kind = 'list' and not ((val #>> '{}') = any(f.options)) then
      raise exception 'invalid field value';
    elsif f.kind = 'short' and (jsonb_typeof(val) <> 'string' or char_length(val #>> '{}') > 200) then
      raise exception 'invalid field value';
    elsif f.kind = 'long' and (jsonb_typeof(val) <> 'string' or char_length(val #>> '{}') > 1000) then
      raise exception 'invalid field value';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.check_variant_attributes() from public, anon, authenticated;
create trigger check_variant_attributes before insert or update on public.variants
  for each row execute function public.check_variant_attributes();

-- a category in use cannot be deleted (products keep their category)
create or replace function public.delete_category(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  if exists (select 1 from public.products where category_id = p_id) then raise exception 'category in use'; end if;
  delete from public.categories where id = p_id;
end $$;
revoke all on function public.delete_category(uuid) from public, anon;
grant execute on function public.delete_category(uuid) to authenticated;

-- ---------- barcode generator (EAN-13, in-store prefix 20) ----------
create sequence public.barcode_seq;
create or replace function public.next_barcode()
returns text language plpgsql security definer set search_path = public as $$
declare base text; s int := 0; i int; b text;
begin
  if not public.has_any_role(array['owner','manager','web_admin','warehouse']::public.app_role[]) then raise exception 'not allowed'; end if;
  loop
    base := '20' || lpad(nextval('public.barcode_seq')::text, 10, '0');
    s := 0;
    for i in 1..12 loop s := s + substr(base, i, 1)::int * case when i % 2 = 1 then 1 else 3 end; end loop;
    b := base || ((10 - s % 10) % 10)::text;
    exit when not exists (select 1 from public.variants where barcode = b);
  end loop;
  return b;
end $$;
revoke all on function public.next_barcode() from public, anon;
grant execute on function public.next_barcode() to authenticated;

-- ---------- bulk import ----------
-- p_rows: [{name, category, brand, sku, barcode, color, storage, condition, price, wholesale_price, cost,
--           reorder_level, warranty_months}]. p_apply=false only checks. Up to 2,000 rows per call.
-- Same SKU = update that variant (price, wholesale, barcode, reorder, warranty, cost). New SKU = new variant
-- under the product with the same name and brand (created if missing). Nothing is written if any row has an error.
create or replace function public.import_catalog(p_rows jsonb, p_apply boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; i int := 0; errs jsonb := '[]'::jsonb; seen text[] := '{}'; n int;
        s_sku text; s_nm text; s_brand text; s_cat text; s_cid uuid; s_pid uuid; s_vid uuid; created int := 0; updated int := 0;
        n_price numeric; n_whole numeric; n_cost numeric; s_cond text;
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('catalog_import', 10, 60);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'invalid rows'; end if;
  n := jsonb_array_length(p_rows);
  if n = 0 or n > 2000 then raise exception 'rows out of range'; end if;

  -- pass 1: checks only
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    s_sku := nullif(trim(r->>'sku'), ''); s_nm := nullif(trim(r->>'name'), ''); s_cond := coalesce(nullif(trim(r->>'condition'), ''), 'new');
    if s_sku is null or s_nm is null then errs := errs || jsonb_build_object('row', i, 'error', 'sku and name required'); continue; end if;
    if char_length(s_sku) > 60 or char_length(s_nm) > 200 then errs := errs || jsonb_build_object('row', i, 'error', 'text too long'); continue; end if;
    if lower(s_sku) = any(seen) then errs := errs || jsonb_build_object('row', i, 'error', 'duplicate sku in file'); continue; end if;
    seen := seen || lower(s_sku);
    if s_cond not in ('new','used','refurbished') then errs := errs || jsonb_build_object('row', i, 'error', 'invalid condition'); continue; end if;
    if coalesce(r->>'price','') !~ '^[0-9]+(\.[0-9]{1,2})?$' then errs := errs || jsonb_build_object('row', i, 'error', 'invalid price'); continue; end if;
    if coalesce(nullif(r->>'wholesale_price',''),'0') !~ '^[0-9]+(\.[0-9]{1,2})?$' then errs := errs || jsonb_build_object('row', i, 'error', 'invalid wholesale price'); continue; end if;
    if coalesce(nullif(r->>'cost',''),'0') !~ '^[0-9]+(\.[0-9]{1,2})?$' then errs := errs || jsonb_build_object('row', i, 'error', 'invalid cost'); continue; end if;
    if coalesce(nullif(r->>'reorder_level',''),'0') !~ '^[0-9]{1,6}$' or coalesce(nullif(r->>'warranty_months',''),'0') !~ '^[0-9]{1,3}$' then
      errs := errs || jsonb_build_object('row', i, 'error', 'invalid number'); continue; end if;
    if nullif(trim(r->>'barcode'), '') is not null and exists (
         select 1 from public.variants v where v.barcode = trim(r->>'barcode') and lower(v.sku) <> lower(s_sku)) then
      errs := errs || jsonb_build_object('row', i, 'error', 'barcode used by another item'); continue; end if;
    if exists (select 1 from public.variants v join public.products p on p.id = v.product_id
                where lower(v.sku) = lower(s_sku) and (lower(p.name) <> lower(s_nm))) then
      errs := errs || jsonb_build_object('row', i, 'error', 'sku belongs to another product'); continue; end if;
  end loop;
  if jsonb_array_length(errs) > 0 or not p_apply then
    return jsonb_build_object('applied', false, 'rows', n, 'errors', errs);
  end if;

  -- pass 2: write
  for r in select * from jsonb_array_elements(p_rows) loop
    s_sku := trim(r->>'sku'); s_nm := trim(r->>'name'); s_brand := nullif(trim(coalesce(r->>'brand','')), ''); s_cat := nullif(trim(coalesce(r->>'category','')), '');
    s_cond := coalesce(nullif(trim(r->>'condition'), ''), 'new');
    n_price := (r->>'price')::numeric; n_whole := nullif(r->>'wholesale_price','')::numeric; n_cost := nullif(r->>'cost','')::numeric;
    s_cid := null;
    if s_cat is not null then
      select c.id into s_cid from public.categories c where lower(c.name) = lower(s_cat);
      if s_cid is null then insert into public.categories(name, sort_order) values (s_cat, 100) returning id into s_cid; end if;
    end if;
    select v.id, v.product_id into s_vid, s_pid from public.variants v where lower(v.sku) = lower(s_sku);
    if s_vid is not null then
      update public.variants set price = n_price, wholesale_price = n_whole, barcode = coalesce(nullif(trim(r->>'barcode'), ''), barcode),
             reorder_level = coalesce(nullif(r->>'reorder_level','')::int, reorder_level),
             warranty_months = coalesce(nullif(r->>'warranty_months','')::int, warranty_months)
       where id = s_vid;
      updated := updated + 1;
    else
      select p.id into s_pid from public.products p where lower(p.name) = lower(s_nm) and coalesce(lower(p.brand), '') = coalesce(lower(s_brand), '') limit 1;
      if s_pid is null then
        insert into public.products(name, brand, category_id) values (s_nm, s_brand, s_cid) returning id into s_pid;
      end if;
      insert into public.variants(product_id, sku, barcode, color, storage, condition, price, wholesale_price, reorder_level, warranty_months)
      values (s_pid, s_sku, nullif(trim(r->>'barcode'), ''), nullif(trim(coalesce(r->>'color','')), ''), nullif(trim(coalesce(r->>'storage','')), ''), s_cond,
              n_price, n_whole, coalesce(nullif(r->>'reorder_level','')::int, 0), coalesce(nullif(r->>'warranty_months','')::int, 0))
      returning id into s_vid;
      created := created + 1;
    end if;
    if n_cost is not null then
      insert into public.variant_costs(variant_id, cost, updated_at) values (s_vid, n_cost, now())
      on conflict (variant_id) do update set cost = excluded.cost, updated_at = now();
    end if;
  end loop;
  return jsonb_build_object('applied', true, 'rows', n, 'created', created, 'updated', updated, 'errors', '[]'::jsonb);
end $$;
revoke all on function public.import_catalog(jsonb, boolean) from public, anon;
grant execute on function public.import_catalog(jsonb, boolean) to authenticated;
