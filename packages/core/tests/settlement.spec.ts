import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { archiveChapter, archiveRetcon } from '../src/commit/archive'
import { serializeDocument } from '../src/repo/frontmatter'
import { queryLedger, queryMemory } from '../src/ledger'
import { planSettlement } from '../src/settlement'

const roots: string[] = []
const key = { 卷: 1, 章: 1, 章名: '开篇任务' } as const

function mkRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-settlement-'))
  roots.push(root)
  fs.mkdirSync(path.join(root, '账本'), { recursive: true })
  fs.mkdirSync(path.join(root, '本书记忆'), { recursive: true })
  for (const name of ['故事线', '人物弧线', '承诺', '线索', '时间线']) {
    fs.writeFileSync(path.join(root, '账本', `${name}.md`), `# ${name}\n既有条目\n`, 'utf-8')
  }
  for (const name of ['文风', '决策', '对话', '灵感']) {
    fs.writeFileSync(path.join(root, '本书记忆', `${name}.md`), `# ${name}\n既有记忆\n`, 'utf-8')
  }
  return root
}

function initGit(root: string): void {
  expect(spawnSync('git', ['init'], { cwd: root, windowsHide: true }).status).toBe(0)
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, windowsHide: true })
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: root, windowsHide: true })
  spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: root, windowsHide: true })
}

function putPackage(root: string, candidates: Record<string, string>): string {
  const rel = '草稿区/定稿准备/卷01-开篇任务'
  const dir = path.join(root, rel)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, '正文.md'), '正文\n', 'utf-8')
  fs.writeFileSync(path.join(dir, '章摘要.md'), '摘要\n', 'utf-8')
  for (const [name, content] of Object.entries(candidates)) fs.writeFileSync(path.join(dir, name), content, 'utf-8')
  fs.writeFileSync(path.join(dir, '事实变更.md'), candidates['事实变更.md'] ?? '# 事实变更\n\n（无事实变更）\n', 'utf-8')
  fs.writeFileSync(path.join(dir, '时间线变更.md'), candidates['时间线变更.md'] ?? '# 时间线变更\n\n（无时间线变更）\n', 'utf-8')
  fs.writeFileSync(path.join(dir, '账本变更.md'), candidates['账本变更.md'] ?? '# 账本变更\n\n（无账本变更）\n', 'utf-8')
  fs.writeFileSync(path.join(dir, '本书层记忆候选.md'), candidates['本书层记忆候选.md'] ?? '# 本书层记忆候选\n\n（无记忆候选）\n', 'utf-8')
  fs.writeFileSync(path.join(dir, '清单.json'), JSON.stringify({
    schemaVersion: 1,
    文件: [
      { 源: '正文.md', 目标: '定稿/卷01/0001-开篇任务.md' },
      { 源: '章摘要.md', 目标: '大纲/卷规划/卷01/章摘要/0001-开篇任务.md' },
    ],
  }), 'utf-8')
  return rel
}

