# AGENTS.md

Minimal always-true rules for any agent in this repo. Read this first, every session.

## Where to look

| You need | Go here |
|---|---|
| How the running system **actually works today** (tenant resolution, auth, what's wired vs stubbed) | [`docs/architecture.md`](./docs/architecture.md) |
| Runtime **gotchas** before writing Convex query filters | [`docs/gotchas.md`](./docs/gotchas.md) |
| **Planned work** items (with current-state context) | [`docs/plan/`](./docs/plan/) |
| Design **intent** / full architecture / phases / decisions | [`SaaS/`](./SaaS/) (start at [`SaaS/README.md`](./SaaS/README.md)) |
| How to **run** the project + phase status | [`README.md`](./README.md) |

If `docs/` and `SaaS/` conflict: `docs/` is truth for **current behavior**; `SaaS/` is
truth for **intended design**.

## Platforms (`apps/`)

- `web/` — TanStack Start + Vite + React 19 (Vercel deploy target; shared by all subdomains)
- `admin/` — superadmin / platform-operator console
- `desktop/` — Electron shell with offline renderer + license-key first run
- `mobile/` — Expo + React Native (Phase F; not active yet)

## New feature workflow — platform scope

When a user asks for a **new feature** without naming a target platform, default to:

1. **Build in `web` and/or `admin` only** (`web` for end-user-facing, `admin` for
   platform tooling; if it spans both, `web` first then `admin`). Don't preemptively
   touch `desktop`/`mobile`.
2. **Finish** — implement, typecheck, lint, verify end to end. Don't leave it half-done.
3. **Stop and ask** before porting anywhere else.
4. Only after the user confirms, port to `desktop`/`mobile` as requested.

**Exceptions** (go cross-platform immediately): the user named a specific platform →
do only that; "all platforms" → land web/admin first and verify, then port; shared
non-platform code (`convex/`, `SaaS/`, `scripts/`, root configs) → change it there
(applies everywhere); bugfix in existing desktop/mobile code → fix in place.

Rationale: `desktop` wraps the web renderer but has its own license-first-run + SQLite
sync wiring; `mobile` is scaffolded but inactive. Eager porting produces broken
partial work across three surfaces.

## Conventions

- Package manager is `bun` (see `bun.lock`). Use `bun`/`bunx`, not `npm`/`yarn`.
- Dev: `bun dev` (Convex + web + admin), `bun run dev:web`, `bun run dev:admin`,
  `bun run dev:desktop`, `bun run dev:convex`.
- Backend is `convex/` — **everything is tenant-scoped via `tenantId`**. Never write a
  query/mutation that ignores isolation; use `requireTenantMember` /
  `requireTenantAdmin` / `requireLicenseActive` from `convex/tenantHelpers.ts`.
  Superadmin-only code uses `requireSuperAdmin`.
- Typecheck and lint before a task is done — run the project's `tsc`/lint and fix what
  your change broke. Don't leave red behind.
- Don't commit unless the user explicitly asks. Stage only intended files; never commit
  secrets (`.env.local`, Convex deploy keys, license/encryption keys).
