#!/usr/bin/env node

/**
 * Phase A verification seed. Calls the same `provisioning:provision` mutation
 * as `provision.mjs` but with pre-filled safe defaults so you can run
 * end-to-end verification in one shot.
 *
 * Usage:
 *   bun run seed -- --subdomain=acme --name="Acme Surveying" --admin-email=admin@acme.test
 *
 * Defaults: --seats=5 --plan=office
 * Auto-generates the license key when --key is omitted.
 *
 * Idempotent caveat: re-running with the same --subdomain rejects.
 * Change the subdomain for a second seeded tenant (used to verify isolation).
 */

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const args = parseArgs(process.argv.slice(2))

const jsonArgs = {
  name: args.name ?? 'Acme Surveying',
  subdomain: args.subdomain ?? 'acme',
  plan: args.plan ?? 'office',
  seats: Number(args.seats ?? 5),
  licenseKey: args.key ?? generateLicenseKey(),
  adminEmail: args['admin-email'] ?? `admin@${args.subdomain ?? 'acme'}.test`,
  saleRef: 'SEED-' + Date.now(),
  notes: 'Seeded via bun run seed (Phase A verification).',
  issuedBy: 'seed.mjs',
}

const result = spawnSync(
  'bunx',
  ['convex', 'run', 'provisioning:provision', JSON.stringify(jsonArgs)],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
)

if (result.status !== 0) {
  console.error('Seed failed (the deployment may already contain this tenant):')
  if (result.stderr) console.error(result.stderr.trim())
  if (result.stdout) console.error(result.stdout.trim())
  process.exit(result.status ?? 1)
}

const response = parseJson(result.stdout)
console.log('Seeded tenant:')
console.log(JSON.stringify(response, null, 2))
console.log()
console.log('Next steps for verification:')
console.log('  1. Sign up the admin email (' + response.adminEmail + ') via the web app')
console.log('  2. Run api.tenants.current → should return this tenant')
console.log('  3. Run api.files.list → should return [] for this tenant only')
console.log('  4. Seed a second tenant (--subdomain=different) → verify isolation')

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

function generateLicenseKey() {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTVWXZ'
  const bytes = randomBytes(24)
  let raw = ''
  for (let i = 0; i < 24; i += 1) raw += alphabet[bytes[i] % alphabet.length]
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20, 24)}`
}

function parseJson(stdout) {
  // `npx convex run` prints pretty-printed multi-line JSON. Strip leading
  // status/preview text and grab the outermost JSON object.
  const start = stdout.indexOf('{')
  const end = stdout.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`No JSON in convex run output:\n${stdout}`)
  }
  return JSON.parse(stdout.slice(start, end + 1))
}