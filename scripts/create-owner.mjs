#!/usr/bin/env node
/**
 * Bootstrap the first Owner account on a fresh deployment (the dev seed is never used in
 * production). Prints a one-time temporary password; the owner must change it at first sign-in.
 *
 *   NUXT_SUPABASE_URL=… NUXT_SUPABASE_SERVICE_ROLE_KEY=… \
 *     node scripts/create-owner.mjs --email owner@company.com --name "الاسم الكامل" [--name-en "Full Name"]
 */
import { randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'
import { createClient } from '@supabase/supabase-js'

const { values } = parseArgs({
  options: {
    'email': { type: 'string' },
    'name': { type: 'string' },
    'name-en': { type: 'string' },
  },
})
const url = process.env.NUXT_SUPABASE_URL
const key = process.env.NUXT_SUPABASE_SERVICE_ROLE_KEY
if (!url || !key || !values.email || !values.name) {
  console.error('Usage: NUXT_SUPABASE_URL=… NUXT_SUPABASE_SERVICE_ROLE_KEY=… node scripts/create-owner.mjs --email <email> --name <full name> [--name-en <english name>]')
  process.exit(1)
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const email = values.email.toLowerCase()
// letters + digits, guaranteed upper/lower/digit to satisfy the password policy
const password = `${randomBytes(12).toString('base64url').replace(/[-_]/g, 'x')}Aa7`

const { data: owners } = await db.from('profiles').select('id, roles!inner(key)').eq('roles.key', 'owner')
if (owners?.length) {
  console.error('An owner already exists. Use the admin UI to manage accounts.')
  process.exit(1)
}
const { data: role, error: roleError } = await db.from('roles').select('id').eq('key', 'owner').single()
if (roleError) {
  console.error('Roles not found — run the database migrations first (supabase db push).', roleError.message)
  process.exit(1)
}
const { data: created, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: values.name } })
if (error) {
  console.error('Could not create the auth user:', error.message)
  process.exit(1)
}
const { error: profileError } = await db.from('profiles').insert({
  id: created.user.id,
  email,
  full_name: values.name,
  full_name_en: values['name-en'] ?? null,
  role_id: role.id,
  must_change_password: true,
})
if (profileError) {
  await db.auth.admin.deleteUser(created.user.id)
  console.error('Could not create the profile:', profileError.message)
  process.exit(1)
}
await db.from('audit_logs').insert({ actor_id: null, action: 'user.bootstrap_owner', entity_type: 'profile', entity_id: created.user.id })
console.log(`Owner created: ${email}`)
console.log(`Temporary password (shown once, change at first sign-in): ${password}`)
