# docs/ — agent-operational knowledge

This folder holds **current-reality** knowledge an agent needs to work in this repo:
what's actually wired up today, runtime gotchas, and concrete planned work items.

## How it relates to the other doc layers

| Layer | What it is | When to read it |
|---|---|---|
| `AGENTS.md` (repo root) | Minimal always-true rules + pointers. | First, every session. |
| `docs/` (this folder) | Current runtime reality + gotchas + planned work. | Before touching backend/auth/tenancy/subdomain code. |
| `SaaS/` | Design intent / the plan (architecture vision, phases, data model, decisions). | When you need the *why* behind a design or the full intended end-state. |
| `README.md` (repo root) | How to run + phase status overview. | When setting up / running the project. |

`SaaS/` describes what we **intend** to build. `docs/` describes what's **true now**
and where reality diverges from the plan. If they conflict, `docs/` is the source of
truth for current behavior; `SaaS/` is the source of truth for intended design.

## Index

| File | Read it for |
|---|---|
| [`architecture.md`](./architecture.md) | How the running system actually works today: tenant resolution, auth/signup, deployment model, what's wired vs stubbed. |
| [`gotchas.md`](./gotchas.md) | Runtime pitfalls (start here before writing Convex query filters). |
| [`plan/`](./plan/) | Concrete work items / TODOs for upcoming agent work, each with current-state context. |
| [`plan/README.md`](./plan/README.md) | Index of planned work items + their status. |

## Quick orientation

- **Tenant resolution today is membership-based, not subdomain-based.** See [`architecture.md`](./architecture.md).
- **The subdomain host-based resolver is NOT wired yet** (it's a planned work item in [`plan/`](./plan/)). `tenants.getBySubdomain` exists in the backend but no frontend calls it.
- **Convex query filter `eq` is broken on `v.union(v.literal(...))` fields.** See [`gotchas.md`](./gotchas.md) before writing any `.filter(...)` on `status` / `role` / `plan` / `storageStatus`.
