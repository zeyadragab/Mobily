-- 0004: catalog, stock ledger, suppliers, purchase orders (manager -> owner approval -> send -> receive).
-- Money = numeric(14,2). RLS on every table. Status changes happen only through functions.

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['owner','manager','cashier','warehouse','accountant','web_admin']::public.app_role[]);
$$;
revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ---------- catalog ----------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  category_id uuid references public.categories(id),
  brand text,
  description text,
  track_serial boolean not null default false,
  is_published boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.products (category_id);
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

create table public.variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null unique check (length(trim(sku)) > 0),
  barcode text unique,
  color text,
  storage text,
  condition text not null default 'new' check (condition in ('new','used','refurbished')),
  price numeric(14,2) not null default 0 check (price >= 0),
  reorder_level int not null default 0 check (reorder_level >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.variants (product_id);
create trigger variants_touch before update on public.variants
  for each row execute function public.touch_updated_at();

-- Purchase cost is internal: separate table so it can never leak with public catalog reads.
create table public.variant_costs (
  variant_id uuid primary key references public.variants(id) on delete cascade,
  cost numeric(14,2) not null default 0 check (cost >= 0),
  updated_at timestamptz not null default now()
);

-- ---------- stock ledger ----------
create type public.movement_type as enum
  ('purchase_receipt','sale','return','adjustment','transfer_in','transfer_out','count_adjustment');

create table public.stock_movements (
  id bigint generated always as identity primary key,
  variant_id uuid not null references public.variants(id),
  branch_id uuid not null references public.branches(id),
  movement_type public.movement_type not null,
  qty int not null check (qty <> 0),       -- signed
  unit_cost numeric(14,2),
  ref_type text,
  ref_id uuid,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.stock_movements (variant_id, branch_id);
create index on public.stock_movements (ref_type, ref_id);

create view public.stock_levels with (security_invoker = true) as
  select variant_id, branch_id, sum(qty)::int as on_hand
  from public.stock_movements group by variant_id, branch_id;

-- ---------- suppliers ----------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  status text not null default 'active' check (status in ('active','inactive')),
  phone text,
  whatsapp text,
  email text,
  address text,
  categories text,
  lead_time_days int check (lead_time_days is null or lead_time_days >= 0),
  payment_terms text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (coalesce(phone,'') <> '' or coalesce(whatsapp,'') <> '' or coalesce(email,'') <> '')
);
create index on public.suppliers (lower(name));
create trigger suppliers_touch before update on public.suppliers
  for each row execute function public.touch_updated_at();

create table public.supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  name text not null,
  role text,
  phone text,
  whatsapp text,
  email text
);
create index on public.supplier_contacts (supplier_id);

-- ---------- purchase orders ----------
create type public.po_status as enum
  ('draft','pending_approval','approved','rejected','sent','partially_received','received','cancelled');

create sequence public.po_seq start 1;

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique default ('PO-' || lpad(nextval('public.po_seq')::text, 5, '0')),
  supplier_id uuid not null references public.suppliers(id),
  branch_id uuid not null references public.branches(id),
  status public.po_status not null default 'draft',
  supplier_snapshot jsonb,                 -- contact + terms frozen at submission
  notes text,
  expected_date date,
  total numeric(14,2) not null default 0,
  approval_id uuid references public.approval_requests(id),
  sent_at timestamptz,
  cancelled_reason text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.purchase_orders (status, created_at desc);
create index on public.purchase_orders (supplier_id);
create trigger po_touch before update on public.purchase_orders
  for each row execute function public.touch_updated_at();

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  variant_id uuid not null references public.variants(id),
  qty_ordered int not null check (qty_ordered > 0),
  qty_received int not null default 0 check (qty_received >= 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  unique (po_id, variant_id),
  check (qty_received <= qty_ordered)
);
create index on public.purchase_order_lines (po_id);

-- Lines are editable only while the order is draft/rejected (receiving bypasses via flag).
create or replace function public.po_lines_guard()
returns trigger language plpgsql as $$
declare st public.po_status; pid uuid;
begin
  pid := coalesce(new.po_id, old.po_id);
  select status into st from public.purchase_orders where id = pid;
  if st in ('draft','rejected') then return coalesce(new, old); end if;
  if tg_op = 'UPDATE'
     and current_setting('app.po_receiving', true) = 'on'
     and new.po_id = old.po_id and new.variant_id = old.variant_id
     and new.qty_ordered = old.qty_ordered and new.unit_cost = old.unit_cost then
    return new;
  end if;
  raise exception 'order lines are locked in status %', st;
end $$;
create trigger po_lines_lock before insert or update or delete on public.purchase_order_lines
  for each row execute function public.po_lines_guard();

