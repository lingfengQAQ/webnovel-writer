import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parseFrontMatter } from '../storage/parsers/front-matter.js'

/**
 * v6 书项目归一读取层（migrate 的输入面，全程零写入）。
 * v6 语义依据：任务 research/v6-data-inventory.md（file:line 证据），
 * 兼容口径 = 其 Q13 十条（三种正文命名 / state.json 三形态 / 键名与别名漂移 / 缺表容忍）。
 * @param {string} v6Path v6 项目根
 * @returns {Promise<{ok: boolean, facts: object|null, error: string}>}
 */
export async function readV6Project(v6Path) {
  const warnings = []
  const hasBody = await exists(path.join(v6Path, '正文'))
  const hasWebnovel = await exists(path.join(v6Path, '.webnovel'))
  if (!hasBody && !hasWebnovel) {
    return { ok: false, facts: null, error: `「${v6Path}」不像 v6 书项目：既没有 正文/ 也没有 .webnovel/。请指向 v6 书项目根目录。` }
  }

  // —— state.json（三形态：全量内联 / 5.4 精简 / 空损坏）——
  let state = {}
  const statePath = path.join(v6Path, '.webnovel', 'state.json')
  if (await exists(statePath)) {
    try {
      state = JSON.parse(await fs.readFile(statePath, 'utf8')) || {}
    } catch (err) {
      warnings.push(`读取 .webnovel/state.json 失败（${err.message}）：运行态数据不可用，仅迁移文件面内容。`)
      state = {}
    }
  } else {
    warnings.push('未找到 .webnovel/state.json：按纯文件面迁移（正文/大纲/设定集）。')
  }

  // —— index.db（只读；缺表/缺列容忍，Q13-10）——
  const dbPath = path.join(v6Path, '.webnovel', 'index.db')
  const db = (await exists(dbPath)) ? openReadOnly(dbPath, warnings) : null

  const hasInlineEntities = state.entities_v3 && Object.keys(state.entities_v3).length > 0
  const form = db && hasInlineEntities ? 'mixed' : db ? 'sqlite' : 'inline'

  const facts = {
    form,
    project: state.project_info || state.project || {},
    progress: state.progress || {},
    protagonistState: state.protagonist_state || {},
    strandTracker: state.strand_tracker || {},
    worldSettings: state.world_settings || {},
    chapters: await scanChapters(v6Path, warnings),
    entities: [],
    stateChanges: [],
    relationships: [],
    foreshadowing: (state.plot_threads?.foreshadowing || []).map(normalizeForeshadowing),
    activeThreads: state.plot_threads?.active_threads || [],
    chapterMeta: new Map(
      Object.entries(state.chapter_meta || {}).map(([k, v]) => [Number(k), v])
    ),
    readingPower: new Map(),
    summaries: await readSummaries(v6Path, warnings),
    dbSummaries: new Map(),
    outlines: await readOutlines(v6Path),
    settingFiles: await readSettingFiles(v6Path),
    scratchpad: await readJson(path.join(v6Path, '.webnovel', 'memory_scratchpad.json'), warnings, {}),
    patterns: (await readJson(path.join(v6Path, '.webnovel', 'project_memory.json'), warnings, {})).patterns || [],
    chaseDebtCount: 0,
    warnings,
  }

  // —— 实体：db 为准，state 内联补缺（Q13-2/3/7）——
  const byId = new Map()
  if (db) {
    const aliasRows = tryAll(db, 'SELECT alias, entity_id FROM aliases') || []
    const aliasMap = new Map()
    for (const r of aliasRows) {
      if (!aliasMap.has(r.entity_id)) aliasMap.set(r.entity_id, [])
      aliasMap.get(r.entity_id).push(r.alias)
    }
    const rows =
      tryAll(db, 'SELECT * FROM entities WHERE is_archived = 0') ??
      tryAll(db, 'SELECT * FROM entities') ??
      []
    for (const r of rows) {
      byId.set(r.id, {
        id: r.id,
        type: r.type || '角色',
        name: r.canonical_name || r.id,
        aliases: aliasMap.get(r.id) || [],
        tier: r.tier || '装饰',
        isProtagonist: !!r.is_protagonist,
        current: parseJsonOr(r.current_json, {}),
        desc: r.desc || '',
        firstAppearance: r.first_appearance ?? null,
        lastAppearance: r.last_appearance ?? null,
      })
    }
    facts.stateChanges = (tryAll(db, 'SELECT * FROM state_changes ORDER BY chapter, id') || []).map((r) => ({
      entityId: r.entity_id, field: r.field, old: r.old_value, new: r.new_value,
      reason: r.reason || '', chapter: r.chapter ?? null,
    }))
    facts.relationships = (tryAll(db, 'SELECT * FROM relationships ORDER BY chapter, id') || []).map((r) => ({
      from: r.from_entity, to: r.to_entity, type: r.type || '', description: r.description || '', chapter: r.chapter ?? null,
    }))
    for (const r of tryAll(db, 'SELECT chapter, title, summary FROM chapters') || []) {
      if (r.summary) facts.dbSummaries.set(r.chapter, r.summary)
    }
    for (const r of tryAll(db, 'SELECT * FROM chapter_reading_power') || []) {
      facts.readingPower.set(r.chapter, {
        hookType: r.hook_type || '', hookStrength: r.hook_strength || 'medium',
        coolpointPatterns: parseJsonOr(r.coolpoint_patterns, []),
      })
    }
    facts.chaseDebtCount = (tryAll(db, 'SELECT COUNT(*) AS n FROM chase_debt') || [{ n: 0 }])[0].n
    db.close()
  }
  if (hasInlineEntities) {
    const aliasIndex = state.alias_index || {}
    for (const [type, group] of Object.entries(state.entities_v3)) {
      for (const [id, e] of Object.entries(group || {})) {
        if (byId.has(id)) continue // db 为准
        const aliases = new Set(e.aliases || [])
        for (const [alias, refs] of Object.entries(aliasIndex)) {
          if ((refs || []).some((ref) => ref.id === id)) aliases.add(alias)
        }
        byId.set(id, {
          id, type,
          name: e.canonical_name || e.name || id,
          aliases: [...aliases],
          tier: e.tier || '装饰',
          isProtagonist: !!e.is_protagonist,
          current: e.current || {},
          desc: e.desc || '',
          firstAppearance: e.first_appearance ?? null,
          lastAppearance: e.last_appearance ?? null,
        })
      }
    }
    facts.stateChanges.push(...(state.state_changes || []).map((c) => ({
      entityId: c.entity_id, field: c.field,
      old: c.old ?? c.old_value ?? '', new: c.new ?? c.new_value ?? '',
      reason: c.reason || '', chapter: c.chapter ?? null,
    })))
    facts.relationships.push(...(state.structured_relationships || []).map((r) => ({
      from: r.from ?? r.from_entity, to: r.to ?? r.to_entity,
      type: r.type || '', description: r.description || '', chapter: r.chapter ?? null,
    })))
  }
  facts.entities = [...byId.values()]

  return { ok: true, facts, error: '' }
}

