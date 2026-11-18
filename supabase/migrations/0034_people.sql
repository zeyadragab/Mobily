-- 0034: Phase 10 of docs/VOLT-GAP-PLAN.md — people.
--   * Employee accounts (R33): monthly accrual on the pay day, pay / advance from a drawer or an account,
--     bonus, deduction, correction. Balance > 0 = the shop owes the employee. Not an expense.
--   * Attendance: one record per employee per day, minutes late / early leave / overtime in Cairo time.
--   * Mobile import tax reminders (follow-up list only, no money effect).
--   * Per-user page permissions: has_page(page) = the user's override if present, otherwise allowed.
--   * Idle lock settings (the lock itself is UI; session validity stays in is_current_session_valid()).
-- Money = numeric(14,2). RLS on every table. Writes go through functions only. Needs 0031.

insert into public.app_settings(key, value) values ('idle_lock_minutes', 10), ('idle_logout_minutes', 60)
  on conflict (key) do nothing;

-- ---------- page permissions ----------
-- Page keys are the admin route paths (apps/admin/src/lib/roles.ts NAV), for example '/employee-accounts'.
create table public.user_page_permissions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  page text not null check (page ~ '^/[a-z0-9][a-z0-9-]{0,39}$'),
  allowed boolean not null,
  updated_by uuid default auth.uid() references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (user_id, page)
);
alter table public.user_page_permissions enable row level security;
create policy user_page_permissions_read on public.user_page_permissions for select to authenticated
  using (user_id = auth.uid() or public.has_role('owner'));
create trigger audit_user_page_permissions after insert or update or delete on public.user_page_permissions
  for each row execute function public.audit_row();

