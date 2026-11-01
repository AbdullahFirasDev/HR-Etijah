-- =============================================================================
-- Etijah HR — 005: attendance events (immutable), sessions, breaks, verification
--                  attempts, adjustments, computed daily/monthly summaries
-- =============================================================================

-- -----------------------------------------------------------------------------
-- attendance_adjustments: every administrative correction. Original events are never
-- modified; an approved adjustment appends new events and re-points derived sessions.
-- -----------------------------------------------------------------------------
create table public.attendance_adjustments (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.employees (id) on delete restrict,
  work_date           date not null,
  adjustment_type     public.adjustment_type not null,
  target_session_id   uuid,
  target_break_id     uuid,
  new_start_at        timestamptz,
  new_end_at          timestamptz,
  reason              text not null check (length(trim(reason)) between 5 and 1000),
  status              public.adjustment_status not null default 'pending',
  requested_by        uuid not null,
  reviewed_by         uuid,
  reviewed_at         timestamptz,
  review_note         text,
  applied_at          timestamptz,
  created_at          timestamptz not null default now(),
  check (new_end_at is null or new_start_at is null or new_end_at > new_start_at),
  check (status = 'pending' or reviewed_at is not null),
  check (applied_at is null or status = 'approved')
);
create index attendance_adjustments_employee_idx on public.attendance_adjustments (employee_id, work_date desc);
create index attendance_adjustments_pending_idx on public.attendance_adjustments (created_at) where status = 'pending';

