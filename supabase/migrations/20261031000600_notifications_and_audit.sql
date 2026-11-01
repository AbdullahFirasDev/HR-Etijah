-- =============================================================================
-- Etijah HR — 006: notifications, web-push subscriptions, immutable audit log
-- =============================================================================

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  type        text not null,
  title_ar    text not null,
  title_en    text not null,
  body_ar     text,
  body_en     text,
  data        jsonb not null default '{}',
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  endpoint    text not null unique check (endpoint ~ '^https://'),
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- -----------------------------------------------------------------------------
-- audit_logs: append-only.
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  actor_id     uuid,
  action       text not null,
  entity_type  text not null,
  entity_id    text,
  old_data     jsonb,
  new_data     jsonb,
  reason       text,
  ip           inet,
  user_agent   text,
  metadata     jsonb not null default '{}'
);
create index audit_logs_time_idx on public.audit_logs (occurred_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_actor_idx on public.audit_logs (actor_id, occurred_at desc);
create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function app.prevent_mutation();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function app.prevent_mutation();

-- -----------------------------------------------------------------------------
-- Request context helpers
-- -----------------------------------------------------------------------------
create or replace function app.jwt_role()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
$$;

-- The acting user: the JWT subject, or — only for the trusted backend (service_role) —
-- the x-actor-id header the backend sets when it acts on behalf of a user.
create or replace function app.request_actor()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_header text;
begin
  if auth.uid() is not null then
    return auth.uid();
  end if;
  if app.jwt_role() = 'service_role' then
    v_header := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-actor-id';
    if v_header ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return v_header::uuid;
    end if;
  end if;
  return null;
end;
$$;

create or replace function app.request_ip()
returns inet
language plpgsql
stable
set search_path = ''
as $$
declare
  v_header text;
begin
  if app.jwt_role() <> 'service_role' then
    return null; -- client-supplied headers are not trusted
  end if;
  v_header := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-client-ip';
  return v_header::inet;
exception when others then
  return null;
end;
$$;

-- Generic row-change audit trigger for configuration and workflow tables.
create or replace function app.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old) - 'public_key' - 'access_token_enc' - 'updated_at';
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new) - 'public_key' - 'access_token_enc' - 'updated_at';
  end if;
  if tg_op = 'UPDATE' and v_old = v_new then
    return null;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_data, new_data, ip)
  values (
    app.request_actor(),
    lower(tg_op),
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id', concat_ws(':', coalesce(v_new, v_old) ->> 'department_id', coalesce(v_new, v_old) ->> 'user_id', coalesce(v_new, v_old) ->> 'year', coalesce(v_new, v_old) ->> 'month')),
    v_old,
    v_new,
    app.request_ip()
  );
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'roles', 'profiles', 'departments', 'department_managers', 'offices', 'geofences',
    'allowed_networks', 'employees', 'org_settings', 'webauthn_credentials', 'shifts',
    'employee_schedules', 'holidays', 'leave_types', 'leave_balances', 'leave_requests',
    'attendance_adjustments', 'attendance_period_locks'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row_change()',
      t || '_audit', t
    );
  end loop;
end;
$$;
