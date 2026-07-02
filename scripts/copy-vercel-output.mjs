/* eslint-disable */
/**
 * Copies the TanStack Start Vercel build output from apps/web/.vercel/output
 * to the repo-root .vercel/output, exactly mirroring the legacy monorepo so
 * Vercel can deploy the whole repo against one web workspace.
 */
import { mkdir, rm, cp } from 'node:fs/promises'
import { resolve } from 'node:path'

const webOutputDir = resolve(process.cwd(), 'apps/web/.vercel/output')
const rootOutputDir = resolve(process.cwd(), '.vercel/output')

await rm(rootOutputDir, { recursive: true, force: true })
await mkdir(resolve(rootOutputDir, '..'), { recursive: true })
await cp(webOutputDir, rootOutputDir, { recursive: true })

console.log('Copied Vercel output to', rootOutputDir)