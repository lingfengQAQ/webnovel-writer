/**
 * 世界书条目的只读历史(格式规格 §3.4):文件头与新建首段,以及沉淀逐章追加的
 * `### 事实@第NNNN章` 段。只认事实标题;围栏中的同形行属于正文。不改写原文。
 */

import { parseDocument, type ReadResult } from '../repo/frontmatter'

export interface WorldbookFactAppend {
  /** 追加时记录的章号,不等于关系或状态的生效章。 */
  readonly 章: number
  /** 标题下一行的来源;原文没写则缺省。 */
  readonly 来源?: string
  /** 不含标题与来源行。 */
  readonly 正文: string
  /** 标题在原文件中的行号(从 1 起,含文件头)。 */
  readonly 行号: number
}

export interface WorldbookHistory {
  readonly 字段: Readonly<Record<string, unknown>>
  /** 第一个事实标题之前的正文。 */
  readonly 首段: string
  readonly 追加: readonly WorldbookFactAppend[]
  /** A later fact append would remain inside this fence; readers keep the original content. */
  readonly 未闭合围栏?: true
}

const FACT_HEADING = /^###\s+事实@第\s*(\d{1,4})\s*章\s*$/
const SOURCE_LINE = /^来源[：:]\s*(.*?)\s*$/

export function parseWorldbookHistory(text: string): ReadResult<WorldbookHistory> {
  const doc = parseDocument(text)
  if (!doc.ok) return doc
  const normalized = text.replace(/\r\n/g, '\n')
  // 正文是换行归一后全文的后缀,文件头占的行数就是行号偏移。
  const offset = normalized.slice(0, normalized.length - doc.data.body.length).split('\n').length - 1
  const head: string[] = []
  const appends: { 章: number; 行号: number; lines: string[] }[] = []
  let fence: { char: string; length: number } | undefined
  for (const [index, line] of doc.data.body.split('\n').entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence) {
      if (marker && marker[1]![0] === fence.char && marker[1]!.length >= fence.length && marker[2]!.trim() === '') fence = undefined
    } else if (marker) {
      fence = { char: marker[1]![0]!, length: marker[1]!.length }
    } else {
      const heading = FACT_HEADING.exec(line.trim())
      if (heading) {
        appends.push({ 章: Number(heading[1]), 行号: offset + index + 1, lines: [] })
        continue
      }
    }
    const target = appends.at(-1)?.lines ?? head
    target.push(line)
  }
  return {
    ok: true,
    data: {
      字段: doc.data.fields,
      首段: head.join('\n').trim(),
      追加: appends.map(({ 章, 行号, lines }) => {
        const source = SOURCE_LINE.exec(lines[0]?.trim() ?? '')
        return { 章, ...(source ? { 来源: source[1]! } : {}), 正文: (source ? lines.slice(1) : lines).join('\n').trim(), 行号 }
      }),
      ...(fence ? { 未闭合围栏: true as const } : {}),
    },
  }
}
