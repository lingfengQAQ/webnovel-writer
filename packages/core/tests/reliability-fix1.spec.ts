/**
 * 可靠性修复批 1（F2/F3/F7）验收。
 *
 * F2 统一编号池：提案与补偿事件共用单调序列，连续/交错/预置同名均不覆盖。
 * F7 提交恢复：失败 hook → written:true 落盘；移除 hook 重试 → committed；重复重试 → alreadyCommitted；
 * 作者期间新改的目标仍拒绝。F3 见 retcon 同提交断言（末例）。
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import * as os from 'node:os'
import {
  archiveChapter,
  archiveRetcon,
  paths,
  registerProposal,
  recordRetconEvent,
  resolveProposal,
  retconEventOps,
  nextProposalNumber,
  seedMinDesign,
  serializeDocument,
  writeCandidate,
  confirmOutline,
  preparePack,
} from '../src/index'
import { runReview } from '@webnovel/review'

const roots: string[] = []
function mkBook(withGit = true): string {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'webnovel-rel1-'))
  roots.push(dir)
  seedMinDesign(dir)
  if (withGit) {
    const git = (args: readonly string[]): void => { spawnSync('git', args, { cwd: dir, windowsHide: true }) }
    git(['init'])
    git(['config', 'user.email', 'test@example.com'])
    git(['config', 'user.name', 'test'])
    git(['config', 'commit.gpgsign', 'false'])
  }
  return dir
}
afterAll(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放 */ } } })

const key = { 卷: 1, 章: 1, 章名: '开篇任务' } as const
function git(cwd: string, args: readonly string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8', windowsHide: true })
  return r.stdout ?? ''
}

function settledBook(root: string): void {
  const refs = ['作品契约/契约.md@1', '世界书/人物档案/主角.md@1']
  const body = [
    '# 章细纲', '',
    '## 定位段', '',
    '### 来源窗口项及拆并关系', '开篇任务，单章承接', '',
    '### 章节功能', '',
    '- 〔硬〕开场必须点名主角现身', '',
    '### 视角与焦点', '主角视角', '',
    '### 时空锚定', '城门口，清晨', '',
    '### 起止边界', '从抵达城门到发现异状', '',
    '### 故事线与承诺分配', '推进主线承诺', '',
    '### 信息边界', '只披露主角所见', '',
    '### 情绪与节奏目标', '紧张后留钩子', '',
    '### 前置条件核对结果', '已核对来源与窗口，前置设定均非留白', '',
    '## 细纲段', '', '### 单元 1', '',
    '- 目标: 找到异常', '- 人物: 主角', '- 时空: 城门口',
    '- 行动/冲突: 盘问与发现', '- 信息披露: 异常线索', '- 状态变化: 从平静到警觉', '',
  ].join('\n')
  writeCandidate(root, { 卷: 1, 章: 1, 章名: key.章名, 来源引用: refs, body })
  const c = confirmOutline(root, key)
  if (!c.ok) throw new Error(`confirm failed:${c.gaps.join(';')}`)
  const draftDir = nodePath.join(root, '草稿区/草稿/卷01-开篇任务')
  fs.mkdirSync(draftDir, { recursive: true })
  fs.writeFileSync(nodePath.join(draftDir, '稿1.md'), serializeDocument({ 角色: '待审稿', 选定: true }, '沈青梧走进城门，开场必须点名主角现身的规矩她记得清楚。'), 'utf-8')
  const rr = runReview(root, key)
  if (!rr.ok) throw new Error(`runReview failed:${rr.reason ?? ''}`)
  const p = preparePack(root, key)
  if (!p.ok) throw new Error(`preparePack failed:${p.reason ?? ''}`)
  const a = archiveChapter({ bookRoot: root, packageDir: nodePath.join(root, p.dir), summary: '第一章 开篇任务' })
  if (!a.ok) throw new Error(`archive failed:${a.reason ?? ''}`)
}

