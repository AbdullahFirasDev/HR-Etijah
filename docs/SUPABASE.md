# Supabase configuration

## Local

```bash
npx supabase start      # needs Docker
npx supabase db reset   # migrations + supabase/seed.sql
npx supabase status     # URL, anon/publishable and service_role/secret keys
```

`supabase/config.toml` already sets: public sign-up **disabled**, JWT expiry **600 s**, minimum password
length 10 with upper/lower/digit requirements, `secure_password_change`, site URL / redirect for
`http://localhost:3000`.

## Hosted project

1. **Create the project** (choose a region close to Iraq, e.g. Frankfurt) and note the URL and keys
   (Project Settings → API). Both the legacy `anon`/`service_role` keys and the newer publishable/secret
   keys work.
2. **Apply the schema** from this repository:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push        # applies supabase/migrations (NOT seed.sql)
   ```
   Migration `…0900_reference_data.sql` installs the four roles, default leave types, the default
   08:00–16:00 shift and the settings row — safe for production. `seed.sql` is development data and must
   not be run in production.
3. **Extensions:** the migrations create `postgis` and `btree_gist` in the `extensions` schema. If your
   project restricts extension creation, enable them in Database → Extensions (schema `extensions`) first.
4. **Authentication settings** (Authentication → Providers / Settings):
   - Email provider **on**, *Allow new users to sign up* **off** (accounts are created by HR).
   - *Confirm email* may stay on — the app creates users already confirmed.
   - JWT expiry **≥ 600 s** (must not be shorter than the app session).
   - Password requirements: minimum 10, lower + upper + digits.
   - Site URL: `https://<your-domain>`; Redirect URLs: `https://<your-domain>/auth/reset`.
   - Configure custom SMTP if you want password-reset emails.
5. **Password-reset email template** (Authentication → Email Templates → Reset Password). The app verifies
   the token on the server, so the link must carry the token hash:
   ```html
   <h2>Reset your password / إعادة تعيين كلمة المرور</h2>
   <p><a href="{{ .SiteURL }}/auth/reset?token_hash={{ .TokenHash }}&type=recovery">Set a new password</a></p>
   ```
6. **Create the first Owner:**
   ```bash
   NUXT_SUPABASE_URL=https://<ref>.supabase.co NUXT_SUPABASE_SERVICE_ROLE_KEY=<key> \
     node scripts/create-owner.mjs --email owner@etijah.com --name "الاسم الكامل" --name-en "Full Name"
   ```
   Sign in with the printed temporary password (a change is forced), then configure in this order:
   **Company location** (office + geofence) → **Allowed networks** (office public IP; use the test panel)
   → **Policy settings** → **Shifts** → **Departments** → **Employees** → **Holidays** for the year.
7. **Backups:** enable Point-in-Time Recovery (Pro plan) — attendance history is legally relevant payroll
   data.

## Exposed API surface

PostgREST exposes the `public` schema. Every table has RLS enabled; `anon` has no table privileges. The
following functions are executable by `authenticated` (each re-checks authorisation with `auth.uid()`):
`request_attendance_adjustment`, `review_attendance_adjustment`, `review_leave_request`,
`cancel_leave_request`, `leave_balances_for`, `set_credential_status`, `set_user_role`, `set_period_lock`.
Everything else (`record_attendance_event`, `attendance_precheck`, `consume_webauthn_challenge`,
`flag_missing_checkouts`, `purge_expired_security_data`) is `service_role` only. Helper functions live in
the private `app` schema, which is not exposed.

## Regenerating TypeScript types (optional)

```bash
npm run db:types   # writes shared/types/database.ts from the local database
```
