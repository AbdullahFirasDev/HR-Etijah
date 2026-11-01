/**
 * One-line diagnostic for every network (IP allowlist) decision, pre-check and submission.
 * Shows the direct peer the server saw, the client IP it resolved, how it was resolved
 * (socket, dev-peer, xff, header:<name>, and "+loopback-override" when the local-testing
 * setting substituted a loopback peer), and the verdict. No names or tokens.
 */
export interface NetworkDecision {
  stage: 'precheck' | 'submit'
  employeeCode: string
  action: string
  peer: string | null
  ip: string | null
  source: string
  passed: boolean
  reasons: string[]
}

export function formatNetworkDecision(d: NetworkDecision): string {
  return [
    `[net] ${d.stage}`,
    `emp=${d.employeeCode}`,
    `action=${d.action}`,
    `peer=${d.peer ?? 'none'}`,
    `ip=${d.ip ?? 'none'}`,
    `source=${d.source}`,
    `→ ${d.passed ? 'ACCEPT' : 'REJECT'}`,
    d.reasons.length ? `reasons=${d.reasons.join(',')}` : null,
  ].filter(Boolean).join(' ')
}