// —— 伏笔规范化（v6 state_validator 口径：status/tier 别名、埋设章多键名，research Q4）——
const RESOLVED_STATUS = new Set(['已回收', '已解决', 'resolved', 'done', 'closed'])
const TIER_MAP = new Map([
  ['核心', '核心'], ['core', '核心'], ['主线', '核心'],
  ['支线', '支线'], ['support', '支线'],
  ['装饰', '装饰'], ['decoration', '装饰'],
])

function normalizeForeshadowing(raw) {
  const status = RESOLVED_STATUS.has(String(raw.status || '').toLowerCase()) ? '已回收' : '未回收'
  return {
    content: raw.content || '',
    status,
    tier: TIER_MAP.get(String(raw.tier || '').toLowerCase()) || '支线',
    plantedChapter: firstNum(raw.planted_chapter, raw.added_chapter, raw.source_chapter, raw.start_chapter, raw.chapter),
    targetChapter: firstNum(raw.target_chapter, raw.due_chapter, raw.deadline_chapter, raw.resolve_by_chapter, raw.target),
    resolvedChapter: firstNum(raw.resolved_chapter, raw.resolved_at_chapter, raw.resolved),
    urgency: raw.urgency ?? null,
  }
}

// —— 正文扫描：平坦 4 位带标题 / 遗留纯章号 / 卷内 3 位（Q13-1）——
async function scanChapters(v6Path, warnings) {
  const root = path.join(v6Path, '正文')
  const found = new Map()
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    warnings.push('未找到 正文/ 目录：没有可迁移的章节。')
    return []
  }
  const collect = async (dir, volumeHint) => {
    for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
      if (!ent.isFile()) continue
      const m = ent.name.match(/^第(\d+)章(?:-(.+?))?\.md$/)
      if (!m) continue
      const num = Number(m[1])
      if (found.has(num)) {
        warnings.push(`第 ${num} 章有多个文件（${found.get(num).sourceName} 与 ${ent.name}），取前者，后者未迁移。`)
        continue
      }
      found.set(num, {
        num,
        title: m[2] || null,
        body: await fs.readFile(path.join(dir, ent.name), 'utf8'),
        volumeHint,
        sourceName: ent.name,
      })
    }
  }
  await collect(root, null)
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const vm = ent.name.match(/^第(\d+)卷$/)
    if (vm) await collect(path.join(root, ent.name), Number(vm[1]))
  }
  return [...found.values()].sort((a, b) => a.num - b.num)
}

