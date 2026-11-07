import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  archiveChapter,
  confirmOutline,
  parseDocument,
  serializeDocument,
  paths,
  preparePack,
  planSettlement,
  seedMinDesign,
  writeCandidate,
  writeBookMemory,
} from '../src/index'

const roots: string[] = []
function mkDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(dir)
  return dir
}
afterAll(() => { for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

function initGit(root: string): void {
  expect(spawnSync('git', ['init'], { cwd: root, windowsHide: true }).status).toBe(0)
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, windowsHide: true })
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: root, windowsHide: true })
  spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: root, windowsHide: true })
}

const key = { 卷: 1, 章: 1, 章名: '开篇任务' } as const
const HARD = '开场必须点名主角现身'
const PKG = '草稿区/定稿准备/卷01-开篇任务'

function confirmWithHard(root: string): void {
  seedMinDesign(root)
  for (const name of ['故事线', '人物弧线', '承诺', '线索', '时间线'] as const) {
    fs.mkdirSync(path.join(root, '账本'), { recursive: true })
    fs.writeFileSync(path.join(root, paths.账本(name)), `# ${name}\n`, 'utf-8')
  }
  const body = [
    '# 章细纲', '', '## 定位段', '', '### 来源窗口项及拆并关系', '开篇任务，单章承接', '',
    '### 章节功能', '', `- 〔硬〕${HARD}`, '',
    '### 视角与焦点', '主角视角', '',
    '### 时空锚定', '城门口，清晨', '',
    '### 起止边界', '从抵达城门到发现异状', '',
    '### 故事线与承诺分配', '推进主线承诺', '',
    '### 信息边界', '只披露主角所见', '',
    '### 情绪与节奏目标', '紧张后留钩子', '',
    '### 前置条件核对结果', '已核对来源与窗口，前置设定均非留白', '',
    '## 细纲段', '', '### 单元 1', '',
    '- 目标: 开场', '- 人物: 主角', '- 时空: 城门口', '- 行动/冲突: 盘问与发现', '- 信息披露: 异常线索', '- 状态变化: 从平静到警觉', '',
  ].join('\n')
  writeCandidate(root, { 卷: 1, 章: 1, 章名: key.章名, 来源引用: ['作品契约/契约.md@1'], body })
  const r = confirmOutline(root, key)
  if (!r.ok) throw new Error(`confirm failed:${r.gaps.join(';')}`)
  fs.mkdirSync(path.join(root, `草稿区/草稿/卷01-${key.章名}`), { recursive: true })
  fs.writeFileSync(
    path.join(root, `草稿区/草稿/卷01-${key.章名}/稿1.md`),
    `---\n角色: 待审稿\n选定: true\n版本: 1\n父版本: null\n生成模块: 写稿\n---\n巷口风大。${HARD}。\n`,
    'utf-8',
  )
}

const 账本候选 = [
  '# 账本变更',
  '## 故事线', '### 主线启动', '状态：进行中', '计划来源：卷纲#1',
  '## 线索', '### 纸鹤', '状态：已埋', '计划来源：卷纲#4', '埋设点：第1章', '预期兑现区间：第8-12章',
  '',
].join('\n')
const 时间线候选 = '# 时间线变更\n\n## 城门异响\n事件：发现异常\n'
const 记忆候选 = '# 本书层记忆候选\n\n## 文风\n### 克制叙述\n状态：候选\n描述：短句与克制旁白\n短句，少用解释性旁白。例：他没有回头。\n描述：这是正文中的举例，不是目录摘要。\n'
const 章摘要候选 = '主角在城门盘问中发现异状。章末状态：主角在城门，正要进城，异响未解。'

