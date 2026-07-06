import { serializeFrontMatter } from '../storage/serializers/front-matter.js'
import { serializeMarkdownTable } from '../storage/serializers/markdown-table.js'
import { parseMarkdownTable } from '../storage/parsers/markdown-table.js'
import { serializeYAML } from '../storage/serializers/yaml-dialect.js'
import { extractSection } from '../util/markdown.js'
import { sanitizeFileName } from '../util/filename.js'

const GENRE_MAP = new Map([
  ['xianxia', '仙侠'], ['xiuxian', '仙侠'],
  ['xuanhuan', '玄幻'], ['fantasy', '玄幻'],
  ['urban', '都市'], ['dushi', '都市'],
  ['scifi', '科幻'], ['kehuan', '科幻'],
  ['history', '历史'], ['lishi', '历史'],
])
const STRENGTH_MAP = new Map([
  ['strong', '强'], ['medium', '中'], ['weak', '弱'],
  ['强', '强'], ['中', '中'], ['弱', '弱'],
])
const TIER_TO_STRENGTH = new Map([['核心', '高'], ['支线', '中'], ['装饰', '低']])

/**
 * V6Facts → v7 书仓库文件计划（纯函数零 IO，design §3.2 映射表逐行）。
 * @returns {{files: {path: string, content: string}[], report: object, bookName: string}}
 */