describe('F2:统一编号池(提案与补偿事件共用单调序列)', () => {
  it('连续两次补偿事件 → 编号递增,旧记录不被覆盖', () => {
    const root = mkBook(false)
    const e1 = recordRetconEvent(root, { 受影响工件: ['定稿/卷01/0001-开篇任务.md'], 账本留痕: '留痕一', 摘要: '补偿一' })
    const e2 = recordRetconEvent(root, { 受影响工件: ['定稿/卷01/0001-开篇任务.md'], 账本留痕: '留痕二', 摘要: '补偿二' })
    expect(e1.relPath).not.toBe(e2.relPath)
    expect(e2.relPath).toContain('补偿-0002')
    expect(fs.readFileSync(nodePath.join(root, e1.relPath), 'utf-8')).toContain('补偿一')
    expect(fs.readFileSync(nodePath.join(root, e2.relPath), 'utf-8')).toContain('补偿二')
  })

  it('提案与补偿交错 → 统一池单调无碰撞', () => {
    const root = mkBook(false)
    const p1 = registerProposal(root, { 域: '内容修订', 类型: '修改计划', 内容: '一', 来源: '测试' })
    const e1 = recordRetconEvent(root, { 受影响工件: ['x'], 账本留痕: '痕', 摘要: '偿一' })
    const p2 = registerProposal(root, { 域: '内容修订', 类型: '事实更正', 内容: '二', 来源: '测试' })
    const e2 = recordRetconEvent(root, { 受影响工件: ['x'], 账本留痕: '痕', 摘要: '偿二' })
    expect([p1.编号, e1.relPath, p2.编号, e2.relPath]).toEqual(['0001', '草稿区/提案/补偿-0002.md', '0003', '草稿区/提案/补偿-0004.md'])
  })

  it('retconEventOps(新位置):定稿/卷NN/补偿/ 纯构建,落盘后计入统一池', () => {
    const root = mkBook(false)
    const op = retconEventOps(root, { 受影响工件: ['x'], 账本留痕: '痕', 摘要: '偿', 卷: 1 })
    expect(op.relPath).toBe('定稿/卷01/补偿/补偿-0001.md')
    // 未落盘前重建仍取同号(纯构建);落盘后池递增
    const again = retconEventOps(root, { 受影响工件: ['x'], 账本留痕: '痕', 摘要: '偿', 卷: 1 })
    expect(again.relPath).toBe('定稿/卷01/补偿/补偿-0001.md')
    fs.mkdirSync(nodePath.join(root, '定稿/卷01/补偿'), { recursive: true })
    fs.writeFileSync(nodePath.join(root, op.relPath), op.content, 'utf-8')
    const next = retconEventOps(root, { 受影响工件: ['x'], 账本留痕: '痕', 摘要: '偿二', 卷: 1 })
    expect(next.relPath).toBe('定稿/卷01/补偿/补偿-0002.md')
    expect(nextProposalNumber(root)).toBe(2)
  })

  it('预置同名补偿文件 → 递增不覆盖(不允许静默覆盖)', () => {
    const root = mkBook(false)
    const p1 = registerProposal(root, { 域: '内容修订', 类型: '修改计划', 内容: '占号', 来源: '测试' })
    const e = recordRetconEvent(root, { 受影响工件: ['x'], 账本留痕: '痕', 摘要: '补偿内容A' })
    void p1
    // e.relPath = 补偿-0002.md;手工预置一个占位同名文件于后续编号
    fs.mkdirSync(nodePath.join(root, '草稿区/提案'), { recursive: true })
    fs.writeFileSync(nodePath.join(root, '草稿区/提案/补偿-0003.md'), '已有内容不得覆盖', 'utf-8')
    const e2 = recordRetconEvent(root, { 受影响工件: ['x'], 账本留痕: '痕', 摘要: '补偿内容B' })
    expect(e2.relPath).toBe('草稿区/提案/补偿-0004.md')
    expect(fs.readFileSync(nodePath.join(root, '草稿区/提案/补偿-0003.md'), 'utf-8')).toBe('已有内容不得覆盖')
    expect(fs.readFileSync(nodePath.join(root, e.relPath), 'utf-8')).toContain('补偿内容A')
  })
})

