import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { planUpgradeRules } from '../src/maintenance/upgrade-rules'
import { parseDocument, serializeDocument } from '../src/repo/frontmatter'
import { parseMemoryIndexLinks } from '../src/repo/memory-index-links'
import { LEDGER_NAMES } from '../src/repo/paths'
import { queryLedger, queryMemory } from '../src/ledger'
import { listBookMemoryEntries } from '../src/memory/book'
import { parseWorldbookHistory } from '../src/design/worldbook-history'
import { removeSync } from '../src/repo/remove'

const fixtures = fileURLToPath(new URL('./fixtures/maintenance-upgrade/', import.meta.url))
const historical = (name: string): string => fs.readFileSync(path.join(fixtures, `historical-${name}.md`), 'utf8')
const fixtureRoots: string[] = []
afterEach(() => { for (const root of fixtureRoots.splice(0)) removeSync(root) })

function overlay(files: ReadonlyMap<string, string>): Map<string, string> {
  const result = planUpgradeRules(files)
  expect(result.issues).toEqual([])
  const target = new Map(files)
  for (const change of result.changes) target.set(change.relPath, change.after)
  return target
}

function saved(files: ReadonlyMap<string, string>): string {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'upgrade-rule-fixture-'))
  fixtureRoots.push(root)
  for (const [relative, text] of files) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
    fs.writeFileSync(path.join(root, relative), text)
  }
  return root
}

const currentMemory = (name: string, body = '保留原文。', kind = '决策'): string => serializeDocument({ 名称: name, 类: kind, 状态: '已确认', 来源: '原来源' }, body)
const memoryFiles = (text = historical('memory')): Map<string, string> => new Map([
  ['本书记忆/决策.md', text],
  ['本书记忆/索引.md', '# 本书记忆索引\r\n\r\n作者的自定义说明  \r\n- [决策](决策.md) — 原分类入口\r\n'],
])

describe('frozen historical migration input', () => {
  it('checks every saved historical source excerpt and actual serializer output against its evidence hash', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(fixtures, 'history-manifest.json'), 'utf8')) as {
      evidence: string; sourceManifest: { file: string; sha256: string; sourceBlob: string; sourceCommit: string }[]; outputs: { file: string; sha256: string }[]
    }
    expect(manifest.evidence).toContain('not a real book')
    for (const source of manifest.sourceManifest) {
      expect(source.sourceBlob).toMatch(/^[0-9a-f]{40}$/)
      expect(source.sourceCommit).toMatch(/^[0-9a-f]{40}$/)
    }
    for (const record of [...manifest.sourceManifest, ...manifest.outputs]) expect(createHash('sha256').update(fs.readFileSync(path.join(fixtures, record.file))).digest('hex')).toBe(record.sha256)
  })
})

