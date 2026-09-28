import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  confirmOutline,
  loadReviewRecord,
  seedMinDesign,
  writeCandidate,
} from '../src/index'
import { ingestFindings, listChecks, registerDefaultChecks, resetChecks, runReview } from '@webnovel/review'

const roots: string[] = []
function mkDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(dir)
  return dir
}
afterAll(() => { for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

const key = { 卷: 1, 章: 1, 章名: '开篇任务' } as const
const HARD = '开场必须点名主角现身'

function confirmWithHard(root: string): void {
  seedMinDesign(root)
  const body = [
    '# 章细纲', '', '## 定位段', '', '### 来源窗口项及拆并关系', '开篇任务，单章承接', '',
    '### 章节功能', '', `- 〔硬〕${HARD}`, '',
    '### 视角与焦点', '主角视角', '', '### 时空锚定', '城门口，清晨', '',
    '### 起止边界', '从抵达城门到发现异状', '', '### 故事线与承诺分配', '推进主线承诺', '',
    '### 信息边界', '只披露主角所见', '', '### 情绪与节奏目标', '紧张后留钩子', '',
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
    `---\n角色: 待审稿\n选定: true\n版本: 1\n父版本: null\n生成模块: 写稿\n---\n综上所述，${HARD}。\n`,
    'utf-8',
  )
}

describe('作者意见审读模块(A14)', () => {
  it('执行形态为「作者」,重跑审核不产生它的模块态、不影响完成态', () => {
    const root = mkDir('webnovel-author-mod-')
    confirmWithHard(root)
    resetChecks()
    registerDefaultChecks()
    const mod = listChecks().find((c) => c.名称 === '作者意见')
    expect(mod?.执行形态).toBe('作者')

    const reviewed = runReview(root, key)
    expect(reviewed.ok).toBe(true)
    expect(reviewed.record?.模块['作者意见']).toBeUndefined() // 不进本轮方案
    expect(reviewed.record?.完成).toBe(false) // 隔离子 Agent 模块待回写
  })

  it('以「作者意见」回写 2 条发现项:记录含它们,其余模块完成态不变;其余模块回写后「完成」不被它压住', () => {
    const root = mkDir('webnovel-author-ingest-')
    confirmWithHard(root)
    resetChecks()
    registerDefaultChecks()
    const reviewed = runReview(root, key)
    expect(reviewed.ok).toBe(true)

    const authorFindings = [
      { 审核编号: 'R-作者意见-1', 模块名: '作者意见', 发现项编号: 'A1', 严重程度: '中', 是否建议阻断: false, 证据位置: '开头', 所依据材料及版本: '稿1@1', 问题说明: '主角动机铺垫不足', 影响范围: '正文', 不确定性说明: '', 修改建议: '补一句动机', 建议返回节点: '改稿', 建议复审模块: '作者意见', 材料完整性: '完整', 处置状态: '待处理', 处置: '待处理' },
      { 审核编号: 'R-作者意见-2', 模块名: '作者意见', 发现项编号: 'A2', 严重程度: '低', 是否建议阻断: false, 证据位置: '对白', 所依据材料及版本: '稿1@1', 问题说明: '老兵用词过于书面', 影响范围: '正文', 不确定性说明: '', 修改建议: '口语化', 建议返回节点: '改稿', 建议复审模块: '作者意见', 材料完整性: '完整', 处置状态: '待处理', 处置: '待处理' },
    ]
    const ingested = ingestFindings(root, key, '作者意见', authorFindings)
    expect(ingested.ok).toBe(true)
    const record = loadReviewRecord(root, key)!
    expect(record.问题.filter((p) => p.模块名 === '作者意见')).toHaveLength(2)
    expect(record.模块['作者意见']?.完成).toBe(true)
    expect(record.模块['作者意见']?.待回写).toBeFalsy()
    // 其余模块完成态与重跑后逐字一致,不被「作者意见」回写牵动
    for (const [name, st] of Object.entries(record.模块)) {
      if (name === '作者意见') continue
      expect(JSON.stringify(st), `${name} 完成态不变`).toBe(JSON.stringify(reviewed.record!.模块[name]))
    }
    // 回写其余模块后,「完成」为真——「作者意见」不在本轮方案,不压住完成态
    for (const [name, st] of Object.entries(record.模块)) {
      if (name === '作者意见') continue
      if (st.待回写 === true) expect(ingestFindings(root, key, name, [], reviewed.record!.审读指纹).ok).toBe(true)
    }
    const final = loadReviewRecord(root, key)!
    expect(final.完成).toBe(true)
  })
})
