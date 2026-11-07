-- Removes the demo data created by seed_demo.sql (only rows marked DEMO- / [تجريبي]).
-- Fails safely if a demo item was already used in a real order or purchase order: then deactivate it in the app instead.

do $$
declare ids uuid[];
begin
  select array_agg(id) into ids from public.variants where sku like 'DEMO-%';
  if ids is null then raise notice 'no demo data'; return; end if;

  delete from public.stock_reservations where variant_id = any(ids);
  delete from public.online_order_lines where variant_id = any(ids);
  delete from public.stock_movements where variant_id = any(ids);
  delete from public.variant_costs where variant_id = any(ids);
  delete from public.variants where id = any(ids);
  delete from public.products p where name like '%(بيانات تجريبية)%' or description like '%(بيانات تجريبية)%';
  delete from public.suppliers where name like '[تجريبي]%';
end $$;
