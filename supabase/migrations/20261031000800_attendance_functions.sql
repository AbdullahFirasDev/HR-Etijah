-- =============================================================================
-- Etijah HR — 008: critical operations as database functions
-- =============================================================================
-- Backend-only (service_role):
--   consume_webauthn_challenge, record_attendance_event, flag_missing_checkouts,
--   purge_expired_security_data
-- User-callable (authenticated; authorisation re-checked inside, auth.uid() = caller):
--   request_attendance_adjustment, review_attendance_adjustment, review_leave_request,
--   cancel_leave_request, leave_balances_for, set_credential_status, set_user_role,
--   set_period_lock

-- -----------------------------------------------------------------------------
-- Atomically mark a challenge as used. Returns the challenge only if it belonged to the
-- user, matched purpose/action, was unused and unexpired. A second call returns NULL.
-- -----------------------------------------------------------------------------
create or replace function public.consume_webauthn_challenge(
  p_challenge_id uuid,
  p_user_id      uuid,
  p_purpose      public.challenge_purpose,
  p_action       public.attendance_event_type default null
)
returns text
language sql
security definer
set search_path = ''
as $$
  update public.webauthn_challenges c
     set used_at = now()
   where c.id = p_challenge_id
     and c.user_id = p_user_id
     and c.purpose = p_purpose
     and c.action is not distinct from p_action
     and c.used_at is null
     and c.expires_at > now()
  returning c.challenge
$$;

