/** Permission catalog. Must stay in sync with roles.permissions (migration 009). Owners hold all. */
export const PERMISSIONS = [
  'employees.read',
  'employees.manage',
  'departments.manage',
  'schedules.manage',
  'attendance.read',
  'attendance.adjust',
  'attendance.request_adjustment',
  'attendance.lock',
  'leave.read',
  'leave.approve',
  'leave.manage',
  'holidays.manage',
  'reports.view',
  'reports.export',
  'devices.manage',
  'settings.manage',
  'security.read',
  'audit.read',
  'roles.manage',
] as const
export type Permission = (typeof PERMISSIONS)[number]

export const ROLE_KEYS = ['owner', 'hr_manager', 'department_manager', 'employee'] as const
export type RoleKey = (typeof ROLE_KEYS)[number]
export type RoleScope = 'organization' | 'department' | 'self'

export const ATTENDANCE_ACTIONS = ['check_in', 'check_out', 'break_start', 'break_end'] as const
export type AttendanceAction = (typeof ATTENDANCE_ACTIONS)[number]

/** Every reason code the backend/database can return for a rejected attendance action. */
export const FAILURE_REASONS = [
  'outside_geofence',
  'gps_accuracy_insufficient',
  'location_unavailable',
  'location_invalid',
  'location_stale',
  'location_permission_denied',
  'location_timeout',
  'location_spoofing_suspected',
  'no_geofence_configured',
  'unauthorized_network',
  'network_unknown',
  'biometric_failed',
  'authenticator_counter_mismatch',
  'challenge_invalid',
  'challenge_replayed',
  'challenge_expired',
  'device_not_authorized',
  'no_registered_device',
  'session_expired',
  'employee_inactive',
  'already_checked_in',
  'already_completed_today',
  'not_checked_in',
  'break_already_started',
  'no_active_break',
  'period_locked',
  'verification_failed',
  'offline',
] as const
export type FailureReason = (typeof FAILURE_REASONS)[number]

export const ADJUSTMENT_TYPES = [
  'add_interval',
  'add_check_out',
  'correct_check_in',
  'correct_check_out',
  'void_session',
  'add_break',
  'void_break',
] as const
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number]

export const DAY_STATUSES = ['present', 'absent', 'on_leave', 'holiday', 'day_off', 'in_progress', 'missing_checkout', 'scheduled'] as const
export type DayStatus = (typeof DAY_STATUSES)[number]

export const DEFAULT_TIMEZONE = 'Asia/Baghdad'
