import { ipInCidr, isLoopbackIp } from '../../../lib/ip'

/** Shows the IP the server observes for THIS request and which allowed networks match it. */
export default defineEventHandler(async (event) => {
  const ctx = await requireAuth(event, { permission: 'settings.manage' })
  const ip = clientIp(event)
  const c = serverConfig()
  const networks = unwrap(await ctx.db.from('allowed_networks').select('id, label, cidr, is_active, office_id')) as any[]
  const matches = ip ? networks.filter(n => n.is_active && ipInCidr(ip, String(n.cidr))) : []
  const peer = (event.context.clientIpPeer as string | null) ?? null
  const source = String(event.context.clientIpSource)
  return {
    ip,
    source,
    peer,
    // The browser runs on the server machine: it can never show the office public IP.
    loopbackPeer: isLoopbackIp(peer),
    loopbackOverride: source.endsWith('+loopback-override'),
    socketAddress: event.node.req.socket?.remoteAddress ?? null,
    trustProxyMode: c.trustProxyMode,
    trustedProxies: c.trustedProxyCidrs,
    forwardedFor: getHeader(event, 'x-forwarded-for') ?? null,
    matches,
    allowed: matches.length > 0,
  }
})
