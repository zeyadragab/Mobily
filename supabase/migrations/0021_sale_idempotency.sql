-- 0021: a sale can never be saved twice by a double click or a network retry.
-- The screen sends one random key per invoice form; the same key always returns the same invoice.
-- Also: a held basket (0020) that was resumed is removed in the same transaction as the sale,
-- and a registered customer (0022) can be attached to the invoice.
-- Needs 0020. Plain create_sale stays for old tests; the screens call create_sale_once only.

create table public.sale_requests (
  user_id uuid not null default auth.uid() references public.profiles(id),
  idem_key uuid not null,
  invoice_id uuid references public.sales_invoices(id),
  created_at timestamptz not null default now(),
  primary key (user_id, idem_key)
);
alter table public.sale_requests enable row level security;   -- no policies: functions only

create or replace function public.create_sale_once(
  p_idem uuid, p_customer_name text, p_customer_phone text, p_discount numeric, p_notes text,
  p_lines jsonb, p_payments jsonb, p_held uuid default null, p_customer uuid default null)
returns public.sales_invoices
language plpgsql security definer set search_path = public as $$
declare inv public.sales_invoices; existing uuid;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  if p_idem is null then raise exception 'idempotency key required'; end if;
  insert into public.sale_requests(user_id, idem_key) values (auth.uid(), p_idem) on conflict do nothing;
  if not found then
    -- the first request has committed (a concurrent one blocks on the unique key until it does)
    select r.invoice_id into existing from public.sale_requests r where r.user_id = auth.uid() and r.idem_key = p_idem;
    select * into inv from public.sales_invoices where id = existing;
    if not found then raise exception 'sale already in progress'; end if;
    return inv;
  end if;
  perform set_config('app.sale_customer', coalesce(p_customer::text, ''), true);
  inv := public.create_sale(p_customer_name, p_customer_phone, p_discount, p_notes, p_lines, p_payments);
  perform set_config('app.sale_customer', '', true);
  update public.sale_requests set invoice_id = inv.id where user_id = auth.uid() and idem_key = p_idem;
  if p_held is not null then perform public.discard_basket(p_held); end if;
  return inv;
end $$;

revoke all on function public.create_sale_once(uuid, text, text, numeric, text, jsonb, jsonb, uuid, uuid) from public, anon;
grant execute on function public.create_sale_once(uuid, text, text, numeric, text, jsonb, jsonb, uuid, uuid) to authenticated;
