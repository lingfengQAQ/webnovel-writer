import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseDocument } from '../repo/frontmatter'
import { paths } from '../repo/paths'

export interface ChapterLengthRange {
  readonly 目标汉字数: number
  readonly 下限汉字数: number
  readonly 上限汉字数: number
}

interface PolicySource { readonly 来源: string; readonly 来源哈希?: string }
export type ChapterLengthPolicy = PolicySource & (
  | { readonly 状态: '未配置' }
  | { readonly 状态: '配置错误'; readonly 原因: string }
  | { readonly 状态: '已配置' | '未确认'; readonly 范围: ChapterLengthRange }
)

export interface ChapterLengthCheck {
  readonly 约定: ChapterLengthPolicy
  readonly 实测汉字数: number
  readonly 结果: '范围内' | '偏短' | '偏长' | '未配置' | '未确认' | '配置错误'
  /** Distance to the nearest violated boundary; zero inside the inclusive range. */
  readonly 差额?: number
}

const SOURCE = '作品契约/契约.md · 阅读体验与情绪承诺 / 章节篇幅'
const KEYS = ['目标汉字数', '下限汉字数', '上限汉字数'] as const

/** Ignore comments and fenced examples when locating real Markdown headings. */
function visibleLines(body: string): string[] {
  let fence: { mark: string; length: number } | undefined
  return body.replace(/<!--[\s\S]*?(?:-->|$)/g, text => text.replace(/[^\n]/g, '')).split('\n').map(line => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (marker && marker[1]![0] === fence.mark && marker[1]!.length >= fence.length) fence = undefined
      return ''
    }
    if (marker) { fence = { mark: marker[1]![0]!, length: marker[1]!.length }; return '' }
    return line
  })
}

/** Parse the one visible subsection; no implicit defaults or natural-language guessing. */
export function parseChapterLength(text: string | null): ChapterLengthPolicy {
  if (text === null) return { 来源: SOURCE, 状态: '未配置' }
  const source = { 来源: SOURCE, 来源哈希: createHash('sha256').update(text).digest('hex') }
  const invalid = (原因: string): ChapterLengthPolicy => ({ ...source, 状态: '配置错误', 原因 })
  const doc = parseDocument(text)
  if (!doc.ok) return invalid(`契约解析失败：${doc.detail}`)
  const lines = visibleLines(doc.data.body.replace(/\r\n/g, '\n'))
  const headings = lines.flatMap((line, index) => {
    const h = /^\s*(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (!h) return []
    const labeled = /^(.+?)\s*[〔(]([^〕)]+)[〕)]\s*$/.exec(h[2]!)
    return [{ index, level: h[1]!.length, title: (labeled?.[1] ?? h[2]!).trim(), state: labeled?.[2]?.trim() }]
  })
  const sections = headings.filter(h => h.title === '章节篇幅')
  if (sections.length === 0) return { 来源: SOURCE, 状态: '未配置' }
  if (sections.length !== 1) return invalid('章节篇幅子节重复')
  const section = sections[0]!
  const parent = headings.filter(h => h.index < section.index && h.level <= 2).at(-1)
  if (section.level !== 3 || parent?.level !== 2 || parent.title !== '阅读体验与情绪承诺') return invalid('章节篇幅须位于阅读体验与情绪承诺的三级子节')
  if (headings.filter(h => h.level === 2 && h.title === parent.title).length !== 1) return invalid('阅读体验与情绪承诺分部重复')
  const end = headings.find(h => h.index > section.index && h.level <= 3)?.index ?? lines.length
  const values: Partial<Record<(typeof KEYS)[number], number>> = {}
  for (const line of lines.slice(section.index + 1, end)) {
    if (!line.trim()) continue
    const field = /^\s*[-*+]\s+(目标汉字数|下限汉字数|上限汉字数)\s*[:：]\s*([0-9]+)\s*$/.exec(line)
    if (!field) return invalid('章节篇幅只接受目标汉字数、下限汉字数、上限汉字数三项正整数列表')
    const key = field[1] as (typeof KEYS)[number]
    const value = Number(field[2])
    if (values[key] !== undefined) return invalid(`章节篇幅字段重复：${key}`)
    if (!Number.isSafeInteger(value) || value <= 0) return invalid(`章节篇幅${key}须为安全正整数`)
    values[key] = value
  }
  if (KEYS.some(key => values[key] === undefined)) return invalid('章节篇幅须同时填写目标汉字数、下限汉字数、上限汉字数')
  const 范围: ChapterLengthRange = { 目标汉字数: values.目标汉字数!, 下限汉字数: values.下限汉字数!, 上限汉字数: values.上限汉字数! }
  if (范围.下限汉字数 > 范围.目标汉字数 || 范围.目标汉字数 > 范围.上限汉字数) return invalid('章节篇幅须满足下限 ≤ 目标 ≤ 上限')
  return { ...source, 状态: parent.state === '已确认' ? '已配置' : '未确认', 范围 }
}

export function readChapterLength(root: string): ChapterLengthPolicy {
  try { return parseChapterLength(fs.readFileSync(path.join(root, paths.契约()), 'utf8')) }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return parseChapterLength(null)
    return { 来源: SOURCE, 状态: '配置错误', 原因: `契约读取失败：${(err as NodeJS.ErrnoException).code ?? '未知错误'}` }
  }
}

/** Old books without the subsection keep their existing review fingerprint. */
export function chapterLengthIdentity(policy: ChapterLengthPolicy): string | undefined {
  return policy.状态 === '未配置' ? undefined : JSON.stringify(policy)
}

export function checkChapterLength(约定: ChapterLengthPolicy, 实测汉字数: number): ChapterLengthCheck {
  if (约定.状态 !== '已配置') return { 约定, 实测汉字数, 结果: 约定.状态 }
  const { 下限汉字数, 上限汉字数 } = 约定.范围
  if (实测汉字数 < 下限汉字数) return { 约定, 实测汉字数, 结果: '偏短', 差额: 下限汉字数 - 实测汉字数 }
  if (实测汉字数 > 上限汉字数) return { 约定, 实测汉字数, 结果: '偏长', 差额: 实测汉字数 - 上限汉字数 }
  return { 约定, 实测汉字数, 结果: '范围内', 差额: 0 }
}

export function renderChapterLength(policy: ChapterLengthPolicy): string {
  const lines = ['### 契约·章节篇幅', `- 来源：${policy.来源}`, `- 状态：${policy.状态}`]
  if ('范围' in policy) lines.push(`- 目标汉字数：${policy.范围.目标汉字数}`, `- 下限汉字数：${policy.范围.下限汉字数}`, `- 上限汉字数：${policy.范围.上限汉字数}`)
  if (policy.来源哈希) lines.push(`- 来源哈希：${policy.来源哈希}`)
  if (policy.状态 === '配置错误') lines.push(`- 原因：${policy.原因}`)
  lines.push('- 计数：正文汉字，含章标题，不含 frontmatter 和草稿候选事实。未配置或未确认不作为已确认篇幅要求。')
  return lines.join('\n')
}
