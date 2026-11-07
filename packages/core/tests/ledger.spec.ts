import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  LEDGER_NAMES,
  MEMORY_KINDS,
  paths,
  queryLedger,
  queryMemory,
  seedMinDesign,
  writeFileAtomic,
} from '../src/index'

const roots: string[] = []

function mkBook(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-ledger-query-'))
  roots.push(root)
  seedMinDesign(root)
  for (const name of LEDGER_NAMES) {
    writeFileAtomic(root, paths.账本(name), `# ${name}\n`)
  }
  return root
}

afterAll(() => { for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

describe('故事账本查询', () => {
  it('查询五类账本并支持分类/状态筛选', () => {
    const root = mkBook()
    writeFileAtomic(root, paths.账本('故事线'), '# 故事线\n\n## 主线启动\n状态：进行中\n计划来源：卷纲#1\n')
    writeFileAtomic(root, paths.账本('人物弧线'), '# 人物弧线\n\n## 主角警觉\n状态：已兑现\n计划来源：卷纲#2\n')
    writeFileAtomic(root, paths.账本('承诺'), '# 承诺\n\n## 查明异响\n状态：进行中\n计划来源：卷纲#3\n')
    writeFileAtomic(root, paths.账本('线索'), '# 线索\n\n## 纸鹤\n状态：已埋\n计划来源：卷纲#4\n埋设点：第1章\n预期兑现区间：第8-12章\n')
    writeFileAtomic(root, paths.账本('时间线'), '# 时间线\n\n## 城门异响\n事件：发现异常\n章号：第0001章\n')

    const all = queryLedger(root)
    expect(all.ok).toBe(true)
    if (!all.ok) return
    expect(all.files).toEqual(LEDGER_NAMES.map((name) => paths.账本(name)))
    expect(all.entries.map((entry) => entry.名称)).toEqual(['主线启动', '主角警觉', '查明异响', '纸鹤', '城门异响'])
    const active = queryLedger(root, { 状态: '进行中' })
    expect(active.ok).toBe(true)
    if (active.ok) expect(active.entries.map((entry) => entry.名称)).toEqual(['主线启动', '查明异响'])
    const timeline = queryLedger(root, { 分类: '时间线' })
    expect(timeline.ok).toBe(true)
    if (timeline.ok) expect(timeline.entries[0]?.字段['事件']).toBe('发现异常')
  })

  it('旧格式记忆明确拒绝，混合时保留当前条目', () => {
    const root = mkBook()
    for (const 类 of MEMORY_KINDS) {
      if (类 === '灵感') continue
      writeFileAtomic(root, paths.记忆(类), `# ${类}\n\n## 条目-${类}\n类：${类}\n状态：已确认\n`)
    }
    const partial = queryMemory(root, { 类: '文风' })
    expect(partial).toMatchObject({ ok: false, kind: 'parse-error', entries: [] })
    // 新格式一事一文件:条目文件带 类 字段,不标旧
    writeFileAtomic(root, paths.本书记忆条目('克制叙述'), '---\n名称: 克制叙述\n类: 文风\n状态: 已确认\n来源: x\n---\n短句。\n')
    const mixed = queryMemory(root, { 类: '文风' })
    expect(mixed).toMatchObject({ ok: false, kind: 'parse-error' })
    expect(mixed.entries.map(entry => entry.名称)).toEqual(['克制叙述'])
  })
})
