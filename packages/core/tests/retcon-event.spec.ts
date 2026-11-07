import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { nextProposalNumber, parseDocument, retconEventOps } from '../src/index'
import { removeSync } from '../src/repo/remove'

const temporary = fs.realpathSync.native(os.tmpdir())
let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(temporary, 'webnovel-retcon-event-')) })
afterEach(() => {
  if (path.dirname(root) !== temporary || !path.basename(root).startsWith('webnovel-retcon-event-')) throw new Error('Unexpected fixture path')
  removeSync(root)
})

const input = { 卷: 2, 摘要: '更正身份。', 账本留痕: '原错误已更正，其他事实保留。' }

describe('RW06: production retcon event metadata roundtrip', () => {
  it('serializes the proposal, affected paths and ISO date while preserving the body', () => {
    const affected = ['定稿/卷02/0017-身份.md', '世界书/人物档案/甲.md@3']
    const before = Date.now()
    const event = retconEventOps(root, { ...input, 提案编号: '0007', 受影响工件: affected })
    const after = Date.now()
    const doc = parseDocument(event.content)
    expect(doc.ok).toBe(true)
    if (!doc.ok) throw new Error(doc.detail)
    expect(doc.data.fields).toMatchObject({ 关联提案: '0007', 受影响工件: affected, 日期: expect.any(String) })
    const date = doc.data.fields['日期'] as string
    expect(new Date(date).toISOString()).toBe(date)
    expect(Date.parse(date)).toBeGreaterThanOrEqual(before)
    expect(Date.parse(date)).toBeLessThanOrEqual(after)
    expect(doc.data.body).toBe('# 补偿事件记录\n\n更正身份。\n\n## 账本留痕\n\n原错误已更正，其他事实保留。\n')
    expect(event.relPath).toBe('定稿/卷02/补偿/补偿-0001.md')
  })

  it('makes the missing-proposal state explicit and preserves an empty affected list', () => {
    const event = retconEventOps(root, { ...input, 受影响工件: [] })
    const doc = parseDocument(event.content)
    expect(doc.ok && doc.data.fields['关联提案']).toBe('（未登记提案）')
    expect(doc.ok && doc.data.fields['受影响工件']).toEqual([])
  })

  it('prepares without creating directories, files or consuming a number', () => {
    const first = retconEventOps(root, { ...input, 受影响工件: ['定稿/卷02/0017-身份.md'] })
    expect(fs.readdirSync(root)).toEqual([])
    expect(nextProposalNumber(root)).toBe(1)
    expect(retconEventOps(root, { ...input, 受影响工件: [] }).relPath).toBe(first.relPath)
    expect(fs.readdirSync(root)).toEqual([])
  })

  it('keeps the shared number pool and never overwrites an existing event', () => {
    const existing = path.join(root, '定稿/卷02/补偿/补偿-0008.md')
    fs.mkdirSync(path.dirname(existing), { recursive: true })
    fs.writeFileSync(existing, '原补偿记录，不得覆盖。\n', 'utf8')
    const event = retconEventOps(root, { ...input, 提案编号: '0007', 受影响工件: ['定稿/卷02/0017-身份.md'] })
    expect(event.relPath).toBe('定稿/卷02/补偿/补偿-0009.md')
    expect(fs.readFileSync(existing, 'utf8')).toBe('原补偿记录，不得覆盖。\n')
    expect(fs.existsSync(path.join(root, event.relPath))).toBe(false)
    const doc = parseDocument(event.content)
    expect(doc.ok && doc.data.fields['关联提案']).toBe('0007')
  })
})