-- -----------------------------------------------------------------------------
-- record_attendance_event: the single entry point for employee attendance.
-- The backend has already verified the WebAuthn assertion (signature, origin, RP ID,
-- user verification, counter) and consumed the challenge; it passes the observed client IP
-- (resolved from trusted proxy configuration) and the raw GPS reading. This function
-- independently re-verifies everything it can and enforces the state machine:
--   A. geofence  — PostGIS distance to the employee's office geofence + accuracy + freshness
--   B. network   — client IP inside an active allowed CIDR
--   C. WebAuthn  — challenge consumed for this user+action, unused by any event, active credential
-- Every call is logged in verification_attempts. Idempotent on (employee, idempotency_key).
-- -----------------------------------------------------------------------------
create or replace function public.record_attendance_event(
  p_employee_id           uuid,
  p_event_type            public.attendance_event_type,
  p_idempotency_key       uuid,
  p_challenge_id          uuid,
  p_credential_id         uuid,
  p_webauthn_verified     boolean,
  p_latitude              double precision,
  p_longitude             double precision,
  p_accuracy_m            double precision,
  p_position_captured_at  timestamptz,
  p_client_ip             inet,
  p_work_date             date default null,
  p_risk_score            integer default 0,
  p_risk_flags            text[] default '{}',
  p_extra_reasons         text[] default '{}',
  p_user_agent            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_now              timestamptz := now();
  v_settings         public.org_settings;
  v_emp              record;
  v_dup              record;
  v_challenge        public.webauthn_challenges;
  v_cred_exists      boolean := false;
  v_cred_active      boolean := false;
  v_point            extensions.geography;
  v_geo              record;
  v_distance         double precision;
  v_geofence_id      uuid;
  v_geofence_passed  boolean := false;
  v_network_id       uuid;
  v_network_passed   boolean := false;
  v_webauthn_passed  boolean := false;
  v_reasons          text[] := coalesce(p_extra_reasons, '{}');
  v_session          public.attendance_sessions;
  v_break            public.breaks;
  v_event_id         uuid := gen_random_uuid();
  v_session_id       uuid;
  v_work_date        date;
  v_local_today      date;
  v_attempt_id       uuid;
  v_risk             integer := least(greatest(coalesce(p_risk_score, 0), 0), 100);
begin
  if p_employee_id is null or p_event_type is null or p_idempotency_key is null then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;

  -- Serialise attendance writes per employee: concurrent submissions cannot interleave.
  perform pg_advisory_xact_lock(hashtextextended('attendance:' || p_employee_id::text, 0));

  -- Idempotent replay of an already-accepted submission (same key → same result).
  select e.id, e.event_type, e.occurred_at, e.session_id, e.work_date into v_dup
    from public.attendance_events e
   where e.employee_id = p_employee_id and e.idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'ok', true, 'duplicate', true, 'event_id', v_dup.id, 'event_type', v_dup.event_type,
      'occurred_at', v_dup.occurred_at, 'session_id', v_dup.session_id, 'work_date', v_dup.work_date);
  end if;

  select * into v_settings from public.org_settings where id = 1;
  v_local_today := (v_now at time zone v_settings.timezone)::date;

  select e.id, e.office_id, e.status, e.profile_id, p.is_active as profile_active into v_emp
    from public.employees e
    join public.profiles p on p.id = e.profile_id
   where e.id = p_employee_id;
  if not found then
    raise exception 'employee_not_found' using errcode = 'P0002';
  end if;
  if v_emp.status <> 'active' or not v_emp.profile_active then
    v_reasons := array_append(v_reasons, 'employee_inactive');
  end if;

  -- ---- C. WebAuthn -----------------------------------------------------------
  select * into v_challenge from public.webauthn_challenges c where c.id = p_challenge_id;
  if v_challenge.id is null
     or v_challenge.user_id <> v_emp.profile_id
     or v_challenge.purpose <> 'attendance'
     or v_challenge.action is distinct from p_event_type
     or v_challenge.used_at is null
     or v_challenge.used_at < v_now - interval '2 minutes' then
    v_reasons := array_append(v_reasons, 'challenge_invalid');
  elsif exists (select 1 from public.attendance_events e where e.challenge_id = p_challenge_id) then
    v_reasons := array_append(v_reasons, 'challenge_replayed');
  end if;

  select true, c.status = 'active' into v_cred_exists, v_cred_active
    from public.webauthn_credentials c
   where c.id = p_credential_id and c.employee_id = p_employee_id;
  v_cred_exists := coalesce(v_cred_exists, false);
  v_cred_active := coalesce(v_cred_active, false);
  if not v_cred_active then
    v_reasons := array_append(v_reasons, 'device_not_authorized');
  end if;
  if not coalesce(p_webauthn_verified, false) then
    v_reasons := array_append(v_reasons, 'biometric_failed');
  end if;
  v_webauthn_passed := coalesce(p_webauthn_verified, false) and v_cred_active
    and not (v_reasons && array['challenge_invalid', 'challenge_replayed']);

  -- ---- A. Geofence (authoritative distance computed by PostGIS) -----------------
  if p_latitude is null or p_longitude is null or p_accuracy_m is null then
    v_reasons := array_append(v_reasons, 'location_unavailable');
  elsif p_latitude not between -90 and 90 or p_longitude not between -180 and 180 or p_accuracy_m < 0 then
    v_reasons := array_append(v_reasons, 'location_invalid');
  else
    v_point := extensions.st_setsrid(extensions.st_makepoint(p_longitude, p_latitude), 4326)::extensions.geography;
    select g.id, g.radius_m, g.max_accuracy_m, extensions.st_distance(g.center, v_point) as distance_m
      into v_geo
      from public.geofences g
      join public.offices o on o.id = g.office_id
     where g.is_active and o.is_active
       and (v_emp.office_id is null or g.office_id = v_emp.office_id)
     order by extensions.st_distance(g.center, v_point) - g.radius_m
     limit 1;
    if not found then
      v_reasons := array_append(v_reasons, 'no_geofence_configured');
    else
      v_geofence_id := v_geo.id;
      v_distance := v_geo.distance_m;
      if p_accuracy_m > v_geo.max_accuracy_m then
        v_reasons := array_append(v_reasons, 'gps_accuracy_insufficient');
      end if;
      if v_geo.distance_m > v_geo.radius_m then
        v_reasons := array_append(v_reasons, 'outside_geofence');
      end if;
      v_geofence_passed := p_accuracy_m <= v_geo.max_accuracy_m and v_geo.distance_m <= v_geo.radius_m;
    end if;
    if p_position_captured_at is null
       or p_position_captured_at < v_now - make_interval(secs => v_settings.max_location_age_seconds)
       or p_position_captured_at > v_now + interval '5 seconds' then
      v_reasons := array_append(v_reasons, 'location_stale');
      v_geofence_passed := false;
    end if;
  end if;
  if v_risk >= v_settings.risk_block_threshold then
    v_reasons := array_append(v_reasons, 'location_spoofing_suspected');
    v_geofence_passed := false;
  end if;

  -- ---- B. Network ---------------------------------------------------------------
  if p_client_ip is null then
    v_reasons := array_append(v_reasons, 'network_unknown');
  else
    select n.id into v_network_id
      from public.allowed_networks n
     where n.is_active
       and (n.office_id is null or v_emp.office_id is null or n.office_id = v_emp.office_id)
       and p_client_ip <<= n.cidr
     order by masklen(n.cidr) desc
     limit 1;
    v_network_passed := v_network_id is not null;
    if not v_network_passed then
      v_reasons := array_append(v_reasons, 'unauthorized_network');
    end if;
  end if;

  -- ---- State machine --------------------------------------------------------------
  select * into v_session
    from public.attendance_sessions s
   where s.employee_id = p_employee_id and s.status = 'open'
   for update;

  if p_event_type = 'check_in' then
    if v_session.id is not null then
      v_reasons := array_append(v_reasons, 'already_checked_in');
    end if;
    v_work_date := coalesce(p_work_date, v_local_today);
    if v_work_date not between v_local_today - 1 and v_local_today then
      raise exception 'invalid_work_date' using errcode = '22023';
    end if;
    if not v_settings.allow_multiple_sessions and exists (
      select 1 from public.attendance_sessions s
       where s.employee_id = p_employee_id and s.work_date = v_work_date and s.status in ('closed', 'missing_checkout')
    ) then
      v_reasons := array_append(v_reasons, 'already_completed_today');
    end if;
  elsif v_session.id is null then
    v_reasons := array_append(v_reasons, 'not_checked_in');
  else
    v_work_date := v_session.work_date;
    select * into v_break
      from public.breaks b
     where b.session_id = v_session.id and b.status = 'open'
     for update;
    if p_event_type = 'break_start' and v_break.id is not null then
      v_reasons := array_append(v_reasons, 'break_already_started');
    elsif p_event_type = 'break_end' and v_break.id is null then
      v_reasons := array_append(v_reasons, 'no_active_break');
    end if;
  end if;
  if v_work_date is not null and app.is_period_locked(v_work_date) then
    v_reasons := array_append(v_reasons, 'period_locked');
  end if;

  if cardinality(v_reasons) = 0 and not (v_geofence_passed and v_network_passed and v_webauthn_passed) then
    v_reasons := array_append(v_reasons, 'verification_failed'); -- defensive: never accept a partial pass
  end if;

  -- ---- Rejected -----------------------------------------------------------------------
  if cardinality(v_reasons) > 0 then
    insert into public.verification_attempts (
      employee_id, action, occurred_at, outcome, failure_reasons, latitude, longitude, accuracy_m,
      distance_m, geofence_passed, client_ip, network_passed, webauthn_passed, risk_score, risk_flags,
      credential_id, user_agent)
    values (
      p_employee_id, p_event_type, v_now, 'rejected',
      (select array_agg(distinct r order by r) from unnest(v_reasons) r),
      p_latitude, p_longitude, p_accuracy_m, round(v_distance::numeric, 2), v_geofence_passed,
      p_client_ip, v_network_passed, v_webauthn_passed, v_risk, coalesce(p_risk_flags, '{}'),
      case when v_cred_exists then p_credential_id end, left(p_user_agent, 500))
    returning id into v_attempt_id;

    return jsonb_build_object(
      'ok', false,
      'attempt_id', v_attempt_id,
      'reasons', (select to_jsonb(array_agg(distinct r order by r)) from unnest(v_reasons) r),
      'checks', jsonb_build_object('geofence', v_geofence_passed, 'network', v_network_passed, 'webauthn', v_webauthn_passed),
      'distance_m', round(v_distance::numeric, 1));
  end if;

  -- ---- Accepted ---------------------------------------------------------------------
  v_session_id := coalesce(v_session.id, gen_random_uuid());

  insert into public.attendance_events (
    id, employee_id, session_id, event_type, occurred_at, work_date, source,
    latitude, longitude, accuracy_m, position_captured_at, geofence_id, distance_m, geofence_passed,
    client_ip, network_id, network_passed, credential_id, challenge_id, webauthn_passed,
    risk_score, risk_flags, idempotency_key, user_agent, created_by)
  values (
    v_event_id, p_employee_id, v_session_id, p_event_type, v_now, v_work_date, 'employee',
    p_latitude, p_longitude, p_accuracy_m, p_position_captured_at, v_geofence_id, round(v_distance::numeric, 2), true,
    p_client_ip, v_network_id, true, p_credential_id, p_challenge_id, true,
    v_risk, coalesce(p_risk_flags, '{}'), p_idempotency_key, left(p_user_agent, 500), v_emp.profile_id);

  if p_event_type = 'check_in' then
    insert into public.attendance_sessions (id, employee_id, work_date, check_in_event_id, check_in_at, status)
    values (v_session_id, p_employee_id, v_work_date, v_event_id, v_now, 'open');
  elsif p_event_type = 'check_out' then
    if v_break.id is not null then
      update public.breaks
         set ended_at = v_now, end_event_id = v_event_id, status = 'closed'
       where id = v_break.id;
    end if;
    update public.attendance_sessions
       set check_out_event_id = v_event_id, check_out_at = v_now, status = 'closed', closed_by = 'employee'
     where id = v_session_id;
  elsif p_event_type = 'break_start' then
    insert into public.breaks (employee_id, session_id, start_event_id, started_at, status)
    values (p_employee_id, v_session_id, v_event_id, v_now, 'open');
  else -- break_end
    update public.breaks
       set ended_at = v_now, end_event_id = v_event_id, status = 'closed'
     where id = v_break.id;
  end if;

  update public.webauthn_credentials set last_used_at = v_now where id = p_credential_id;

  insert into public.verification_attempts (
    employee_id, action, occurred_at, outcome, latitude, longitude, accuracy_m, distance_m,
    geofence_passed, client_ip, network_passed, webauthn_passed, risk_score, risk_flags,
    event_id, credential_id, user_agent)
  values (
    p_employee_id, p_event_type, v_now, 'accepted', p_latitude, p_longitude, p_accuracy_m,
    round(v_distance::numeric, 2), true, p_client_ip, true, true, v_risk, coalesce(p_risk_flags, '{}'),
    v_event_id, p_credential_id, left(p_user_agent, 500));

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'event_id', v_event_id,
    'event_type', p_event_type,
    'occurred_at', v_now,
    'session_id', v_session_id,
    'work_date', v_work_date,
    'distance_m', round(v_distance::numeric, 1),
    'geofence_id', v_geofence_id,
    'network_id', v_network_id,
    'risk_score', v_risk);
