#!/usr/bin/env node

/**
 * One-shot superadmin bootstrap. Inserts your email into the `superAdmins`
 * table so the admin panel (apps/admin) recognizes you as a platform operator.
 *
 * This is a one-time setup step. After bootstrapping, you can add/remove
 * superadmins from the admin panel itself (Superadmins tab).
 *
 * Usage:
 *   bun run bootstrap-superadmin -- --email=you@example.com
 *
 * Or to use the default email from convex/superAdmins.ts (aneaire010@gmail.com):
 *   bun run bootstrap-superadmin
 *
 * The email must already have a Convex Auth account. If it doesn't, sign up
 * first at the admin panel's /login page (the superadmin email bypasses the
 * normal invitation gate).
 *
 * Idempotent: re-running on an already-bootstrapped email is a no-op.
 */

import { spawnSync } from 'node:child_process'

const args = parseArgs(process.argv.slice(2))
const email = args.email ?? 'aneaire010@gmail.com'

if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
  console.error(`Invalid email: "${email}"`)
  console.error('Usage: bun run bootstrap-superadmin -- --email=you@example.com')
  process.exit(1)
}

const result = spawnSync(
  'bunx',
  ['convex', 'run', 'superAdmins:bootstrap', JSON.stringify({ email })],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
)

if (result.status !== 0) {
  console.error('Bootstrap failed:')
  if (result.stderr) console.error(result.stderr.trim())
  if (result.stdout) console.error(result.stdout.trim())
  process.exit(result.status ?? 1)
}

const response = parseJson(result.stdout)

console.log()
console.log('── Superadmin bootstrap ──────────────────────────────────────────')
console.log(`  Email:           ${response.email}`)
console.log(`  Already existed: ${response.alreadyExisted ? 'yes (no-op)' : 'no (newly added)'}`)
console.log(`  Superadmin ID:   ${response.id}`)
console.log()
console.log('Next steps:')
console.log('  1. If you haven\'t already, sign up at the admin panel with this email:')
console.log('     http://localhost:3001/login')
console.log('     (superadmin emails bypass the normal invitation gate)')
console.log('  2. Sign in and you\'ll see the dashboard.')
console.log('  3. Provision a tenant from the "Provision tenant" page.')
console.log('──────────────────────────────────────────────────────────────────')
console.log()

function parseArgs(argv) {
  const parsed = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const match = /^--([\w-]+)(?:=(.*))?$/.exec(arg)
    if (!match) continue
    const [, key, value] = match
    parsed[key] = value ?? 'true'
  }
  return parsed
}

function parseJson(stdout) {
  const start = stdout.indexOf('{')
  const end = stdout.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`No JSON in convex run output:\n${stdout}`)
  }
  return JSON.parse(stdout.slice(start, end + 1))
}
