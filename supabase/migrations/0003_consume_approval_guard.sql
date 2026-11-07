-- 0003: only the requester, owner or manager may consume (execute) an approved request.
create or replace function public.consume_approval(p_request uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.approval_requests
     set status = 'executed', executed_at = now()
   where id = p_request and status = 'approved'
     and (expires_at is null or expires_at > now())
     and (requested_by = auth.uid()
          or public.has_any_role(array['owner','manager']::public.app_role[]));
  get diagnostics n = row_count;
  return n = 1;
end $$;
