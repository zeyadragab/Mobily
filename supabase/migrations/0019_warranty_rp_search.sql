-- 0019: warranty lookup must accept short repair numbers such as RP-1 (found by repair_money_test on staging).
-- Serial / IMEI searches still need 5 to 40 characters.
create or replace function public.check_repair_warranty(p_term text)
returns table(order_number bigint, device_model text, customer_name text, delivered_at timestamptz,
              warranty_days int, warranty_until date, is_valid boolean, days_left int)
language plpgsql stable security definer set search_path = public as $$
declare t text := upper(trim(coalesce(p_term, '')));
begin
  if not public.has_any_role(array['owner','manager','cashier','accountant','technician']::public.app_role[]) then
    raise exception 'not allowed';
  end if;
  if not (t ~ '^RP-[0-9]{1,9}$') and (char_length(t) < 5 or char_length(t) > 40) then raise exception 'invalid search'; end if;
  return query
    select r.order_number, r.device_model, r.customer_name, r.delivered_at, r.warranty_days, r.warranty_until,
           (r.warranty_until is not null and r.warranty_until >= (now() at time zone 'Africa/Cairo')::date),
           greatest(0, coalesce(r.warranty_until - (now() at time zone 'Africa/Cairo')::date, 0))
      from public.repair_orders r
     where r.delivered_at is not null and public.can_access_repairs(r.branch_id, false)
       and (r.identifiers @> array[t] or ('RP-' || r.order_number::text) = t)
     order by r.delivered_at desc limit 5;
end $$;
