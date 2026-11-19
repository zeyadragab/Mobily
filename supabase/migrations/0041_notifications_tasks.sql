-- 0041: Phase 12 of docs/VOLT-GAP-PLAN.md — notifications, tasks, alerts.
--   * notifications: one row per alert. Alerts come from rules run by refresh_notifications() (called by the app when it
--     opens and then every few minutes; no cron needed). A rule is idempotent: one OPEN row per dedupe_key.
--     Condition alerts (low stock, overdue installments, tax due, supplier overdue, task reminder) close by themselves
--     when the condition clears. Event alerts (shift difference) stay until read.
--   * Visibility: audience roles, an optional single user, and an optional page switch (has_page).
--   * Read state is per user (notification_reads). Nobody edits a notification from the app.
--   * tasks: a to-do with priority and a reminder time. A reminder that has come becomes a notification for the
--     assigned user (or the creator).
-- Cairo dates everywhere. RLS on every table. Writes go through functions only. Needs 0034.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('low_stock','shift_difference','installment_overdue','tax_due','supplier_overdue','task_due')),
  severity text not null default 'warn' check (severity in ('info','warn','critical')),
  title text not null check (length(title) between 1 and 160),
  body text check (body is null or length(body) <= 400),
  link text check (link is null or link ~ '^/[a-z0-9-]{0,39}$'),
  audience public.app_role[] not null default '{}',
  user_id uuid references public.profiles(id),
  page text check (page is null or page ~ '^/[a-z0-9][a-z0-9-]{0,39}$'),
  dedupe_key text not null check (length(dedupe_key) between 3 and 120),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (user_id is not null or cardinality(audience) > 0)
);
create unique index notifications_one_open on public.notifications (dedupe_key) where resolved_at is null;
create index on public.notifications (created_at desc);

create table public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;

create or replace function public.can_see_notification(n public.notifications) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and (n.user_id is null or n.user_id = auth.uid())
     and (n.user_id is not null or public.has_any_role(n.audience))
     and (n.page is null or public.has_page(n.page))
$$;

create policy notifications_read on public.notifications for select to authenticated
  using (public.can_see_notification(notifications));
create policy notification_reads_own on public.notification_reads for select to authenticated
  using (user_id = auth.uid());

-- ---------- tasks ----------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 2 and 120),
  details text check (details is null or length(details) <= 600),
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  remind_at timestamptz,
  assigned_to uuid references public.profiles(id),
  status text not null default 'open' check (status in ('open','done','cancelled')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  closed_by uuid references public.profiles(id),
  closed_at timestamptz
);
create index on public.tasks (status, remind_at);
alter table public.tasks enable row level security;
create policy tasks_read on public.tasks for select to authenticated
  using (public.has_any_role(array['owner','manager','cashier','accountant','warehouse']::public.app_role[])
         and (created_by = auth.uid() or assigned_to = auth.uid() or public.has_any_role(array['owner','manager']::public.app_role[])));
create trigger audit_tasks after insert or update or delete on public.tasks
  for each row execute function public.audit_row();

