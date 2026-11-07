import { MEMORY_KINDS, type MemoryKind } from './paths'

export type BookMemoryDocumentShape =
  | { readonly ok: true; readonly format: 'current' | 'legacy'; readonly memoryKind: MemoryKind }
  | { readonly ok: false; readonly kind: 'invalid-class' | 'missing-class'; readonly reason: string }

export function isMemoryKind(value: unknown): value is MemoryKind {
  return typeof value === 'string' && (MEMORY_KINDS as readonly string[]).includes(value)
}

/** Shape only: legacy section contents still need their domain parser. */
export function classifyBookMemoryDocument(fields: Readonly<Record<string, unknown>>, basename: string): BookMemoryDocumentShape {
  if (Object.hasOwn(fields, '类')) {
    if (isMemoryKind(fields['类'])) return { ok: true, format: 'current', memoryKind: fields['类'] }
    return { ok: false, kind: 'invalid-class', reason: `本书记忆类无效；合法值：${MEMORY_KINDS.join('、')}` }
  }
  if (isMemoryKind(basename)) return { ok: true, format: 'legacy', memoryKind: basename }
  return { ok: false, kind: 'missing-class', reason: `本书记忆缺少类字段，非旧格式分类文件；合法值：${MEMORY_KINDS.join('、')}` }
}

/** Normal consumers never interpret populated legacy category files. */
export function currentBookMemoryDocument(fields: Readonly<Record<string, unknown>>, basename: string, body: string) {
  const shape = classifyBookMemoryDocument(fields, basename)
  if (!shape.ok || shape.format === 'current') return shape
  if (!body.trim() || body.trim() === `# ${shape.memoryKind}`) return { ...shape, format: 'empty' as const }
  return { ok: false as const, kind: 'legacy-format' as const, reason: '旧格式分类文件仍含记忆内容；请先检查书仓并预览升级，正常读取不再转换旧条目' }
}
