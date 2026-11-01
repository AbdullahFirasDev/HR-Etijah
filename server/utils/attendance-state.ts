import type { AttendanceAction } from '#shared/constants'

export interface AttendanceState {
  openSession: { id: string, workDate: string, checkInAt: string } | null
  openBreak: { id: string, startedAt: string } | null
  allowedActions: AttendanceAction[]
}

/** Current open session/break for an employee and the actions that are valid next. */
export async function attendanceState(employeeId: string): Promise<AttendanceState> {
  const db = serviceDb()
  const { data: session } = await db.from('attendance_sessions')
    .select('id, work_date, check_in_at')
    .eq('employee_id', employeeId)
    .eq('status', 'open')
    .maybeSingle()
  let openBreak: AttendanceState['openBreak'] = null
  if (session) {
    const { data: brk } = await db.from('breaks')
      .select('id, started_at')
      .eq('employee_id', employeeId)
      .eq('status', 'open')
      .maybeSingle()
    openBreak = brk ? { id: brk.id, startedAt: brk.started_at } : null
  }
  const allowedActions: AttendanceAction[] = !session
    ? ['check_in']
    : openBreak
      ? ['break_end', 'check_out']
      : ['break_start', 'check_out']
  return {
    openSession: session ? { id: session.id, workDate: session.work_date, checkInAt: session.check_in_at } : null,
    openBreak,
    allowedActions,
  }
}
