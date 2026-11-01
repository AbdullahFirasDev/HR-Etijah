/**
 * Configuration resources managed through the generic admin CRUD routes. Writes use the
 * caller's RLS-scoped client, so the database enforces the permission and the audit
 * trigger records who changed what.
 */
import type { z } from 'zod'
import type { Permission } from '#shared/constants'
import {
  departmentSchema,
  geofenceSchema,
  holidaySchema,
  leaveTypeSchema,
  networkSchema,
  officeSchema,
  shiftSchema,
} from '#shared/schemas'
import { canonicalCidr, isLoopbackCidr, isPublicCidr } from '../lib/ip'

export interface ResourceDef {
  table: string
  schema: z.ZodType
  permission: Permission
  select: string
  order: string
  /** Recalculate attendance after a change (affects calculations). */
  recalc?: (row: any) => { from: string, to: string } | null
  normalize?: (value: any) => any
}

const thisMonth = () => {
  const d = new Date()
  const from = `${d.toISOString().slice(0, 7)}-01`
  return { from, to: d.toISOString().slice(0, 10) }
}

export const RESOURCES: Record<string, ResourceDef> = {
  'departments': {
    table: 'departments',
    schema: departmentSchema,
    permission: 'departments.manage',
    select: 'id, code, name_ar, name_en, parent_id, is_active, created_at, managers:department_managers ( user_id, profile:profiles ( full_name, full_name_en ) )',
    order: 'code',
  },
  'offices': {
    table: 'offices',
    schema: officeSchema,
    permission: 'settings.manage',
    select: 'id, name_ar, name_en, address, timezone, is_active, created_at',
    order: 'name_en',
  },
  'geofences': {
    table: 'geofences',
    schema: geofenceSchema,
    permission: 'settings.manage',
    select: 'id, office_id, name, latitude, longitude, radius_m, max_accuracy_m, is_active, updated_at',
    order: 'name',
  },
  'networks': {
    table: 'allowed_networks',
    schema: networkSchema,
    permission: 'settings.manage',
    select: 'id, office_id, label, cidr, is_active, updated_at',
    order: 'label',
    normalize: (v) => {
      const cidr = canonicalCidr(v.cidr)
      if (!cidr) {
        throw apiError(422, 'invalid_cidr')
      }
      // Loopback is the server machine itself, never an office network (local testing uses
      // NUXT_DEV_LOOPBACK_CLIENT_IP instead).
      if (isLoopbackCidr(cidr)) {
        throw apiError(422, 'loopback_network')
      }
      // In production client IPs are always public (server/lib/ip.ts), so an active private or
      // reserved range could never match — and would only matter if that guard were bypassed.
      if (v.is_active !== false && serverConfig().appEnv === 'production' && !isPublicCidr(cidr)) {
        throw apiError(422, 'non_public_network')
      }
      return { ...v, cidr }
    },
  },
  'shifts': {
    table: 'shifts',
    schema: shiftSchema,
    permission: 'schedules.manage',
    select: '*',
    order: 'code',
    recalc: () => thisMonth(),
  },
  'holidays': {
    table: 'holidays',
    schema: holidaySchema,
    permission: 'holidays.manage',
    select: '*',
    order: 'start_date',
    recalc: (row) => {
      const today = new Date().toISOString().slice(0, 10)
      return row?.start_date && row.start_date <= today ? { from: row.start_date, to: row.end_date < today ? row.end_date : today } : null
    },
  },
  'leave-types': {
    table: 'leave_types',
    schema: leaveTypeSchema,
    permission: 'leave.manage',
    select: '*',
    order: 'code',
    recalc: () => thisMonth(),
  },
}

export function resourceDef(name: string | undefined): ResourceDef {
  const def = name ? RESOURCES[name] : undefined
  if (!def) {
    throw apiError(404, 'unknown_resource')
  }
  return def
}
