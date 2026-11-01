/**
 * Client IP used for the company IP allowlist: localhost vs the office public network,
 * the explicit local-testing setting, spoofed forwarding headers, and the `nuxi dev` peer hand-off.
 * The allowlist itself is matched in Postgres (tests/db/attendance.test.ts); `allowed()` mirrors it.
 */
import { describe, expect, it } from 'vitest'
import { effectiveLoopbackClientIp } from '~~/server/lib/config-validate'
import { DEV_PEER_HEADER, readDevPeer, stampDevPeer } from '~~/server/lib/dev-peer'
import { ipInAny, isLoopbackCidr, isLoopbackIp, resolveClientIp, type ClientIpOptions } from '~~/server/lib/ip'
import { formatNetworkDecision } from '~~/server/lib/net-log'

const OFFICE_IP = '169.224.96.169'
const ALLOWLIST = [`${OFFICE_IP}/32`] // the company's approved public IP — and nothing else
const allowed = (ip: string | null) => !!ip && ipInAny(ip, ALLOWLIST)

const direct: ClientIpOptions = { mode: 'none', trustedProxies: [] }
const localTesting: ClientIpOptions = { ...direct, loopbackOverride: OFFICE_IP }

/** Every header a client can use to claim another address. */
const SPOOFED = {
  'x-forwarded-for': OFFICE_IP,
  'forwarded': `for=${OFFICE_IP};proto=https`,
  'x-real-ip': OFFICE_IP,
  'cf-connecting-ip': OFFICE_IP,
  'true-client-ip': OFFICE_IP,
  'x-client-ip': OFFICE_IP,
}

describe('localhost requests', () => {
  it('are seen as loopback, which is not the office network', () => {
    for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      const r = resolveClientIp(peer, {}, direct)
      expect(isLoopbackIp(r.ip)).toBe(true)
      expect(allowed(r.ip)).toBe(false)
    }
  })

  it('with NUXT_DEV_LOOPBACK_CLIENT_IP are checked as that address, which must still be allow-listed', () => {
    expect(resolveClientIp('::1', {}, localTesting)).toEqual({ ip: OFFICE_IP, source: 'socket+loopback-override' })
    expect(resolveClientIp('127.0.0.1', {}, { ...localTesting, peerSource: 'dev-peer' }))
      .toEqual({ ip: OFFICE_IP, source: 'dev-peer+loopback-override' })
    expect(allowed(resolveClientIp('::1', {}, localTesting).ip)).toBe(true)
    // An address that is not on the list stays rejected: the setting does not bypass the allowlist.
    expect(allowed(resolveClientIp('::1', {}, { ...direct, loopbackOverride: '198.51.100.7' }).ip)).toBe(false)
  })

  it('the setting only replaces loopback — LAN, public and unknown peers are untouched', () => {
    expect(resolveClientIp('192.168.100.89', {}, localTesting)).toEqual({ ip: '192.168.100.89', source: 'socket' })
    expect(resolveClientIp('203.0.113.9', {}, localTesting)).toEqual({ ip: '203.0.113.9', source: 'socket' })
    expect(resolveClientIp(null, {}, localTesting)).toEqual({ ip: null, source: 'socket' })
  })
})

describe('requests through the office public network', () => {
  it('accept the approved public IP (what the server sees after the office NAT)', () => {
    const r = resolveClientIp(OFFICE_IP, {}, direct)
    expect(r).toEqual({ ip: OFFICE_IP, source: 'socket' })
    expect(allowed(r.ip)).toBe(true)
  })

  it('accept it behind a trusted reverse proxy that reports it', () => {
    const r = resolveClientIp('127.0.0.1', { 'x-forwarded-for': OFFICE_IP }, { mode: 'xff', trustedProxies: ['127.0.0.1/32', '::1/128'] })
    expect(r).toEqual({ ip: OFFICE_IP, source: 'xff' })
    expect(allowed(r.ip)).toBe(true)
  })

  it('reject an unapproved IP', () => {
    for (const peer of ['203.0.113.9', '169.224.96.170', '192.168.100.89', '2001:db8::1']) {
      expect(allowed(resolveClientIp(peer, {}, direct).ip)).toBe(false)
    }
  })
})

describe('spoofed forwarding headers', () => {
  it('are ignored from an untrusted peer, so claiming the office IP fails', () => {
    for (const [name, value] of Object.entries(SPOOFED)) {
      const r = resolveClientIp('203.0.113.9', { [name]: value }, direct)
      expect(r.ip, name).toBe('203.0.113.9')
      expect(allowed(r.ip), name).toBe(false)
    }
    expect(resolveClientIp('203.0.113.9', SPOOFED, { mode: 'xff', trustedProxies: ['10.0.0.0/8'] }).ip).toBe('203.0.113.9')
  })

  it('cannot make a localhost request pass, nor steer the local-testing setting', () => {
    expect(resolveClientIp('::1', SPOOFED, direct).ip).toBe('::1')
    expect(resolveClientIp('::1', { 'x-forwarded-for': '198.51.100.7' }, localTesting).ip).toBe(OFFICE_IP)
  })

  it('cannot turn a trusted proxy hop into loopback to trigger the local-testing setting', () => {
    const viaProxy = { mode: 'xff' as const, trustedProxies: ['10.0.0.0/8'], loopbackOverride: OFFICE_IP }
    expect(resolveClientIp('10.0.0.2', { 'x-forwarded-for': '127.0.0.1' }, viaProxy)).toEqual({ ip: '127.0.0.1', source: 'xff' })
  })
})

