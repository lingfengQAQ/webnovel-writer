import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scaffoldBookFiles } from '../src/book/scaffold'
import { serializeDocument } from '../src/repo/frontmatter'
import { paths } from '../src/repo/paths'
import { removeSync } from '../src/repo/remove'
import { prepareSkeleton, prepareVolumeLayout } from '../src/design/skeleton'
import { prepareEntry } from '../src/design/worldbook'
import { prepareRecentWindow } from '../src/design/volume'
import { writeCandidate, confirmOutline } from '../src/outline/write'
import { 定位段小节, 单元字段 } from '../src/outline/template'
import { computePack } from '../src/prepare/pack'
import { computeMaterials } from '../src/assembly/assemble'
import { writeBookMemory } from '../src/memory/book'
import { planSettlement } from '../src/settlement'
import { archiveReceiptOp } from '../src/commit/receipt'
import { archiveChapter } from '../src/commit/archive'
import { emptyIndexState, INDEX_STATE_PATH } from '../src/retrieval/state'
import { SCENE_CACHE_PATH, SCENE_RULE_VERSION } from '../src/retrieval/scenes'
import { BOOK_INSPECTION_RULE_VERSION, inspectBookDocuments } from '../src/maintenance/inspection'
import { createReadonlyBookSnapshot } from '../src/maintenance/snapshot'

const temp = fs.realpathSync.native(os.tmpdir())
const concept = { 状态: '已确认' as const, 核心创意: '渡口来客寻找旧船票。', 题材与目标读者: '面向成年读者的幻想故事。' }
const key = { 卷: 1, 章: 1, 章名: '渡口' }
let root: string
const extra: string[] = []
const hash = (content: string | Buffer): string => createHash('sha256').update(content).digest('hex')

beforeEach(() => { root = fs.mkdtempSync(path.join(temp, 'maintenance-inspection-')) })
afterEach(() => {
  vi.restoreAllMocks(); syncBuiltinESMExports()
  for (const target of [root, ...extra.splice(0)]) {
    if (path.dirname(target) !== temp || !path.basename(target).startsWith('maintenance-inspection-')) throw new Error('Unexpected fixture path')
    removeSync(target)
  }
})
function put(relative: string, content: string | Buffer): void {
  const target = path.join(root, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}
function initialize(git = false): void {
  scaffoldBookFiles(root, concept, { bookId: 'inspection-book' })
  if (git) initializeGit()
}
function fixtureGit(...args: string[]): string {
  return execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' }).trim()
}
function initializeGit(): void {
  fixtureGit('init', '--quiet')
  fixtureGit('config', 'user.name', 'Fixture')
  fixtureGit('config', 'user.email', 'fixture@example.invalid')
  fixtureGit('config', 'commit.gpgsign', 'false')
  fixtureGit('add', '.')
  fixtureGit('commit', '--quiet', '-m', 'vol: fixture')
}
function snapshot(): Record<string, string> {
  const result: Record<string, string> = {}
  const walk = (relative: string): void => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const file = path.posix.join(relative, entry.name)
      if (entry.isSymbolicLink()) result[file] = `link:${fs.readlinkSync(path.join(root, file))}`
      else if (entry.isDirectory()) { result[`${file}/`] = ''; walk(file) }
      else result[file] = hash(fs.readFileSync(path.join(root, file)))
    }
  }
  walk(''); return result
}
function completeDesign(): void {
  initialize()
  for (const op of [prepareSkeleton(root, '# 故事骨架\n## 核心命题 〔暂定〕\n寻找记忆。\n'), prepareVolumeLayout(root, '# 分卷布局\n## 故事阶段分配 〔已确认〕\n- 卷01 〔已确认〕\n'), prepareRecentWindow(1, [{ 名称: key.章名, 状态: '已确认' }]), prepareEntry(root, '人物档案', '林舟', { 类型: '人物', 性质: '计划', 状态: '已确认', 来源: '对谈共创' })]) put(op.relPath, op.content)
}
function preparedChapter(withLedger = false): ReturnType<typeof computePack> {
  completeDesign()
  const body = ['# 章细纲', '## 定位段', ...定位段小节.flatMap(name => [`### ${name}`, name === '章节功能' ? '核对船票。\n- 〔软〕平缓叙述。' : '已核对本章前提。']), '## 细纲段', '### 单元 1', ...单元字段.map(name => `- ${name}：来客在渡口核对船票。`)].join('\n')
  writeCandidate(root, { ...key, 来源引用: ['来源:对谈共创'], body })
  expect(confirmOutline(root, key)).toMatchObject({ ok: true })
  put(`${paths.草稿目录(1, key.章名)}/稿1.md`, serializeDocument({ 身份: key, 角色: '待审稿', 选定: true, 版本: 1 }, '来客在渡口找到了旧船票。'))
  const pack = computePack(root, key, { 章摘要: '来客找回船票，留在渡口。', ...(withLedger ? { 账本变更: '# 账本变更\n## 故事线\n### 船票\n状态：进行中\n计划来源：卷纲\n\n调查船票。\n' } : {}) })
  expect(pack.ok).toBe(true)
  for (const op of pack.文件 ?? []) put(op.relPath, op.content)
  return pack
}
function archivedFixture(pending = false): string {
  preparedChapter(true)
  initializeGit()
  if (pending) {
    put('.git/hooks/pre-commit', '#!/bin/sh\nexit 1\n')
    fs.chmodSync(path.join(root, '.git/hooks/pre-commit'), 0o755)
  }
  const archived = archiveChapter({ bookRoot: root, packageDir: paths.待定稿包目录(1, key.章名), summary: '合成归档', settlement: { 章节: key, 批准: true, 裁决记录: '合成夹具批准' } })
  expect(archived, JSON.stringify(archived)).toMatchObject(pending ? { ok: false, written: true } : { ok: true })
  const directory = '草稿区/.archive-receipts'
  const names = fs.readdirSync(path.join(root, directory))
  expect(names).toHaveLength(1)
  return `${directory}/${names[0]}`
}

