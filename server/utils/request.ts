import type { H3Event } from 'h3'
import type { z } from 'zod'
import { effectiveLoopbackClientIp } from '../lib/config-validate'
import { ipInAny, normalizeIp, resolveClientIp } from '../lib/ip'
import { formatNetworkDecision, type NetworkDecision } from '../lib/net-log'
import { requestOrigin } from '../lib/origin'

let warnedNoDevPeer = false

/** Observed client IP per the trusted-proxy configuration (never from the request body). */
export function clientIp(event: H3Event): string | null {
  if (event.context.clientIp !== undefined) {
    return event.context.clientIp as string | null
  }
  const c = serverConfig()
  // Under `nuxi dev` the worker's socket peer is the dev server's internal proxy (or absent), so
  // the real peer comes from the authenticated hand-off in server/middleware/00.dev-peer.ts.
  const peer = import.meta.dev ? (event.context.devPeer as string | null | undefined) ?? null : normalizeIp(event.node.req.socket?.remoteAddress)
  if (import.meta.dev && !peer && !warnedNoDevPeer) {
    warnedNoDevPeer = true
    console.warn('[net] dev request without a verified peer address: client IP is unknown, so network checks fail (is modules/dev-client-peer.ts loaded?)')
  }
  const { ip, source } = resolveClientIp(peer, event.node.req.headers, {
    mode: c.trustProxyMode,
    trustedProxies: c.trustedProxyCidrs,
    header: c.clientIpHeader,
    peerSource: import.meta.dev ? 'dev-peer' : 'socket',
    // Explicit local-testing setting: never active in production (and rejected there at startup).
    loopbackOverride: effectiveLoopbackClientIp(c.appEnv, c.devLoopbackClientIp),
  })
  event.context.clientIp = ip
  event.context.clientIpSource = source
  event.context.clientIpPeer = peer
  return ip
}

/** Log the IP allowlist decision with how the client IP was obtained (see server/lib/net-log.ts). */
export function logNetworkDecision(event: H3Event, d: Pick<NetworkDecision, 'stage' | 'employeeCode' | 'action' | 'passed' | 'reasons'>): void {
  const ip = clientIp(event)
  console.info(formatNetworkDecision({
    ...d,
    ip,
    peer: (event.context.clientIpPeer as string | null | undefined) ?? null,
    source: String(event.context.clientIpSource ?? 'unknown'),
  }))
}

/** Whether the TCP peer is one of the configured trusted reverse proxies. */
export function fromTrustedProxy(event: H3Event): boolean {
  const c = serverConfig()
  if (c.trustProxyMode === 'none') {
    return false
  }
  clientIp(event)
  const peer = event.context.clientIpPeer as string | null
  return !!peer && ipInAny(peer, c.trustedProxyCidrs)
}

/** The origin this request was addressed to (forwarded headers only from trusted proxies). */
export function targetOrigin(event: H3Event): string | null {
  return requestOrigin({
    host: event.node.req.headers.host,
    encrypted: !!(event.node.req.socket as { encrypted?: boolean } | undefined)?.encrypted,
    headers: event.node.req.headers,
    trustedPeer: fromTrustedProxy(event),
  })
}

export function userAgent(event: H3Event): string {
  return (getHeader(event, 'user-agent') ?? '').slice(0, 500)
}

function validationError(error: z.ZodError) {
  return apiError(422, 'validation_failed', {
    issues: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
  })
}

export async function readValid<T extends z.ZodType>(event: H3Event, schema: T): Promise<z.output<T>> {
  const body = await readBody(event).catch(() => {
    throw apiError(400, 'invalid_json')
  })
  const r = schema.safeParse(body)
  if (!r.success) {
    throw validationError(r.error)
  }
  return r.data
}

export function queryValid<T extends z.ZodType>(event: H3Event, schema: T): z.output<T> {
  const raw = getQuery(event)
  const r = schema.safeParse(raw)
  if (!r.success) {
    throw validationError(r.error)
  }
  return r.data
}

export function routeUuid(event: H3Event, name = 'id'): string {
  const v = getRouterParam(event, name) ?? ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw apiError(400, 'invalid_id')
  }
  return v
}
