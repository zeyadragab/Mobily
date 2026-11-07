-- RLS / approvals test for 0001-0003. Run in the Supabase SQL Editor.
-- Uses fake users inside ONE transaction that is ROLLED BACK at the end: nothing is kept.
-- Expected result: every row has ok = true.

begin;

create temp table t_results(test text, ok boolean, detail text);
grant all on t_results to public;

-- fake users (profiles are created by the on_auth_user_created trigger)
insert into auth.users (id, aud, role, email) values
 ('00000000-0000-0000-0000-0000000000a1','authenticated','authenticated','t-owner2@test.invalid'),
 ('00000000-0000-0000-0000-0000000000b1','authenticated','authenticated','t-manager@test.invalid'),
 ('00000000-0000-0000-0000-0000000000c1','authenticated','authenticated','t-cashier@test.invalid');

insert into public.user_roles(user_id, role) values
 ('00000000-0000-0000-0000-0000000000a1','owner'),
 ('00000000-0000-0000-0000-0000000000b1','manager'),
 ('00000000-0000-0000-0000-0000000000c1','cashier');

-- helper: act as a user
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- 1. cashier cannot read the audit log
do $$ declare n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  select count(*) into n from public.audit_log;
  reset role;
  insert into t_results values ('cashier cannot read audit_log', n = 0, 'rows='||n);
end $$;

-- 2. owner can read the audit log
do $$ declare n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  select count(*) into n from public.audit_log;
  reset role;
  insert into t_results values ('owner can read audit_log', n > 0, 'rows='||n);
end $$;

-- 3. cashier cannot grant himself a role
do $$ declare failed boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  begin
    insert into public.user_roles(user_id, role)
    values ('00000000-0000-0000-0000-0000000000c1','owner');
  exception when others then failed := true; end;
  reset role;
  insert into t_results values ('cashier cannot grant owner role', failed, '');
end $$;

-- 4. cashier sees only own profile
do $$ declare n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  select count(*) into n from public.profiles;
  reset role;
  insert into t_results values ('cashier sees only own profile', n = 1, 'rows='||n);
end $$;

-- 5. manager creates a PO-send approval request
do $$ declare ok boolean := true; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin
    insert into public.approval_requests
      (id, action_type, subject_entity, subject_id, requested_by, amount, idempotency_key)
    values ('00000000-0000-0000-0000-00000000d001','purchase_order.send','purchase_order',
            gen_random_uuid(),'00000000-0000-0000-0000-0000000000b1', 5000, 'test-key-1');
  exception when others then ok := false; end;
  reset role;
  insert into t_results values ('manager can create approval request', ok, '');
end $$;

-- 6. manager cannot decide it (not owner)
do $$ declare failed boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin
    perform public.decide_approval('00000000-0000-0000-0000-00000000d001','approved');
  exception when others then failed := true; end;
  reset role;
  insert into t_results values ('manager cannot approve', failed, '');
end $$;

-- 7. cashier cannot see the request
do $$ declare n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  select count(*) into n from public.approval_requests;
  reset role;
  insert into t_results values ('cashier cannot see approval requests', n = 0, 'rows='||n);
end $$;

-- 8. owner approves the manager's request
do $$ declare s text; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  select status::text into s from public.decide_approval('00000000-0000-0000-0000-00000000d001','approved');
  reset role;
  insert into t_results values ('owner can approve', s = 'approved', 's='||s);
end $$;

-- 9. owner cannot approve own request (separation of duties)
do $$ declare failed boolean := false; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  insert into public.approval_requests
    (id, action_type, subject_entity, subject_id, requested_by, amount, idempotency_key)
  values ('00000000-0000-0000-0000-00000000d002','purchase_order.send','purchase_order',
          gen_random_uuid(),'00000000-0000-0000-0000-0000000000a1', 100, 'test-key-2');
  begin
    perform public.decide_approval('00000000-0000-0000-0000-00000000d002','approved');
  exception when others then failed := true; end;
  reset role;
  insert into t_results values ('owner cannot approve own request', failed, '');
end $$;

-- 10. cashier cannot execute someone else's approved request
do $$ declare r boolean; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  r := public.consume_approval('00000000-0000-0000-0000-00000000d001');
  reset role;
  insert into t_results values ('cashier cannot consume approval', r = false, 'r='||r);
end $$;

-- 11. manager consumes it once; second time returns false
do $$ declare r1 boolean; r2 boolean; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r1 := public.consume_approval('00000000-0000-0000-0000-00000000d001');
  r2 := public.consume_approval('00000000-0000-0000-0000-00000000d001');
  reset role;
  insert into t_results values ('approval executes exactly once', r1 and not r2, 'r1='||r1||' r2='||r2);
end $$;

-- 12. audit_log cannot be edited or deleted (even as superuser)
do $$ declare failed boolean := false; begin
  begin
    delete from public.audit_log;
  exception when others then failed := true; end;
  insert into t_results values ('audit_log is append-only', failed, '');
end $$;

-- 13. anonymous (not logged in) sees nothing
do $$ declare n int := 0; begin
  insert into public.branches(name) values ('test-branch');
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin
    select count(*) into n from public.branches;
  exception when others then n := 0; end;
  reset role;
  insert into t_results values ('anon cannot read branches', n = 0, 'rows='||n);
end $$;

select test, ok, detail from t_results order by test;

rollback;