describe('C1/C2 raw ledger field relocation', () => {
  it('moves historical producer output into strict fields with current ledger queries and no second change', () => {
    const source = new Map(LEDGER_NAMES.map(name => [`账本/${name}.md`, `# ${name}\n`]))
    source.set('账本/线索.md', historical('clue')); source.set('账本/时间线.md', historical('timeline'))
    const original = [...source], target = overlay(source)
    expect([...source]).toEqual(original)
    const clue = target.get('账本/线索.md')!, timeline = target.get('账本/时间线.md')!
    expect(clue.indexOf('埋设点：第0003章')).toBeLessThan(clue.indexOf('### 正文'))
    expect(timeline.indexOf('事件：林舟')).toBeLessThan(timeline.indexOf('### 正文'))
    const root = saved(target)
    const queriedClue = queryLedger(root, { 分类: '线索' }), queriedTimeline = queryLedger(root, { 分类: '时间线' })
    expect(queriedClue.ok).toBe(true)
    expect(queriedClue.entries[0]).toMatchObject({ 名称: '渡口印记', 字段: { 埋设点: '第0003章', 预期兑现区间: '第4-8章' }, 正文: '石上留有半枚印记。' })
    expect(queriedTimeline.ok).toBe(true)
    expect(queriedTimeline.entries[0]).toMatchObject({ 名称: '渡口会面', 字段: { 事件: '林舟在渡口遇见摆渡人', 时点: '次日清晨' }, 正文: '两人相约第三次潮落后出发。' })
    expect(planUpgradeRules(target)).toEqual({ changes: [], issues: [] })
  })

  it('retains BOM, CRLF, whitespace, source metadata and ordinary/fenced homonymous prose exactly', () => {
    const base = historical('clue').replace('石上留有半枚印记。', '  石上留有半枚印记。  \n\n来源：这行是原文\n埋设点：这行也属于原文\n```text\n预期兑现区间：围栏例子\n```\n\n')
    const original = '\uFEFF' + base.replace(/\n/g, '\r\n')
    const result = planUpgradeRules(new Map([['账本/线索.md', original]]))
    expect(result.issues).toEqual([])
    const expected = original.replace('### 正文\r\n', '埋设点：第0003章\r\n预期兑现区间：第4-8章\r\n### 正文\r\n')
      .replace('### 正文\r\n埋设点：第0003章\r\n预期兑现区间：第4-8章\r\n', '### 正文\r\n')
    expect(result.changes[0]!.before).toBe(original)
    expect(result.changes[0]!.after).toBe(expected)
    expect(result.changes[0]!.evidence.join(' ')).toContain('UTF-8字节范围')
  })

  it.each(['时点：\n', ''])('maps only missing/empty timeline time to explicit unknown (%j)', replacement => {
    const original = historical('timeline').replace('时点：次日清晨\n', replacement)
    const result = planUpgradeRules(new Map([['账本/时间线.md', original]]))
    expect(result.issues).toEqual([])
    expect(result.changes[0]!.after).toContain('时点：未知\n### 正文')
    expect(result.changes[0]!.evidence.join(' ')).toContain('不推算日期')
  })

  it.each([
    ['duplicate value', (s: string) => s.replace('埋设点：第0003章', '埋设点：第0003章\n埋设点：第0003章')],
    ['conflicting value', (s: string) => s.replace('埋设点：第0003章', '埋设点：第0003章\n埋设点：第99章')],
    ['missing source', (s: string) => s.replace('来源：定稿/卷01/0003-渡口.md\n', '')],
    ['unknown header', (s: string) => s.replace('### 正文', '作者扩展：不能丢\n### 正文')],
    ['wrong title', (s: string) => s.replace('名称：渡口印记', '名称：别的印记')],
    ['wrong class', (s: string) => s.replace('类型：线索', '类型：故事线')],
    ['abandoned without reason', (s: string) => s.replace('状态：已埋', '状态：已弃')],
    ['prose before fields', (s: string) => s.replace('### 正文\n', '### 正文\n先写叙述。\n')],
    ['quoted prefix', (s: string) => s.replace('埋设点：', '> 埋设点：')],
    ['fenced prefix', (s: string) => s.replace('### 正文\n', '### 正文\n```text\n') + '\n```\n'],
    ['unclosed fence', (s: string) => s + '\n```text\n未闭合\n'],
    ['fenced entry heading', (s: string) => s + '\n```text\n## 不能误认的条目\n```\n'],
    ['file-level afterword', (s: string) => s + '\n# 后记\n这段不能塞进上一条。\n'],
  ])('refuses %s without preparing any source rewrite', (_label, alter) => {
    const original = alter(historical('clue')), files = new Map([['账本/线索.md', original]])
    const result = planUpgradeRules(files)
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.changes).toEqual([])
    expect(files.get('账本/线索.md')).toBe(original)
  })

  it('does not reinterpret current field-looking prose', () => {
    const migrated = overlay(new Map([['账本/线索.md', historical('clue')]])).get('账本/线索.md')!
    const current = migrated.replace('石上留有半枚印记。', '埋设点：故意出现的同名正文\n预期兑现区间：文学例子')
    expect(planUpgradeRules(new Map([['账本/线索.md', current]]))).toEqual({ changes: [], issues: [] })
  })

  it('does not infer an event from the heading', () => {
    const missing = historical('timeline').replace('事件：林舟在渡口遇见摆渡人\n', '')
    expect(planUpgradeRules(new Map([['账本/时间线.md', missing]])).changes).toEqual([])
    expect(planUpgradeRules(new Map([['账本/时间线.md', missing]])).issues[0]!.说明).toContain('事件')
  })
})