describe('沉淀候选经 novel_prepare_pack 预校验(A2)', () => {
  it('记忆更新明确提供旧文，准备后改变目标则拒绝沉淀', () => {
    const root = mkDir('webnovel-memory-pack-')
    confirmWithHard(root)
    expect(writeBookMemory(root, { 名称: '克制叙述', 类: '文风', 描述: '旧规则', 正文: '少解释。', 来源: '对谈', 裁决记录: '确认' }).ok).toBe(true)
    const file = path.join(root, '本书记忆/克制叙述.md'), original = fs.readFileSync(file, 'utf8')
    const candidate = '## 文风\n### 克制叙述\n操作：更新\n状态：候选\n描述：保留规则并补充例外\n少解释，但关键因果可以说明。\n'
    expect(preparePack(root, key, { 记忆候选: candidate })).toMatchObject({ ok: false, reason: expect.stringContaining('完整原文') })
    expect(preparePack(root, key, { 记忆候选: candidate, 记忆原文: { 克制叙述: original } }).ok).toBe(true)
    const plan = () => planSettlement(root, path.join(root, PKG), { 章节: key, 批准: true, 裁决记录: '批准' }, key)
    const result = plan()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const updatedMemory = parseDocument(result.ops.find(op => op.relPath === '本书记忆/克制叙述.md')!.content)
    expect(updatedMemory.ok && updatedMemory.data.fields['描述']).toBe('保留规则并补充例外')
    expect(result.ops.find(op => op.relPath === '本书记忆/克制叙述.md')?.content).toContain('少解释，但关键因果可以说明')
    expect(result.ops.find(op => op.relPath === '本书记忆/克制叙述.md')?.content).not.toContain('操作：更新')
    fs.appendFileSync(file, '\n作者后来补充的条件。\n')
    expect(plan()).toMatchObject({ ok: false, reason: expect.stringContaining('原文已变化') })
    expect(fs.readFileSync(file, 'utf8')).toContain('作者后来补充的条件')
    expect(preparePack(root, key, { 记忆候选: candidate, 记忆原文: { 克制叙述: original } })).toMatchObject({ ok: false })
  })
  it('缺 计划来源 的账本变更 → ok:false 且 reason 含解析器原话,包目录无变化', () => {
    const root = mkDir('webnovel-cand-a2-')
    confirmWithHard(root)
    const r = preparePack(root, key, {
      账本变更: '# 账本变更\n\n## 线索\n### 纸鹤\n状态：已埋\n埋设点：第1章\n预期兑现区间：第8-12章\n',
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/计划来源/)
    expect(fs.existsSync(path.join(root, PKG))).toBe(false)
  })

  it('线索字段写在说明之后 → 组包拒绝,包目录无变化', () => {
    const root = mkDir('webnovel-cand-clue-')
    confirmWithHard(root)
    const r = preparePack(root, key, {
      账本变更: '# 账本变更\n\n## 线索\n### 纸鹤\n状态：已埋\n计划来源：卷纲#4\n纸鹤落在窗台。\n埋设点：第1章\n预期兑现区间：第8-12章\n',
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/埋设点不在条目开头/)
    expect(fs.existsSync(path.join(root, PKG))).toBe(false)
  })

  it.each([
    ['账本变更', '# 账本变更\n## 承诺\n### 保留记录\n状态：进行中\n计划来源：本章新增\n状态：已结束\n说明。\n', /状态.*重复/],
    ['时间线变更', '# 时间线变更\n## 进城\n时点：清晨\n这是引文：\n事件：甲进城。\n', /事件字段.*不在.*开头/],
  ])('非前置或重复字段在组包前拒绝：%s', (field, candidate, reason) => {
    const root = mkDir('webnovel-cand-fields-')
    confirmWithHard(root)
    const result = preparePack(root, key, { [field]: candidate })
    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(reason) })
    expect(fs.existsSync(path.join(root, PKG))).toBe(false)
  })

  it('无候选组包 → 四件占位,章摘要为占位而非首行(R4)', () => {
    const root = mkDir('webnovel-cand-none-')
    confirmWithHard(root)
    const r = preparePack(root, key)
    expect(r.ok).toBe(true)
    expect(fs.readFileSync(path.join(root, PKG, '章摘要.md'), 'utf-8')).toContain('（无摘要沉淀）')
    expect(fs.readFileSync(path.join(root, PKG, '账本变更.md'), 'utf-8')).toContain('（无账本变更）')
    expect(fs.readFileSync(path.join(root, PKG, '时间线变更.md'), 'utf-8')).toContain('（无时间线变更）')
    expect(fs.readFileSync(path.join(root, PKG, '事实变更.md'), 'utf-8')).toContain('（无事实变更）')
    expect(fs.readFileSync(path.join(root, PKG, '本书层记忆候选.md'), 'utf-8')).toContain('（无记忆候选）')
    expect(fs.readFileSync(path.join(root, PKG, '章摘要.md'), 'utf-8')).not.toContain('巷口风大')
  })
})

