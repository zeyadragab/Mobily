-- OPTIONAL demo data so every screen has something to show. Run in the Supabase SQL Editor after 0001-0005.
-- All demo rows use SKUs starting with DEMO- and the supplier name starts with "[تجريبي]".
-- Prices are made-up examples. Remove everything with supabase/seed_demo_cleanup.sql.

do $$
declare
  br uuid := (select id from public.branches where is_active order by created_at limit 1);
  cat_mob uuid := (select id from public.categories where name = 'موبايلات');
  cat_lap uuid := (select id from public.categories where name = 'لابتوبات');
  cat_acc uuid := (select id from public.categories where name = 'إكسسوارات');
  cat_chg uuid := (select id from public.categories where name = 'شواحن وكابلات');
  p uuid; v uuid;
begin
  if exists (select 1 from public.variants where sku like 'DEMO-%') then
    raise notice 'demo data already exists, skipping';
    return;
  end if;

  insert into public.suppliers(name, phone, whatsapp, payment_terms, lead_time_days, categories)
  values ('[تجريبي] مورد الموبايلات', '01000000001', '01000000001', '50% مقدم والباقي عند الاستلام', 3, 'موبايلات وإكسسوارات');

  -- 1. Phone with 3 variants
  insert into public.products(name, category_id, brand, description, is_published)
  values ('هاتف ذكي A55', cat_mob, 'Samsung', 'شاشة AMOLED، كاميرا 50 ميجابكسل، بطارية 5000 mAh. (بيانات تجريبية)', true) returning id into p;
  insert into public.variants(product_id, sku, color, storage, price, reorder_level) values (p, 'DEMO-A55-128-BLK', 'أسود', '128GB', 14500, 3) returning id into v;
  insert into public.variant_costs values (v, 12800); insert into public.stock_movements(variant_id, branch_id, movement_type, qty, note) values (v, br, 'adjustment', 8, 'demo');
  insert into public.variants(product_id, sku, color, storage, price, reorder_level) values (p, 'DEMO-A55-256-BLU', 'أزرق', '256GB', 16500, 3) returning id into v;
  insert into public.variant_costs values (v, 14700); insert into public.stock_movements(variant_id, branch_id, movement_type, qty, note) values (v, br, 'adjustment', 2, 'demo');
  insert into public.variants(product_id, sku, color, storage, condition, price, reorder_level) values (p, 'DEMO-A55-128-USED', 'أسود', '128GB', 'used', 11000, 1) returning id into v;
  insert into public.variant_costs values (v, 9500); insert into public.stock_movements(variant_id, branch_id, movement_type, qty, note) values (v, br, 'adjustment', 1, 'demo');

  -- 2. Phone, one variant, out of stock
  insert into public.products(name, category_id, brand, description, is_published)
  values ('هاتف ذكي ريدمي 13', cat_mob, 'Xiaomi', 'أداء ممتاز بسعر اقتصادي. (بيانات تجريبية)', true) returning id into p;
  insert into public.variants(product_id, sku, color, storage, price, reorder_level) values (p, 'DEMO-RM13-128', 'رمادي', '128GB', 7200, 4) returning id into v;
  insert into public.variant_costs values (v, 6300);

  -- 3. Laptop
  insert into public.products(name, category_id, brand, description, is_published)
  values ('لابتوب 15.6 بوصة Core i5', cat_lap, 'Lenovo', 'ذاكرة 16GB وSSD 512GB. (بيانات تجريبية)', true) returning id into p;
  insert into public.variants(product_id, sku, storage, price, reorder_level) values (p, 'DEMO-LAP-I5-512', '512GB', 24900, 2) returning id into v;
  insert into public.variant_costs values (v, 22000); insert into public.stock_movements(variant_id, branch_id, movement_type, qty, note) values (v, br, 'adjustment', 5, 'demo');

  -- 4. Accessories and chargers
  insert into public.products(name, category_id, brand, description, is_published)
  values ('شاحن سريع 33 وات', cat_chg, 'Anker', 'منفذ USB-C بشحن سريع. (بيانات تجريبية)', true) returning id into p;
  insert into public.variants(product_id, sku, price, reorder_level) values (p, 'DEMO-CHG-33W', 450, 10) returning id into v;
  insert into public.variant_costs values (v, 300); insert into public.stock_movements(variant_id, branch_id, movement_type, qty, note) values (v, br, 'adjustment', 40, 'demo');

  insert into public.products(name, category_id, brand, description, is_published)
  values ('كابل USB-C بطول متر', cat_chg, 'Anker', 'كابل متين للشحن ونقل البيانات. (بيانات تجريبية)', true) returning id into p;
  insert into public.variants(product_id, sku, price, reorder_level) values (p, 'DEMO-CBL-C1M', 180, 15) returning id into v;
  insert into public.variant_costs values (v, 95); insert into public.stock_movements(variant_id, branch_id, movement_type, qty, note) values (v, br, 'adjustment', 6, 'demo');

  insert into public.products(name, category_id, brand, description, is_published)
  values ('سماعة بلوتوث لاسلكية', cat_acc, 'JBL', 'بطارية تدوم 20 ساعة. (بيانات تجريبية)', true) returning id into p;
  insert into public.variants(product_id, sku, color, price, reorder_level) values (p, 'DEMO-BT-WHT', 'أبيض', 1350, 3) returning id into v;
  insert into public.variant_costs values (v, 1000); insert into public.stock_movements(variant_id, branch_id, movement_type, qty, note) values (v, br, 'adjustment', 12, 'demo');
end $$;

select 'products' as what, count(*) from public.products
union all select 'variants', count(*) from public.variants
union all select 'stock units', coalesce(sum(qty),0) from public.stock_movements
union all select 'suppliers', count(*) from public.suppliers;
