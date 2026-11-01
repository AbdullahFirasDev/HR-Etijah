import { DEV_PEER_HEADER, DEV_PEER_TOKEN_ENV, readDevPeer } from '../lib/dev-peer'

/**
 * Development only: take the real client peer stamped by the `nuxi dev` main process (see
 * server/lib/dev-peer.ts) and remove the header so nothing else sees the token.
 * Compiled out of production builds, which use the real socket peer.
 */
export default defineEventHandler((event) => {
  if (!import.meta.dev) {
    return
  }
  const headers = event.node.req.headers
  event.context.devPeer = readDevPeer(headers[DEV_PEER_HEADER], process.env[DEV_PEER_TOKEN_ENV])
  delete headers[DEV_PEER_HEADER]
})