-- ---------- audit triggers ----------
create trigger audit_products after insert or update or delete on public.products
  for each row execute function public.audit_row();
create trigger audit_variants after insert or update or delete on public.variants
  for each row execute function public.audit_row();
create trigger audit_suppliers after insert or update or delete on public.suppliers
  for each row execute function public.audit_row();
create trigger audit_pos after insert or update or delete on public.purchase_orders
  for each row execute function public.audit_row();
create trigger audit_po_lines after insert or update or delete on public.purchase_order_lines
  for each row execute function public.audit_row();
create trigger audit_stock after insert on public.stock_movements
  for each row execute function public.audit_row();

-- ---------- business functions ----------
create or replace function public.submit_purchase_order(p_po uuid)
returns public.purchase_orders
language plpgsql security definer set search_path = public as $$
declare
  po public.purchase_orders; sup public.suppliers;
  v int; req_id uuid; tot numeric(14,2); h text; is_owner boolean;
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then
    raise exception 'not allowed';
  end if;
  select * into po from public.purchase_orders where id = p_po for update;
  if not found then raise exception 'order not found'; end if;
  if po.status not in ('draft','rejected') then
    raise exception 'cannot submit an order in status %', po.status;
  end if;
  if not exists (select 1 from public.purchase_order_lines where po_id = p_po) then
    raise exception 'order has no lines';
  end if;
  select * into sup from public.suppliers where id = po.supplier_id;
  if sup.status <> 'active' then raise exception 'supplier is inactive'; end if;

  select coalesce(sum(qty_ordered * unit_cost), 0),
         md5(string_agg(variant_id::text||':'||qty_ordered||':'||unit_cost, ',' order by variant_id))
    into tot, h
    from public.purchase_order_lines where po_id = p_po;

  v := coalesce((select max(version) from public.approval_requests
                  where subject_entity = 'purchase_order' and subject_id = p_po), 0) + 1;
  update public.approval_requests set status = 'superseded'
   where subject_entity = 'purchase_order' and subject_id = p_po and status = 'submitted';

  is_owner := public.has_role('owner');
  insert into public.approval_requests
    (action_type, subject_entity, subject_id, version, requested_by, amount, reason,
     payload_hash, status, idempotency_key, branch_id, decided_by, decided_at, decision_comment)
  values
    ('purchase_order.send','purchase_order', p_po, v, auth.uid(), tot,
     'طلبية شراء ' || po.po_number || ' - ' || sup.name, h,
     case when is_owner then 'approved' else 'submitted' end::public.approval_status,
     'po-' || p_po || '-v' || v, po.branch_id,
     case when is_owner then auth.uid() end,
     case when is_owner then now() end,
     case when is_owner then 'أنشأها المالك' end)
  returning id into req_id;

  update public.purchase_orders
     set status = case when is_owner then 'approved' else 'pending_approval' end::public.po_status,
         total = tot, approval_id = req_id,
         supplier_snapshot = jsonb_build_object(
           'name', sup.name, 'phone', sup.phone, 'whatsapp', sup.whatsapp,
           'email', sup.email, 'payment_terms', sup.payment_terms,
           'lead_time_days', sup.lead_time_days)
   where id = p_po returning * into po;
  return po;
end $$;

-- Keep the order status in sync with the owner's decision.
create or replace function public.sync_po_from_approval()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.subject_entity = 'purchase_order' and new.status is distinct from old.status then
    if new.status = 'approved' then
      update public.purchase_orders set status = 'approved'
       where id = new.subject_id and approval_id = new.id and status = 'pending_approval';
    elsif new.status = 'rejected' then
      update public.purchase_orders set status = 'rejected'
       where id = new.subject_id and approval_id = new.id and status = 'pending_approval';
    elsif new.status = 'changes_requested' then
      update public.purchase_orders set status = 'draft'
       where id = new.subject_id and approval_id = new.id and status = 'pending_approval';
    end if;
  end if;
  return new;
end $$;
create trigger approval_sync_po after update on public.approval_requests
  for each row execute function public.sync_po_from_approval();

create or replace function public.send_purchase_order(p_po uuid)
returns public.purchase_orders
language plpgsql security definer set search_path = public as $$
declare po public.purchase_orders; req public.approval_requests; h text;
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then
    raise exception 'not allowed';
  end if;
  select * into po from public.purchase_orders where id = p_po for update;
  if not found then raise exception 'order not found'; end if;
  if po.status <> 'approved' then raise exception 'order is not approved'; end if;

  select * into req from public.approval_requests where id = po.approval_id;
  select md5(string_agg(variant_id::text||':'||qty_ordered||':'||unit_cost, ',' order by variant_id))
    into h from public.purchase_order_lines where po_id = p_po;
  if req.payload_hash is distinct from h then
    raise exception 'order changed after approval';
  end if;
  if not public.consume_approval(po.approval_id) then
    raise exception 'approval is not valid';
  end if;

  update public.purchase_orders set status = 'sent', sent_at = now()
   where id = p_po returning * into po;
  return po;
