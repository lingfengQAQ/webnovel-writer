import { afterAll, describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { removeSync } from '../../core/src/repo/remove'
import { createNovelTools } from '../src/novel-tools'
import { APPROVE_LABEL, seedMinDesign, serializeDocument, paths, scanChapter, loadReviewRecord } from '../../core/src/index'
import { computeReview, listChecks, resetChecks, registerDefaultChecks } from '../../review/src/index'

const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-approval-snapshot-'))
afterAll(() => removeSync(fixtures))
fs.mkdirSync(fixtures, { recursive: true })
const key = { 卷: 1, 章: 1, 章名: '开篇任务' }
function pending(root: string, text: string) {
  const dir = path.join(root, paths.草稿目录(1, key.章名))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, '稿1.md'), serializeDocument({ 角色: '待审稿', 选定: true }, text))
}

describe('Adversarial workflow probes', () => {
  it('F04 rejects a replacement package generated while the author approval is pending', async () => {
    const ws = fs.mkdtempSync(path.join(fixtures, 'approval-'))
    const root = path.join(ws, '审查书')
    let bookId = ''
    let requests = 0
    const agent = { agent: { id: 'audit-agent', session: { append() {} } } }
    const tools = createNovelTools({
      workspaceRoot: () => ws,
      bookRootOfBookId: () => root,
      askFn: async () => {
        requests++
        // Another valid writer regenerates the pack after approval was requested.
        expect((await call('novel_import_draft', { bookId, ...key, 正文: '版本 B：作者尚未审阅的正文。', 角色: '待审稿' })).ok).toBe(true)
        expect((await call('novel_prepare_pack', { bookId, ...key })).ok).toBe(true)
        return { answers: [{ id: '定稿入档', selected: [APPROVE_LABEL] }] }
      },
    })
    const call = async (name: string, args: Record<string, unknown>) => await tools.find(t => t.name === name)!.execute(args, agent) as any
    const created = await call('novel_create_book', { bookName: '审查书', concept: {
      状态: '已确认', 核心创意: 'x', 题材与目标读者: 'x', 主角核心欲望: 'x', 主要冲突: 'x', 核心看点: 'x', 差异化方向: 'x', 明确不要什么: 'x',
    } })
    expect(created.ok, JSON.stringify(created)).toBe(true)
    bookId = created.bookId
    expect((await call('novel_import_draft', { bookId, ...key, 正文: '版本 A：作者已经审阅的正文。', 角色: '待审稿' })).ok).toBe(true)
    expect((await call('novel_prepare_pack', { bookId, ...key })).ok).toBe(true)
    const result = await call('novel_settle_chapter', { bookId, ...key, summary: '作者批准 A' })
    expect(result.ok, JSON.stringify(result)).toBe(false)
    expect(result.reason).toContain('等待作者裁决期间已变化')
    expect(fs.existsSync(path.join(root, paths.定稿章(1, 1, key.章名)))).toBe(false)
    expect(requests).toBe(1)
  })

  it('F10 distinguishes module completion from unresolved review findings', async () => {
    resetChecks(); registerDefaultChecks()
    const root = fs.mkdtempSync(path.join(fixtures, 'review-message-'))
    seedMinDesign(root)
    pending(root, '正文。')
    const tools = createNovelTools({ workspaceRoot: () => path.dirname(root), bookRootOfBookId: () => root })
    const recordTool = tools.find(t => t.name === 'novel_record_review_findings')!
    const names = listChecks().filter(c => c.执行形态 !== '作者').map(c => c.名称)
    const fingerprint = computeReview(root, key).record!.审读指纹!
    let result: any
    for (const [i, name] of names.entries()) result = await recordTool.execute({ bookId: 'audit', ...key, 审读指纹: fingerprint, 模块名: name, 发现项: i === 0 ? [{ 问题说明: '主角死亡违反不可妥协条款', 是否建议阻断: true, 严重程度: '严重', 处置状态: '待处理' }] : [] }, {})
    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect(result).toMatchObject({ 完成: true, 审核通过: false, 待处置数: 1 })
    expect(result.message).toContain('审核尚未通过')
    expect(loadReviewRecord(root, key)!.问题[0]!.处置状态).toBe('待处理')
    expect(scanChapter(root, key).审核完成).toBe(false)
  })
})