describe('readonly document inspection', () => {
  it('checks current scaffold with 35 explicit capabilities and legitimate blanks', () => {
    initialize()
    const before = snapshot(), start = performance.now()
    const result = inspectBookDocuments(root)
    expect(result.结论, JSON.stringify(result.问题)).toBe('未发现已知问题')
    expect(result.状态).toBe('已检查')
    expect(result.书仓格式).toEqual({ ok: true, version: 1 })
    expect(result.规则版本).toBe(BOOK_INSPECTION_RULE_VERSION)
    expect(result.类型覆盖).toHaveLength(35)
    expect(result.受检范围.length).toBeGreaterThan(15)
    expect(result.未检范围).toEqual([])
    expect(result.快照).toMatchObject({ 稳定: true, 变更: [] })
    expect(result.快照.文件数).toBeGreaterThan(15)
    expect(performance.now() - start).toBeGreaterThanOrEqual(0)
    expect(snapshot()).toEqual(before)
  })

  it('does not create runtime, acquire a lock or update Git metadata', () => {
    initialize(true)
    removeSync(path.join(root, '.webnovel'))
    const before = snapshot()
    const forbidden = ['writeFileSync', 'mkdirSync', 'renameSync', 'unlinkSync', 'appendFileSync', 'rmSync'] as const
    const spies = forbidden.map(name => vi.spyOn(fs, name).mockImplementation(() => { throw new Error(`unexpected ${name}`) }))
    syncBuiltinESMExports()
    expect(inspectBookDocuments(root).结论).toBe('未发现已知问题')
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    vi.restoreAllMocks(); syncBuiltinESMExports()
    expect(snapshot()).toEqual(before)
    expect(fs.existsSync(path.join(root, '.webnovel'))).toBe(false)
  })

  it('accepts real design, draft and finalized producer output without requiring literary completion', () => {
    const pack = preparedChapter()
    const prose = pack.文件!.find(op => op.relPath.endsWith('/正文.md'))!.content
    const summary = pack.文件!.find(op => op.relPath.endsWith('/章摘要.md'))!.content
    put(paths.定稿章(1, 1, key.章名), prose)
    put(paths.章摘要(1, 1, key.章名), summary)
    const before = snapshot(), result = inspectBookDocuments(root)
    expect(result.结论, JSON.stringify(result.问题)).toBe('未发现已知问题')
    expect(result.受检范围.some(item => item.文档类型.includes('I16'))).toBe(true)
    expect(result.受检范围.some(item => item.文档类型.includes('I26'))).toBe(true)
    expect(snapshot()).toEqual(before)
  })

  it('accepts real material sections and checks missing/hash-damaged attachments', () => {
    preparedChapter()
    const materials = computeMaterials(root, key)
    expect(materials.ok).toBe(true)
    for (const op of materials.文件!) put(op.relPath, op.content)
    const good = inspectBookDocuments(root)
    expect(good.结论, JSON.stringify(good.问题)).toBe('未发现已知问题')
    const material = materials.文件!.find(op => op.relPath.endsWith('.md'))!
    fs.unlinkSync(path.join(root, material.relPath))
    expect(inspectBookDocuments(root).问题).toEqual(expect.arrayContaining([expect.objectContaining({ 路径: material.relPath, 代码: 'REQUIRED_MISSING' })]))
  })

  it('checks actual current memory entries and index coverage while preserving optional old fields', () => {
    initialize()
    expect(writeBookMemory(root, { 名称: '语气', 描述: '语气约定', 类: '文风', 来源: '作者明确要求', 正文: '采用简短句。' })).toMatchObject({ ok: true })
    expect(inspectBookDocuments(root).结论).toBe('未发现已知问题')
    put('本书记忆/语气.md', serializeDocument({ 类: '文风', 作者扩展: [1, '保留'] }, '采用简短句。'))
    expect(inspectBookDocuments(root).结论).toBe('未发现已知问题')
    put('本书记忆/索引.md', '# 索引\n')
    expect(inspectBookDocuments(root).问题.some(issue => issue.说明.includes('缺少条目'))).toBe(true)
  })

  it('accepts an unnumbered candidate outline without creating a chapter', () => {
    initialize()
    writeCandidate(root, { 卷: 1, 章名: '尚未编号' })
    expect(inspectBookDocuments(root).结论).toBe('未发现已知问题')
  })

  it('checks actual timeline and clue settlement fields but leaves prose field examples alone', () => {
    initialize()
    const dir = paths.待定稿包目录(1, key.章名)
    put(`${dir}/时间线变更.md`, '# 时间线变更\n## 到岸\n事件：船到了。\n时点：次日清晨\n\n说明。\n事件：这是正文中的同名行。\n')
    put(`${dir}/账本变更.md`, '# 账本变更\n## 线索\n### 船票\n状态：已埋\n计划来源：卷纲\n埋设点：第1章\n预期兑现区间：第2章\n\n票角缺了一块。\n')
    const plan = planSettlement(root, path.join(root, dir), { 批准: true, 章节: key, 裁决记录: '仅合成夹具批准' }, key)
    expect(plan.ok, JSON.stringify(plan)).toBe(true)
    if (!plan.ok) throw new Error(plan.reason)
    for (const op of plan.ops) put(op.relPath, op.content)
    const result = inspectBookDocuments(root)
    expect(result.问题.filter(issue => issue.路径.startsWith('账本/'))).toEqual([])
    expect(result.受检范围.find(item => item.路径 === '账本/时间线.md')?.结果).toBe('已检查')
  })

  it.each([
    ['时间线', '## 到岸\n章号：第0001章\n来源：定稿/卷01/0001-渡口.md\n裁决记录：原批准\n### 正文\n事件：船到了。\n时点：当晚\n\n说明正文。\n', '时间线正文前缀'],
    ['线索', '## 船票\n名称：船票\n类型：线索\n状态：已埋\n计划来源：卷纲\n实际落点：第1章\n来源：定稿/卷01/0001-渡口.md\n裁决记录：原批准\n### 正文\n埋设点：第1章\n预期兑现区间：第2章\n\n说明正文。\n', '线索正文前缀'],
  ])('identifies old %s field placement without rewriting it', (category, body, sourceShape) => {
    initialize(); put(`账本/${category}.md`, `# ${category}\n${body}`)
    const before = snapshot(), result = inspectBookDocuments(root)
    expect(result.结论).toBe('需升级')
    expect(result.问题).toEqual(expect.arrayContaining([expect.objectContaining({ 代码: 'LEGACY_SHAPE', 来源形态: sourceShape })]))
    if (category === '时间线') expect(result.问题.find(issue => issue.来源形态 === sourceShape)?.说明).toContain('本次检查不会改写。须先生成整仓升级预览；执行仍须作者批准')
    expect(snapshot()).toEqual(before)
  })

  it('does not infer missing timeline metadata from prose or silently deduplicate fields', () => {
    initialize()
    put('账本/时间线.md', '# 时间线\n## 到岸\n章号：第0001章\n来源：正文\n裁决记录：原批准\n### 正文\n先叙述。\n事件：后面的不是前置字段。\n')
    expect(inspectBookDocuments(root).问题.some(issue => issue.代码 === 'LEGACY_SHAPE')).toBe(false)
    put('账本/时间线.md', '# 时间线\n## 到岸\n事件：船到了。\n事件：船到了。\n时点：未知\n章号：第0001章\n来源：正文\n裁决记录：原批准\n### 正文\n正文\n')
    expect(inspectBookDocuments(root).问题.some(issue => issue.说明.includes('字段重复'))).toBe(true)
  })

  it('keeps empty memory scaffolds current-compatible while identifying nonempty legacy classes', () => {
    initialize()
    expect(inspectBookDocuments(root).类型覆盖.find(item => item.编号 === 'I21')?.文件数).toBe(4)
    put('本书记忆/文风.md', '# 文风\n## 语气\n状态：已确认\n### 正文\n旧条目正文。\n')
    const before = snapshot(), result = inspectBookDocuments(root)
    expect(result.问题).toEqual(expect.arrayContaining([expect.objectContaining({ 代码: 'LEGACY_SHAPE', 来源形态: '一类多条目记忆' })]))
    expect(result.问题.find(issue => issue.来源形态 === '一类多条目记忆')?.说明).toContain('本次检查不会改写。须先生成整仓升级预览；执行仍须作者批准')
    expect(snapshot()).toEqual(before)
  })

  it('preserves empty legacy files and their optional file metadata without requiring an index', () => {
    initialize(); put('本书记忆/文风.md', ''); put('本书记忆/决策.md', serializeDocument({ 作者说明: '保留' }, '# 决策\n'))
    expect(inspectBookDocuments(root).结论).toBe('未发现已知问题')
  })

  it('does not turn duplicate legacy prefixes into an apparently unique migration candidate', () => {
    initialize()
    put('账本/时间线.md', '# 时间线\n## 到岸\n章号：第0001章\n来源：原出处\n裁决记录：原批准\n### 正文\n事件：抵达。\n事件：抵达。\n')
    const result = inspectBookDocuments(root)
    expect(result.结论).toBe('需处理')
    expect(result.问题.some(issue => issue.代码 === 'LEGACY_SHAPE')).toBe(false)
    expect(result.问题.some(issue => issue.说明.includes('前缀字段重复'))).toBe(true)
  })

  it('does not apply current domain semantics to an explicitly future-format book', () => {
    initialize(); put(paths.契约(), serializeDocument({ 书id: 'inspection-book', 书仓格式版本: 2, 状态: '未来状态' }, '# 未知新协议\n'))
    put('本书记忆/未来.md', serializeDocument({ 新类: ['future'] }, '未来表示。'))
    const result = inspectBookDocuments(root)
    expect(result.结论).toBe('未支持')
    expect(result.问题.some(issue => issue.代码 === 'DOCUMENT_INVALID')).toBe(false)
    expect(result.未检范围.some(item => item.路径 === '本书记忆/未来.md')).toBe(true)
  })

  it('does not impose current required paths on a future-format book', () => {
    put(paths.契约(), serializeDocument({ 书id: 'future-book', 书仓格式版本: 2 }, '未来文档。'))
    const result = inspectBookDocuments(root)
    expect(result.结论).toBe('未支持')
    expect(result.问题.some(issue => issue.代码 === 'REQUIRED_MISSING')).toBe(false)
  })

  it('flags malformed links without decoding bare percent filenames into a different file', () => {
    initialize()
    put('本书记忆/%41.md', serializeDocument({ 类: '文风' }, '原文件。'))
    put('本书记忆/索引.md', '# 索引\n- [原文件](%41.md)\n')
    const legacy = inspectBookDocuments(root)
    expect(legacy.结论).toBe('需升级')
    expect(legacy.问题.some(issue => issue.说明.includes('目标不可读'))).toBe(false)
    put('本书记忆/索引.md', '# 索引\n- [原文件](<./%2Fsecret.md>)\n')
    expect(inspectBookDocuments(root).问题.some(issue => issue.说明.includes('链接无效'))).toBe(true)
  })

  it('checks worldbook lifecycle fields and unmatched fences without inferring relation meaning', () => {
    initialize()
    const op = prepareEntry(root, '人物关系', '同行', { 类型: '关系', 性质: '计划', 状态: '暂定', 来源: '对谈共创', 正文: '# 同行\n具体方向留白。' })
    put(op.relPath, op.content)
    expect(inspectBookDocuments(root).结论).toBe('未发现已知问题')
    put(op.relPath, op.content + '\n```\n隐藏的事实标题\n')
    expect(inspectBookDocuments(root).问题.some(issue => issue.说明.includes('围栏未闭合'))).toBe(true)
  })

  it('compares package hashes against original BOM bytes and checks output/artifact consistency', () => {
    preparedChapter()
    const dir = paths.待定稿包目录(1, key.章名), manifestPath = `${dir}/清单.json`
    const bodyPath = `${dir}/正文.md`, content = `\uFEFF${fs.readFileSync(path.join(root, bodyPath), 'utf8')}`
    put(bodyPath, content)
    const manifest = JSON.parse(fs.readFileSync(path.join(root, manifestPath), 'utf8'))
    manifest.工件.find((item: { 名: string }) => item.名 === '正文.md').sha256 = hash(content)
    manifest.文件.find((item: { 源: string }) => item.源 === '正文.md').sha256 = hash(content)
    put(manifestPath, JSON.stringify(manifest))
    expect(inspectBookDocuments(root).结论).toBe('未发现已知问题')
    manifest.文件[0].sha256 = 'f'.repeat(64)
    put(manifestPath, JSON.stringify(manifest))
    expect(inspectBookDocuments(root).问题.some(issue => issue.说明.includes('输出哈希'))).toBe(true)
  })

  it('retains BOM in supplement attachment and source freshness hashes', () => {
    preparedChapter()
    const materials = computeMaterials(root, key)
    for (const op of materials.文件!) put(op.relPath, op.content)
    const dir = paths.材料包目录(1, key.章名), manifestPath = `${dir}/材料清单.json`
    const sourcePath = '世界书/人物档案/林舟.md', source = `\uFEFF${fs.readFileSync(path.join(root, sourcePath), 'utf8')}`
    const content = '\uFEFF原始摘录。\r\n'
    put(sourcePath, source); put(`${dir}/补充/bom.md`, content)
    const manifest = JSON.parse(fs.readFileSync(path.join(root, manifestPath), 'utf8'))
    manifest.补充协议 = 1
    manifest.段.push({ 类型: '补充', 编号: 'bom', 文件: '补充/bom.md', 性质: '原文', 内容哈希: hash(content), 适用章上限: 1, 来源快照: { 域: '本书', 路径: sourcePath, 读取哈希: hash(source), 起行: 1, 终行: 2 }, 段: '人物摘录', 来源: [sourcePath], 版本: hash(source), 选用原因: '核对原文', 完整性: '完整', 字数: Array.from(content).length })
    put(manifestPath, JSON.stringify(manifest))
    const before = snapshot(), result = inspectBookDocuments(root)
    expect(result.结论, JSON.stringify(result.问题)).toBe('未发现已知问题')
    expect(snapshot()).toEqual(before)
  })

  it('does not remove BOM to rescue a machine protocol that disallows it', () => {
    initialize(); put('草稿区/审核/卷01-渡口.json', '\uFEFF{"schemaVersion":1,"完成":false,"问题":[],"模块":{}}')
    expect(inspectBookDocuments(root).问题.some(issue => issue.说明.includes('JSON'))).toBe(true)
  })

  it('reports only the actual checks for plain-text staging and mixed Markdown protocols', () => {
    initialize()
    const staging = `${paths.草稿目录(1, key.章名)}/稿1.起草中.txt`
    const supplement = `${paths.材料包目录(1, key.章名)}/补充/orphan.md`
    const prepared = `${paths.待定稿包目录(1, key.章名)}/章摘要.md`
    put(staging, '---\n尚未写完的YAML也可以是起草原文。')
    put(supplement, '未登记的摘录。'); put(prepared, '# 章摘要\n原文。')
    const result = inspectBookDocuments(root)
    expect(result.受检范围.find(item => item.路径 === staging)?.检查).toEqual(['UTF-8原文读取', '起草中暂存路径形状'])
    expect(result.受检范围.find(item => item.路径 === supplement)?.检查.join('')).not.toContain('哈希')
    expect(result.受检范围.find(item => item.路径 === prepared)?.检查.join('')).not.toContain('JSON')
    expect(result.未检范围.map(item => item.路径)).toEqual(expect.arrayContaining([supplement, prepared]))
    expect(result.结论).toBe('未支持')
  })

  it.each([
    ['版本: 1\n', 'unversioned', '需升级'],
    ['书仓格式版本: 2\n', 'unsupported-version', '未支持'],
    ['书仓格式版本: "1"\n', 'invalid-format', '需处理'],
    ['书仓格式版本: null\n', 'invalid-format', '需处理'],
  ])('distinguishes format identity %s without silently updating', (field, kind, conclusion) => {
    initialize(); put(paths.契约(), `---\n书id: inspection-book\n${field}---\n# 契约\n`)
    const before = snapshot(), result = inspectBookDocuments(root)
    expect(result.书仓格式).toMatchObject({ ok: false, kind })
    expect(result.结论).toBe(conclusion)
    expect(snapshot()).toEqual(before)
  })

  it('preserves BOM and noncanonical author bytes on read', () => {
    initialize()
    const contract = fs.readFileSync(path.join(root, paths.契约()), 'utf8')
    put(paths.契约(), `\uFEFF${contract.replace(/\n/g, '\r\n')}`)
    const before = snapshot(), result = inspectBookDocuments(root)
    expect(result.书仓格式).toEqual({ ok: true, version: 1 })
    expect(snapshot()).toEqual(before)
  })

  it('does not treat current-format marker as a proof of healthy files', () => {
    initialize(); put('世界书/人物档案/损坏.md', '---\n类型: [\n---\n正文\n')
    const result = inspectBookDocuments(root)
    expect(result.书仓格式).toEqual({ ok: true, version: 1 })
    expect(result.结论).toBe('需处理')
    expect(result.问题.some(issue => issue.路径.endsWith('损坏.md'))).toBe(true)
  })

  it('reports all malformed files while retaining successfully inspected paths', () => {
    initialize(); put('本书记忆/坏甲.md', '---\n类: 7\n---\n正文\n'); put('本书记忆/坏乙.md', '---\n类: [\n---\n正文\n')
    const result = inspectBookDocuments(root)
    expect(result.问题.map(issue => issue.路径)).toEqual(expect.arrayContaining(['本书记忆/坏甲.md', '本书记忆/坏乙.md']))
    expect(result.受检范围).toEqual(expect.arrayContaining([expect.objectContaining({ 路径: paths.故事骨架(), 结果: '已检查' })]))
  })

  it('reports missing required files separately from optional absent chapters', () => {
    initialize(); fs.unlinkSync(path.join(root, paths.故事骨架()))
    const result = inspectBookDocuments(root)
    expect(result.问题).toEqual(expect.arrayContaining([expect.objectContaining({ 路径: paths.故事骨架(), 代码: 'REQUIRED_MISSING' })]))
    expect(result.问题.some(issue => issue.路径.includes('章摘要'))).toBe(false)
  })

  it('does not turn unsupported protocols or unread SQLite into success', () => {
    initialize(); put('草稿区/批次/演示/批次.json', '{"schemaVersion":1}')
    put('.webnovel/finalized-search.sqlite', Buffer.from([0, 255, 1]))
    const before = snapshot(), result = inspectBookDocuments(root)
    expect(result.结论).toBe('未支持')
    expect(result.状态).toBe('部分失败')
    expect(result.未检范围.map(item => item.文档类型[0])).toEqual(expect.arrayContaining(['I27', 'I32']))
    expect(snapshot()).toEqual(before)
  })

  it('validates independent index and scene protocols without opening SQLite', () => {
    initialize(); put(INDEX_STATE_PATH, JSON.stringify(emptyIndexState()))
    put(SCENE_CACHE_PATH, JSON.stringify({ schema: 1, records: { ['a'.repeat(64)]: { rule: SCENE_RULE_VERSION, paragraphs: 1, ends: [1], model: 'fixture', status: 'ready' } } }))
    const partial = inspectBookDocuments(root)
    expect(partial.状态).toBe('部分失败')
    expect(partial.未检范围).toEqual(expect.arrayContaining([expect.objectContaining({ 路径: SCENE_CACHE_PATH, 文档类型: ['I33'] })]))
    expect(partial.受检范围.find(item => item.路径 === SCENE_CACHE_PATH)?.结果).toBe('部分检查')
    expect(partial.问题).toEqual([])
    put(INDEX_STATE_PATH, JSON.stringify({ ...emptyIndexState(), generation: -1 }))
    expect(inspectBookDocuments(root).问题.some(issue => issue.路径 === INDEX_STATE_PATH)).toBe(true)
    put(SCENE_CACHE_PATH, JSON.stringify({ schema: 1, records: { ['a'.repeat(64)]: { rule: SCENE_RULE_VERSION, paragraphs: 2, ends: [1], model: 'fixture', status: 'ready' } } }))
    expect(inspectBookDocuments(root).问题.some(issue => issue.路径 === SCENE_CACHE_PATH)).toBe(true)
  })

  it('validates receipt schema/checksum without demanding unchanged historical shared outputs', () => {
    const receiptPath = archivedFixture()
    const first = inspectBookDocuments(root)
    expect(first.结论, JSON.stringify(first.问题)).toBe('未发现已知问题')
    expect(first.受检范围.find(item => item.路径 === receiptPath)?.结果).toBe('已检查')
    const current = fs.readFileSync(path.join(root, '账本/故事线.md'), 'utf8')
    put('账本/故事线.md', current + '\n后续章节补充记录。\n')
    fixtureGit('add', '账本/故事线.md'); fixtureGit('commit', '--quiet', '-m', 'ch: 后续章节')
    const before = snapshot(), later = inspectBookDocuments(root)
    expect(later.结论, JSON.stringify(later.问题)).toBe('未发现已知问题')
    expect(snapshot()).toEqual(before)
    const receipt = fs.readFileSync(path.join(root, receiptPath), 'utf8')
    put(receiptPath, receipt.replace('"checksum":"', '"checksum":"0'))
    expect(inspectBookDocuments(root).问题.some(issue => issue.路径 === receiptPath)).toBe(true)
  })

  it('reports real written-but-uncommitted archive output without retrying its commit', () => {
    const receiptPath = archivedFixture(true)
    const before = snapshot(), result = inspectBookDocuments(root)
    expect(result.结论, JSON.stringify(result.问题)).toBe('需处理')
    expect(result.问题).toEqual(expect.arrayContaining([expect.objectContaining({ 代码: 'RECEIPT_PENDING_COMMIT', 路径: receiptPath })]))
    expect(result.受检范围.find(item => item.路径 === receiptPath)?.结果).toBe('失败')
    expect(snapshot()).toEqual(before)
  })

  it('reports missing Git history as an unchecked receipt facet', () => {
    initialize()
    const receipt = { schema: 1 as const, scope: 'a'.repeat(64), request: 'b'.repeat(64), mode: 'ch' as const, message: 'ch: fixture', baseHead: null, outputs: [{ relPath: '账本/故事线.md', sha256: hash('# 故事线\n'), gitBlob: 'c'.repeat(40) }] }
    const saved = archiveReceiptOp(receipt); put(saved.relPath, saved.content)
    const before = snapshot(), result = inspectBookDocuments(root)
    expect(result.结论).toBe('无法核实')
    expect(result.未检范围).toEqual(expect.arrayContaining([expect.objectContaining({ 路径: saved.relPath, 文档类型: ['I30'] })]))
    expect(result.受检范围.find(item => item.路径 === saved.relPath)?.结果).toBe('部分检查')
    expect(snapshot()).toEqual(before)
  })

  it('reports a receipt whose base commit is absent from the current history as unknown', () => {
    const receiptPath = archivedFixture()
    const envelope = JSON.parse(fs.readFileSync(path.join(root, receiptPath), 'utf8'))
    envelope.receipt.baseHead = 'f'.repeat(40)
    envelope.checksum = hash(JSON.stringify(envelope.receipt))
    put(receiptPath, JSON.stringify(envelope))
    const result = inspectBookDocuments(root)
    expect(result.结论).toBe('无法核实')
    expect(result.问题.some(issue => issue.代码 === 'RECEIPT_HISTORY_UNKNOWN')).toBe(true)
    expect(result.未检范围.some(item => item.路径 === receiptPath)).toBe(true)
  })

  it('detects Git changes between historical proof and final snapshot recheck', () => {
    const receiptPath = archivedFixture()
    const original = childProcess.spawnSync.bind(childProcess)
    let changed = false
    vi.spyOn(childProcess, 'spawnSync').mockImplementation(((command: string, args: readonly string[], options: unknown) => {
      const result = original(command, args, options as undefined)
      if (!changed && command === 'git' && args.includes('rev-list')) {
        changed = true
        fixtureGit('commit', '--allow-empty', '--quiet', '-m', 'fixture concurrent commit')
      }
      return result
    }) as typeof childProcess.spawnSync)
    syncBuiltinESMExports()
    const result = inspectBookDocuments(root)
    expect(changed).toBe(true)
    expect(result.结论).toBe('无法核实')
    expect(result.快照).toMatchObject({ 稳定: false, 变更: expect.arrayContaining(['.git']) })
    expect(result.受检范围.find(item => item.路径 === receiptPath)?.结果).toBe('部分检查')
  })

  it('keeps Git query failure distinct from an uncommitted receipt', () => {
    const receiptPath = archivedFixture()
    const original = childProcess.spawnSync.bind(childProcess)
    vi.spyOn(childProcess, 'spawnSync').mockImplementation(((command: string, args: readonly string[], options: unknown) => {
      if (command === 'git' && args.includes('rev-list')) return { status: 1, stdout: '', stderr: 'fixture history read failure' }
      return original(command, args, options as undefined)
    }) as typeof childProcess.spawnSync)
    syncBuiltinESMExports()
    const result = inspectBookDocuments(root)
    expect(result.结论).toBe('无法核实')
    expect(result.问题.some(issue => issue.代码 === 'RECEIPT_HISTORY_UNKNOWN')).toBe(true)
    expect(result.问题.some(issue => issue.代码 === 'RECEIPT_PENDING_COMMIT')).toBe(false)
    expect(result.未检范围.some(item => item.路径 === receiptPath)).toBe(true)
  })

  it('uses only readonly Git queries and leaves native metadata unchanged during receipt inspection', () => {
    archivedFixture()
    const before = snapshot(), original = childProcess.spawnSync.bind(childProcess)
    const seen: string[][] = []
    vi.spyOn(childProcess, 'spawnSync').mockImplementation(((command: string, args: readonly string[], options: unknown) => {
      if (command === 'git') {
        seen.push([...args])
        expect(args).toContain('--no-optional-locks')
        expect(args).toContain('core.fsmonitor=false')
        expect(args.some(value => ['add', 'commit', 'init', 'reset', 'checkout', 'clean', 'gc', 'repack'].includes(value))).toBe(false)
      }
      return original(command, args, options as undefined)
    }) as typeof childProcess.spawnSync)
    for (const name of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'renameSync', 'unlinkSync'] as const) vi.spyOn(fs, name).mockImplementation(() => { throw new Error(`unexpected ${name}`) })
    syncBuiltinESMExports()
    const result = inspectBookDocuments(root)
    expect(result.结论, JSON.stringify(result.问题)).toBe('未发现已知问题')
    expect(seen.some(args => args.includes('rev-list'))).toBe(true)
    vi.restoreAllMocks(); syncBuiltinESMExports()
    expect(snapshot()).toEqual(before)
  })

  it('does not inspect Git when no archive receipt is present', () => {
    initialize(true)
    const spy = vi.spyOn(childProcess, 'spawnSync')
    syncBuiltinESMExports()
    expect(inspectBookDocuments(root).结论).toBe('未发现已知问题')
    expect(spy).not.toHaveBeenCalled()
  })

  it('retains unreferenced old scene cache records while reporting the unverified source/freshness facet', () => {
    initialize()
    put(SCENE_CACHE_PATH, JSON.stringify({ schema: 1, records: { ['a'.repeat(64)]: { rule: 'historical-rule', paragraphs: 1, ends: [1], model: 'fixture-old', status: 'ready' } } }))
    const before = snapshot(), result = inspectBookDocuments(root)
    expect(result.状态).toBe('部分失败')
    expect(result.结论).not.toBe('未发现已知问题')
    expect(result.问题).toEqual([])
    expect(result.未检范围).toEqual(expect.arrayContaining([expect.objectContaining({ 路径: SCENE_CACHE_PATH, 原因: expect.stringContaining('当前定稿来源与缓存新鲜度未核实') })]))
    expect(result.受检范围.find(item => item.路径 === SCENE_CACHE_PATH)?.结果).toBe('部分检查')
    expect(snapshot()).toEqual(before)
  })

  it('never restores or removes pending runtime artifacts', () => {
    initialize(); put('.webnovel/transactions/pending/manifest.json', '{"phase":"committed"}'); put('.webnovel/writer.lock/owner.json', '{}')
    const before = snapshot(), result = inspectBookDocuments(root)
    expect(result.问题.filter(issue => issue.代码 === 'RUNTIME_PENDING')).toHaveLength(2)
    expect(snapshot()).toEqual(before)
  })

  it('detects invalid UTF8 and IO errors instead of treating them as missing', () => {
    initialize(); put('本书记忆/乱码.md', Buffer.from([0xc3, 0x28]))
    const result = inspectBookDocuments(root)
    expect(result.结论).toBe('无法核实')
    expect(result.问题).toEqual(expect.arrayContaining([expect.objectContaining({ 路径: '本书记忆/乱码.md', 代码: 'READ_FAILED' })]))
  })

  it('reports unreadable directories rather than silently treating them as empty', () => {
    initialize()
    const original = fs.readdirSync.bind(fs)
    vi.spyOn(fs, 'readdirSync').mockImplementation(((target: fs.PathLike, options?: unknown) => {
      if (String(target) === path.join(root, '世界书')) throw Object.assign(new Error('fixture denied'), { code: 'EACCES' })
      return original(target, options as undefined)
    }) as typeof fs.readdirSync)
    syncBuiltinESMExports()
    const result = inspectBookDocuments(root)
    expect(result.结论).toBe('无法核实')
    expect(result.问题).toEqual(expect.arrayContaining([expect.objectContaining({ 路径: '世界书', 代码: 'READ_FAILED' })]))
  })

  it('rejects file and directory links without following their targets', () => {
    initialize()
    const outside = fs.mkdtempSync(path.join(temp, 'maintenance-inspection-external-')); extra.push(outside)
    fs.writeFileSync(path.join(outside, 'secret.md'), '外部文件。')
    fs.symlinkSync(outside, path.join(root, '世界书', '外部'), process.platform === 'win32' ? 'junction' : 'dir')
    const result = inspectBookDocuments(root)
    expect(result.结论).toBe('无法核实')
    expect(result.问题.some(issue => issue.路径 === '世界书/外部')).toBe(true)
    expect(result.受检范围.some(item => item.路径.includes('secret.md'))).toBe(false)
    fs.unlinkSync(path.join(root, '世界书', '外部'))
  })

  it('detects a file changing while the inspection reads other files', () => {
    initialize()
    const read = fs.readFileSync.bind(fs)
    let changed = false
    vi.spyOn(fs, 'readFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, options?: unknown) => {
      const result = read(file, options as BufferEncoding)
      if (!changed && typeof file === 'number') { changed = true; fs.appendFileSync(path.join(root, paths.契约()), '\n新增内容。\n') }
      return result
    }) as typeof fs.readFileSync)
    syncBuiltinESMExports()
    const result = inspectBookDocuments(root)
    expect(result.快照.稳定).toBe(false)
    expect(result.结论).toBe('无法核实')
  })
})

describe('shared optimistic read set', () => {
  it('tracks missing-to-present files and directory member changes', () => {
    const reader = createReadonlyBookSnapshot(root)
    expect(reader.readFile('新文件.md')).toBeUndefined()
    expect(reader.listDirectory('')).toEqual([])
    put('新文件.md', '新增。')
    const result = reader.finish()
    expect(result.稳定).toBe(false)
    expect(result.变更).toEqual(expect.arrayContaining(['.', '新文件.md']))
  })

  it.each(['../escape.md', 'C:\\escape.md', '/escape.md', 'a/../b.md', 'a//b.md'])('rejects unsafe path %s', relative => {
    const reader = createReadonlyBookSnapshot(root)
    expect(reader.readFile(relative)).toBeUndefined()
    expect(reader.issues).toHaveLength(1)
    expect(reader.finish().稳定).toBe(false)
  })

  it('keeps leading BOM text and raw bytes stable', () => {
    put('bom.md', '\uFEFF正文\r\n')
    const reader = createReadonlyBookSnapshot(root)
    expect(reader.readFile('bom.md')).toBe('\uFEFF正文\r\n')
    expect(reader.finish().稳定).toBe(true)
  })
})
