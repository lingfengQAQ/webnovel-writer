import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { seedMinDesign, serializeDocument } from '@webnovel/core'
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
  it.each([false, true])('审读材料=%s：每个载荷绑定实际输入，原样可回写，换稿后拒绝重放', (materials) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-review-cli-'))
    roots.push(root)
    seedMinDesign(root)
    const draft = path.join(root, '草稿区/草稿/卷01-回写验收/稿1.md')
    fs.mkdirSync(path.dirname(draft), { recursive: true })
    fs.writeFileSync(draft, serializeDocument({ 角色: '待审稿' }, '主角走进城门。'))
    const expectedFingerprint = computeReview(root, key).record!.审读指纹
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(runChecksCli(['--book', root, '--卷', '1', '--章', '1', '--章名', key.章名,
      ...(materials ? ['--审读材料', 'true'] : [])])).toBe(0)
    const result = JSON.parse(String(output.mock.calls.at(-1)![0]))
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
    for (const payload of payloads) {
      expect(ingestFindings(root, key, payload.模块名, payload.发现项, payload.审读指纹).ok).toBe(false)
    }
    expect(fs.readFileSync(recordPath, 'utf8')).toBe(before)
  })
})
