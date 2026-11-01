-- =============================================================================
-- Etijah HR — 004: shifts, employee schedules, holidays, leave
-- =============================================================================

-- -----------------------------------------------------------------------------
-- shifts: reusable schedule templates. end_time <= start_time means the shift crosses
-- midnight (overnight shift); its work date is the date the shift STARTS.
-- -----------------------------------------------------------------------------
create table public.shifts (
  id                          uuid primary key default gen_random_uuid(),
  code                        text not null unique check (code ~ '^[A-Z0-9_-]{2,20}$'),
  name_ar                     text not null,
  name_en                     text not null,
  start_time                  time not null,
  end_time                    time not null,
  crosses_midnight            boolean generated always as (end_time <= start_time) stored,
  required_minutes            integer not null default 480 check (required_minutes between 0 and 1440),
  grace_minutes               integer not null default 10 check (grace_minutes between 0 and 240),
  early_leave_grace_minutes   integer not null default 0 check (early_leave_grace_minutes between 0 and 240),
  break_minutes               integer not null default 30 check (break_minutes between 0 and 480),
  paid_break_minutes          integer not null default 30 check (paid_break_minutes between 0 and 480),
  working_days                smallint[] not null default '{7,1,2,3,4}',
  weekly_required_minutes     integer check (weekly_required_minutes between 0 and 10080),
  is_flexible                 boolean not null default false,
  flex_earliest_start         time,
  flex_latest_end             time,
  overtime_eligible           boolean not null default true,
  count_before_shift          boolean not null default false,
  count_after_shift           boolean not null default false,
  is_active                   boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  check (paid_break_minutes <= break_minutes),
  check (array_length(working_days, 1) between 1 and 7 and working_days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  check (not is_flexible or (flex_earliest_start is null) = (flex_latest_end is null))
);
create trigger shifts_touch before update on public.shifts
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- employee_schedules: effective-dated assignment of a shift, with optional per-employee
-- overrides (NULL = inherit from the shift, then from org_settings).
-- -----------------------------------------------------------------------------
create table public.employee_schedules (
  id                          uuid primary key default gen_random_uuid(),
  employee_id                 uuid not null references public.employees (id) on delete cascade,
  shift_id                    uuid references public.shifts (id) on delete restrict,
  effective_from              date not null,
  effective_to                date,
  required_minutes            integer check (required_minutes between 0 and 1440),
  working_days                smallint[] check (working_days is null or (array_length(working_days, 1) between 1 and 7 and working_days <@ '{1,2,3,4,5,6,7}'::smallint[])),
  start_time                  time,
  end_time                    time,
  grace_minutes               integer check (grace_minutes between 0 and 240),
  early_leave_grace_minutes   integer check (early_leave_grace_minutes between 0 and 240),
  break_minutes               integer check (break_minutes between 0 and 480),
  paid_break_minutes          integer check (paid_break_minutes between 0 and 480),
  weekly_required_minutes     integer check (weekly_required_minutes between 0 and 10080),
  is_flexible                 boolean,
  flex_earliest_start         time,
  flex_latest_end             time,
  overtime_eligible           boolean,
  count_before_shift          boolean,
  count_after_shift           boolean,
  notes                       text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  check ((start_time is null) = (end_time is null)),
  check (shift_id is not null or start_time is not null or is_flexible),
  constraint employee_schedules_no_overlap exclude using gist (
    employee_id with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
  )
);
create index employee_schedules_employee_idx on public.employee_schedules (employee_id, effective_from desc);
create trigger employee_schedules_touch before update on public.employee_schedules
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- holidays: official (national) and company holidays. Recurring holidays repeat on the
-- same month/day every year (lunar holidays must be entered per year).
-- -----------------------------------------------------------------------------
create table public.holidays (
  id            uuid primary key default gen_random_uuid(),
  name_ar       text not null,
  name_en       text not null,
  holiday_type  text not null default 'official' check (holiday_type in ('official', 'company')),
  start_date    date not null,
  end_date      date not null,
  is_recurring  boolean not null default false,
  office_id     uuid references public.offices (id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (end_date >= start_date and end_date - start_date < 31)
);
create index holidays_dates_idx on public.holidays (start_date, end_date);
create trigger holidays_touch before update on public.holidays
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- leave
-- -----------------------------------------------------------------------------
create table public.leave_types (
  id                      uuid primary key default gen_random_uuid(),
  code                    text not null unique check (code ~ '^[a-z0-9_]{2,30}$'),
  name_ar                 text not null,
  name_en                 text not null,
  is_paid                 boolean not null default true,
  annual_allowance_days   numeric(5, 1) not null default 0 check (annual_allowance_days >= 0),
  tracks_balance          boolean not null default true,
  allow_half_day          boolean not null default true,
  excluded_from_absence   boolean not null default true,
  excluded_from_shortage  boolean not null default true,
  color                   text not null default 'primary',
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create trigger leave_types_touch before update on public.leave_types
  for each row execute function app.touch_updated_at();

create table public.leave_balances (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.employees (id) on delete cascade,
  leave_type_id       uuid not null references public.leave_types (id) on delete cascade,
  year                integer not null check (year between 2000 and 2100),
  allocated_days      numeric(5, 1) not null default 0 check (allocated_days >= 0),
  carried_over_days   numeric(5, 1) not null default 0 check (carried_over_days >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (employee_id, leave_type_id, year)
);
create trigger leave_balances_touch before update on public.leave_balances
  for each row execute function app.touch_updated_at();

create table public.leave_requests (
  id                    uuid primary key default gen_random_uuid(),
  employee_id           uuid not null references public.employees (id) on delete cascade,
  leave_type_id         uuid not null references public.leave_types (id) on delete restrict,
  start_date            date not null,
  end_date              date not null,
  is_half_day           boolean not null default false,
  days_count            numeric(5, 1) not null check (days_count >= 0),
  reason                text check (reason is null or length(reason) <= 1000),
  status                public.leave_status not null default 'pending',
  manager_reviewed_by   uuid references public.profiles (id) on delete set null,
  manager_reviewed_at   timestamptz,
  manager_note          text,
  reviewed_by           uuid references public.profiles (id) on delete set null,
  reviewed_at           timestamptz,
  review_note           text,
  cancelled_at          timestamptz,
  created_by            uuid references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (end_date >= start_date and end_date - start_date < 366),
  check (not is_half_day or start_date = end_date),
  constraint leave_requests_no_overlap exclude using gist (
    employee_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status in ('pending', 'manager_approved', 'approved'))
);
create index leave_requests_employee_idx on public.leave_requests (employee_id, start_date desc);
create index leave_requests_status_idx on public.leave_requests (status) where status in ('pending', 'manager_approved');
create trigger leave_requests_touch before update on public.leave_requests
  for each row execute function app.touch_updated_at();
