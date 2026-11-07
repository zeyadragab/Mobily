-- 0006: sales invoices, expenses, cash drawer sessions, owner summary and transactions feed.
-- Admin/manager records everything; the owner sees everything and approves exceptions.
-- Money = numeric(14,2). RLS on every table. Writes go through functions only.

-- ---------- settings ----------
create table public.app_settings (
  key text primary key,
  value numeric not null,
  updated_at timestamptz not null default now()
);
insert into public.app_settings(key, value) values
  ('max_discount_pct', 5),               -- discount above this % of the invoice needs owner approval
  ('expense_approval_threshold', 5000);  -- expense at/above this amount needs owner approval

alter table public.app_settings enable row level security;
create policy settings_read on public.app_settings for select to authenticated using (public.is_staff());
create policy settings_write on public.app_settings for all to authenticated
  using (public.has_role('owner')) with check (public.has_role('owner'));
create trigger audit_settings after insert or update or delete on public.app_settings
  for each row execute function public.audit_row();

insert into public.approval_policies(action_type, approver_role, min_amount) values
  ('sale.discount', 'owner', 0),
  ('expense.create', 'owner', 0);

-- ---------- cash drawer ----------
create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  opened_by uuid not null default auth.uid() references public.profiles(id),
  opened_at timestamptz not null default now(),
  opening_balance numeric(14,2) not null check (opening_balance >= 0),
  status text not null default 'open' check (status in ('open','closed')),
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  expected_cash numeric(14,2),
  counted_cash numeric(14,2),
  difference numeric(14,2),
  close_note text
);
create unique index one_open_session_per_branch on public.cash_sessions (branch_id) where status = 'open';

-- ---------- sales ----------
create sequence public.invoice_seq start 1;

create table public.sales_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique default ('INV-' || lpad(nextval('public.invoice_seq')::text, 6, '0')),
  branch_id uuid not null references public.branches(id),
  status text not null default 'completed' check (status in ('completed','pending_approval','void')),
  customer_name text,
  customer_phone text,
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  notes text,
  pending_payments jsonb,
  business_date date not null default ((now() at time zone 'Africa/Cairo')::date),
  approval_id uuid references public.approval_requests(id),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  check (discount <= subtotal)
);
create index on public.sales_invoices (business_date desc);
create index on public.sales_invoices (status);
create index on public.sales_invoices (created_by);

create table public.sales_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.sales_invoices(id) on delete cascade,
  variant_id uuid not null references public.variants(id),
  name_snapshot text not null,
  qty int not null check (qty > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  unique (invoice_id, variant_id)
);
create index on public.sales_invoice_lines (invoice_id);

create table public.sales_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.sales_invoices(id) on delete cascade,
  method text not null check (method in ('cash','card','transfer','wallet')),
  amount numeric(14,2) not null check (amount > 0),
  session_id uuid references public.cash_sessions(id),
  created_at timestamptz not null default now()
);
create index on public.sales_payments (invoice_id);
create index on public.sales_payments (session_id);

-- ---------- expenses ----------
create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0
);
insert into public.expense_categories(name, sort_order) values
  ('كهرباء',1),('مياه',2),('إنترنت وتليفون',3),('إيجار',4),('صيانة ونظافة',5),
  ('نقل وشحن',6),('تغليف',7),('تسويق وإعلان',8),('اشتراكات برامج',9),
  ('رسوم بنوك ودفع',10),('رسوم حكومية',11),('أخرى',99);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.expense_categories(id),
  description text not null check (char_length(trim(description)) > 0),
  beneficiary text,
  amount numeric(14,2) not null check (amount > 0),
  expense_date date not null default ((now() at time zone 'Africa/Cairo')::date),
  due_date date,
  invoice_ref text,
  notes text,
  status text not null default 'open' check (status in ('open','pending_approval','rejected')),
  approval_id uuid references public.approval_requests(id),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create index on public.expenses (expense_date desc);

create table public.expense_payments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  method text not null check (method in ('cash','card','transfer','wallet')),
  paid_at timestamptz not null default now(),
  session_id uuid references public.cash_sessions(id),
  note text,
  created_by uuid default auth.uid() references public.profiles(id)
);
create index on public.expense_payments (expense_id);
create index on public.expense_payments (session_id);

