import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

import ConvexProvider from '../integrations/convex/provider'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'G-customize Admin — Platform Console' },
      {
        name: 'description',
        content: 'Platform operator console for the G-customize multi-tenant SaaS.',
      },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ConvexProvider>{children}</ConvexProvider>
        <Scripts />
      </body>
    </html>
  )
}
