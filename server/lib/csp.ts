/**
 * Content-Security-Policy construction.
 *
 * Scripts: only same-origin files plus the exact inline scripts present in the HTML, each
 * allowed by its SHA-256 hash (Nuxt's runtime-config bootstrap, Nuxt UI's colour-mode script,
 * the module import map). No 'unsafe-inline', no 'unsafe-eval' — in any environment.
 *
 * Styles keep 'unsafe-inline': Vite (dev) and several UI libraries inject <style> elements at
 * runtime, which cannot be hashed ahead of time; style injection cannot execute script.
 */
import { createHash } from 'node:crypto'

const EXECUTABLE_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module', 'importmap'])

/** CSP source expressions for every executable inline <script> in the document. */
export function inlineScriptHashes(html: string): string[] {
  const hashes = new Set<string>()
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = m[1] ?? ''
    if (/\bsrc\s*=/i.test(attrs)) continue
    const type = (/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1] ?? '').toLowerCase()
    if (!EXECUTABLE_TYPES.has(type)) continue // e.g. application/json data blocks are never executed
    hashes.add(`'sha256-${createHash('sha256').update(m[2] ?? '', 'utf8').digest('base64')}'`)
  }
  return [...hashes]
}

/**
 * Development only. Nuxt's dev error overlay (rendered by `my-bad`, served by Vite outside
 * Nitro) inserts one inline <script> at runtime when a client error occurs. That script is
 * static — identical for every error — so it is allowed by its exact hash, computed from the
 * installed renderer with the options Nuxt uses. Nothing else is allowed; production never
 * calls this. The specifier is a variable so production bundles do not trace the package.
 */
export async function devErrorOverlayScriptHashes(): Promise<string[]> {
  const pkg = 'my-bad'
  const [renderer, presets] = await Promise.all([
    import(/* @vite-ignore */ pkg),
    import(/* @vite-ignore */ `${pkg}/presets`),
  ])
  const html: string = await renderer.renderOverlay(renderer.createReport(new Error('csp probe')), {
    cwd: process.cwd(),
    channel: '/__nuxt_error',
    theme: presets.nuxtTheme,
    tag: 'nuxt-error-overlay',
    startMinimized: true,
  })
  return inlineScriptHashes(html)
}

// The map uses OSM's single tile host (no a/b/c subdomains); '*.host' would not match it.
const TILES = 'https://tile.openstreetmap.org'

export function documentCsp(opts: { scriptHashes: string[], dev: boolean }): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${opts.scriptHashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${TILES}`,
    "font-src 'self' data:",
    // The Vite HMR websocket only exists in development.
    `connect-src 'self' ${TILES}${opts.dev ? ' ws: wss:' : ''}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
}

/** Policy for the service worker script: it fetches the API (same origin) and map tiles. */
export const SERVICE_WORKER_CSP = `default-src 'none'; script-src 'self'; connect-src 'self' ${TILES}`

/** Fallback for every non-HTML response (JSON, assets): nothing may be loaded or framed. */
export const RESOURCE_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