describe('合法候选入档后的真源沉淀(A3/A4)', () => {
  it('账本新增条目、时间线新增事件、章摘要为候选内容(A3)', () => {
    const root = mkDir('webnovel-cand-a3-')
    initGit(root)
    confirmWithHard(root)
    const r = preparePack(root, key, {
      时间线变更: 时间线候选,
      账本变更: 账本候选,
      记忆候选,
      章摘要: 章摘要候选,
    })
    expect(r.ok).toBe(true)
    const archived = archiveChapter({
      bookRoot: root,
      packageDir: PKG,
      summary: '开篇任务入档',
      settlement: { 章节: key, 批准: true, 裁决记录: '作者批准首章沉淀' },
    })
    expect(archived.ok).toBe(true)
    expect(fs.readFileSync(path.join(root, paths.账本('故事线')), 'utf-8')).toContain('主线启动')
    expect(fs.readFileSync(path.join(root, paths.账本('线索')), 'utf-8')).toContain('纸鹤')
    expect(fs.readFileSync(path.join(root, paths.账本('时间线')), 'utf-8')).toContain('城门异响')
    const 摘要 = fs.readFileSync(path.join(root, paths.章摘要(1, 1, key.章名)), 'utf-8')
    expect(摘要).toContain(章摘要候选)
    expect(摘要).not.toContain('巷口风大')
    // 本书记忆一事一文件
    expect(fs.existsSync(path.join(root, '本书记忆/克制叙述.md'))).toBe(true)
    expect(fs.readFileSync(path.join(root, '本书记忆/索引.md'), 'utf-8')).toContain('[克制叙述]')
    const memoryDoc = parseDocument(fs.readFileSync(path.join(root, '本书记忆/克制叙述.md'), 'utf8'))
    expect(memoryDoc.ok && memoryDoc.data.fields['描述']).toBe('短句与克制旁白')
    expect(memoryDoc.ok && memoryDoc.data.body).toContain('描述：这是正文中的举例')
  })

  it('事实变更:既有条目末尾追加且原正文逐字保留,新条目新建(A4)', () => {
    const root = mkDir('webnovel-cand-a4-')
    initGit(root)
    confirmWithHard(root)
    const existingRel = path.join(root, '世界书', '人物档案', '主角.md')
    const before = fs.readFileSync(existingRel, 'utf-8')
    const r = preparePack(root, key, {
      事实变更: '# 事实变更\n\n## 人物档案\n### 主角\n主角拔出了祖传断剑，剑身裂纹可见。\n\n### 新人\n守门老兵之子首次登场。\n',
    })
    expect(r.ok).toBe(true)
    const archived = archiveChapter({
      bookRoot: root,
      packageDir: PKG,
      summary: '开篇任务入档',
      settlement: { 章节: key, 批准: true, 裁决记录: '作者批准首章沉淀' },
    })
    expect(archived.ok).toBe(true)
    const after = fs.readFileSync(existingRel, 'utf-8')
    expect(after).toContain('### 事实@第0001章')
    expect(after).toContain('祖传断剑')
    // 只增不改:正文逐字保留,frontmatter 字段不变仅版本+1
    const beforeDoc = parseDocument(before)
    const afterDoc = parseDocument(after)
    expect(beforeDoc.ok && afterDoc.ok).toBe(true)
    if (beforeDoc.ok && afterDoc.ok) {
      expect(afterDoc.data.body.startsWith(beforeDoc.data.body.replace(/\n+$/, ''))).toBe(true)
      expect(afterDoc.data.fields['性质']).toBe(beforeDoc.data.fields['性质'])
      expect(afterDoc.data.fields['状态']).toBe(beforeDoc.data.fields['状态'])
      expect(afterDoc.data.fields['来源']).toBe(beforeDoc.data.fields['来源'])
    }
    expect(fs.existsSync(path.join(root, '世界书', '人物档案', '新人.md'))).toBe(true)
    const 新人 = fs.readFileSync(path.join(root, '世界书', '人物档案', '新人.md'), 'utf-8')
    expect(新人).toContain('性质: 事实')
    expect(新人).toContain('已成事实')
  })

  it('世界书补偿整条更正既有正文，缺目标或无批准拒绝，规划保持只读', () => {
    const root = mkDir('webnovel-fact-correction-')
    confirmWithHard(root)
    const file = path.join(root, '世界书/人物档案/主角.md')
    const initial = parseDocument(fs.readFileSync(file, 'utf8'))
    if (!initial.ok) throw new Error(initial.detail)
    const before = serializeDocument({ ...initial.data.fields, 版本: 3 }, initial.data.body)
    fs.writeFileSync(file, before, 'utf8')
    const approval = { 章节: key, 批准: true, 裁决记录: '测试作者批准事实更正' }
    preparePack(root, key, { 事实变更: '# 事实变更\n## 人物档案\n### 主角\n本章炭钱尚未到账，并非没有炭钱制度。\n' })
    expect(planSettlement(root, path.join(root, PKG), undefined, key, '更正').ok).toBe(false)
    const plan = planSettlement(root, path.join(root, PKG), approval, key, '更正')
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.ops).toHaveLength(1)
      const doc = parseDocument(plan.ops[0]!.content)
      expect(doc.ok && doc.data.body.trim()).toBe('本章炭钱尚未到账，并非没有炭钱制度。')
      expect(doc.ok && doc.data.fields['生成模块']).toBe('吃书补偿')
      const old = parseDocument(before)
      expect(doc.ok && doc.data.fields['版本']).toBe(old.ok ? Number(old.data.fields['版本']) + 1 : null)
    }
    expect(fs.readFileSync(file, 'utf8')).toBe(before)
    preparePack(root, key, { 事实变更: '# 事实变更\n## 人物档案\n### 不存在的人\n不能用更正新增。\n' })
    const missing = planSettlement(root, path.join(root, PKG), approval, key, '更正')
    expect(missing.ok).toBe(false)
    expect(!missing.ok && missing.reason).toContain('更正目标条目不存在')
    expect(fs.existsSync(path.join(root, '世界书/人物档案/不存在的人.md'))).toBe(false)
  })

  it('未登记模块的事实变更 → 入档拒绝,无半成品(A4 后半)', () => {
    const root = mkDir('webnovel-cand-a4b-')
    confirmWithHard(root)
    const r = preparePack(root, key, {
      事实变更: '# 事实变更\n\n## 从未登记\n### 新律\n新增规则。\n',
    })
    expect(r.ok).toBe(true) // 组包不做模块存在性判定(归入档时 planSettlement)
    const archived = archiveChapter({
      bookRoot: root,
      packageDir: PKG,
      summary: '开篇任务入档',
      settlement: { 章节: key, 批准: true, 裁决记录: '作者批准首章沉淀' },
    })
    expect(archived.ok).toBe(false)
    if (!archived.ok) expect(archived.reason).toMatch(/不猜模块/)
    expect(fs.existsSync(path.join(root, '定稿/卷01/0001-开篇任务.md'))).toBe(false)
    expect(fs.existsSync(path.join(root, '世界书', '从未登记'))).toBe(false)
  })
})