async function readSummaries(v6Path, warnings) {
  const dir = path.join(v6Path, '.webnovel', 'summaries')
  const map = new Map()
  let files
  try {
    files = await fs.readdir(dir)
  } catch {
    return map
  }
  for (const f of files) {
    const m = f.match(/^ch(\d+)\.md$/)
    if (!m) continue
    const parsed = parseFrontMatter(await fs.readFile(path.join(dir, f), 'utf8'))
    if (parsed.ok) {
      map.set(Number(m[1]), { frontMatter: parsed.data, body: parsed.body })
    } else {
      warnings.push(`章摘要 ${f} 解析失败，该章摘要未迁移：${parsed.error}`)
    }
  }
  return map
}

async function readOutlines(v6Path) {
  const dir = path.join(v6Path, '大纲')
  const outlines = { master: '', volumes: [] }
  let files
  try {
    files = await fs.readdir(dir)
  } catch {
    return outlines
  }
  const byVol = new Map()
  const vol = (n) => {
    if (!byVol.has(n)) byVol.set(n, { n, 详细大纲: '', 时间线: '', 拆分章纲: [] })
    return byVol.get(n)
  }
  for (const f of files) {
    const full = path.join(dir, f)
    let m
    if (f === '总纲.md') {
      outlines.master = await fs.readFile(full, 'utf8')
    } else if ((m = f.match(/^第(\d+)卷-详细大纲\.md$/))) {
      vol(Number(m[1])).详细大纲 = await fs.readFile(full, 'utf8')
    } else if ((m = f.match(/^第(\d+)卷-时间线\.md$/))) {
      vol(Number(m[1])).时间线 = await fs.readFile(full, 'utf8')
    } else if (/^第\d+章[-—_ ].+\.md$/.test(f)) {
      vol(1).拆分章纲.push({ name: f, content: await fs.readFile(full, 'utf8') })
    }
  }
  outlines.volumes = [...byVol.values()].sort((a, b) => a.n - b.n)
  return outlines
}

async function readSettingFiles(v6Path) {
  const dir = path.join(v6Path, '设定集')
  const out = []
  try {
    for (const f of await fs.readdir(dir)) {
      if (f.endsWith('.md')) out.push({ name: f, content: await fs.readFile(path.join(dir, f), 'utf8') })
    }
  } catch {
    // 无设定集
  }
  return out
}

// —— 小工具 ——
async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function readJson(p, warnings, fallback) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8')) || fallback
  } catch (err) {
    if (err.code !== 'ENOENT') warnings.push(`读取 ${path.basename(p)} 失败（${err.message}），该部分未迁移。`)
    return fallback
  }
}

function openReadOnly(dbPath, warnings) {
  try {
    try {
      return new DatabaseSync(dbPath, { readOnly: true })
    } catch {
      return new DatabaseSync(dbPath)
    }
  } catch (err) {
    warnings.push(`打开 .webnovel/index.db 失败（${err.message}）：数据库内容未迁移。`)
    return null
  }
}

function tryAll(db, sql) {
  try {
    return db.prepare(sql).all()
  } catch {
    return null // 表/列缺失属正常增量形态
  }
}

function parseJsonOr(text, fallback) {
  if (!text) return fallback
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

function firstNum(...vals) {
  for (const v of vals) {
    const n = Number(v)
    if (v !== undefined && v !== null && v !== '' && Number.isFinite(n)) return n
  }
  return null
}
