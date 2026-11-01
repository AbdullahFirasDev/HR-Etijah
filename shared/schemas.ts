/**
 * Request validation schemas — shared by the API (authoritative) and the UI forms.
 */
import { z } from 'zod'
import { ADJUSTMENT_TYPES, ATTENDANCE_ACTIONS, PERMISSIONS, ROLE_KEYS } from './constants'

// Browser: Zod probes `new Function("")` when an object schema is *constructed* (i.e. right
// below, at import time) to decide whether to JIT-compile parsers. Our CSP correctly forbids
// eval, so the browser would report a violation for that probe. jitless mode skips it; it must
// be set here, before the first schema is built. The server (no CSP) keeps the JIT.
if ('document' in globalThis) {
  z.config({ jitless: true })
}

const uuid = z.uuid()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Expected HH:mm')
const weekdays = z.array(z.number().int().min(1).max(7)).min(1).max(7)
  .refine(a => new Set(a).size === a.length, 'Duplicate weekday')
const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max)

// ---------------------------------------------------------------- auth
export const loginSchema = z.object({
  email: z.email().max(254).transform(e => e.toLowerCase()),
  password: z.string().min(1).max(256),
})

export const passwordPolicy = z.string()
  .min(10, 'password_too_short')
  .max(128)
  .regex(/[a-z]/, 'password_needs_lowercase')
  .regex(/[A-Z]/, 'password_needs_uppercase')
  .regex(/\d/, 'password_needs_digit')

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordPolicy,
}).refine(v => v.currentPassword !== v.newPassword, { message: 'password_must_differ', path: ['newPassword'] })

export const forgotPasswordSchema = z.object({ email: z.email().max(254) })
export const resetPasswordSchema = z.object({ tokenHash: z.string().min(10).max(512), password: passwordPolicy })

// ---------------------------------------------------------------- attendance
export const attendanceActionSchema = z.enum(ATTENDANCE_ACTIONS)

export const locationReadingSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000),
  /** Date.now() − GeolocationPosition.timestamp on the device (clock-skew independent). */
  ageMs: z.number().int().min(-600_000).max(86_400_000),
  altitude: z.number().nullish(),
  speed: z.number().nullish(),
})

export const precheckSchema = z.object({
  action: attendanceActionSchema,
  location: locationReadingSchema.nullable(),
})

export const challengeRequestSchema = z.object({ action: attendanceActionSchema })

const authenticationResponseSchema = z.object({
  id: z.string().min(1).max(1024),
  rawId: z.string().min(1).max(1024),
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: z.string().max(8192),
    authenticatorData: z.string().max(8192),
    signature: z.string().max(4096),
    userHandle: z.string().max(1024).nullish(),
  }),
  authenticatorAttachment: z.string().nullish(),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
})

export const submitAttendanceSchema = z.object({
  action: attendanceActionSchema,
  challengeId: uuid,
  idempotencyKey: uuid,
  location: locationReadingSchema,
  assertion: authenticationResponseSchema,
  client: z.object({ webdriver: z.boolean().optional() }).default({}),
})

// ---------------------------------------------------------------- WebAuthn registration
export const registerOptionsSchema = z.object({ label: trimmed(1, 80) })

export const registerVerifySchema = z.object({
  challengeId: uuid,
  label: trimmed(1, 80),
  response: z.object({
    id: z.string().min(1).max(1024),
    rawId: z.string().min(1).max(1024),
    type: z.literal('public-key'),
    response: z.object({
      clientDataJSON: z.string().max(8192),
      attestationObject: z.string().max(65_536),
      transports: z.array(z.string().max(32)).max(10).optional(),
      authenticatorData: z.string().max(65_536).optional(),
      publicKey: z.string().max(4096).optional(),
      publicKeyAlgorithm: z.number().optional(),
    }),
    authenticatorAttachment: z.string().nullish(),
    clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  }),
})

// ---------------------------------------------------------------- leave
export const leaveRequestSchema = z.object({
  leaveTypeId: uuid,
  startDate: isoDate,
  endDate: isoDate,
  isHalfDay: z.boolean().default(false),
  reason: z.string().trim().max(1000).optional(),
  employeeId: uuid.optional(), // HR / managers filing on behalf of an employee
}).refine(v => v.endDate >= v.startDate, { message: 'end_before_start', path: ['endDate'] })
  .refine(v => !v.isHalfDay || v.startDate === v.endDate, { message: 'half_day_single_date', path: ['isHalfDay'] })

export const reviewSchema = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(1000).optional(),
})

