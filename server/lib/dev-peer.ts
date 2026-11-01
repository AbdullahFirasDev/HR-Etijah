/**
 * Development only: the real TCP peer of a request served by `nuxi dev`.
 *
 * `nuxi dev` accepts the browser's connection in its main process and proxies the request to the
 * app worker over an IPC pipe, so inside the app the socket peer is missing (or is the proxy).
 * Nitro's dev proxy adds X-Forwarded-For only when the client did not send one, so that header is
 * client-controlled and is never used for this. Instead, a dev-server handler in the main process
 * (modules/dev-client-peer.ts, which runs before the proxy) removes any client copy of
 * DEV_PEER_HEADER and writes the real socket peer into it, authenticated by a random per-process
 * token that only the main process and its worker threads know (inherited via process.env).
 * The worker accepts the peer only with that token; otherwise the client IP is unknown (fail
 * closed). Production builds never read the header: they use the real socket peer.
 */
import { timingSafeEqual } from 'node:crypto'
import { normalizeIp } from './ip'

export const DEV_PEER_HEADER = 'x-etijah-dev-peer'
export const DEV_PEER_TOKEN_ENV = 'ETIJAH_DEV_PEER_TOKEN'

interface NodeRequestLike {
  headers: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string } | null
}

/** Main dev process, before proxying: replace any client-supplied header with the real peer. */
export function stampDevPeer(req: NodeRequestLike, token: string): void {
  delete req.headers[DEV_PEER_HEADER]
  const peer = normalizeIp(req.socket?.remoteAddress)
  if (peer && token) {
    req.headers[DEV_PEER_HEADER] = `${token} ${peer}`
  }
}

/** Dev worker: the stamped peer when the token matches, otherwise null. */
export function readDevPeer(value: string | string[] | undefined, token: string | undefined): string | null {
  if (!token || typeof value !== 'string') {
    return null
  }
  const sep = value.indexOf(' ')
  const given = Buffer.from(sep > 0 ? value.slice(0, sep) : '')
  const expected = Buffer.from(token)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null
  }
  return normalizeIp(value.slice(sep + 1))
}
