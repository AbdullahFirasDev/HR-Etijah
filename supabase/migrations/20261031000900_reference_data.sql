-- =============================================================================
-- Etijah HR — 009: required reference data (safe for production; no personal data)
-- =============================================================================

insert into public.roles (key, name_ar, name_en, scope, permissions) values
  ('owner', 'المالك / مدير النظام', 'Owner / Super Admin', 'organization', '{}'),
  ('hr_manager', 'مدير الموارد البشرية', 'HR Manager', 'organization', array[
    'employees.read', 'employees.manage', 'departments.manage', 'schedules.manage',
    'attendance.read', 'attendance.adjust', 'attendance.request_adjustment', 'attendance.lock',
    'leave.read', 'leave.approve', 'leave.manage', 'holidays.manage',
    'reports.view', 'reports.export', 'devices.manage', 'security.read'
  ]),
  ('department_manager', 'مدير القسم', 'Department Manager', 'department', array[
    'employees.read', 'attendance.read', 'attendance.request_adjustment',
    'leave.read', 'leave.approve', 'reports.view', 'reports.export'
  ]),
  ('employee', 'موظف', 'Employee', 'self', '{}')
on conflict (key) do nothing;

insert into public.org_settings (id) values (1) on conflict (id) do nothing;

insert into public.leave_types (code, name_ar, name_en, is_paid, annual_allowance_days, tracks_balance, allow_half_day, color) values
  ('annual', 'إجازة سنوية', 'Annual leave', true, 30, true, true, 'primary'),
  ('sick', 'إجازة مرضية', 'Sick leave', true, 15, true, true, 'warning'),
  ('personal', 'إجازة شخصية', 'Personal leave', true, 5, true, true, 'info'),
  ('unpaid', 'إجازة بدون راتب', 'Unpaid leave', false, 0, false, true, 'neutral')
on conflict (code) do nothing;

-- Default 8-hour day shift: 08:00–16:00, Sunday–Thursday, 30-minute paid break.
-- Time after 16:00 counts (as overtime for eligible employees); HR can disable per shift.
insert into public.shifts (code, name_ar, name_en, start_time, end_time, required_minutes, grace_minutes, break_minutes, paid_break_minutes, working_days, count_after_shift)
values ('DAY', 'الدوام الصباحي', 'Day shift', '08:00', '16:00', 480, 10, 30, 30, '{7,1,2,3,4}', true)
on conflict (code) do nothing;
