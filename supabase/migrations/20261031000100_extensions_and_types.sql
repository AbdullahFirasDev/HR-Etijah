-- =============================================================================
-- Etijah HR — 001: extensions, private schema, enum types, shared trigger helpers
-- =============================================================================
-- PostGIS and btree_gist live in the dedicated `extensions` schema (Supabase convention),
-- never in `public`, so they are not exposed through the Data API.

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- Private schema for RLS helpers and trigger functions. It is NOT in the exposed API schemas.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Enum types
-- -----------------------------------------------------------------------------
create type public.attendance_event_type as enum ('check_in', 'check_out', 'break_start', 'break_end');
create type public.attendance_source as enum ('employee', 'adjustment', 'system');
create type public.session_status as enum ('open', 'closed', 'missing_checkout', 'voided');
create type public.break_status as enum ('open', 'closed', 'voided');
create type public.credential_status as enum ('pending', 'active', 'revoked');
create type public.challenge_purpose as enum ('registration', 'attendance');
create type public.leave_status as enum ('pending', 'manager_approved', 'approved', 'rejected', 'cancelled');
create type public.adjustment_status as enum ('pending', 'approved', 'rejected');
create type public.adjustment_type as enum (
  'add_interval',       -- forgotten check-in + check-out
  'add_check_out',      -- close an open / missing-checkout session
  'correct_check_in',   -- supersede the check-in time of a session
  'correct_check_out',  -- supersede the check-out time of a session
  'void_session',       -- exclude a session from calculations
  'add_break',          -- record a forgotten break
  'void_break'          -- exclude a break from calculations
);
create type public.verification_outcome as enum ('accepted', 'rejected');

-- -----------------------------------------------------------------------------
-- Shared trigger helpers
-- -----------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Blocks UPDATE / DELETE / TRUNCATE on append-only tables (attendance events, audit logs, ...).
-- Corrections are modelled as new rows (see attendance_adjustments), never as rewrites.
create or replace function app.prevent_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Table %.% is append-only; % is not permitted', tg_table_schema, tg_table_name, tg_op
    using errcode = 'P0001', hint = 'Create an attendance adjustment instead of modifying history.';
end;
$$;
