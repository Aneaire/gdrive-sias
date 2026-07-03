# AGENTS.md

Project-wide guidance for any agent working in this repo. Read this before starting work.

## Platforms in this repo

This is a multi-platform SaaS (`apps/`):

- `apps/web/`     — TanStack Start + Vite + React 19 web app (Vercel deploy target; shared by all subdomains)
- `apps/admin/`   — admin surface (superadmin / tenant admin tooling)
- `apps/desktop/` — Electron shell bundling the offline renderer
- `apps/mobile/`  — Expo + React Native (Phase F; not active yet)

See `README.md` and `SaaS/README.md` for the full architecture and phase plan.

## New feature workflow — platform scope

When a user asks for a **new feature** and does **not** explicitly name a target platform (e.g. they don't say "in Electron", "in the desktop app", "in the mobile app", "in admin"), default to this workflow:

1. **Build the feature in `web` and/or `admin` only** — whichever is the natural home for the feature. Do not preemptively touch `desktop` or `mobile`.
   - If the feature is end-user facing → start in `apps/web/`.
   - If the feature is tenant/superadmin tooling → start in `apps/admin/`.
   - If it spans both, do `web` first, then `admin`.
2. **Finish the feature** in that platform — implement, typecheck, lint, and verify it works end to end. Do not leave it half-done.
3. **Stop and ask the user** before porting anywhere else. After the web/admin implementation is complete, tell the user it's done and ask whether they want the feature added to the other platforms where it's applicable (desktop app and/or mobile). Wait for their answer.
4. Only after the user confirms, port to `desktop` and/or `mobile` as requested. Treat each port as its own focused step.

### Why

`desktop` (Electron) wraps the web renderer but has license-key first-run + offline SQLite sync that need their own wiring. `mobile` (Phase F) is scaffolded but not in active workspaces. Porting eagerly produces broken, partial work across three surfaces that the user then has to untangle. Building once in web/admin, verifying, and then asking keeps each surface actually working.

### Exceptions — when to go cross-platform immediately

The user explicitly asked for the feature in a specific platform → do only that platform.
The user explicitly asked for "all platforms" / "everywhere" → implement in each, but still land web/admin first and verify before touching desktop/mobile.
The change is in shared, non-platform code (`convex/`, `SaaS/`, `scripts/`, root configs) → make it there; it applies everywhere automatically.
The change is a bugfix in existing desktop/mobile code → fix it in place, don't redirect to web.

## Conventions

- Package manager is `bun` (see `bun.lock`). Use `bun` / `bunx`, not `npm`/`yarn`.
- Workspaces root is `package.json`; active dev scripts: `bun dev` (Convex + web), `bun run dev:web`, `bun run dev:desktop`, `bun run dev:convex`.
- Backend lives in `convex/`; everything there is tenant-scoped via `tenantId` — never write a query/mutation that ignores tenant isolation. Use the helpers in `convex/tenantHelpers.ts` (`requireTenantMember`, `requireTenantAdmin`, `requireLicenseActive`).
- Typecheck and lint before considering a task done — run the project's `tsc`/lint commands and fix what your change broke. Don't leave red typecheck/lint behind.
- Don't commit unless the user explicitly asks. Stage only intended files; never commit secrets (`.env.local`, Convex deploy keys, license/encryption keys).