-- =============================================================================
-- Etijah HR — DEVELOPMENT SEED ONLY (loaded by `supabase db reset` on a local stack).
-- Never run against production. Contains no attendance data: attendance can only be
-- created through the real, verified check-in flow.
--
-- All accounts use the password:  Etijah@2026dev
-- =============================================================================

-- ---------------------------------------------------------------- auth users
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       extensions.crypt('Etijah@2026dev', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  from (values
    ('00000000-0000-4000-a000-000000000001'::uuid, 'owner@etijah.local'),
    ('00000000-0000-4000-a000-000000000002'::uuid, 'hr@etijah.local'),
    ('00000000-0000-4000-a000-000000000003'::uuid, 'manager.ops@etijah.local'),
    ('00000000-0000-4000-a000-000000000004'::uuid, 'ali@etijah.local'),
    ('00000000-0000-4000-a000-000000000005'::uuid, 'sara@etijah.local'),
    ('00000000-0000-4000-a000-000000000006'::uuid, 'night@etijah.local')
  ) as u(id, email);

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
  from auth.users u
 where u.email like '%@etijah.local';

-- ---------------------------------------------------------------- profiles
insert into public.profiles (id, email, full_name, full_name_en, role_id)
select v.id, v.email, v.full_name, v.full_name_en, r.id
  from (values
    ('00000000-0000-4000-a000-000000000001'::uuid, 'owner@etijah.local', 'مدير النظام', 'System Owner', 'owner'),
    ('00000000-0000-4000-a000-000000000002'::uuid, 'hr@etijah.local', 'زينب حسن', 'Zainab Hassan', 'hr_manager'),
    ('00000000-0000-4000-a000-000000000003'::uuid, 'manager.ops@etijah.local', 'حيدر كاظم', 'Haider Kadhim', 'department_manager'),
    ('00000000-0000-4000-a000-000000000004'::uuid, 'ali@etijah.local', 'علي جبار', 'Ali Jabbar', 'employee'),
    ('00000000-0000-4000-a000-000000000005'::uuid, 'sara@etijah.local', 'سارة محمد', 'Sara Mohammed', 'employee'),
    ('00000000-0000-4000-a000-000000000006'::uuid, 'night@etijah.local', 'مصطفى عباس', 'Mustafa Abbas', 'employee')
  ) as v(id, email, full_name, full_name_en, role_key)
  join public.roles r on r.key = v.role_key;

-- ---------------------------------------------------------------- organisation
insert into public.offices (id, name_ar, name_en, address) values
  ('20000000-0000-4000-a000-000000000001', 'المكتب الرئيسي — النجف', 'Head office — Najaf', 'النجف الأشرف، العراق');

-- Replace with the real office coordinates in Settings → Location.
insert into public.geofences (office_id, name, latitude, longitude, radius_m, max_accuracy_m) values
  ('20000000-0000-4000-a000-000000000001', 'Head office', 32.0259, 44.3462, 100, 50);

-- Example office network (documentation range). Replace with the company's static public IP in
-- Settings → Network. Loopback (127.0.0.1, ::1) is deliberately not allowed: a request from the
-- server machine itself never carries the office IP. For local testing set
-- NUXT_DEV_LOOPBACK_CLIENT_IP=203.0.113.10 (development/test only, see docs/SECURITY.md).
insert into public.allowed_networks (office_id, label, cidr) values
  (null, 'Head office public IP (example — replace)', '203.0.113.10/32');

insert into public.departments (id, code, name_ar, name_en) values
  ('30000000-0000-4000-a000-000000000001', 'OPS', 'العمليات', 'Operations'),
  ('30000000-0000-4000-a000-000000000002', 'SALES', 'المبيعات', 'Sales'),
  ('30000000-0000-4000-a000-000000000003', 'HR', 'الموارد البشرية', 'Human Resources');

insert into public.department_managers (department_id, user_id) values
  ('30000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000003');

insert into public.employees (id, profile_id, employee_code, department_id, office_id, job_title, hire_date) values
  ('10000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002', 'E002', '30000000-0000-4000-a000-000000000003', '20000000-0000-4000-a000-000000000001', 'HR Manager', '2024-01-01'),
  ('10000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000003', 'E003', '30000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001', 'Operations Manager', '2024-02-01'),
  ('10000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000004', 'E004', '30000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001', 'Travel Consultant', '2024-03-01'),
  ('10000000-0000-4000-a000-000000000005', '00000000-0000-4000-a000-000000000005', 'E005', '30000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000001', 'Sales Executive', '2024-03-15'),
  ('10000000-0000-4000-a000-000000000006', '00000000-0000-4000-a000-000000000006', 'E006', '30000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001', 'Night Desk Agent', '2024-04-01');

-- ---------------------------------------------------------------- schedules
insert into public.shifts (code, name_ar, name_en, start_time, end_time, required_minutes, grace_minutes, break_minutes, paid_break_minutes, working_days, count_after_shift) values
  ('NIGHT', 'الدوام الليلي', 'Night shift', '22:00', '06:00', 480, 10, 30, 30, '{7,1,2,3,4}', true);
insert into public.shifts (code, name_ar, name_en, start_time, end_time, required_minutes, grace_minutes, break_minutes, paid_break_minutes, working_days, is_flexible, flex_earliest_start, flex_latest_end) values
  ('FLEX', 'دوام مرن', 'Flexible', '08:00', '16:00', 480, 0, 60, 0, '{7,1,2,3,4}', true, '07:00', '19:00');

insert into public.employee_schedules (employee_id, shift_id, effective_from)
select e.id, s.id, '2026-01-01'
  from public.employees e
  join public.shifts s on s.code = case when e.employee_code = 'E006' then 'NIGHT' else 'DAY' end;

-- ---------------------------------------------------------------- holidays (2026; lunar dates are approximate — confirm official announcements)
insert into public.holidays (name_ar, name_en, holiday_type, start_date, end_date, is_recurring) values
  ('رأس السنة الميلادية', 'New Year''s Day', 'official', '2026-01-01', '2026-01-01', true),
  ('عيد الجيش', 'Army Day', 'official', '2026-01-06', '2026-01-06', true),
  ('عيد نوروز', 'Nowruz', 'official', '2026-03-21', '2026-03-21', true),
  ('عيد العمال', 'Labour Day', 'official', '2026-05-01', '2026-05-01', true),
  ('ذكرى ثورة 14 تموز', 'Republic Day', 'official', '2026-07-14', '2026-07-14', true),
  ('اليوم الوطني', 'National Day', 'official', '2026-10-03', '2026-10-03', true),
  ('عيد الميلاد المجيد', 'Christmas Day', 'official', '2026-12-25', '2026-12-25', true),
  ('عيد الفطر', 'Eid al-Fitr', 'official', '2026-03-20', '2026-03-22', false),
  ('عيد الأضحى', 'Eid al-Adha', 'official', '2026-05-27', '2026-05-30', false),
  ('رأس السنة الهجرية', 'Islamic New Year', 'official', '2026-06-16', '2026-06-16', false),
  ('عاشوراء', 'Ashura', 'official', '2026-06-25', '2026-06-25', false),
  ('المولد النبوي', 'Prophet''s Birthday', 'official', '2026-08-25', '2026-08-25', false);

-- ---------------------------------------------------------------- leave balances
insert into public.leave_balances (employee_id, leave_type_id, year, allocated_days)
select e.id, t.id, 2026, t.annual_allowance_days
  from public.employees e
 cross join public.leave_types t
 where t.tracks_balance;
