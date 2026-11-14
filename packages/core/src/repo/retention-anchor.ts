import { parseDocument } from './frontmatter'

/** Add one system field without reserializing any of the author's existing bytes. */
export function addDraftRetentionAnchor(before: string, digest: string): string {
  const parsed = parseDocument(before)
  const header = /^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---\r?\n)/.exec(before)
  if (!/^[a-f0-9]{64}$/.test(digest) || !parsed.ok || !header || Object.hasOwn(parsed.data.fields, '草稿留档摘要')) {
    throw new Error('旧章留档确认需要可读取且尚无留档摘要的定稿元数据')
  }
  const position = header[1]!.length + header[2]!.length
  const eol = header[1]!.endsWith('\r\n') ? '\r\n' : '\n'
  const after = `${before.slice(0, position)}${eol}草稿留档摘要: "${digest}"${before.slice(position)}`
  const next = parseDocument(after)
  if (!next.ok || next.data.fields['草稿留档摘要'] !== digest || next.data.body !== parsed.data.body
    || JSON.stringify(Object.fromEntries(Object.entries(next.data.fields).filter(([key]) => key !== '草稿留档摘要'))) !== JSON.stringify(parsed.data.fields)) {
    throw new Error('新增留档摘要会改变已有元数据的解释，已保留原文，请先核对')
  }
  return after
}