create view public.expense_balances with (security_invoker = true) as
  select e.*, c.name as category_name,
         coalesce(p.paid, 0)::numeric(14,2) as paid,
         (e.amount - coalesce(p.paid, 0))::numeric(14,2) as remaining
  from public.expenses e
  join public.expense_categories c on c.id = e.category_id
  left join (select expense_id, sum(amount) as paid from public.expense_payments group by expense_id) p
         on p.expense_id = e.id;

-- ---------- audit triggers ----------
create trigger audit_sales after insert or update or delete on public.sales_invoices
  for each row execute function public.audit_row();
create trigger audit_expenses after insert or update or delete on public.expenses
  for each row execute function public.audit_row();
create trigger audit_expense_payments after insert or update or delete on public.expense_payments
  for each row execute function public.audit_row();
create trigger audit_cash_sessions after insert or update or delete on public.cash_sessions
  for each row execute function public.audit_row();

-- ---------- helpers ----------
create or replace function public.check_payments(p_payments jsonb, p_total numeric)
returns void language plpgsql as $$
declare it jsonb; s numeric(14,2) := 0; a numeric(14,2);
begin
  if p_total = 0 then return; end if;
  if jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 then
    raise exception 'payments required';
  end if;
  for it in select * from jsonb_array_elements(p_payments) loop
    if (it->>'method') not in ('cash','card','transfer','wallet') then raise exception 'invalid payment method'; end if;
    a := round((it->>'amount')::numeric, 2);
    if a is null or a <= 0 then raise exception 'invalid payment amount'; end if;
    s := s + a;
  end loop;
  if s <> p_total then raise exception 'payments must equal the invoice total'; end if;
end $$;

