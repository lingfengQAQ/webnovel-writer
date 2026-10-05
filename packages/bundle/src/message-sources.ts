import type { ContextFormed, MessageSource } from '@deepseek-ai/dsh-llm'

// Match the producer names emitted by DSH's native V3-to-V4 reader.
export const MEMORY_CATALOG_SOURCE = 'plugin:webnovel-memory-catalog'
export const AUTHOR_SAVE_SOURCE = 'plugin:webnovel'
export const EDITOR_REQUEST_SOURCE = 'plugin:webnovel-editor'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'plugin:webnovel-memory-catalog': { kind: typeof MEMORY_CATALOG_SOURCE } & ContextFormed
    'plugin:webnovel': { kind: typeof AUTHOR_SAVE_SOURCE }
    'plugin:webnovel-editor': { kind: typeof EDITOR_REQUEST_SOURCE; requestId: string }
  }
}

export function isMemoryCatalogSource(source: MessageSource): boolean {
  if (source.kind === MEMORY_CATALOG_SOURCE) return true
  // Older sessions can contain the catalog in the combined runtime snapshot.
  return String(source.kind) === 'runtime-context' && 'form' in source && source.form === 'snapshot'
    && 'sections' in source && Array.isArray(source.sections)
    && source.sections.some(section => section?.name === 'webnovel.memory')
}
