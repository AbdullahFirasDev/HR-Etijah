#!/usr/bin/env node
/**
 * Type-check without touching `.nuxt`.
 *
 * `nuxi typecheck` regenerates files inside `.nuxt`, the directory a running `nuxi dev` serves
 * its Nitro worker from; overlapping the two can leave the dev server answering
 * "worker entry not found in .nuxt/dev/index.mjs". This script generates the types into a
 * separate directory and runs vue-tsc against it, so it is safe while the dev server runs.
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
// Outside node_modules: TypeScript ignores declaration files located there.
const buildDir = join(root, '.nuxt-typecheck')
const env = { ...process.env, NUXT_BUILD_DIR: buildDir }
const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' })

const prepare = run('npx', ['nuxi', 'prepare'])
if (prepare.status !== 0) process.exit(prepare.status ?? 1)

const solution = join(buildDir, 'tsconfig.typecheck.json')
writeFileSync(solution, JSON.stringify({
  files: [],
  references: ['app', 'server', 'shared', 'node'].map(name => ({ path: `./tsconfig.${name}.json` })),
}, null, 2))

const tsc = run('npx', ['vue-tsc', '-b', '--noEmit', solution])
process.exit(tsc.status ?? 1)
