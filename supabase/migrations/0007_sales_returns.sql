-- 0007: sales returns. Refund reduces drawer cash and net sales; returned goods go to INSPECTION
-- and are not sellable until a warehouse/manager/owner validates them. Exceptional returns need owner approval.

insert into public.app_settings(key, value) values ('return_approval_threshold', 2000)
  on conflict (key) do nothing;
insert into public.approval_policies(action_type, approver_role, min_amount) values ('sale.return', 'owner', 0);

create sequence public.return_seq start 1;

create table public.sales_returns (
  id uuid primary key default gen_random_uuid(),
  return_number text not null unique default ('RET-' || lpad(nextval('public.return_seq')::text, 6, '0')),
  invoice_id uuid not null references public.sales_invoices(id),
  branch_id uuid not null references public.branches(id),
  reason text not null check (char_length(trim(reason)) > 0),
  refund_method text not null check (refund_method in ('cash','card','transfer','wallet')),
  refund_total numeric(14,2) not null default 0 check (refund_total >= 0),
  status text not null default 'completed' check (status in ('completed','pending_approval','rejected')),
  approval_id uuid references public.approval_requests(id),
  business_date date not null default ((now() at time zone 'Africa/Cairo')::date),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create index on public.sales_returns (invoice_id);
create index on public.sales_returns (business_date desc);

create table public.sales_return_lines (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.sales_returns(id) on delete cascade,
  invoice_line_id uuid not null references public.sales_invoice_lines(id),
  variant_id uuid not null references public.variants(id),
  name_snapshot text not null,
  qty int not null check (qty > 0),
  unit_price numeric(14,2) not null,
  unit_cost numeric(14,2) not null default 0,
  disposition text not null default 'inspection' check (disposition in ('inspection','sellable','damaged')),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  unique (return_id, invoice_line_id)
);
create index on public.sales_return_lines (return_id);
create index on public.sales_return_lines (disposition) where disposition = 'inspection';

create table public.sales_refunds (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.sales_returns(id) on delete cascade,
  method text not null check (method in ('cash','card','transfer','wallet')),
  amount numeric(14,2) not null check (amount > 0),
  session_id uuid references public.cash_sessions(id),
  created_at timestamptz not null default now()
);
create index on public.sales_refunds (session_id);

create trigger audit_returns after insert or update or delete on public.sales_returns
  for each row execute function public.audit_row();
create trigger audit_return_lines after insert or update or delete on public.sales_return_lines
  for each row execute function public.audit_row();

-- Internal: record the refund. Cash refunds need an open drawer and come out of it.
create or replace function public.apply_return(p_return uuid)
returns void language plpgsql security definer set search_path = public as $$
declare ret public.sales_returns; sess uuid;
begin
  select * into ret from public.sales_returns where id = p_return for update;
  if ret.refund_total > 0 then
    if ret.refund_method = 'cash' then
      select id into sess from public.cash_sessions where branch_id = ret.branch_id and status = 'open';
      if sess is null then raise exception 'no open cash session'; end if;
    end if;
    insert into public.sales_refunds(return_id, method, amount, session_id)
    values (p_return, ret.refund_method, ret.refund_total, sess);
  end if;
end $$;
revoke all on function public.apply_return(uuid) from public, anon, authenticated;

-- p_lines: [{"invoice_line_id": "...", "qty": 1}]
create or replace function public.create_return(p_invoice uuid, p_lines jsonb, p_reason text, p_method text)
returns public.sales_returns
language plpgsql security definer set search_path = public as $$
declare
  inv public.sales_invoices; ret public.sales_returns; it record; l public.sales_invoice_lines;
  already int; ratio numeric; refund numeric(14,2) := 0; thr numeric; need_appr boolean; req uuid;
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'reason required'; end if;
  if p_method not in ('cash','card','transfer','wallet') then raise exception 'invalid payment method'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'no lines'; end if;

  select * into inv from public.sales_invoices where id = p_invoice for update;
  if not found or inv.status <> 'completed' then raise exception 'invoice not returnable'; end if;
  ratio := case when inv.subtotal > 0 then inv.total / inv.subtotal else 1 end;

  insert into public.sales_returns(invoice_id, branch_id, reason, refund_method)
  values (p_invoice, inv.branch_id, trim(p_reason), p_method) returning * into ret;

  for it in
    select (x->>'invoice_line_id')::uuid as lid, sum((x->>'qty')::int) as qty
      from jsonb_array_elements(p_lines) x group by 1 order by 1
  loop
    if it.qty is null or it.qty < 1 then raise exception 'invalid quantity'; end if;
    select * into l from public.sales_invoice_lines where id = it.lid and invoice_id = p_invoice for update;
    if not found then raise exception 'line does not belong to invoice'; end if;
    select coalesce(sum(rl.qty), 0) into already
      from public.sales_return_lines rl join public.sales_returns r on r.id = rl.return_id
     where rl.invoice_line_id = l.id and r.status in ('completed','pending_approval') and r.id <> ret.id;
    if already + it.qty > l.qty then raise exception 'return exceeds sold quantity'; end if;
    insert into public.sales_return_lines(return_id, invoice_line_id, variant_id, name_snapshot, qty, unit_price, unit_cost)
    values (ret.id, l.id, l.variant_id, l.name_snapshot, it.qty, l.unit_price, l.unit_cost);
    refund := refund + round(it.qty * l.unit_price * ratio, 2);
  end loop;

  thr := coalesce((select value from public.app_settings where key = 'return_approval_threshold'), 2000);
  need_appr := not public.has_role('owner') and (not public.has_role('manager') or refund >= thr);

  update public.sales_returns
     set refund_total = refund, status = case when need_appr then 'pending_approval' else 'completed' end
   where id = ret.id returning * into ret;

  if need_appr then
    insert into public.approval_requests
      (action_type, subject_entity, subject_id, requested_by, amount, reason, payload_hash, idempotency_key, branch_id)
    values ('sale.return', 'sale_return', ret.id, auth.uid(), refund,
            'مرتجع ' || ret.return_number || ' على فاتورة ' || inv.invoice_number || ' بقيمة ' || refund || ' - ' || trim(p_reason),
            md5(ret.id::text || ':' || refund), 'return-' || ret.id || '-v1', ret.branch_id)
    returning id into req;
    update public.sales_returns set approval_id = req where id = ret.id returning * into ret;
  else
    perform public.apply_return(ret.id);
  end if;
  return ret;
end $$;

-- Warehouse/manager/owner validates a returned item: back to stock, or written off as damaged.
create or replace function public.resolve_return_line(p_line uuid, p_result text)
returns public.sales_return_lines
language plpgsql security definer set search_path = public as $$
declare l public.sales_return_lines; ret public.sales_returns;
begin
  if not public.has_any_role(array['owner','manager','warehouse']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_result not in ('sellable','damaged') then raise exception 'invalid result'; end if;
  select * into l from public.sales_return_lines where id = p_line for update;
  if not found then raise exception 'line not found'; end if;
  select * into ret from public.sales_returns where id = l.return_id;
  if ret.status <> 'completed' or l.disposition <> 'inspection' then raise exception 'line is not awaiting inspection'; end if;
  if p_result = 'sellable' then
    insert into public.stock_movements(variant_id, branch_id, movement_type, qty, unit_cost, ref_type, ref_id, note)
    values (l.variant_id, ret.branch_id, 'return', l.qty, l.unit_cost, 'sale_return', ret.id, ret.return_number);
  end if;
  update public.sales_return_lines set disposition = p_result, resolved_by = auth.uid(), resolved_at = now()
   where id = p_line returning * into l;
  return l;
end $$;

-- Owner decision on a pending return.
create or replace function public.sync_return_from_approval()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.subject_entity = 'sale_return' and new.status is distinct from old.status then
    if new.status = 'approved' then
      if exists (select 1 from public.sales_returns where id = new.subject_id and approval_id = new.id and status = 'pending_approval') then
        begin
          perform public.apply_return(new.subject_id);
          update public.sales_returns set status = 'completed' where id = new.subject_id;
        exception when others then
          update public.sales_returns set status = 'rejected', reason = reason || ' | فشل عند الاعتماد: ' || sqlerrm
           where id = new.subject_id;
        end;
      end if;
    elsif new.status in ('rejected','changes_requested') then
      update public.sales_returns set status = 'rejected'
       where id = new.subject_id and approval_id = new.id and status = 'pending_approval';
    end if;
  end if;
  return new;
end $$;
create trigger approval_sync_return after update on public.approval_requests
  for each row execute function public.sync_return_from_approval();

-- Drawer: cash refunds come out of the expected cash.
create or replace function public.close_cash_session(p_counted numeric, p_note text default null)
returns public.cash_sessions
language plpgsql security definer set search_path = public as $$
declare s public.cash_sessions; br uuid; cash_in numeric(14,2); cash_out numeric(14,2); refunds numeric(14,2);
        exp numeric(14,2); diff numeric(14,2);
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'invalid counted amount'; end if;
  br := (select id from public.branches where is_active order by created_at limit 1);
  select * into s from public.cash_sessions where branch_id = br and status = 'open' for update;
  if not found then raise exception 'no open cash session'; end if;

  select coalesce(sum(amount),0) into cash_in from public.sales_payments where session_id = s.id and method = 'cash';
  select coalesce(sum(amount),0) into cash_out from public.expense_payments where session_id = s.id and method = 'cash';
  select coalesce(sum(amount),0) into refunds from public.sales_refunds where session_id = s.id and method = 'cash';
  exp := s.opening_balance + cash_in - cash_out - refunds;
  diff := round(p_counted, 2) - exp;
  if diff <> 0 and coalesce(trim(p_note),'') = '' then raise exception 'note required when there is a difference'; end if;

  update public.cash_sessions
     set status = 'closed', closed_by = auth.uid(), closed_at = now(),
         expected_cash = exp, counted_cash = round(p_counted, 2), difference = diff,
         close_note = nullif(trim(coalesce(p_note,'')),'')
   where id = s.id returning * into s;
  return s;
end $$;

-- Owner summary: net sales = invoices - returns; cost of goods is reversed only for items put back on sale.
create or replace function public.owner_summary(p_from date, p_to date)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  len int; pf date; pt date; s numeric; n int; c numeric; ps numeric; e_tot numeric; e_paid numeric;
  e_due numeric; pa int; psales int; bm jsonb; missing int; r_tot numeric; r_cost numeric; r_n int; insp int;
begin
  if not public.has_any_role(array['owner','accountant']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then raise exception 'invalid range'; end if;
  len := p_to - p_from + 1; pt := p_from - 1; pf := p_from - len;

  select coalesce(sum(total),0), count(*) into s, n from public.sales_invoices
   where status = 'completed' and business_date between p_from and p_to;
  select coalesce(sum(l.qty * l.unit_cost),0), count(*) filter (where l.unit_cost = 0) into c, missing
    from public.sales_invoice_lines l join public.sales_invoices i on i.id = l.invoice_id
   where i.status = 'completed' and i.business_date between p_from and p_to;

  select coalesce(sum(refund_total),0), count(*) into r_tot, r_n from public.sales_returns
   where status = 'completed' and business_date between p_from and p_to;
  select coalesce(sum(rl.qty * rl.unit_cost),0) into r_cost
    from public.sales_return_lines rl join public.sales_returns r on r.id = rl.return_id
   where r.status = 'completed' and rl.disposition = 'sellable' and r.business_date between p_from and p_to;
  select count(*) into insp from public.sales_return_lines rl join public.sales_returns r on r.id = rl.return_id
   where r.status = 'completed' and rl.disposition = 'inspection';

  select coalesce(sum(total),0) - coalesce((select sum(refund_total) from public.sales_returns
          where status = 'completed' and business_date between pf and pt), 0)
    into ps from public.sales_invoices where status = 'completed' and business_date between pf and pt;

  select coalesce(sum(amount),0) into e_tot from public.expenses where status = 'open' and expense_date between p_from and p_to;
  select coalesce(sum(p.amount),0) into e_paid from public.expense_payments p
    join public.expenses e on e.id = p.expense_id where e.status = 'open' and e.expense_date between p_from and p_to;
  select coalesce(sum(e.amount - coalesce(pp.paid,0)),0) into e_due from public.expenses e
    left join (select expense_id, sum(amount) as paid from public.expense_payments group by expense_id) pp on pp.expense_id = e.id
   where e.status = 'open';

  select count(*) into pa from public.approval_requests where status = 'submitted';
  select count(*) into psales from public.sales_invoices where status = 'pending_approval';
  select coalesce(jsonb_object_agg(method, total), '{}'::jsonb) into bm from (
    select p.method, sum(p.amount) as total from public.sales_payments p
      join public.sales_invoices i on i.id = p.invoice_id
     where i.status = 'completed' and i.business_date between p_from and p_to group by p.method) t;

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'sales_gross', s, 'returns', r_tot, 'returns_count', r_n, 'returns_awaiting_inspection', insp,
    'sales', s - r_tot, 'invoices', n, 'cogs', c - r_cost, 'gross_profit', (s - r_tot) - (c - r_cost),
    'lines_missing_cost', missing, 'prev_sales', ps, 'prev_from', pf, 'prev_to', pt,
    'expenses', e_tot, 'expenses_paid', e_paid, 'expenses_due_all', e_due,
    'net_estimate', (s - r_tot) - (c - r_cost) - e_tot,
    'pending_approvals', pa, 'pending_sales', psales, 'by_method', bm);
end $$;

-- Transactions feed: add returns.
create or replace view public.transactions_feed with (security_invoker = true) as
  select 'sale'::text as kind, i.id::text as ref_id, i.invoice_number as ref, i.total as amount,
         i.created_at as at, i.created_by as actor, i.status as status, coalesce(i.customer_name, '') as detail
    from public.sales_invoices i
  union all
  select 'return', r.id::text, r.return_number, r.refund_total, r.created_at, r.created_by, r.status, r.reason
    from public.sales_returns r
  union all
  select 'expense', e.id::text, e.description, e.amount, e.created_at, e.created_by, e.status, coalesce(e.beneficiary, '')
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
  select 'cash_session', s.id::text, 'جلسة درج', coalesce(s.difference, 0), coalesce(s.closed_at, s.opened_at),
         coalesce(s.closed_by, s.opened_by), s.status,
         case when s.difference is not null and s.difference <> 0 then 'فرق في الدرج' else '' end
    from public.cash_sessions s
  union all
  select 'online_order', o.id::text, o.order_number, o.total, o.created_at, null::uuid, o.status::text, o.customer_name
    from public.online_orders o
  union all
  select 'approval', a.id::text, a.action_type, coalesce(a.amount, 0), a.created_at, a.requested_by, a.status::text, coalesce(a.reason, '')
    from public.approval_requests a;

-- ---------- grants + RLS ----------
revoke all on function public.create_return(uuid,jsonb,text,text) from public, anon;
revoke all on function public.resolve_return_line(uuid,text) from public, anon;
grant execute on function public.create_return(uuid,jsonb,text,text) to authenticated;
grant execute on function public.resolve_return_line(uuid,text) to authenticated;

alter table public.sales_returns enable row level security;
alter table public.sales_return_lines enable row level security;
alter table public.sales_refunds enable row level security;

create policy ret_read on public.sales_returns for select to authenticated
  using (public.has_any_role(array['owner','manager','accountant']::public.app_role[])
         or (public.has_role('cashier') and created_by = auth.uid()));
create policy ret_lines_read on public.sales_return_lines for select to authenticated
  using (exists (select 1 from public.sales_returns r where r.id = return_id)
         or public.has_role('warehouse'));
create policy ret_refunds_read on public.sales_refunds for select to authenticated
  using (exists (select 1 from public.sales_returns r where r.id = return_id));