-- The owner is never restricted (so the owner cannot lock himself out). No override row = allowed.
create or replace function public.has_page(p_page text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then true
    when public.has_role('owner') then true
    else coalesce((select p.allowed from public.user_page_permissions p
                    where p.user_id = auth.uid() and p.page = p_page), true)
  end $$;

create or replace function public.my_page_permissions()
returns table(page text, allowed boolean)
language sql stable security definer set search_path = public as $$
  select p.page, p.allowed from public.user_page_permissions p where p.user_id = auth.uid() $$;

-- Owner only. p_allowed null removes the override (back to the role default).
create or replace function public.set_page_permission(p_user uuid, p_page text, p_allowed boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('owner') then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('page_permission', 120, 60);
  if p_page is null or p_page !~ '^/[a-z0-9][a-z0-9-]{0,39}$' then raise exception 'invalid page'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_user) then raise exception 'user not found'; end if;
  if exists (select 1 from public.user_roles ur where ur.user_id = p_user and ur.role = 'owner') then
    raise exception 'cannot restrict owner';
  end if;
  if p_allowed is null then
    delete from public.user_page_permissions p where p.user_id = p_user and p.page = p_page;
  else
    insert into public.user_page_permissions(user_id, page, allowed) values (p_user, p_page, p_allowed)
    on conflict (user_id, page) do update set allowed = excluded.allowed, updated_by = auth.uid(), updated_at = now();
  end if;
  perform public.log_security_event('page_permission', p_user, jsonb_build_object('page', p_page, 'allowed', p_allowed));
end $$;

-- Staff list for the team screen (owner / manager). The email is shown to the owner only.
create or replace function public.list_team()
returns table(id uuid, full_name text, email text, job_title text, is_active boolean, roles text[])
language sql stable security definer set search_path = public, auth as $$
  select p.id, p.full_name, case when public.has_role('owner') then u.email::text end, p.job_title, p.is_active,
         coalesce((select array_agg(distinct ur.role::text) from public.user_roles ur where ur.user_id = p.id), '{}')
    from public.profiles p
    join auth.users u on u.id = p.id
   where public.has_any_role(array['owner','manager']::public.app_role[]) and public.has_page('/team')
   order by p.full_name $$;

-- Pages that have a table of their own: the override also hides the rows (read side).
create policy audit_log_page on public.audit_log as restrictive for select to authenticated
  using (public.has_page('/audit'));
create policy security_events_page on public.security_events as restrictive for select to authenticated
  using (public.has_page('/security'));

-- ---------- employee accounts ----------
create table public.employee_accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete set null,
  name text not null check (length(trim(name)) between 2 and 80),
  phone text check (phone is null or phone ~ '^\+?[0-9]{7,15}$'),
  job_title text check (job_title is null or length(job_title) <= 80),
  monthly_salary numeric(14,2) not null check (monthly_salary >= 0),
  pay_day int not null default 1 check (pay_day between 1 and 28),
  start_date date not null,
  is_active boolean not null default true,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.employee_accounts enable row level security;
create policy employee_accounts_read on public.employee_accounts for select to authenticated
  using ((public.has_any_role(array['owner','manager','accountant']::public.app_role[]) and public.has_page('/employee-accounts'))
         or profile_id = auth.uid());
create trigger audit_employee_accounts after insert or update or delete on public.employee_accounts
  for each row execute function public.audit_row();

-- amount: + = the shop owes the employee more, - = less.
create table public.employee_ledger (
  id bigint generated always as identity primary key,
  employee_id uuid not null references public.employee_accounts(id),
  amount numeric(14,2) not null check (amount <> 0),
  kind text not null check (kind in ('accrual','pay','advance','bonus','deduction','correction')),
  period text check (period is null or period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  note text,
  drawer_code text,
  account_id uuid references public.money_accounts(id),
  session_id uuid references public.cash_sessions(id),
  reverses bigint unique references public.employee_ledger(id),
  idem uuid unique,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  check ((kind = 'accrual') = (period is not null))
);
create unique index employee_ledger_one_accrual on public.employee_ledger (employee_id, period) where kind = 'accrual';
create index on public.employee_ledger (employee_id, id desc);
alter table public.employee_ledger enable row level security;
create policy employee_ledger_read on public.employee_ledger for select to authenticated
  using ((public.has_any_role(array['owner','manager','accountant']::public.app_role[]) and public.has_page('/employee-accounts'))
         or exists (select 1 from public.employee_accounts e where e.id = employee_id and e.profile_id = auth.uid()));
create trigger audit_employee_ledger after insert on public.employee_ledger
  for each row execute function public.audit_row();
create trigger employee_ledger_append_only before update or delete on public.employee_ledger
  for each row execute function public.audit_block_mutation();

create or replace view public.employee_balances with (security_invoker = true) as
  select e.id, e.profile_id, e.name, e.phone, e.job_title, e.monthly_salary, e.pay_day, e.start_date, e.is_active, e.created_at,
         coalesce(l.balance, 0)::numeric(14,2) as balance, l.last_period, l.last_entry_at
    from public.employee_accounts e
    left join (select x.employee_id, sum(x.amount) as balance, max(x.period) as last_period, max(x.created_at) as last_entry_at
                 from public.employee_ledger x group by x.employee_id) l on l.employee_id = e.id;
revoke all on public.employee_balances from anon;
grant select on public.employee_balances to authenticated;

-- One accrual per employee per month whose pay day has come (Cairo date), from the start date up to today.
-- The unique index makes a second run add nothing. Returns the number of accruals added.
create or replace function public.m_employee_accrue(p_employee uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Africa/Cairo')::date; v_n int := 0; v_c int; v_e record; v_m date; v_due date;
begin
  for v_e in select e.id, e.monthly_salary, e.pay_day, e.start_date from public.employee_accounts e
              where e.is_active and e.monthly_salary > 0 and (p_employee is null or e.id = p_employee) loop
    v_m := date_trunc('month', v_e.start_date)::date;
    while v_m <= v_today loop
      v_due := v_m + (v_e.pay_day - 1);
      if v_due >= v_e.start_date and v_due <= v_today then
        insert into public.employee_ledger(employee_id, amount, kind, period, note)
        values (v_e.id, v_e.monthly_salary, 'accrual', to_char(v_due, 'YYYY-MM'), 'استحقاق راتب ' || to_char(v_due, 'YYYY-MM'))
        on conflict (employee_id, period) where kind = 'accrual' do nothing;
        get diagnostics v_c = row_count;
        v_n := v_n + v_c;
      end if;
      v_m := (v_m + interval '1 month')::date;
    end loop;
  end loop;
  return v_n;
end $$;

create or replace function public.run_salary_accruals() returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_any_role(array['owner','manager','accountant']::public.app_role[]) or not public.has_page('/employee-accounts') then
    raise exception 'not allowed';
  end if;
  perform public.enforce_rate_limit('employee_op', 30, 60);
  return public.m_employee_accrue(null);
end $$;

-- Add or edit an employee account. A new account gets its due accruals at once (T33).
create or replace function public.save_employee_account(
  p_id uuid, p_name text, p_phone text, p_job_title text, p_monthly_salary numeric, p_pay_day int, p_start_date date,
  p_profile uuid default null, p_active boolean default true)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ph text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g'), '');
        v_today date := (now() at time zone 'Africa/Cairo')::date;
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) or not public.has_page('/employee-accounts') then
    raise exception 'not allowed';
  end if;
  perform public.enforce_rate_limit('employee_save', 30, 60);
  if p_name is null or length(trim(p_name)) not between 2 and 80 then raise exception 'invalid employee name'; end if;
  if p_monthly_salary is null or p_monthly_salary < 0 then raise exception 'invalid salary'; end if;
  if coalesce(p_pay_day, 0) not between 1 and 28 then raise exception 'invalid pay day'; end if;
  if p_start_date is null or p_start_date > v_today + 366 or p_start_date < v_today - 3660 then raise exception 'invalid start date'; end if;
  if v_ph is not null and v_ph !~ '^\+?[0-9]{7,15}$' then raise exception 'invalid phone'; end if;
  if p_profile is not null and exists (select 1 from public.employee_accounts e where e.profile_id = p_profile and e.id is distinct from p_id) then
    raise exception 'profile already linked';
  end if;
  if p_profile is not null and not exists (select 1 from public.profiles p where p.id = p_profile) then raise exception 'user not found'; end if;
  if p_id is null then
    insert into public.employee_accounts(profile_id, name, phone, job_title, monthly_salary, pay_day, start_date, is_active)
    values (p_profile, trim(p_name), v_ph, nullif(trim(coalesce(p_job_title, '')), ''), round(p_monthly_salary, 2), p_pay_day, p_start_date, coalesce(p_active, true))
    returning id into v_id;
  else
    update public.employee_accounts e
       set profile_id = p_profile, name = trim(p_name), phone = v_ph, job_title = nullif(trim(coalesce(p_job_title, '')), ''),
           monthly_salary = round(p_monthly_salary, 2), pay_day = p_pay_day, start_date = p_start_date,
           is_active = coalesce(p_active, e.is_active), updated_at = now()
     where e.id = p_id returning e.id into v_id;
    if v_id is null then raise exception 'employee not found'; end if;
  end if;
  perform public.m_employee_accrue(v_id);
  return v_id;
end $$;

-- pay / advance : cash leaves the chosen drawer (p_drawer = drawer code) or account, the balance goes down.
--                 pay cannot pass the balance; an advance may take the balance down to minus one month salary.
-- bonus adds, deduction subtracts, correction is signed and needs a reason.
-- A manager needs a PIN token at or above drawer_transfer_pin_threshold; the owner does not.
create or replace function public.employee_operation(
  p_employee uuid, p_kind text, p_amount numeric, p_drawer text, p_account uuid, p_note text, p_idem uuid,
  p_override uuid default null)
returns public.employee_ledger
language plpgsql security definer set search_path = public as $$
declare v_row public.employee_ledger; v_e public.employee_accounts; v_amt numeric(14,2) := round(p_amount, 2);
        v_signed numeric(14,2); v_bal numeric(14,2); v_thr numeric; v_s uuid;
        v_note text := nullif(left(trim(coalesce(p_note, '')), 200), ''); v_money boolean := p_kind in ('pay','advance');
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) or not public.has_page('/employee-accounts') then
    raise exception 'not allowed';
  end if;
  if p_idem is null then raise exception 'idempotency key required'; end if;
  select * into v_row from public.employee_ledger l where l.idem = p_idem;
  if found then return v_row; end if;
  perform public.enforce_rate_limit('employee_op', 30, 60);
  if p_kind is null or p_kind not in ('pay','advance','bonus','deduction','correction') then raise exception 'invalid operation'; end if;
  if v_amt is null or v_amt = 0 or (p_kind <> 'correction' and v_amt < 0) then raise exception 'invalid amount'; end if;
  if p_kind = 'correction' and v_note is null then raise exception 'reason required'; end if;
  select * into v_e from public.employee_accounts e where e.id = p_employee for update;
  if not found then raise exception 'employee not found'; end if;
  select coalesce(sum(l.amount), 0) into v_bal from public.employee_ledger l where l.employee_id = v_e.id;
  if p_kind = 'pay' and v_amt > v_bal then raise exception 'payment exceeds employee balance'; end if;
  if p_kind = 'advance' and v_bal - v_amt < -v_e.monthly_salary then raise exception 'advance exceeds limit'; end if;
  if v_money then
    if (p_drawer is null) = (p_account is null) then raise exception 'invalid source'; end if;
    v_s := public.m_session();
  else
    select s.id into v_s from public.cash_sessions s where s.branch_id = public.m_branch() and s.status = 'open';
  end if;
  v_thr := coalesce((select value from public.app_settings where key = 'drawer_transfer_pin_threshold'), 5000);
  if abs(v_amt) >= v_thr and not public.has_role('owner') then
    if p_override is null then raise exception 'override required'; end if;
    perform public.consume_override(p_override);
  end if;
  v_signed := case when p_kind in ('pay','advance','deduction') then -v_amt else v_amt end;
  insert into public.employee_ledger(employee_id, amount, kind, note, drawer_code, account_id, session_id, idem)
  values (v_e.id, v_signed, p_kind, v_note, case when v_money then p_drawer end, case when v_money then p_account end, v_s, p_idem)
  returning * into v_row;
  if v_money and p_drawer is not null then
    perform public.m_drawer_move(p_drawer, -v_amt, 'employee', 'employee_ledger', v_row.id::text,
                                 case when p_kind = 'pay' then 'راتب ' else 'سلفة ' end || v_e.name);
  elsif v_money then
    perform public.m_account_move(p_account, -v_amt, 'employee', 'employee_ledger', v_row.id::text,
                                  case when p_kind = 'pay' then 'راتب ' else 'سلفة ' end || v_e.name);
  end if;
  return v_row;
end $$;

-- Owner only: a compensating row; a pay / advance also puts the money back where it came from (current shift).
create or replace function public.reverse_employee_entry(p_id bigint, p_reason text)
returns public.employee_ledger
language plpgsql security definer set search_path = public as $$
declare v_o public.employee_ledger; v_row public.employee_ledger; v_s uuid; v_reason text := left(trim(coalesce(p_reason, '')), 200);
begin
  if not public.has_role('owner') then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('employee_op', 30, 60);
  if v_reason = '' then raise exception 'reason required'; end if;
  select * into v_o from public.employee_ledger l where l.id = p_id;
  if not found then raise exception 'entry not found'; end if;
  perform 1 from public.employee_accounts e where e.id = v_o.employee_id for update;
  if v_o.reverses is not null then raise exception 'entry cannot be reversed'; end if;
  if exists (select 1 from public.employee_ledger x where x.reverses = v_o.id) then raise exception 'entry already reversed'; end if;
  if v_o.kind in ('pay','advance') then
    v_s := public.m_session();
    perform public.m_reverse_ref('employee_ledger', v_o.id::text, v_reason);
  else
    select s.id into v_s from public.cash_sessions s where s.branch_id = public.m_branch() and s.status = 'open';
  end if;
  insert into public.employee_ledger(employee_id, amount, kind, note, session_id, reverses)
  values (v_o.employee_id, -v_o.amount, 'correction', v_reason, v_s, v_o.id)
  returning * into v_row;
  return v_row;
end $$;

-- ---------- attendance ----------
create table public.attendance_records (
  id bigint generated always as identity primary key,
  employee_id uuid not null references public.employee_accounts(id),
  work_date date not null,
  check_in timestamptz,
  check_out timestamptz,
  shift_start time not null default '10:00',
  shift_end time not null default '22:00',
  late_minutes int not null default 0 check (late_minutes >= 0),
  early_leave_minutes int not null default 0 check (early_leave_minutes >= 0),
  overtime_minutes int not null default 0 check (overtime_minutes >= 0),
  note text check (note is null or length(note) <= 200),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, work_date),
  check (check_out is null or (check_in is not null and check_out >= check_in))
);
create index on public.attendance_records (work_date desc);
alter table public.attendance_records enable row level security;
create policy attendance_records_read on public.attendance_records for select to authenticated
  using ((public.has_any_role(array['owner','manager','accountant']::public.app_role[]) and public.has_page('/attendance'))
         or exists (select 1 from public.employee_accounts e where e.id = employee_id and e.profile_id = auth.uid()));