end;
$$;

-- -----------------------------------------------------------------------------
-- Missing check-out detection: sessions open longer than org_settings.auto_close_after_hours
-- become `missing_checkout` (excluded or capped by policy; HR corrects via adjustment).
-- -----------------------------------------------------------------------------
create or replace function public.flag_missing_checkouts()
returns table (session_id uuid, employee_id uuid, work_date date)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_hours integer;
begin
  select s.auto_close_after_hours into v_hours from public.org_settings s where s.id = 1;
  return query
  with flagged as (
    update public.attendance_sessions s
       set status = 'missing_checkout', closed_by = 'system'
     where s.status = 'open'
       and s.check_in_at < now() - make_interval(hours => v_hours)
    returning s.id, s.employee_id, s.work_date
  ), voided as (
    update public.breaks b
       set status = 'voided'
      from flagged f
     where b.session_id = f.id and b.status = 'open'
    returning b.id
  )
  select f.id, f.employee_id, f.work_date from flagged f;
end;
$$;

create or replace function public.purge_expired_security_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_challenges integer;
  v_sessions integer;
begin
  -- challenges referenced by attendance events are kept (FK keeps the audit trail intact)
  delete from public.webauthn_challenges c
   where c.expires_at < now() - interval '1 day'
     and not exists (select 1 from public.attendance_events e where e.challenge_id = c.id);
  get diagnostics v_challenges = row_count;
  delete from public.app_sessions s
   where coalesce(s.revoked_at, s.absolute_expires_at) < now() - interval '30 days';
  get diagnostics v_sessions = row_count;
  return jsonb_build_object('challenges', v_challenges, 'sessions', v_sessions);
