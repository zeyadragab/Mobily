-- 0017: close the gaps found by the Supabase security advisor on staging (2026-11-10).
--  1. Trigger functions must not be callable through the API (/rest/v1/rpc). EXECUTE is only checked when a trigger
--     is created, never when it fires, so revoking it here cannot break any existing trigger.
--  2. Pin the search_path of helper functions that had none (a mutable search_path lets a caller shadow objects).
-- Intentionally NOT changed: expire_online_orders / track_order (public storefront), has_role / is_staff (used by RLS),
-- catalog_items (public view that hides cost and caps stock).

-- 1. every trigger function in public: no public / anon / authenticated execute
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- 2. fixed search_path on helper functions that have none
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('audit_block_mutation','touch_updated_at','po_lines_guard','check_payments',
                         'norm_serial','parse_serials','variant_tracked','repair_orders_flow_guard')
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public', r.sig);
  end loop;
end $$;
