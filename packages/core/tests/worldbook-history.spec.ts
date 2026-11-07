import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseWorldbookHistory, planSettlement, writeBatchAtomic, type SettlementMode } from '../src/index'
import { removeSync } from '../src/repo/remove'

const temporary = fs.realpathSync.native(os.tmpdir())
const entry = '世界书/人物档案/林舟.md'
let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(temporary, 'webnovel-worldbook-history-'))
  fs.mkdirSync(path.join(root, '世界书/人物档案'), { recursive: true })
})
afterEach(() => {
  if (path.dirname(root) !== temporary || !path.basename(root).startsWith('webnovel-worldbook-history-')) throw new Error('Unexpected fixture path')
  removeSync(root)
})

function settle(章: number, 章名: string, body: string, mode: SettlementMode = '追加'): string {
  const dir = path.join(root, '草稿区/定稿准备/历史')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, '事实变更.md'), `# 事实变更\n## 人物档案\n### 林舟\n${body}\n`, 'utf8')
  const key = { 卷: 1, 章, 章名 }
  const planned = planSettlement(root, dir, { 章节: key, 批准: true, 裁决记录: '测试批准' }, key, mode)
  expect(planned.ok).toBe(true)
  if (planned.ok) writeBatchAtomic(root, planned.ops)
  return fs.readFileSync(path.join(root, entry), 'utf8')
}

describe('世界书事实段只读历史', () => {
  it('沉淀新建首段与逐章追加按段读出，行号指向原文件', () => {
    settle(1, '初见', '守着渡口。')
    const raw = settle(8, '决裂', '与沈青决裂。')
    const history = parseWorldbookHistory(raw)
    expect(history.ok).toBe(true)
    if (!history.ok) return
    expect(history.data.字段).toMatchObject({ 名称: '林舟', 性质: '事实', 来源: '定稿/卷01/0001-初见.md' })
    expect(history.data.首段).toBe('守着渡口。')
    expect(history.data.追加).toEqual([{ 章: 8, 来源: '定稿/卷01/0008-决裂.md', 正文: '与沈青决裂。', 行号: raw.split('\n').indexOf('### 事实@第0008章') + 1 }])
    expect(fs.readFileSync(path.join(root, entry), 'utf8')).toBe(raw)
  })

  it('吃书更正整文替换后，被替换的追加段不再出现', () => {
    settle(1, '初见', '守着渡口。')
    settle(8, '决裂', '与沈青决裂。')
    const history = parseWorldbookHistory(settle(8, '决裂', '守着渡口，后与沈青和解。', '更正'))
    expect(history.ok && history.data.首段).toBe('守着渡口，后与沈青和解。')
    expect(history.ok && history.data.追加).toEqual([])
  })

  it('围栏、其他标题与缺来源的追加按原文保留，CRLF 不影响行号', () => {
    const lines = ['首段。', '~~~', '### 事实@第0009章', '~~~', '## 事实@第0002章', '### 事实@第0003章', '第三章事实。', '### 备注', '仍属第三章段。']
    expect(parseWorldbookHistory(lines.join('\r\n'))).toEqual({ ok: true, data: {
      字段: {},
      首段: lines.slice(0, 5).join('\n'),
      追加: [{ 章: 3, 正文: '第三章事实。\n### 备注\n仍属第三章段。', 行号: 6 }],
    } })
  })

  it('未闭合围栏之后不再分段，坏文件头返回解析失败', () => {
    const unclosed = parseWorldbookHistory('首段。\n```\n### 事实@第0002章\n后文。')
    expect(unclosed.ok && unclosed.data.追加).toEqual([])
    expect(parseWorldbookHistory('---\n名称: [\n---\n正文')).toMatchObject({ ok: false, reason: 'parse-error' })
  })
})
