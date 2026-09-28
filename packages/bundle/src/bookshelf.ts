/** Shared book discovery and identity resolution; always read from the filesystem. */
export { scanWorkspaceBooks as scanBooks, hasBooks, uniqueBookRoot } from '@webnovel/core'
export type { WorkspaceBook as BookOverview } from '@webnovel/core'
