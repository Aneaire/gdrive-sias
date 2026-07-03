# Gotchas — runtime pitfalls

Read this **before** writing Convex query filters or copying example code from `SaaS/`.

## Convex `eq` filter does not match `v.union(v.literal(...))` values

**Affected:** Convex 1.42.x (the version this repo currently runs). May be fixed in a
later Convex release; verify before assuming.

### Symptom

```ts
// Row exists with status === 'invited' (a v.union(v.literal('invited'|'active'|'removed')) field)
const invitation = await ctx.db
  .query('tenantMembers')
  .withIndex('by_invited_email', (q) => q.eq('invitedEmail', email))
  .filter((m) => m.eq('status', 'invited'))   // ← returns 0 rows (BUG)
  .first()
// invitation === null  ← even though the row is there and status is the literal 'invited'
```

### What works

- `.filter((m) => m.neq('status', 'removed'))` → works (returns the row).
- JS-side filtering after `.collect()` → works:

```ts
const rows = await ctx.db
  .query('tenantMembers')
  .withIndex('by_invited_email', (q) => q.eq('invitedEmail', email))
  .collect()
const invitation = rows.find((m) => m.status === 'invited') ?? null
```

### Rule for this repo

**Never use `.filter((m) => m.eq('<field>', '<literal>'))` on a `v.union(v.literal(...))`
field** (e.g. `tenantMembers.status`, `licenses.status`, `role`, `plan`,
`storageStatus`). Either:

1. Collect by index and filter in JS (`.collect()` then `.find`/`.filter`/`.some`), or
2. Use `.neq` against the *other* value(s) if the logic allows it.

The rest of the codebase already uses `.neq('status', 'removed')` for "non-removed
members" — that's why only the `eq` call sites broke.

### Where it bit us (fixed 2026-07-03)

- `convex/authSignupAllowlist.ts` — invitation lookup in `createOrUpdateInvitedUser`
  threw "No invitation found" and blocked all signups.
- `convex/tenantHelpers.ts` `getActiveMembership` (two call sites) — would have broken
  every tenant-scoped query (`tenants.current`, `files.list`, etc.) even after signup.

All three were switched to JS-side filtering with an inline comment explaining why.

### ⚠️ `SaaS/AUTH.md` still shows the buggy pattern

`SaaS/AUTH.md` (line ~46) specifies the invitation lookup using
`.filter((m) => m.eq('status', 'invited')).first()` as the *intended* code. That
example is how the bug entered the codebase. **Do not copy it verbatim.** `SaaS/` is
design intent; `docs/gotchas.md` overrides it for runtime behavior. If you update
`SaaS/AUTH.md`, fix the example to use JS-side filtering.

## Subdomain is not a routing key yet

Code that assumes the web resolves the tenant from the URL subdomain will be wrong
today. Tenant resolution is **membership-based** — see
[`architecture.md`](./architecture.md#tenant-resolution--membership-based-not-subdomain-based).
The host-based resolver is a planned work item (`plan/subdomain-resolver.md`).

## Local dev uses `localhost`, not subdomains

Don't expect `acme.localhost:3000` or any subdomain routing to work in dev. The web
runs at plain `http://localhost:3000` and resolves the tenant via the signed-in
user's membership. Any subdomain-resolver code you add must no-op / default safely
when the host is `localhost` or `127.0.0.1`.
