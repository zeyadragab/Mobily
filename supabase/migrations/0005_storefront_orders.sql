-- 0005: public catalog + reserve-and-confirm online orders.
-- Anonymous visitors can: read published catalog, place a reservation, track an order with its secret token.
-- They can never read costs, stock counts above 5, other customers' data or any base table.

alter table public.products add column if not exists image_url text;

-- ---------- reservations ----------
create table public.stock_reservations (
  id bigint generated always as identity primary key,
  order_id uuid not null,
  variant_id uuid not null references public.variants(id),
  qty int not null check (qty > 0),
  expires_at timestamptz not null,
  released_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.stock_reservations (variant_id) where released_at is null;
create index on public.stock_reservations (order_id);

-- ---------- online orders ----------
create type public.online_status as enum
  ('reserved','confirmed','ready','delivered','cancelled','expired');

create sequence public.web_order_seq start 1000;

create table public.online_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('WEB-' || nextval('public.web_order_seq')),
  access_token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  customer_name text not null check (char_length(customer_name) between 2 and 80),
  phone text not null check (phone ~ '^[0-9]{10,15}$'),
  address text,
  fulfilment text not null check (fulfilment in ('pickup','delivery')),
  notes text check (notes is null or char_length(notes) <= 500),
  status public.online_status not null default 'reserved',
  total numeric(14,2) not null default 0,
  reserved_until timestamptz not null,
  cancel_reason text,
  handled_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fulfilment = 'pickup' or char_length(coalesce(address,'')) >= 6)
);
create index on public.online_orders (status, created_at desc);
create index on public.online_orders (phone);
create trigger online_orders_touch before update on public.online_orders
  for each row execute function public.touch_updated_at();

alter table public.stock_reservations
  add constraint stock_reservations_order_fk foreign key (order_id) references public.online_orders(id) on delete cascade;

create table public.online_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.online_orders(id) on delete cascade,
  variant_id uuid not null references public.variants(id),
  name_snapshot text not null,
  qty int not null check (qty between 1 and 5),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  unique (order_id, variant_id)
);
create index on public.online_order_lines (order_id);

-- audit (secret token excluded)
create trigger audit_online_orders after insert or update or delete on public.online_orders
  for each row execute function public.audit_row('access_token');

-- ---------- public catalog view (no cost, stock capped at 5) ----------
create view public.catalog_items as
select
  v.id as variant_id, p.id as product_id, p.name, p.brand, p.description, p.image_url,
  c.id as category_id, c.name as category,
  v.color, v.storage, v.condition, v.price,
  least(greatest(coalesce(s.on_hand,0) - coalesce(r.reserved,0), 0), 5)::int as available
from public.variants v
join public.products p on p.id = v.product_id
left join public.categories c on c.id = p.category_id
left join (select variant_id, sum(qty) as on_hand from public.stock_movements group by variant_id) s
       on s.variant_id = v.id
left join (select variant_id, sum(qty) as reserved from public.stock_reservations
            where released_at is null and expires_at > now() group by variant_id) r
       on r.variant_id = v.id
where p.is_published and p.is_active and v.is_active;

revoke all on public.catalog_items from public, anon, authenticated;
grant select on public.catalog_items to anon, authenticated;

-- ---------- functions ----------
create or replace function public.expire_online_orders()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.stock_reservations set released_at = now()
   where released_at is null and expires_at <= now();
  update public.online_orders set status = 'expired'
   where status = 'reserved' and reserved_until <= now();
end $$;