afterAll(() => { for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

describe('更正最新账本历史(F07)', () => {
  it('只替换最新同名段，旧历史、旁边条目及 CRLF 空白原样保留', () => {
    const root = mkRoot()
    const earlier = '# 故事线\r\n\r\n\r\n## 主线\r\n名称：主线\r\n状态：进行中\r\n### 正文\r\n早期原文。\r\n\r\n\r\n## 旁边\r\n状态：进行中\r\n### 正文\r\n旁边原文。\r\n\r\n'
    const current = '## 主线\r\n名称：主线\r\n状态：已兑现\r\n### 正文\r\n当前原文。\r\n\r\n'
    const later = '## 后文\r\n状态：进行中\r\n### 正文\r\n后文原文。\r\n\r\n\r\n'
    fs.writeFileSync(path.join(root, '账本/故事线.md'), earlier + current + later)
    const pkg = putPackage(root, { '账本变更.md': '# 账本变更\n## 故事线\n### 主线\n状态：已结束\n计划来源：卷纲#1\n更正后原文。\n' })
    const plan = planSettlement(root, path.join(root, pkg), { 章节: key, 批准: true, 裁决记录: '作者更正' }, key, '更正')
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const output = plan.ops.find(op => op.relPath === '账本/故事线.md')!.content
    expect(output.startsWith(earlier)).toBe(true)
    expect(output.endsWith(later)).toBe(true)
    expect(output).not.toContain('当前原文')
    expect(output.match(/^## 主线\r?$/gm)).toHaveLength(2)
    fs.writeFileSync(path.join(root, '账本/故事线.md'), output)
    const latest = queryLedger(root, { 分类: '故事线', 名称: '主线' })
    expect(latest.ok).toBe(true)
    expect(latest.entries[0]?.字段['状态']).toBe('已结束')
    expect(latest.entries[0]?.正文).toContain('更正后原文')
  })

  it.each(['## 主线\n名称：别的名称\n', '## 别的标题\n名称：主线\n', '## 主线\n名称：主线\n名称：主线\n'])('标题与名称有歧义时拒绝更正', (section) => {
    const root = mkRoot()
    const original = '# 故事线\n\n' + section + '状态：进行中\n### 正文\n原文。\n'
    fs.writeFileSync(path.join(root, '账本/故事线.md'), original)
    const pkg = putPackage(root, { '账本变更.md': '# 账本变更\n## 故事线\n### 主线\n状态：已结束\n计划来源：卷纲#1\n' })
    expect(planSettlement(root, path.join(root, pkg), { 章节: key, 批准: true, 裁决记录: '作者更正' }, key, '更正'))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/歧义/) })
    expect(fs.readFileSync(path.join(root, '账本/故事线.md'), 'utf8')).toBe(original)
  })
})

describe('定稿沉淀', () => {
  it('未批准时 fail-closed 且不写任何真源', () => {
    const root = mkRoot()
    const pkg = putPackage(root, { '时间线变更.md': '# 时间线变更\n\n## 城门异响\n事件：发现异常\n' })
    const result = archiveChapter({ bookRoot: root, packageDir: pkg, summary: '开篇任务入档' })
    expect(result).toEqual({ ok: false, reason: '存在沉淀候选但缺少作者批准' })
    expect(fs.existsSync(path.join(root, '定稿/卷01/0001-开篇任务.md'))).toBe(false)
    expect(fs.readFileSync(path.join(root, '账本/时间线.md'), 'utf-8')).not.toContain('城门异响')
  })

  it('批准后将时间线、账本、记忆与正文放入同一 ch 提交', () => {
    const root = mkRoot()
    initGit(root)
    const pkg = putPackage(root, {
      '时间线变更.md': '# 时间线变更\n\n## 城门异响\n事件：发现异常\n',
      '账本变更.md': [
        '# 账本变更',
        '## 故事线', '### 主线启动', '名称：主线启动', '状态：进行中', '计划来源：卷纲#1', '备注：这一行属于正文',
        '## 人物弧线', '### 主角警觉', '状态：进行中', '计划来源：卷纲#2',
        '## 承诺', '### 查明异响', '状态：进行中', '计划来源：卷纲#3',
        '## 线索', '### 纸鹤', '状态：已埋', '计划来源：卷纲#4', '埋设点：第1章', '预期兑现区间：第8-12章',
        '',
      ].join('\n'),
      '本书层记忆候选.md': [
        '# 本书层记忆候选',
        '## 文风', '### 克制叙述', '状态：候选', '短句，少用解释性旁白。', '例：他没有回头。',
        '## 决策', '### 开篇视角', '状态：候选', '开篇固定使用主角限知视角。',
        '## 对话', '### 主角语气', '状态：候选', '主角遇险时避免长篇解释。',
        '## 灵感', '### 纸鹤回响', '状态：候选', '纸鹤可在卷末作为回响意象。',
        '',
      ].join('\n'),
    })
    const result = archiveChapter({
      bookRoot: root,
      packageDir: pkg,
      summary: '开篇任务入档',
      settlement: { 章节: key, 批准: true, 裁决记录: '作者批准首章沉淀' },
    })
    expect(result.ok).toBe(true)
    expect(fs.readFileSync(path.join(root, '账本/时间线.md'), 'utf-8')).toMatch(/城门异响|第0001章|作者批准首章沉淀/)
    expect(fs.readFileSync(path.join(root, '账本/故事线.md'), 'utf-8')).toMatch(/主线启动|实际落点：定稿\/卷01\/0001-开篇任务\.md/)
    for (const [file, item] of [['人物弧线', '主角警觉'], ['承诺', '查明异响'], ['线索', '纸鹤']]) {
      expect(fs.readFileSync(path.join(root, `账本/${file}.md`), 'utf-8')).toContain(item)
    }
    for (const [item, file] of [['克制叙述', '本书记忆/克制叙述.md'], ['开篇视角', '本书记忆/开篇视角.md'], ['主角语气', '本书记忆/主角语气.md'], ['纸鹤回响', '本书记忆/纸鹤回响.md']]) {
      expect(fs.readFileSync(path.join(root, file), 'utf-8')).toContain(item)
    }
    // 一事一文件:索引同步重建,旧 类 文件不被写入新条目
    expect(fs.readFileSync(path.join(root, '本书记忆/索引.md'), 'utf-8')).toContain('[克制叙述]')
    expect(fs.readFileSync(path.join(root, '本书记忆/文风.md'), 'utf-8')).not.toContain('克制叙述')
    const memories = queryMemory(root)
    expect(memories.ok).toBe(true)
    if (memories.ok) expect(memories.entries.find((entry) => entry.名称 === '克制叙述')?.正文).toContain('例：他没有回头。')
    const ledger = queryLedger(root)
    expect(ledger.ok).toBe(true)
    if (ledger.ok) expect(ledger.entries.find((entry) => entry.名称 === '主线启动')?.正文).toContain('备注：这一行属于正文')
    if (ledger.ok) {
      const timeline = ledger.entries.find((entry) => entry.分类 === '时间线' && entry.名称 === '城门异响')
      expect(timeline?.字段['章号']).toBe('第0001章')
      expect(timeline?.字段['来源']).toBe('定稿/卷01/0001-开篇任务.md')
      expect(timeline?.正文).toContain('发现异常')
    }
    const log = spawnSync('git', ['log', '-1', '--pretty=%s'], { cwd: root, encoding: 'utf-8', windowsHide: true })
    expect(log.stdout.trim()).toBe('ch: 开篇任务入档')
  })

  it('未知分类、非法线索字段和非空事实变更在写入前失败', () => {
    const cases: Array<{ candidate: Record<string, string>; error: RegExp }> = [
      { candidate: { '账本变更.md': '# 账本变更\n\n## 未知\n### 条目\n状态：进行中\n' }, error: /分类未知/ },
      { candidate: { '账本变更.md': '# 账本变更\n\n## 线索\n### 伏笔\n状态：已弃\n计划来源：卷纲#2\n埋设点：第1章\n预期兑现区间：卷一\n' }, error: /弃因/ },
      { candidate: { '账本变更.md': '# 账本变更\n\n## 承诺\n### 回乡\n状态：进行中\n' }, error: /计划来源/ },
      { candidate: { '事实变更.md': '# 事实变更\n\n## 世界规则\n### 新律\n新增规则\n' }, error: /不猜模块/ },
    ]
    for (const entry of cases) {
      const root = mkRoot()
      const pkg = putPackage(root, entry.candidate)
      const result = archiveChapter({
        bookRoot: root,
        packageDir: pkg,
        summary: '拒绝非法候选',
        settlement: { 章节: key, 批准: true, 裁决记录: '测试裁决' },
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toMatch(entry.error)
      expect(fs.existsSync(path.join(root, '定稿/卷01/0001-开篇任务.md'))).toBe(false)
    }
  })

  it('只有分类与条目标题、没有正文的候选必须报错到条目，不静默当空', () => {
    const cases = [
      {
        name: '账本变更.md',
        candidate: { '账本变更.md': '# 账本变更\n\n## 线索\n\n### 纸鹤\n' },
        error: /线索\/纸鹤/,
      },
      {
        name: '本书层记忆候选.md',
        candidate: { '本书层记忆候选.md': '# 本书层记忆候选\n\n## 文风\n\n### 短句偏好\n' },
        error: /文风\/短句偏好/,
      },
      {
        name: '时间线变更.md',
        candidate: { '时间线变更.md': '# 时间线变更\n\n## 城门异响\n' },
        error: /城门异响/,
      },
    ]
    for (const entry of cases) {
      const root = mkRoot()
      initGit(root)
      const pkg = putPackage(root, entry.candidate)
      const result = archiveChapter({
        bookRoot: root,
        packageDir: pkg,
        summary: entry.name,
        settlement: { 章节: key, 批准: true, 裁决记录: '测试裁决' },
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toMatch(entry.error)
      expect(fs.existsSync(path.join(root, '定稿/卷01/0001-开篇任务.md'))).toBe(false)
    }
  })

  it('只有标题的候选在无批准时也被当作有候选而拒绝', () => {
    const root = mkRoot()
    const pkg = putPackage(root, { '账本变更.md': '# 账本变更\n\n## 线索\n\n### 纸鹤\n' })
    const result = archiveChapter({ bookRoot: root, packageDir: pkg, summary: '无批准' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/缺少作者批准/)
  })

  it('空候选无需批准，同请求重复入档以可信收据重放成功', () => {    const root = mkRoot()
    initGit(root)
    const pkg = putPackage(root, {})
    expect(archiveChapter({ bookRoot: root, packageDir: pkg, summary: '空候选入档' }).ok).toBe(true)
    const second = archiveChapter({ bookRoot: root, packageDir: pkg, summary: '重复入档' })
    expect(second).toMatchObject({ ok: true, alreadyCommitted: true, message: 'ch: 空候选入档' })
    // 作者期间新改(内容不同)仍被拒绝
    fs.writeFileSync(path.join(root, pkg, '正文.md'), serializeDocument({ 身份: { 卷: 1, 章: 1, 章名: '开篇任务' }, 角色: '已定稿' }, '作者改过的正文。'), 'utf-8')
    const third = archiveChapter({ bookRoot: root, packageDir: pkg, summary: '冲突入档' })
    expect(third.ok).toBe(false)
    if (!third.ok) expect(third.reason).toMatch(/内容不同/)
  })
})

describe('吃书补偿沉淀', () => {
  function 已有线索(root: string): void {
    fs.writeFileSync(path.join(root, '账本', '线索.md'), [
      '# 线索',
      '',
      '## 纸鹤',
      '名称：纸鹤',
      '类型：线索',
      '状态：已埋',
      '计划来源：卷纲#4',
      '实际落点：定稿/卷01/0001-开篇任务.md',
      '来源：定稿/卷01/0001-开篇任务.md',
      '裁决记录：首章沉淀',
      '### 正文',
      '埋设点：第1章',
      '预期兑现区间：第8-12章',
      '',
      '## 铜铃',
      '状态：已埋',
      '计划来源：卷纲#5',
      '### 正文',
      '不该被这次吃书动到',
      '',
    ].join('\n'), 'utf-8')
  }

  it('retcon 清单直写账本同样被拒，必须走沉淀服务', () => {
    const root = mkRoot()
    initGit(root)
    const result = archiveRetcon({
      bookRoot: root,
      files: [{ 目标: '账本/线索.md', 内容: '# 线索\n\n## 纸鹤\n状态：随便写\n' }],
      summary: '绕过校验',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/不得绕过沉淀服务/)
    expect(fs.readFileSync(path.join(root, '账本/线索.md'), 'utf-8')).not.toContain('随便写')
  })

  it('retcon 更正既有条目：整条替换，同文件其他条目不动，走 retcon: 提交', () => {
    const root = mkRoot()
    initGit(root)
    已有线索(root)
    const pkg = putPackage(root, {
      '账本变更.md': [
        '# 账本变更',
        '## 线索',
        '### 纸鹤',
        '状态：已弃',
        '计划来源：卷纲#4',
        '埋设点：第1章',
        '预期兑现区间：第8-12章',
        '弃因：改设定后纸鹤不再成立',
        '',
      ].join('\n'),
    })
    const result = archiveRetcon({
      bookRoot: root,
      packageDir: pkg,
      files: [{ 目标: '世界书/人物/甲.md', 内容: '更正\n' }],
      summary: '纸鹤改弃',
      settlement: { 章节: key, 批准: true, 裁决记录: '作者裁决：纸鹤线砍掉' },
    })
    expect(result.ok).toBe(true)
    const 线索 = fs.readFileSync(path.join(root, '账本/线索.md'), 'utf-8')
    expect(线索).toContain('状态：已弃')
    expect(线索).toContain('改设定后纸鹤不再成立')
    expect(线索).not.toContain('状态：已埋\n计划来源：卷纲#4')
    // 同名条目只剩一条(整条替换而非追加)
    expect(线索.match(/^## 纸鹤$/gm)?.length).toBe(1)
    // 其他条目原样保留
    expect(线索).toContain('## 铜铃')
    expect(线索).toContain('不该被这次吃书动到')
    const log = spawnSync('git', ['log', '-1', '--pretty=%s'], { cwd: root, encoding: 'utf-8', windowsHide: true })
    expect(log.stdout.trim().startsWith('retcon:')).toBe(true)
  })

  it('retcon 更正的字段校验与正常沉淀同一套', () => {
    const cases: Array<{ candidate: string; error: RegExp }> = [
      { candidate: '# 账本变更\n## 线索\n### 纸鹤\n状态：已弃\n计划来源：卷纲#4\n埋设点：第1章\n预期兑现区间：第8-12章\n', error: /弃因/ },
      { candidate: '# 账本变更\n## 线索\n### 纸鹤\n状态：乱写\n计划来源：卷纲#4\n埋设点：第1章\n预期兑现区间：第8-12章\n', error: /状态非法/ },
      { candidate: '# 账本变更\n## 未知\n### 纸鹤\n状态：已弃\n', error: /分类未知/ },
    ]
    for (const entry of cases) {
      const root = mkRoot()
      initGit(root)
      已有线索(root)
      const pkg = putPackage(root, { '账本变更.md': entry.candidate })
      const result = archiveRetcon({
        bookRoot: root,
        packageDir: pkg,
        summary: '非法更正',
        settlement: { 章节: key, 批准: true, 裁决记录: '测试裁决' },
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toMatch(entry.error)
      expect(fs.readFileSync(path.join(root, '账本/线索.md'), 'utf-8')).toContain('状态：已埋')
    }
  })

  it('retcon 更正不存在的条目被拒，不静默追加', () => {
    const root = mkRoot()
    initGit(root)
    已有线索(root)
    const pkg = putPackage(root, {
      '账本变更.md': '# 账本变更\n## 线索\n### 从未存在\n状态：已收\n计划来源：卷纲#9\n埋设点：第1章\n预期兑现区间：第8-12章\n',
    })
    const result = archiveRetcon({
      bookRoot: root,
      packageDir: pkg,
      summary: '更正不存在的条目',
      settlement: { 章节: key, 批准: true, 裁决记录: '测试裁决' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/不存在/)
    expect(fs.readFileSync(path.join(root, '账本/线索.md'), 'utf-8')).not.toContain('从未存在')
  })

  it('retcon 更正仍需作者批准', () => {
    const root = mkRoot()
    initGit(root)
    已有线索(root)
    const pkg = putPackage(root, {
      '账本变更.md': '# 账本变更\n## 线索\n### 纸鹤\n状态：已收\n计划来源：卷纲#4\n埋设点：第1章\n预期兑现区间：第8-12章\n',
    })
    const result = archiveRetcon({ bookRoot: root, packageDir: pkg, summary: '无批准更正' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/缺少作者批准/)
    expect(fs.readFileSync(path.join(root, '账本/线索.md'), 'utf-8')).toContain('状态：已埋')
  })

  it('更正后账本仍可被账本查询解析，状态为更正后的当前态', () => {
    const root = mkRoot()
    initGit(root)
    已有线索(root)
    const pkg = putPackage(root, {
      '账本变更.md': '# 账本变更\n## 线索\n### 纸鹤\n状态：已收\n计划来源：卷纲#4\n埋设点：第1章\n预期兑现区间：第8-12章\n',
    })
    expect(archiveRetcon({
      bookRoot: root,
      packageDir: pkg,
      summary: '纸鹤改收',
      settlement: { 章节: key, 批准: true, 裁决记录: '作者裁决' },
    }).ok).toBe(true)
    const ledger = queryLedger(root, { 分类: '线索' })
    expect(ledger.ok).toBe(true)
    if (!ledger.ok) return
    expect(ledger.entries.find((e) => e.名称 === '纸鹤')?.字段['状态']).toBe('已收')
    expect(ledger.entries.filter((e) => e.名称 === '纸鹤')).toHaveLength(1)
  })
})
