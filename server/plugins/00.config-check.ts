/**
 * Validate server configuration when the server starts, not on the first request.
 * Production refuses to start with an invalid configuration; development and test keep
 * running (so the UI loads) and report the problems in the terminal.
 */
export default defineNitroPlugin(() => {
  const report = checkServerConfig()
  if (report.errors.length === 0) {
    console.info(`[config] Server configuration OK (${report.env}).`)
  }
  if (import.meta.dev) {
    console.info('[config] nuxi dev: client IPs come from the Nitro dev proxy and are not tamper-proof. Verify network rules against a production build.')
  }
  if (report.errors.length && report.env === 'production') {
    throw new Error(`Invalid server configuration: ${[...new Set(report.errors.map(e => e.setting))].join(', ')}`)
  }
})