describe('C3 memory link representation', () => {
  it('canonicalizes the actual old index serializer output without changing its label or explanation', () => {
    const before = historical('index')
    const result = planUpgradeRules(new Map([['本书记忆/索引.md', before], ['本书记忆/%41.md', currentMemory('%41', '原文', '对话')]]))
    expect(result.issues).toEqual([])
    expect(result.changes[0]!.after).toBe(before.replace('](%41.md)', '](<./%2541.md>)'))
  })
  it('keeps bare percent identity literal and preserves custom labels/descriptions including a later link', () => {
    const original = '# 索引\r\n- [自定义标签](%41.md) — 作者说明 [引用](其他.md) 留作说明  \r\n'
    const files = new Map([['本书记忆/索引.md', original], ['本书记忆/%41.md', currentMemory('%41')], ['本书记忆/A.md', currentMemory('A')]])
    const result = planUpgradeRules(files)
    expect(result.issues).toEqual([])
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]!.after).toBe(original.replace('](%41.md)', '](<./%2541.md>)'))
    expect(parseMemoryIndexLinks(result.changes[0]!.after).filenames).toEqual(['%41.md'])
    expect(planUpgradeRules(overlay(files)).changes).toEqual([])
  })

  it.each(['开场 (夜)', 'A[旁白]', '尾括号)', '空 格', '进度#1', '记号`甲', '雪&雨'])('repairs a proven raw destination %s', name => {
    const original = `# 索引\n- [标签](${name}.md) — 作者备注\n`
    const target = overlay(new Map([['本书记忆/索引.md', original], [`本书记忆/${name}.md`, currentMemory(name)]]))
    const after = target.get('本书记忆/索引.md')!
    expect(after.startsWith('# 索引\n- [标签](<./')).toBe(true)
    expect(after.endsWith(' — 作者备注\n')).toBe(true)
    expect(parseMemoryIndexLinks(after).filenames).toEqual([`${name}.md`])
  })

  it.each([
    '- [歧义](foo.md) — other.md) — 备注\n',
    '- [坏编码](<./%ZZ.md>)\n',
    '- [逃逸](../别书.md)\n',
    '- [缺失](%41.md)\n',
    '```md\n- [代码](A 空.md)\n```\n',
  ])('refuses ambiguous, missing or non-index text %j', line => {
    const files = new Map([['本书记忆/索引.md', '# 索引\n' + line], ['本书记忆/A.md', currentMemory('A')], ['本书记忆/foo.md', currentMemory('foo')]])
    const result = planUpgradeRules(files)
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.changes).toEqual([])
  })

  it('keeps wiki-only rows and explicit canonical targets untouched', () => {
    const index = '# 索引\n- [[源材料]] — 保留\n- [百分号](<./%2541.md>) — 保留\n'
    const result = planUpgradeRules(new Map([['本书记忆/索引.md', index], ['本书记忆/%41.md', currentMemory('%41')]]))
    expect(result).toEqual({ changes: [], issues: [] })
  })
})