create trigger audit_attendance_records after insert or update or delete on public.attendance_records
  for each row execute function public.audit_row();

-- Minutes against the planned shift, in Cairo time. A shift that ends at or before its start ends the next day.
create or replace function public.attendance_minutes() returns trigger
language plpgsql set search_path = public as $$
declare v_start timestamptz := (new.work_date + new.shift_start) at time zone 'Africa/Cairo';
        v_end timestamptz := (new.work_date + new.shift_end) at time zone 'Africa/Cairo';
begin
  if new.shift_end <= new.shift_start then v_end := ((new.work_date + 1) + new.shift_end) at time zone 'Africa/Cairo'; end if;
  new.late_minutes := case when new.check_in is null then 0
                           else greatest(0, floor(extract(epoch from (new.check_in - v_start)) / 60))::int end;
  new.early_leave_minutes := case when new.check_out is null then 0
                                  else greatest(0, floor(extract(epoch from (v_end - new.check_out)) / 60))::int end;
  new.overtime_minutes := case when new.check_out is null then 0
                               else greatest(0, floor(extract(epoch from (new.check_out - v_end)) / 60))::int end;
  new.updated_at := now();
  return new;
end $$;
create trigger attendance_minutes before insert or update on public.attendance_records
  for each row execute function public.attendance_minutes();

