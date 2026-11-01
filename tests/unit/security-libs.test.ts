import { describe, expect, it } from 'vitest'
import { assessLocationRisk, haversineMeters } from '~~/server/lib/geo-risk'
import { ipInAny, ipInCidr, isValidCidr, normalizeIp, resolveClientIp } from '~~/server/lib/ip'
import { cookieMaxAge, newSessionTimes, sessionState, shouldRecordActivity } from '~~/server/lib/session-policy'

describe('IP normalisation and CIDR matching', () => {
  it('normalises IPv4-mapped IPv6, ports and brackets', () => {
    expect(normalizeIp('::ffff:203.0.113.7')).toBe('203.0.113.7')
    expect(normalizeIp('203.0.113.7:51234')).toBe('203.0.113.7')
    expect(normalizeIp('[2001:db8::1]:443')).toBe('2001:db8::1')
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80::1')
  })

  it('rejects garbage and ambiguous legacy forms', () => {
    expect(normalizeIp('not-an-ip')).toBeNull()
    expect(normalizeIp('1')).toBeNull()
    expect(normalizeIp('010.0.0.1')).toBeNull()
    expect(normalizeIp('')).toBeNull()
  })

  it('matches single hosts and ranges for both families', () => {
    expect(ipInCidr('203.0.113.7', '203.0.113.7')).toBe(true)
    expect(ipInCidr('203.0.113.7', '203.0.113.0/24')).toBe(true)
    expect(ipInCidr('203.0.114.7', '203.0.113.0/24')).toBe(false)
    expect(ipInCidr('2001:db8::abcd', '2001:db8::/32')).toBe(true)
    expect(ipInCidr('203.0.113.7', '2001:db8::/32')).toBe(false)
    expect(ipInCidr('::ffff:10.1.2.3', '10.0.0.0/8')).toBe(true)
    expect(ipInAny('192.168.1.10', ['10.0.0.0/8', '192.168.0.0/16'])).toBe(true)
  })

  it('validates CIDR input', () => {
    expect(isValidCidr('203.0.113.0/24')).toBe(true)
    expect(isValidCidr('203.0.113.0/33')).toBe(false)
    expect(isValidCidr('2001:db8::/129')).toBe(false)
    expect(isValidCidr('hello')).toBe(false)
  })
})

describe('client IP resolution', () => {
  const forged = { 'x-forwarded-for': '203.0.113.7' } // the company IP, forged by an attacker

  it('ignores X-Forwarded-For entirely in "none" mode', () => {
    expect(resolveClientIp('198.51.100.20', forged, { mode: 'none', trustedProxies: [] }))
      .toEqual({ ip: '198.51.100.20', source: 'socket' })
  })

  it('ignores X-Forwarded-For when the peer is not a trusted proxy', () => {
    expect(resolveClientIp('198.51.100.20', forged, { mode: 'xff', trustedProxies: ['10.0.0.0/8'] }))
      .toEqual({ ip: '198.51.100.20', source: 'socket' })
  })

  it('takes the right-most untrusted hop behind trusted proxies (left-most entries are spoofable)', () => {
    const headers = { 'x-forwarded-for': '203.0.113.7, 198.51.100.20, 10.0.0.5' }
    expect(resolveClientIp('10.0.0.2', headers, { mode: 'xff', trustedProxies: ['10.0.0.0/8'] }))
      .toEqual({ ip: '198.51.100.20', source: 'xff' })
  })

  it('handles multiple X-Forwarded-For headers and rejects malformed hops', () => {
    expect(resolveClientIp('10.0.0.2', { 'x-forwarded-for': ['198.51.100.20', '10.0.0.9'] }, { mode: 'xff', trustedProxies: ['10.0.0.0/8'] }).ip)
      .toBe('198.51.100.20')
    expect(resolveClientIp('10.0.0.2', { 'x-forwarded-for': 'evil, 10.0.0.9' }, { mode: 'xff', trustedProxies: ['10.0.0.0/8'] }).ip)
      .toBeNull()
  })

  it('reads a platform header, optionally only from trusted peers', () => {
    const h = { 'cf-connecting-ip': '198.51.100.20' }
    expect(resolveClientIp('172.68.1.1', h, { mode: 'header', header: 'cf-connecting-ip', trustedProxies: [] }).ip).toBe('198.51.100.20')
    expect(resolveClientIp('198.51.100.99', h, { mode: 'header', header: 'cf-connecting-ip', trustedProxies: ['172.64.0.0/13'] }))
      .toEqual({ ip: '198.51.100.99', source: 'socket' })
    expect(resolveClientIp('172.68.1.1', { 'cf-connecting-ip': '1.1.1.1, 2.2.2.2' }, { mode: 'header', header: 'cf-connecting-ip', trustedProxies: [] }).ip)
      .toBeNull()
  })
})

