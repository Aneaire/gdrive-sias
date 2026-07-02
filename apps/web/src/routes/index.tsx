import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: HomeStub,
})

/**
 * Phase A scaffold root. Phase C replaces this with the real subdomain
 * resolver: apex → marketing pages, subdomain → branded file command center.
 */
function HomeStub() {
  return (
    <main>
      <h1>G-customize — packaged product (Phase A)</h1>
      <p>
        Repo scaffolded. Run <code>npx convex dev</code> to create + link a
        fresh Convex deployment, then verify tenant scoping using the seed
        script.
      </p>
    </main>
  )
}