-- Names for the attendance screen without the salary columns. A linked employee sees himself.
create or replace function public.attendance_employees()
returns table(id uuid, name text, job_title text, is_active boolean, is_me boolean)
language sql stable security definer set search_path = public as $$
  select e.id, e.name, e.job_title, e.is_active, coalesce(e.profile_id = auth.uid(), false)
    from public.employee_accounts e
   where (public.has_any_role(array['owner','manager','accountant']::public.app_role[]) and public.has_page('/attendance'))
      or e.profile_id = auth.uid()
   order by e.name $$;

-- Check in / out. Owner or manager for anyone (p_at lets them fix a forgotten press); an employee only for himself, now.
create or replace function public.attendance_check(p_employee uuid, p_action text, p_at timestamptz default now())
returns public.attendance_records
language plpgsql security definer set search_path = public as $$
declare v_e public.employee_accounts; v_r public.attendance_records; v_at timestamptz := coalesce(p_at, now());
        v_boss boolean := public.has_any_role(array['owner','manager']::public.app_role[]); v_day date;
begin
  if not public.has_page('/attendance') then raise exception 'not allowed'; end if;
  select * into v_e from public.employee_accounts e where e.id = p_employee for update;
  if not found or not v_e.is_active then raise exception 'employee not found'; end if;
  if not v_boss then
    if v_e.profile_id is distinct from auth.uid() then raise exception 'not allowed'; end if;
    v_at := now();
  end if;
  perform public.enforce_rate_limit('attendance', 60, 60);
  if p_action is null or p_action not in ('in','out') then raise exception 'invalid operation'; end if;
  if v_at > now() + interval '5 minutes' or v_at < now() - interval '40 days' then raise exception 'invalid time'; end if;
  v_day := (v_at at time zone 'Africa/Cairo')::date;
  if p_action = 'in' then
    select * into v_r from public.attendance_records a where a.employee_id = v_e.id and a.work_date = v_day for update;
    if found and v_r.check_in is not null then raise exception 'already checked in'; end if;
    if found then
      update public.attendance_records a set check_in = v_at where a.id = v_r.id returning * into v_r;
    else
      insert into public.attendance_records(employee_id, work_date, check_in) values (v_e.id, v_day, v_at) returning * into v_r;
    end if;
  else
    -- the open record of that day, or of the day before (a shift that passes midnight)
    select * into v_r from public.attendance_records a
     where a.employee_id = v_e.id and a.work_date in (v_day, v_day - 1) and a.check_in is not null and a.check_out is null
     order by a.work_date desc limit 1 for update;
    if not found then
      if exists (select 1 from public.attendance_records a where a.employee_id = v_e.id and a.work_date = v_day and a.check_out is not null) then
        raise exception 'already checked out';
      end if;
      raise exception 'not checked in';
    end if;
    if v_at < v_r.check_in then raise exception 'invalid time'; end if;
    update public.attendance_records a set check_out = v_at where a.id = v_r.id returning * into v_r;
  end if;
  return v_r;
