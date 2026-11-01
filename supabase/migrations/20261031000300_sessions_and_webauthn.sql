-- =============================================================================
-- Etijah HR — 003: server-side application sessions, devices, WebAuthn
-- =============================================================================

-- -----------------------------------------------------------------------------
-- app_sessions: the login session behind the HttpOnly cookie. Only the SHA-256 hash of
-- the cookie token is stored. Absolute + idle expiry are enforced by the backend on every
-- request and expired rows are revoked (and the Supabase refresh token signed out).
-- Backend-only table: RLS enabled with no policies.
-- -----------------------------------------------------------------------------
create table public.app_sessions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.profiles (id) on delete cascade,
  token_hash            text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  access_token_enc      text not null,           -- AES-256-GCM encrypted Supabase access token
  created_at            timestamptz not null default now(),
  last_activity_at      timestamptz not null default now(),
  absolute_expires_at   timestamptz not null,
  idle_timeout_seconds  integer not null check (idle_timeout_seconds between 60 and 86400),
  revoked_at            timestamptz,
  revoke_reason         text check (revoke_reason in ('logout', 'absolute_timeout', 'idle_timeout', 'admin', 'password_change', 'account_disabled')),
  ip                    inet,
  user_agent            text,
  check (absolute_expires_at > created_at)
);
create index app_sessions_user_idx on public.app_sessions (user_id) where revoked_at is null;
create index app_sessions_expiry_idx on public.app_sessions (absolute_expires_at) where revoked_at is null;

-- -----------------------------------------------------------------------------
-- employee_devices: a physical device / browser profile holding a platform authenticator.
-- -----------------------------------------------------------------------------
create table public.employee_devices (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees (id) on delete cascade,
  label         text not null check (length(trim(label)) between 1 and 80),
  platform      text,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);
create index employee_devices_employee_idx on public.employee_devices (employee_id);

-- -----------------------------------------------------------------------------
-- webauthn_credentials: public-key credentials only. No biometric data is ever stored or
-- received — WebAuthn only reveals that the authenticator performed user verification.
-- -----------------------------------------------------------------------------
create table public.webauthn_credentials (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.employees (id) on delete cascade,
  user_id             uuid not null references public.profiles (id) on delete cascade,
  device_id           uuid references public.employee_devices (id) on delete set null,
  credential_id       text not null unique check (credential_id ~ '^[A-Za-z0-9_-]+$'), -- base64url
  public_key          bytea not null,
  counter             bigint not null default 0 check (counter >= 0),
  transports          text[] not null default '{}',
  aaguid              text,
  authenticator_name  text,
  device_type         text check (device_type in ('singleDevice', 'multiDevice')),
  backed_up           boolean not null default false,
  status              public.credential_status not null default 'pending',
  approved_by         uuid references public.profiles (id) on delete set null,
  approved_at         timestamptz,
  revoked_by          uuid references public.profiles (id) on delete set null,
  revoked_at          timestamptz,
  revoke_reason       text,
  last_used_at        timestamptz,
  created_at          timestamptz not null default now(),
  check (status <> 'active' or approved_at is not null),
  check (status <> 'revoked' or revoked_at is not null)
);
create index webauthn_credentials_employee_idx on public.webauthn_credentials (employee_id, status);

-- -----------------------------------------------------------------------------
-- webauthn_challenges: server-generated, short-lived, single-use. `used_at` is set
-- atomically by consume_webauthn_challenge(); a used or expired challenge can never be
-- verified again (replay protection). Backend-only table.
-- -----------------------------------------------------------------------------
create table public.webauthn_challenges (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  app_session_id  uuid references public.app_sessions (id) on delete cascade,
  purpose         public.challenge_purpose not null,
  action          public.attendance_event_type,
  challenge       text not null unique,
  client_ip       inet,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  used_at         timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  check ((purpose = 'attendance') = (action is not null)),
  check (used_at is null or used_at >= created_at)
);
create index webauthn_challenges_user_idx on public.webauthn_challenges (user_id, created_at desc);
create index webauthn_challenges_expiry_idx on public.webauthn_challenges (expires_at) where used_at is null;
