-- 0010: lock the public order function behind the server function (CAPTCHA + per-IP rate limit).
-- APPLY THIS LAST: only after the `place-order` Edge Function is deployed and the storefront uses it.
-- After this migration, browsers/bots can no longer call place_online_order directly:
-- only the Edge Function (service role) can, and it checks Cloudflare Turnstile and the IP limit first.

create table public.order_attempts (
  id bigint generated always as identity primary key,
  ip text not null,
  at timestamptz not null default now()
);
create index on public.order_attempts (ip, at desc);

alter table public.order_attempts enable row level security;
-- no policies and no grants: only the service role (Edge Function) can read/write this table
revoke all on public.order_attempts from public, anon, authenticated;

revoke execute on function public.place_online_order(text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.place_online_order(text,text,text,text,text,jsonb) to service_role;