end $$;

-- Manual edit of one day (owner / manager, with a note). Both times empty = a noted day off.
create or replace function public.save_attendance(
  p_employee uuid, p_date date, p_in timestamptz, p_out timestamptz, p_shift_start time, p_shift_end time, p_note text)
returns public.attendance_records
language plpgsql security definer set search_path = public as $$
declare v_r public.attendance_records; v_note text := left(trim(coalesce(p_note, '')), 200);
        v_today date := (now() at time zone 'Africa/Cairo')::date;
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) or not public.has_page('/attendance') then
    raise exception 'not allowed';
  end if;
  perform public.enforce_rate_limit('attendance', 60, 60);
  if v_note = '' then raise exception 'reason required'; end if;
  if not exists (select 1 from public.employee_accounts e where e.id = p_employee) then raise exception 'employee not found'; end if;
  if p_date is null or p_date > v_today or p_date < v_today - 400 then raise exception 'invalid date'; end if;
  if (p_out is not null and (p_in is null or p_out < p_in)) or p_out > now() + interval '5 minutes'
     or (p_in is not null and (p_in at time zone 'Africa/Cairo')::date <> p_date)
     or (p_out is not null and p_out > p_in + interval '36 hours') then
    raise exception 'invalid time';
  end if;
  insert into public.attendance_records(employee_id, work_date, check_in, check_out, shift_start, shift_end, note)
  values (p_employee, p_date, p_in, p_out, coalesce(p_shift_start, '10:00'), coalesce(p_shift_end, '22:00'), v_note)
  on conflict (employee_id, work_date) do update
    set check_in = excluded.check_in, check_out = excluded.check_out,
        shift_start = coalesce(p_shift_start, public.attendance_records.shift_start),
        shift_end = coalesce(p_shift_end, public.attendance_records.shift_end), note = excluded.note
  returning * into v_r;
  return v_r;
