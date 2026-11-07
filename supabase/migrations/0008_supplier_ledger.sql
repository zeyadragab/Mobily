-- 0008: supplier ledger. Supplier invoices (checked against goods received), payments in parts,
-- advances, balances. Mismatched invoices and big payments need owner approval.

insert into public.app_settings(key, value) values ('supplier_payment_threshold', 20000)
  on conflict (key) do nothing;
insert into public.approval_policies(action_type, approver_role, min_amount) values
  ('supplier_invoice.review', 'owner', 0),
  ('supplier.payment', 'owner', 0);

create table public.supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id),
  po_id uuid references public.purchase_orders(id),
  invoice_number text not null check (char_length(trim(invoice_number)) > 0),
  invoice_date date not null default ((now() at time zone 'Africa/Cairo')::date),
  due_date date,
  amount numeric(14,2) not null check (amount > 0),
  expected_amount numeric(14,2),               -- value of goods received on the linked order, if any
  status text not null default 'open' check (status in ('open','pending_approval','rejected')),
  notes text,
  approval_id uuid references public.approval_requests(id),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (supplier_id, invoice_number)
);
create index on public.supplier_invoices (supplier_id);
create index on public.supplier_invoices (due_date);

create table public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id),
  invoice_id uuid references public.supplier_invoices(id),   -- null = advance payment
  amount numeric(14,2) not null check (amount > 0),
  method text not null check (method in ('cash','card','transfer','wallet')),
  note text,
  status text not null default 'completed' check (status in ('completed','pending_approval','rejected')),
  session_id uuid references public.cash_sessions(id),
  approval_id uuid references public.approval_requests(id),
  paid_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles(id)
);
create index on public.supplier_payments (supplier_id);
create index on public.supplier_payments (invoice_id);
create index on public.supplier_payments (session_id);

create trigger audit_supplier_invoices after insert or update or delete on public.supplier_invoices
  for each row execute function public.audit_row();
create trigger audit_supplier_payments after insert or update or delete on public.supplier_payments
  for each row execute function public.audit_row();

create view public.supplier_invoice_balances with (security_invoker = true) as
  select i.*, s.name as supplier_name,
         coalesce(p.paid, 0)::numeric(14,2) as paid,
         (i.amount - coalesce(p.paid, 0))::numeric(14,2) as remaining
    from public.supplier_invoices i
    join public.suppliers s on s.id = i.supplier_id
    left join (select invoice_id, sum(amount) as paid from public.supplier_payments
                where status = 'completed' and invoice_id is not null group by invoice_id) p
           on p.invoice_id = i.id;

-- balance > 0: we owe the supplier. balance < 0: advance paid in our favour.
create view public.supplier_balances with (security_invoker = true) as
  select s.id as supplier_id, s.name, s.status,
         coalesce(i.invoiced, 0)::numeric(14,2) as invoiced,
         coalesce(p.paid, 0)::numeric(14,2) as paid,
         (coalesce(i.invoiced, 0) - coalesce(p.paid, 0))::numeric(14,2) as balance,
         coalesce(o.overdue, 0)::numeric(14,2) as overdue
    from public.suppliers s
    left join (select supplier_id, sum(amount) as invoiced from public.supplier_invoices
                where status = 'open' group by supplier_id) i on i.supplier_id = s.id
    left join (select supplier_id, sum(amount) as paid from public.supplier_payments
                where status = 'completed' group by supplier_id) p on p.supplier_id = s.id
    left join (select supplier_id, sum(remaining) as overdue from public.supplier_invoice_balances
                where status = 'open' and remaining > 0
                  and due_date < ((now() at time zone 'Africa/Cairo')::date) group by supplier_id) o
           on o.supplier_id = s.id;

