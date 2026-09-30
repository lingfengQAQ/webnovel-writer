import type { FileRef } from './types'

export interface StudyLink { readonly sessionId: string; readonly ref: FileRef }

/** DSH's Markdown file delegate opens the native preview on Web and Desktop. */
export function studyFileLink(absolutePath: string): string {
  return encodeURI(absolutePath.replace(/\\/g, '/')).replace(/[?#<>()[\]]/g, value => '%' + value.charCodeAt(0).toString(16).toUpperCase())
}

export function studyLink(origin: string, sessionId: string, ref: FileRef): string {
  const url = new URL('/', origin)
  if (!isStudyOrigin(url)) throw new Error('Unsupported study origin')
  url.searchParams.set('webnovel', JSON.stringify({ sessionId, ref }))
  return url.href
}

function isStudyOrigin(url: URL): boolean {
  return !url.username && !url.password && (/^https?:$/.test(url.protocol) || url.protocol === 'dsh-app:' && url.host === 'app')
}

export function parseStudyLink(href: string, origin: string): StudyLink | undefined {
  try {
    const url = new URL(href, origin)
    const base = new URL(origin)
    if (!isStudyOrigin(url) || !isStudyOrigin(base) || url.protocol !== base.protocol || url.host !== base.host || url.pathname !== '/') return
    const raw: unknown = JSON.parse(url.searchParams.get('webnovel') ?? 'null')
    if (!raw || typeof raw !== 'object') return
    const input = raw as Record<string, unknown>
    if (typeof input['sessionId'] !== 'string' || !input['sessionId'] || !input['ref'] || typeof input['ref'] !== 'object') return
    const ref = input['ref'] as Record<string, unknown>
    if (typeof ref['space'] !== 'string' || typeof ref['path'] !== 'string' || !(ref['space'] === 'shared' || ref['space'].startsWith('book:'))) return
    return { sessionId: input['sessionId'], ref: { space: ref['space'], path: ref['path'] } }
  } catch { return }
}
