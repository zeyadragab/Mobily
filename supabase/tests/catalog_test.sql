-- Catalog: tracking mode, IMEI check, category fields, wholesale price, barcodes, bulk import (0027).
-- Run on STAGING after 0001-0027. Everything is rolled back: the last block raises the results as an error on purpose.
-- Expected: every line "= true".

create temp table t_results(n serial, test text, ok boolean, detail text);
grant all on t_results to public;
grant usage on sequence t_results_n_seq to public;
create temp table t_ids(k text primary key, v text);
grant all on t_ids to public;

insert into auth.users (id, aud, role, email) values
 ('00000000-0000-0000-0000-0000000000a6','authenticated','authenticated','t-owner6@test.invalid'),
 ('00000000-0000-0000-0000-0000000000b6','authenticated','authenticated','t-manager6@test.invalid'),
 ('00000000-0000-0000-0000-0000000000c6','authenticated','authenticated','t-cashier6@test.invalid');
insert into public.user_roles(user_id, role) values
 ('00000000-0000-0000-0000-0000000000a6','owner'),
 ('00000000-0000-0000-0000-0000000000b6','manager'),
 ('00000000-0000-0000-0000-0000000000c6','cashier');

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
end $$;
create or replace function pg_temp.rec(t text, ok boolean, d text default '') returns void
language sql as $$ insert into t_results(test, ok, detail) values (t, ok, d); $$;
create or replace function pg_temp.id(key text) returns uuid language sql as $$ select v::uuid from t_ids where k = key $$;

-- 1. tracking mode and unit stay in sync with the old track_serial flag
do $$ declare p1 uuid; p2 uuid; m1 text; u1 text; t2 boolean; begin
  insert into public.products(name, track_serial, unit) values ('هاتف اختبار كتالوج', true, 'كيلو') returning id into p1;
  select tracking_mode, unit into m1, u1 from public.products where id = p1;
  insert into public.products(name, tracking_mode) values ('جهاز IMEI اختبار', 'imei') returning id into p2;
  select track_serial into t2 from public.products where id = p2;
  insert into t_ids values ('p1', p1::text), ('p2', p2::text);
  perform pg_temp.rec('1 track_serial and tracking_mode in sync, serial items counted by piece', m1 = 'serial' and u1 = 'قطعة' and t2, m1 || '/' || u1);
end $$;

-- 2. IMEI mode: valid Luhn accepted, wrong check digit and short numbers refused; serial mode accepts any code
do $$ declare v2 uuid; v1 uuid; f1 boolean := false; f2 boolean := false; ok1 boolean := false; ok2 boolean := false; br uuid; begin
  br := (select id from public.branches where is_active order by created_at limit 1);
  insert into public.variants(product_id, sku, price) values (pg_temp.id('p2'), 'CAT-IMEI-1', 1000) returning id into v2;
  insert into public.variants(product_id, sku, price) values (pg_temp.id('p1'), 'CAT-SER-1', 1000) returning id into v1;
  begin insert into public.devices(variant_id, serial, cost, branch_id) values (v2, '490154203237518', 600, br); ok1 := true; exception when others then ok1 := false; end;
  begin insert into public.devices(variant_id, serial, cost, branch_id) values (v2, '490154203237519', 600, br); exception when others then f1 := true; end;
  begin insert into public.devices(variant_id, serial, cost, branch_id) values (v2, '12345', 600, br); exception when others then f2 := true; end;
  begin insert into public.devices(variant_id, serial, cost, branch_id) values (v1, 'ANYCODE-001', 600, br); ok2 := true; exception when others then ok2 := false; end;
  insert into t_ids values ('v1', v1::text), ('v2', v2::text);
  perform pg_temp.rec('2 IMEI Luhn check only in imei mode', ok1 and f1 and f2 and ok2, ok1::text || f1::text || f2::text || ok2::text);
end $$;

-- 3. category fields: manager creates, cashier refused
do $$ declare c uuid; f boolean := false; n int; begin
  insert into public.categories(name, sort_order) values ('قسم اختبار حقول', 99) returning id into c;
  insert into t_ids values ('c', c::text);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c6');
  begin insert into public.category_fields(category_id, label, kind) values (c, 'الرام', 'short'); exception when others then f := true; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b6');
  insert into public.category_fields(category_id, label, kind, required) values (c, 'الرام', 'number', true);
  insert into public.category_fields(category_id, label, kind, options) values (c, 'اللون الداخلي', 'list', array['أسود','أبيض']);
  insert into public.category_fields(category_id, label, kind) values (c, 'مقاوم للماء', 'yesno'); reset role;
  select count(*) into n from public.category_fields where category_id = c;
  perform pg_temp.rec('3 fields: manager yes, cashier no', f and n = 3, 'fields=' || n);
end $$;

