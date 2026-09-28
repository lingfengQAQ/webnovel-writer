/**
 * R21「脚本只算不写」锁死测试（2026-09-05 真机实锤后拆分：runReview 曾在脚本内直落审核记录）。
 *
 * computeReview 纯算零写盘；确定性模块的发现项经 ingestFindings 逐模块回写落盘——
 * 模块态置完成、发现项整批替换、空发现项也要回写（置完成），净效果与 runReview 写盘一致。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import * as path from 'node:path'
import * as os from 'node:os'
import { seedMinDesign, serializeDocument, writeCandidate, confirmOutline, draftHashOf, reviewInputFingerprintOf, loadMaterialPackage } from '@webnovel/core'
import { computeReview, ingestFindings, listChecks, registerCheck, registerDefaultChecks, resetChecks, runReview, type CheckInput } from '../src/index'
import { removeSync } from '../../core/src/repo/remove'

const roots: string[] = []
function mkBook(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-script-nowrite-'))
  roots.push(dir)
  seedMinDesign(dir)
  return dir
}
afterAll(() => roots.forEach(root => removeSync(root)))
beforeEach(() => { resetChecks(); registerDefaultChecks() })
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports() })

const key = { 卷: 1, 章: 1, 章名: '开篇任务' } as const

function readyBookWithPendingDraft(root: string): void {
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
  const r = confirmOutline(root, key)
  if (!r.ok) throw new Error(`confirm failed:${r.gaps.join(';')}`)
  fs.mkdirSync(path.join(root, '草稿区/草稿/卷01-开篇任务'), { recursive: true })
  fs.writeFileSync(path.join(root, '草稿区/草稿/卷01-开篇任务/稿1.md'), serializeDocument({ 角色: '待审稿' }, '他走进雨里，数着街角的旗幡。'), 'utf-8')
}

describe('R21 脚本只算不写(computeReview 与 ingestFindings 分工)', () => {
  it.each(['草稿', '细纲'])('F05 %s在读取间变化，检查与指纹仍使用同一份输入，迟到载荷不能回写', (changed) => {
    const root = mkBook()
    readyBookWithPendingDraft(root)
    const target = path.join(root, changed === '草稿'
      ? '草稿区/草稿/卷01-开篇任务/稿1.md'
      : '大纲/卷规划/卷01/章细纲/0001-开篇任务.md')
    const original = fs.readFileSync
    let reads = 0
    vi.spyOn(fs, 'readFileSync').mockImplementation((...args: Parameters<typeof fs.readFileSync>) => {
      const text = original(...args)
      if (path.normalize(String(args[0])) === path.normalize(target) && ++reads === (changed === '草稿' ? 2 : 1)) {
        fs.writeFileSync(target, `${String(text)}\n作者在检查期间补写了新内容。\n`)
      }
      return text
    })
    syncBuiltinESMExports()
    let checked: CheckInput | undefined
    registerCheck({ 名称: '输入身份检查', 审什么: '输入身份', 依赖材料: [], 执行形态: '确定性代码', 适用范围: '章',
      run(input) { checked = input; return [] } })
    const result = computeReview(root, key)
    expect(result.ok).toBe(true)
    expect(checked).toBeDefined()
    expect(result.record!.审稿哈希).toBe(draftHashOf(checked!.待审稿))
    expect(result.record!.审读指纹).toBe(reviewInputFingerprintOf({
      正文: checked!.待审稿, 细纲: checked!.细纲,
      材料清单: loadMaterialPackage(root, key).审读材料标识, 方案: result.record!.方案,
    }))
    expect(ingestFindings(root, key, '输入身份检查', [], result.record!.审读指纹).ok).toBe(false)
  })

  it('computeReview 不落盘:跑完检查,草稿区/审核 目录不存在', () => {
    const root = mkBook()
    readyBookWithPendingDraft(root)
    const r = computeReview(root, key)
    expect(r.ok).toBe(true)
    expect(r.record?.模块['文本规范检查']?.完成).toBe(true)
    expect(r.record?.模块['章节结构审读']?.待回写).toBe(true)
    expect(fs.existsSync(path.join(root, '草稿区/审核'))).toBe(false)
  })

  it('逐模块回写后记录落盘:确定性模块置完成,语义模块仍待回写(fail-closed)', () => {
    const root = mkBook()
    readyBookWithPendingDraft(root)
    const computed = computeReview(root, key)
    expect(computed.ok).toBe(true)
    const deterministic = listChecks().filter((c) => c.run !== undefined).map((c) => c.名称)
    for (const 模块名 of deterministic) {
      const 发现项 = (computed.record?.问题 ?? []).filter((f) => f.模块名 === 模块名)
      const w = ingestFindings(root, key, 模块名, 发现项, computed.record!.审读指纹)
      expect(w.ok).toBe(true)
    }
    const loaded = JSON.parse(fs.readFileSync(path.join(root, '草稿区/审核/卷01-开篇任务.json'), 'utf-8'))
    expect(loaded.模块['文本规范检查'].完成).toBe(true)
    // 语义模块未被 ingest 过,记录里无其行;完成判定按 names.every 仍是 false(fail-closed 不变)
    expect(loaded.模块['章节结构审读']?.完成 ?? false).toBe(false)
    expect(loaded.完成).toBe(false)
  })

  it('runReview(进程内写入路径)行为不变:写盘且模块态一致', () => {
    const root = mkBook()
    readyBookWithPendingDraft(root)
    const r = runReview(root, key)
    expect(r.ok).toBe(true)
    expect(fs.existsSync(path.join(root, '草稿区/审核/卷01-开篇任务.json'))).toBe(true)
  })
})
