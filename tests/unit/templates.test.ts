/**
 * Guard: resolveComponent() must not be called inside a <template>. There it compiles to a
 * runtime lookup that Nuxt does not rewrite into an import, and Nuxt components (NuxtLink,
 * auto-imported app components) are not globally registered → "Failed to resolve component".
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')

function vueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? vueFiles(p) : p.endsWith('.vue') ? [p] : []
  })
}

describe('component templates', () => {
  it('never call resolveComponent() inside <template>', () => {
    const offenders = vueFiles(join(ROOT, 'app')).filter((file) => {
      const template = /<template>([\s\S]*)<\/template>\s*$/.exec(readFileSync(file, 'utf8'))?.[1] ?? ''
      return /resolveComponent\s*\(/.test(template)
    }).map(f => relative(ROOT, f))
    expect(offenders).toEqual([])
  })
})