-- Internal: deduct stock and record payments for an invoice. Not callable by clients.
create or replace function public.apply_sale(p_invoice uuid, p_payments jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare inv public.sales_invoices; l record; onhand int; reserved int; sess uuid; pay jsonb;
begin
  select * into inv from public.sales_invoices where id = p_invoice for update;
  for l in select * from public.sales_invoice_lines where invoice_id = p_invoice order by variant_id loop
    perform 1 from public.variants where id = l.variant_id for update;
    select coalesce(sum(qty),0) into onhand from public.stock_movements where variant_id = l.variant_id;
    select coalesce(sum(qty),0) into reserved from public.stock_reservations
     where variant_id = l.variant_id and released_at is null and expires_at > now();
    if l.qty > onhand - reserved then raise exception 'not enough stock'; end if;
    insert into public.stock_movements(variant_id, branch_id, movement_type, qty, unit_cost, ref_type, ref_id, note)
    values (l.variant_id, inv.branch_id, 'sale', -l.qty, l.unit_cost, 'sale', inv.id, inv.invoice_number);
  end loop;
  for pay in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    sess := null;
    if pay->>'method' = 'cash' then
      select id into sess from public.cash_sessions where branch_id = inv.branch_id and status = 'open';
      if sess is null then raise exception 'no open cash session'; end if;
    end if;
    insert into public.sales_payments(invoice_id, method, amount, session_id)
    values (p_invoice, pay->>'method', round((pay->>'amount')::numeric, 2), sess);
  end loop;
end $$;
revoke all on function public.apply_sale(uuid, jsonb) from public, anon, authenticated;

-- ---------- sales ----------
-- p_lines: [{"variant_id": "...", "qty": 2}]   p_payments: [{"method": "cash", "amount": 100}]
create or replace function public.create_sale(
  p_customer_name text, p_customer_phone text, p_discount numeric, p_notes text,
  p_lines jsonb, p_payments jsonb)
returns public.sales_invoices
language plpgsql security definer set search_path = public as $$
declare
  br uuid; it record; v public.variants; pr public.products; inv public.sales_invoices;
  sub numeric(14,2) := 0; disc numeric(14,2); tot numeric(14,2); lim numeric;
  need_appr boolean; ucost numeric(14,2); vname text; req uuid;
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then
    raise exception 'not allowed';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception 'invalid lines';
  end if;
  br := (select id from public.branches where is_active order by created_at limit 1);
  disc := round(coalesce(p_discount, 0), 2);
  if disc < 0 then raise exception 'invalid discount'; end if;

  insert into public.sales_invoices(branch_id, customer_name, customer_phone, notes)
  values (br, nullif(trim(coalesce(p_customer_name,'')),''), nullif(trim(coalesce(p_customer_phone,'')),''),
          nullif(trim(coalesce(p_notes,'')),''))
  returning * into inv;

  for it in
    select (x->>'variant_id')::uuid as variant_id, sum((x->>'qty')::int) as qty
      from jsonb_array_elements(p_lines) x group by 1 order by 1
  loop
    if it.qty is null or it.qty < 1 or it.qty > 1000 then raise exception 'invalid quantity'; end if;
    select * into v from public.variants where id = it.variant_id for update;
    if not found or not v.is_active then raise exception 'item unavailable'; end if;
    select * into pr from public.products where id = v.product_id;
    vname := pr.name || coalesce(' ' || v.storage, '') || coalesce(' ' || v.color, '');
    select vc.cost into ucost from public.variant_costs vc where vc.variant_id = v.id;
    insert into public.sales_invoice_lines(invoice_id, variant_id, name_snapshot, qty, unit_price, unit_cost)
    values (inv.id, v.id, vname, it.qty, v.price, coalesce(ucost, 0));
    sub := sub + it.qty * v.price;
  end loop;

  if disc > sub then raise exception 'discount exceeds subtotal'; end if;
  tot := sub - disc;
  perform public.check_payments(p_payments, tot);

  lim := coalesce((select value from public.app_settings where key = 'max_discount_pct'), 5);
  need_appr := disc > 0 and disc > sub * lim / 100 and not public.has_role('owner');

  update public.sales_invoices
     set subtotal = sub, discount = disc, total = tot,
         status = case when need_appr then 'pending_approval' else 'completed' end,
         pending_payments = case when need_appr then p_payments end
   where id = inv.id returning * into inv;

  if need_appr then
    insert into public.approval_requests
      (action_type, subject_entity, subject_id, requested_by, amount, reason, payload_hash, idempotency_key, branch_id)
    values ('sale.discount', 'sale', inv.id, auth.uid(), disc,
            'خصم ' || disc || ' على فاتورة ' || inv.invoice_number || ' (إجمالي ' || sub || ')',
            md5(inv.id::text || ':' || disc || ':' || sub), 'sale-' || inv.id || '-v1', br)
    returning id into req;
    update public.sales_invoices set approval_id = req where id = inv.id returning * into inv;
  else
    perform public.apply_sale(inv.id, p_payments);
  end if;
  return inv;
end $$;

-- ---------- expenses ----------
create or replace function public.create_expense(
  p_category uuid, p_description text, p_beneficiary text, p_amount numeric,
  p_expense_date date, p_due_date date, p_invoice_ref text, p_notes text)
returns public.expenses
language plpgsql security definer set search_path = public as $$
declare ex public.expenses; amt numeric(14,2); thr numeric; need_appr boolean; req uuid;
begin
  if not public.has_any_role(array['owner','manager','accountant']::public.app_role[]) then
    raise exception 'not allowed';
  end if;
  amt := round(p_amount, 2);
  if amt is null or amt <= 0 then raise exception 'invalid amount'; end if;
  thr := coalesce((select value from public.app_settings where key = 'expense_approval_threshold'), 5000);
  need_appr := amt >= thr and not public.has_role('owner');

  insert into public.expenses(category_id, description, beneficiary, amount, expense_date, due_date,
                              invoice_ref, notes, status)
  values (p_category, trim(p_description), nullif(trim(coalesce(p_beneficiary,'')),''), amt,
          coalesce(p_expense_date, (now() at time zone 'Africa/Cairo')::date), p_due_date,
          nullif(trim(coalesce(p_invoice_ref,'')),''), nullif(trim(coalesce(p_notes,'')),''),
          case when need_appr then 'pending_approval' else 'open' end)
  returning * into ex;

  if need_appr then
    insert into public.approval_requests
      (action_type, subject_entity, subject_id, requested_by, amount, reason, payload_hash, idempotency_key)
    values ('expense.create', 'expense', ex.id, auth.uid(), amt,
            'مصروف: ' || ex.description || ' بقيمة ' || amt,
            md5(ex.id::text || ':' || amt), 'expense-' || ex.id || '-v1')
    returning id into req;
    update public.expenses set approval_id = req where id = ex.id returning * into ex;
  end if;
  return ex;
end $$;

create or replace function public.pay_expense(p_expense uuid, p_amount numeric, p_method text, p_note text default null)
returns public.expense_payments
language plpgsql security definer set search_path = public as $$
declare ex public.expenses; paid numeric(14,2); amt numeric(14,2); sess uuid; pay public.expense_payments; br uuid;
begin
  if not public.has_any_role(array['owner','manager','accountant']::public.app_role[]) then
    raise exception 'not allowed';
  end if;
  if p_method not in ('cash','card','transfer','wallet') then raise exception 'invalid payment method'; end if;
  amt := round(p_amount, 2);
  if amt is null or amt <= 0 then raise exception 'invalid amount'; end if;
  select * into ex from public.expenses where id = p_expense for update;
  if not found then raise exception 'expense not found'; end if;
  if ex.status <> 'open' then raise exception 'expense is not open for payment'; end if;
  select coalesce(sum(amount),0) into paid from public.expense_payments where expense_id = p_expense;
  if paid + amt > ex.amount then raise exception 'payment exceeds remaining'; end if;
  if p_method = 'cash' then
    br := (select id from public.branches where is_active order by created_at limit 1);
    select id into sess from public.cash_sessions where branch_id = br and status = 'open';
    if sess is null then raise exception 'no open cash session'; end if;
  end if;
  insert into public.expense_payments(expense_id, amount, method, session_id, note)
  values (p_expense, amt, p_method, sess, nullif(trim(coalesce(p_note,'')),''))
  returning * into pay;
  return pay;
end $$;

-- ---------- cash drawer ----------
create or replace function public.open_cash_session(p_opening numeric)
returns public.cash_sessions
language plpgsql security definer set search_path = public as $$
declare s public.cash_sessions; br uuid;
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then
    raise exception 'not allowed';
  end if;
  if p_opening is null or p_opening < 0 then raise exception 'invalid opening balance'; end if;
  br := (select id from public.branches where is_active order by created_at limit 1);
  if exists (select 1 from public.cash_sessions where branch_id = br and status = 'open') then
    raise exception 'a cash session is already open';
  end if;
  insert into public.cash_sessions(branch_id, opening_balance) values (br, round(p_opening, 2))
  returning * into s;
  return s;
end $$;

create or replace function public.close_cash_session(p_counted numeric, p_note text default null)
returns public.cash_sessions
language plpgsql security definer set search_path = public as $$
declare s public.cash_sessions; br uuid; cash_in numeric(14,2); cash_out numeric(14,2); exp numeric(14,2); diff numeric(14,2);
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then
    raise exception 'not allowed';
  end if;
  if p_counted is null or p_counted < 0 then raise exception 'invalid counted amount'; end if;
  br := (select id from public.branches where is_active order by created_at limit 1);
  select * into s from public.cash_sessions where branch_id = br and status = 'open' for update;
  if not found then raise exception 'no open cash session'; end if;

  select coalesce(sum(amount),0) into cash_in from public.sales_payments where session_id = s.id and method = 'cash';
  select coalesce(sum(amount),0) into cash_out from public.expense_payments where session_id = s.id and method = 'cash';
  exp := s.opening_balance + cash_in - cash_out;
  diff := round(p_counted, 2) - exp;
  if diff <> 0 and coalesce(trim(p_note),'') = '' then raise exception 'note required when there is a difference'; end if;

  update public.cash_sessions
     set status = 'closed', closed_by = auth.uid(), closed_at = now(),
         expected_cash = exp, counted_cash = round(p_counted, 2), difference = diff,
         close_note = nullif(trim(coalesce(p_note,'')),'')
   where id = s.id returning * into s;
  return s;
end $$;

-- ---------- keep sales/expenses in sync with the owner's decision ----------
create or replace function public.sync_tx_from_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare inv public.sales_invoices;
begin
  if new.status is distinct from old.status then
    if new.subject_entity = 'sale' then
      if new.status = 'approved' then
        select * into inv from public.sales_invoices
         where id = new.subject_id and approval_id = new.id and status = 'pending_approval' for update;
        if found then
          begin
            perform public.apply_sale(inv.id, inv.pending_payments);
            update public.sales_invoices set status = 'completed', pending_payments = null where id = inv.id;
          exception when others then
            update public.sales_invoices
               set status = 'void', pending_payments = null,
                   notes = coalesce(notes || ' | ', '') || 'أُلغيت عند الاعتماد: ' || sqlerrm
             where id = inv.id;
          end;
        end if;
      elsif new.status in ('rejected','changes_requested') then
        update public.sales_invoices
           set status = 'void', pending_payments = null,
               notes = coalesce(notes || ' | ', '') || 'رُفض الخصم من المالك'
         where id = new.subject_id and approval_id = new.id and status = 'pending_approval';
      end if;
    elsif new.subject_entity = 'expense' then
      if new.status = 'approved' then
        update public.expenses set status = 'open'
         where id = new.subject_id and approval_id = new.id and status = 'pending_approval';
      elsif new.status in ('rejected','changes_requested') then
        update public.expenses set status = 'rejected'
         where id = new.subject_id and approval_id = new.id and status = 'pending_approval';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger approval_sync_tx after update on public.approval_requests
  for each row execute function public.sync_tx_from_approval();

-- ---------- owner summary ----------
create or replace function public.owner_summary(p_from date, p_to date)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  len int; pf date; pt date; s numeric; n int; c numeric; ps numeric; e_tot numeric; e_paid numeric;
  e_due numeric; pa int; psales int; bm jsonb; missing int;
begin
  if not public.has_any_role(array['owner','accountant']::public.app_role[]) then
    raise exception 'not allowed';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then raise exception 'invalid range'; end if;
  len := p_to - p_from + 1; pt := p_from - 1; pf := p_from - len;

  select coalesce(sum(total),0), count(*) into s, n from public.sales_invoices
   where status = 'completed' and business_date between p_from and p_to;
  select coalesce(sum(l.qty * l.unit_cost),0), count(*) filter (where l.unit_cost = 0) into c, missing
    from public.sales_invoice_lines l join public.sales_invoices i on i.id = l.invoice_id
   where i.status = 'completed' and i.business_date between p_from and p_to;
  select coalesce(sum(total),0) into ps from public.sales_invoices
   where status = 'completed' and business_date between pf and pt;

  select coalesce(sum(amount),0) into e_tot from public.expenses
   where status = 'open' and expense_date between p_from and p_to;
  select coalesce(sum(p.amount),0) into e_paid from public.expense_payments p
    join public.expenses e on e.id = p.expense_id
   where e.status = 'open' and e.expense_date between p_from and p_to;
  select coalesce(sum(e.amount - coalesce(pp.paid,0)),0) into e_due from public.expenses e
    left join (select expense_id, sum(amount) as paid from public.expense_payments group by expense_id) pp
           on pp.expense_id = e.id
   where e.status = 'open';

  select count(*) into pa from public.approval_requests where status = 'submitted';
  select count(*) into psales from public.sales_invoices where status = 'pending_approval';

  select coalesce(jsonb_object_agg(method, total), '{}'::jsonb) into bm from (
    select p.method, sum(p.amount) as total from public.sales_payments p
      join public.sales_invoices i on i.id = p.invoice_id
     where i.status = 'completed' and i.business_date between p_from and p_to group by p.method) t;

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'sales', s, 'invoices', n, 'cogs', c, 'gross_profit', s - c,
    'lines_missing_cost', missing, 'prev_sales', ps, 'prev_from', pf, 'prev_to', pt,
    'expenses', e_tot, 'expenses_paid', e_paid, 'expenses_due_all', e_due,
    'net_estimate', s - c - e_tot, 'pending_approvals', pa, 'pending_sales', psales, 'by_method', bm);
