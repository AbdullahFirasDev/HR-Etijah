#!/usr/bin/env node
/**
 * Local Vercel build: the same `nuxt build` Vercel runs, with the `vercel` Nitro preset forced
 * (on Vercel it is detected automatically). Writes `.vercel/output` (Build Output API v3) and
 * uses a separate build directory so a running `nuxi dev` keeps its `.nuxt`. Check the result
 * with `npm run verify:vercel`. Nothing is deployed.
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const env = { ...process.env, NITRO_PRESET: 'vercel', NUXT_BUILD_DIR: resolve(root, '.nuxt-vercel') }
const r = spawnSync('npx', ['nuxt', 'build'], { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' })
process.exit(r.status ?? 1)