-- Internal: put a payment into the drawer accounting. Cash needs an open drawer.
create or replace function public.apply_supplier_payment(p_payment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pay public.supplier_payments; sess uuid; br uuid;
begin
  select * into pay from public.supplier_payments where id = p_payment for update;
  if pay.method = 'cash' then
    br := (select id from public.branches where is_active order by created_at limit 1);
    select id into sess from public.cash_sessions where branch_id = br and status = 'open';
    if sess is null then raise exception 'no open cash session'; end if;
    update public.supplier_payments set session_id = sess where id = p_payment;
  end if;
end $$;
revoke all on function public.apply_supplier_payment(uuid) from public, anon, authenticated;

create or replace function public.create_supplier_invoice(
  p_supplier uuid, p_po uuid, p_number text, p_date date, p_due date, p_amount numeric, p_notes text)
returns public.supplier_invoices
language plpgsql security definer set search_path = public as $$
declare inv public.supplier_invoices; amt numeric(14,2); exp numeric(14,2); po public.purchase_orders;
        need_appr boolean; req uuid; sname text;
begin
  if not public.has_any_role(array['owner','manager','accountant']::public.app_role[]) then raise exception 'not allowed'; end if;
  amt := round(p_amount, 2);
  if amt is null or amt <= 0 then raise exception 'invalid amount'; end if;
  select name into sname from public.suppliers where id = p_supplier;
  if not found then raise exception 'supplier not found'; end if;

  if p_po is not null then
    select * into po from public.purchase_orders where id = p_po and supplier_id = p_supplier;
    if not found then raise exception 'order does not belong to this supplier'; end if;
    if po.status not in ('partially_received','received') then raise exception 'order has no received goods'; end if;
    select coalesce(sum(qty_received * unit_cost), 0) into exp from public.purchase_order_lines where po_id = p_po;
  end if;
  need_appr := exp is not null and abs(amt - exp) > 0.01 and not public.has_role('owner');

  insert into public.supplier_invoices(supplier_id, po_id, invoice_number, invoice_date, due_date, amount,
                                       expected_amount, status, notes)
  values (p_supplier, p_po, trim(p_number), coalesce(p_date, (now() at time zone 'Africa/Cairo')::date), p_due, amt, exp,
          case when need_appr then 'pending_approval' else 'open' end, nullif(trim(coalesce(p_notes,'')),''))
  returning * into inv;

  if need_appr then
    insert into public.approval_requests(action_type, subject_entity, subject_id, requested_by, amount, reason, payload_hash, idempotency_key)
    values ('supplier_invoice.review', 'supplier_invoice', inv.id, auth.uid(), amt,
            'فاتورة مورد ' || sname || ' رقم ' || inv.invoice_number || ' بقيمة ' || amt || ' والمستلم فعليًا ' || exp,
            md5(inv.id::text || ':' || amt), 'supinv-' || inv.id || '-v1')
    returning id into req;
    update public.supplier_invoices set approval_id = req where id = inv.id returning * into inv;
  end if;
  return inv;
end $$;

create or replace function public.pay_supplier(
  p_supplier uuid, p_invoice uuid, p_amount numeric, p_method text, p_note text default null)
returns public.supplier_payments
language plpgsql security definer set search_path = public as $$
declare amt numeric(14,2); inv public.supplier_invoices; used numeric(14,2); pay public.supplier_payments;
        thr numeric; need_appr boolean; req uuid; sname text;
begin
  if not public.has_any_role(array['owner','manager','accountant']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_method not in ('cash','card','transfer','wallet') then raise exception 'invalid payment method'; end if;
  amt := round(p_amount, 2);
  if amt is null or amt <= 0 then raise exception 'invalid amount'; end if;
  select name into sname from public.suppliers where id = p_supplier;
  if not found then raise exception 'supplier not found'; end if;

  if p_invoice is not null then
    select * into inv from public.supplier_invoices where id = p_invoice and supplier_id = p_supplier for update;
    if not found then raise exception 'invoice does not belong to this supplier'; end if;
    if inv.status <> 'open' then raise exception 'invoice is not open for payment'; end if;
    select coalesce(sum(amount), 0) into used from public.supplier_payments
     where invoice_id = p_invoice and status in ('completed','pending_approval');
    if used + amt > inv.amount then raise exception 'payment exceeds remaining'; end if;
  end if;

  thr := coalesce((select value from public.app_settings where key = 'supplier_payment_threshold'), 20000);
  need_appr := amt >= thr and not public.has_role('owner');

  insert into public.supplier_payments(supplier_id, invoice_id, amount, method, note, status)
  values (p_supplier, p_invoice, amt, p_method, nullif(trim(coalesce(p_note,'')),''),
          case when need_appr then 'pending_approval' else 'completed' end)
  returning * into pay;

  if need_appr then
    insert into public.approval_requests(action_type, subject_entity, subject_id, requested_by, amount, reason, payload_hash, idempotency_key)
    values ('supplier.payment', 'supplier_payment', pay.id, auth.uid(), amt,
            'دفعة للمورد ' || sname || ' بقيمة ' || amt,
            md5(pay.id::text || ':' || amt), 'suppay-' || pay.id || '-v1')
    returning id into req;
    update public.supplier_payments set approval_id = req where id = pay.id returning * into pay;
  else
    perform public.apply_supplier_payment(pay.id);
    select * into pay from public.supplier_payments where id = pay.id;
  end if;
  return pay;
end $$;

create or replace function public.sync_supplier_from_approval()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if new.subject_entity = 'supplier_invoice' then
      if new.status = 'approved' then
        update public.supplier_invoices set status = 'open'
         where id = new.subject_id and approval_id = new.id and status = 'pending_approval';
      elsif new.status in ('rejected','changes_requested') then
        update public.supplier_invoices set status = 'rejected'
         where id = new.subject_id and approval_id = new.id and status = 'pending_approval';
      end if;
    elsif new.subject_entity = 'supplier_payment' then
      if new.status = 'approved' then
        if exists (select 1 from public.supplier_payments where id = new.subject_id and approval_id = new.id and status = 'pending_approval') then
          begin
            perform public.apply_supplier_payment(new.subject_id);
            update public.supplier_payments set status = 'completed', paid_at = now() where id = new.subject_id;
          exception when others then
            update public.supplier_payments set status = 'rejected',
                   note = coalesce(note || ' | ', '') || 'فشل عند الاعتماد: ' || sqlerrm
             where id = new.subject_id;
          end;
        end if;
      elsif new.status in ('rejected','changes_requested') then
        update public.supplier_payments set status = 'rejected'
         where id = new.subject_id and approval_id = new.id and status = 'pending_approval';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger approval_sync_supplier after update on public.approval_requests
  for each row execute function public.sync_supplier_from_approval();

-- Drawer: cash paid to suppliers comes out of the expected cash.
create or replace function public.close_cash_session(p_counted numeric, p_note text default null)
returns public.cash_sessions
language plpgsql security definer set search_path = public as $$
declare s public.cash_sessions; br uuid; cash_in numeric(14,2); cash_out numeric(14,2); refunds numeric(14,2);
        sup numeric(14,2); exp numeric(14,2); diff numeric(14,2);
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'invalid counted amount'; end if;
  br := (select id from public.branches where is_active order by created_at limit 1);
  select * into s from public.cash_sessions where branch_id = br and status = 'open' for update;
  if not found then raise exception 'no open cash session'; end if;

  select coalesce(sum(amount),0) into cash_in from public.sales_payments where session_id = s.id and method = 'cash';
  select coalesce(sum(amount),0) into cash_out from public.expense_payments where session_id = s.id and method = 'cash';
  select coalesce(sum(amount),0) into refunds from public.sales_refunds where session_id = s.id and method = 'cash';
  select coalesce(sum(amount),0) into sup from public.supplier_payments
   where session_id = s.id and method = 'cash' and status = 'completed';
  exp := s.opening_balance + cash_in - cash_out - refunds - sup;
  diff := round(p_counted, 2) - exp;
  if diff <> 0 and coalesce(trim(p_note),'') = '' then raise exception 'note required when there is a difference'; end if;

  update public.cash_sessions
     set status = 'closed', closed_by = auth.uid(), closed_at = now(),
         expected_cash = exp, counted_cash = round(p_counted, 2), difference = diff,
         close_note = nullif(trim(coalesce(p_note,'')),'')
   where id = s.id returning * into s;
  return s;
end $$;

-- Transactions feed: add supplier invoices and payments.
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
  select 'supplier_invoice', si.id::text, si.invoice_number, si.amount, si.created_at, si.created_by, si.status, s.name
    from public.supplier_invoices si join public.suppliers s on s.id = si.supplier_id
  union all
  select 'supplier_payment', sp.id::text, s.name, sp.amount, sp.paid_at, sp.created_by, sp.status, sp.method
    from public.supplier_payments sp join public.suppliers s on s.id = sp.supplier_id
  union all
  select 'purchase_order', po.id::text, po.po_number, po.total, po.created_at, po.created_by, po.status::text, ''
    from public.purchase_orders po where po.status <> 'draft'
  union all
  select 'stock_adjustment', m.id::text, coalesce(m.note, ''), m.qty::numeric, m.created_at, m.created_by, 'done', ''
    from public.stock_movements m where m.movement_type = 'adjustment'
  union all
  select 'cash_session', cs.id::text, 'جلسة درج', coalesce(cs.difference, 0), coalesce(cs.closed_at, cs.opened_at),
         coalesce(cs.closed_by, cs.opened_by), cs.status,
         case when cs.difference is not null and cs.difference <> 0 then 'فرق في الدرج' else '' end
    from public.cash_sessions cs
  union all
  select 'online_order', o.id::text, o.order_number, o.total, o.created_at, null::uuid, o.status::text, o.customer_name
    from public.online_orders o
  union all
  select 'approval', a.id::text, a.action_type, coalesce(a.amount, 0), a.created_at, a.requested_by, a.status::text, coalesce(a.reason, '')
    from public.approval_requests a;

-- ---------- grants + RLS ----------
revoke all on function public.create_supplier_invoice(uuid,uuid,text,date,date,numeric,text) from public, anon;
revoke all on function public.pay_supplier(uuid,uuid,numeric,text,text) from public, anon;
grant execute on function public.create_supplier_invoice(uuid,uuid,text,date,date,numeric,text) to authenticated;
grant execute on function public.pay_supplier(uuid,uuid,numeric,text,text) to authenticated;
revoke all on public.supplier_invoice_balances from public, anon;
revoke all on public.supplier_balances from public, anon;
grant select on public.supplier_invoice_balances to authenticated;
grant select on public.supplier_balances to authenticated;

alter table public.supplier_invoices enable row level security;
alter table public.supplier_payments enable row level security;
create policy supinv_read on public.supplier_invoices for select to authenticated
  using (public.has_any_role(array['owner','manager','accountant']::public.app_role[]));
create policy suppay_read on public.supplier_payments for select to authenticated
  using (public.has_any_role(array['owner','manager','accountant']::public.app_role[]));
