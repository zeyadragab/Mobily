-- Which migrations are really applied? Read-only: safe to run any time in the SQL Editor.
-- Every row should show applied = true. Run the missing ones, in order, from supabase/migrations/.

select step, applied from (
  select 1 as n, '0001 foundation (roles, audit, approvals)' as step,
         to_regclass('public.approval_requests') is not null as applied
  union all select 2, '0002 audit trigger fix',
         coalesce((select prosrc like '%tg_nargs%' from pg_proc where proname = 'audit_row' limit 1), false)
  union all select 3, '0003 approval execution guard',
         coalesce((select prosrc like '%requested_by = auth.uid()%' from pg_proc where proname = 'consume_approval' limit 1), false)
  union all select 4, '0004 catalog, stock, suppliers, purchase orders',
         to_regclass('public.purchase_orders') is not null
  union all select 5, '0005 storefront and online orders',
         to_regclass('public.online_orders') is not null
  union all select 6, '0006 sales, expenses, cash drawer',
         to_regclass('public.cash_sessions') is not null and to_regclass('public.app_settings') is not null
  union all select 7, '0007 sales returns',
         to_regclass('public.sales_returns') is not null
  union all select 8, '0008 supplier ledger',
         to_regclass('public.supplier_invoices') is not null
) t order by n;
