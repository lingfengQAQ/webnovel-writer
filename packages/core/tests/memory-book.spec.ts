import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  paths,
  queryMemory,
  rebuildBookMemoryIndex,
  writeBookMemory,
  writeFileAtomic,
  parseDocument,
} from '../src/index'

const roots: string[] = []
function mkDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  roots.push(dir)
  return dir
}
afterAll(() => { for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 句柄延迟释放，%TEMP% 残留无害 */ } } })

describe('本书记忆一事一文件(A10)', () => {
  it('描述进入条目与索引，后续未提供描述时保留已有值', () => {
    const root = mkDir('webnovel-memory-description-')
    const input = { 类: '决策' as const, 名称: '拒绝内卫', 来源: '对谈', 裁决记录: '批准', 正文: '不加入内卫。' }
    expect(writeBookMemory(root, { ...input, 描述: '主角阵营边界' }).ok).toBe(true)
    expect(writeBookMemory(root, { ...input, 正文: '不加入内卫，也不接受招揽。' }).ok).toBe(true)
    const doc = parseDocument(fs.readFileSync(path.join(root, '本书记忆/拒绝内卫.md'), 'utf8'))
    expect(doc.ok && doc.data.fields['描述']).toBe('主角阵营边界')
    expect(fs.readFileSync(path.join(root, '本书记忆/索引.md'), 'utf8')).toContain('主角阵营边界｜类：决策')
    expect(writeBookMemory(root, { ...input, 描述: '多行\n描述' }).ok).toBe(false)
  })
  it('写入后条目文件存在、索引含该行;queryMemory 可读', () => {
    const root = mkDir('webnovel-membook-')
    const r = writeBookMemory(root, {
      类: '文风',
      名称: '克制叙述',
      正文: '短句，少解释性旁白。例：他没有回头。',
      来源: '定稿/卷01/0001-开篇任务.md',
      裁决记录: '作者批准首章沉淀',
    })
    expect(r.ok).toBe(true)
    const entryText = fs.readFileSync(path.join(root, '本书记忆/克制叙述.md'), 'utf-8')
    expect(entryText).toContain('短句，少解释性旁白')
    expect(entryText).toContain('状态: 已确认')
    const indexText = fs.readFileSync(path.join(root, '本书记忆/索引.md'), 'utf-8')
    expect(indexText).toContain('[克制叙述]')
    expect(indexText).toContain('类：文风')

    const q = queryMemory(root, { 类: '文风' })
    expect(q.ok).toBe(true)
    if (q.ok) {
      expect(q.entries.find((entry) => entry.名称 === '克制叙述')?.正文).toContain('他没有回头')
      expect(q.entries.find((entry) => entry.名称 === '克制叙述')?.格式).toBeUndefined()
    }
  })

  it('rebuildBookMemoryIndex 幂等:重建两次索引内容不变', () => {
    const root = mkDir('webnovel-membook-rebuild-')
    writeBookMemory(root, { 类: '决策', 名称: '开篇视角', 正文: '主角限知。', 来源: 'x', 裁决记录: 'y' })
    const first = fs.readFileSync(path.join(root, paths.本书记忆索引()), 'utf-8')
    rebuildBookMemoryIndex(root)
    const second = fs.readFileSync(path.join(root, paths.本书记忆索引()), 'utf-8')
    expect(second).toBe(first)
    rebuildBookMemoryIndex(root)
    expect(fs.readFileSync(path.join(root, paths.本书记忆索引()), 'utf-8')).toBe(first)
  })

  it('旧仓只有 本书记忆/文风.md 时 queryMemory 仍返回条目并标旧格式', () => {
    const root = mkDir('webnovel-membook-old-')
    writeFileAtomic(root, paths.记忆('文风'), '# 文风\n\n## 旧条目\n状态：已确认\n### 正文\n旧文风记忆。\n')
    const q = queryMemory(root, { 类: '文风' })
    expect(q.ok).toBe(true)
    if (q.ok) {
      expect(q.entries.find((entry) => entry.名称 === '旧条目')?.正文).toContain('旧文风记忆')
      expect(q.entries.find((entry) => entry.名称 === '旧条目')?.格式).toBe('旧')
    }
  })

  it('条目名为「索引」或为空被拒', () => {
    const root = mkDir('webnovel-membook-guard-')
    expect(writeBookMemory(root, { 类: '文风', 名称: '索引', 正文: 'x', 来源: 'x', 裁决记录: 'x' }).ok).toBe(false)
    expect(writeBookMemory(root, { 类: '文风', 名称: '  ', 正文: 'x', 来源: 'x', 裁决记录: 'x' }).ok).toBe(false)
  })

  it('拒绝与旧分类文件同名的新条目，保留全部旧记忆及索引', () => {
    const root = mkDir('webnovel-membook-collision-')
    const legacy = '# 文风\n\n## 旧条目甲\n状态：已确认\n### 正文\n甲原文。\n\n## 旧条目乙\n状态：已确认\n### 正文\n乙原文。\n'
    writeFileAtomic(root, paths.记忆('文风'), legacy)
    writeFileAtomic(root, paths.本书记忆索引(), '# 作者已有索引\n')
    expect(writeBookMemory(root, { 类: '文风', 名称: '文风', 正文: '新记忆', 来源: 'x', 裁决记录: 'y' }))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/旧格式|冲突/) })
    expect(fs.readFileSync(path.join(root, paths.记忆('文风')), 'utf8')).toBe(legacy)
    expect(fs.readFileSync(path.join(root, paths.本书记忆索引()), 'utf8')).toBe('# 作者已有索引\n')
    expect(queryMemory(root, { 类: '文风' }).entries.map(entry => entry.名称)).toEqual(['旧条目甲', '旧条目乙'])
  })

  it.each(['---\n类: 文风\n名称: 别的名称\n---\n原文\n', '---\n类: 未知\n名称: 同名\n---\n原文\n', '---\n名称: [坏格式\n---\n原文\n'])('无法确认的一事一文件格式不被覆盖', (original) => {
    const root = mkDir('webnovel-membook-unknown-')
    writeFileAtomic(root, paths.本书记忆条目('同名'), original)
    expect(writeBookMemory(root, { 类: '文风', 名称: '同名', 正文: '替换', 来源: 'x', 裁决记录: 'y' }).ok).toBe(false)
    expect(fs.readFileSync(path.join(root, paths.本书记忆条目('同名')), 'utf8')).toBe(original)
  })
})
