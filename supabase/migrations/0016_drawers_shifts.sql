-- 0016: money drawers and shifts (Phase 1 of docs/VOLT-PARITY-PLAN.md). Needs 0006-0009 and 0015.
--  * 6 drawers per branch: products, maintenance, machines, installments, wallets (counted every shift)
--    and the safe (carries over between shifts, never counted at shift open/close).
--  * Drawer balance = sum of an append-only ledger (drawer_movements). There is no editable balance column.
--  * Existing cash flows (cash sale, cash refund, cash expense, cash supplier payment) are mirrored into the
--    products drawer by triggers, so the old screens keep working and the ledger stays in step.
--  * open_shift / close_shift count each drawer; a difference is written as a ledger movement and kept in the
--    shift record. Transfers and manual adjustments need an open shift; large ones need a manager PIN token.
-- Money = numeric(14,2). RLS on every table. Writes go through functions only.

-- ---------- drawers ----------
create table public.drawers (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  code text not null check (code in ('products','maintenance','machines','installments','wallets','safe')),
  name text not null,
  sort_order int not null,
  carries_over boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (branch_id, code)
);
alter table public.drawers enable row level security;
create policy drawers_read on public.drawers for select to authenticated using (public.is_staff());
create trigger audit_drawers after insert or update or delete on public.drawers
  for each row execute function public.audit_row();

