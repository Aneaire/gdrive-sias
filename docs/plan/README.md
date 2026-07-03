# plan/ — upcoming work items

Concrete, agent-ready work items. Each file describes a piece of work that isn't done
yet, with the **current-state context** an agent needs to start, plus pointers to the
`SaaS/` design docs for the full intended behavior.

Status legend: **not started** · **in progress** · **done**

## Items

| File | Work item | Status |
|---|---|---|
| [`subdomain-resolver.md`](./subdomain-resolver.md) | Wire host-based tenant resolution + branding into `apps/web` (Phase C). | not started |
| [`folders.md`](./folders.md) | Google-Drive-style folder experience: nested folders, breadcrumbs, full CRUD + move, shadcn/ui. `convex/` + `apps/web` only. | not started |

## Relationship to `SaaS/PHASES.md`

`SaaS/PHASES.md` is the full phased plan (A → G). This folder picks out the phases
that are still pending and gives them current-state context that `SaaS/` (being a
design doc written up-front) doesn't carry. When you pick up an item, read both the
file here and the linked `SaaS/` doc.

## Adding a new work item

Copy the shape of an existing file: **Goal · Current state · Scope · Notes · Pointers**.
Keep it short — this is a launchpad, not a spec. The spec lives in `SaaS/`.
