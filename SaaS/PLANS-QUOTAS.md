# Plan tiers, capability flags, quotas

There is no billing inside the app. Plans are tier flags you set on the `licenses`/`tenants` row when you provision a sale. You hardcode plan rules; upgrading is a one-row patch from your side.

## Tiers

| Plan | Desktop | Web | Mobile | Seats | Audit log | BYO Google OAuth client | Storage cap |
|---|---|---|---|---|---|---|---|
| `standard` | yes | yes | no | 5 | no | no | 50 GB cumulative Drive usage |
| `office` | yes | yes | yes | 15 | yes | no | unlimited (Drive's own quota) |
| `pro` | yes | yes | yes | unlimited | yes | yes | unlimited |

Mobile gate is per-tenant, not per-device: a `standard` buyer's mobile app shows an "Upgrade to office" screen on launch.

## Storage cap enforcement

`requireTenantMember` (or a `requireWithinQuota(ctx)` wrapper) reads `usage.storageBytes` for the current period and rejects new uploads if the tenant exceeds `plan.storageCap`. Surfaced as a typed `PlanLimitError` → UI: "Your plan is at its storage capacity. Contact the licensor to upgrade."

`usage` is updated on every successful `markDriveUploadStored` (sum the bytes; subtract on `markDeletedInternal`). Recompute periodically via a scheduled job to catch drift from Drive-side deletion.

## Capability flag plumbing

### Server side: `api.tenants.capabilities`

A query (`tenants.ts`):
```ts
export const capabilities = query({
  args: {},
  handler: async (ctx) => {
    const membership = await requireTenantMember(ctx)
    const tenant = await ctx.db.get(membership.tenantId)
    if (!tenant) return null
    return {
      web: true,
      mobile: tenant.plan !== 'standard',
      audit: tenant.plan !== 'standard',
      byoOauth: tenant.plan === 'pro',
      storageCap: STORAGE_CAP_BY_PLAN[tenant.plan],   // bytes; null = unlimited
      seats: (await ctx.db...query license).seats,
    }
  },
})
```

### Client side: `useTenantCapabilities()` hook

`apps/web/src/lib/capabilities.ts`:
```ts
export function useTenantCapabilities() {
  return useQuery(api.tenants.capabilities)
}
```

Used by:
- `/settings/devices` (hide the audit log on `standard`).
- `/settings/integrations` (hide the "Bring your own Google Cloud OAuth client" toggle unless `byoOauth === true`).
- Mobile: gate the entire app on `mobile === true`.

### Server-side hard-enforcement

Capability flags are not just UI convenience — they are also enforced at the mutation layer:
- `clientSecret` write to `tenantIntegrations` is rejected if `tenant.plan !== 'pro'`.
- `audits` reads (`api.audits.list`) are rejected if `tenant.plan === 'standard'`.
- Mobile-issued Convex calls could be detected via the `platform` field on `licenseDevices` and rejected if `tenant.plan === 'standard'` (defense in depth). Probably not worth implementing v1 since the mobile-gate UI is enough.

## Quotas summary

| Resource | How enforced |
|---|---|
| Seats (members + devices) | On `tenantMembers.insert` / `licenseDevices.insert`; reject when `seatsUsed >= license.seats` |
| Storage bytes | On `markDriveUploadStored`; reject upload when `usage.storageBytes >= plan.storageCap` |
| (Optional) per-month upload bytes | Skip for v1 — overkill given `pro` is unlimited |
| Conversion of invitation → active user | No quota per se; just seat count |

## Upgrading

From your side:

```
# bump acme from standard to office
npm run provision --upgrade --key=XXXX --plan=office --seats=15
```

The script patches the `licenses` row + `tenants.plan`. The next app launch picks up the new capabilities. No client rebuild.

## Selling additional seats

Add seats: `npm run provision --upgrade --key=XXXX --seats=30`. The admin sees the new cap immediately in `/settings/devices` and `/settings/members`. That's an external sale you log/notate before running the script.