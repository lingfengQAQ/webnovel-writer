import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { spawnSync } from 'node:child_process'
import {
  applyRevision,
  archiveChapter,
  assembleMaterials,
  confirmOutline,
  deriveChapterFacts,
  listChapterDrafts,
  preparePack,
  parseDocument,
  scanChapter,
  seedMinDesign,
  serializeDocument,
  paths,
  writeFileAtomic,
  writeCandidate,
} from '../src/index'
import { ingestFindings, planReview, registerDefaultChecks, resetChecks, runReview } from '@webnovel/review'
import { removeSync } from '../src/repo/remove'

const roots: string[] = []
function mkDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(dir)
  return dir
}
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

const key = { 卷: 1, 章: 1, 章名: '开篇任务' } as const
const refs = ['作品契约/契约.md@1', '世界书/人物档案/主角.md@1'] as const
const HARD = '开场必须点名主角现身'

function git(cwd: string, args: readonly string[]): ReturnType<typeof spawnSync> {
  return spawnSync('git', args, { cwd, encoding: 'utf-8', windowsHide: true })
}

function initRepo(): string {
  const root = mkDir('webnovel-prepare-')
  expect(git(root, ['init']).status).toBe(0)
  git(root, ['config', 'user.email', 'test@example.com'])
  git(root, ['config', 'user.name', 'test'])
  git(root, ['config', 'commit.gpgsign', 'false'])
  return root
}

function confirmWithHard(root: string): void {
  seedMinDesign(root)
  const body = [
    '# 章细纲',
    '',
    '## 定位段',
    '',
    '### 来源窗口项及拆并关系',
    '开篇任务，单章承接',
    '',
    '### 章节功能',
    '',
    `- 〔硬〕${HARD}`,
    '',
    '### 视角与焦点',
    '主角视角',
    '',
    '### 时空锚定',
    '城门口，清晨',
    '',
    '### 起止边界',
    '从抵达城门到发现异状',
    '',
    '### 故事线与承诺分配',
    '推进主线承诺',
    '',
    '### 信息边界',
    '只披露主角所见',
    '',
    '### 情绪与节奏目标',
    '紧张后留钩子',
    '',
    '### 前置条件核对结果',
    '已核对来源与窗口，前置设定均非留白',
    '',
    '## 细纲段',
    '',
    '### 单元 1',
    '',
    '- 目标: 开场',
    '- 人物: 主角',
    '- 时空: 城门口',
    '- 行动/冲突: 盘问与发现',
    '- 信息披露: 异常线索',
    '- 状态变化: 从平静到警觉',
    '',
  ].join('\n')
  writeCandidate(root, { 卷: 1, 章: 1, 章名: '开篇任务', 来源引用: refs, body })
  const r = confirmOutline(root, key)
  if (!r.ok) throw new Error(`confirm failed:${r.gaps.join(';')}`)
}

function putPending(root: string, body: string, file = '稿1.md'): void {
  const rel = `草稿区/草稿/卷01-开篇任务/${file}`
  fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true })
  // 真实草稿一定带版本协议(写稿/润色都会写),夹具照真实形状来
  fs.writeFileSync(
    path.join(root, rel),
    serializeDocument({ 角色: '待审稿', 选定: true, 版本: 1, 父版本: null, 生成模块: '写稿' }, body),
    'utf-8',
  )
}

