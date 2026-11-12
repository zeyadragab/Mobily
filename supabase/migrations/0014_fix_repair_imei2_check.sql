-- 0014 Fix: 0011's imei2 check rejected every order with no IMEI at all, because
-- (NULL IS DISTINCT FROM NULL) is false. imei2 may be empty; when present it must be
-- 15 digits and different from imei1.
alter table public.repair_orders drop constraint repair_orders_check;
alter table public.repair_orders add constraint repair_orders_imei2_check
  check (imei2 is null or (imei2 ~ '^[0-9]{15}$' and imei2 is distinct from imei1));
