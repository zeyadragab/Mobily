-- 0038: keep personal identity data out of audit_log.
-- audit_row() copies the whole row into audit_log (readable by owner and accountant) but drops the columns named in
-- the trigger arguments. Two tables with national ids were not excluding them:
--   * customer_kyc (0022): national id, address, guarantor name / phone / national id were copied on every save.
--   * trade_in_sellers (0033): the draft had no audit trigger at all.
-- Both are now audited without the identity columns, so the log still shows who changed what and when.
-- Needs 0022 and 0033. No data change: audit_log is append-only and, at the time of writing, held no such rows on staging.
-- If an older database already has customer_kyc audit rows, they still contain the ids; scrubbing them needs a
-- deliberate, reviewed exception to the append-only rule (not done here).

drop trigger if exists audit_customer_kyc on public.customer_kyc;
create trigger audit_customer_kyc after insert or update or delete on public.customer_kyc
  for each row execute function public.audit_row('national_id', 'address', 'guarantor_name', 'guarantor_phone', 'guarantor_national_id');

drop trigger if exists audit_trade_in_sellers on public.trade_in_sellers;
create trigger audit_trade_in_sellers after insert or update or delete on public.trade_in_sellers
  for each row execute function public.audit_row('national_id', 'address');