export function transformV6(facts) {
  const files = []
  const 待校对 = []
  const 丢弃 = []
  const counts = {}
  const add = (p, content) => files.push({ path: p, content })

  // —— book.yaml ——
  const bookName = facts.project.title || '未命名'
  const rawGenre = facts.project.genre || ''
  let 类型 = GENRE_MAP.get(String(rawGenre).toLowerCase()) || rawGenre
  if (!类型) {
    类型 = '玄幻'
    待校对.push('book.yaml：v6 未记录题材，暂填「玄幻」，请改成实际题材。')
  } else if (!GENRE_MAP.get(String(rawGenre).toLowerCase()) && !/^[一-鿿]+$/.test(类型)) {
    待校对.push(`book.yaml：题材「${rawGenre}」没有对应的中文码表，原样保留，请改成中文题材名。`)
  }
  // book.yaml 走防呆序列化器（R9）：书名以 [ * " - 起首或纯数字时，手写拼接会
  // 解析失败/类型漂移 → 书内设置回落默认、books.jsonl 扫描重建时该书从书单消失
  add('book.yaml', serializeYAML({
    spec_version: '7.0',
    书名: bookName,
    类型,
    每章目标字数: 3000,
    卷规模: 40,
  }) + '\n')

  // —— 卷号推断：卷内布局优先，详细大纲「### 第N章」次之，兜底 1 ——
  const volumeOf = buildVolumeIndex(facts.outlines)

  // —— 正文章 ——
  for (const ch of facts.chapters) {
    const title = ch.title || `第${ch.num}章`
    const fm = {
      章号: ch.num,
      标题: title,
      卷: ch.volumeHint ?? volumeOf.get(ch.num) ?? 1,
      字数: ch.body.replace(/\s/g, '').length,
      章定位: '迁移',
    }
    const hook = hookOf(facts, ch.num)
    if (hook) fm.钩子 = hook
    fm.本章要写到的事 = ['迁移']
    add(`定稿/正文/${pad4(ch.num)}-${sanitizeFileName(title)}.md`, serializeFrontMatter(fm, ch.body.trim() + '\n'))
  }
  counts.章数 = facts.chapters.length

  // —— 章摘要：summaries 文件 > db summary 列（权衡 4.2）——
  let 摘要数 = 0
  for (const ch of facts.chapters) {
    const fromFile = facts.summaries.get(ch.num)
    const text = fromFile
      ? (extractSection(fromFile.body, '剧情摘要') || fromFile.body).trim()
      : (facts.dbSummaries.get(ch.num) || '').trim()
    if (text) {
      add(`定稿/摘要/章摘要/${pad4(ch.num)}.md`, text + '\n')
      摘要数++
    }
  }
  counts.摘要 = 摘要数

  // —— 伏笔条目 ——
  facts.foreshadowing.forEach((fb, i) => {
    const id = `伏笔-${String(i + 1).padStart(3, '0')}`
    // 按码点切前 9 字（F-4）：UTF-16 码元切会把 emoji/生僻字的代理对切成两半，文件名损坏
    const 短题 = Array.from(sanitizeFileName(fb.content)).slice(0, 9).join('') || '迁移条目'
    const planted = fb.plantedChapter ?? 1
    const fm = {
      强度: TIER_TO_STRENGTH.get(fb.tier) || '中',
      状态: fb.status === '已回收' ? '已收尾' : '进行',
      开启章: planted,
    }
    if (fb.targetChapter) fm.预计收尾 = `第${fb.targetChapter}章`
    fm.最后推进章 = fb.resolvedChapter ?? planted
    const 收尾计划 = fb.targetChapter
      ? `第${fb.targetChapter}章前后回收（迁移自 v6 目标章）。`
      : '迁移待补（校对时补写，防悬空）。'
    if (!fb.targetChapter && fb.status !== '已回收') {
      待校对.push(`${id}（${短题}）：v6 没有目标回收章，收尾计划标了「迁移待补」。`)
    }
    const 履历 = [`- 第${planted}章：埋下（迁移）`]
    if (fb.resolvedChapter) 履历.push(`- 第${fb.resolvedChapter}章：回收（迁移）`)
    add(`大纲/伏笔/${id}-${短题}.md`, serializeFrontMatter(
      fm,
      `## 描述\n${fb.content}\n\n## 收尾计划\n${收尾计划}\n\n## 履历\n${履历.join('\n')}\n`
    ))
  })
  counts.伏笔 = facts.foreshadowing.length

  // —— 名册 + 角色卡 ——
  // 一对多别名降级（R10）：v6 允许同一别名指向多实体做消歧，v7 别名唯一（缓存重建
  // 撞冲突会整体回滚）。首实体保留该别名，其余剥离进待校对文件，迁移不再硬失败。
  const aliasOwner = new Map()
  const 别名歧义 = []
  for (const e of facts.entities) {
    e.aliases = e.aliases.filter((a) => {
      const owner = aliasOwner.get(a)
      if (owner === undefined) {
        aliasOwner.set(a, e.name)
        return true
      }
      if (owner !== e.name) 别名歧义.push({ 别名: a, 保留: owner, 剥离: e.name })
      return false
    })
  }
  if (别名歧义.length) {
    add('定稿/设定/迁移待校对-别名歧义.md',
      `# 迁移待校对：一对多别名\n\n> v6 里同一别名指向多个实体（用于消歧），v7 要求别名唯一。\n> 迁移时按首个实体保留，其余实体的该别名已剥离——请校对归属：\n> 该给谁就在名册里给谁补上，或换一个不冲突的别名。校对完删掉本文件。\n\n` +
      别名歧义.map((x) => `- 「${x.别名}」保留给【${x.保留}】，已从【${x.剥离}】剥离`).join('\n') + '\n')
    待校对.push('定稿/设定/迁移待校对-别名歧义.md：v6 一对多别名按首实体保留，请校对归属。')
  }

  const nameOf = new Map(facts.entities.map((e) => [e.id, e.name]))
  if (facts.entities.length) {
    add('定稿/设定/名册.md', serializeMarkdownTable(
      ['正名', '别名', '类型', '首现章'],
      facts.entities.map((e) => ({
        正名: e.name, 别名: e.aliases.join(', '), 类型: e.type, 首现章: e.firstAppearance ?? '',
      }))
    ))
  }
  let 角色卡 = 0
  for (const e of facts.entities) {
    if (e.type !== '角色') continue
    const fm = { 姓名: e.name }
    if (e.aliases.length) fm.别名 = e.aliases
    if (e.current.状态) fm.状态 = e.current.状态
    if (e.current.location || e.current.位置) fm.位置 = e.current.location || e.current.位置
    if (e.current.realm || e.current.境界) fm.境界 = e.current.realm || e.current.境界
    if (e.lastAppearance) fm.最后变更章 = e.lastAppearance
    const 设定行 = []
    if (e.desc) 设定行.push(e.desc)
    for (const [k, v] of Object.entries(e.current)) {
      if (!['状态', 'location', '位置', 'realm', '境界'].includes(k)) 设定行.push(`${k}：${v}`)
    }
    if (e.isProtagonist && facts.protagonistState.golden_finger?.name) {
      const gf = facts.protagonistState.golden_finger
      设定行.push(`金手指：${gf.name}${gf.level ? `（等级 ${gf.level}）` : ''}`)
    }
    const 关系行 = facts.relationships
      .filter((r) => r.from === e.id || r.to === e.id)
      .map((r) => `- 与${nameOf.get(r.from === e.id ? r.to : r.from) || '未知'}：${r.type}${r.description ? `——${r.description}` : ''}${r.chapter ? `（第${r.chapter}章）` : ''}`)
    add(`定稿/设定/角色/${sanitizeFileName(e.name)}.md`, serializeFrontMatter(
      fm,
      `## 设定\n${设定行.join('\n') || '（迁移未采集）'}\n\n## 典型对话\n（迁移未采集）\n\n## 关系\n${关系行.join('\n') || '（迁移未采集）'}\n`
    ))
    角色卡++
  }
  counts.角色卡 = 角色卡

  // —— 时间线（v6 表 章节|时间|事件 → v7 表）——
  let 时间线行 = 0
  for (const vol of facts.outlines.volumes) {
    if (!vol.时间线) continue
    const parsed = parseMarkdownTable(tableSlice(vol.时间线))
    if (!parsed.ok || !parsed.rows.length) continue
    const rows = parsed.rows.map((r) => ({
      章: r['章节'] ?? r['章'] ?? '',
      书内时间: r['时间'] ?? r['书内时间'] ?? '',
      一句话事件: r['事件'] ?? r['一句话事件'] ?? '',
      在场: r['在场'] ?? '',
    }))
    add(`定稿/设定/时间线/第${pad2(vol.n)}卷.md`, serializeMarkdownTable(['章', '书内时间', '一句话事件', '在场'], rows))
    时间线行 += rows.length
  }
  counts.时间线行 = 时间线行

  // —— 大纲：总纲原样、详细大纲→卷纲（active_threads/拆分章纲 并入）——
  if (facts.outlines.master) add('大纲/总纲.md', facts.outlines.master)
  const lastVol = facts.outlines.volumes[facts.outlines.volumes.length - 1]
  for (const vol of facts.outlines.volumes) {
    let content = vol.详细大纲 || `# 第${vol.n}卷 卷纲（迁移占位）\n`
    if (vol.拆分章纲.length) {
      content += `\n## 迁移的拆分章纲\n` + vol.拆分章纲.map((s) => `### ${s.name}\n${s.content.trim()}`).join('\n\n') + '\n'
    }
    if (facts.activeThreads.length && vol === lastVol) {
      content += `\n## 迁移的剧情线\n` + facts.activeThreads
        .map((t) => `- ${t.name || '未命名'}：${t.note || t.description || ''}${t.status ? `（v6 状态 ${t.status}）` : ''}`)
        .join('\n') + '\n'
    }
    add(`大纲/卷纲/第${pad2(vol.n)}卷.md`, content)
  }
  counts.卷纲 = facts.outlines.volumes.length

  // —— 设定集原样搬 ——
  for (const f of facts.settingFiles) add(`定稿/设定/${f.name}`, f.content)
  counts.设定文件 = facts.settingFiles.length

  // —— 待校对三件（人工过一遍再入）——
  const buckets = ['character_state', 'story_facts', 'world_rules', 'timeline', 'open_loops', 'reader_promises', 'relationships']
  const memSections = buckets
    .filter((b) => (facts.scratchpad[b] || []).length)
    .map((b) => `## ${b}\n` + facts.scratchpad[b]
      .map((it) => `- ${it.subject ? `【${it.subject}】` : ''}${it.value || ''}${it.source_chapter ? `（第${it.source_chapter}章）` : ''}${(it.evidence || []).length ? ` 证据：${it.evidence.join('；')}` : ''}`)
      .join('\n'))
  if (memSections.length) {
    add('定稿/设定/迁移待校对-记忆清单.md',
      `# 迁移待校对：v6 记忆清单\n\n> 人工过一遍：有用的登记成条目/写进设定，没用的删掉本文件。\n\n${memSections.join('\n\n')}\n`)
    待校对.push('定稿/设定/迁移待校对-记忆清单.md：v6 记忆分桶清单（含 open_loops 开放线索，酌情登记成条目）。')
  }
  if (facts.patterns.length) {
    add('文风/迁移待校对-文风候选.md',
      `# 迁移待校对：v6 学到的文风套路\n\n> 人工过一遍再并入 文风/文风铁律.md，之后删掉本文件。\n\n` +
      facts.patterns.map((p) => `- [${p.pattern_type || '未分类'}] ${p.description || ''}${p.source_chapter ? `（第${p.source_chapter}章）` : ''}`).join('\n') + '\n')
    待校对.push('文风/迁移待校对-文风候选.md：v6 patterns，过目后并入文风铁律。')
  }
  if (facts.stateChanges.length) {
    add('定稿/设定/迁移待校对-实体变更史.md',
      `# 迁移待校对：v6 实体变更流水\n\n> 当前值已并入角色卡；这里是历史流水，校对后可删。\n\n` +
      facts.stateChanges.map((c) => `- 第${c.chapter ?? '?'}章：${nameOf.get(c.entityId) || c.entityId} 的 ${c.field}「${c.old}」→「${c.new}」${c.reason ? `（${c.reason}）` : ''}`).join('\n') + '\n')
    待校对.push('定稿/设定/迁移待校对-实体变更史.md：变更流水存档。')
  }

  // —— 如实丢弃 ——
  if (facts.chaseDebtCount > 0) {
    丢弃.push(`追读力债务台账（chase_debt）${facts.chaseDebtCount} 条——v7 无债务体系，未迁移。`)
  }
  丢弃.push('派生库与缓存（index.db 实体已转正文件、vectors.db、rag.db、projection_log、context_cache、.story-system/、observability、backups）——v7 缓存会从新仓库重建。')
  丢弃.push(...facts.warnings)

  return {
    files,
    bookName,
    report: { counts, 待校对, 丢弃, form: facts.form },
  }
}

// —— 工具 ——
function buildVolumeIndex(outlines) {
  const map = new Map()
  for (const vol of outlines.volumes) {
    const re = /###\s*第(\d+)章/g
    let m
    while ((m = re.exec(vol.详细大纲 || ''))) map.set(Number(m[1]), vol.n)
  }
  return map
}

function hookOf(facts, num) {
  const meta = facts.chapterMeta.get(num)?.hook
  if (meta?.type) return `${meta.type}-${STRENGTH_MAP.get(String(meta.strength || '').toLowerCase()) || '中'}`
  const rp = facts.readingPower.get(num)
  if (rp?.hookType) return `${rp.hookType}-${STRENGTH_MAP.get(String(rp.hookStrength || '').toLowerCase()) || '中'}`
  return null
}

/** 从自由 markdown 中截取表格行（v6 时间线文件表格前有标题行）。 */
function tableSlice(content) {
  return content.split('\n').filter((l) => l.trim().startsWith('|')).join('\n')
}

function pad4(n) {
  return String(n).padStart(4, '0')
}

function pad2(n) {
  return String(n).padStart(2, '0')
}
