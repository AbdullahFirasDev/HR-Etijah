/**
 * Client IP resolution and CIDR matching.
 *
 * The client IP used for network verification is NEVER taken from a request body, and
 * X-Forwarded-For is only honoured when the TCP peer is one of our configured trusted
 * proxies. Modes:
 *   none   — use the socket peer address (app directly exposed, or for local dev)
 *   xff    — the socket peer must be a trusted proxy; walk X-Forwarded-For right-to-left,
 *            skipping trusted proxies; the first untrusted hop is the client
 *   header — a single-IP header written by the edge platform (e.g. cf-connecting-ip,
 *            x-real-ip set by nginx, x-vercel-forwarded-for). If trusted proxies are configured
 *            the socket peer must match one of them.
 *
 * A request from this machine (loopback peer) never passes through the company's NAT gateway, so
 * it cannot carry the office's public IP. For local testing only, `loopbackOverride` (the
 * NUXT_DEV_LOOPBACK_CLIENT_IP setting, rejected in production) substitutes one configured address
 * for a loopback peer; that address must still be in the allowlist like any other.
 */
import ipaddr from 'ipaddr.js'

export type TrustProxyMode = 'none' | 'xff' | 'header'

export interface ClientIpOptions {
  mode: TrustProxyMode
  trustedProxies: string[]
  header?: string
  /** Label for results taken from the peer address (default 'socket'). */
  peerSource?: string
  /** Development/test only: the address that stands in for a loopback peer (see above). */
  loopbackOverride?: string | null
}

export interface ResolvedIp {
  ip: string | null
  source: string
}

type Addr = ipaddr.IPv4 | ipaddr.IPv6

function toAddr(raw: string | null | undefined): Addr | null {
  if (!raw) {
    return null
  }
  let s = raw.trim()
  if (!s) {
    return null
  }
  // [v6]:port
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(s)
  if (bracket) {
    s = bracket[1]!
  }
  // v4:port
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(s)) {
    s = s.slice(0, s.lastIndexOf(':'))
  }
  s = s.replace(/%.*$/, '') // zone id
  if (!ipaddr.isValid(s)) {
    return null
  }
  let addr: Addr = ipaddr.parse(s)
  if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
    addr = (addr as ipaddr.IPv6).toIPv4Address()
  }
  // Reject ambiguous legacy IPv4 forms ("1", "010.0.0.1") that ipaddr accepts
  if (addr.kind() === 'ipv4' && !ipaddr.IPv4.isValidFourPartDecimal(s) && !s.includes(':')) {
    return null
  }
  return addr
}

/** Canonical textual form (IPv4-mapped IPv6 → IPv4), or null if not an IP address. */
export function normalizeIp(raw: string | null | undefined): string | null {
  return toAddr(raw)?.toString() ?? null
}

/** Parse "a.b.c.d/n", "v6::/n" or a bare address (treated as a single host). */
export function parseCidr(cidr: string): [Addr, number] | null {
  const s = cidr.trim()
  try {
    if (!s.includes('/')) {
      const a = toAddr(s)
      return a ? [a, a.kind() === 'ipv4' ? 32 : 128] : null
    }
    const [range, bits] = ipaddr.parseCIDR(s)
    let r: Addr = range
    let b = bits
    if (r.kind() === 'ipv6' && (r as ipaddr.IPv6).isIPv4MappedAddress() && bits >= 96) {
      r = (r as ipaddr.IPv6).toIPv4Address()
      b = bits - 96
    }
    return [r, b]
  }
  catch {
    return null
  }
}

export function isValidCidr(cidr: string): boolean {
  return parseCidr(cidr) !== null
}

/** Canonical network form accepted by Postgres `cidr` (host bits cleared), e.g. 10.1.2.3/8 → 10.0.0.0/8. */
export function canonicalCidr(cidr: string): string | null {
  const parsed = parseCidr(cidr)
  if (!parsed) {
    return null
  }
  const [addr, bits] = parsed
  const bytes = addr.toByteArray()
  for (let i = 0; i < bytes.length; i++) {
    const keep = Math.max(0, Math.min(8, bits - i * 8))
    bytes[i] = bytes[i]! & (0xFF << (8 - keep)) & 0xFF
  }
  return `${ipaddr.fromByteArray(bytes).toString()}/${bits}`
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const a = toAddr(ip)
  const parsed = parseCidr(cidr)
  if (!a || !parsed || a.kind() !== parsed[0].kind()) {
    return false
  }
  return a.match(parsed[0], parsed[1])
}

export function ipInAny(ip: string, cidrs: string[]): boolean {
  return cidrs.some(c => ipInCidr(ip, c))
}

/** 127.0.0.0/8 or ::1 (including IPv4-mapped forms). */
export function isLoopbackIp(ip: string | null | undefined): boolean {
  return toAddr(ip)?.range() === 'loopback'
}

/** A network inside the loopback range (e.g. 127.0.0.1/32, 127.0.0.0/8, ::1/128). */
export function isLoopbackCidr(cidr: string): boolean {
  const parsed = parseCidr(cidr)
  return !!parsed && parsed[0].range() === 'loopback' && parsed[1] >= (parsed[0].kind() === 'ipv4' ? 8 : 128)
}

function headerValues(headers: Record<string, string | string[] | undefined>, name: string): string[] {
  const v = headers[name.toLowerCase()]
  if (v === undefined) {
    return []
  }
  return (Array.isArray(v) ? v : [v]).flatMap(x => x.split(','))
}

export function resolveClientIp(
  remoteAddress: string | null | undefined,
  headers: Record<string, string | string[] | undefined>,
  opts: ClientIpOptions,
): ResolvedIp {
  const resolved = observedClientIp(remoteAddress, headers, opts)
  const peerSource = opts.peerSource ?? 'socket'
  const override = normalizeIp(opts.loopbackOverride)
  // Only a direct loopback connection (no proxy header was trusted) is substituted.
  if (override && resolved.source === peerSource && isLoopbackIp(resolved.ip)) {
    return { ip: override, source: `${peerSource}+loopback-override` }
  }
  return resolved
}

function observedClientIp(
  remoteAddress: string | null | undefined,
  headers: Record<string, string | string[] | undefined>,
  opts: ClientIpOptions,
): ResolvedIp {
  const remote = normalizeIp(remoteAddress)
  const trusted = opts.trustedProxies
  const chain = headerValues(headers, 'x-forwarded-for').map(h => h.trim()).filter(Boolean)
  const peerSource = opts.peerSource ?? 'socket'

  if (opts.mode === 'xff') {
    if (!remote || !ipInAny(remote, trusted)) {
      // Not from our proxy: the header could be forged by anyone, ignore it.
      return { ip: remote, source: peerSource }
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      const hop = normalizeIp(chain[i])
      if (!hop) {
        return { ip: null, source: 'xff-invalid' }
      }
      if (!ipInAny(hop, trusted)) {
        return { ip: hop, source: 'xff' }
      }
    }
    return { ip: normalizeIp(chain[0]) ?? remote, source: 'xff' }
  }

  if (opts.mode === 'header') {
    if (trusted.length > 0 && (!remote || !ipInAny(remote, trusted))) {
      return { ip: remote, source: peerSource }
    }
    const name = (opts.header ?? '').toLowerCase()
    const values = name ? headerValues(headers, name).map(v => v.trim()).filter(Boolean) : []
    if (values.length !== 1) {
      return { ip: null, source: `header:${name || 'unset'}-invalid` }
    }
    return { ip: normalizeIp(values[0]), source: `header:${name}` }
  }

  return { ip: remote, source: peerSource }
}
