-- OPTIONAL bigger TEST catalog (24 products) so the website and admin look full. Run in the SQL Editor after 0001-0005.
-- All wording, prices and costs are made up for testing. Pictures are local placeholder drawings (/demo/*.svg).
-- Every row is marked DEMO- / "(بيانات تجريبية)". Remove with supabase/seed_demo_cleanup.sql.
-- Replace with your real products and your own photos before launch.

do $$
declare
  br uuid := (select id from public.branches where is_active order by created_at limit 1);
  cats jsonb := jsonb_build_object(
    'mob', (select id from public.categories where name = 'موبايلات'),
    'lap', (select id from public.categories where name = 'لابتوبات'),
    'acc', (select id from public.categories where name = 'إكسسوارات'),
    'chg', (select id from public.categories where name = 'شواحن وكابلات'));
  items jsonb := '[
   {"n":"سامسونج جالاكسي A35","b":"Samsung","c":"mob","i":"phone","d":"شاشة 6.6 بوصة وبطارية 5000 mAh وكاميرا ثلاثية.","v":[["128GB","أسود","new",15800,14100,6,3],["256GB","أزرق","new",17900,16000,3,2]]},
   {"n":"سامسونج جالاكسي A15","b":"Samsung","c":"mob","i":"phone","d":"هاتف اقتصادي بشاشة كبيرة وأداء يومي ممتاز.","v":[["128GB","أسود","new",8900,7800,10,4],["128GB","أزرق فاتح","new",8900,7800,5,4]]},
   {"n":"شاومي ريدمي نوت 13","b":"Xiaomi","c":"mob","i":"phone","d":"شاشة AMOLED وشحن سريع وكاميرا 108 ميجابكسل.","v":[["128GB","أسود","new",11500,10200,8,3],["256GB","أخضر","new",13200,11800,4,2]]},
   {"n":"شاومي ريدمي 13C","b":"Xiaomi","c":"mob","i":"phone","d":"أفضل خيار للميزانية المحدودة مع بطارية تدوم يومين.","v":[["128GB","أسود","new",6400,5600,12,5]]},
   {"n":"بوكو X6","b":"Xiaomi","c":"mob","i":"phone","d":"أداء قوي للألعاب بسعر منافس.","v":[["256GB","أسود","new",14900,13300,5,2],["256GB","أصفر","new",14900,13300,0,2]]},
   {"n":"ريلمي C67","b":"Realme","c":"mob","i":"phone","d":"تصميم أنيق وشحن سريع 33 وات.","v":[["128GB","أخضر","new",7800,6900,7,3]]},
   {"n":"أوبو A58","b":"Oppo","c":"mob","i":"phone","d":"شاشة 90Hz وتصميم نحيف وسهل الحمل.","v":[["128GB","أسود","new",8400,7400,6,3]]},
   {"n":"إنفينكس هوت 40","b":"Infinix","c":"mob","i":"phone","d":"بطارية كبيرة وسماعات ستيريو وسعر مناسب.","v":[["256GB","أسود","new",6900,6000,9,4]]},
   {"n":"تكنو سباركس 20","b":"Tecno","c":"mob","i":"phone","d":"كاميرا أمامية 32 ميجابكسل وذاكرة موسعة.","v":[["128GB","أبيض","new",5600,4900,0,4]]},
   {"n":"آيفون 13 (مجدد)","b":"Apple","c":"mob","i":"phone","d":"جهاز مجدد بحالة ممتازة وفحص كامل وضمان المحل.","v":[["128GB","أسود","refurbished",32500,29000,2,1],["128GB","وردي","used",30500,27500,1,1]]},
   {"n":"لينوفو آيدياباد 3","b":"Lenovo","c":"lap","i":"laptop","d":"لابتوب 15.6 بوصة مناسب للدراسة والعمل المكتبي.","v":[["256GB SSD / 8GB","رمادي","new",19900,17800,4,2],["512GB SSD / 16GB","رمادي","new",24500,22000,2,2]]},
   {"n":"إتش بي 15 رايزن 5","b":"HP","c":"lap","i":"laptop","d":"أداء قوي لتعدد المهام ولوحة مفاتيح مريحة.","v":[["512GB SSD / 16GB","فضي","new",26900,24000,3,2]]},
   {"n":"ديل إنسبايرون 15","b":"Dell","c":"lap","i":"laptop","d":"لابتوب موثوق للاستخدام اليومي وبطارية جيدة.","v":[["512GB SSD / 8GB","أسود","new",23500,21000,2,1]]},
   {"n":"أسوس فيفوبوك","b":"Asus","c":"lap","i":"laptop","d":"شاشة OLED ملونة وتصميم خفيف.","v":[["512GB SSD / 16GB","أزرق","new",28900,26000,0,1]]},
   {"n":"سماعات بلوتوث لاسلكية","b":"Anker","c":"acc","i":"accessory","d":"عزل ضوضاء وبطارية تصل إلى 30 ساعة مع العلبة.","v":[["","أسود","new",1450,1050,15,5],["","أبيض","new",1450,1050,9,5]]},
   {"n":"سوار ذكي لياقة","b":"Huawei","c":"acc","i":"accessory","d":"متابعة النوم والنبض والخطوات مع بطارية أسبوعين.","v":[["","أسود","new",1650,1200,8,3]]},
   {"n":"جراب حماية شفاف","b":"Generic","c":"acc","i":"accessory","d":"حماية من الصدمات وشفاف لا يصفر.","v":[["لسامسونج A35","شفاف","new",180,70,30,10],["لشاومي نوت 13","شفاف","new",160,60,25,10]]},
   {"n":"لاصق حماية شاشة زجاج","b":"Generic","c":"acc","i":"accessory","d":"زجاج مقوى 9H مع أدوات التركيب.","v":[["عام","شفاف","new",90,30,50,15]]},
   {"n":"باور بانك 10000 mAh","b":"Anker","c":"acc","i":"accessory","d":"شحن سريع ومنفذين USB وحجم صغير.","v":[["10000mAh","أسود","new",780,560,14,5]]},
   {"n":"شاحن سريع 20 وات","b":"Anker","c":"chg","i":"charger","d":"منفذ USB-C بشحن سريع آمن.","v":[["","أبيض","new",320,200,40,12]]},
   {"n":"شاحن GaN سريع 65 وات","b":"Anker","c":"chg","i":"charger","d":"يشحن اللابتوب والموبايل بشاحن واحد صغير.","v":[["","أسود","new",980,700,10,4]]},
   {"n":"كابل USB-C بطول متر","b":"Anker","c":"chg","i":"charger","d":"كابل متين مجدول للشحن ونقل البيانات.","v":[["1 متر","أسود","new",150,70,60,20]]},
   {"n":"كابل آيفون Lightning","b":"Generic","c":"chg","i":"charger","d":"كابل شحن ومزامنة بطول متر.","v":[["1 متر","أبيض","new",190,90,30,10]]},
   {"n":"شاحن لاسلكي 15 وات","b":"Generic","c":"chg","i":"charger","d":"قاعدة شحن لاسلكي أنيقة تدعم أغلب الهواتف.","v":[["","أسود","new",520,340,12,4]]}
  ]';
  p jsonb; v jsonb; pid uuid; vid uuid; n int := 0;
begin
  if exists (select 1 from public.variants where sku = 'DEMO-C-001') then
    raise notice 'test catalog already exists, skipping';
    return;
  end if;

  for p in select * from jsonb_array_elements(items) loop
    insert into public.products(name, category_id, brand, description, image_url, is_published)
    values (p->>'n', (cats->>(p->>'c'))::uuid, p->>'b', (p->>'d') || ' (بيانات تجريبية)', '/demo/' || (p->>'i') || '.svg', true)
    returning id into pid;

    for v in select * from jsonb_array_elements(p->'v') loop
      n := n + 1;
      insert into public.variants(product_id, sku, color, storage, condition, price, reorder_level)
      values (pid, 'DEMO-C-' || lpad(n::text, 3, '0'), nullif(v->>1, ''), nullif(v->>0, ''), v->>2,
              (v->>3)::numeric, (v->>6)::int)
      returning id into vid;
      insert into public.variant_costs(variant_id, cost) values (vid, (v->>4)::numeric);
      if (v->>5)::int > 0 then
        insert into public.stock_movements(variant_id, branch_id, movement_type, qty, note)
        values (vid, br, 'adjustment', (v->>5)::int, 'demo');
      end if;
    end loop;
  end loop;
end $$;

select 'products' as what, count(*) from public.products
union all select 'variants', count(*) from public.variants
union all select 'stock units', coalesce(sum(qty), 0) from public.stock_movements;
