-- =============================================================================
-- Etijah HR — 011: shared rate-limit counters (service_role only)
-- =============================================================================
-- Serverless deployments (Vercel) run several short-lived instances, so per-process
-- counters cannot enforce login / attendance limits. With NUXT_RATE_LIMIT_STORE=database
-- the server counts here instead: one row per bucket:key, fixed window, atomic upsert.
-- Backend-only: RLS on with no policies, no grants to anon/authenticated.

create table public.rate_limit_counters (
  key         text primary key check (length(key) <= 512),
  count       integer not null check (count > 0),
  expires_at  timestamptz not null
);
create index rate_limit_counters_expiry_idx on public.rate_limit_counters (expires_at);

alter table public.rate_limit_counters enable row level security;
revoke all on public.rate_limit_counters from public, anon, authenticated;
grant all on public.rate_limit_counters to service_role;

-- Count one hit for p_key in a window of p_window_seconds; returns the count in the window.
create or replace function public.rate_limit_hit(p_key text, p_window_seconds integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate-limit window' using errcode = '22023';
  end if;

  insert into public.rate_limit_counters as c (key, count, expires_at)
  values (p_key, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (key) do update
    set count      = case when c.expires_at <= now() then 1 else c.count + 1 end,
        expires_at = case when c.expires_at <= now() then now() + make_interval(secs => p_window_seconds) else c.expires_at end
  returning c.count into v_count;

  -- Occasional cleanup of long-expired windows (keeps the table small without a job).
  if random() < 0.01 then
    delete from public.rate_limit_counters where expires_at < now() - interval '1 hour';
  end if;

  return v_count;
end;
$$;

revoke execute on function public.rate_limit_hit(text, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer) to service_role;
