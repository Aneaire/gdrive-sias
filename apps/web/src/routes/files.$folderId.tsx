import { createFileRoute } from '@tanstack/react-router'
import type { Id } from '@convex/_generated/dataModel'

import { FolderView } from './files.index'

export const Route = createFileRoute('/files/$folderId')({ component: FolderRoute })

function FolderRoute() {
  const params = Route.useParams() as { folderId: string }
  return <FolderView folderId={params.folderId as Id<'folders'>} />
}