end $$;

-- ---------- grants ----------
revoke all on function public.create_sale(text,text,numeric,text,jsonb,jsonb) from public, anon;
revoke all on function public.create_expense(uuid,text,text,numeric,date,date,text,text) from public, anon;
revoke all on function public.pay_expense(uuid,numeric,text,text) from public, anon;
revoke all on function public.open_cash_session(numeric) from public, anon;
revoke all on function public.close_cash_session(numeric,text) from public, anon;
revoke all on function public.owner_summary(date,date) from public, anon;
grant execute on function public.create_sale(text,text,numeric,text,jsonb,jsonb) to authenticated;
grant execute on function public.create_expense(uuid,text,text,numeric,date,date,text,text) to authenticated;
grant execute on function public.pay_expense(uuid,numeric,text,text) to authenticated;
grant execute on function public.open_cash_session(numeric) to authenticated;
grant execute on function public.close_cash_session(numeric,text) to authenticated;
grant execute on function public.owner_summary(date,date) to authenticated;

-- ---------- RLS ----------
alter table public.cash_sessions enable row level security;
alter table public.sales_invoices enable row level security;
alter table public.sales_invoice_lines enable row level security;
alter table public.sales_payments enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_payments enable row level security;

create policy cash_read on public.cash_sessions for select to authenticated
  using (public.has_any_role(array['owner','manager','accountant']::public.app_role[])
         or (public.has_role('cashier') and (opened_by = auth.uid() or status = 'open')));