export const leaveBalanceSchema = z.object({
  employeeId: uuid,
  leaveTypeId: uuid,
  year: z.number().int().min(2000).max(2100),
  allocatedDays: z.number().min(0).max(365),
  carriedOverDays: z.number().min(0).max(365).default(0),
})

// ---------------------------------------------------------------- adjustments
export const adjustmentRequestSchema = z.object({
  employeeId: uuid,
  workDate: isoDate,
  type: z.enum(ADJUSTMENT_TYPES),
  targetSessionId: uuid.nullish(),
  targetBreakId: uuid.nullish(),
  newStartAt: z.iso.datetime({ offset: true }).nullish(),
  newEndAt: z.iso.datetime({ offset: true }).nullish(),
  reason: trimmed(5, 1000),
})

// ---------------------------------------------------------------- employees
export const employeeCreateSchema = z.object({
  email: z.email().max(254).transform(e => e.toLowerCase()),
  fullName: trimmed(2, 160),
  fullNameEn: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(32).optional(),
  role: z.enum(ROLE_KEYS).default('employee'),
  initialPassword: passwordPolicy,
  isEmployee: z.boolean().default(true),
  employeeCode: z.string().trim().min(1).max(32).optional(),
  departmentId: uuid.nullish(),
  officeId: uuid.nullish(),
  jobTitle: z.string().trim().max(120).optional(),
  hireDate: isoDate.nullish(),
  shiftId: uuid.nullish(),
  managedDepartmentIds: z.array(uuid).max(50).default([]),
}).refine(v => !v.isEmployee || !!v.employeeCode, { message: 'employee_code_required', path: ['employeeCode'] })

export const employeeUpdateSchema = z.object({
  fullName: trimmed(2, 160).optional(),
  fullNameEn: z.string().trim().max(160).nullish(),
  phone: z.string().trim().max(32).nullish(),
  isActive: z.boolean().optional(),
  role: z.enum(ROLE_KEYS).optional(),
  employeeCode: z.string().trim().min(1).max(32).optional(),
  departmentId: uuid.nullish(),
  officeId: uuid.nullish(),
  jobTitle: z.string().trim().max(120).nullish(),
  hireDate: isoDate.nullish(),
  terminationDate: isoDate.nullish(),
  status: z.enum(['active', 'suspended', 'terminated']).optional(),
  managedDepartmentIds: z.array(uuid).max(50).optional(),
})

export const resetEmployeePasswordSchema = z.object({ password: passwordPolicy })

export const scheduleSchema = z.object({
  employeeId: uuid,
  shiftId: uuid.nullish(),
  effectiveFrom: isoDate,
  effectiveTo: isoDate.nullish(),
  requiredMinutes: z.number().int().min(0).max(1440).nullish(),
  workingDays: weekdays.nullish(),
  startTime: time.nullish(),
  endTime: time.nullish(),
  graceMinutes: z.number().int().min(0).max(240).nullish(),
  earlyLeaveGraceMinutes: z.number().int().min(0).max(240).nullish(),
  breakMinutes: z.number().int().min(0).max(480).nullish(),
  paidBreakMinutes: z.number().int().min(0).max(480).nullish(),
  weeklyRequiredMinutes: z.number().int().min(0).max(10080).nullish(),
  isFlexible: z.boolean().nullish(),
  flexEarliestStart: time.nullish(),
  flexLatestEnd: time.nullish(),
  overtimeEligible: z.boolean().nullish(),
  countBeforeShift: z.boolean().nullish(),
  countAfterShift: z.boolean().nullish(),
  notes: z.string().trim().max(500).nullish(),
}).refine(v => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, { message: 'end_before_start', path: ['effectiveTo'] })
  .refine(v => !!v.shiftId || !!v.startTime || !!v.isFlexible, { message: 'shift_or_times_required', path: ['shiftId'] })
  .refine(v => (v.startTime == null) === (v.endTime == null), { message: 'start_end_together', path: ['endTime'] })

// ---------------------------------------------------------------- configuration resources
export const departmentSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/),
  name_ar: trimmed(1, 120),
  name_en: trimmed(1, 120),
  parent_id: uuid.nullish(),
  is_active: z.boolean().default(true),
})

export const officeSchema = z.object({
  name_ar: trimmed(1, 120),
  name_en: trimmed(1, 120),
  address: z.string().trim().max(300).nullish(),
  timezone: z.string().trim().min(3).max(64).default('Asia/Baghdad'),
  is_active: z.boolean().default(true),
})

export const geofenceSchema = z.object({
  office_id: uuid,
  name: trimmed(1, 120),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radius_m: z.number().int().min(10).max(5000).default(100),
  max_accuracy_m: z.number().int().min(5).max(1000).default(50),
  is_active: z.boolean().default(true),
})

