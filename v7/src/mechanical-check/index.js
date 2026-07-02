import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseFrontMatter } from '../storage/parsers/front-matter.js'
import { BookConfigReader } from '../storage/adapters/BookConfigReader.js'
import { parseThreadDeclarations, VERBS, OPENING_VERBS } from '../util/thread-declarations.js'

// front matter 章档案必填字段（§4.1 机器消费部分）
const REQUIRED_FM = ['章号', '标题', '卷', '字数', '章定位', '钩子', '情绪定位']

/**
 * 机检：零 token 可计数项（D2 七项 + 条目变动形式检查，spec 0.9 §8 第 5 步）。
 * 不过关（pass=false）= 存在阻断 issue。新专名/信息差关键词只出候选（candidates），不拦截。
 * @param {{repoPath: string, cache: object}} ctx
 * @param {{chapterNum: number, draftPath: string}} args
 * @returns {Promise<{ok: boolean, pass: boolean, issues: object[], candidates: object[], error: string}>}
 */
export async function mechanicalCheck(ctx, { chapterNum, draftPath }) {
  try {
    const { repoPath, cache } = ctx
    const raw = await fs.readFile(draftPath, 'utf8')
    const parsed = parseFrontMatter(raw)
    const body = parsed.ok ? parsed.body : raw
    const fm = parsed.ok ? parsed.data : {}

    const config = await new BookConfigReader(repoPath).read()
    const bookConfig = config.ok ? config.data : {}
    const style = await readStyleRules(repoPath)

    const issues = []
    const candidates = []

    checkWordCount(body, bookConfig, issues) // 1
    checkBannedWords(body, style.禁词, issues) // 2
    checkBannedPatterns(body, style.禁句式, issues) // 3
    checkRepetition(body, issues) // 4
    await checkNewProperNouns(body, cache, candidates) // 5（候选）
    checkFrontMatter(parsed, fm, issues) // 6
    await checkSecretKeywords(body, cache, candidates) // 7（候选）
    await checkThreadDeclarations(fm, cache, issues) // 8（条目变动，只查形式）

    return { ok: true, pass: issues.length === 0, issues, candidates, error: '' }
  } catch (err) {
    return { ok: false, pass: false, issues: [], candidates: [], error: `机检失败：${err.message}` }
  }
}

async function readStyleRules(repoPath) {
  try {
    const content = await fs.readFile(path.join(repoPath, '文风', '文风铁律.md'), 'utf8')
    const parsed = parseFrontMatter(content)
    if (parsed.ok) {
      return { 禁词: parsed.data.禁词 || [], 禁句式: parsed.data.禁句式 || [] }
    }
  } catch {
    // 无文风铁律
  }
  return { 禁词: [], 禁句式: [] }
}

function checkWordCount(body, config, issues) {
  const target = config.每章目标字数 || 3000
  const tol = 0.3
  const count = [...body.replace(/\s+/g, '')].length
  if (count < target * (1 - tol)) {
    issues.push({ check: '字数', severity: 'medium', blocking: true, description: `字数 ${count} 低于目标 ${target} 下限` })
  } else if (count > target * (1 + tol)) {
    issues.push({ check: '字数', severity: 'medium', blocking: true, description: `字数 ${count} 高于目标 ${target} 上限` })
  }
}

function checkBannedWords(body, banned, issues) {
  for (const w of banned) {
    if (w && body.includes(w)) {
      issues.push({ check: '禁词', severity: 'high', blocking: true, description: `命中禁词「${w}」` })
    }
  }
}

function checkBannedPatterns(body, patterns, issues) {
  for (const p of patterns) {
    if (!p) continue
    try {
      if (new RegExp(p).test(body)) {
        issues.push({ check: '禁句式', severity: 'high', blocking: true, description: `命中禁句式 /${p}/` })
      }
    } catch {
      // 非法正则跳过（文风铁律里写错不该崩机检）
    }
  }
}

function checkRepetition(body, issues) {
  const text = body.replace(/\s+/g, '')
  const L = 6
  const threshold = 3
  if (text.length < L) return
  const counts = new Map()
  for (let i = 0; i + L <= text.length; i++) {
    const g = text.slice(i, i + L)
    counts.set(g, (counts.get(g) || 0) + 1)
  }
  for (const [g, c] of counts) {
    if (c >= threshold) {
      issues.push({ check: '复读', severity: 'medium', blocking: true, description: `短语「${g}」重复 ${c} 次` })
      break
    }
  }
}

