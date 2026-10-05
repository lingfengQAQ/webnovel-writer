import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { syncBuiltinESMExports } from 'node:module'
import { computeMaterials, contractTemplate, loadReviewRecord, scanChapter, seedMinDesign, serializeDocument, writeContract } from '@webnovel/core'
import { computeReview, ingestFindings, listChecks, resetChecks, runReview } from '../src/index'
import { removeSync } from '../../core/src/repo/remove'

const roots: string[] = []
const key = { 卷: 1, 章: 1, 章名: '开篇任务' }
const rule = (max = 2400) => `### 章节篇幅\n- 目标汉字数: 2000\n- 下限汉字数: 1600\n- 上限汉字数: ${max}`
const source = (max = 2400) => contractTemplate({ 阅读体验与情绪承诺: { state: '已确认', body: rule(max) } })
beforeEach(resetChecks)
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); roots.splice(0).forEach(removeSync) })
function book() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-length-'))
  roots.push(root)
  seedMinDesign(root)
  writeContract(root, { 阅读体验与情绪承诺: { state: '已确认', body: rule() } })
  const dir = path.join(root, '草稿区/草稿/卷01-开篇任务')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, '稿1.md'), serializeDocument({ 角色: '待审稿', 版本: 1 }, '甲'.repeat(2500) + '\n\n## 草稿候选事实\n- 事实：不计入'))
  fs.mkdirSync(path.join(root, '大纲/卷规划/卷01/章细纲'), { recursive: true })
  fs.writeFileSync(path.join(root, '大纲/卷规划/卷01/章细纲/0001-开篇任务.md'), serializeDocument({ 状态: '已确认', 版本: 1 }, '# 章细纲\n\n## 定位段\n\n### 章节功能\n完成一场交锋。'))
  return root
}

describe('篇幅沿用现有审读处置', () => {
  it('只给原文本规范模块普通发现项，作者保留及重跑沿用，备料包含同一约定', () => {
    const root = book()
    const result = computeReview(root, key)
    expect(result.篇幅核对).toMatchObject({ 结果: '偏长', 实测汉字数: 2500, 差额: 100 })
    const finding = result.record!.问题.find(f => f.问题说明.startsWith('正文篇幅'))!
    expect(finding).toMatchObject({ 模块名: '文本规范检查', 是否建议阻断: false, 处置状态: '待处理' })
    expect(listChecks().filter(c => c.执行形态 === '确定性代码')).toHaveLength(2)
    expect(ingestFindings(root, key, '文本规范检查', [{ ...finding, 处置状态: '作者保留', 处置: '作者保留', 处置说明: '这场交锋保留完整。' }], result.record!.审读指纹).ok).toBe(true)
    expect(computeReview(root, key).record!.问题.find(f => f.问题说明.startsWith('正文篇幅'))).toMatchObject({ 处置状态: '作者保留', 处置说明: '这场交锋保留完整。' })
    const material = computeMaterials(root, key)
    expect(material.文件?.some(op => op.content.includes('目标汉字数：2000') && op.content.includes('上限汉字数：2400'))).toBe(true)
    expect(scanChapter(root, key).审核证据过期).toBe(false)
  })

  it('改契约后恢复扫描与回写都拒绝旧范围证据；重跑使用新上限', () => {
    const root = book()
    const old = runReview(root, key)
    expect(scanChapter(root, key).审核证据过期).toBe(false)
    writeContract(root, { 阅读体验与情绪承诺: { state: '已确认', body: rule(2600) } })
    expect(scanChapter(root, key).审核证据过期).toBe(true)
    expect(ingestFindings(root, key, '文本规范检查', [], old.record!.审读指纹).ok).toBe(false)
    const fresh = runReview(root, key)
    expect(fresh.篇幅核对?.结果).toBe('范围内')
    expect(fresh.record!.问题.some(f => f.问题说明.startsWith('正文篇幅'))).toBe(false)
    expect(scanChapter(root, key).审核证据过期).toBe(false)
  })

  it('契约读取后发生修改，核对与指纹仍绑定读入的同一快照', () => {
    const root = book()
    const target = path.join(root, '作品契约/契约.md')
    const original = fs.readFileSync
    let changed = false
    vi.spyOn(fs, 'readFileSync').mockImplementation((...args: Parameters<typeof fs.readFileSync>) => {
      const content = original(...args)
      if (!changed && path.normalize(String(args[0])) === path.normalize(target)) {
        changed = true
        fs.writeFileSync(target, source(2600))
      }
      return content
    })
    syncBuiltinESMExports()
    const old = computeReview(root, key)
    expect(changed).toBe(true)
    expect(old.篇幅核对?.结果).toBe('偏长')
    expect(ingestFindings(root, key, '文本规范检查', [], old.record!.审读指纹).ok).toBe(false)
    expect(loadReviewRecord(root, key)).toBeNull()
  })

  it.each(['未配置', '未确认', '配置错误'] as const)('%s 明示，不伪造达标或正文超长', (state) => {
    const root = book()
    const content = state === '未配置' ? contractTemplate() : state === '未确认'
      ? contractTemplate({ 阅读体验与情绪承诺: { state: '暂定', body: rule() } }) : source().replace('1600', '-1')
    fs.writeFileSync(path.join(root, '作品契约/契约.md'), content)
    const result = computeReview(root, key)
    expect(result.篇幅核对?.结果).toBe(state)
    expect(result.record!.问题.some(f => f.问题说明.startsWith('正文篇幅'))).toBe(false)
    if (state === '配置错误') expect(result.record!.问题.some(f => f.问题说明.startsWith('作品契约章节篇幅配置错误'))).toBe(true)
  })
})
