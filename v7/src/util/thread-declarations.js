/**
 * 章 front matter 条目变动声明解析（spec 0.9 §4.1/§5）。机检形式检查与两审 ReviewInput 共用，不双写。
 */

export const THREAD_TYPES = ['伏笔', '悬念', '感情线']

/** 开启类动词 = 新条目（条目文件由定稿创建） */
export const OPENING_VERBS = new Set(['埋下', '设下', '开启'])

/** 各类型合法生命周期动词 */
export const VERBS = {
  伏笔: ['埋下', '推进', '回收', '放弃'],
  悬念: ['设下', '推进', '揭晓', '放弃'],
  感情线: ['开启', '推进', '修成正果', '无疾而终'],
}

/**
 * 解析三数组的"动词 ID"声明行。
 * @param {object} fm 已解析的章 front matter
 * @returns {{declarations: Array<{type: string, verb: string, id: string, raw: string}>, malformed: string[]}}
 */
export function parseThreadDeclarations(fm) {
  const declarations = []
  const malformed = []
  for (const type of THREAD_TYPES) {
    const list = fm?.[type]
    if (!Array.isArray(list)) continue
    for (const raw of list) {
      if (typeof raw !== 'string') {
        malformed.push(`${type}: ${JSON.stringify(raw)}`)
        continue
      }
      const m = raw.trim().match(/^(\S+)\s+(\S+)$/)
      if (!m) {
        malformed.push(`${type}: ${raw}`)
        continue
      }
      declarations.push({ type, verb: m[1], id: m[2], raw: raw.trim() })
    }
  }
  return { declarations, malformed }
}
