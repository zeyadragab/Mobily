-- 0015: security hardening.
--  1. Rate limits on money-moving writes (per user, fixed window, enforced in the database).
--  2. Shift gate: no sale can be recorded unless the branch has an open cash session.
--  3. Manager PIN (bcrypt, lockout after 5 wrong tries) and one-time override tokens.
--  4. Append-only security_events log (PIN failures, lockouts, force-logout, PIN changes).
--  5. Force logout: owner can end a user's sessions; the app checks is_current_session_valid().
-- Money = numeric(14,2). RLS on every table. Writes go through functions only.

create extension if not exists pgcrypto with schema extensions;

-- ---------- security events (append-only) ----------
create table public.security_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  subject_id uuid,
  kind text not null,
  detail jsonb
);
create index on public.security_events (occurred_at desc);
create index on public.security_events (kind);
create index on public.security_events (actor_id, kind, occurred_at desc);
create trigger security_events_no_update before update or delete on public.security_events
  for each row execute function public.audit_block_mutation();
alter table public.security_events enable row level security;
create policy sec_events_read on public.security_events for select to authenticated
  using (public.has_any_role(array['owner','accountant']::public.app_role[]));

create or replace function public.log_security_event(p_kind text, p_subject uuid, p_detail jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into public.security_events(actor_id, subject_id, kind, detail)
  values (auth.uid(), p_subject, p_kind, p_detail);
$$;
revoke all on function public.log_security_event(text, uuid, jsonb) from public, anon, authenticated;

-- ---------- rate limits ----------
create table public.rate_limits (
  actor uuid not null,
  action text not null,
  window_start timestamptz not null,
  hits int not null default 1,
  primary key (actor, action, window_start)
);
alter table public.rate_limits enable row level security;   -- no policies: nobody reads it through the API

-- Counts one hit for the signed-in user. Raises when the window limit is passed.
-- (The raise rolls the whole statement back, so a blocked attempt is never half-saved.)
create or replace function public.enforce_rate_limit(p_action text, p_max int, p_window_seconds int)
returns void language plpgsql security definer set search_path = public as $$
declare w timestamptz; n int;
begin
  if auth.uid() is null then return; end if;   -- service role / migrations
  w := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits(actor, action, window_start) values (auth.uid(), p_action, w)
  on conflict (actor, action, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into n;
  if n > p_max then raise exception 'rate limit exceeded'; end if;
  if random() < 0.01 then delete from public.rate_limits where window_start < now() - interval '1 day'; end if;
end $$;
revoke all on function public.enforce_rate_limit(text, int, int) from public, anon, authenticated;

create or replace function public.rate_limit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.enforce_rate_limit(tg_argv[0], tg_argv[1]::int, tg_argv[2]::int);
  return new;
end $$;
revoke all on function public.rate_limit_trigger() from public, anon, authenticated;

create trigger rl_sales before insert on public.sales_invoices
  for each row execute function public.rate_limit_trigger('sale', '60', '60');
create trigger rl_expenses before insert on public.expenses
  for each row execute function public.rate_limit_trigger('expense', '20', '60');
create trigger rl_refunds before insert on public.sales_refunds
  for each row execute function public.rate_limit_trigger('refund', '15', '60');
create trigger rl_approvals before insert on public.approval_requests
  for each row execute function public.rate_limit_trigger('approval', '30', '60');

-- ---------- shift gate ----------
insert into public.app_settings(key, value) values ('require_open_shift', 1)
  on conflict (key) do nothing;   -- 1 = no sale without an open shift; 0 = off

create or replace function public.require_open_shift()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if coalesce((select value from public.app_settings where key = 'require_open_shift'), 1) = 1
     and not exists (select 1 from public.cash_sessions where branch_id = new.branch_id and status = 'open') then
    raise exception 'no open shift';
  end if;
  return new;
end $$;
revoke all on function public.require_open_shift() from public, anon, authenticated;

create trigger gate_sales_open_shift before insert on public.sales_invoices
  for each row execute function public.require_open_shift();

-- ---------- manager PIN ----------
create table public.manager_pins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  pin_hash text not null,
  failed_count int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.manager_pins enable row level security;   -- no policies: hash never leaves the database

create table public.override_tokens (
  id uuid primary key default gen_random_uuid(),
  approver_id uuid not null references public.profiles(id),
  requested_by uuid not null references public.profiles(id),
  reason text not null check (char_length(trim(reason)) > 0),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.override_tokens (requested_by, created_at desc);
alter table public.override_tokens enable row level security;
create policy override_read on public.override_tokens for select to authenticated
  using (public.has_any_role(array['owner','accountant']::public.app_role[]));

-- Owner/manager sets or changes their own PIN: 6-8 digits, not trivial.
create or replace function public.set_my_pin(p_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{6,8}$' then raise exception 'pin must be 6 to 8 digits'; end if;
  if p_pin ~ '^(.)\1+$' or p_pin in ('123456','654321','1234567','12345678','87654321','012345','123123') then
    raise exception 'pin too easy';
  end if;
  insert into public.manager_pins(user_id, pin_hash) values (auth.uid(), crypt(p_pin, gen_salt('bf', 10)))
  on conflict (user_id) do update
    set pin_hash = excluded.pin_hash, failed_count = 0, locked_until = null, updated_at = now();
  perform public.log_security_event('pin_set', auth.uid(), null);
end $$;

-- Who can approve at the counter (names only, no secrets).
create or replace function public.list_approvers()
returns table(id uuid, full_name text, role public.app_role)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, ur.role
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.id and ur.role in ('owner','manager')
    join public.manager_pins mp on mp.user_id = p.id
   where public.is_staff() and p.is_active and p.id <> auth.uid()
   order by p.full_name;
$$;

-- A cashier asks an owner/manager to approve something by typing that person's PIN.
-- Returns jsonb (never raises on a wrong PIN, so the failure counter is kept):
--   {ok:true, token, expires_at} | {ok:false, reason: wrong|locked|throttled|no_pin|invalid, remaining?, until?}
create or replace function public.request_override(p_approver uuid, p_pin text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare mp public.manager_pins; tok uuid; exp timestamptz; recent int;
begin
  if not public.is_staff() then raise exception 'not allowed'; end if;
  if p_reason is null or char_length(trim(p_reason)) = 0 or p_pin is null or p_approver is null
     or p_approver = auth.uid() then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if not exists (select 1 from public.user_roles ur join public.profiles p on p.id = ur.user_id
                  where ur.user_id = p_approver and ur.role in ('owner','manager') and p.is_active) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  -- one caller cannot spread guesses across several approvers
  select count(*) into recent from public.security_events
   where actor_id = auth.uid() and kind = 'pin_failed' and occurred_at > now() - interval '15 minutes';
  if recent >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'throttled');
  end if;
  select * into mp from public.manager_pins where user_id = p_approver for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_pin'); end if;
  if mp.locked_until is not null and mp.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'until', mp.locked_until);
  end if;
  if mp.pin_hash = crypt(p_pin, mp.pin_hash) then
    update public.manager_pins set failed_count = 0, locked_until = null where user_id = p_approver;
    exp := now() + interval '5 minutes';
    insert into public.override_tokens(approver_id, requested_by, reason, expires_at)
    values (p_approver, auth.uid(), trim(p_reason), exp) returning id into tok;
    perform public.log_security_event('override_issued', p_approver, jsonb_build_object('reason', trim(p_reason)));
    return jsonb_build_object('ok', true, 'token', tok, 'expires_at', exp);
  end if;
  if mp.failed_count + 1 >= 5 then
    update public.manager_pins set failed_count = 0, locked_until = now() + interval '15 minutes' where user_id = p_approver;
    perform public.log_security_event('pin_locked', p_approver, null);
    return jsonb_build_object('ok', false, 'reason', 'locked', 'until', now() + interval '15 minutes');
  end if;
  update public.manager_pins set failed_count = failed_count + 1 where user_id = p_approver;
  perform public.log_security_event('pin_failed', p_approver, null);
  return jsonb_build_object('ok', false, 'reason', 'wrong', 'remaining', 5 - (mp.failed_count + 1));
end $$;

-- A flow that needs an override spends the token once. Returns the approver id.
create or replace function public.consume_override(p_token uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare t public.override_tokens;
begin
  select * into t from public.override_tokens where id = p_token for update;
  if not found or t.requested_by <> auth.uid() or t.used_at is not null or t.expires_at <= now() then
    raise exception 'override invalid';
  end if;
  update public.override_tokens set used_at = now() where id = p_token;
  return t.approver_id;
end $$;

-- ---------- staff security view for the owner ----------
alter table public.profiles add column if not exists force_logout_at timestamptz;

create or replace function public.list_staff_security()
returns table(id uuid, full_name text, email text, roles text[], is_active boolean,
              has_pin boolean, pin_locked_until timestamptz, force_logout_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select p.id, p.full_name, u.email::text,
         coalesce((select array_agg(distinct ur.role::text) from public.user_roles ur where ur.user_id = p.id), '{}'),
         p.is_active, (mp.user_id is not null), mp.locked_until, p.force_logout_at
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.manager_pins mp on mp.user_id = p.id
   where public.has_role('owner')
   order by p.full_name;
$$;

create or replace function public.unlock_pin(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('owner') then raise exception 'not allowed'; end if;
  update public.manager_pins set failed_count = 0, locked_until = null where user_id = p_user;
  perform public.log_security_event('pin_unlocked', p_user, null);
end $$;

-- Ends a user's sessions (owner only). Also stamps profiles.force_logout_at so the app signs them out.
create or replace function public.force_logout_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('owner') then raise exception 'not allowed'; end if;
  if p_user = auth.uid() then raise exception 'cannot target yourself'; end if;
  update public.profiles set force_logout_at = now() where id = p_user;
  begin
    delete from auth.sessions where user_id = p_user;
  exception when others then
    null;   -- if the auth schema is not writable here, the iat check below still logs them out
  end;
  perform public.log_security_event('force_logout', p_user, null);
end $$;

-- The app calls this on focus and every minute; false = sign the user out now.
create or replace function public.is_current_session_valid()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.is_active and (p.force_logout_at is null
              or p.force_logout_at <= to_timestamp(coalesce((auth.jwt() ->> 'iat')::bigint, 0)))
       from public.profiles p where p.id = auth.uid()),
    false);
$$;

-- ---------- grants ----------
revoke all on function public.set_my_pin(text) from public, anon;
revoke all on function public.list_approvers() from public, anon;
revoke all on function public.request_override(uuid, text, text) from public, anon;
revoke all on function public.consume_override(uuid) from public, anon;
revoke all on function public.list_staff_security() from public, anon;
revoke all on function public.unlock_pin(uuid) from public, anon;
revoke all on function public.force_logout_user(uuid) from public, anon;
revoke all on function public.is_current_session_valid() from public, anon;
grant execute on function public.set_my_pin(text) to authenticated;
grant execute on function public.list_approvers() to authenticated;
grant execute on function public.request_override(uuid, text, text) to authenticated;
grant execute on function public.consume_override(uuid) to authenticated;
grant execute on function public.list_staff_security() to authenticated;
grant execute on function public.unlock_pin(uuid) to authenticated;
grant execute on function public.force_logout_user(uuid) to authenticated;
grant execute on function public.is_current_session_valid() to authenticated;