describe('nuxi dev: real peer handed from the dev server process to the app worker', () => {
  const TOKEN = 'a'.repeat(64)
  const hop = (socketAddress: string, headers: Record<string, string>) => {
    const req = { headers: { ...headers } as Record<string, string | string[] | undefined>, socket: { remoteAddress: socketAddress } }
    stampDevPeer(req, TOKEN) // main dev process, before proxying
    return req.headers
  }

  it('passes the real socket peer, not any client header', () => {
    const headers = hop('::1', { ...SPOOFED, [DEV_PEER_HEADER]: `${TOKEN} ${OFFICE_IP}` })
    const peer = readDevPeer(headers[DEV_PEER_HEADER], TOKEN)
    expect(peer).toBe('::1')
    expect(resolveClientIp(peer, headers, { ...direct, peerSource: 'dev-peer' })).toEqual({ ip: '::1', source: 'dev-peer' })
    expect(resolveClientIp(peer, headers, { ...localTesting, peerSource: 'dev-peer' }).ip).toBe(OFFICE_IP)
  })

  it('keeps a remote peer as is', () => {
    expect(readDevPeer(hop('::ffff:203.0.113.9', {})[DEV_PEER_HEADER], TOKEN)).toBe('203.0.113.9')
  })

  it('fails closed without the per-process token', () => {
    expect(readDevPeer(`${'b'.repeat(64)} ${OFFICE_IP}`, TOKEN)).toBeNull()
    expect(readDevPeer(`${TOKEN} ${OFFICE_IP}`, undefined)).toBeNull()
    expect(readDevPeer(OFFICE_IP, TOKEN)).toBeNull()
    expect(readDevPeer(undefined, TOKEN)).toBeNull()
    expect(readDevPeer([`${TOKEN} ${OFFICE_IP}`, `${TOKEN} ::1`], TOKEN)).toBeNull()
    expect(readDevPeer(`${TOKEN} not-an-ip`, TOKEN)).toBeNull()
  })

  it('drops a client-supplied copy even when the peer is unknown', () => {
    const req = { headers: { [DEV_PEER_HEADER]: `${TOKEN} ${OFFICE_IP}` } as Record<string, string | undefined>, socket: {} }
    stampDevPeer(req, TOKEN)
    expect(req.headers[DEV_PEER_HEADER]).toBeUndefined()
  })
})

describe('production', () => {
  it('never applies the local-testing setting', () => {
    expect(effectiveLoopbackClientIp('production', OFFICE_IP)).toBeNull()
    expect(effectiveLoopbackClientIp('development', OFFICE_IP)).toBe(OFFICE_IP)
    expect(effectiveLoopbackClientIp('test', OFFICE_IP)).toBe(OFFICE_IP)
    expect(effectiveLoopbackClientIp('development', '')).toBeNull()
    expect(effectiveLoopbackClientIp('development', '::1')).toBeNull()
    expect(effectiveLoopbackClientIp('development', '169.224.96.0/24')).toBeNull()
  })

  it('so a localhost request is rejected even if the setting is present', () => {
    const r = resolveClientIp('::1', SPOOFED, { ...direct, loopbackOverride: effectiveLoopbackClientIp('production', OFFICE_IP) })
    expect(r).toEqual({ ip: '::1', source: 'socket' })
    expect(allowed(r.ip)).toBe(false)
  })
})

describe('allowlist entries', () => {
  it('loopback ranges are recognised (and refused by the admin API)', () => {
    for (const c of ['127.0.0.1/32', '127.0.0.0/8', '::1/128', '::ffff:127.0.0.1/128']) {
      expect(isLoopbackCidr(c), c).toBe(true)
    }
    for (const c of [`${OFFICE_IP}/32`, '192.168.100.89/32', '0.0.0.0/0', '::/0', '2001:db8::/32']) {
      expect(isLoopbackCidr(c), c).toBe(false)
    }
  })
})

describe('network decision log line', () => {
  it('shows the peer, the resolved IP and how it was obtained', () => {
    expect(formatNetworkDecision({ stage: 'precheck', employeeCode: 'E004', action: 'check_in', peer: '::1', ip: OFFICE_IP, source: 'dev-peer+loopback-override', passed: true, reasons: [] }))
      .toBe('[net] precheck emp=E004 action=check_in peer=::1 ip=169.224.96.169 source=dev-peer+loopback-override → ACCEPT')
    expect(formatNetworkDecision({ stage: 'submit', employeeCode: 'E004', action: 'check_out', peer: null, ip: null, source: 'dev-peer', passed: false, reasons: ['network_unknown'] }))
      .toBe('[net] submit emp=E004 action=check_out peer=none ip=none source=dev-peer → REJECT reasons=network_unknown')
  })
})
