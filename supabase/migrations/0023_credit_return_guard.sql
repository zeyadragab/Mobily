-- 0023: safety guard until credit returns are built (Phase 6 of docs/VOLT-GAP-PLAN.md).
-- A return on an invoice that was partly sold on credit would hand cash back while the customer debt
-- stays untouched. Block it at the database until the return flow can reduce the debt first.

create or replace function public.block_credit_invoice_return()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.sales_payments p where p.invoice_id = new.invoice_id and p.method = 'credit') then
    raise exception 'credit invoice return not supported yet';
  end if;
  return new;
end $$;
revoke all on function public.block_credit_invoice_return() from public, anon, authenticated;
create trigger block_credit_invoice_return before insert on public.sales_returns
  for each row execute function public.block_credit_invoice_return();