describe('C4 explicit historical retcon nature', () => {
  const source = '\uFEFF---\r\n名称: 林舟\r\n类型: 人物\r\n性质: "计划" # 原备注\r\n状态: 已确认\r\n来源: 对谈共创\r\n版本: 4\r\n父版本: 3\r\n生成模块: 吃书补偿\r\n作者扩展: [甲, 乙]\r\n---\r\n  已经更正的事实。  \r\n\r\n### 事实@第0008章\r\n来源：定稿/卷01/0008-归来.md\r\n追加的原文。  \r\n'
  it('corrects the actual historical factOps output while keeping its original content version', () => {
    const before = historical('worldbook'), result = planUpgradeRules(new Map([['世界书/人物档案/林舟.md', before]]))
    expect(result.issues).toEqual([])
    expect(result.changes[0]!.after).toBe(before.replace('性质: 计划', '性质: 事实'))
    const parsed = parseDocument(result.changes[0]!.after)
    expect(parsed.ok && parsed.data.fields).toMatchObject({ 版本: 4, 父版本: 3, 性质: '事实', 生成模块: '吃书补偿' })
  })
  it('changes only the located scalar with source, version, comments, extension and exact history bytes intact', () => {
    const result = planUpgradeRules(new Map([['世界书/人物档案/林舟.md', source]]))
    expect(result.issues).toEqual([])
    expect(result.changes[0]!.after).toBe(source.replace('性质: "计划"', '性质: "事实"'))
    const before = parseWorldbookHistory(source), after = parseWorldbookHistory(result.changes[0]!.after)
    expect(before.ok && after.ok && before.data.追加).toEqual(after.ok && after.data.追加)
    expect(planUpgradeRules(overlay(new Map([['世界书/人物档案/林舟.md', source]]))).changes).toEqual([])
  })
  it('does not infer a lost retcon marker from later facts', () => {
    const result = planUpgradeRules(new Map([['世界书/人物档案/林舟.md', source.replace('生成模块: 吃书补偿', '生成模块: 事实沉淀')]]))
    expect(result.changes).toEqual([])
  })
  it.each([
    (s: string) => s.replace('名称: 林舟', '名称: 张三'),
    (s: string) => s.replace('版本: 4', '版本: "4"'),
    (s: string) => s.replace('来源: 对谈共创\r\n', ''),
    (s: string) => s.replace('性质: "计划" # 原备注', '性质: 计划\r\n性质: 计划'),
    (s: string) => s + '```\r\n未闭合',
  ])('refuses invalid or unprovable historical fields', alter => {
    const text = alter(source), result = planUpgradeRules(new Map([['世界书/人物档案/林舟.md', text]]))
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.changes).toEqual([])
  })
})