create or replace function public.create_task(p_title text, p_details text, p_priority text, p_remind_at timestamptz, p_assigned_to uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_any_role(array['owner','manager','cashier','accountant','warehouse']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('create_task', 30, 60);
  if length(trim(coalesce(p_title, ''))) < 2 then raise exception 'invalid task'; end if;
  if p_priority not in ('low','normal','high') then raise exception 'invalid task'; end if;
  if p_assigned_to is not null then
    if p_assigned_to <> auth.uid() and not public.has_any_role(array['owner','manager']::public.app_role[]) then
      raise exception 'not allowed';
    end if;
    if not exists (select 1 from public.profiles p where p.id = p_assigned_to and p.is_active) then raise exception 'user not found'; end if;
  end if;
  insert into public.tasks(title, details, priority, remind_at, assigned_to)
  values (trim(p_title), nullif(trim(coalesce(p_details, '')), ''), p_priority, p_remind_at, coalesce(p_assigned_to, auth.uid()))
  returning id into v_id;
  return v_id;
end $$;

-- Done or cancelled by the creator, the assignee, owner or manager. A closed task closes its reminder.
create or replace function public.close_task(p_task uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
declare t public.tasks;
begin
  perform public.enforce_rate_limit('close_task', 60, 60);
  if p_status not in ('done','cancelled') then raise exception 'invalid task'; end if;
  select * into t from public.tasks where id = p_task for update;
  if not found then raise exception 'task not found'; end if;
  if t.created_by <> auth.uid() and t.assigned_to is distinct from auth.uid()
     and not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  if t.status <> 'open' then raise exception 'task already closed'; end if;
  update public.tasks set status = p_status, closed_by = auth.uid(), closed_at = now() where id = p_task;
  update public.notifications set resolved_at = now() where dedupe_key = 'task:' || p_task::text and resolved_at is null;
end $$;

-- ---------- the rules ----------
-- Adds what is missing, closes what no longer holds. Returns the number of open alerts after the run.
create or replace function public.refresh_notifications() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_n int;
begin
  if not public.has_any_role(array['owner','manager','cashier','accountant','warehouse','technician']::public.app_role[]) then
    raise exception 'not allowed';
  end if;
  perform public.enforce_rate_limit('refresh_notifications', 12, 60);

  -- 1. low stock: on hand (all branches) at or below the reorder level, reorder level above 0
  insert into public.notifications(kind, severity, title, body, link, audience, dedupe_key)
  select 'low_stock', case when s.on_hand <= 0 then 'critical' else 'warn' end,
         'مخزون منخفض: ' || p.name,
         'المتاح ' || s.on_hand || ' وحد إعادة الطلب ' || v.reorder_level || ' (' || v.sku || ')',
         '/inventory', array['owner','manager','warehouse']::public.app_role[], 'low_stock:' || v.id::text
    from public.variants v
    join public.products p on p.id = v.product_id
    join lateral (select coalesce(sum(l.on_hand), 0)::int as on_hand from public.stock_levels l where l.variant_id = v.id) s on true
   where v.reorder_level > 0 and s.on_hand <= v.reorder_level
  on conflict (dedupe_key) where resolved_at is null do nothing;
  update public.notifications n set resolved_at = now()
   where n.kind = 'low_stock' and n.resolved_at is null
     and not exists (select 1 from public.variants v
                      where 'low_stock:' || v.id::text = n.dedupe_key and v.reorder_level > 0
                        and (select coalesce(sum(l.on_hand), 0) from public.stock_levels l where l.variant_id = v.id) <= v.reorder_level);

  -- 2. shift difference: a shift closed in the last 14 days with a cash difference (event: stays until read)
  insert into public.notifications(kind, severity, title, body, link, audience, dedupe_key, created_at)
  select 'shift_difference', 'critical', 'فرق في إقفال وردية',
         'الفرق ' || to_char(c.difference, 'FM999G999G990D00') || ' جنيه بتاريخ ' || to_char(c.closed_at at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI'),
         '/cash', array['owner','manager','accountant']::public.app_role[], 'shift:' || c.id::text, c.closed_at
    from public.cash_sessions c
   where c.status = 'closed' and coalesce(c.difference, 0) <> 0 and c.closed_at >= now() - interval '14 days'
  on conflict (dedupe_key) where resolved_at is null do nothing;

  -- 3. overdue installments: one alert per plan while any installment of it is overdue (due before today, not paid)
  insert into public.notifications(kind, severity, title, body, link, audience, dedupe_key)
  select 'installment_overdue', 'warn', 'أقساط متأخرة: ' || coalesce(c.name, 'عميل'),
         o.cnt || ' قسط متأخر بإجمالي ' || to_char(o.remaining, 'FM999G999G990D00') || ' جنيه',
         '/installments', array['owner','manager','cashier']::public.app_role[], 'inst:' || o.plan_id::text
    from (select i.plan_id, count(*) as cnt, sum(i.amount - i.paid) as remaining
            from public.installments i join public.installment_plans pl on pl.id = i.plan_id and pl.status = 'active'
           where i.status in ('due','partial') and i.due_date < v_today group by i.plan_id) o
    join public.installment_plans pl on pl.id = o.plan_id
    left join public.customers c on c.id = pl.customer_id
  on conflict (dedupe_key) where resolved_at is null do nothing;
  update public.notifications n set resolved_at = now()
   where n.kind = 'installment_overdue' and n.resolved_at is null
     and not exists (select 1 from public.installments i join public.installment_plans pl on pl.id = i.plan_id and pl.status = 'active'
                      where 'inst:' || i.plan_id::text = n.dedupe_key and i.status in ('due','partial') and i.due_date < v_today);

  -- 4. mobile tax reminders due today or earlier (hidden from users whose /mobile-tax page is locked)
  insert into public.notifications(kind, severity, title, body, link, audience, page, dedupe_key)
  select 'tax_due', 'warn', 'ضريبة موبايل مستحقة: ' || t.customer_name,
         coalesce(t.device, '') || ' استحقاق ' || t.due_date::text,
         '/mobile-tax', array['owner','manager','cashier']::public.app_role[], '/mobile-tax', 'tax:' || t.id::text
    from public.tax_reminders t where t.status = 'open' and t.due_date <= v_today
  on conflict (dedupe_key) where resolved_at is null do nothing;
  update public.notifications n set resolved_at = now()
   where n.kind = 'tax_due' and n.resolved_at is null
     and not exists (select 1 from public.tax_reminders t
                      where 'tax:' || t.id::text = n.dedupe_key and t.status = 'open' and t.due_date <= v_today);

  -- 5. suppliers with an overdue invoice
  insert into public.notifications(kind, severity, title, body, link, audience, dedupe_key)
  select 'supplier_overdue', 'warn', 'فاتورة مورد متأخرة: ' || b.name,
         'المتأخر ' || to_char(b.overdue, 'FM999G999G990D00') || ' جنيه',
         '/supplier-accounts', array['owner','manager','accountant']::public.app_role[], 'supplier:' || b.supplier_id::text
    from public.supplier_balances b where b.overdue > 0
  on conflict (dedupe_key) where resolved_at is null do nothing;
  update public.notifications n set resolved_at = now()
   where n.kind = 'supplier_overdue' and n.resolved_at is null
     and not exists (select 1 from public.supplier_balances b where 'supplier:' || b.supplier_id::text = n.dedupe_key and b.overdue > 0);

  -- 6. task reminders that have come (for the assignee)
  insert into public.notifications(kind, severity, title, body, link, user_id, dedupe_key)
  select 'task_due', case when t.priority = 'high' then 'critical' else 'info' end,
         'مهمة: ' || t.title, t.details, '/notifications', coalesce(t.assigned_to, t.created_by), 'task:' || t.id::text
    from public.tasks t where t.status = 'open' and t.remind_at is not null and t.remind_at <= now()
  on conflict (dedupe_key) where resolved_at is null do nothing;
  update public.notifications n set resolved_at = now()
   where n.kind = 'task_due' and n.resolved_at is null
     and not exists (select 1 from public.tasks t where 'task:' || t.id::text = n.dedupe_key and t.status = 'open');

  select count(*) into v_n from public.notifications n where n.resolved_at is null and public.can_see_notification(n);
  return v_n;
end $$;

-- ---------- read state ----------
create or replace function public.my_unread_notifications() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.notifications n
   where n.resolved_at is null and public.can_see_notification(n)
     and not exists (select 1 from public.notification_reads r where r.notification_id = n.id and r.user_id = auth.uid())
$$;

create or replace function public.mark_notification_read(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare n public.notifications;
begin
  perform public.enforce_rate_limit('notification_read', 120, 60);
  select * into n from public.notifications where id = p_id;
  if not found or not public.can_see_notification(n) then raise exception 'notification not found'; end if;
  insert into public.notification_reads(notification_id, user_id) values (p_id, auth.uid()) on conflict do nothing;
end $$;

create or replace function public.mark_all_notifications_read() returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  perform public.enforce_rate_limit('notification_read', 120, 60);
  insert into public.notification_reads(notification_id, user_id)
  select n.id, auth.uid() from public.notifications n
   where n.resolved_at is null and public.can_see_notification(n)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.can_see_notification(public.notifications) from public, anon;
revoke all on function public.create_task(text, text, text, timestamptz, uuid) from public, anon;
revoke all on function public.close_task(uuid, text) from public, anon;
revoke all on function public.refresh_notifications() from public, anon;
revoke all on function public.my_unread_notifications() from public, anon;
revoke all on function public.mark_notification_read(uuid) from public, anon;
revoke all on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.can_see_notification(public.notifications) to authenticated;
grant execute on function public.create_task(text, text, text, timestamptz, uuid) to authenticated;
grant execute on function public.close_task(uuid, text) to authenticated;
grant execute on function public.refresh_notifications() to authenticated;
grant execute on function public.my_unread_notifications() to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;
revoke all on public.notifications, public.notification_reads, public.tasks from anon;
grant select on public.notifications, public.notification_reads, public.tasks to authenticated;