end $$;

create or replace function public.cancel_purchase_order(p_po uuid, p_reason text)
returns public.purchase_orders
language plpgsql security definer set search_path = public as $$
declare po public.purchase_orders;
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then
    raise exception 'not allowed';
  end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'reason required'; end if;
  select * into po from public.purchase_orders where id = p_po for update;
  if not found then raise exception 'order not found'; end if;
  if po.status in ('received','cancelled','partially_received') then
    raise exception 'cannot cancel an order in status %', po.status;
  end if;
  update public.approval_requests set status = 'superseded'
   where subject_entity = 'purchase_order' and subject_id = p_po and status in ('submitted','approved');
  update public.purchase_orders set status = 'cancelled', cancelled_reason = p_reason
   where id = p_po returning * into po;
  return po;
end $$;

-- p_lines: [{"line_id": "...", "qty": 3}, ...]
create or replace function public.receive_purchase_order(p_po uuid, p_lines jsonb)
returns public.purchase_orders
language plpgsql security definer set search_path = public as $$
declare
  po public.purchase_orders; it jsonb; l public.purchase_order_lines;
  q int; onhand int; oc numeric; newc numeric(14,2); pending int;
begin
  if not public.has_any_role(array['owner','manager','warehouse']::public.app_role[]) then
    raise exception 'not allowed';
  end if;
  select * into po from public.purchase_orders where id = p_po for update;
  if not found then raise exception 'order not found'; end if;
  if po.status not in ('sent','partially_received') then
    raise exception 'order is not open for receiving';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'no lines to receive';
  end if;

  perform set_config('app.po_receiving', 'on', true);
  for it in select * from jsonb_array_elements(p_lines) loop
    q := (it->>'qty')::int;
    if q is null or q <= 0 then continue; end if;
    select * into l from public.purchase_order_lines
     where id = (it->>'line_id')::uuid and po_id = p_po for update;
    if not found then raise exception 'line does not belong to this order'; end if;
    if l.qty_received + q > l.qty_ordered then
      raise exception 'received quantity exceeds ordered quantity';
    end if;

    select coalesce(sum(qty),0) into onhand from public.stock_movements where variant_id = l.variant_id;
    select cost into oc from public.variant_costs where variant_id = l.variant_id;
    newc := case when onhand <= 0 then l.unit_cost
                 else round((onhand * coalesce(oc,0) + q * l.unit_cost) / (onhand + q), 2) end;
    insert into public.variant_costs(variant_id, cost) values (l.variant_id, newc)
      on conflict (variant_id) do update set cost = excluded.cost, updated_at = now();

    insert into public.stock_movements
      (variant_id, branch_id, movement_type, qty, unit_cost, ref_type, ref_id, note)
    values (l.variant_id, po.branch_id, 'purchase_receipt', q, l.unit_cost,
            'purchase_order', p_po, po.po_number);
    update public.purchase_order_lines set qty_received = qty_received + q where id = l.id;
  end loop;

  select count(*) into pending from public.purchase_order_lines
   where po_id = p_po and qty_received < qty_ordered;
  update public.purchase_orders
     set status = case when pending = 0 then 'received' else 'partially_received' end::public.po_status
   where id = p_po returning * into po;
  return po;
end $$;