describe('F7:提交失败后的可重试恢复', () => {
  function writeFailingHook(root: string): void {
    const hooksDir = nodePath.join(root, '.git', 'hooks')
    fs.mkdirSync(hooksDir, { recursive: true })
    // sh 脚本:直接 exit 1(Windows Git for Windows 自带 sh 执行 hook)
    fs.writeFileSync(nodePath.join(hooksDir, 'pre-commit'), '#!/bin/sh\nexit 1\n', 'utf-8')
    fs.chmodSync(nodePath.join(hooksDir, 'pre-commit'), 0o755)
  }
  function removeHook(root: string): void {
    fs.rmSync(nodePath.join(root, '.git', 'hooks', 'pre-commit'), { force: true })
  }

  it('失败 hook → ok:false 且 written:true,文件已落盘;移除 hook 重试 → committed;再重试 → alreadyCommitted 且提交数不变', () => {
    const root = mkBook(true)
    settledBook(root)
    const commitsBefore = git(root, ['rev-list', '--count', 'HEAD']).trim()
    const 定稿相对 = paths.定稿章(1, 1, key.章名)
    const 更正后 = serializeDocument({ 身份: { 卷: 1, 章: 1, 章名: key.章名 }, 角色: '已定稿' }, '更正后的定稿正文。')

    writeFailingHook(root)
    const fail = archiveRetcon({ bookRoot: root, files: [{ 目标: 定稿相对, 内容: 更正后 }], summary: '吃书补偿:恢复验证' })
    expect(fail.ok).toBe(false)
    if (fail.ok) return
    expect(fail.written).toBe(true)
    expect(fs.readFileSync(nodePath.join(root, 定稿相对), 'utf-8')).toContain('更正后的定稿正文')
    expect(git(root, ['rev-list', '--count', 'HEAD']).trim()).toBe(commitsBefore)

    removeHook(root)
    const retry = archiveRetcon({ bookRoot: root, files: [{ 目标: 定稿相对, 内容: 更正后 }], summary: '吃书补偿:恢复验证' })
    expect(retry.ok).toBe(true)
    expect(git(root, ['rev-list', '--count', 'HEAD']).trim()).toBe(String(Number(commitsBefore) + 1))
    expect(git(root, ['log', '-1', '--format=%s']).trim()).toContain('吃书补偿:恢复验证')

    const again = archiveRetcon({ bookRoot: root, files: [{ 目标: 定稿相对, 内容: 更正后 }], summary: '吃书补偿:恢复验证' })
    expect(again.ok).toBe(true)
    if (again.ok) expect(again.alreadyCommitted).toBe(true)
    expect(git(root, ['rev-list', '--count', 'HEAD']).trim()).toBe(String(Number(commitsBefore) + 1))
  })

  it('ch 模式:已有目标缺可信收据时拒绝，不能靠相同正文推断归档完成', () => {
    const root = mkBook(true)
    settledBook(root)
    const 定稿相对 = paths.定稿章(1, 1, key.章名)
    // 作者期间新改(内容与归档版不同)→ 拒绝且 reason 明确「内容不同」
    const r1 = archiveChapter({ bookRoot: root, files: [{ 目标: 定稿相对, 内容: serializeDocument({ 身份: { 卷: 1, 章: 1, 章名: key.章名 }, 角色: '已定稿' }, '另一版更正。') }], summary: 'ch: 冲突验证' })
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.reason).toContain('内容不同')
    // 旧版本已写入但没有收据的中间状态不能自动推断附属沉淀已经完成。
    const 现有定稿全文 = fs.readFileSync(nodePath.join(root, 定稿相对), 'utf-8')
    const r2 = archiveChapter({ bookRoot: root, files: [{ 目标: 定稿相对, 内容: 现有定稿全文 }], summary: 'ch: 幂等验证' })
    expect(r2.ok).toBe(false)
    if (!r2.ok) {
      expect(r2.written).toBeUndefined()
      expect(r2.reason).toContain('可信收据')
    }
  })
})
