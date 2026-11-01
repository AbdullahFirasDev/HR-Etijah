-- =============================================================================
-- Etijah HR — 007: Row Level Security helpers, grants and policies
-- =============================================================================
-- Model:
--   * scope (roles.scope) decides WHOSE rows are reachable:
--       organization → everyone, department → employees of managed departments, self → own rows
--   * permissions (roles.permissions) decide WHAT may be done; owners hold every permission.
--   * Every user can always read their OWN attendance, leave, devices and notifications.
--   * Sensitive state transitions (attendance, adjustments, leave decisions, device status,
--     role changes) are not writable through table policies at all — only through the
--     SECURITY DEFINER functions in migration 008, which re-check authorisation.

-- -----------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER: they read profiles/roles without recursing into RLS)
-- -----------------------------------------------------------------------------
create or replace function app.current_role_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.key
    from public.profiles p
    join public.roles r on r.id = p.role_id
   where p.id = auth.uid() and p.is_active
$$;

create or replace function app.current_scope()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.scope
    from public.profiles p
    join public.roles r on r.id = p.role_id
   where p.id = auth.uid() and p.is_active
$$;

create or replace function app.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select r.key = 'owner' or p_permission = any (r.permissions)
      from public.profiles p
      join public.roles r on r.id = p.role_id
     where p.id = auth.uid() and p.is_active
  ), false)
$$;

create or replace function app.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id from public.employees e where e.profile_id = auth.uid()
$$;