create or replace function public.adjust_stock(
  p_variant uuid, p_branch uuid, p_delta int, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare onhand int;
begin
  if not public.has_any_role(array['owner','manager','warehouse']::public.app_role[]) then
    raise exception 'not allowed';
  end if;
  if p_delta = 0 then raise exception 'delta must not be zero'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'reason required'; end if;
  select coalesce(sum(qty),0) into onhand from public.stock_movements
   where variant_id = p_variant and branch_id = p_branch;
  if onhand + p_delta < 0 then raise exception 'stock cannot go negative'; end if;
  insert into public.stock_movements(variant_id, branch_id, movement_type, qty, note)
  values (p_variant, p_branch, 'adjustment', p_delta, p_reason);
end $$;

revoke all on function public.submit_purchase_order(uuid) from public, anon;
revoke all on function public.send_purchase_order(uuid) from public, anon;
revoke all on function public.cancel_purchase_order(uuid, text) from public, anon;
revoke all on function public.receive_purchase_order(uuid, jsonb) from public, anon;
revoke all on function public.adjust_stock(uuid, uuid, int, text) from public, anon;
grant execute on function public.submit_purchase_order(uuid) to authenticated;
grant execute on function public.send_purchase_order(uuid) to authenticated;
grant execute on function public.cancel_purchase_order(uuid, text) to authenticated;
grant execute on function public.receive_purchase_order(uuid, jsonb) to authenticated;
grant execute on function public.adjust_stock(uuid, uuid, int, text) to authenticated;

-- ---------- RLS ----------
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.variants enable row level security;
alter table public.variant_costs enable row level security;
alter table public.stock_movements enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_contacts enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;

-- catalog: all staff read; owner/manager/web_admin write
create policy cat_read on public.categories for select to authenticated using (public.is_staff());
create policy cat_write on public.categories for all to authenticated
  using (public.has_any_role(array['owner','manager','web_admin']::public.app_role[]))
  with check (public.has_any_role(array['owner','manager','web_admin']::public.app_role[]));

create policy prod_read on public.products for select to authenticated using (public.is_staff());
create policy prod_write on public.products for all to authenticated
  using (public.has_any_role(array['owner','manager','web_admin']::public.app_role[]))
  with check (public.has_any_role(array['owner','manager','web_admin']::public.app_role[]));

create policy var_read on public.variants for select to authenticated using (public.is_staff());
create policy var_write on public.variants for all to authenticated
  using (public.has_any_role(array['owner','manager','web_admin']::public.app_role[]))
  with check (public.has_any_role(array['owner','manager','web_admin']::public.app_role[]));

-- cost: not for cashier / web_admin
create policy cost_read on public.variant_costs for select to authenticated
  using (public.has_any_role(array['owner','manager','accountant','warehouse']::public.app_role[]));
create policy cost_write on public.variant_costs for all to authenticated
  using (public.has_any_role(array['owner','manager']::public.app_role[]))
  with check (public.has_any_role(array['owner','manager']::public.app_role[]));

-- stock ledger: staff read; writes only via functions
create policy mov_read on public.stock_movements for select to authenticated using (public.is_staff());

-- suppliers: owner/manager/accountant read & owner/manager write; warehouse reads names for receiving
create policy sup_read on public.suppliers for select to authenticated
  using (public.has_any_role(array['owner','manager','accountant','warehouse']::public.app_role[]));
create policy sup_write on public.suppliers for all to authenticated
  using (public.has_any_role(array['owner','manager']::public.app_role[]))
  with check (public.has_any_role(array['owner','manager']::public.app_role[]));
create policy supc_read on public.supplier_contacts for select to authenticated
  using (public.has_any_role(array['owner','manager','accountant','warehouse']::public.app_role[]));
create policy supc_write on public.supplier_contacts for all to authenticated
  using (public.has_any_role(array['owner','manager']::public.app_role[]))
  with check (public.has_any_role(array['owner','manager']::public.app_role[]));

-- purchase orders: read by purchasing roles; edit header only while draft/rejected; status via functions
create policy po_read on public.purchase_orders for select to authenticated
  using (public.has_any_role(array['owner','manager','accountant','warehouse']::public.app_role[]));
create policy po_insert on public.purchase_orders for insert to authenticated
  with check (public.has_any_role(array['owner','manager']::public.app_role[])
              and status = 'draft' and created_by = auth.uid());
create policy po_update on public.purchase_orders for update to authenticated
  using (public.has_any_role(array['owner','manager']::public.app_role[]) and status in ('draft','rejected'))
  with check (status in ('draft','rejected'));
create policy po_delete on public.purchase_orders for delete to authenticated
  using (public.has_any_role(array['owner','manager']::public.app_role[]) and status = 'draft');

create policy pol_read on public.purchase_order_lines for select to authenticated
  using (public.has_any_role(array['owner','manager','accountant','warehouse']::public.app_role[]));
create policy pol_write on public.purchase_order_lines for all to authenticated
  using (public.has_any_role(array['owner','manager']::public.app_role[]))
  with check (public.has_any_role(array['owner','manager']::public.app_role[]));

-- purchasing staff can read the history (timeline) of orders, stock and approvals
create policy audit_read_purchasing on public.audit_log for select to authenticated
  using (public.has_any_role(array['manager','warehouse']::public.app_role[])
         and entity in ('purchase_orders','purchase_order_lines','approval_requests','stock_movements'));

-- ---------- seed ----------
insert into public.branches(name)
select 'الفرع الرئيسي' where not exists (select 1 from public.branches);

insert into public.categories(name, sort_order) values
 ('موبايلات',1),('لابتوبات',2),('إكسسوارات',3),('شواحن وكابلات',4)
on conflict (name) do nothing;
