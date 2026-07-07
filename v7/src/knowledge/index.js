import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseFrontMatter } from '../storage/parsers/front-matter.js'
import { extractSection } from '../util/markdown.js'

/**
 * 知识库读取（spec 0.15 §5/§6.3/§7：声明即路由，AI 只在脚本递上的菜单里点菜）。
 * 查表源 = <packageRoot>/references/（vendored 后即 .webnovel/references/）。
 * 知识库是旁路增益不是必经关卡：目录缺失、条目缺失、路由未命中一律降级返回空结果，永不报错挡流程。
 */

const REF = 'references'

/** 路由.csv → [{名称, 维度, 题材, 条目, 别名: []}]；文件缺失返回空表 */
export async function loadRoutes(packageRoot) {
  let raw
  try {
    raw = await fs.readFile(path.join(packageRoot, REF, '路由.csv'), 'utf8')
  } catch {
    return []
  }
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
  const rows = []
  for (const line of lines.slice(1)) {
    const cols = line.split(',')
    if (cols.length < 5) continue
    rows.push({
      名称: cols[0].trim(),
      维度: cols[1].trim(),
      题材: cols[2].trim(),
      条目: cols[3].trim(),
      别名: cols[4] ? cols[4].split(';').map((a) => a.trim()).filter(Boolean) : [],
    })
  }
  return rows
}

/** 名称/别名 → 路由行；未命中返回 null（调用方走对谈共创降级） */
export function resolveLabel(rows, input) {
  const label = String(input || '').trim()
  if (!label) return null
  for (const row of rows) {
    if (row.名称 === label || row.别名.includes(label)) return row
  }
  return null
}

/**
 * 建书归一：{类型, 流派:[]} → {题材命中, 流派命中: [], 未命中: []}。
 * 命中项含条目全文（条目文件缺失时 content 为空串，归一结果仍有效——路由归一与内容注入分层降级）。
 */
export async function resolveBookTags(packageRoot, { 类型, 流派 = [] }) {
  const rows = await loadRoutes(packageRoot)
  const 未命中 = []

  const genreRow = resolveLabel(rows, 类型)
  const 题材命中 = genreRow && genreRow.维度 === '题材' ? await withContent(packageRoot, genreRow) : null
  if (!题材命中 && String(类型 || '').trim()) 未命中.push(String(类型).trim())

  const 流派命中 = []
  for (const t of Array.isArray(流派) ? 流派 : [流派]) {
    const row = resolveLabel(rows, t)
    if (row && row.维度 === '流派') 流派命中.push(await withContent(packageRoot, row))
    else if (String(t || '').trim()) 未命中.push(String(t).trim())
  }
  return { 题材命中, 流派命中, 未命中 }
}

async function withContent(packageRoot, row) {
  const out = { 名称: row.名称, 题材: row.题材, 条目: row.条目, content: '' }
  if (row.条目) {
    try {
      out.content = await fs.readFile(path.join(packageRoot, REF, ...row.条目.split('/')), 'utf8')
    } catch {
      // 条目待补：归一有效、内容降级为空
    }
  }
  return out
}

/** 读单条知识条目：front matter + 正文 + 常用节切片；失败返回 null */
export async function readEntry(packageRoot, relPath) {
  let raw
  try {
    raw = await fs.readFile(path.join(packageRoot, REF, ...relPath.split('/')), 'utf8')
  } catch {
    return null
  }
  const fm = parseFrontMatter(raw)
  if (!fm.ok) return null
  return {
    文件: relPath,
    fm: fm.data || {},
    body: fm.body,
    落笔时: extractSection(fm.body, '落笔时'),
    规划: extractSection(fm.body, '规划这一章时'),
    审稿时: extractSection(fm.body, '审稿时'),
  }
}

/**
 * 章级知识紧凑索引（节拍/场景/追读）：[{名称, 编号, 关键词: [], 一句话, 文件}]。
 * 目录缺失/条目残缺按可用子集返回（旁路降级）。
 */
export async function listChapterIndex(packageRoot, dir) {
  const abs = path.join(packageRoot, REF, dir)
  let names
  try {
    names = (await fs.readdir(abs)).filter((n) => n.endsWith('.md')).sort()
  } catch {
    return []
  }
  const out = []
  for (const name of names) {
    let raw
    try {
      raw = await fs.readFile(path.join(abs, name), 'utf8')
    } catch {
      continue
    }
    const fm = parseFrontMatter(raw)
    if (!fm.ok || !fm.data || !fm.data.名称) continue
    out.push({
      名称: String(fm.data.名称),
      编号: fm.data.编号 ? String(fm.data.编号) : '',
      关键词: Array.isArray(fm.data.关键词) ? fm.data.关键词.map(String) : [],
      一句话: fm.data.一句话 ? String(fm.data.一句话) : '',
      文件: `${dir}/${name}`,
    })
  }
  return out
}

/**
 * 按细纲声明查条目：声明可为编号（PA-001）、名称（压抑蓄力爆发）或"编号 名称"混写。
 * 查不到返回 null——调用方注入声明文本本身（声明即知识，spec §7）。
 */
export async function findDeclared(packageRoot, dir, declaration) {
  const decl = String(declaration || '').trim()
  if (!decl) return null
  const index = await listChapterIndex(packageRoot, dir)
  const hit = index.find(
    (e) => (e.编号 && decl.startsWith(e.编号)) || decl === e.名称 || decl.includes(e.名称)
  )
  return hit ? readEntry(packageRoot, hit.文件) : null
}

/** 场景候选：拿场景关键词扫文本（卷纲段+上一章结尾），命中即候选——只出候选不拦截（spec §7） */
export async function sceneCandidates(packageRoot, texts) {
  const scenes = await listChapterIndex(packageRoot, '场景')
  const corpus = (Array.isArray(texts) ? texts : [texts]).filter(Boolean).join('\n')
  if (!corpus) return []
  return scenes
    .filter((s) => s.关键词.some((k) => k && corpus.includes(k)))
    .map((s) => ({ 名称: s.名称, 一句话: s.一句话 }))
}

/**
 * 解析细纲的知识声明位（spec §7：本章提案段内标签行，皆可空）。
 * 容忍全角/半角冒号；本章场景 支持 顿号/逗号 分隔多值。
 */
export function parseOutlineDeclarations(outline) {
  const out = { 节拍: '', 钩子: '', 场景: [] }
  for (const line of String(outline || '').split('\n')) {
    const t = line.trim()
    const m = t.match(/^(本章节拍|章尾钩子|本章场景)[：:]\s*(.*)$/)
    if (!m || !m[2]) continue
    const value = m[2].trim()
    if (m[1] === '本章节拍') out.节拍 = value
    else if (m[1] === '章尾钩子') out.钩子 = value
    else out.场景 = value.split(/[、,，]/).map((s) => s.trim()).filter(Boolean)
  }
  return out
}
