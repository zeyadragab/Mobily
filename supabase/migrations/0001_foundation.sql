-- 0001 Foundation: branches, profiles, roles, audit log, approvals engine.
-- Conventions: money = numeric(14,2); timestamps = timestamptz (UTC), shown in Africa/Cairo.
-- RLS is enabled on every table. Roles are enforced here, not in the UI.

create type public.app_role as enum
  ('owner','manager','cashier','warehouse','accountant','web_admin');

create type public.approval_status as enum
  ('draft','submitted','approved','rejected','changes_requested','executed','expired','superseded');

-- ---------- branches ----------
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  job_title text,
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  branch_id uuid references public.branches(id), -- null = all branches
  created_at timestamptz not null default now(),
  unique (user_id, role, branch_id)
);
create index on public.user_roles (user_id);

-- ---------- role helpers (security definer: bypass RLS safely) ----------
create or replace function public.has_role(r public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid() and ur.role = r and p.is_active
  );
$$;

create or replace function public.has_any_role(rs public.app_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid() and ur.role = any(rs) and p.is_active
  );
$$;

-- Branch scope: true if the user has the role globally or for that branch.
create or replace function public.has_role_in_branch(r public.app_role, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid() and ur.role = r and p.is_active
      and (ur.branch_id is null or ur.branch_id = b)
  );
$$;

revoke all on function public.has_role(public.app_role) from public, anon;
revoke all on function public.has_any_role(public.app_role[]) from public, anon;
revoke all on function public.has_role_in_branch(public.app_role, uuid) from public, anon;
grant execute on function public.has_role(public.app_role) to authenticated;
grant execute on function public.has_any_role(public.app_role[]) to authenticated;
grant execute on function public.has_role_in_branch(public.app_role, uuid) to authenticated;

-- ---------- audit log (append-only) ----------
create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  source text not null default 'app',
  entity text not null,
  entity_id text,
  action text not null,
  before jsonb,
  after jsonb,
  reason text,
  approval_id uuid,
  correlation_id uuid
);
create index on public.audit_log (entity, entity_id);
create index on public.audit_log (occurred_at desc);
create index on public.audit_log (actor_id);

create or replace function public.audit_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_block_mutation();

-- Generic row-level audit trigger. Sensitive columns are excluded via TG_ARGV.
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  b jsonb; a jsonb; k text;
begin
  if tg_op in ('UPDATE','DELETE') then b := to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then a := to_jsonb(new); end if;
  if tg_nargs > 0 then
    foreach k in array tg_argv loop
      b := b - k; a := a - k;
    end loop;
  end if;
  insert into public.audit_log(actor_id, entity, entity_id, action, before, after)
  values (auth.uid(), tg_table_name,
          coalesce((a->>'id'), (b->>'id')), lower(tg_op), b, a);
  return coalesce(new, old);
end $$;

create trigger audit_branches after insert or update or delete on public.branches
  for each row execute function public.audit_row();
create trigger audit_user_roles after insert or update or delete on public.user_roles
  for each row execute function public.audit_row();

-- ---------- approvals engine ----------
create table public.approval_policies (
  id uuid primary key default gen_random_uuid(),
  action_type text not null,               -- e.g. 'purchase_order.send'
  approver_role public.app_role not null default 'owner',
  min_amount numeric(14,2) not null default 0 check (min_amount >= 0),
  branch_id uuid references public.branches(id),
  separation_of_duties boolean not null default true,
  expires_after interval,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.approval_policies (action_type) where is_active;

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  action_type text not null,
  subject_entity text not null,
  subject_id uuid not null,
  version int not null default 1,          -- material change => new version
  requested_by uuid not null references public.profiles(id),
  amount numeric(14,2),
  reason text,
  payload_hash text,                       -- detects material change after approval
  status public.approval_status not null default 'submitted',
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_comment text,
  expires_at timestamptz,
  executed_at timestamptz,
  idempotency_key text not null unique,
  branch_id uuid references public.branches(id),
  created_at timestamptz not null default now(),
  unique (subject_entity, subject_id, version)
);
create index on public.approval_requests (status, created_at desc);
create index on public.approval_requests (requested_by);

