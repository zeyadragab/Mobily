-- 0039: Phase 11 of docs/VOLT-GAP-PLAN.md — the 18 reports.
-- Each report is one read-only function that returns jsonb: {"kpis":[{label,value,kind,tone}], "tables":[{title,columns:[{key,label,type}],rows:[...]}]}.
-- The screen renders every report from that shape, so a new report is one function and one line in the hub.
-- Rules: owner / manager / accountant (and not locked by has_page('/reports')); range <= 400 days; Cairo dates; rate limited.
-- Shift count differences are never in any profit figure (R03). Stock losses are shown on their own line and are NOT in the net result (F8 default).
-- Money = numeric(14,2). No dynamic SQL. Needs 0034 (has_page) and 0033.

create or replace function public.rep_guard(p_from date, p_to date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_any_role(array['owner','manager','accountant']::public.app_role[]) or not public.has_page('/reports') then
    raise exception 'not allowed';
  end if;
  perform public.enforce_rate_limit('report', 60, 60);
  if p_from is not null and (p_to is null or p_to < p_from or p_to - p_from > 400) then raise exception 'invalid range'; end if;
end $$;

create or replace function public.rep_kpi(p_label text, p_value numeric, p_kind text default 'money', p_tone text default null)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object('label', p_label, 'value', p_value, 'kind', p_kind, 'tone', p_tone) $$;

create or replace function public.rep_tbl(p_title text, p_cols jsonb, p_rows jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object('title', p_title, 'columns', p_cols, 'rows', coalesce(p_rows, '[]'::jsonb)) $$;

-- ---------- 1. comprehensive ----------
create or replace function public.report_comprehensive(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s numeric; rt numeric; c numeric; rc numeric; rep numeric; bil numeric; wal numeric; exp_ numeric; los numeric; prod numeric; net numeric;
begin
  perform public.rep_guard(p_from, p_to);
  select coalesce(sum(total),0) into s from public.sales_invoices where status = 'completed' and business_date between p_from and p_to;
  select coalesce(sum(l.qty * l.unit_cost),0) into c from public.sales_invoice_lines l join public.sales_invoices i on i.id = l.invoice_id
   where i.status = 'completed' and i.business_date between p_from and p_to;
  select coalesce(sum(refund_total + debt_reduction),0) into rt from public.sales_returns where status = 'completed' and business_date between p_from and p_to;
  select coalesce(sum(rl.qty * rl.unit_cost),0) into rc from public.sales_return_lines rl join public.sales_returns r on r.id = rl.return_id
   where r.status = 'completed' and rl.disposition = 'sellable' and r.business_date between p_from and p_to;
  prod := (s - rt) - (c - rc);
  select coalesce(sum(profit),0) into rep from public.repair_profit
   where realized and delivered_at is not null and (delivered_at at time zone 'Africa/Cairo')::date between p_from and p_to;
  select coalesce(sum(commission),0) into bil from public.bill_operations where status = 'done' and business_date between p_from and p_to;
  select coalesce(sum(commission),0) into wal from public.wallet_operations where status = 'done' and business_date between p_from and p_to;
  select coalesce(sum(amount),0) into exp_ from public.expenses where status = 'open' and expense_date between p_from and p_to;
  select coalesce(sum(d.qty * coalesce(vc.cost,0)),0) into los from public.damaged_items d left join public.variant_costs vc on vc.variant_id = d.variant_id
   where (d.created_at at time zone 'Africa/Cairo')::date between p_from and p_to;
  net := prod + rep + bil + wal - exp_;
  return jsonb_build_object(
    'kpis', jsonb_build_array(
      public.rep_kpi('صافي النتيجة', net, 'money', case when net < 0 then 'danger' else 'ok' end),
      public.rep_kpi('صافي المبيعات', s - rt), public.rep_kpi('ربح المنتجات', prod),
      public.rep_kpi('ربح الصيانة (المسلّمة)', rep), public.rep_kpi('عمولات الفواتير والمحافظ', bil + wal),
      public.rep_kpi('المصروفات', exp_, 'money', 'warn')),
    'tables', jsonb_build_array(public.rep_tbl('تفاصيل الحساب',
      '[{"key":"item","label":"البند","type":"text"},{"key":"amount","label":"المبلغ","type":"money"}]'::jsonb,
      jsonb_build_array(
        jsonb_build_object('item','مبيعات (إجمالي)','amount',s), jsonb_build_object('item','مرتجعات','amount',-rt),
        jsonb_build_object('item','تكلفة البضاعة المباعة (بعد المرتجع السليم)','amount',-(c - rc)),
        jsonb_build_object('item','ربح المنتجات','amount',prod), jsonb_build_object('item','ربح الصيانة','amount',rep),
        jsonb_build_object('item','عمولات الفواتير','amount',bil), jsonb_build_object('item','عمولات المحافظ والماكينات','amount',wal),
        jsonb_build_object('item','المصروفات','amount',-exp_), jsonb_build_object('item','صافي النتيجة','amount',net),
        jsonb_build_object('item','خسائر مخزون (تالف) بالتكلفة - غير محسوبة في الصافي','amount',-los)))));
end $$;

-- ---------- 2. sales ----------
create or replace function public.report_sales(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int; tot numeric; dis numeric; cr numeric; prof numeric;
begin
  perform public.rep_guard(p_from, p_to);
  select count(*), coalesce(sum(i.total),0), coalesce(sum(i.discount + i.offer_discount),0), coalesce(sum(ps.credit),0), coalesce(sum(ps.profit),0)
    into n, tot, dis, cr, prof
    from public.sales_invoices i join public.sale_profit_split ps on ps.invoice_id = i.id
   where i.status = 'completed' and i.business_date between p_from and p_to;
  return jsonb_build_object(
    'kpis', jsonb_build_array(public.rep_kpi('عدد الفواتير', n, 'int'), public.rep_kpi('إجمالي المبيعات', tot), public.rep_kpi('محصّل', tot - cr),
      public.rep_kpi('آجل', cr, 'money', case when cr > 0 then 'warn' end), public.rep_kpi('الخصومات', dis), public.rep_kpi('الربح (دفتري)', prof),
      public.rep_kpi('متوسط الفاتورة', case when n = 0 then 0 else round(tot / n, 2) end)),
    'tables', jsonb_build_array(
      public.rep_tbl('حسب اليوم',
        '[{"key":"day","label":"اليوم","type":"date"},{"key":"invoices","label":"الفواتير","type":"int"},{"key":"total","label":"الإجمالي","type":"money"},{"key":"credit","label":"آجل","type":"money"},{"key":"profit","label":"الربح","type":"money"}]'::jsonb,
        (select jsonb_agg(to_jsonb(t) order by t.day) from (
           select i.business_date as day, count(*)::int as invoices, sum(i.total) as total, sum(ps.credit) as credit, sum(ps.profit) as profit
             from public.sales_invoices i join public.sale_profit_split ps on ps.invoice_id = i.id
            where i.status = 'completed' and i.business_date between p_from and p_to group by i.business_date) t)),
      public.rep_tbl('حسب طريقة الدفع',
        '[{"key":"method","label":"الطريقة","type":"text"},{"key":"amount","label":"المبلغ","type":"money"}]'::jsonb,
        (select jsonb_agg(to_jsonb(t) order by t.amount desc) from (
           select case p.method when 'cash' then 'نقدي' when 'card' then 'فيزا' when 'transfer' then 'تحويل' when 'wallet' then 'محفظة' when 'credit' then 'آجل' else p.method end as method,
                  sum(p.amount) as amount
             from public.sales_payments p join public.sales_invoices i on i.id = p.invoice_id
            where i.status = 'completed' and i.business_date between p_from and p_to group by p.method) t)),
      public.rep_tbl('أكثر المنتجات (أعلى 25 بالإيراد)',
        '[{"key":"name","label":"المنتج","type":"text"},{"key":"qty","label":"الكمية","type":"int"},{"key":"revenue","label":"الإيراد","type":"money"},{"key":"profit","label":"الربح","type":"money"}]'::jsonb,
        (select jsonb_agg(to_jsonb(t) order by t.revenue desc) from (
           select l.name_snapshot as name, sum(l.qty)::int as qty, sum(l.qty * l.unit_price) as revenue, sum(l.qty * (l.unit_price - l.unit_cost)) as profit
             from public.sales_invoice_lines l join public.sales_invoices i on i.id = l.invoice_id
            where i.status = 'completed' and i.business_date between p_from and p_to
            group by l.name_snapshot order by sum(l.qty * l.unit_price) desc limit 25) t)),
      public.rep_tbl('حسب الموظف',
        '[{"key":"who","label":"الموظف","type":"text"},{"key":"invoices","label":"الفواتير","type":"int"},{"key":"total","label":"الإجمالي","type":"money"}]'::jsonb,
        (select jsonb_agg(to_jsonb(t) order by t.total desc) from (
           select coalesce(p.full_name, 'غير معروف') as who, count(*)::int as invoices, sum(i.total) as total
             from public.sales_invoices i left join public.profiles p on p.id = i.created_by
            where i.status = 'completed' and i.business_date between p_from and p_to group by p.full_name) t))));
end $$;

-- ---------- 3. returns ----------
create or replace function public.report_returns(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int; tot numeric; lost numeric;
begin
  perform public.rep_guard(p_from, p_to);
  select count(*), coalesce(sum(refund_total + debt_reduction),0) into n, tot from public.sales_returns where status = 'completed' and business_date between p_from and p_to;
  select coalesce(sum(rl.qty * (rl.unit_price - rl.unit_cost)),0) into lost from public.sales_return_lines rl join public.sales_returns r on r.id = rl.return_id
   where r.status = 'completed' and r.business_date between p_from and p_to;
  return jsonb_build_object(
    'kpis', jsonb_build_array(public.rep_kpi('عدد المرتجعات', n, 'int'), public.rep_kpi('قيمة المرتجعات', tot), public.rep_kpi('ربح ضائع', lost, 'money', case when lost > 0 then 'warn' end)),
    'tables', jsonb_build_array(
      public.rep_tbl('المرتجعات',
        '[{"key":"day","label":"التاريخ","type":"date"},{"key":"no","label":"الرقم","type":"text"},{"key":"invoice","label":"الفاتورة","type":"text"},{"key":"amount","label":"القيمة","type":"money"},{"key":"reason","label":"السبب","type":"text"}]'::jsonb,
        (select jsonb_agg(to_jsonb(t) order by t.day desc, t.no desc) from (
           select r.business_date as day, r.return_number::text as no, i.invoice_number::text as invoice, r.refund_total + r.debt_reduction as amount, r.reason
             from public.sales_returns r join public.sales_invoices i on i.id = r.invoice_id
            where r.status = 'completed' and r.business_date between p_from and p_to limit 1000) t)),
      public.rep_tbl('حسب حالة المرتجع',
        '[{"key":"cond","label":"الحالة","type":"text"},{"key":"qty","label":"الكمية","type":"int"},{"key":"value","label":"القيمة","type":"money"}]'::jsonb,
        (select jsonb_agg(to_jsonb(t)) from (
           select case rl.condition when 'new' then 'جديد' when 'used' then 'مستعمل' when 'damaged' then 'تالف' else coalesce(rl.condition,'—') end as cond,
                  sum(rl.qty)::int as qty, sum(rl.qty * rl.unit_price) as value
             from public.sales_return_lines rl join public.sales_returns r on r.id = rl.return_id
            where r.status = 'completed' and r.business_date between p_from and p_to group by rl.condition) t))));
end $$;

-- ---------- 4. stock valuation ----------
create or replace function public.report_stock_valuation() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c numeric; r numeric; n int; miss int;
begin
  perform public.rep_guard(null, null);
  select coalesce(sum(x.q * coalesce(vc.cost,0)),0), coalesce(sum(x.q * v.price),0), count(*), count(*) filter (where vc.cost is null or vc.cost = 0)
    into c, r, n, miss
    from (select variant_id, sum(on_hand) as q from public.stock_levels group by variant_id having sum(on_hand) > 0) x
    join public.variants v on v.id = x.variant_id left join public.variant_costs vc on vc.variant_id = x.variant_id;
  return jsonb_build_object(
    'kpis', jsonb_build_array(public.rep_kpi('أصناف في المخزن', n, 'int'), public.rep_kpi('قيمة المخزون بالتكلفة', c), public.rep_kpi('قيمة البيع المتوقعة', r),
      public.rep_kpi('الربح المتوقع', r - c, 'money', 'ok'), public.rep_kpi('أصناف بدون تكلفة', miss, 'int', case when miss > 0 then 'danger' end)),
    'tables', jsonb_build_array(public.rep_tbl('الأصناف',
      '[{"key":"name","label":"المنتج","type":"text"},{"key":"sku","label":"الكود","type":"text"},{"key":"qty","label":"الكمية","type":"int"},{"key":"cost","label":"التكلفة","type":"money"},{"key":"price","label":"سعر البيع","type":"money"},{"key":"value_cost","label":"قيمة التكلفة","type":"money"},{"key":"profit","label":"ربح متوقع","type":"money"}]'::jsonb,
      (select jsonb_agg(to_jsonb(t) order by t.value_cost desc) from (
         select p.name, v.sku, x.q::int as qty, coalesce(vc.cost,0) as cost, v.price, x.q * coalesce(vc.cost,0) as value_cost, x.q * (v.price - coalesce(vc.cost,0)) as profit
           from (select variant_id, sum(on_hand) as q from public.stock_levels group by variant_id having sum(on_hand) > 0) x
           join public.variants v on v.id = x.variant_id join public.products p on p.id = v.product_id left join public.variant_costs vc on vc.variant_id = x.variant_id
          order by x.q * coalesce(vc.cost,0) desc limit 2000) t))));
end $$;

-- ---------- 5. product movement ----------
create or replace function public.report_product_movement(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.rep_guard(p_from, p_to);
  return jsonb_build_object('kpis', '[]'::jsonb, 'tables', jsonb_build_array(public.rep_tbl('حركة المنتجات (الموجب دخول والسالب خروج)',
    '[{"key":"name","label":"المنتج","type":"text"},{"key":"sku","label":"الكود","type":"text"},{"key":"purchase","label":"توريد","type":"int"},{"key":"sale","label":"مبيعات","type":"int"},{"key":"ret","label":"مرتجع","type":"int"},{"key":"count_adj","label":"جرد وتسوية","type":"int"},{"key":"transfer","label":"تحويل","type":"int"},{"key":"net","label":"الصافي","type":"int"}]'::jsonb,
    (select jsonb_agg(to_jsonb(t) order by abs(t.net) desc, t.name) from (
       select p.name, v.sku,
              coalesce(sum(m.qty) filter (where m.movement_type = 'purchase_receipt'),0)::int as purchase,
              coalesce(sum(m.qty) filter (where m.movement_type = 'sale'),0)::int as sale,
              coalesce(sum(m.qty) filter (where m.movement_type = 'return'),0)::int as ret,
              coalesce(sum(m.qty) filter (where m.movement_type in ('adjustment','count_adjustment')),0)::int as count_adj,
              coalesce(sum(m.qty) filter (where m.movement_type in ('transfer_in','transfer_out')),0)::int as transfer,
              sum(m.qty)::int as net
         from public.stock_movements m join public.variants v on v.id = m.variant_id join public.products p on p.id = v.product_id
        where (m.created_at at time zone 'Africa/Cairo')::date between p_from and p_to
        group by p.name, v.sku order by abs(sum(m.qty)) desc limit 1500) t))));
end $$;

-- ---------- 6. expenses ----------
create or replace function public.report_expenses(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tot numeric; paid numeric;
begin
  perform public.rep_guard(p_from, p_to);
  select coalesce(sum(e.amount),0), coalesce(sum(pp.paid),0) into tot, paid from public.expenses e
    left join (select expense_id, sum(amount) as paid from public.expense_payments group by expense_id) pp on pp.expense_id = e.id
   where e.status = 'open' and e.expense_date between p_from and p_to;
  return jsonb_build_object(
    'kpis', jsonb_build_array(public.rep_kpi('إجمالي المصروفات', tot), public.rep_kpi('مدفوع', paid), public.rep_kpi('مستحق', tot - paid, 'money', case when tot - paid > 0 then 'warn' end)),
    'tables', jsonb_build_array(
      public.rep_tbl('حسب البند',
        '[{"key":"cat","label":"البند","type":"text"},{"key":"count","label":"العدد","type":"int"},{"key":"amount","label":"المبلغ","type":"money"},{"key":"paid","label":"مدفوع","type":"money"}]'::jsonb,
        (select jsonb_agg(to_jsonb(t) order by t.amount desc) from (
           select coalesce(c.name,'بدون بند') as cat, count(*)::int as count, sum(e.amount) as amount, sum(coalesce(pp.paid,0)) as paid
             from public.expenses e left join public.expense_categories c on c.id = e.category_id
             left join (select expense_id, sum(amount) as paid from public.expense_payments group by expense_id) pp on pp.expense_id = e.id
            where e.status = 'open' and e.expense_date between p_from and p_to group by c.name) t)),
      public.rep_tbl('المصروفات',
        '[{"key":"day","label":"التاريخ","type":"date"},{"key":"description","label":"البيان","type":"text"},{"key":"beneficiary","label":"المستفيد","type":"text"},{"key":"amount","label":"المبلغ","type":"money"}]'::jsonb,
        (select jsonb_agg(to_jsonb(t) order by t.day desc) from (
           select e.expense_date as day, e.description, e.beneficiary, e.amount from public.expenses e
            where e.status = 'open' and e.expense_date between p_from and p_to limit 1000) t))));
end $$;

-- ---------- 7. customer debts ----------
create or replace function public.report_customer_debts() returns jsonb
language plpgsql security definer set search_path = public as $$
declare tot numeric; n int;
begin
  perform public.rep_guard(null, null);
  select coalesce(sum(b),0), count(*) into tot, n from (select sum(amount) as b from public.customer_ledger group by customer_id having sum(amount) > 0) x;
  return jsonb_build_object(
    'kpis', jsonb_build_array(public.rep_kpi('عملاء عليهم ديون', n, 'int'), public.rep_kpi('إجمالي الديون', tot, 'money', case when tot > 0 then 'warn' end),
      public.rep_kpi('ديون المنتجات', coalesce((select sum(balance) from public.customer_source_balances where source = 'products' and balance > 0),0)),
      public.rep_kpi('ديون الصيانة', coalesce((select sum(balance) from public.customer_source_balances where source = 'maintenance' and balance > 0),0)),
      public.rep_kpi('ديون الأقساط', coalesce((select sum(balance) from public.customer_source_balances where source = 'installments' and balance > 0),0))),
    'tables', jsonb_build_array(public.rep_tbl('العملاء المدينون',
      '[{"key":"name","label":"العميل","type":"text"},{"key":"phone","label":"الموبايل","type":"text"},{"key":"products","label":"منتجات","type":"money"},{"key":"maintenance","label":"صيانة","type":"money"},{"key":"installments","label":"أقساط","type":"money"},{"key":"other","label":"أخرى","type":"money"},{"key":"total","label":"الإجمالي","type":"money"}]'::jsonb,
      (select jsonb_agg(to_jsonb(t) order by t.total desc) from (
         select c.name, c.phone,
                coalesce(sum(b.balance) filter (where b.source = 'products'),0) as products,
                coalesce(sum(b.balance) filter (where b.source = 'maintenance'),0) as maintenance,
                coalesce(sum(b.balance) filter (where b.source = 'installments'),0) as installments,
                coalesce(sum(b.balance) filter (where b.source in ('wallets','bills','other')),0) as other,
                sum(b.balance) as total
           from public.customer_source_balances b join public.customers c on c.id = b.customer_id
          group by c.id, c.name, c.phone having sum(b.balance) > 0 order by sum(b.balance) desc limit 1000) t))));
end $$;

-- ---------- 8. suppliers ----------
create or replace function public.report_suppliers(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tot numeric; od numeric;
begin
  perform public.rep_guard(p_from, p_to);
  select coalesce(sum(balance) filter (where balance > 0),0), coalesce(sum(overdue),0) into tot, od from public.supplier_balances;
  return jsonb_build_object(
    'kpis', jsonb_build_array(public.rep_kpi('مستحق للموردين الآن', tot, 'money', case when tot > 0 then 'warn' end), public.rep_kpi('متأخر السداد', od, 'money', case when od > 0 then 'danger' end),
      public.rep_kpi('توريدات الفترة', coalesce((select sum(amount) from public.supplier_invoices where status = 'open' and invoice_date between p_from and p_to),0)),
      public.rep_kpi('مدفوع في الفترة', coalesce((select sum(amount) from public.supplier_payments where status = 'completed' and (paid_at at time zone 'Africa/Cairo')::date between p_from and p_to),0))),
    'tables', jsonb_build_array(public.rep_tbl('حسب المورد',
      '[{"key":"name","label":"المورد","type":"text"},{"key":"invoiced","label":"توريدات الفترة","type":"money"},{"key":"paid","label":"مدفوع في الفترة","type":"money"},{"key":"balance","label":"الرصيد الحالي","type":"money"},{"key":"overdue","label":"متأخر","type":"money"}]'::jsonb,
      (select jsonb_agg(to_jsonb(t) order by t.balance desc) from (
         select b.name,
                coalesce((select sum(i.amount) from public.supplier_invoices i where i.supplier_id = b.supplier_id and i.status = 'open' and i.invoice_date between p_from and p_to),0) as invoiced,
                coalesce((select sum(p.amount) from public.supplier_payments p where p.supplier_id = b.supplier_id and p.status = 'completed' and (p.paid_at at time zone 'Africa/Cairo')::date between p_from and p_to),0) as paid,
                b.balance, b.overdue
           from public.supplier_balances b) t))));
end $$;

-- ---------- 9. peak hours and days (week starts Saturday) ----------
create or replace function public.report_peak(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.rep_guard(p_from, p_to);
  return jsonb_build_object('kpis', '[]'::jsonb, 'tables', jsonb_build_array(
    public.rep_tbl('حسب اليوم من الأسبوع',
      '[{"key":"day","label":"اليوم","type":"text"},{"key":"invoices","label":"الفواتير","type":"int"},{"key":"total","label":"الإجمالي","type":"money"}]'::jsonb,
      (select jsonb_agg(jsonb_build_object('day', d.name, 'invoices', coalesce(x.n,0), 'total', coalesce(x.t,0)) order by d.pos)
         from (values (0,'السبت',6),(1,'الأحد',0),(2,'الاثنين',1),(3,'الثلاثاء',2),(4,'الأربعاء',3),(5,'الخميس',4),(6,'الجمعة',5)) as d(pos, name, dow)
         left join (select extract(dow from i.business_date)::int as dow, count(*)::int as n, sum(i.total) as t from public.sales_invoices i
                     where i.status = 'completed' and i.business_date between p_from and p_to group by 1) x on x.dow = d.dow)),
    public.rep_tbl('حسب الساعة (بتوقيت القاهرة)',
      '[{"key":"hour","label":"الساعة","type":"text"},{"key":"invoices","label":"الفواتير","type":"int"},{"key":"total","label":"الإجمالي","type":"money"}]'::jsonb,
      (select jsonb_agg(jsonb_build_object('hour', lpad(h::text, 2, '0') || ':00', 'invoices', coalesce(x.n,0), 'total', coalesce(x.t,0)) order by h)
         from generate_series(0, 23) h
         left join (select extract(hour from i.created_at at time zone 'Africa/Cairo')::int as hr, count(*)::int as n, sum(i.total) as t from public.sales_invoices i
                     where i.status = 'completed' and i.business_date between p_from and p_to group by 1) x on x.hr = h))));
end $$;

-- ---------- 10. time trends (daily up to 92 days, monthly above) ----------
create or replace function public.report_trends(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare monthly boolean;
begin
  perform public.rep_guard(p_from, p_to);
  monthly := p_to - p_from > 92;
  return jsonb_build_object('kpis', '[]'::jsonb, 'tables', jsonb_build_array(public.rep_tbl(case when monthly then 'اتجاه شهري' else 'اتجاه يومي' end,
    '[{"key":"period","label":"الفترة","type":"text"},{"key":"invoices","label":"الفواتير","type":"int"},{"key":"sales","label":"المبيعات","type":"money"},{"key":"profit","label":"ربح المنتجات","type":"money"},{"key":"expenses","label":"المصروفات","type":"money"}]'::jsonb,
    (select jsonb_agg(to_jsonb(t) order by t.period) from (
       select to_char(g.d, case when monthly then 'YYYY-MM' else 'YYYY-MM-DD' end) as period,
              sum(coalesce(s.n,0))::int as invoices, sum(coalesce(s.t,0)) as sales, sum(coalesce(s.p,0)) as profit, sum(coalesce(e.a,0)) as expenses
         from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g(d)
         left join (select i.business_date as d, count(*) as n, sum(i.total) as t, sum(ps.profit) as p from public.sales_invoices i
                      join public.sale_profit_split ps on ps.invoice_id = i.id where i.status = 'completed' and i.business_date between p_from and p_to group by 1) s on s.d = g.d::date
         left join (select expense_date as d, sum(amount) as a from public.expenses where status = 'open' and expense_date between p_from and p_to group by 1) e on e.d = g.d::date
        group by 1) t))));
end $$;

-- ---------- 11. total capital ----------
create or replace function public.report_capital() returns jsonb
language plpgsql security definer set search_path = public as $$
declare dr numeric; ac numeric; st numeric; cd numeric; sd numeric; el numeric; tot numeric;
begin
  perform public.rep_guard(null, null);
  select coalesce(sum(m.amount),0) into dr from public.drawer_movements m;
  select coalesce(sum(amount),0) into ac from public.account_movements;
  select coalesce(sum(x.q * coalesce(vc.cost,0)),0) into st from (select variant_id, sum(on_hand) as q from public.stock_levels group by variant_id having sum(on_hand) > 0) x
    left join public.variant_costs vc on vc.variant_id = x.variant_id;
  select coalesce(sum(b),0) into cd from (select sum(amount) as b from public.customer_ledger group by customer_id having sum(amount) > 0) y;
  select coalesce(sum(balance) filter (where balance > 0),0) into sd from public.supplier_balances;
  select coalesce(sum(balance) filter (where balance > 0),0) into el from public.employee_balances;
  tot := dr + ac + st + cd - sd - el;
  return jsonb_build_object(
    'kpis', jsonb_build_array(public.rep_kpi('إجمالي رأس المال', tot, 'money', 'ok'), public.rep_kpi('نقدية وأدراج', dr), public.rep_kpi('محافظ وماكينات', ac),
      public.rep_kpi('مخزون بالتكلفة', st), public.rep_kpi('ديون لنا', cd), public.rep_kpi('ديون علينا', sd + el, 'money', 'warn')),
    'tables', jsonb_build_array(public.rep_tbl('المكوّنات',
      '[{"key":"item","label":"البند","type":"text"},{"key":"amount","label":"المبلغ","type":"money"}]'::jsonb,
      jsonb_build_array(jsonb_build_object('item','أدراج النقدية','amount',dr), jsonb_build_object('item','المحافظ والماكينات','amount',ac),
        jsonb_build_object('item','المخزون بالتكلفة','amount',st), jsonb_build_object('item','ديون العملاء','amount',cd),
        jsonb_build_object('item','مستحق للموردين','amount',-sd), jsonb_build_object('item','مستحق للموظفين','amount',-el),
        jsonb_build_object('item','الإجمالي','amount',tot)))));
end $$;

-- ---------- 12. trade-in ----------
create or replace function public.report_tradein(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.rep_guard(p_from, p_to);
  return jsonb_build_object(
    'kpis', jsonb_build_array(
      public.rep_kpi('أجهزة مشتراة', (select count(*) from public.trade_ins where status = 'active' and business_date between p_from and p_to), 'int'),
      public.rep_kpi('إجمالي المدفوع', coalesce((select sum(price) from public.trade_ins where status = 'active' and business_date between p_from and p_to),0)),
      public.rep_kpi('ملغي', (select count(*) from public.trade_ins where status = 'cancelled' and business_date between p_from and p_to), 'int')),
    'tables', jsonb_build_array(public.rep_tbl('عمليات الشراء',
      '[{"key":"day","label":"التاريخ","type":"date"},{"key":"no","label":"الرقم","type":"text"},{"key":"serial","label":"السيريال","type":"text"},{"key":"price","label":"السعر","type":"money"},{"key":"pay","label":"الدفع","type":"text"},{"key":"status","label":"الحالة","type":"text"}]'::jsonb,
      (select jsonb_agg(to_jsonb(t) order by t.day desc) from (
         select business_date as day, trade_no::text as no, serial, price, pay, case status when 'active' then 'نشط' else 'ملغي' end as status
           from public.trade_ins where business_date between p_from and p_to limit 1000) t))));
end $$;

-- ---------- 13. employee accounts ----------
create or replace function public.report_employees(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.rep_guard(p_from, p_to);
  return jsonb_build_object(
    'kpis', jsonb_build_array(
      public.rep_kpi('مستحق للموظفين', coalesce((select sum(balance) from public.employee_balances where balance > 0),0), 'money', 'warn'),
      public.rep_kpi('سلف على الموظفين', coalesce((select -sum(balance) from public.employee_balances where balance < 0),0)),
      public.rep_kpi('رواتب مصروفة في الفترة', coalesce((select -sum(amount) from public.employee_ledger where kind = 'pay' and (created_at at time zone 'Africa/Cairo')::date between p_from and p_to),0))),
    'tables', jsonb_build_array(public.rep_tbl('حسب الموظف',
      '[{"key":"name","label":"الموظف","type":"text"},{"key":"accrued","label":"استحقاق الفترة","type":"money"},{"key":"paid","label":"صرف","type":"money"},{"key":"advance","label":"سلف","type":"money"},{"key":"bonus","label":"مكافآت","type":"money"},{"key":"deduction","label":"خصومات","type":"money"},{"key":"balance","label":"الرصيد الحالي","type":"money"}]'::jsonb,
      (select jsonb_agg(to_jsonb(t) order by t.name) from (
         select b.name,
                coalesce(sum(l.amount) filter (where l.kind = 'accrual'),0) as accrued,
                coalesce(-sum(l.amount) filter (where l.kind = 'pay'),0) as paid,
                coalesce(-sum(l.amount) filter (where l.kind = 'advance'),0) as advance,
                coalesce(sum(l.amount) filter (where l.kind = 'bonus'),0) as bonus,
                coalesce(-sum(l.amount) filter (where l.kind = 'deduction'),0) as deduction,
                b.balance
           from public.employee_balances b
           left join public.employee_ledger l on l.employee_id = b.id and (l.created_at at time zone 'Africa/Cairo')::date between p_from and p_to
          group by b.id, b.name, b.balance) t))));
end $$;

-- ---------- 14. in / out ----------
create or replace function public.report_inout(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.rep_guard(p_from, p_to);
  return jsonb_build_object(
    'kpis', jsonb_build_array(
      public.rep_kpi('داخل في الفترة', coalesce((select sum(amount) from public.inout_entries where status = 'active' and direction = 'in' and business_date between p_from and p_to),0)),
      public.rep_kpi('خارج في الفترة', coalesce((select sum(amount) from public.inout_entries where status = 'active' and direction = 'out' and business_date between p_from and p_to),0)),
      public.rep_kpi('أمانات عندنا الآن', coalesce((select sum(net) from public.inout_balances where net > 0),0), 'money', 'warn')),
    'tables', jsonb_build_array(public.rep_tbl('أرصدة العملاء',
      '[{"key":"name","label":"العميل","type":"text"},{"key":"phone","label":"الموبايل","type":"text"},{"key":"total_in","label":"داخل","type":"money"},{"key":"total_out","label":"خارج","type":"money"},{"key":"net","label":"الصافي","type":"money"}]'::jsonb,
      (select jsonb_agg(to_jsonb(t) order by abs(t.net) desc) from (
         select customer_name as name, customer_phone as phone, total_in, total_out, net from public.inout_balances limit 1000) t))));
end $$;

-- ---------- 15. installments and collection ----------
create or replace function public.report_installments(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.rep_guard(p_from, p_to);
  return jsonb_build_object(
    'kpis', jsonb_build_array(
      public.rep_kpi('أقساط مستحقة في الفترة', coalesce((select sum(amount) from public.installments_due where due_date between p_from and p_to and status <> 'cancelled'),0)),
      public.rep_kpi('محصّل في الفترة', coalesce((select sum(amount) from public.installment_collections where status = 'active' and business_date between p_from and p_to),0), 'money', 'ok'),
      public.rep_kpi('متأخر الآن', coalesce((select sum(remaining) from public.installments_due where overdue),0), 'money', 'danger')),
    'tables', jsonb_build_array(
      public.rep_tbl('الأقساط المستحقة في الفترة',
        '[{"key":"due","label":"الميعاد","type":"date"},{"key":"customer","label":"العميل","type":"text"},{"key":"plan","label":"الخطة","type":"text"},{"key":"amount","label":"القسط","type":"money"},{"key":"paid","label":"مدفوع","type":"money"},{"key":"remaining","label":"المتبقي","type":"money"},{"key":"late","label":"أيام التأخير","type":"int"}]'::jsonb,
        (select jsonb_agg(to_jsonb(t) order by t.due) from (
           select due_date as due, customer_name as customer, plan_no::text as plan, amount, paid, remaining, case when overdue then days_late else 0 end as late
             from public.installments_due where due_date between p_from and p_to and status <> 'cancelled' limit 1000) t)),
      public.rep_tbl('التحصيل حسب الطريقة',
        '[{"key":"method","label":"الطريقة","type":"text"},{"key":"amount","label":"المبلغ","type":"money"}]'::jsonb,
        (select jsonb_agg(to_jsonb(t)) from (select method, sum(amount) as amount from public.installment_collections
           where status = 'active' and business_date between p_from and p_to group by method) t))));
end $$;

-- ---------- 16. send and receive ----------
create or replace function public.report_wallet_ops(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.rep_guard(p_from, p_to);
  return jsonb_build_object(
    'kpis', jsonb_build_array(
      public.rep_kpi('عمليات منفذة', (select count(*) from public.wallet_operations where status = 'done' and business_date between p_from and p_to), 'int'),
      public.rep_kpi('إجمالي المبالغ', coalesce((select sum(amount) from public.wallet_operations where status = 'done' and business_date between p_from and p_to),0)),
      public.rep_kpi('العمولات', coalesce((select sum(commission) from public.wallet_operations where status = 'done' and business_date between p_from and p_to),0), 'money', 'ok'),
      public.rep_kpi('معلّقة (آجل)', (select count(*) from public.wallet_operations where status = 'pending'), 'int', 'warn')),
    'tables', jsonb_build_array(public.rep_tbl('حسب النوع',
      '[{"key":"mode","label":"النوع","type":"text"},{"key":"count","label":"العدد","type":"int"},{"key":"amount","label":"المبلغ","type":"money"},{"key":"commission","label":"العمولة","type":"money"}]'::jsonb,
      (select jsonb_agg(to_jsonb(t)) from (
         select case mode when 'send' then 'إرسال' when 'receive' then 'استقبال' when 'send_credit' then 'إرسال آجل' else 'استقبال آجل' end as mode,
                count(*)::int as count, sum(amount) as amount, sum(commission) as commission
           from public.wallet_operations where status = 'done' and business_date between p_from and p_to group by mode) t))));
end $$;

-- ---------- 17. bills and services ----------
create or replace function public.report_bills(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.rep_guard(p_from, p_to);
  return jsonb_build_object(
    'kpis', jsonb_build_array(
      public.rep_kpi('عمليات منفذة', (select count(*) from public.bill_operations where status = 'done' and business_date between p_from and p_to), 'int'),
      public.rep_kpi('إجمالي المبالغ', coalesce((select sum(amount) from public.bill_operations where status = 'done' and business_date between p_from and p_to),0)),
      public.rep_kpi('العمولات', coalesce((select sum(commission) from public.bill_operations where status = 'done' and business_date between p_from and p_to),0), 'money', 'ok')),
    'tables', jsonb_build_array(public.rep_tbl('حسب الخدمة',
      '[{"key":"service","label":"الخدمة","type":"text"},{"key":"count","label":"العدد","type":"int"},{"key":"amount","label":"المبلغ","type":"money"},{"key":"commission","label":"العمولة","type":"money"}]'::jsonb,
      (select jsonb_agg(to_jsonb(t) order by t.amount desc) from (
         select service_name as service, count(*)::int as count, sum(amount) as amount, sum(commission) as commission
           from public.bill_operations where status = 'done' and business_date between p_from and p_to group by service_name) t))));
end $$;

-- ---------- 18. maintenance ----------
create or replace function public.report_maintenance(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int; q numeric; pc numeric; pr numeric;
begin
  perform public.rep_guard(p_from, p_to);
  select count(*), coalesce(sum(quote_total),0), coalesce(sum(parts_cost),0), coalesce(sum(profit),0) into n, q, pc, pr from public.repair_profit
   where realized and delivered_at is not null and (delivered_at at time zone 'Africa/Cairo')::date between p_from and p_to;
  return jsonb_build_object(
    'kpis', jsonb_build_array(public.rep_kpi('طلبات مسلّمة', n, 'int'), public.rep_kpi('إيراد الصيانة', q), public.rep_kpi('تكلفة القطع', pc), public.rep_kpi('الربح', pr, 'money', 'ok'),
      public.rep_kpi('طلبات مفتوحة الآن', (select count(*) from public.repair_orders where status not in ('delivered','cancelled','unrepairable')), 'int'),
      public.rep_kpi('دين صيانة على العملاء', coalesce((select sum(balance) from public.customer_source_balances where source = 'maintenance' and balance > 0),0), 'money', 'warn')),
    'tables', jsonb_build_array(public.rep_tbl('الطلبات المسلّمة',
      '[{"key":"day","label":"التسليم","type":"date"},{"key":"no","label":"الطلب","type":"text"},{"key":"quote","label":"الإجمالي","type":"money"},{"key":"parts","label":"تكلفة القطع","type":"money"},{"key":"profit","label":"الربح","type":"money"}]'::jsonb,
      (select jsonb_agg(to_jsonb(t) order by t.day desc) from (
         select (delivered_at at time zone 'Africa/Cairo')::date as day, 'RP-' || order_number::text as no, quote_total as quote, parts_cost as parts, profit
           from public.repair_profit where realized and delivered_at is not null and (delivered_at at time zone 'Africa/Cairo')::date between p_from and p_to limit 1000) t))));
end $$;

-- ---------- grants ----------
revoke all on function public.rep_guard(date, date) from public, anon, authenticated;
revoke all on function public.rep_kpi(text, numeric, text, text) from public, anon, authenticated;
revoke all on function public.rep_tbl(text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.report_comprehensive(date, date) from public, anon;
revoke all on function public.report_sales(date, date) from public, anon;
revoke all on function public.report_returns(date, date) from public, anon;
revoke all on function public.report_stock_valuation() from public, anon;
revoke all on function public.report_product_movement(date, date) from public, anon;
revoke all on function public.report_expenses(date, date) from public, anon;
revoke all on function public.report_customer_debts() from public, anon;
revoke all on function public.report_suppliers(date, date) from public, anon;
revoke all on function public.report_peak(date, date) from public, anon;
revoke all on function public.report_trends(date, date) from public, anon;
revoke all on function public.report_capital() from public, anon;
revoke all on function public.report_tradein(date, date) from public, anon;
revoke all on function public.report_employees(date, date) from public, anon;
revoke all on function public.report_inout(date, date) from public, anon;
revoke all on function public.report_installments(date, date) from public, anon;
revoke all on function public.report_wallet_ops(date, date) from public, anon;
revoke all on function public.report_bills(date, date) from public, anon;
revoke all on function public.report_maintenance(date, date) from public, anon;
grant execute on function public.report_comprehensive(date, date) to authenticated;
grant execute on function public.report_sales(date, date) to authenticated;
grant execute on function public.report_returns(date, date) to authenticated;
grant execute on function public.report_stock_valuation() to authenticated;
grant execute on function public.report_product_movement(date, date) to authenticated;
grant execute on function public.report_expenses(date, date) to authenticated;
grant execute on function public.report_customer_debts() to authenticated;
grant execute on function public.report_suppliers(date, date) to authenticated;
grant execute on function public.report_peak(date, date) to authenticated;
grant execute on function public.report_trends(date, date) to authenticated;
grant execute on function public.report_capital() to authenticated;
grant execute on function public.report_tradein(date, date) to authenticated;
grant execute on function public.report_employees(date, date) to authenticated;
grant execute on function public.report_inout(date, date) to authenticated;
grant execute on function public.report_installments(date, date) to authenticated;
grant execute on function public.report_wallet_ops(date, date) to authenticated;
grant execute on function public.report_bills(date, date) to authenticated;
grant execute on function public.report_maintenance(date, date) to authenticated;
