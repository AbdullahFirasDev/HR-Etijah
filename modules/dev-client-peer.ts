/**
 * Development only — passes the real TCP peer of each request from the `nuxi dev` main process to
 * the app worker in an authenticated header. See server/lib/dev-peer.ts for why X-Forwarded-For
 * cannot be used for this.
 */
import { randomBytes } from 'node:crypto'
import { defineEventHandler } from 'h3'
import { defineNuxtModule } from 'nuxt/kit'
import { DEV_PEER_TOKEN_ENV, stampDevPeer } from '../server/lib/dev-peer'

export default defineNuxtModule({
  meta: { name: 'dev-client-peer' },
  setup(_options, nuxt) {
    if (!nuxt.options.dev) {
      return
    }
    // Inherited by the dev worker threads (they copy process.env); never sent to the browser.
    process.env[DEV_PEER_TOKEN_ENV] ||= randomBytes(32).toString('hex')
    const token = process.env[DEV_PEER_TOKEN_ENV]!
    // Nitro registers dev handlers ahead of the proxy to the worker.
    nuxt.options.nitro.devHandlers ||= []
    nuxt.options.nitro.devHandlers.push({
      handler: defineEventHandler((event) => {
        stampDevPeer(event.node.req, token)
      }),
    })
  },
})
