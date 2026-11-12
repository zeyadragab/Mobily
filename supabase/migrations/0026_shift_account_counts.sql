-- 0026: wallets and machines are counted when a shift closes, and the closing snapshot records stock value.
-- Needs 0024 (accounts, shift alerts). A difference needs a note and raises a shift alert for a manager to review,
-- exactly like a drawer difference. Accounts that are not counted keep their balance.

alter table public.cash_sessions add column closing_account_counts jsonb;

create or replace function public.raise_shift_alerts()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.opening_counts is not null and (tg_op = 'INSERT' or new.opening_counts is distinct from old.opening_counts) then
    for r in select key, (value->>'difference')::numeric as diff from jsonb_each(new.opening_counts)
              where jsonb_typeof(value) = 'object' and coalesce((value->>'difference')::numeric, 0) <> 0 loop
      insert into public.shift_alerts(session_id, phase, drawer_code, difference) values (new.id, 'open', r.key, r.diff)
      on conflict do nothing;
    end loop;
  end if;
  if new.closing_counts is not null and (tg_op = 'INSERT' or new.closing_counts is distinct from old.closing_counts) then
    for r in select key, (value->>'difference')::numeric as diff from jsonb_each(new.closing_counts)
              where jsonb_typeof(value) = 'object' and coalesce((value->>'difference')::numeric, 0) <> 0 loop
      insert into public.shift_alerts(session_id, phase, drawer_code, difference) values (new.id, 'close', r.key, r.diff)
      on conflict do nothing;
    end loop;
  end if;
  -- account differences use the code 'acct:<account id>'
  if new.closing_account_counts is not null and (tg_op = 'INSERT' or new.closing_account_counts is distinct from old.closing_account_counts) then
    for r in select key, (value->>'difference')::numeric as diff from jsonb_each(new.closing_account_counts)
              where jsonb_typeof(value) = 'object' and coalesce((value->>'difference')::numeric, 0) <> 0 loop
      insert into public.shift_alerts(session_id, phase, drawer_code, difference) values (new.id, 'close', 'acct:' || r.key, r.diff)
      on conflict do nothing;
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.raise_shift_alerts() from public, anon, authenticated;

drop function public.close_shift(jsonb, text);
create or replace function public.close_shift(
  p_counts jsonb default '{}'::jsonb, p_note text default null, p_account_counts jsonb default '{}'::jsonb)
returns public.cash_sessions
language plpgsql security definer set search_path = public as $$
declare br uuid; s public.cash_sessions; d record; a record; bal numeric(14,2); cnt numeric(14,2);
        counts jsonb := '{}'::jsonb; acounts jsonb := '{}'::jsonb; after_bal jsonb := '{}'::jsonb;
        exp_total numeric(14,2) := 0; cnt_total numeric(14,2) := 0; any_diff boolean := false; stock_value numeric(14,2);
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('close_shift', 10, 60);
  if p_counts is null or jsonb_typeof(p_counts) <> 'object' then raise exception 'invalid count'; end if;
  if p_account_counts is null or jsonb_typeof(p_account_counts) <> 'object' then raise exception 'invalid count'; end if;
  if exists (select 1 from jsonb_object_keys(p_counts) k
              where k not in ('products','maintenance','machines','installments','wallets')) then
    raise exception 'invalid count';
  end if;
  if exists (select 1 from jsonb_object_keys(p_account_counts) k
              where not exists (select 1 from public.money_accounts m where m.id::text = k and m.is_active)) then
    raise exception 'invalid account';
  end if;
  br := (select b.id from public.branches b where b.is_active order by b.created_at limit 1);
  select * into s from public.cash_sessions where branch_id = br and status = 'open' for update;
  if not found then raise exception 'no open cash session'; end if;

  -- first pass: find differences so a note can be required before anything is written
  for d in select * from public.drawers where branch_id = br and is_active and code <> 'safe' order by sort_order loop
    select coalesce(sum(amount), 0) into bal from public.drawer_movements where drawer_id = d.id;
    if (p_counts ->> d.code) is not null then
      cnt := round((p_counts ->> d.code)::numeric, 2);
      if cnt < 0 then raise exception 'invalid count'; end if;
      if cnt <> bal then any_diff := true; end if;
    end if;
  end loop;
  for a in select * from public.money_accounts m where m.is_active loop
    if (p_account_counts ->> a.id::text) is not null then
      select coalesce(sum(amount), 0) into bal from public.account_movements where account_id = a.id;
      cnt := round((p_account_counts ->> a.id::text)::numeric, 2);
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

  for a in select * from public.money_accounts m where m.is_active loop
    select coalesce(sum(amount), 0) into bal from public.account_movements where account_id = a.id;
    if (p_account_counts ->> a.id::text) is not null then
      cnt := round((p_account_counts ->> a.id::text)::numeric, 2);
      if cnt <> bal then
        insert into public.account_movements(account_id, amount, kind, ref_type, ref_id, note)
        values (a.id, cnt - bal, 'adjustment', 'cash_session', s.id::text,
                'عدّ إغلاق الوردية: ' || nullif(trim(coalesce(p_note, '')), ''));
      end if;
      acounts := acounts || jsonb_build_object(a.id::text, jsonb_build_object('name', a.name, 'expected', bal, 'counted', cnt, 'difference', cnt - bal));
    else
      acounts := acounts || jsonb_build_object(a.id::text, jsonb_build_object('name', a.name, 'expected', bal, 'counted', null, 'difference', 0));
    end if;
  end loop;

  select coalesce(sum(sm.q * vc.cost), 0) into stock_value
    from (select variant_id, sum(qty) as q from public.stock_movements group by variant_id) sm
    join public.variant_costs vc on vc.variant_id = sm.variant_id
   where sm.q > 0;

  update public.cash_sessions
     set status = 'closed', closed_by = auth.uid(), closed_at = now(),
         expected_cash = exp_total, counted_cash = cnt_total, difference = cnt_total - exp_total,
         close_note = nullif(trim(coalesce(p_note, '')), ''),
         closing_counts = counts,
         closing_account_counts = acounts,
         closing_snapshot = jsonb_build_object(
           'drawers', after_bal,
           'accounts', (select coalesce(jsonb_object_agg(k, (v->>'counted')::numeric), '{}'::jsonb)
                          from jsonb_each(acounts) e(k, v) where v->>'counted' is not null),
           'stock_value', stock_value,
           'safe', coalesce((select sum(m.amount) from public.drawer_movements m
                              join public.drawers dd on dd.id = m.drawer_id and dd.branch_id = br and dd.code = 'safe'), 0))
   where id = s.id returning * into s;
  return s;
end $$;
revoke all on function public.close_shift(jsonb, text, jsonb) from public, anon;
grant execute on function public.close_shift(jsonb, text, jsonb) to authenticated;