end $$;

create or replace view public.attendance_monthly with (security_invoker = true) as
  select a.employee_id, to_char(a.work_date, 'YYYY-MM') as month,
         count(a.check_in)::int as days_present,
         coalesce(sum(floor(extract(epoch from (a.check_out - a.check_in)) / 60)), 0)::int as worked_minutes,
         sum(a.late_minutes)::int as late_minutes,
         sum(a.early_leave_minutes)::int as early_leave_minutes,
         sum(a.overtime_minutes)::int as overtime_minutes,
         count(*) filter (where a.late_minutes > 0)::int as late_days,
         count(*) filter (where a.check_in is not null and a.check_out is null)::int as open_days
    from public.attendance_records a group by a.employee_id, to_char(a.work_date, 'YYYY-MM');
revoke all on public.attendance_monthly from anon;
grant select on public.attendance_monthly to authenticated;

-- ---------- mobile import tax reminders (no money effect) ----------
create table public.tax_reminders (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null check (length(trim(customer_name)) between 2 and 80),
  phone text check (phone is null or phone ~ '^\+?[0-9]{7,15}$'),
  device text check (device is null or length(device) <= 120),
  imei text check (imei is null or imei ~ '^[0-9]{15}$'),
  amount numeric(14,2) not null default 0 check (amount >= 0),
  due_date date not null,
  status text not null default 'open' check (status in ('open','paid','cancelled')),
  note text check (note is null or length(note) <= 300),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status_by uuid references public.profiles(id),
  status_at timestamptz
);
create index on public.tax_reminders (status, due_date);
alter table public.tax_reminders enable row level security;
create policy tax_reminders_read on public.tax_reminders for select to authenticated
  using (public.has_any_role(array['owner','manager','cashier','accountant']::public.app_role[]) and public.has_page('/mobile-tax'));
