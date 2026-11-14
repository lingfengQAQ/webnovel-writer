import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createNovelTools, type NovelToolsDeps } from '../src/novel-tools'
import { APPROVE_LABEL, REJECT_LABEL, type AskRequest, type AskResponse } from '@webnovel/core'
import { removeSync } from '../../core/src/repo/remove'
import { settlementPack } from './fixtures/settlement-pack'

const roots: string[] = []
function mkWs(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-settle-'))
  roots.push(dir)
  return dir
}
afterAll(() => { for (const r of roots) removeSync(r) })

const AGENT = { agent: { id: 'agent-1', session: { append: () => {} } } }
const CONCEPT = {
  状态: '已确认',
  核心创意: 'x', 题材与目标读者: 'x', 主角核心欲望: 'x', 主要冲突: 'x',
  核心看点: 'x', 差异化方向: 'x', 明确不要什么: 'x',
}

async function setup(ask?: NovelToolsDeps['askFn']) {
  const ws = mkWs()
  const tools = createNovelTools({
    workspaceRoot: () => ws,
    bookRootOfBookId: () => path.join(ws, '审批书'),
    askFn: ask,
  })
  const call = async (name: string, args: Record<string, unknown>) => {
    const tool = tools.find((t) => t.name === name)!
    return (await tool.execute(args, AGENT)) as Record<string, unknown> & { ok: boolean }
  }
  const created = await call('novel_create_book', { bookName: '审批书', concept: CONCEPT }) as { bookId: string }
  settlementPack(path.join(ws, '审批书'), created.bookId, KEY)
  return { call, bookId: created.bookId }
}

const KEY = { 卷: 1, 章: 1, 章名: '第一章', summary: 'x' }

describe('定稿沉淀:作者审批不可由模型自证（裁决 11/14）', () => {
  it('未注入 askFn:拒绝沉淀,不落任何文件', async () => {
    const { call, bookId } = await setup(undefined)
    const r = await call('novel_settle_chapter', { bookId, ...KEY })
    expect(r.ok).toBe(false)
    expect(String(r.reason)).toContain('裁决通道')
  })

  it('作者驳回:拒绝沉淀', async () => {
    const { call, bookId } = await setup(async () => ({ answers: [{ id: '定稿入档', selected: [REJECT_LABEL] }] }))
    const r = await call('novel_settle_chapter', { bookId, ...KEY })
    expect(r.ok).toBe(false)
    expect(String(r.reason)).toContain('未获作者批准')
  })

  it('作者批准:按实际定稿包进入沉淀', async () => {
    let seen: AskRequest | undefined
    const { call, bookId } = await setup(async (req): Promise<AskResponse> => {
      seen = req
      return { answers: [{ id: '定稿入档', selected: [APPROVE_LABEL] }] }
    })
    const r = await call('novel_settle_chapter', { bookId, ...KEY })
    expect(seen, 'askFn 应被调用').toBeDefined()
    expect(seen!.questions[0]?.id).toBe('定稿入档')
    expect(r.ok, String(r.reason)).toBe(true)
  })

  it('模型无法用参数绕过:裁决记录 已不是入参', async () => {
    const { call, bookId } = await setup(undefined)
    const tools = createNovelTools({ workspaceRoot: () => '', bookRootOfBookId: () => undefined })
    const settle = tools.find((t) => t.name === 'novel_settle_chapter')!
    const required = (settle.parameters as { required: string[] }).required
    expect(required).not.toContain('裁决记录')
    const r = await call('novel_settle_chapter', { bookId, ...KEY, 裁决记录: '作者说可以' })
    expect(r.ok).toBe(false)
  })
})