create or replace function public.ensure_drawers(p_branch uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.drawers(branch_id, code, name, sort_order, carries_over) values
    (p_branch, 'products',     'درج المنتجات',       1, false),
    (p_branch, 'maintenance',  'درج الصيانة',        2, false),
    (p_branch, 'machines',     'درج ماكينات الدفع',  3, false),
    (p_branch, 'installments', 'درج الأقساط',        4, false),
    (p_branch, 'wallets',      'درج المحافظ',        5, false),
    (p_branch, 'safe',         'الخزنة',             6, true)
  on conflict (branch_id, code) do nothing;
$$;
revoke all on function public.ensure_drawers(uuid) from public, anon, authenticated;

create or replace function public.branch_after_insert_drawers()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.ensure_drawers(new.id); return new; end $$;
revoke all on function public.branch_after_insert_drawers() from public, anon, authenticated;
create trigger branches_make_drawers after insert on public.branches
  for each row execute function public.branch_after_insert_drawers();

select public.ensure_drawers(id) from public.branches;

-- ---------- ledger ----------
create table public.drawer_movements (
  id bigint generated always as identity primary key,
  drawer_id uuid not null references public.drawers(id),
  session_id uuid references public.cash_sessions(id),
  amount numeric(14,2) not null check (amount <> 0),
  kind text not null check (kind in
    ('opening_adjust','closing_adjust','sale','refund','expense','supplier_payment','transfer_in','transfer_out','adjustment')),
  ref_type text,
  ref_id text,
  group_id uuid,
  note text,
  idempotency_key uuid unique,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.drawer_movements (drawer_id, created_at desc);
create index on public.drawer_movements (session_id);
create index on public.drawer_movements (group_id);
create trigger drawer_movements_append_only before update or delete on public.drawer_movements
  for each row execute function public.audit_block_mutation();
alter table public.drawer_movements enable row level security;
create policy drawer_mov_read on public.drawer_movements for select to authenticated
  using (public.has_any_role(array['owner','manager','accountant']::public.app_role[]));

-- ---------- shift record additions ----------
alter table public.cash_sessions
  add column if not exists opened_for uuid references public.profiles(id),
  add column if not exists opening_counts jsonb,
  add column if not exists closing_counts jsonb,
  add column if not exists closing_snapshot jsonb;

insert into public.app_settings(key, value) values ('drawer_transfer_pin_threshold', 5000)
  on conflict (key) do nothing;   -- transfers/adjustments at or above this need a manager PIN (owner exempt)

-- ---------- mirror existing cash flows into the products drawer ----------
create or replace function public.mirror_cash_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare br uuid; sess uuid; amt numeric(14,2); k text; rt text; rid text; d uuid;
begin
  if tg_table_name = 'sales_payments' then
    if new.method <> 'cash' then return new; end if;
    sess := new.session_id; amt := new.amount; k := 'sale'; rt := 'sales_invoice'; rid := new.invoice_id::text;
  elsif tg_table_name = 'sales_refunds' then
    if new.method <> 'cash' then return new; end if;
    sess := new.session_id; amt := -new.amount; k := 'refund'; rt := 'sales_return'; rid := new.return_id::text;
  elsif tg_table_name = 'expense_payments' then
    if new.method <> 'cash' then return new; end if;
    sess := new.session_id; amt := -new.amount; k := 'expense'; rt := 'expense'; rid := new.expense_id::text;
  elsif tg_table_name = 'supplier_payments' then
    if new.method <> 'cash' or new.status <> 'completed' then return new; end if;
    if tg_op = 'UPDATE' then
      if old.status = 'completed' then return new; end if;
    end if;
    sess := new.session_id; amt := -new.amount; k := 'supplier_payment'; rt := 'supplier_payment'; rid := new.id::text;
  else
    return new;
  end if;
  br := coalesce((select branch_id from public.cash_sessions where id = sess),
                 (select id from public.branches where is_active order by created_at limit 1));
  perform public.ensure_drawers(br);
  select id into d from public.drawers where branch_id = br and code = 'products';
  insert into public.drawer_movements(drawer_id, session_id, amount, kind, ref_type, ref_id)
  values (d, sess, amt, k, rt, rid);
  return new;
end $$;
revoke all on function public.mirror_cash_movement() from public, anon, authenticated;

create trigger mirror_sales_payments after insert on public.sales_payments
  for each row execute function public.mirror_cash_movement();
create trigger mirror_sales_refunds after insert on public.sales_refunds
  for each row execute function public.mirror_cash_movement();
create trigger mirror_expense_payments after insert on public.expense_payments
  for each row execute function public.mirror_cash_movement();
create trigger mirror_supplier_payments after insert or update on public.supplier_payments
  for each row execute function public.mirror_cash_movement();

-- ---------- balances ----------
create or replace function public.drawer_balances()
returns table(id uuid, code text, name text, carries_over boolean, balance numeric)
language plpgsql stable security definer set search_path = public as $$
declare br uuid;
begin
  if not public.has_any_role(array['owner','manager','cashier','accountant']::public.app_role[]) then
    raise exception 'not allowed';
  end if;
  br := (select b.id from public.branches b where b.is_active order by b.created_at limit 1);
  return query
    select d.id, d.code, d.name, d.carries_over,
           coalesce((select sum(m.amount) from public.drawer_movements m where m.drawer_id = d.id), 0)::numeric
      from public.drawers d where d.branch_id = br and d.is_active order by d.sort_order;
end $$;

-- ---------- open a shift ----------
-- p_counts: {"products": 1500, "wallets": 0}. A missing or null key = skipped (the expected balance is kept).
create or replace function public.open_shift(p_for uuid default null, p_counts jsonb default '{}'::jsonb)
returns public.cash_sessions
language plpgsql security definer set search_path = public as $$
declare br uuid; s public.cash_sessions; d record; bal numeric(14,2); cnt numeric(14,2);
        counts jsonb := '{}'::jsonb; prod_open numeric(14,2) := 0; who uuid := coalesce(p_for, auth.uid());
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('open_shift', 10, 60);
  if who <> auth.uid() then
    if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
    if not exists (select 1 from public.user_roles ur join public.profiles p on p.id = ur.user_id
                    where ur.user_id = who and ur.role in ('owner','manager','cashier') and p.is_active) then
      raise exception 'invalid shift employee';
    end if;
  end if;
  if p_counts is null or jsonb_typeof(p_counts) <> 'object' then raise exception 'invalid count'; end if;
  if exists (select 1 from jsonb_object_keys(p_counts) k
              where k not in ('products','maintenance','machines','installments','wallets')) then
    raise exception 'invalid count';
  end if;
  br := (select b.id from public.branches b where b.is_active order by b.created_at limit 1);
  perform public.ensure_drawers(br);
  if exists (select 1 from public.cash_sessions where branch_id = br and status = 'open') then
    raise exception 'a cash session is already open';
  end if;
  insert into public.cash_sessions(branch_id, opening_balance, opened_for) values (br, 0, who) returning * into s;

  for d in select * from public.drawers where branch_id = br and is_active and code <> 'safe' order by sort_order loop
    select coalesce(sum(amount), 0) into bal from public.drawer_movements where drawer_id = d.id;
    if (p_counts ->> d.code) is not null then
      cnt := round((p_counts ->> d.code)::numeric, 2);
      if cnt < 0 then raise exception 'invalid count'; end if;
      if cnt <> bal then
        insert into public.drawer_movements(drawer_id, session_id, amount, kind, ref_type, ref_id, note)
        values (d.id, s.id, cnt - bal, 'opening_adjust', 'cash_session', s.id::text, 'فرق جرد الفتح');
      end if;
      counts := counts || jsonb_build_object(d.code, jsonb_build_object('expected', bal, 'counted', cnt, 'difference', cnt - bal));
      bal := cnt;
    else
      counts := counts || jsonb_build_object(d.code, jsonb_build_object('expected', bal, 'counted', null, 'difference', 0));
    end if;
    if d.code = 'products' then prod_open := bal; end if;
  end loop;

  update public.cash_sessions set opening_balance = greatest(prod_open, 0), opening_counts = counts
   where id = s.id returning * into s;
  return s;
end $$;

-- ---------- close a shift ----------
create or replace function public.close_shift(p_counts jsonb default '{}'::jsonb, p_note text default null)
returns public.cash_sessions
language plpgsql security definer set search_path = public as $$
declare br uuid; s public.cash_sessions; d record; bal numeric(14,2); cnt numeric(14,2);
        counts jsonb := '{}'::jsonb; after_bal jsonb := '{}'::jsonb;
        exp_total numeric(14,2) := 0; cnt_total numeric(14,2) := 0; any_diff boolean := false;
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('close_shift', 10, 60);
  if p_counts is null or jsonb_typeof(p_counts) <> 'object' then raise exception 'invalid count'; end if;
  if exists (select 1 from jsonb_object_keys(p_counts) k
              where k not in ('products','maintenance','machines','installments','wallets')) then
    raise exception 'invalid count';
  end if;
  br := (select b.id from public.branches b where b.is_active order by b.created_at limit 1);
  select * into s from public.cash_sessions where branch_id = br and status = 'open' for update;
  if not found then raise exception 'no open cash session'; end if;

  -- first pass: work out differences so we can require a note before writing anything
  for d in select * from public.drawers where branch_id = br and is_active and code <> 'safe' order by sort_order loop
    select coalesce(sum(amount), 0) into bal from public.drawer_movements where drawer_id = d.id;
    if (p_counts ->> d.code) is not null then
      cnt := round((p_counts ->> d.code)::numeric, 2);
      if cnt < 0 then raise exception 'invalid count'; end if;
      if cnt <> bal then any_diff := true; end if;
    end if;
  end loop;
  if any_diff and coalesce(trim(p_note), '') = '' then raise exception 'note required when there is a difference'; end if;

  for d in select * from public.drawers where branch_id = br and is_active and code <> 'safe' order by sort_order loop
    select coalesce(sum(amount), 0) into bal from public.drawer_movements where drawer_id = d.id;
    exp_total := exp_total + bal;
    if (p_counts ->> d.code) is not null then
      cnt := round((p_counts ->> d.code)::numeric, 2);
      if cnt <> bal then
        insert into public.drawer_movements(drawer_id, session_id, amount, kind, ref_type, ref_id, note)
        values (d.id, s.id, cnt - bal, 'closing_adjust', 'cash_session', s.id::text, nullif(trim(coalesce(p_note, '')), ''));
      end if;
      counts := counts || jsonb_build_object(d.code, jsonb_build_object('expected', bal, 'counted', cnt, 'difference', cnt - bal));
      cnt_total := cnt_total + cnt;
      after_bal := after_bal || jsonb_build_object(d.code, cnt);
    else
      counts := counts || jsonb_build_object(d.code, jsonb_build_object('expected', bal, 'counted', null, 'difference', 0));
      cnt_total := cnt_total + bal;
      after_bal := after_bal || jsonb_build_object(d.code, bal);
    end if;
  end loop;

  update public.cash_sessions
     set status = 'closed', closed_by = auth.uid(), closed_at = now(),
         expected_cash = exp_total, counted_cash = cnt_total, difference = cnt_total - exp_total,
         close_note = nullif(trim(coalesce(p_note, '')), ''),
         closing_counts = counts,
         closing_snapshot = jsonb_build_object(
           'drawers', after_bal,
           'safe', coalesce((select sum(m.amount) from public.drawer_movements m
                              join public.drawers dd on dd.id = m.drawer_id and dd.branch_id = br and dd.code = 'safe'), 0))
   where id = s.id returning * into s;
  return s;
end $$;

-- ---------- move money between drawers ----------
create or replace function public.transfer_drawer(
  p_from uuid, p_to uuid, p_amount numeric, p_note text, p_idem uuid, p_override uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare a public.drawers; b public.drawers; s public.cash_sessions; bal numeric(14,2); thr numeric; g uuid;
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_idem is null then raise exception 'idempotency key required'; end if;
  select group_id into g from public.drawer_movements where idempotency_key = p_idem;
  if g is not null then return g; end if;            -- repeat click: same answer, no second transfer
  perform public.enforce_rate_limit('drawer_move', 30, 60);
  if p_amount is null or round(p_amount, 2) <= 0 then raise exception 'invalid amount'; end if;
  if p_from = p_to then raise exception 'invalid drawers'; end if;
  select * into a from public.drawers where id = p_from and is_active for update;
  select * into b from public.drawers where id = p_to and is_active for update;
  if a.id is null or b.id is null or a.branch_id <> b.branch_id then raise exception 'invalid drawers'; end if;
  select * into s from public.cash_sessions where branch_id = a.branch_id and status = 'open';
  if not found then raise exception 'no open cash session'; end if;
  if (a.code = 'safe' or b.code = 'safe') and not public.has_any_role(array['owner','manager']::public.app_role[]) then
    raise exception 'not allowed';
  end if;
  select coalesce(sum(amount), 0) into bal from public.drawer_movements where drawer_id = a.id;
  if bal < round(p_amount, 2) then raise exception 'insufficient drawer balance'; end if;
  thr := coalesce((select value from public.app_settings where key = 'drawer_transfer_pin_threshold'), 5000);
  if round(p_amount, 2) >= thr and not public.has_role('owner') then
    if p_override is null then raise exception 'override required'; end if;
    perform public.consume_override(p_override);
  end if;
  g := gen_random_uuid();
  insert into public.drawer_movements(drawer_id, session_id, amount, kind, ref_type, ref_id, group_id, note, idempotency_key)
  values (a.id, s.id, -round(p_amount, 2), 'transfer_out', 'drawer', b.id::text, g, nullif(trim(coalesce(p_note, '')), ''), p_idem);
  insert into public.drawer_movements(drawer_id, session_id, amount, kind, ref_type, ref_id, group_id, note)
  values (b.id, s.id, round(p_amount, 2), 'transfer_in', 'drawer', a.id::text, g, nullif(trim(coalesce(p_note, '')), ''));
  return g;
end $$;

-- ---------- set a drawer to a counted value (owner/manager, reason required) ----------
create or replace function public.adjust_drawer(
  p_drawer uuid, p_target numeric, p_note text, p_idem uuid, p_override uuid default null)
returns numeric
language plpgsql security definer set search_path = public as $$
declare d public.drawers; s public.cash_sessions; bal numeric(14,2); delta numeric(14,2); thr numeric;
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_idem is null then raise exception 'idempotency key required'; end if;
  if exists (select 1 from public.drawer_movements where idempotency_key = p_idem) then
    return (select coalesce(sum(amount), 0) from public.drawer_movements where drawer_id = p_drawer);
  end if;
  perform public.enforce_rate_limit('drawer_move', 30, 60);
  if coalesce(trim(p_note), '') = '' then raise exception 'reason required'; end if;
  if p_target is null or p_target < 0 then raise exception 'invalid amount'; end if;
  select * into d from public.drawers where id = p_drawer and is_active for update;
  if not found then raise exception 'invalid drawers'; end if;
  select * into s from public.cash_sessions where branch_id = d.branch_id and status = 'open';
  if not found then raise exception 'no open cash session'; end if;
  select coalesce(sum(amount), 0) into bal from public.drawer_movements where drawer_id = d.id;
  delta := round(p_target, 2) - bal;
  if delta = 0 then raise exception 'no change'; end if;
  thr := coalesce((select value from public.app_settings where key = 'drawer_transfer_pin_threshold'), 5000);
  if abs(delta) >= thr and not public.has_role('owner') then
    if p_override is null then raise exception 'override required'; end if;
    perform public.consume_override(p_override);
  end if;
  insert into public.drawer_movements(drawer_id, session_id, amount, kind, ref_type, ref_id, note, idempotency_key)
  values (d.id, s.id, delta, 'adjustment', 'drawer', d.id::text, trim(p_note), p_idem);
  return round(p_target, 2);
end $$;

-- ---------- grants ----------
revoke all on function public.drawer_balances() from public, anon;
revoke all on function public.open_shift(uuid, jsonb) from public, anon;
revoke all on function public.close_shift(jsonb, text) from public, anon;
revoke all on function public.transfer_drawer(uuid, uuid, numeric, text, uuid, uuid) from public, anon;
revoke all on function public.adjust_drawer(uuid, numeric, text, uuid, uuid) from public, anon;
grant execute on function public.drawer_balances() to authenticated;
grant execute on function public.open_shift(uuid, jsonb) to authenticated;
grant execute on function public.close_shift(jsonb, text) to authenticated;
grant execute on function public.transfer_drawer(uuid, uuid, numeric, text, uuid, uuid) to authenticated;
grant execute on function public.adjust_drawer(uuid, numeric, text, uuid, uuid) to authenticated;