export const networkSchema = z.object({
  office_id: uuid.nullish(),
  label: trimmed(1, 120),
  cidr: z.string().trim().min(3).max(64),
  is_active: z.boolean().default(true),
})

export const shiftSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/),
  name_ar: trimmed(1, 120),
  name_en: trimmed(1, 120),
  start_time: time,
  end_time: time,
  required_minutes: z.number().int().min(0).max(1440).default(480),
  grace_minutes: z.number().int().min(0).max(240).default(10),
  early_leave_grace_minutes: z.number().int().min(0).max(240).default(0),
  break_minutes: z.number().int().min(0).max(480).default(30),
  paid_break_minutes: z.number().int().min(0).max(480).default(30),
  working_days: weekdays.default([7, 1, 2, 3, 4]),
  weekly_required_minutes: z.number().int().min(0).max(10080).nullish(),
  is_flexible: z.boolean().default(false),
  flex_earliest_start: time.nullish(),
  flex_latest_end: time.nullish(),
  overtime_eligible: z.boolean().default(true),
  count_before_shift: z.boolean().default(false),
  count_after_shift: z.boolean().default(false),
  is_active: z.boolean().default(true),
}).refine(v => v.paid_break_minutes <= v.break_minutes, { message: 'paid_break_exceeds_break', path: ['paid_break_minutes'] })

export const holidaySchema = z.object({
  name_ar: trimmed(1, 120),
  name_en: trimmed(1, 120),
  holiday_type: z.enum(['official', 'company']).default('official'),
  start_date: isoDate,
  end_date: isoDate,
  is_recurring: z.boolean().default(false),
  office_id: uuid.nullish(),
}).refine(v => v.end_date >= v.start_date, { message: 'end_before_start', path: ['end_date'] })

export const leaveTypeSchema = z.object({
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{2,30}$/),
  name_ar: trimmed(1, 120),
  name_en: trimmed(1, 120),
  is_paid: z.boolean().default(true),
  annual_allowance_days: z.number().min(0).max(365).default(0),
  tracks_balance: z.boolean().default(true),
  allow_half_day: z.boolean().default(true),
  excluded_from_absence: z.boolean().default(true),
  excluded_from_shortage: z.boolean().default(true),
  color: z.enum(['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral']).default('primary'),
  is_active: z.boolean().default(true),
})

export const orgSettingsSchema = z.object({
  org_name_ar: trimmed(1, 160),
  org_name_en: trimmed(1, 160),
  timezone: z.string().trim().min(3).max(64),
  week_start: z.number().int().min(1).max(7),
  default_required_minutes: z.number().int().min(0).max(1440),
  default_working_days: weekdays,
  max_location_age_seconds: z.number().int().min(5).max(600),
  max_travel_speed_kmh: z.number().int().min(20).max(2000),
  risk_review_threshold: z.number().int().min(0).max(100),
  risk_block_threshold: z.number().int().min(1).max(100),
  require_device_approval: z.boolean(),
  max_devices_per_employee: z.number().int().min(1).max(10),
  allow_multiple_sessions: z.boolean(),
  missing_checkout_policy: z.enum(['zero', 'scheduled_end']),
  auto_close_after_hours: z.number().int().min(4).max(36),
  absence_counts_as_shortage: z.boolean(),
  late_counts_from: z.enum(['shift_start', 'grace_end']),
  min_overtime_minutes: z.number().int().min(0).max(240),
  max_daily_overtime_minutes: z.number().int().min(0).max(1440),
  overtime_basis: z.enum(['daily', 'weekly']),
  holiday_work_is_overtime: z.boolean(),
  leave_approval_flow: z.enum(['single', 'two_step']),
  allow_negative_leave_balance: z.boolean(),
}).refine(v => v.risk_review_threshold <= v.risk_block_threshold, { message: 'review_above_block', path: ['risk_review_threshold'] })

export const rolePermissionsSchema = z.object({
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
})

export const credentialStatusSchema = z.object({
  status: z.enum(['active', 'revoked']),
  reason: z.string().trim().max(500).optional(),
})

export const periodLockSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  locked: z.boolean(),
})

export const reportQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
  employeeId: uuid.optional(),
  departmentId: uuid.optional(),
}).refine(v => v.to >= v.from, { message: 'end_before_start', path: ['to'] })
  .refine(v => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 366, { message: 'range_too_large', path: ['to'] })

export const pushSubscriptionSchema = z.object({
  endpoint: z.url().startsWith('https://').max(2048),
  keys: z.object({ p256dh: z.string().min(10).max(256), auth: z.string().min(8).max(64) }),
})