create trigger audit_tax_reminders after insert or update or delete on public.tax_reminders
  for each row execute function public.audit_row();

create or replace function public.save_tax_reminder(
  p_id uuid, p_customer_name text, p_phone text, p_device text, p_imei text, p_amount numeric, p_due_date date, p_note text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ph text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g'), '');
        v_imei text := nullif(regexp_replace(coalesce(p_imei, ''), '[\s-]', '', 'g'), '');
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) or not public.has_page('/mobile-tax') then
    raise exception 'not allowed';
  end if;
  perform public.enforce_rate_limit('tax_reminder', 60, 60);
  if p_customer_name is null or length(trim(p_customer_name)) not between 2 and 80 then raise exception 'invalid customer name'; end if;
  if v_ph is not null and v_ph !~ '^\+?[0-9]{7,15}$' then raise exception 'invalid phone'; end if;
  if v_imei is not null and (v_imei !~ '^[0-9]{15}$' or not public.luhn_valid(v_imei)) then raise exception 'invalid imei'; end if;
  if p_amount is not null and p_amount < 0 then raise exception 'invalid amount'; end if;
  if p_due_date is null then raise exception 'invalid date'; end if;
  if p_id is null then
    insert into public.tax_reminders(customer_name, phone, device, imei, amount, due_date, note)
    values (trim(p_customer_name), v_ph, nullif(left(trim(coalesce(p_device, '')), 120), ''), v_imei, round(coalesce(p_amount, 0), 2), p_due_date,
            nullif(left(trim(coalesce(p_note, '')), 300), ''))
    returning id into v_id;
  else
    update public.tax_reminders t
       set customer_name = trim(p_customer_name), phone = v_ph, device = nullif(left(trim(coalesce(p_device, '')), 120), ''), imei = v_imei,
           amount = round(coalesce(p_amount, 0), 2), due_date = p_due_date, note = nullif(left(trim(coalesce(p_note, '')), 300), ''),
           updated_at = now()
     where t.id = p_id and t.status = 'open' returning t.id into v_id;
    if v_id is null then raise exception 'reminder not open'; end if;
  end if;
  return v_id;
