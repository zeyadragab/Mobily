-- 0037: Phase 13 of docs/VOLT-GAP-PLAN.md — store settings (printing, module switches) and WhatsApp campaigns.
--   * One settings row (jsonb) readable by staff, saved by owner / manager through a function that checks the keys.
--   * Customers can opt out of marketing; a campaign never includes them.
--   * A campaign is a saved message and a snapshot of recipients. Staff open each chat from the app (wa.me link);
--     nothing is sent by the server. A daily cap limits how many chats are opened per day.
-- RLS on every table. Needs 0022.

create table public.store_settings (
  id boolean primary key default true check (id),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.store_settings(id, data) values (true, jsonb_build_object(
  'store_name', '', 'phone', '', 'address', '', 'tax_number', '',
  'paper', '80mm', 'label', '50x28', 'show_logo', false, 'show_previous_balance', true,
  'footer_sale', 'شكرًا لتعاملكم معنا. الاستبدال والاسترجاع خلال 14 يومًا بالفاتورة.',
  'footer_return', '', 'footer_repair', 'المحل غير مسؤول عن الأجهزة بعد 30 يومًا من إبلاغ العميل.',
  'footer_installment', '', 'footer_wallet', '', 'footer_bill', '', 'footer_tradein', '',
  'modules', jsonb_build_object('wallets', true, 'bills', true, 'maintenance', true, 'installments', true,
                                'tradein', true, 'inout', true, 'online', true)
)) on conflict (id) do nothing;
alter table public.store_settings enable row level security;
create policy store_settings_read on public.store_settings for select to authenticated using (public.is_staff());
create trigger audit_store_settings after insert or update or delete on public.store_settings
  for each row execute function public.audit_row();

create or replace function public.save_store_settings(p_data jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_k text; v_out jsonb;
        v_text text[] := array['store_name','phone','address','tax_number','footer_sale','footer_return','footer_repair',
                               'footer_installment','footer_wallet','footer_bill','footer_tradein'];
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('save_settings', 20, 60);
  if jsonb_typeof(p_data) is distinct from 'object' or length(p_data::text) > 20000 then raise exception 'invalid settings'; end if;
  for v_k in select jsonb_object_keys(p_data) loop
    if v_k = any(v_text) then
      if jsonb_typeof(p_data->v_k) <> 'string' or length(p_data->>v_k) > 500 then raise exception 'invalid settings'; end if;
    elsif v_k = 'paper' then
      if (p_data->>v_k) not in ('58mm','80mm','A5','A4') then raise exception 'invalid settings'; end if;
    elsif v_k = 'label' then
      if (p_data->>v_k) not in ('58x40','50x40','50x28','38x25') then raise exception 'invalid settings'; end if;
    elsif v_k in ('show_logo','show_previous_balance') then
      if jsonb_typeof(p_data->v_k) <> 'boolean' then raise exception 'invalid settings'; end if;
    elsif v_k = 'modules' then
      if jsonb_typeof(p_data->v_k) <> 'object' or exists (
           select 1 from jsonb_each(p_data->v_k) e
            where e.key not in ('wallets','bills','maintenance','installments','tradein','inout','online') or jsonb_typeof(e.value) <> 'boolean') then
        raise exception 'invalid settings';
      end if;
    else
      raise exception 'invalid settings';
    end if;
  end loop;
  update public.store_settings s set data = s.data || p_data, updated_by = auth.uid(), updated_at = now() where s.id
  returning s.data into v_out;
  return v_out;
end $$;

-- Numeric thresholds: the owner changes them from the settings screen.
create or replace function public.save_app_setting(p_key text, p_value numeric)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('owner') then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('save_settings', 20, 60);
  if p_value is null or p_value < 0 or p_value > 100000000 then raise exception 'invalid amount'; end if;
  if p_key = 'max_discount_pct' and p_value > 100 then raise exception 'invalid amount'; end if;
  update public.app_settings a set value = p_value, updated_at = now() where a.key = p_key;
  if not found then raise exception 'invalid settings'; end if;
end $$;

-- ---------- marketing opt-out and campaigns ----------
alter table public.customers add column marketing_opt_out boolean not null default false;
insert into public.app_settings(key, value) values ('wa_daily_cap', 150) on conflict (key) do nothing;

create or replace function public.set_marketing_opt_out(p_customer uuid, p_out boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_any_role(array['owner','manager','cashier']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('save_customer', 30, 60);
  update public.customers c set marketing_opt_out = coalesce(p_out, true), updated_at = now() where c.id = p_customer;
  if not found then raise exception 'customer not found'; end if;
end $$;

create table public.wa_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 80),
  message text not null check (length(trim(message)) between 5 and 1000),
  audience text not null check (audience in ('all','regular','vip','wholesale','technician','debtors')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.wa_campaign_recipients (
  campaign_id uuid not null references public.wa_campaigns(id),
  customer_id uuid not null references public.customers(id),
  sent_by uuid references public.profiles(id),
  sent_at timestamptz,
  primary key (campaign_id, customer_id)
);
create index on public.wa_campaign_recipients (sent_at);
alter table public.wa_campaigns enable row level security;
alter table public.wa_campaign_recipients enable row level security;
create policy wa_campaigns_read on public.wa_campaigns for select to authenticated
  using (public.has_any_role(array['owner','manager']::public.app_role[]));
create policy wa_campaign_recipients_read on public.wa_campaign_recipients for select to authenticated
  using (public.has_any_role(array['owner','manager']::public.app_role[]));
create trigger audit_wa_campaigns after insert or update or delete on public.wa_campaigns
  for each row execute function public.audit_row();

create or replace function public.create_wa_campaign(p_name text, p_message text, p_audience text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n int;
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('wa_campaign', 5, 60);
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'invalid campaign'; end if;
  if length(trim(coalesce(p_message, ''))) not between 5 and 1000 then raise exception 'invalid campaign'; end if;
  if p_audience not in ('all','regular','vip','wholesale','technician','debtors') then raise exception 'invalid campaign'; end if;
  insert into public.wa_campaigns(name, message, audience) values (trim(p_name), trim(p_message), p_audience) returning id into v_id;
  insert into public.wa_campaign_recipients(campaign_id, customer_id)
  select v_id, c.id from public.customers c
   where c.is_active and not c.marketing_opt_out
     and (p_audience in ('all','debtors') or c.category = p_audience)
     and (p_audience <> 'debtors'
          or (select coalesce(sum(l.amount), 0) from public.customer_ledger l where l.customer_id = c.id) > 0);
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'campaign has no recipients'; end if;
  return v_id;
end $$;

-- Called when a staff member opens the chat for one recipient. Refused for opted-out customers and above the daily cap.
create or replace function public.mark_wa_sent(p_campaign uuid, p_customer uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_cap numeric; v_today int;
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  if exists (select 1 from public.customers c where c.id = p_customer and c.marketing_opt_out) then raise exception 'customer opted out'; end if;
  v_cap := coalesce((select value from public.app_settings where key = 'wa_daily_cap'), 150);
  select count(*) into v_today from public.wa_campaign_recipients r
   where (r.sent_at at time zone 'Africa/Cairo')::date = (now() at time zone 'Africa/Cairo')::date;
  if v_today >= v_cap then raise exception 'daily message cap reached'; end if;
  update public.wa_campaign_recipients r set sent_at = now(), sent_by = auth.uid()
   where r.campaign_id = p_campaign and r.customer_id = p_customer and r.sent_at is null;
  if not found then raise exception 'recipient not found'; end if;
end $$;

revoke all on function public.save_store_settings(jsonb) from public, anon;
revoke all on function public.save_app_setting(text, numeric) from public, anon;
revoke all on function public.set_marketing_opt_out(uuid, boolean) from public, anon;
revoke all on function public.create_wa_campaign(text, text, text) from public, anon;
revoke all on function public.mark_wa_sent(uuid, uuid) from public, anon;
grant execute on function public.save_store_settings(jsonb) to authenticated;
grant execute on function public.save_app_setting(text, numeric) to authenticated;
grant execute on function public.set_marketing_opt_out(uuid, boolean) to authenticated;
grant execute on function public.create_wa_campaign(text, text, text) to authenticated;
grant execute on function public.mark_wa_sent(uuid, uuid) to authenticated;