-- Can the caller reach this employee's data at all (scope check, includes self)?
create or replace function app.can_access_employee(p_employee_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope text;
begin
  if p_employee_id is null or auth.uid() is null then
    return false;
  end if;
  v_scope := app.current_scope();
  if v_scope is null then
    return false; -- inactive or unknown user
  end if;
  if exists (select 1 from public.employees e where e.id = p_employee_id and e.profile_id = auth.uid()) then
    return true;
  end if;
  if v_scope = 'organization' then
    return true;
  end if;
  if v_scope = 'department' then
    return exists (
      select 1
        from public.employees e
        join public.department_managers dm on dm.department_id = e.department_id
       where e.id = p_employee_id and dm.user_id = auth.uid()
    );
  end if;
  return false;
end;
$$;

-- Read access: own data always; others' data with the permission and within scope.
create or replace function app.can_read_employee(p_employee_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_employee_id is not null and (
    p_employee_id = app.current_employee_id()
    or (app.has_permission(p_permission) and app.can_access_employee(p_employee_id))
  )
$$;

-- Management access: the permission AND scope reach (self included — workflow functions
-- separately forbid self-approval).
create or replace function app.can_manage_employee(p_employee_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_permission(p_permission) and app.can_access_employee(p_employee_id)
$$;

create or replace function app.is_period_locked(p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.attendance_period_locks l
     where l.year = extract(year from p_date)::int and l.month = extract(month from p_date)::int
  )
$$;

revoke all on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Grants. RLS is the row filter; grants are the column/verb filter.
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

grant select on all tables in schema public to authenticated;
revoke select on public.app_sessions, public.webauthn_challenges from authenticated;

grant insert, update, delete on
  public.departments, public.department_managers, public.offices, public.geofences,
  public.allowed_networks, public.shifts, public.employee_schedules, public.holidays,
  public.leave_types, public.leave_balances
  to authenticated;
grant update on public.org_settings to authenticated;
grant update (name_ar, name_en, permissions) on public.roles to authenticated;
grant update (locale, phone) on public.profiles to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant delete on public.push_subscriptions to authenticated;

-- -----------------------------------------------------------------------------
-- Enable RLS everywhere
-- -----------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reference/configuration tables: readable by every signed-in user, writable with a permission
-- -----------------------------------------------------------------------------
do $$
declare
  cfg record;
begin
  for cfg in
    select * from (values
      ('departments', 'departments.manage'),
      ('department_managers', 'departments.manage'),
      ('offices', 'settings.manage'),
      ('geofences', 'settings.manage'),
      ('shifts', 'schedules.manage'),
      ('holidays', 'holidays.manage'),
      ('leave_types', 'leave.manage')
    ) as v(tbl, perm)
  loop
    execute format('create policy %I on public.%I for select to authenticated using (true)', cfg.tbl || '_select', cfg.tbl);
    execute format('create policy %I on public.%I for insert to authenticated with check (app.has_permission(%L))', cfg.tbl || '_insert', cfg.tbl, cfg.perm);
    execute format('create policy %I on public.%I for update to authenticated using (app.has_permission(%L)) with check (app.has_permission(%L))', cfg.tbl || '_update', cfg.tbl, cfg.perm, cfg.perm);
    execute format('create policy %I on public.%I for delete to authenticated using (app.has_permission(%L))', cfg.tbl || '_delete', cfg.tbl, cfg.perm);
  end loop;
end;
$$;

-- Allowed networks reveal the company's public IP: restricted read.
create policy allowed_networks_select on public.allowed_networks for select to authenticated
  using (app.has_permission('settings.manage') or app.has_permission('security.read'));
create policy allowed_networks_insert on public.allowed_networks for insert to authenticated
  with check (app.has_permission('settings.manage'));
create policy allowed_networks_update on public.allowed_networks for update to authenticated
  using (app.has_permission('settings.manage')) with check (app.has_permission('settings.manage'));
create policy allowed_networks_delete on public.allowed_networks for delete to authenticated
  using (app.has_permission('settings.manage'));

create policy org_settings_select on public.org_settings for select to authenticated using (true);
create policy org_settings_update on public.org_settings for update to authenticated
  using (app.has_permission('settings.manage')) with check (app.has_permission('settings.manage'));

create policy roles_select on public.roles for select to authenticated using (true);
create policy roles_update on public.roles for update to authenticated
  using (app.has_permission('roles.manage') and key <> 'owner')
  with check (app.has_permission('roles.manage') and key <> 'owner');

create policy attendance_period_locks_select on public.attendance_period_locks for select to authenticated using (true);

-- -----------------------------------------------------------------------------
-- People
-- -----------------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated using (
  id = (select auth.uid())
  or ((select app.current_scope()) = 'organization' and (select app.has_permission('employees.read')))
  or exists (
    select 1 from public.employees e
     where e.profile_id = profiles.id and app.can_read_employee(e.id, 'employees.read')
  )
);
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy employees_select on public.employees for select to authenticated
  using (app.can_read_employee(id, 'employees.read'));

create policy employee_schedules_select on public.employee_schedules for select to authenticated
  using (app.can_read_employee(employee_id, 'employees.read'));
create policy employee_schedules_insert on public.employee_schedules for insert to authenticated
  with check (app.can_manage_employee(employee_id, 'schedules.manage'));
create policy employee_schedules_update on public.employee_schedules for update to authenticated
  using (app.can_manage_employee(employee_id, 'schedules.manage'))
  with check (app.can_manage_employee(employee_id, 'schedules.manage'));
create policy employee_schedules_delete on public.employee_schedules for delete to authenticated
  using (app.can_manage_employee(employee_id, 'schedules.manage'));

-- -----------------------------------------------------------------------------
-- Devices / credentials (writes only through backend + SECURITY DEFINER functions)
-- -----------------------------------------------------------------------------
create policy employee_devices_select on public.employee_devices for select to authenticated
  using (app.can_read_employee(employee_id, 'devices.manage'));
create policy webauthn_credentials_select on public.webauthn_credentials for select to authenticated
  using (app.can_read_employee(employee_id, 'devices.manage'));

-- -----------------------------------------------------------------------------
-- Leave
-- -----------------------------------------------------------------------------
create policy leave_balances_select on public.leave_balances for select to authenticated
  using (app.can_read_employee(employee_id, 'leave.read'));
create policy leave_balances_insert on public.leave_balances for insert to authenticated
  with check (app.can_manage_employee(employee_id, 'leave.manage'));
create policy leave_balances_update on public.leave_balances for update to authenticated
  using (app.can_manage_employee(employee_id, 'leave.manage'))
  with check (app.can_manage_employee(employee_id, 'leave.manage'));
create policy leave_balances_delete on public.leave_balances for delete to authenticated
  using (app.can_manage_employee(employee_id, 'leave.manage'));

create policy leave_requests_select on public.leave_requests for select to authenticated
  using (app.can_read_employee(employee_id, 'leave.read'));

-- -----------------------------------------------------------------------------
-- Attendance (read-only for clients)
-- -----------------------------------------------------------------------------
create policy attendance_events_select on public.attendance_events for select to authenticated
  using (app.can_read_employee(employee_id, 'attendance.read'));
create policy attendance_sessions_select on public.attendance_sessions for select to authenticated
  using (app.can_read_employee(employee_id, 'attendance.read'));
create policy breaks_select on public.breaks for select to authenticated
  using (app.can_read_employee(employee_id, 'attendance.read'));
create policy attendance_days_select on public.attendance_days for select to authenticated
  using (app.can_read_employee(employee_id, 'attendance.read'));
create policy monthly_summaries_select on public.monthly_summaries for select to authenticated
  using (app.can_read_employee(employee_id, 'attendance.read'));
create policy attendance_adjustments_select on public.attendance_adjustments for select to authenticated
  using (app.can_read_employee(employee_id, 'attendance.read'));
create policy verification_attempts_select on public.verification_attempts for select to authenticated
  using (app.can_read_employee(employee_id, 'security.read'));

-- -----------------------------------------------------------------------------
-- Notifications, push, audit
-- -----------------------------------------------------------------------------
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

create policy audit_logs_select on public.audit_logs for select to authenticated
  using (app.has_permission('audit.read'));

-- app_sessions and webauthn_challenges intentionally have NO policies (backend only).
