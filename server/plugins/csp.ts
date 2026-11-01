/**
 * Attach a hash-based Content-Security-Policy to every HTML document the renderer produces.
 * The body is buffered (the SPA shell is a few KB) so the exact inline scripts can be hashed.
 */
import { devErrorOverlayScriptHashes, documentCsp, inlineScriptHashes } from '../lib/csp'

let devOverlayHashes: Promise<string[]> | undefined

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:response', async (response) => {
    const headers = response?.headers as Record<string, string | undefined> | undefined
    if (!headers || !String(headers['content-type'] ?? '').includes('text/html')) {
      return
    }
    let html: string
    const body: unknown = response.body
    if (typeof body === 'string') {
      html = body
    }
    else if (body instanceof ReadableStream) {
      html = await new Response(body).text()
    }
    else if (body instanceof Uint8Array) {
      html = Buffer.from(body).toString('utf8')
    }
    else {
      return
    }
    response.body = html

    const scriptHashes = inlineScriptHashes(html)
    if (import.meta.dev) {
      // Keep Nuxt's dev error overlay working under the strict policy (development only).
      devOverlayHashes ??= devErrorOverlayScriptHashes().catch((error) => {
        console.warn('[csp] could not compute the dev error overlay hash; the overlay will be blocked:', (error as Error).message)
        return []
      })
      scriptHashes.push(...await devOverlayHashes)
    }
    headers['content-security-policy'] = documentCsp({ scriptHashes, dev: import.meta.dev })
  })
})