create trigger audit_approvals after insert or update on public.approval_requests
  for each row execute function public.audit_row();

-- Decide a request. Server enforces role, status and separation of duties.
create or replace function public.decide_approval(
  p_request uuid, p_decision text, p_comment text default null)
returns public.approval_requests
language plpgsql security definer set search_path = public as $$
declare
  req public.approval_requests;
  pol public.approval_policies;
  new_status public.approval_status;
begin
  if p_decision not in ('approved','rejected','changes_requested') then
    raise exception 'invalid decision';
  end if;
  new_status := p_decision::public.approval_status;

  select * into req from public.approval_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if req.status <> 'submitted' then raise exception 'request is not pending'; end if;
  if req.expires_at is not null and req.expires_at < now() then
    update public.approval_requests set status = 'expired' where id = req.id;
    raise exception 'request expired';
  end if;

  select * into pol from public.approval_policies
   where action_type = req.action_type and is_active
     and coalesce(req.amount,0) >= min_amount
   order by min_amount desc limit 1;

  if not public.has_role(coalesce(pol.approver_role, 'owner')) then
    raise exception 'not allowed to decide this request';
  end if;
  if coalesce(pol.separation_of_duties, true) and req.requested_by = auth.uid() then
    raise exception 'requester cannot approve own request';
  end if;

  update public.approval_requests
     set status = new_status, decided_by = auth.uid(),
         decided_at = now(), decision_comment = p_comment
   where id = req.id
   returning * into req;
  return req;
end $$;

revoke all on function public.decide_approval(uuid, text, text) from public, anon;
grant execute on function public.decide_approval(uuid, text, text) to authenticated;

-- Execution gate: returns true exactly once for an approved request.
create or replace function public.consume_approval(p_request uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.approval_requests
     set status = 'executed', executed_at = now()
   where id = p_request and status = 'approved'
     and (expires_at is null or expires_at > now());
  get diagnostics n = row_count;
  return n = 1;
end $$;

revoke all on function public.consume_approval(uuid) from public, anon;
grant execute on function public.consume_approval(uuid) to authenticated;

-- ---------- RLS ----------
alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_log enable row level security;
alter table public.approval_policies enable row level security;
alter table public.approval_requests enable row level security;

-- branches: staff read, owner manages
create policy branches_read on public.branches for select to authenticated using (true);
create policy branches_owner_write on public.branches for all to authenticated
  using (public.has_role('owner')) with check (public.has_role('owner'));

-- profiles: self + owner/manager read; self edits own non-privileged fields; owner manages
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_any_role(array['owner','manager']::public.app_role[]));
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and is_active);
create policy profiles_owner_all on public.profiles for all to authenticated
  using (public.has_role('owner')) with check (public.has_role('owner'));

-- user_roles: user sees own; only owner changes
create policy roles_read_own on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_role('owner'));
create policy roles_owner_write on public.user_roles for all to authenticated
  using (public.has_role('owner')) with check (public.has_role('owner'));

-- audit log: owner and accountant read; inserts only via triggers / service role
create policy audit_read on public.audit_log for select to authenticated
  using (public.has_any_role(array['owner','accountant']::public.app_role[]));

-- approval policies: staff read, owner writes
create policy appr_pol_read on public.approval_policies for select to authenticated using (true);
create policy appr_pol_write on public.approval_policies for all to authenticated
  using (public.has_role('owner')) with check (public.has_role('owner'));

-- approval requests: requester and owner/manager read; creating as self; decisions via function only
create policy appr_req_read on public.approval_requests for select to authenticated
  using (requested_by = auth.uid()
         or public.has_any_role(array['owner','manager','accountant']::public.app_role[]));
create policy appr_req_insert on public.approval_requests for insert to authenticated
  with check (requested_by = auth.uid() and status = 'submitted');

-- New auth user => profile row (no role granted automatically)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Seed: default policy — purchase orders need owner approval (plan section 6).
insert into public.approval_policies(action_type, approver_role, min_amount)
values ('purchase_order.send','owner',0);
