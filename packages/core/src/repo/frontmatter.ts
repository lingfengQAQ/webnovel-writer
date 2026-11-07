/**
 * frontmatter 解析与序列化(格式规格 §7 通用字段;机制 B3/B4/B5/B9)。
 *
 * - B3:通用字段顺序——写入器保留稳定键序,扩展字段按码点排序
 * - B4:降级显式标记——ReadResult 区分「没有数据」与「读取失败残缺」
 * - B5:防呆解析——解析失败带明细抛出,不静默吞掉;标题/内容保留原文
 * - B9:防呆方言——序列化用稳定键序与统一全角标点风格
 */

import { parse as yamlParse, stringify as yamlStringify } from 'yaml'

export type ReadResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly reason: 'missing' | 'parse-error'; readonly detail: string }

export interface Frontmatter {
  readonly fields: Readonly<Record<string, unknown>>
  readonly body: string
}

const FM_OPEN = '---'
const FM_CLOSE = '---'

/** 解析「---\n…\n---\n正文」结构;无 frontmatter 时返回空字段集(合法)。 */
export function parseDocument(text: string): ReadResult<Frontmatter> {
  const lineNormalized = text.replace(/\r\n/g, '\n')
  const normalized = lineNormalized.startsWith(`\uFEFF${FM_OPEN}\n`) ? lineNormalized.slice(1) : lineNormalized
  if (!normalized.startsWith(FM_OPEN + '\n')) {
    return { ok: true, data: { fields: {}, body: normalized } }
  }
  const closeIdx = normalized.indexOf(`\n${FM_CLOSE}\n`, FM_OPEN.length)
  if (closeIdx < 0) {
    return { ok: false, reason: 'parse-error', detail: 'frontmatter 未闭合(缺结束 ---)' }
  }
  const fmText = normalized.slice(FM_OPEN.length + 1, closeIdx)
  const body = normalized.slice(closeIdx + FM_CLOSE.length + 2)
  let fields: Record<string, unknown>
  try {
    // 核心唯一运行时依赖:frontmatter 即 YAML(格式规格 §7)
    const parsed = yamlParse(fmText) as unknown
    if (parsed === null || parsed === undefined) fields = {}
    else if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      fields = parsed as Record<string, unknown>
    } else {
      return { ok: false, reason: 'parse-error', detail: 'frontmatter 顶层必须是键值映射' }
    }
  } catch (err) {
    return { ok: false, reason: 'parse-error', detail: `YAML 解析失败：${err instanceof Error ? err.message : String(err)}` }
  }
  return { ok: true, data: { fields, body } }
}

/** 序列化:稳定键序(定义序优先)+空 frontmatter 省略(B9 稳定输出)。 */
export function serializeDocument(fields: Readonly<Record<string, unknown>>, body: string, keyOrder?: readonly string[]): string {
  const order = keyOrder ?? COMMON_FIELD_KEYS
  const keys = [...Object.keys(fields)]
  keys.sort((a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    if (ia >= 0 && ib >= 0) return ia - ib
    if (ia >= 0) return -1
    if (ib >= 0) return 1
    return a < b ? -1 : a > b ? 1 : 0 // 码点序,确定性(B9)
  })
  const ordered: Record<string, unknown> = {}
  for (const k of keys) ordered[k] = fields[k]
  const fmText = keys.length === 0 ? '' : yamlStringify(ordered).trimEnd()
  const bodyNorm = body.replace(/\r\n/g, '\n').replace(/\n+$/, '')
  return fmText === '' ? `${bodyNorm}\n` : `${FM_OPEN}\n${fmText}\n${FM_CLOSE}\n${bodyNorm}\n`
}

/** 通用字段键(格式规格 §7.1,12 项)——稳定序底座。 */
export const COMMON_FIELD_KEYS = [
  '身份', '版本', '父版本', '生成模块', '来源快照', '作用域',
  '状态', '作者裁决', '影响范围', '写入范围', '恢复信息', '来源引用',
] as const

/** 读取结果辅助:强制区分 missing 与 parse-error(B4)。 */
export function unwrap<T>(r: ReadResult<T>, what: string): T {
  if (r.ok) return r.data
  if (r.reason === 'missing') throw new Error(`${what}:文件不存在(没有数据，非读取失败)`)
  throw new Error(`${what}：解析失败——${r.detail}。文件内容不完整，不得当作事实使用；请先修复这个文件的 frontmatter`)
}
