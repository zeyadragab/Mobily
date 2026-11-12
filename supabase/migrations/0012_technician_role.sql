-- 0012 Technician role. Kept in its own migration: a new enum value cannot be used
-- until the transaction that adds it has committed (0013 references it).
alter type public.app_role add value if not exists 'technician';
