export default defineTask({
  meta: {
    name: 'attendance:close-days',
    description: 'Missing check-out + absence detection, summary recalculation, session/challenge cleanup',
  },
  async run() {
    const result = await closeDays()
    console.info('[task] attendance:close-days', JSON.stringify(result))
    return { result }
  },
})
