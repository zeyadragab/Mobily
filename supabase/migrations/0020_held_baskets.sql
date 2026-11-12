-- 0020: held baskets (Phase 2 of docs/VOLT-PARITY-PLAN.md). A cashier parks a sale and resumes it later.
-- A held basket reserves nothing: stock and serials are checked again when the sale is saved.
-- Owner/manager see every held basket; a cashier sees only their own. Max 20 per user.
-- Money = numeric(14,2). RLS on every table. Writes go through functions only.

create table public.held_baskets (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  created_by uuid not null default auth.uid() references public.profiles(id),
  label text,
  customer_name text,
  customer_phone text,
  discount numeric(14,2) not null default 0 check (discount >= 0),
  notes text,
  lines jsonb not null,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 100)
);
create index on public.held_baskets (created_by, created_at desc);
alter table public.held_baskets enable row level security;
create policy held_read on public.held_baskets for select to authenticated
  using (public.has_any_role(array['owner','manager']::public.app_role[])
         or (public.has_role('cashier') and created_by = auth.uid()));
create trigger audit_held_baskets after insert or update or delete on public.held_baskets
  for each row execute function public.audit_row();

-- p_lines: [{"variant_id": "...", "qty": 2} | {"variant_id": "...", "serials": ["..."]}]
-- p_replace: the id of a basket being resumed and held again (deleted in the same transaction).
create or replace function public.hold_basket(
  p_label text, p_customer_name text, p_customer_phone text, p_discount numeric, p_notes text,
  p_lines jsonb, p_replace uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare it jsonb; br uuid; n int; id uuid;
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('hold_basket', 30, 60);
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'basket is empty';
  end if;
  for it in select * from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(it) <> 'object' or (it->>'variant_id') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'invalid basket'; end if;
    if not (it ? 'qty' or it ? 'serials') then raise exception 'invalid basket'; end if;
    if it ? 'qty' and ((it->>'qty') !~ '^[0-9]{1,6}$' or (it->>'qty')::int < 1) then raise exception 'invalid basket'; end if;
    if it ? 'serials' and jsonb_typeof(it->'serials') <> 'array' then raise exception 'invalid basket'; end if;
  end loop;
  if p_discount is null or p_discount < 0 then raise exception 'invalid amount'; end if;
  if p_replace is not null then
    delete from public.held_baskets
     where id = p_replace and (created_by = auth.uid() or public.has_any_role(array['owner','manager']::public.app_role[]));
  end if;
  select count(*) into n from public.held_baskets where created_by = auth.uid();
  if n >= 20 then raise exception 'too many held baskets'; end if;
  br := (select b.id from public.branches b where b.is_active order by b.created_at limit 1);
  insert into public.held_baskets(branch_id, label, customer_name, customer_phone, discount, notes, lines)
  values (br, nullif(trim(coalesce(p_label, '')), ''), nullif(trim(coalesce(p_customer_name, '')), ''),
          nullif(trim(coalesce(p_customer_phone, '')), ''), round(p_discount, 2),
          nullif(trim(coalesce(p_notes, '')), ''), p_lines)
  returning held_baskets.id into id;
  return id;
end $$;

create or replace function public.discard_basket(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  delete from public.held_baskets
   where id = p_id and (created_by = auth.uid() or public.has_any_role(array['owner','manager']::public.app_role[]));
end $$;

revoke all on function public.hold_basket(text, text, text, numeric, text, jsonb, uuid) from public, anon;
revoke all on function public.discard_basket(uuid) from public, anon;
grant execute on function public.hold_basket(text, text, text, numeric, text, jsonb, uuid) to authenticated;
grant execute on function public.discard_basket(uuid) to authenticated;
