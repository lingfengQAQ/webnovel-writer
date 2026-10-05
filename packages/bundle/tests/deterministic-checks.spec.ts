import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { seedMinDesign, serializeDocument, computePack, parseDocument, writeContract } from '@webnovel/core'
import { computeReview, ingestFindings, resetChecks } from '@webnovel/review'
import { removeSync } from '../../core/src/repo/remove'
import { runChecksCli } from '../src/scripts/deterministic-checks'

const roots: string[] = []
const key = { 卷: 1, 章: 1, 章名: '回写验收' }
beforeEach(() => resetChecks())
afterEach(() => {
  vi.restoreAllMocks()
  roots.splice(0).forEach(root => removeSync(root))
})

describe('确定性检查官方回写载荷', () => {
  it.each([false, true])('审读材料=%s：范围核对与普通文本规范发现项一并输出', (materials) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-review-cli-'))
    roots.push(root)
    seedMinDesign(root)
    writeContract(root, { 阅读体验与情绪承诺: { state: '已确认', body: '### 章节篇幅\n- 目标汉字数: 2000\n- 下限汉字数: 1600\n- 上限汉字数: 2400' } })
    const draft = path.join(root, '草稿区/草稿/卷01-回写验收/稿1.md')
    fs.mkdirSync(path.dirname(draft), { recursive: true })
    fs.writeFileSync(draft, serializeDocument({ 角色: '待审稿', 版本: 1 }, '甲'.repeat(2401)))
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(runChecksCli(['--book', root, '--卷', '1', '--章', '1', '--章名', key.章名,
      ...(materials ? ['--审读材料', 'true'] : [])])).toBe(0)
    const data = JSON.parse(String(output.mock.calls.find(call => String(call[0]).startsWith('{'))![0]))
    expect(data.篇幅核对).toMatchObject({ 实测汉字数: data.正文统计.汉字数, 结果: '偏长', 差额: 1, 约定: { 状态: '已配置', 范围: { 上限汉字数: 2400 } } })
    const payloads = materials ? data.回写载荷 : JSON.parse(String(output.mock.calls.at(-1)![0]))
    expect(payloads.find((p: { 模块名: string }) => p.模块名 === '文本规范检查').发现项).toEqual(expect.arrayContaining([expect.objectContaining({ 是否建议阻断: false, 问题说明: expect.stringContaining('超过上限 1 汉字') })]))
  })

  it.each([false, true])('审读材料=%s：每个载荷绑定实际输入，原样可回写，换稿后拒绝重放', (materials) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-review-cli-'))
    roots.push(root)
    seedMinDesign(root)
    const draft = path.join(root, '草稿区/草稿/卷01-回写验收/稿1.md')
    fs.mkdirSync(path.dirname(draft), { recursive: true })
    fs.writeFileSync(draft, serializeDocument({ 角色: '待审稿', 版本: 3, 备注: '元数据不是正文' }, '主角走进城门。\n\n## 草稿候选事实\n- 事实：不计入正文字数。'))
    const expectedFingerprint = computeReview(root, key).record!.审读指纹
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(runChecksCli(['--book', root, '--卷', '1', '--章', '1', '--章名', key.章名,
      ...(materials ? ['--审读材料', 'true'] : [])])).toBe(0)
    const result = JSON.parse(String(output.mock.calls.at(-1)![0]))
    const stats = materials ? result.正文统计 : JSON.parse(String(output.mock.calls.find(call => String(call[0]).startsWith('{'))![0])).正文统计
    expect(stats).toMatchObject({
      稿件: '草稿区/草稿/卷01-回写验收/稿1.md', 版本: 3,
      审读指纹: expectedFingerprint, 审稿哈希: computeReview(root, key).record!.审稿哈希,
      字符数: 7, 非空白字符数: 7, 汉字数: 6,
    })
    expect(stats.统计口径).toContain('不含 frontmatter 和草稿候选事实')
    expect(computeReview(root, key).正文统计).toEqual(stats)
    const packed = computePack(root, key)
    expect(packed.ok).toBe(true)
    const finalized = parseDocument(packed.文件!.find(op => op.relPath.endsWith('/正文.md'))!.content)
    expect(finalized.ok && finalized.data.fields['字数统计']).toEqual({ 字符数: stats.字符数, 汉字数: stats.汉字数 })
    const payloads = (materials ? result.回写载荷 : result) as Array<{ 模块名: string; 审读指纹: string; 发现项: unknown[] }>
    expect(payloads.length).toBeGreaterThan(0)
    expect(fs.existsSync(path.join(root, '草稿区/审核'))).toBe(false)
    for (const payload of payloads) {
      expect(payload.审读指纹).toBe(expectedFingerprint)
      expect(ingestFindings(root, key, payload.模块名, payload.发现项, payload.审读指纹).ok).toBe(true)
    }
    const recordPath = path.join(root, '草稿区/审核/卷01-回写验收.json')
    const before = fs.readFileSync(recordPath, 'utf8')
    fs.writeFileSync(draft, serializeDocument({ 角色: '待审稿' }, '主角走出城门，发现了另一条线索。'))
    const fresh = computeReview(root, key).正文统计!
    expect(fresh.审读指纹).not.toBe(stats.审读指纹)
    expect(fresh.汉字数).toBe(14)
    for (const payload of payloads) {
      expect(ingestFindings(root, key, payload.模块名, payload.发现项, payload.审读指纹).ok).toBe(false)
    }
    expect(fs.readFileSync(recordPath, 'utf8')).toBe(before)
  })

  it.each([0, 2])('%s 份待审稿时拒绝，不输出可被误用的统计', (drafts) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-review-cli-'))
    roots.push(root)
    const dir = path.join(root, '草稿区/草稿/卷01-回写验收')
    fs.mkdirSync(dir, { recursive: true })
    for (let i = 1; i <= drafts; i++) fs.writeFileSync(path.join(dir, `稿${i}.md`), serializeDocument({ 角色: '待审稿' }, '正文'))
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(runChecksCli(['--book', root, '--卷', '1', '--章', '1', '--章名', key.章名, '--审读材料', 'true'])).toBe(1)
    expect(output).not.toHaveBeenCalled()
    expect(computeReview(root, key).正文统计).toBeUndefined()
  })
})