end;
$$;

-- -----------------------------------------------------------------------------
-- Attendance adjustments
-- -----------------------------------------------------------------------------
create or replace function public.request_attendance_adjustment(
  p_employee_id        uuid,
  p_work_date          date,
  p_type               public.adjustment_type,
  p_target_session_id  uuid,
  p_target_break_id    uuid,
  p_new_start_at       timestamptz,
  p_new_end_at         timestamptz,
  p_reason             text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_tz    text;
  v_sess  public.attendance_sessions;
  v_brk   public.breaks;
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not (
    p_employee_id = app.current_employee_id()
    or app.can_manage_employee(p_employee_id, 'attendance.adjust')
    or app.can_manage_employee(p_employee_id, 'attendance.request_adjustment')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  select s.timezone into v_tz from public.org_settings s where s.id = 1;
  if p_work_date is null or p_work_date > (now() at time zone v_tz)::date then
    raise exception 'invalid_work_date' using errcode = '22023';
  end if;
  if app.is_period_locked(p_work_date) then
    raise exception 'period_locked' using errcode = 'P0001';
  end if;
  if p_new_start_at > now() or p_new_end_at > now() then
    raise exception 'future_time' using errcode = '22023';
  end if;

  if p_type in ('add_check_out', 'correct_check_in', 'correct_check_out', 'void_session', 'add_break') then
    select * into v_sess from public.attendance_sessions s
     where s.id = p_target_session_id and s.employee_id = p_employee_id;
    if v_sess.id is null then
      raise exception 'target_session_not_found' using errcode = 'P0002';
    end if;
    if v_sess.status = 'voided' then
      raise exception 'target_session_voided' using errcode = '22023';
    end if;
  end if;

  case p_type
    when 'add_interval' then
      if p_new_start_at is null or p_new_end_at is null or p_new_end_at <= p_new_start_at
         or p_new_end_at - p_new_start_at > interval '24 hours' then
        raise exception 'invalid_interval' using errcode = '22023';
      end if;
    when 'add_check_out' then
      if v_sess.status not in ('open', 'missing_checkout') then
        raise exception 'session_already_closed' using errcode = '22023';
      end if;
      if p_new_end_at is null or p_new_end_at <= v_sess.check_in_at then
        raise exception 'invalid_interval' using errcode = '22023';
      end if;
    when 'correct_check_in' then
      if p_new_start_at is null or p_new_start_at >= coalesce(v_sess.check_out_at, now()) then
        raise exception 'invalid_interval' using errcode = '22023';
      end if;
    when 'correct_check_out' then
      if v_sess.status <> 'closed' then
        raise exception 'session_not_closed' using errcode = '22023';
      end if;
      if p_new_end_at is null or p_new_end_at <= v_sess.check_in_at then
        raise exception 'invalid_interval' using errcode = '22023';
      end if;
    when 'add_break' then
      if p_new_start_at is null or p_new_end_at is null or p_new_end_at <= p_new_start_at
         or p_new_start_at < v_sess.check_in_at or p_new_end_at > coalesce(v_sess.check_out_at, now()) then
        raise exception 'invalid_interval' using errcode = '22023';
      end if;
    when 'void_break' then
      select * into v_brk from public.breaks b
       where b.id = p_target_break_id and b.employee_id = p_employee_id;
      if v_brk.id is null then
        raise exception 'target_break_not_found' using errcode = 'P0002';
      end if;
      if v_brk.status = 'voided' then
        raise exception 'target_break_voided' using errcode = '22023';
      end if;
    else
      null; -- void_session needs only the target session
  end case;

  insert into public.attendance_adjustments (
    employee_id, work_date, adjustment_type, target_session_id, target_break_id,
    new_start_at, new_end_at, reason, status, requested_by)
  values (
    p_employee_id, p_work_date, p_type,
    case when p_type in ('add_check_out', 'correct_check_in', 'correct_check_out', 'void_session', 'add_break') then p_target_session_id end,
    case when p_type = 'void_break' then p_target_break_id end,
    p_new_start_at, p_new_end_at, trim(p_reason), 'pending', v_uid)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.review_attendance_adjustment(
  p_adjustment_id uuid,
  p_approve       boolean,
  p_note          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_adj   public.attendance_adjustments;
  v_sess  public.attendance_sessions;
  v_brk   public.breaks;
  v_sid   uuid;
  v_e1    uuid := gen_random_uuid();
  v_e2    uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_adj from public.attendance_adjustments a where a.id = p_adjustment_id for update;
  if v_adj.id is null then
    raise exception 'adjustment_not_found' using errcode = 'P0002';
  end if;
  if not app.can_manage_employee(v_adj.employee_id, 'attendance.adjust') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_adj.employee_id = app.current_employee_id() and app.current_role_key() <> 'owner' then
    raise exception 'self_approval_forbidden' using errcode = '42501';
  end if;
  if v_adj.status <> 'pending' then
    raise exception 'adjustment_not_pending' using errcode = '22023';
  end if;
  if app.is_period_locked(v_adj.work_date) then
    raise exception 'period_locked' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('attendance:' || v_adj.employee_id::text, 0));

  if not p_approve then
    update public.attendance_adjustments
       set status = 'rejected', reviewed_by = v_uid, reviewed_at = now(), review_note = p_note
     where id = v_adj.id;
    return jsonb_build_object('status', 'rejected', 'employee_id', v_adj.employee_id, 'work_date', v_adj.work_date);
  end if;

  if v_adj.target_session_id is not null then
    select * into v_sess from public.attendance_sessions s where s.id = v_adj.target_session_id for update;
    if v_sess.status = 'voided' then
      raise exception 'target_session_voided' using errcode = '22023';
    end if;
  end if;

  case v_adj.adjustment_type
    when 'add_interval' then
      if exists (
        select 1 from public.attendance_sessions s
         where s.employee_id = v_adj.employee_id and s.status = 'open' and s.check_in_at < v_adj.new_end_at
      ) then
        raise exception 'overlaps_open_session' using errcode = '23P01';
      end if;
      v_sid := gen_random_uuid();
      insert into public.attendance_events (id, employee_id, session_id, event_type, occurred_at, work_date, source, adjustment_id, created_by)
      values
        (v_e1, v_adj.employee_id, v_sid, 'check_in', v_adj.new_start_at, v_adj.work_date, 'adjustment', v_adj.id, v_uid),
        (v_e2, v_adj.employee_id, v_sid, 'check_out', v_adj.new_end_at, v_adj.work_date, 'adjustment', v_adj.id, v_uid);
      insert into public.attendance_sessions (id, employee_id, work_date, check_in_event_id, check_out_event_id, check_in_at, check_out_at, status, closed_by)
      values (v_sid, v_adj.employee_id, v_adj.work_date, v_e1, v_e2, v_adj.new_start_at, v_adj.new_end_at, 'closed', 'adjustment');

    when 'add_check_out' then
      if v_sess.status not in ('open', 'missing_checkout') then
        raise exception 'session_already_closed' using errcode = '22023';
      end if;
      insert into public.attendance_events (id, employee_id, session_id, event_type, occurred_at, work_date, source, adjustment_id, created_by)
      values (v_e1, v_adj.employee_id, v_sess.id, 'check_out', v_adj.new_end_at, v_sess.work_date, 'adjustment', v_adj.id, v_uid);
      update public.breaks b
         set ended_at = v_adj.new_end_at, end_event_id = v_e1, status = 'closed'
       where b.session_id = v_sess.id and b.status = 'open' and b.started_at < v_adj.new_end_at;
      update public.breaks b set status = 'voided', voided_by_adjustment_id = v_adj.id
       where b.session_id = v_sess.id and b.status = 'open';
      update public.attendance_sessions
         set check_out_event_id = v_e1, check_out_at = v_adj.new_end_at, status = 'closed', closed_by = 'adjustment'
       where id = v_sess.id;

    when 'correct_check_in' then
      insert into public.attendance_events (id, employee_id, session_id, event_type, occurred_at, work_date, source, adjustment_id, created_by)
      values (v_e1, v_adj.employee_id, v_sess.id, 'check_in', v_adj.new_start_at, v_sess.work_date, 'adjustment', v_adj.id, v_uid);
      update public.attendance_sessions
         set check_in_event_id = v_e1, check_in_at = v_adj.new_start_at
       where id = v_sess.id;

    when 'correct_check_out' then
      if v_sess.status <> 'closed' then
        raise exception 'session_not_closed' using errcode = '22023';
      end if;
      insert into public.attendance_events (id, employee_id, session_id, event_type, occurred_at, work_date, source, adjustment_id, created_by)
      values (v_e1, v_adj.employee_id, v_sess.id, 'check_out', v_adj.new_end_at, v_sess.work_date, 'adjustment', v_adj.id, v_uid);
      update public.attendance_sessions
         set check_out_event_id = v_e1, check_out_at = v_adj.new_end_at
       where id = v_sess.id;

    when 'void_session' then
      update public.breaks set status = 'voided', voided_by_adjustment_id = v_adj.id
       where session_id = v_sess.id and status <> 'voided';
      update public.attendance_sessions set status = 'voided', voided_by_adjustment_id = v_adj.id
       where id = v_sess.id;

    when 'add_break' then
      if v_adj.new_start_at < v_sess.check_in_at or v_adj.new_end_at > coalesce(v_sess.check_out_at, now()) then
        raise exception 'invalid_interval' using errcode = '22023';
      end if;
      insert into public.attendance_events (id, employee_id, session_id, event_type, occurred_at, work_date, source, adjustment_id, created_by)
      values
        (v_e1, v_adj.employee_id, v_sess.id, 'break_start', v_adj.new_start_at, v_sess.work_date, 'adjustment', v_adj.id, v_uid),
        (v_e2, v_adj.employee_id, v_sess.id, 'break_end', v_adj.new_end_at, v_sess.work_date, 'adjustment', v_adj.id, v_uid);
      insert into public.breaks (employee_id, session_id, start_event_id, end_event_id, started_at, ended_at, status)
      values (v_adj.employee_id, v_sess.id, v_e1, v_e2, v_adj.new_start_at, v_adj.new_end_at, 'closed');

    when 'void_break' then
      select * into v_brk from public.breaks b where b.id = v_adj.target_break_id for update;
      if v_brk.status = 'voided' then
        raise exception 'target_break_voided' using errcode = '22023';
      end if;
      update public.breaks set status = 'voided', voided_by_adjustment_id = v_adj.id where id = v_brk.id;
  end case;

  update public.attendance_adjustments
     set status = 'approved', reviewed_by = v_uid, reviewed_at = now(), review_note = p_note, applied_at = now()
   where id = v_adj.id;

  return jsonb_build_object('status', 'approved', 'employee_id', v_adj.employee_id, 'work_date', v_adj.work_date);
end;
$$;

-- -----------------------------------------------------------------------------
-- Leave
-- -----------------------------------------------------------------------------
create or replace function app.leave_remaining_days(
  p_employee_id     uuid,
  p_leave_type_id   uuid,
  p_year            integer,
  p_exclude_request uuid default null
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
           (select b.allocated_days + b.carried_over_days from public.leave_balances b
             where b.employee_id = p_employee_id and b.leave_type_id = p_leave_type_id and b.year = p_year),
           (select t.annual_allowance_days from public.leave_types t where t.id = p_leave_type_id),
           0)
       - coalesce(
           (select sum(r.days_count) from public.leave_requests r
             where r.employee_id = p_employee_id and r.leave_type_id = p_leave_type_id
               and r.status = 'approved' and extract(year from r.start_date)::int = p_year
               and r.id is distinct from p_exclude_request),
           0)
$$;

create or replace function public.leave_balances_for(p_employee_id uuid, p_year integer)
returns table (
  leave_type_id uuid, code text, name_ar text, name_en text, tracks_balance boolean,
  allocated_days numeric, carried_over_days numeric, used_days numeric, pending_days numeric, remaining_days numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.can_read_employee(p_employee_id, 'leave.read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select t.id, t.code, t.name_ar, t.name_en, t.tracks_balance,
         coalesce(b.allocated_days, t.annual_allowance_days),
         coalesce(b.carried_over_days, 0::numeric),
         coalesce((select sum(r.days_count) from public.leave_requests r
                    where r.employee_id = p_employee_id and r.leave_type_id = t.id and r.status = 'approved'
                      and extract(year from r.start_date)::int = p_year), 0::numeric),
         coalesce((select sum(r.days_count) from public.leave_requests r
                    where r.employee_id = p_employee_id and r.leave_type_id = t.id and r.status in ('pending', 'manager_approved')
                      and extract(year from r.start_date)::int = p_year), 0::numeric),
         app.leave_remaining_days(p_employee_id, t.id, p_year)
    from public.leave_types t
    left join public.leave_balances b on b.leave_type_id = t.id and b.employee_id = p_employee_id and b.year = p_year
   where t.is_active
   order by t.code;
end;
$$;

create or replace function public.review_leave_request(
  p_request_id uuid,
  p_approve    boolean,
  p_note       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_req       public.leave_requests;
  v_type      public.leave_types;
  v_settings  public.org_settings;
  v_scope     text := app.current_scope();
  v_month     date;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_req from public.leave_requests r where r.id = p_request_id for update;
  if v_req.id is null then
    raise exception 'leave_request_not_found' using errcode = 'P0002';
  end if;
  if not app.can_manage_employee(v_req.employee_id, 'leave.approve') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_req.employee_id = app.current_employee_id() and app.current_role_key() <> 'owner' then
    raise exception 'self_approval_forbidden' using errcode = '42501';
  end if;
  if v_req.status not in ('pending', 'manager_approved') then
    raise exception 'leave_not_pending' using errcode = '22023';
  end if;
  select * into v_settings from public.org_settings where id = 1;

  if not p_approve then
    update public.leave_requests
       set status = 'rejected', reviewed_by = v_uid, reviewed_at = now(), review_note = p_note
     where id = v_req.id;
    return jsonb_build_object('status', 'rejected', 'employee_id', v_req.employee_id,
      'start_date', v_req.start_date, 'end_date', v_req.end_date);
  end if;

  if v_scope = 'department' then
    if v_req.status = 'manager_approved' then
      raise exception 'awaiting_hr_approval' using errcode = '22023';
    end if;
    if v_settings.leave_approval_flow = 'two_step' then
      update public.leave_requests
         set status = 'manager_approved', manager_reviewed_by = v_uid, manager_reviewed_at = now(), manager_note = p_note
       where id = v_req.id;
      return jsonb_build_object('status', 'manager_approved', 'employee_id', v_req.employee_id,
        'start_date', v_req.start_date, 'end_date', v_req.end_date);
    end if;
  end if;

  -- final approval
  for v_month in
    select generate_series(date_trunc('month', v_req.start_date), date_trunc('month', v_req.end_date), interval '1 month')::date
  loop
    if app.is_period_locked(v_month) then
      raise exception 'period_locked' using errcode = 'P0001';
    end if;
  end loop;

  select * into v_type from public.leave_types where id = v_req.leave_type_id;
  if v_type.tracks_balance and not v_settings.allow_negative_leave_balance
     and app.leave_remaining_days(v_req.employee_id, v_req.leave_type_id, extract(year from v_req.start_date)::int, v_req.id) < v_req.days_count then
    raise exception 'insufficient_leave_balance' using errcode = 'P0001';
  end if;

  update public.leave_requests
     set status = 'approved', reviewed_by = v_uid, reviewed_at = now(), review_note = p_note,
         manager_reviewed_by = case when v_scope = 'department' then v_uid else manager_reviewed_by end,
         manager_reviewed_at = case when v_scope = 'department' then now() else manager_reviewed_at end
   where id = v_req.id;
  return jsonb_build_object('status', 'approved', 'employee_id', v_req.employee_id,
    'start_date', v_req.start_date, 'end_date', v_req.end_date);
end;
$$;

create or replace function public.cancel_leave_request(p_request_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_req  public.leave_requests;
  v_tz   text;
  v_own  boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_req from public.leave_requests r where r.id = p_request_id for update;
  if v_req.id is null then
    raise exception 'leave_request_not_found' using errcode = 'P0002';
  end if;
  select s.timezone into v_tz from public.org_settings s where s.id = 1;
  v_own := v_req.employee_id = app.current_employee_id();

  if app.can_manage_employee(v_req.employee_id, 'leave.manage') and not (v_own and app.current_role_key() <> 'owner') then
    if v_req.status not in ('pending', 'manager_approved', 'approved') then
      raise exception 'cannot_cancel' using errcode = '22023';
    end if;
  elsif v_own then
    if not (v_req.status in ('pending', 'manager_approved')
            or (v_req.status = 'approved' and v_req.start_date > (now() at time zone v_tz)::date)) then
      raise exception 'cannot_cancel' using errcode = '22023';
    end if;
  else
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_req.status = 'approved' and (app.is_period_locked(v_req.start_date) or app.is_period_locked(v_req.end_date)) then
    raise exception 'period_locked' using errcode = 'P0001';
  end if;

  update public.leave_requests
     set status = 'cancelled', cancelled_at = now(), review_note = coalesce(p_note, review_note)
   where id = v_req.id;
  return jsonb_build_object('status', 'cancelled', 'employee_id', v_req.employee_id,
    'start_date', v_req.start_date, 'end_date', v_req.end_date, 'was_approved', v_req.status = 'approved');
end;
$$;

-- -----------------------------------------------------------------------------
-- Devices
-- -----------------------------------------------------------------------------
create or replace function public.set_credential_status(
  p_credential_id uuid,
  p_status        public.credential_status,
  p_reason        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_cred  public.webauthn_credentials;
  v_max   integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_cred from public.webauthn_credentials c where c.id = p_credential_id for update;
  if v_cred.id is null then
    raise exception 'credential_not_found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('devices:' || v_cred.employee_id::text, 0));

  if p_status = 'revoked' then
    if not (v_cred.employee_id = app.current_employee_id() or app.can_manage_employee(v_cred.employee_id, 'devices.manage')) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if v_cred.status <> 'revoked' then
      update public.webauthn_credentials
         set status = 'revoked', revoked_by = v_uid, revoked_at = now(), revoke_reason = left(p_reason, 500)
       where id = v_cred.id;
    end if;
  elsif p_status = 'active' then
    if not app.can_manage_employee(v_cred.employee_id, 'devices.manage') then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if v_cred.employee_id = app.current_employee_id() and app.current_role_key() <> 'owner' then
      raise exception 'self_approval_forbidden' using errcode = '42501';
    end if;
    if v_cred.status <> 'pending' then
      raise exception 'credential_not_pending' using errcode = '22023';
    end if;
    select s.max_devices_per_employee into v_max from public.org_settings s where s.id = 1;
    if (select count(*) from public.webauthn_credentials c
         where c.employee_id = v_cred.employee_id and c.status = 'active') >= v_max then
      raise exception 'device_limit_reached' using errcode = 'P0001';
    end if;
    update public.webauthn_credentials
       set status = 'active', approved_by = v_uid, approved_at = now()
     where id = v_cred.id;
  else
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  return jsonb_build_object('id', v_cred.id, 'employee_id', v_cred.employee_id, 'status', p_status);
end;
$$;

-- -----------------------------------------------------------------------------
-- Roles
-- -----------------------------------------------------------------------------
create or replace function public.set_user_role(p_user_id uuid, p_role_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid          uuid := auth.uid();
  v_actor_role   text := app.current_role_key();
  v_target_role  text;
  v_role_id      smallint;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_user_id = v_uid then
    raise exception 'cannot_change_own_role' using errcode = '42501';
  end if;
  if app.current_scope() is distinct from 'organization' or not app.has_permission('employees.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select r.key into v_target_role from public.profiles p join public.roles r on r.id = p.role_id where p.id = p_user_id;
  if v_target_role is null then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  select r.id into v_role_id from public.roles r where r.key = p_role_key;
  if v_role_id is null then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if (p_role_key in ('owner', 'hr_manager') or v_target_role in ('owner', 'hr_manager')) and v_actor_role <> 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_target_role = 'owner' and p_role_key <> 'owner' and (
    select count(*) from public.profiles p join public.roles r on r.id = p.role_id where r.key = 'owner' and p.is_active
  ) <= 1 then
    raise exception 'last_owner' using errcode = 'P0001';
  end if;

  update public.profiles set role_id = v_role_id where id = p_user_id;
  if p_role_key <> 'department_manager' then
    delete from public.department_managers where user_id = p_user_id;
  end if;
  return jsonb_build_object('user_id', p_user_id, 'role', p_role_key);
end;
$$;

-- -----------------------------------------------------------------------------
-- Payroll period lock
-- -----------------------------------------------------------------------------
create or replace function public.set_period_lock(p_year integer, p_month integer, p_locked boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_permission('attendance.lock') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_locked then
    insert into public.attendance_period_locks (year, month, locked_by)
    values (p_year, p_month, auth.uid())
    on conflict (year, month) do nothing;
  else
    delete from public.attendance_period_locks where year = p_year and month = p_month;
  end if;
  return jsonb_build_object('year', p_year, 'month', p_month, 'locked', p_locked);
end;
$$;

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
grant execute on function
  public.request_attendance_adjustment(uuid, date, public.adjustment_type, uuid, uuid, timestamptz, timestamptz, text),
  public.review_attendance_adjustment(uuid, boolean, text),
  public.review_leave_request(uuid, boolean, text),
  public.cancel_leave_request(uuid, text),
  public.leave_balances_for(uuid, integer),
  public.set_credential_status(uuid, public.credential_status, text),
  public.set_user_role(uuid, text),
  public.set_period_lock(integer, integer, boolean)
  to authenticated;

revoke all on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;