-- 4. values must match the fields: required missing, wrong type, unknown key, bad list value are refused; a good set is saved
do $$ declare p uuid; a boolean := false; b boolean := false; c boolean := false; d boolean := false; ok boolean := false; begin
  insert into public.products(name, category_id) values ('منتج بقيم', pg_temp.id('c')) returning id into p;
  begin insert into public.variants(product_id, sku, price, attributes) values (p, 'CAT-A1', 100, '{}'::jsonb); exception when others then a := true; end;
  begin insert into public.variants(product_id, sku, price, attributes) values (p, 'CAT-A2', 100, '{"الرام":"abc"}'::jsonb); exception when others then b := true; end;
  begin insert into public.variants(product_id, sku, price, attributes) values (p, 'CAT-A3', 100, '{"الرام":8,"غير موجود":1}'::jsonb); exception when others then c := true; end;
  begin insert into public.variants(product_id, sku, price, attributes) values (p, 'CAT-A4', 100, '{"الرام":8,"اللون الداخلي":"أحمر"}'::jsonb); exception when others then d := true; end;
  begin insert into public.variants(product_id, sku, price, attributes) values (p, 'CAT-A5', 100, '{"الرام":"8","اللون الداخلي":"أسود","مقاوم للماء":true}'::jsonb); ok := true; exception when others then ok := false; end;
  perform pg_temp.rec('4 attribute values validated', a and b and c and d and ok, a::text || b::text || c::text || d::text || ok::text);
end $$;

-- 5. a later required field does not block editing the price of an old item
do $$ declare ok boolean := false; begin
  begin update public.variants set price = 120 where sku = 'CAT-A5'; ok := true; exception when others then ok := false; end;
  insert into public.category_fields(category_id, label, kind, required) values (pg_temp.id('c'), 'الضمان', 'short', true);
  begin update public.variants set price = 130 where sku = 'CAT-A5'; ok := ok and true; exception when others then ok := false; end;
  perform pg_temp.rec('5 new required field does not block price edits', ok);
end $$;

-- 6. wholesale price cannot be negative
do $$ declare f boolean := false; begin
  begin update public.variants set wholesale_price = -1 where id = pg_temp.id('v1'); exception when others then f := true; end;
  update public.variants set wholesale_price = 900 where id = pg_temp.id('v1');
  perform pg_temp.rec('6 wholesale price', f and (select wholesale_price = 900 from public.variants where id = pg_temp.id('v1')));
end $$;

-- 7. barcode generator: EAN-13 with a valid check digit, unique, staff roles only
do $$ declare b1 text; b2 text; f boolean := false; s int := 0; i int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b6');
  b1 := public.next_barcode(); b2 := public.next_barcode(); reset role;
  for i in 1..12 loop s := s + substr(b1, i, 1)::int * case when i % 2 = 1 then 1 else 3 end; end loop;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c6');
  begin perform public.next_barcode(); exception when others then f := true; end; reset role;
  perform pg_temp.rec('7 barcode EAN-13, unique, cashier refused', b1 ~ '^[0-9]{13}$' and b1 <> b2 and (10 - s % 10) % 10 = substr(b1, 13, 1)::int and f, b1);
end $$;

-- 8. import: cashier refused; errors block everything; clean file creates; same file again updates
do $$ declare f boolean := false; r jsonb; r2 jsonb; r3 jsonb; r4 jsonb; n0 int; n1 int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c6');
  begin perform public.import_catalog('[{"sku":"I-1","name":"x","price":"1"}]'::jsonb, false); exception when others then f := true; end; reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b6');
  select count(*) into n0 from public.variants;
  r := public.import_catalog('[{"sku":"I-1","name":"كفر","price":"50"},{"sku":"i-1","name":"كفر","price":"50"},{"sku":"I-2","name":"شاحن","price":"abc"}]'::jsonb, true);
  select count(*) into n1 from public.variants;
  r2 := public.import_catalog('[{"sku":"I-10","name":"كفر شفاف","brand":"Generic","category":"إكسسوارات اختبار","price":"50","wholesale_price":"40","cost":"30","reorder_level":"5","barcode":"6001234567890"},
                               {"sku":"I-11","name":"كفر شفاف","brand":"Generic","color":"أسود","price":"55","cost":"30"}]'::jsonb, true);
  r3 := public.import_catalog('[{"sku":"I-10","name":"كفر شفاف","brand":"Generic","price":"60","wholesale_price":"45"}]'::jsonb, true);
  r4 := public.import_catalog('[{"sku":"I-11","name":"اسم مختلف","price":"55"}]'::jsonb, true); reset role;
  perform pg_temp.rec('8 import: refused / blocked / created / updated / conflict',
    f and (r->>'applied')::boolean = false and jsonb_array_length(r->'errors') = 2 and n0 = n1
    and (r2->>'applied')::boolean and (r2->>'created')::int = 2
    and (select count(*) from public.products where name = 'كفر شفاف') = 1
    and (select price = 60 and wholesale_price = 45 from public.variants where sku = 'I-10')
    and (r3->>'updated')::int = 1
    and (r4->>'applied')::boolean = false and jsonb_array_length(r4->'errors') = 1,
    r::text);
end $$;

-- 9. a category in use cannot be deleted; an unused one can
do $$ declare f boolean := false; c2 uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b6');
  begin perform public.delete_category(pg_temp.id('c')); exception when others then f := true; end; reset role;
  insert into public.categories(name, sort_order) values ('قسم فارغ اختبار', 98) returning id into c2;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b6');
  perform public.delete_category(c2); reset role;
  perform pg_temp.rec('9 category delete rule', f and not exists (select 1 from public.categories where id = c2));
end $$;

do $$ declare j text; begin
  select string_agg(test || ' = ' || ok || ' [' || detail || ']', E'\n' order by n) into j from t_results;
  raise exception E'RESULTS (rolled back)\n%', j;
end $$;