create or replace function public.place_online_order(
  p_name text, p_phone text, p_address text, p_fulfilment text, p_notes text, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ph text; ord public.online_orders; it record; v public.variants; pr public.products;
  onhand int; reserved int; tot numeric(14,2) := 0; vname text;
begin
  perform public.expire_online_orders();

  ph := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  if char_length(trim(coalesce(p_name,''))) < 2 or char_length(p_name) > 80 then raise exception 'invalid name'; end if;
  if ph !~ '^[0-9]{10,15}$' then raise exception 'invalid phone'; end if;
  if p_fulfilment not in ('pickup','delivery') then raise exception 'invalid fulfilment'; end if;
  if p_fulfilment = 'delivery' and char_length(trim(coalesce(p_address,''))) < 6 then raise exception 'address required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 10 then
    raise exception 'invalid items';
  end if;
  if (select count(*) from public.online_orders
       where phone = ph and status in ('reserved','confirmed','ready')) >= 3 then
    raise exception 'too many open orders';
  end if;

  insert into public.online_orders(customer_name, phone, address, fulfilment, notes, reserved_until)
  values (trim(p_name), ph, nullif(trim(coalesce(p_address,'')),''), p_fulfilment,
          nullif(trim(coalesce(p_notes,'')),''), now() + interval '24 hours')
  returning * into ord;

  -- sorted by variant to avoid deadlocks; aggregated so a variant appears once
  for it in
    select (x->>'variant_id')::uuid as variant_id, sum((x->>'qty')::int) as qty
      from jsonb_array_elements(p_items) x group by 1 order by 1
  loop
    if it.qty is null or it.qty < 1 or it.qty > 5 then raise exception 'invalid quantity'; end if;

    -- row lock: two buyers of the last piece are serialized here
    select * into v from public.variants where id = it.variant_id for update;
    if not found or not v.is_active then raise exception 'item unavailable'; end if;
    select * into pr from public.products where id = v.product_id;
    if not (pr.is_published and pr.is_active) then raise exception 'item unavailable'; end if;

    select coalesce(sum(qty),0) into onhand from public.stock_movements where variant_id = v.id;
    select coalesce(sum(qty),0) into reserved from public.stock_reservations
     where variant_id = v.id and released_at is null and expires_at > now();
    if it.qty > onhand - reserved then raise exception 'not enough stock'; end if;

    vname := pr.name || coalesce(' ' || v.storage, '') || coalesce(' ' || v.color, '');
    insert into public.online_order_lines(order_id, variant_id, name_snapshot, qty, unit_price)
    values (ord.id, v.id, vname, it.qty, v.price);
    insert into public.stock_reservations(order_id, variant_id, qty, expires_at)
    values (ord.id, v.id, it.qty, ord.reserved_until);
    tot := tot + it.qty * v.price;
  end loop;

  update public.online_orders set total = tot where id = ord.id;
  return jsonb_build_object('order_number', ord.order_number, 'access_token', ord.access_token,
                            'reserved_until', ord.reserved_until, 'total', tot);
end $$;

create or replace function public.track_order(p_number text, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ord public.online_orders;
begin
  perform public.expire_online_orders();
  select * into ord from public.online_orders
   where order_number = p_number and access_token = p_token;
  if not found then return null; end if;
  return jsonb_build_object(
    'order_number', ord.order_number, 'status', ord.status, 'fulfilment', ord.fulfilment,
    'total', ord.total, 'created_at', ord.created_at, 'reserved_until', ord.reserved_until,
    'cancel_reason', ord.cancel_reason,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('name', name_snapshot, 'qty', qty, 'unit_price', unit_price)), '[]'::jsonb)
                from public.online_order_lines where order_id = ord.id));
end $$;

-- Staff: move an order along. reserved->confirmed|cancelled, confirmed->ready|cancelled, ready->delivered|cancelled
create or replace function public.set_online_order_status(p_order uuid, p_status text, p_reason text default null)
returns public.online_orders
language plpgsql security definer set search_path = public as $$
declare ord public.online_orders; l record; onhand int;
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then
    raise exception 'not allowed';
  end if;
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

revoke all on function public.expire_online_orders() from public;
revoke all on function public.place_online_order(text,text,text,text,text,jsonb) from public;
revoke all on function public.track_order(text,text) from public;
revoke all on function public.set_online_order_status(uuid,text,text) from public, anon;
grant execute on function public.expire_online_orders() to anon, authenticated;
grant execute on function public.place_online_order(text,text,text,text,text,jsonb) to anon, authenticated;
grant execute on function public.track_order(text,text) to anon, authenticated;
grant execute on function public.set_online_order_status(uuid,text,text) to authenticated;

-- ---------- RLS: staff read only; all writes through functions ----------
alter table public.stock_reservations enable row level security;
alter table public.online_orders enable row level security;
alter table public.online_order_lines enable row level security;

create policy res_read on public.stock_reservations for select to authenticated using (public.is_staff());
create policy oo_read on public.online_orders for select to authenticated
  using (public.has_any_role(array['owner','manager','cashier','warehouse','accountant']::public.app_role[]));
create policy ool_read on public.online_order_lines for select to authenticated
  using (public.has_any_role(array['owner','manager','cashier','warehouse','accountant']::public.app_role[]));