// 保守启发式：对话提示词（道/说/问…）前的 2-3 字 Han 视作疑似人名，比对名册（非阻断候选）
async function checkNewProperNouns(body, cache, candidates) {
  const known = new Set()
  try {
    for (const e of await cache.query('SELECT id FROM entities')) known.add(e.id)
    for (const a of await cache.query('SELECT alias FROM entity_aliases')) known.add(a.alias)
  } catch {
    // 无缓存，跳过
  }
  const seen = new Set()
  const re = /([一-龥]{2,3})(冷笑道|笑道|喝道|说道|问道|答道|道|说|喊|问)/g
  let m
  while ((m = re.exec(body))) {
    const name = m[1]
    if (!known.has(name) && !seen.has(name)) {
      seen.add(name)
      candidates.push({
        type: '新专名',
        value: name,
        description: `正文出现疑似新专名「${name}」，名册未登记，请确认（新实体 or 笔误）`,
      })
    }
  }
}

async function checkSecretKeywords(body, cache, candidates) {
  let secrets = []
  try {
    secrets = await cache.query('SELECT id, keywords FROM secrets WHERE reader_knows = 0')
  } catch {
    return
  }
  for (const s of secrets) {
    let kws = []
    try {
      kws = JSON.parse(s.keywords || '[]')
    } catch {
      kws = []
    }
    for (const kw of kws) {
      if (kw && body.includes(kw)) {
        candidates.push({
          type: '信息差候选',
          value: s.id,
          description: `正文出现信息差「${s.id}」关键词「${kw}」，疑似泄密候选（不拦截，请人工确认）`,
        })
        break
      }
    }
  }
}

function checkFrontMatter(parsed, fm, issues) {
  if (!parsed.ok) {
    issues.push({ check: 'front matter', severity: 'high', blocking: true, description: `front matter 解析失败：${parsed.error}` })
    return
  }
  const missing = REQUIRED_FM.filter(
    (k) => !(k in fm) || fm[k] === '' || fm[k] === null || fm[k] === undefined
  )
  if (missing.length) {
    issues.push({ check: 'front matter', severity: 'high', blocking: true, description: `front matter 缺字段：${missing.join('、')}` })
  }
}

// 条目变动形式检查（spec 0.9 §8 第 5 步；查 threads 表，零语义）：
// ①类型一致 ②开启类动词不得撞已有编号 ③非开启动词要求条目存在且状态=进行
async function checkThreadDeclarations(fm, cache, issues) {
  const { declarations, malformed } = parseThreadDeclarations(fm)
  for (const bad of malformed) {
    issues.push({ check: '条目变动', severity: 'high', blocking: true, description: `条目声明格式应为「动词 编号」：${bad}` })
  }
  if (!declarations.length) return

  const known = new Map()
  try {
    for (const t of await cache.query('SELECT id, status FROM threads')) known.set(t.id, t.status)
  } catch {
    return // 无缓存，跳过（形式检查依赖条目表）
  }

  for (const d of declarations) {
    if (!d.id.startsWith(`${d.type}-`)) {
      issues.push({ check: '条目变动', severity: 'high', blocking: true, description: `「${d.type}」清单里出现异类编号「${d.id}」` })
      continue
    }
    if (!VERBS[d.type].includes(d.verb)) {
      issues.push({ check: '条目变动', severity: 'high', blocking: true, description: `「${d.type}」没有动词「${d.verb}」（${d.raw}），合法动词：${VERBS[d.type].join('/')}` })
      continue
    }
    const status = known.get(d.id)
    if (OPENING_VERBS.has(d.verb)) {
      if (status !== undefined) {
        issues.push({ check: '条目变动', severity: 'high', blocking: true, description: `「${d.raw}」：${d.id} 已存在（状态：${status}），开新条目须用新编号` })
      }
    } else if (status === undefined) {
      issues.push({ check: '条目变动', severity: 'high', blocking: true, description: `「${d.raw}」：${d.id} 不存在，疑似编号笔误` })
    } else if (status !== '进行') {
      issues.push({ check: '条目变动', severity: 'high', blocking: true, description: `「${d.raw}」：${d.id} 状态是「${status}」，不能再「${d.verb}」` })
    }
  }
}