create policy sales_read on public.sales_invoices for select to authenticated
  using (public.has_any_role(array['owner','manager','accountant']::public.app_role[])
         or (public.has_role('cashier') and created_by = auth.uid()));
create policy sales_lines_read on public.sales_invoice_lines for select to authenticated
  using (exists (select 1 from public.sales_invoices i where i.id = invoice_id));
create policy sales_pay_read on public.sales_payments for select to authenticated
  using (exists (select 1 from public.sales_invoices i where i.id = invoice_id));

create policy expcat_read on public.expense_categories for select to authenticated using (public.is_staff());
create policy expcat_write on public.expense_categories for all to authenticated
  using (public.has_any_role(array['owner','manager']::public.app_role[]))
  with check (public.has_any_role(array['owner','manager']::public.app_role[]));
create policy exp_read on public.expenses for select to authenticated
  using (public.has_any_role(array['owner','manager','accountant']::public.app_role[]));
create policy exp_pay_read on public.expense_payments for select to authenticated
  using (public.has_any_role(array['owner','manager','accountant']::public.app_role[]));

-- ---------- owner transactions feed (respects each table's RLS) ----------
create view public.transactions_feed with (security_invoker = true) as
  select 'sale'::text as kind, i.id::text as ref_id, i.invoice_number as ref, i.total as amount,
         i.created_at as at, i.created_by as actor, i.status as status,
         coalesce(i.customer_name, '') as detail
    from public.sales_invoices i
  union all
  select 'expense', e.id::text, e.description, e.amount, e.created_at, e.created_by, e.status,
         coalesce(e.beneficiary, '')
    from public.expenses e
  union all
  select 'expense_payment', p.id::text, e.description, p.amount, p.paid_at, p.created_by, 'paid', p.method
    from public.expense_payments p join public.expenses e on e.id = p.expense_id
  union all
  select 'purchase_order', po.id::text, po.po_number, po.total, po.created_at, po.created_by, po.status::text, ''
    from public.purchase_orders po where po.status <> 'draft'
  union all
  select 'stock_adjustment', m.id::text, coalesce(m.note, ''), m.qty::numeric, m.created_at, m.created_by, 'done', ''
    from public.stock_movements m where m.movement_type = 'adjustment'
  union all
  select 'cash_session', s.id::text, 'جلسة درج', coalesce(s.difference, 0),
         coalesce(s.closed_at, s.opened_at), coalesce(s.closed_by, s.opened_by), s.status,
         case when s.difference is not null and s.difference <> 0 then 'فرق في الدرج' else '' end
    from public.cash_sessions s
  union all
  select 'online_order', o.id::text, o.order_number, o.total, o.created_at, null::uuid, o.status::text, o.customer_name
    from public.online_orders o
  union all
  select 'approval', a.id::text, a.action_type, coalesce(a.amount, 0), a.created_at, a.requested_by,
         a.status::text, coalesce(a.reason, '')
    from public.approval_requests a;

revoke all on public.transactions_feed from public, anon;
revoke all on public.expense_balances from public, anon;
grant select on public.transactions_feed to authenticated;
grant select on public.expense_balances to authenticated;