describe('location risk scoring', () => {
  const base = { latitude: 32.025913, longitude: 44.346187, accuracy: 12, ageMs: 1500 }
  const now = new Date('2026-11-01T06:00:00Z')
  const opts = { now, maxTravelSpeedKmh: 250, maxAgeMs: 60_000 }

  it('scores a normal reading as zero risk', () => {
    expect(assessLocationRisk({ ...opts, reading: base })).toEqual({ score: 0, flags: [], travelSpeedKmh: undefined })
  })

  it('flags typical mock-location artefacts', () => {
    const r = assessLocationRisk({ ...opts, reading: { ...base, latitude: 32.026, longitude: 44.346, accuracy: 0 } })
    expect(r.flags).toEqual(expect.arrayContaining(['accuracy_zero', 'coordinates_low_precision']))
    expect(r.score).toBe(55)
  })

  it('flags impossible travel since the last known position', () => {
    // Baghdad → Najaf (~143 km) in 10 minutes ≈ 860 km/h
    const r = assessLocationRisk({ ...opts, reading: base, previous: { latitude: 33.3152, longitude: 44.3661, at: new Date(now.getTime() - 10 * 60_000) } })
    expect(r.flags).toContain('impossible_travel')
    expect(r.score).toBeGreaterThanOrEqual(80)
    expect(r.travelSpeedKmh).toBeGreaterThan(800)
  })

  it('does not flag GPS jitter as travel', () => {
    const r = assessLocationRisk({ ...opts, reading: base, previous: { latitude: 32.0262, longitude: 44.3459, at: new Date(now.getTime() - 60_000) } })
    expect(r.flags).toEqual([])
  })

  it('flags exactly repeated coordinates over a long interval and automation', () => {
    const r = assessLocationRisk({ ...opts, webdriver: true, reading: base, previous: { latitude: base.latitude, longitude: base.longitude, at: new Date(now.getTime() - 3 * 3600_000) } })
    expect(r.flags).toEqual(expect.arrayContaining(['identical_coordinates', 'automation_detected']))
  })

  it('computes geodesic distance', () => {
    expect(haversineMeters(32.0259, 44.3462, 32.0262, 44.3462)).toBeCloseTo(33.4, 0)
  })
})

describe('session expiry policy', () => {
  const t0 = new Date('2026-11-01T06:00:00Z')
  const at = (s: number) => new Date(t0.getTime() + s * 1000)

  it('expires 10 minutes after login even with continuous activity (absolute limit)', () => {
    const s = newSessionTimes(t0, 600, 600)
    s.lastActivityAt = at(590)
    expect(sessionState(s, at(599)).valid).toBe(true)
    expect(sessionState(s, at(600))).toEqual({ valid: false, reason: 'absolute_timeout' })
  })

  it('expires after the idle timeout without activity', () => {
    const s = newSessionTimes(t0, 3600, 600)
    expect(sessionState(s, at(599)).valid).toBe(true)
    expect(sessionState(s, at(600))).toEqual({ valid: false, reason: 'idle_timeout' })
    s.lastActivityAt = at(500)
    expect(sessionState(s, at(1000)).valid).toBe(true)
  })

  it('reports whichever expiry comes first', () => {
    const s = newSessionTimes(t0, 600, 600)
    s.lastActivityAt = at(300)
    const st = sessionState(s, at(400))
    expect(st.valid && st.expiresAt.toISOString()).toBe(at(600).toISOString())
  })

  it('treats revoked sessions as invalid immediately', () => {
    const s = newSessionTimes(t0, 600, 600)
    s.revokedAt = at(10)
    expect(sessionState(s, at(11))).toEqual({ valid: false, reason: 'revoked' })
  })

  it('never sets a cookie lifetime beyond the absolute expiry and throttles activity writes', () => {
    const s = newSessionTimes(t0, 600, 600)
    expect(cookieMaxAge(s, at(100))).toBe(500)
    expect(cookieMaxAge(s, at(700))).toBe(0)
    expect(shouldRecordActivity(s, at(5))).toBe(false)
    expect(shouldRecordActivity(s, at(20))).toBe(true)
  })
})