-- -----------------------------------------------------------------------------
-- attendance_sessions: one work interval (check-in → check-out). Derived/maintained by the
-- record_attendance_event() state machine and by approved adjustments.
-- -----------------------------------------------------------------------------
create table public.attendance_sessions (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.employees (id) on delete restrict,
  work_date           date not null,
  check_in_event_id   uuid not null,
  check_out_event_id  uuid,
  check_in_at         timestamptz not null,
  check_out_at        timestamptz,
  status              public.session_status not null default 'open',
  closed_by           text check (closed_by in ('employee', 'adjustment', 'system')),
  voided_by_adjustment_id uuid references public.attendance_adjustments (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (check_out_at is null or check_out_at > check_in_at),
  check ((status = 'closed') = (check_out_at is not null) or status = 'voided'),
  constraint attendance_sessions_no_overlap exclude using gist (
    employee_id with =,
    tstzrange(check_in_at, check_out_at, '[)') with &&
  ) where (status = 'closed')
);
create unique index attendance_sessions_one_open on public.attendance_sessions (employee_id) where status = 'open';
create index attendance_sessions_employee_date_idx on public.attendance_sessions (employee_id, work_date desc);
create index attendance_sessions_date_idx on public.attendance_sessions (work_date);
create trigger attendance_sessions_touch before update on public.attendance_sessions
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- attendance_events: IMMUTABLE event log. occurred_at is always the database clock.
-- An employee-sourced event can only exist if all three verifications passed.
-- -----------------------------------------------------------------------------
create table public.attendance_events (
  id                    uuid primary key default gen_random_uuid(),
  employee_id           uuid not null references public.employees (id) on delete restrict,
  session_id            uuid references public.attendance_sessions (id) deferrable initially deferred,
  event_type            public.attendance_event_type not null,
  occurred_at           timestamptz not null default now(),
  work_date             date not null,
  source                public.attendance_source not null default 'employee',
  adjustment_id         uuid references public.attendance_adjustments (id),
  -- A. geofence
  latitude              double precision check (latitude between -90 and 90),
  longitude             double precision check (longitude between -180 and 180),
  location              extensions.geography(Point, 4326)
                          generated always as (
                            case when latitude is not null and longitude is not null
                              then extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography
                            end
                          ) stored,
  accuracy_m            numeric(9, 2) check (accuracy_m >= 0),
  position_captured_at  timestamptz,
  geofence_id           uuid references public.geofences (id) on delete set null,
  distance_m            numeric(12, 2),
  geofence_passed       boolean,
  -- B. network
  client_ip             inet,
  network_id            uuid references public.allowed_networks (id) on delete set null,
  network_passed        boolean,
  -- C. WebAuthn
  credential_id         uuid references public.webauthn_credentials (id) on delete set null,
  challenge_id          uuid unique references public.webauthn_challenges (id) on delete set null,
  webauthn_passed       boolean,
  -- risk + idempotency
  risk_score            smallint not null default 0 check (risk_score between 0 and 100),
  risk_flags            text[] not null default '{}',
  idempotency_key       uuid,
  user_agent            text,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  unique (employee_id, idempotency_key),
  check (
    source <> 'employee' or (
      geofence_passed and network_passed and webauthn_passed
      and challenge_id is not null and credential_id is not null
      and latitude is not null and longitude is not null and client_ip is not null
      and idempotency_key is not null
    )
  ),
  check (source <> 'adjustment' or adjustment_id is not null)
);
create index attendance_events_employee_time_idx on public.attendance_events (employee_id, occurred_at desc);
create index attendance_events_date_idx on public.attendance_events (work_date);
create index attendance_events_session_idx on public.attendance_events (session_id);
create trigger attendance_events_immutable before update or delete on public.attendance_events
  for each row execute function app.prevent_mutation();
create trigger attendance_events_no_truncate before truncate on public.attendance_events
  for each statement execute function app.prevent_mutation();

alter table public.attendance_sessions
  add constraint attendance_sessions_check_in_event_fk foreign key (check_in_event_id) references public.attendance_events (id) deferrable initially deferred,
  add constraint attendance_sessions_check_out_event_fk foreign key (check_out_event_id) references public.attendance_events (id) deferrable initially deferred;

-- -----------------------------------------------------------------------------
-- breaks
-- -----------------------------------------------------------------------------
create table public.breaks (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references public.employees (id) on delete restrict,
  session_id        uuid not null references public.attendance_sessions (id) on delete restrict,
  start_event_id    uuid not null references public.attendance_events (id) deferrable initially deferred,
  end_event_id      uuid references public.attendance_events (id) deferrable initially deferred,
  started_at        timestamptz not null,
  ended_at          timestamptz,
  status            public.break_status not null default 'open',
  voided_by_adjustment_id uuid references public.attendance_adjustments (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (ended_at is null or ended_at > started_at),
  check ((status = 'closed') = (ended_at is not null) or status = 'voided')
);
create unique index breaks_one_open on public.breaks (employee_id) where status = 'open';
create index breaks_session_idx on public.breaks (session_id);
create trigger breaks_touch before update on public.breaks
  for each row execute function app.touch_updated_at();

alter table public.attendance_adjustments
  add constraint attendance_adjustments_session_fk foreign key (target_session_id) references public.attendance_sessions (id),
  add constraint attendance_adjustments_break_fk foreign key (target_break_id) references public.breaks (id);

-- -----------------------------------------------------------------------------
-- verification_attempts: IMMUTABLE security log of every attendance submission, accepted or
-- rejected, with the per-check result and failure reasons.
-- -----------------------------------------------------------------------------
create table public.verification_attempts (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references public.employees (id) on delete restrict,
  action            public.attendance_event_type not null,
  occurred_at       timestamptz not null default now(),
  outcome           public.verification_outcome not null,
  failure_reasons   text[] not null default '{}',
  latitude          double precision,
  longitude         double precision,
  location          extensions.geography(Point, 4326)
                      generated always as (
                        case when latitude is not null and longitude is not null
                          then extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography
                        end
                      ) stored,
  accuracy_m        numeric(9, 2),
  distance_m        numeric(12, 2),
  geofence_passed   boolean,
  client_ip         inet,
  network_passed    boolean,
  webauthn_passed   boolean,
  risk_score        smallint not null default 0,
  risk_flags        text[] not null default '{}',
  event_id          uuid references public.attendance_events (id),
  credential_id     uuid references public.webauthn_credentials (id) on delete set null,
  user_agent        text,
  check (outcome = 'rejected' or (event_id is not null and cardinality(failure_reasons) = 0))
);
create index verification_attempts_employee_idx on public.verification_attempts (employee_id, occurred_at desc);
create index verification_attempts_time_idx on public.verification_attempts (occurred_at desc);
create index verification_attempts_rejected_idx on public.verification_attempts (occurred_at desc) where outcome = 'rejected';
create trigger verification_attempts_immutable before update or delete on public.verification_attempts
  for each row execute function app.prevent_mutation();
create trigger verification_attempts_no_truncate before truncate on public.verification_attempts
  for each statement execute function app.prevent_mutation();

-- -----------------------------------------------------------------------------
-- attendance_days: computed daily results (attendance engine output). Fully derivable from
-- sessions/breaks/schedules/leave/holidays; `details` stores the inputs and policy used.
-- -----------------------------------------------------------------------------
create table public.attendance_days (
  employee_id           uuid not null references public.employees (id) on delete cascade,
  work_date             date not null,
  status                text not null check (status in ('present', 'absent', 'on_leave', 'holiday', 'day_off', 'in_progress', 'missing_checkout', 'scheduled')),
  is_working_day        boolean not null,
  is_holiday            boolean not null default false,
  leave_type_id         uuid references public.leave_types (id) on delete set null,
  leave_fraction        numeric(3, 2) not null default 0 check (leave_fraction between 0 and 1),
  first_check_in        timestamptz,
  last_check_out        timestamptz,
  scheduled_start       timestamptz,
  scheduled_end         timestamptz,
  gross_minutes         integer not null default 0 check (gross_minutes >= 0),
  break_minutes         integer not null default 0 check (break_minutes >= 0),
  unpaid_break_minutes  integer not null default 0 check (unpaid_break_minutes >= 0),
  net_minutes           integer not null default 0 check (net_minutes >= 0),
  required_minutes      integer not null default 0 check (required_minutes >= 0),
  late_minutes          integer not null default 0 check (late_minutes >= 0),
  early_leave_minutes   integer not null default 0 check (early_leave_minutes >= 0),
  overtime_minutes      integer not null default 0 check (overtime_minutes >= 0),
  shortage_minutes      integer not null default 0 check (shortage_minutes >= 0),
  flags                 text[] not null default '{}',
  details               jsonb not null default '{}',
  calc_version          text not null,
  computed_at           timestamptz not null default now(),
  primary key (employee_id, work_date)
);
create index attendance_days_date_idx on public.attendance_days (work_date);

create table public.monthly_summaries (
  employee_id             uuid not null references public.employees (id) on delete cascade,
  year                    integer not null check (year between 2000 and 2100),
  month                   integer not null check (month between 1 and 12),
  working_days            integer not null default 0,
  present_days            integer not null default 0,
  absence_days            integer not null default 0,
  leave_days              numeric(5, 1) not null default 0,
  holiday_days            integer not null default 0,
  late_count              integer not null default 0,
  late_minutes            integer not null default 0,
  net_minutes             integer not null default 0,
  required_minutes        integer not null default 0,
  overtime_minutes        integer not null default 0,
  shortage_minutes        integer not null default 0,
  attendance_percentage   numeric(5, 2) not null default 0 check (attendance_percentage between 0 and 100),
  details                 jsonb not null default '{}',
  calc_version            text not null,
  computed_at             timestamptz not null default now(),
  primary key (employee_id, year, month)
);

-- Payroll period lock: once locked, adjustments, leave decisions and recalculation for the
-- month are refused.
create table public.attendance_period_locks (
  year       integer not null check (year between 2000 and 2100),
  month      integer not null check (month between 1 and 12),
  locked_by  uuid,
  locked_at  timestamptz not null default now(),
  primary key (year, month)
);