end $$;

-- 'paid' (from open), 'open' = reopen (from paid or cancelled), 'cancelled' = soft delete (owner / manager or the creator).
create or replace function public.set_tax_reminder_status(p_id uuid, p_status text)
returns public.tax_reminders
language plpgsql security definer set search_path = public as $$
declare v_t public.tax_reminders;
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) or not public.has_page('/mobile-tax') then
    raise exception 'not allowed';
  end if;
  perform public.enforce_rate_limit('tax_reminder', 60, 60);
  if p_status is null or p_status not in ('open','paid','cancelled') then raise exception 'invalid status'; end if;
  select * into v_t from public.tax_reminders t where t.id = p_id for update;
  if not found then raise exception 'reminder not found'; end if;
  if v_t.status = p_status then return v_t; end if;
  if p_status = 'paid' and v_t.status <> 'open' then raise exception 'reminder not open'; end if;
  if p_status = 'cancelled' and not public.has_any_role(array['owner','manager']::public.app_role[]) and v_t.created_by <> auth.uid() then
    raise exception 'not allowed';
  end if;
  update public.tax_reminders t set status = p_status, status_by = auth.uid(), status_at = now(), updated_at = now()
   where t.id = p_id returning * into v_t;
  return v_t;
end $$;

-- ---------- grants ----------
revoke all on function public.m_employee_accrue(uuid) from public, anon, authenticated;
revoke all on function public.attendance_minutes() from public, anon, authenticated;
revoke all on function public.has_page(text) from public, anon;
revoke all on function public.my_page_permissions() from public, anon;
revoke all on function public.set_page_permission(uuid, text, boolean) from public, anon;
revoke all on function public.list_team() from public, anon;
revoke all on function public.run_salary_accruals() from public, anon;
revoke all on function public.save_employee_account(uuid, text, text, text, numeric, int, date, uuid, boolean) from public, anon;
revoke all on function public.employee_operation(uuid, text, numeric, text, uuid, text, uuid, uuid) from public, anon;
revoke all on function public.reverse_employee_entry(bigint, text) from public, anon;
revoke all on function public.attendance_employees() from public, anon;
revoke all on function public.attendance_check(uuid, text, timestamptz) from public, anon;
revoke all on function public.save_attendance(uuid, date, timestamptz, timestamptz, time, time, text) from public, anon;
revoke all on function public.save_tax_reminder(uuid, text, text, text, text, numeric, date, text) from public, anon;
revoke all on function public.set_tax_reminder_status(uuid, text) from public, anon;
grant execute on function public.has_page(text) to authenticated;
grant execute on function public.my_page_permissions() to authenticated;
grant execute on function public.set_page_permission(uuid, text, boolean) to authenticated;
grant execute on function public.list_team() to authenticated;
grant execute on function public.run_salary_accruals() to authenticated;
grant execute on function public.save_employee_account(uuid, text, text, text, numeric, int, date, uuid, boolean) to authenticated;
grant execute on function public.employee_operation(uuid, text, numeric, text, uuid, text, uuid, uuid) to authenticated;
grant execute on function public.reverse_employee_entry(bigint, text) to authenticated;
grant execute on function public.attendance_employees() to authenticated;
grant execute on function public.attendance_check(uuid, text, timestamptz) to authenticated;
grant execute on function public.save_attendance(uuid, date, timestamptz, timestamptz, time, time, text) to authenticated;
grant execute on function public.save_tax_reminder(uuid, text, text, text, text, numeric, date, text) to authenticated;
grant execute on function public.set_tax_reminder_status(uuid, text) to authenticated;
