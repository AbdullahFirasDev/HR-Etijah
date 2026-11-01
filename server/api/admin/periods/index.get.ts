export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: ['attendance.read', 'attendance.lock'] })
  return unwrap(await ctx.db.from('attendance_period_locks').select('*').order('year', { ascending: false }).order('month', { ascending: false }))
})