describe('改稿最小 + 定稿准备', () => {
  it('applyRevision 产出新一版待审稿，原稿降级留档 → derive 定稿准备', () => {
    const root = mkDir('webnovel-revise-')
    confirmWithHard(root)
    assembleMaterials(root, key)
    putPending(root, `综上所述，${HARD}。`)
    resetChecks()
    registerDefaultChecks()
    const reviewed = runReview(root, key)
    const finding = reviewed.record?.问题.find((p) => p.问题说明.includes('综上所述'))
    expect(finding).toBeTruthy()
    const applied = applyRevision(root, key, {
      发现项编号: finding!.发现项编号,
      处置: '已解决',
      补丁: { old: '综上所述，', new: '' },
    })
    expect(applied.ok).toBe(true)
    expect(applied.relPath).toBe('草稿区/草稿/卷01-开篇任务/稿2.md')

    // 新稿带补丁,旧稿原样留档可追溯
    const 新稿 = fs.readFileSync(path.join(root, '草稿区/草稿/卷01-开篇任务/稿2.md'), 'utf-8')
    expect(新稿).not.toContain('综上所述')
    const 旧稿 = fs.readFileSync(path.join(root, '草稿区/草稿/卷01-开篇任务/稿1.md'), 'utf-8')
    expect(旧稿).toContain('综上所述')

    // 版本链与唯一性
    const drafts = listChapterDrafts(root, key)
    expect(drafts.filter((d) => d.角色 === '待审稿').map((d) => d.file)).toEqual(['稿2.md'])
    expect(drafts.filter((d) => d.选定).map((d) => d.file)).toEqual(['稿2.md'])
    const 新 = drafts.find((d) => d.file === '稿2.md')!
    expect(新.版本).toBe(2)
    const doc = parseDocument(新稿)
    expect(doc.ok && doc.data.fields['父版本']).toBe(1)
    // 回写其余隔离子 Agent 模块(空审 fail-closed:不回写不算完成)
    const after = runReview(root, key).record
    for (const [name, st] of Object.entries(after?.模块 ?? {})) {
      if (st.待回写 === true) expect(ingestFindings(root, key, name, [], after!.审读指纹).ok).toBe(true)
    }
    // F1:语义类硬约束产「需审读」发现项——按真实流程给处置(作者保留)后再推进
    const current = JSON.parse(fs.readFileSync(path.join(root, paths.审核记录(1, key.章名)), 'utf-8'))
    for (const q of current.问题) {
      if (q.处置状态 === '待处理') {
        const d = applyRevision(root, key, { 发现项编号: q.发现项编号, 处置: '作者保留' })
        expect(d.ok).toBe(true)
      }
    }
    expect(deriveChapterFacts(scanChapter(root, key)).建议.环节).toBe('定稿准备与沉淀')
  })

  it('applyRevision 不带补丁只记处置，不产生新稿', () => {
    const root = mkDir('webnovel-revise-nopatch-')
    confirmWithHard(root)
    assembleMaterials(root, key)
    putPending(root, `综上所述，${HARD}。`)
    resetChecks()
    registerDefaultChecks()
    const finding = runReview(root, key).record!.问题.find((p) => p.问题说明.includes('综上所述'))!
    const applied = applyRevision(root, key, { 发现项编号: finding.发现项编号, 处置: '作者保留' })
    expect(applied.ok).toBe(true)
    expect(applied.relPath).toBeUndefined()
    expect(listChapterDrafts(root, key).map((d) => d.file)).toEqual(['稿1.md'])
  })

  it('true-source 处置 → 须呈报上游', () => {
    const root = mkDir('webnovel-revise-up-')
    confirmWithHard(root)
    putPending(root, `${HARD}。`)
    resetChecks()
    registerDefaultChecks()
    runReview(root, key)
    const r = applyRevision(root, key, {
      发现项编号: '不存在',
      处置: '已解决',
      范围: '世界书/人物档案/主角.md',
    })
    expect(r).toEqual({ ok: false, reason: '须呈报上游' })
  })

  it('preparePack writes 8 files, 卷对账 contains 偏离 or 无偏离', () => {
    const root = mkDir('webnovel-pack-')
    confirmWithHard(root)
    putPending(root, `巷口风大。${HARD}。`)
    const r = preparePack(root, key)
    expect(r.ok).toBe(true)
    const dir = path.join(root, '草稿区/定稿准备/卷01-开篇任务')
    for (const f of ['清单.json', '正文.md', '事实变更.md', '时间线变更.md', '账本变更.md', '章摘要.md', '卷对账.md', '本书层记忆候选.md']) {
      expect(fs.existsSync(path.join(dir, f))).toBe(true)
    }
    const 对账 = fs.readFileSync(path.join(dir, '卷对账.md'), 'utf-8')
    expect(对账).toMatch(/无偏离|偏离/)
    const 清单 = fs.readFileSync(path.join(dir, '清单.json'), 'utf-8')
    expect(清单).not.toMatch(/"目标":"草稿区\//)
    expect(清单).toContain('定稿/卷01/0001-开篇任务.md')
    expect(清单).not.toContain('"源":"卷对账.md"')
    expect(deriveChapterFacts(scanChapter(root, key)).建议.环节).toBe('作者定稿裁决')
  })

  it('preparePack presents actual ledger reconciliation instead of hardcoded 无偏离', () => {
    const root = mkDir('webnovel-pack-reconcile-')
    confirmWithHard(root)
    for (const name of ['故事线', '人物弧线', '承诺', '线索']) {
      writeFileAtomic(root, paths.账本(name as '故事线' | '人物弧线' | '承诺' | '线索'), `# ${name}\n`)
    }
    writeFileAtomic(root, paths.账本('时间线'), '# 时间线\n\n## 临时发现\n事件：意外线索\n章号：第0001章\n')
    writeFileAtomic(root, paths.计划时间线(1), '# 计划时间线\n\n## 窗口覆盖\n- 计划事件〔已确认〕\n')
    putPending(root, `巷口风大。${HARD}。`)
    expect(preparePack(root, key).ok).toBe(true)
    const report = fs.readFileSync(path.join(root, '草稿区/定稿准备/卷01-开篇任务/卷对账.md'), 'utf-8')
    expect(report).toContain('临时发现')
    expect(report).toContain('事实未计划：临时发现')
    expect(report).not.toMatch(/^无偏离$/m)
  })

  it('正文 includes finalized frontmatter contract fields', () => {
    const root = mkDir('webnovel-frontmatter-')
    confirmWithHard(root)
    putPending(root, `巷口风大。${HARD}。`)
    expect(preparePack(root, key).ok).toBe(true)
    const text = fs.readFileSync(path.join(root, '草稿区/定稿准备/卷01-开篇任务/正文.md'), 'utf-8')
    const doc = parseDocument(text)
    expect(doc.ok).toBe(true)
    if (doc.ok) {
      expect(doc.data.fields['状态']).toBe('已定稿')
      expect(doc.data.fields['章号']).toBe(1)
      expect(doc.data.fields['字数统计']).toMatchObject({ 汉字数: expect.any(Number) })
      expect(doc.data.fields['来源细纲版本']).toMatch(/章细纲/)
      expect(doc.data.fields['事实条目引用清单']).toEqual([])
    }
  })

  it('汉字数 counts CJK, not ASCII letters and digits', () => {
    const root = mkDir('webnovel-hancount-')
    confirmWithHard(root)
    putPending(root, `主角走进城门，发现异响。${HARD}。ABC123`)
    expect(preparePack(root, key).ok).toBe(true)
    const doc = parseDocument(
      fs.readFileSync(path.join(root, '草稿区/定稿准备/卷01-开篇任务/正文.md'), 'utf-8'))
    expect(doc.ok).toBe(true)
    if (!doc.ok) return
    const 统计 = doc.data.fields['字数统计'] as { 汉字数: number; 字符数: number }
    const body = `主角走进城门，发现异响。${HARD}。ABC123`
    const 期望 = (body.match(/[㐀-鿿]/g) ?? []).length
    expect(期望).toBeGreaterThan(0)
    expect(统计.汉字数).toBe(期望)
  })

  it('对账无法进行时清单不谎报偏离已呈报', () => {
    const root = mkDir('webnovel-manifest-honesty-')
    confirmWithHard(root)
    removeSync(path.join(root, paths.计划时间线(1)))
    putPending(root, `巷口风大。${HARD}。`)
    expect(preparePack(root, key).ok).toBe(true)
    const dir = path.join(root, '草稿区/定稿准备/卷01-开篇任务')
    expect(fs.readFileSync(path.join(dir, '卷对账.md'), 'utf-8')).toContain('无法对账')
    const 清单 = JSON.parse(fs.readFileSync(path.join(dir, '清单.json'), 'utf-8')) as Record<string, unknown>
    expect(清单['偏离已呈报']).toBe(false)
  })

  it('preparePack 本卷对账不把其他卷事实列为未计划，且不改写卷纲', () => {
    const root = mkDir('webnovel-pack-volume-filter-')
    confirmWithHard(root)
    for (const name of ['故事线', '人物弧线', '承诺', '线索'] as const) {
      writeFileAtomic(root, paths.账本(name), `# ${name}\n`)
    }
    writeFileAtomic(root, paths.计划时间线(1), '# 计划时间线\n\n## 窗口覆盖\n- 城门异响〔已确认〕\n')
    writeFileAtomic(root, paths.计划时间线(2), '# 计划时间线\n\n## 窗口覆盖\n- 卷二后事〔已确认〕\n')
    writeFileAtomic(root, paths.账本('时间线'), [
      '# 时间线',
      '',
      '## 城门异响',
      '事件：发现异常',
      '实际落点：定稿/卷01/0001-开篇任务.md',
      '',
      '## 卷二后事',
      '事件：后事',
      '来源：定稿/卷02/0002-后事.md',
      '',
    ].join('\n'))
    const outline = fs.readFileSync(path.join(root, paths.卷纲(1)), 'utf-8')
    putPending(root, `巷口风大。${HARD}。`)
    expect(preparePack(root, key).ok).toBe(true)
    const report = fs.readFileSync(path.join(root, '草稿区/定稿准备/卷01-开篇任务/卷对账.md'), 'utf-8')
    expect(report).toContain('城门异响')
    expect(report).not.toContain('事实未计划：卷二后事')
    expect(fs.readFileSync(path.join(root, paths.卷纲(1)), 'utf-8')).toBe(outline)
  })

  it('multiple 待审稿 → preparePack refuses', () => {    const root = mkDir('webnovel-pack-multi-')
    confirmWithHard(root)
    putPending(root, `巷口风大。${HARD}。`)
    putPending(root, `另一版。${HARD}。`, '稿2.md')
    const result = preparePack(root, key)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/不唯一/)
  })

  it('archiveChapter from 清单 → 定稿 exists, derive 完成', () => {
    const root = initRepo()
    confirmWithHard(root)
    putPending(root, `巷口风大。${HARD}。`)
    expect(preparePack(root, key).ok).toBe(true)
    const archived = archiveChapter({
      bookRoot: root,
      packageDir: '草稿区/定稿准备/卷01-开篇任务',
      summary: '开篇任务入档',
    })
    expect(archived.ok).toBe(true)
    expect(fs.existsSync(path.join(root, '定稿/卷01/0001-开篇任务.md'))).toBe(true)
    expect(deriveChapterFacts(scanChapter(root, key)).建议.环节).toBe('完成')
  })
})
