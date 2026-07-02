# Migration: existing RIELAN operator vs. packaged product

## Decision

The existing RIELAN office operator stays on the **current single-operator deployment**. The packaged product is a **new branch + a fresh Convex deployment**. **No migration of live data.**

## Why not migrate

- The packaged product ships three large new systems (tenancy scoping, license-server, per-tenant OAuth). Touching the live deployment to wedge these in is high-risk and serves no current customer.
- The existing operator is happy. Let them be.
- Backfill scripts are a maintenance burden that only ever runs once; not worth writing for v1.
- We can write a copy-from-old-to-new script later if RIELAN ever asks to move.

## Concrete steps

1. **Branch the monorepo** at the current revision.
   - `main` keeps pointing at the existing single-operator code path; RIELAN office continues running. Tag `last-single-operator` to be explicit.
   - New branch `packaged` (or a separate repo `rielan-packaged`) gets all the SaaS work.
2. **Spin up a fresh Convex deployment** for the packaged branch:
   ```
   npx convex dev   # in a new folder/directory inside the packaged branch
   ```
   - Empty schema. No data.
3. **Strip legacy single-operator artifacts** from the packaged branch:
   - Remove `convex/ownership.ts` and the `ownerSettings` table.
   - Remove `convex/authSignupAllowlist.ts`.
   - Remove `BOOTSTRAP_OWNER_EMAIL` constant.
   - Drop the `@gmail.com` regex from `authProfile.ts`.
   - Remove the four legacy `GOOGLE_*` Convex env vars (replaced by the four licensing/encryption keys: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `OAUTH_STATE_SECRET`, `ENCRYPTION_KEY`).
   - Remove the `scripts/google-drive-oauth.mjs` CLI (replaced by in-app Connect button).
4. The legacy branch keeps the CLI and env-var auth flow; the legacy RIELAN office never knows anything changed.
5. **Documentation note**: Both branches must reference the README at the repo root. The packaged branch's README lives at `SaaS/README.md`; build instructions reference that. The legacy branch keeps the original `README.md`.

## Cut-over of RIELAN office to packaged product (deferred)

If ever requested:
1. Stop writes on the legacy branch by taking the desktop apps offline (or simply tell users to switch).
2. Write `scripts/copy-legacy-to-packaged.mjs` that:
   - Reads every `files`, `shareRecipients`, `deviceSyncStates` row from the legacy Convex.
   - Inserts a `tenants` row for RIELAN with `subdomain='rielan'`.
   - Creates a `licenses` row active, `seats=N`, `plan='office'` for them.
   - Inserts the existing operator as `tenantMembers.role='admin'`.
   - Copies rows with their new `tenantId` set; preserves `_creationTime` semantics via `uploadedAt` etc.
3. The operator then clicks "Connect Google Drive" in the packaged UI — they re-authorize the same Google account they were using before (their files already live in their Drive under the existing root folder; just point the new `tenantIntegrations.rootFolderId` to the existing folder id, or let the in-app flow create a sibling folder and copy folders across if needed).
4. Verify and decommission the legacy branch/deployment.

There is no immediate timeline for this; the legacy deployment can run for years.