-- =============================================================================
-- Etijah HR — 002: roles, profiles, departments, offices, geofences, networks,
--                  employees, organisation-wide policy settings
-- =============================================================================

-- -----------------------------------------------------------------------------
-- roles: the four system roles. `scope` controls WHOSE data a role can reach,
-- `permissions` controls WHAT it can do there. Owners implicitly hold everything.
-- -----------------------------------------------------------------------------
create table public.roles (
  id          smallint generated always as identity primary key,
  key         text not null unique check (key in ('owner', 'hr_manager', 'department_manager', 'employee')),
  name_ar     text not null,
  name_en     text not null,
  scope       text not null check (scope in ('organization', 'department', 'self')),
  permissions text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger roles_touch before update on public.roles
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- profiles: 1:1 with auth.users. Accounts are provisioned by administrators.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  email                 text not null,
  full_name             text not null check (length(trim(full_name)) between 2 and 160),
  full_name_en          text,
  role_id               smallint not null references public.roles (id),
  locale                text not null default 'ar' check (locale in ('ar', 'en')),
  phone                 text,
  is_active             boolean not null default true,
  must_change_password  boolean not null default false,
  last_login_at         timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));
create index profiles_role_idx on public.profiles (role_id);
create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- departments + department managers (a manager may lead several departments)
-- -----------------------------------------------------------------------------
create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9_-]{2,20}$'),
  name_ar     text not null,
  name_en     text not null,
  parent_id   uuid references public.departments (id) on delete set null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);
create trigger departments_touch before update on public.departments
  for each row execute function app.touch_updated_at();

create table public.department_managers (
  department_id uuid not null references public.departments (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (department_id, user_id)
);
create index department_managers_user_idx on public.department_managers (user_id);

-- -----------------------------------------------------------------------------
-- offices + geofences. Coordinates are stored as plain lat/lng (easy to edit) and
-- the authoritative PostGIS geography is a generated column.
-- -----------------------------------------------------------------------------
create table public.offices (
  id          uuid primary key default gen_random_uuid(),
  name_ar     text not null,
  name_en     text not null,
  address     text,
  timezone    text not null default 'Asia/Baghdad',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger offices_touch before update on public.offices
  for each row execute function app.touch_updated_at();

create table public.geofences (
  id              uuid primary key default gen_random_uuid(),
  office_id       uuid not null references public.offices (id) on delete cascade,
  name            text not null,
  latitude        double precision not null check (latitude between -90 and 90),
  longitude       double precision not null check (longitude between -180 and 180),
  center          extensions.geography(Point, 4326)
                    generated always as (
                      extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography
                    ) stored,
  radius_m        integer not null default 100 check (radius_m between 10 and 5000),
  max_accuracy_m  integer not null default 50 check (max_accuracy_m between 5 and 1000),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index geofences_office_idx on public.geofences (office_id);
create index geofences_center_gix on public.geofences using gist (center);
create trigger geofences_touch before update on public.geofences
  for each row execute function app.touch_updated_at();

-- Allowed public networks (static company IP and/or CIDR ranges). office_id NULL = all offices.
create table public.allowed_networks (
  id          uuid primary key default gen_random_uuid(),
  office_id   uuid references public.offices (id) on delete cascade,
  label       text not null,
  cidr        cidr not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique nulls not distinct (office_id, cidr)
);
create index allowed_networks_cidr_gix on public.allowed_networks using gist (cidr inet_ops);
create trigger allowed_networks_touch before update on public.allowed_networks
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- employees (attendance subjects). Owners/HR may have a profile without an employee row.
-- Employees are never hard-deleted once they have attendance history (FK RESTRICT).
-- -----------------------------------------------------------------------------
create table public.employees (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null unique references public.profiles (id) on delete cascade,
  employee_code     text not null unique check (length(trim(employee_code)) between 1 and 32),
  department_id     uuid references public.departments (id) on delete set null,
  office_id         uuid references public.offices (id) on delete set null,
  job_title         text,
  hire_date         date,
  termination_date  date,
  status            text not null default 'active' check (status in ('active', 'suspended', 'terminated')),
  timezone          text not null default 'Asia/Baghdad',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (termination_date is null or hire_date is null or termination_date >= hire_date)
);
create index employees_department_idx on public.employees (department_id);
create index employees_office_idx on public.employees (office_id);
create index employees_status_idx on public.employees (status);
create trigger employees_touch before update on public.employees
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Organisation-wide policy (singleton row id = 1). Every calculation that depends on a
-- policy value records the value it used (attendance_days.details) for auditability.
-- -----------------------------------------------------------------------------
create table public.org_settings (
  id                            smallint primary key default 1 check (id = 1),
  org_name_ar                   text not null default 'الاتجاه للسياحة والسفر',
  org_name_en                   text not null default 'Etijah Travel & Tourism',
  timezone                      text not null default 'Asia/Baghdad',
  week_start                    smallint not null default 7 check (week_start between 1 and 7), -- ISO weekday
  default_required_minutes      integer not null default 480 check (default_required_minutes between 0 and 1440),
  default_working_days          smallint[] not null default '{7,1,2,3,4}', -- Sun–Thu (ISO: Mon=1 … Sun=7)
  -- verification
  max_location_age_seconds      integer not null default 60 check (max_location_age_seconds between 5 and 600),
  max_travel_speed_kmh          integer not null default 250 check (max_travel_speed_kmh between 20 and 2000),
  risk_review_threshold         integer not null default 40 check (risk_review_threshold between 0 and 100),
  risk_block_threshold          integer not null default 80 check (risk_block_threshold between 1 and 100),
  require_device_approval       boolean not null default true,
  max_devices_per_employee      integer not null default 2 check (max_devices_per_employee between 1 and 10),
  -- calculation policy
  allow_multiple_sessions       boolean not null default true,
  missing_checkout_policy       text not null default 'zero' check (missing_checkout_policy in ('zero', 'scheduled_end')),
  auto_close_after_hours        integer not null default 16 check (auto_close_after_hours between 4 and 36),
  absence_counts_as_shortage    boolean not null default true,
  late_counts_from              text not null default 'shift_start' check (late_counts_from in ('shift_start', 'grace_end')),
  min_overtime_minutes          integer not null default 15 check (min_overtime_minutes between 0 and 240),
  max_daily_overtime_minutes    integer not null default 240 check (max_daily_overtime_minutes between 0 and 1440),
  overtime_basis                text not null default 'daily' check (overtime_basis in ('daily', 'weekly')),
  holiday_work_is_overtime      boolean not null default true,
  leave_approval_flow           text not null default 'single' check (leave_approval_flow in ('single', 'two_step')),
  allow_negative_leave_balance  boolean not null default false,
  updated_at                    timestamptz not null default now(),
  check (risk_review_threshold <= risk_block_threshold),
  check (array_length(default_working_days, 1) between 1 and 7 and default_working_days <@ '{1,2,3,4,5,6,7}'::smallint[])
);
create trigger org_settings_touch before update on public.org_settings
  for each row execute function app.touch_updated_at();