describe('C5 narrow full-header memory split', () => {
  it('maps historical producer source into one current entry, preserves author index prose and has no duplicated current memory', () => {
    const source = memoryFiles(), target = overlay(source)
    expect(target.get('本书记忆/决策.md')).toBe('# 决策\n\n')
    const text = target.get('本书记忆/保留渡口视角.md')!, parsed = parseDocument(text)
    expect(parsed.ok && parsed.data.fields).toEqual({ 名称: '保留渡口视角', 类: '决策', 状态: '已确认', 来源: '定稿/卷01/0003-渡口.md', 裁决记录: '作者批准：历史夹具' })
    expect(text.slice(text.indexOf('\n---\n') + 5)).toBe(historical('memory').split('### 正文\n')[1])
    expect(target.get('本书记忆/索引.md')!.startsWith(source.get('本书记忆/索引.md')!.replace('[决策](决策.md)', '决策'))).toBe(true)
    const root = saved(target)
    const query = queryMemory(root)
    expect(query.ok).toBe(true)
    expect(query.entries).toHaveLength(1)
    expect(query.entries[0]).toMatchObject({ 名称: '保留渡口视角', 类: '决策', 字段: { 来源: '定稿/卷01/0003-渡口.md' } })
    expect(query.entries[0]).not.toHaveProperty('格式', '旧')
    expect(listBookMemoryEntries(root)).toHaveLength(1)
    expect(planUpgradeRules(target)).toEqual({ changes: [], issues: [] })
  })

  it('retains CRLF prose including blank lines, fenced metadata, trailing spaces and existing version fields', () => {
    const source = '\uFEFF' + historical('memory').replace('### 正文\n', '版本：5\n父版本：4\n描述：渡口保留约束\n### 正文\n\n').replace('保留摆渡人的观察，不提前写明他的来历。', '  保留原文。  \n```\n来源：文学例句\n```\n\n').replace(/\n/g, '\r\n')
    const result = planUpgradeRules(memoryFiles(source))
    expect(result.issues).toEqual([])
    const entry = result.changes.find(change => change.before === null)!.after
    expect(entry.slice(entry.indexOf('\r\n---\r\n') + 7)).toBe(source.split('### 正文\r\n')[1])
    const parsed = parseDocument(entry)
    expect(parsed.ok && parsed.data.fields).toMatchObject({ 版本: 5, 父版本: 4, 描述: '渡口保留约束' })
    expect(result.changes.find(change => change.relPath === '本书记忆/决策.md')!.after).toBe('\uFEFF# 决策\r\n\r\n')
  })

  it.each([
    ['missing source', (s: string) => s.replace('来源：定稿/卷01/0003-渡口.md\n', '')],
    ['missing decision', (s: string) => s.replace('裁决记录：作者批准：历史夹具\n', '')],
    ['duplicate state', (s: string) => s.replace('状态：已确认', '状态：已确认\n状态：已确认')],
    ['unknown extension', (s: string) => s.replace('### 正文', '作者扩展：不能丢\n### 正文')],
    ['unknown preface', (s: string) => s.replace('# 决策\n', '# 决策\n这些话属于整个分类。\n')],
    ['unknown afterword', (s: string) => s + '\n# 分类后记\n不能归到上一条\n'],
    ['file metadata', (s: string) => '---\n作者扩展: 保留\n---\n' + s],
    ['name history', (s: string) => s + s.slice(s.indexOf('## '))],
    ['normalized identity', (s: string) => s + s.slice(s.indexOf('## ')).replace('## 保留渡口视角', '## （保留渡口视角）')],
    ['invalid filename', (s: string) => s.replace('## 保留渡口视角', '## ../逃逸')],
    ['wrong class', (s: string) => s.replace('类：决策', '类：灵感')],
    ['empty content', (s: string) => s.replace('保留摆渡人的观察，不提前写明他的来历。', '   ')],
  ])('refuses %s with no partial category changes', (_label, alter) => {
    const files = memoryFiles(alter(historical('memory'))), result = planUpgradeRules(files)
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.changes).toEqual([])
  })

  it('rejects existing targets even if text matches and rejects cross-class/case-insensitive target collisions', () => {
    const existing = memoryFiles(); existing.set('本书记忆/保留渡口视角.md', currentMemory('保留渡口视角'))
    expect(planUpgradeRules(existing).changes).toEqual([])
    expect(planUpgradeRules(existing).issues.length).toBeGreaterThan(0)
    const crossing = memoryFiles(); crossing.set('本书记忆/灵感.md', historical('memory').replace('# 决策', '# 灵感').replace('类：决策', '类：灵感'))
    expect(planUpgradeRules(crossing).changes).toEqual([])
    expect(planUpgradeRules(crossing).issues.length).toBeGreaterThan(0)
    const casing = memoryFiles(historical('memory').replace('保留渡口视角', 'Draft')); casing.set('本书记忆/draft.md', currentMemory('draft', '旧文', '灵感'))
    expect(planUpgradeRules(casing).changes).toEqual([])
    expect(planUpgradeRules(casing).issues.length).toBeGreaterThan(0)
  })

  it('requires a valid existing index and does not discard or rebuild it', () => {
    const missing = memoryFiles(); missing.delete('本书记忆/索引.md')
    expect(planUpgradeRules(missing).changes).toEqual([])
    expect(planUpgradeRules(missing).issues[0]!.路径).toBe('本书记忆/索引.md')
    const broken = memoryFiles(); broken.set('本书记忆/索引.md', '# 自定义\n- [坏目标](../错误.md)\n')
    expect(planUpgradeRules(broken).changes).toEqual([])
    expect(broken.get('本书记忆/索引.md')).toBe('# 自定义\n- [坏目标](../错误.md)\n')
  })

  it('composes exact index repair and a category split in one original-before change', () => {
    const files = memoryFiles(); files.set('本书记忆/%41.md', currentMemory('%41', '另一条记录。', '对话'))
    const before = files.get('本书记忆/索引.md')! + '- [原标签](%41.md) — 原说明\r\n'; files.set('本书记忆/索引.md', before)
    const result = planUpgradeRules(files), index = result.changes.filter(change => change.relPath === '本书记忆/索引.md')
    expect(result.issues).toEqual([])
    expect(index).toHaveLength(1)
    expect(index[0]!.before).toBe(before)
    expect(index[0]!.rules).toEqual(['C3-v1', 'C5-v1'])
    expect(index[0]!.after).toContain('- [原标签](<./%2541.md>) — 原说明\r\n')
    expect(parseMemoryIndexLinks(index[0]!.after).filenames).toEqual(['%41.md', '保留渡口视角.md'])
  })
})
