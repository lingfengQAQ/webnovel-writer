import type { ToolCallPhaseProps } from '@deepseek-ai/dsh-client-ui-tool/client'

export interface ResultFile { path: string; label: string; bookId?: string; shared?: boolean }
const fields = new Set(['path', 'relPath', 'file', 'absolutePath', 'reportPath', '路径', '来源文件', '草稿路径', '文件路径', '目标文件'])
const groups = new Set(['files', 'hits', 'entries', 'results', '文件', '候选文件', '问题', '内容问题', 'issues', '书仓检查', '未检范围', '契约', '骨架', 'design', 'chapters'])
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function parse(raw: string): Record<string, unknown> | undefined {
  try { const value: unknown = JSON.parse(raw); return record(value) ? value : undefined } catch { return undefined }
}

/** Only explicit frozen file fields are actionable; prose and raw arguments are never scanned for paths. */
export function resultFiles(props: ToolCallPhaseProps): ResultFile[] {
  if (props.phase !== 'result' || props.block.content.length !== 1 || props.block.content[0]?.type !== 'text') return []
  const value = parse(props.block.content[0].text)
  if (!value || typeof value.ok !== 'boolean') return []
  const args = parse(props.block.call?.argsRaw ?? '')
  const bookId = typeof value.bookId === 'string' ? value.bookId : typeof args?.bookId === 'string' ? args.bookId : undefined
  const shared = value.scope === 'author' || args?.scope === 'author'
  const found = new Map<string, ResultFile>()
  const add = (raw: unknown) => {
    if (typeof raw !== 'string' || !raw || /[\r\n\0]/.test(raw)) return
    const path = raw.replace(/\\/g, '/')
    const absolute = path.startsWith('/') || /^[A-Za-z]:\//.test(path)
    if (/^[A-Za-z][\w+.-]*:/.test(path) && !/^[A-Za-z]:\//.test(path)) return
    if (path.split('/').some(part => part === '..' || part.startsWith('.'))) return
    if (!absolute && !bookId && !shared) return
    if (!/\.(?:md|txt|json|ya?ml|csv)$/i.test(path)) return
    found.set(path, { path, label: path.split('/').pop()!, ...(!absolute && bookId && !shared ? { bookId } : {}), ...(!absolute && shared ? { shared: true } : {}) })
  }
  const walk = (item: unknown, depth: number, fileList = false, pathMap = false) => {
    if (depth > 6) return
    if (Array.isArray(item)) { for (const entry of item) walk(entry, depth + 1, fileList); return }
    if (typeof item === 'string') { if (fileList) add(item); return }
    if (!record(item)) return
    for (const [key, child] of Object.entries(item)) {
      if (fields.has(key) || pathMap && typeof child === 'string') add(child)
      if (groups.has(key)) walk(child, depth + 1, ['files', '文件', '候选文件'].includes(key), key === '候选文件')
    }
  }
  walk(value, 0)
  return [...found.values()]
}
