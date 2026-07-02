#!/usr/bin/env node

/**
 * Phase B buyer-provisioning script.
 *
 * Usage:
 *   bun run provision -- \
 *     --name="Acme Surveying" \
 *     --subdomain=acme \
 *     --seats=5 \
 *     --plan=office \
 *     --admin-email=admin@acme.example
 *
 * Optional flags:
 *   --key=XXXX-XXXX-...   existing key (otherwise auto-generated)
 *   --sale-ref=INV-1042    your invoice reference; stored for auditing
 *   --notes="Annual license, paid by wire"
 *   --issued-by="you@yourdomain.com"
 *
 * Invokes `bunx convex run provisioning:provision <jsonArgs>` against the
 * deployment this repo is linked to (.env.local CONVEX_DEPLOYMENT).
 * Only the platform operator can run `bunx convex run`; that privilege IS
 * the authentication here. There is no Stripe and no self-service signup.
 *
 * Result: prints a buyer-facing summary block with the license key, subdomain
 * URL, and admin invite email to hand over.
 */

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const args = parseArgs(process.argv.slice(2))

const required = ['name', 'subdomain', 'seats', 'plan', 'admin-email']
for (const key of required) {
  if (!args[key]) {
    console.error(`Missing required flag: --${key}`)
    printUsage()
    process.exit(1)
  }
}

const jsonArgs = {
  name: args.name,
  subdomain: args.subdomain,
  plan: args.plan,
  seats: Number(args.seats),
  licenseKey: args.key ?? generateLicenseKey(),
  adminEmail: args['admin-email'],
  saleRef: args['sale-ref'],
  notes: args.notes,
  issuedBy: args['issued-by'],
}

const result = spawnSync(
  'bunx',
  ['convex', 'run', 'provisioning:provision', JSON.stringify(jsonArgs)],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
)

if (result.status !== 0) {
  console.error('Convex run failed:')
  if (result.stderr) console.error(result.stderr.trim())
  if (result.stdout) console.error(result.stdout.trim())
  process.exit(result.status ?? 1)
}

/** @type {{ licenseKey: string, subdomain: string, adminEmail: string, plan: string, seats: number, tenantId: string }} */
const response = parseJson(result.stdout)

printSummary(response)

// ────────────────────────────────────────────────────────────────────────

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

function printSummary(r) {
  const subdomainUrl = `https://${r.subdomain}.${apexDomain()}`
  const installUrl = 'https://github.com/your-org/your-repo/releases/latest' // replace when you ship
  console.log()
  console.log('── Buyer-facing summary ─────────────────────────────────────────')
  console.log()
  console.log(`  License key:    ${r.licenseKey}`)
  console.log(`  Subdomain:      ${subdomainUrl}`)
  console.log(`  Admin email:    ${r.adminEmail}`)
  console.log(`  Plan:           ${r.plan}`)
  console.log(`  Seats:          ${r.seats}`)
  console.log(`  Tenant ID:      ${r.tenantId}`)
  console.log()
  console.log('Hand these to the buyer:')
  console.log('  1. The license key above.')
  console.log('  2. The subdomain URL (and the admin invite email — ask them to')
  console.log('     sign in there with that email address).')
  console.log('  3. The desktop installer download link:')
  console.log(`       ${installUrl}`)
  console.log()
  console.log('Revoke later via:')
  console.log(`  bunx convex run licenseHttp:revoke <{"licenseKey":"${r.licenseKey}"}> \\`)
  console.log('     (will require the licensor\'s superadmin token on the web admin')
  console.log('     dashboard once it ships in Phase G)')
  console.log('────────────────────────────────────────────────────────────────')
}

function apexDomain() {
  return process.env.SAAS_APEX_DOMAIN ?? 'yourdomain.com'
}

function printUsage() {
  console.error('Usage:')
  console.error('  bun run provision -- --name="Acme Surveying" --subdomain=acme \\')
  console.error('    --seats=5 --plan=office --admin-email=admin@acme.example')
  console.error()
  console.error('Optional:')
  console.error('  --key=XXXX-...       pre-existing license key')
  console.error('  --sale-ref=INV-...   invoice reference')
  console.error('  --notes="..."        free-form notes')
  console.error('  --issued-by=email    your email (operator)')
}