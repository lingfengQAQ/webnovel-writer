import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'
import { DOCUMENT_CONTRACTS, classifyDocumentPath, type DocumentUnitId } from '../src/repo/document-types'
import { paths, MEMORY_KINDS } from '../src/repo/paths'
import { isNumberedDraftPath } from '../src/repo/drafts'
import { 材料包十段, sectionFileName } from '../src/assembly/sections'
import { supplementFile } from '../src/assembly/read'
import { 待定稿包七件 } from '../src/prepare/pack'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const hash = 'a'.repeat(64)
const pathCases: readonly (readonly [string, readonly DocumentUnitId[]])[] = [
  [paths.契约(), ['I01']], [paths.构想快照(), ['I02']], [paths.故事骨架(), ['I03']], [paths.分卷布局(), ['I04']],
  [paths.卷纲(1), ['I05']], [paths.计划时间线(1), ['I06']], [paths.近期窗口(1), ['I07']],
  [paths.候选细纲(1, '渡口'), ['I08']], [paths.确认细纲(1, 1, '渡口'), ['I09']],
  ['世界书/模块声明.md', ['I10']], ['世界书/人物档案/主角.md', ['I11']], ['世界书/人物关系/结盟.md', ['I11', 'I12']],
  ...(['故事线', '人物弧线', '承诺'] as const).map(kind => [paths.账本(kind), ['I13']] as const),
  [paths.账本('线索'), ['I14']], [paths.账本('时间线'), ['I15']], [paths.定稿章(1, 1, '渡口'), ['I16']],
  [paths.章摘要(1, 1, '渡口'), ['I17']], [paths.卷摘要(1), ['I18']], [paths.本书记忆条目('克制'), ['I19']],
  [paths.本书记忆索引(), ['I20']], ...MEMORY_KINDS.map(kind => [paths.记忆(kind), ['I19', 'I21']] as const),
  [`${paths.草稿目录(1, '渡口')}/稿1.md`, ['I22']],
  [`${paths.材料包目录(1, '渡口')}/${sectionFileName(0, 材料包十段[0])}`, ['I23']],
  [`${paths.材料包目录(1, '渡口')}/材料清单.json`, ['I24']],
  [`${paths.材料包目录(1, '渡口')}/${supplementFile('ref_1')}`, ['I24']],
  [paths.审核记录(1, '渡口'), ['I25']], [`${paths.待定稿包目录(1, '渡口')}/清单.json`, ['I26']],
  ['草稿区/批次/下一批/批次.json', ['I27']], ['草稿区/提案/0001-修改计划.md', ['I28']],
  ['定稿/卷01/补偿/补偿-0001.md', ['I29']], [`草稿区/.archive-receipts/${hash}.json`, ['I30']],
  ['.webnovel/finalized-search.sqlite', ['I32']], ['.webnovel/finalized-scenes.json', ['I33']],
  ['.webnovel/finalized-search-state.json', ['I34']], ['草稿区/.author-edits/save-operation-0001.json', ['I35']],
]

describe('document contract directory', () => {
  it('enumerates all 35 distinct audit units without claiming universal validation', () => {
    expect(Object.keys(DOCUMENT_CONTRACTS)).toEqual(Array.from({ length: 35 }, (_, i) => `I${String(i + 1).padStart(2, '0')}`))
    for (const [id, item] of Object.entries(DOCUMENT_CONTRACTS)) {
      expect(item.id).toBe(id)
      expect(item.title).not.toBe('')
      expect(item.fieldDefinitionSources.length).toBeGreaterThan(0)
      expect(item).not.toHaveProperty('validate')
    }
    expect(DOCUMENT_CONTRACTS.I27).toMatchObject({ implementation: 'declared-only', validation: 'not-implemented', producers: [], consumers: [] })
    expect(DOCUMENT_CONTRACTS.I31).toMatchObject({ storage: 'protocol', validation: 'syntax-only' })
    expect(DOCUMENT_CONTRACTS.I32.storage).toBe('derived')
    expect(DOCUMENT_CONTRACTS.I33.storage).toBe('derived')
    expect(DOCUMENT_CONTRACTS.I34.storage).toBe('runtime-control')
  })

  it('keeps navigation references grounded in actual code or the declared-only document', () => {
    for (const item of Object.values(DOCUMENT_CONTRACTS)) {
      for (const reference of [...item.producers, ...item.consumers, ...item.fieldDefinitionSources]) {
        expect(reference.file.startsWith('packages/') || reference.file.startsWith('docs/')).toBe(true)
        const text = fs.readFileSync(path.join(repo, reference.file), 'utf8')
        expect(reference.symbols.length).toBeGreaterThan(0)
        for (const symbol of reference.symbols) expect(text, `${item.id}: ${reference.file}#${symbol}`).toContain(symbol)
      }
    }
  })

  it.each(pathCases)('routes %s to the evidenced candidate units', (relative, units) => {
    expect(classifyDocumentPath(relative)?.units).toEqual(units)
    expect(classifyDocumentPath(relative)).not.toHaveProperty('valid')
    expect(classifyDocumentPath(relative)).not.toHaveProperty('version')
  })

  it('needs content to distinguish current from legacy memory and optional relationships', () => {
    expect(classifyDocumentPath('本书记忆/文风.md')).toEqual({ units: ['I19', 'I21'], requiresContent: true, pathForm: 'current' })
    expect(classifyDocumentPath('本书记忆/当前文风.md')?.requiresContent).toBe(true)
    expect(classifyDocumentPath('世界书/人物关系/主角与渡者.md')).toMatchObject({ units: ['I11', 'I12'], requiresContent: true })
    expect(classifyDocumentPath('世界书/其他模块/关系.md')?.units).toEqual(['I11'])
  })

  it('recognizes the exact prepared package and material filenames from real producers', () => {
    for (const file of [...待定稿包七件, '清单.json']) {
      expect(classifyDocumentPath(`${paths.待定稿包目录(1, '渡口')}/${file}`)?.units).toEqual(['I26'])
      expect(classifyDocumentPath(`草稿区/提案/retcon-${hash}/${file}`)?.units).toEqual(['I26'])
    }
    for (const [index, section] of 材料包十段.entries()) {
      expect(classifyDocumentPath(`${paths.材料包目录(1, '渡口')}/${sectionFileName(index, section)}`)?.units).toEqual(['I23'])
    }
  })

  it('does not impose two-digit volume or four-digit chapter maxima', () => {
    for (const relative of [paths.卷纲(123), paths.确认细纲(123, 12345, '远行'), paths.定稿章(123, 12345, '远行'), paths.候选细纲(123, '远行')]) {
      expect(classifyDocumentPath(relative)).toBeDefined()
    }
    expect(classifyDocumentPath(paths.定稿章(1, 1, '字'.repeat(100)))?.units).toEqual(['I16'])
  })

  it('keeps historical compensation paths separate from normal proposals', () => {
    expect(classifyDocumentPath('草稿区/提案/补偿-0001.md')).toEqual({ units: ['I29'], requiresContent: false, pathForm: 'historical' })
    expect(classifyDocumentPath('定稿/卷01/补偿/补偿-0001.md')?.pathForm).toBe('current')
  })

  it('accepts native separators without decoding or folding authored names', () => {
    expect(classifyDocumentPath('大纲\\卷规划\\卷01\\卷纲.md')?.units).toEqual(['I05'])
    expect(classifyDocumentPath('本书记忆/%41.md')?.units).toEqual(['I19'])
    expect(classifyDocumentPath('本书记忆/[甲](乙)#丙.md')?.units).toEqual(['I19'])
    const upperDraft = '草稿区/草稿/卷01-渡口/稿1.MD'
    expect(classifyDocumentPath(upperDraft) !== undefined).toBe(isNumberedDraftPath(upperDraft))
    expect(classifyDocumentPath('草稿区/草稿/卷01-渡口/稿0.md') !== undefined).toBe(isNumberedDraftPath('草稿区/草稿/卷01-渡口/稿0.md'))
  })

  it.each([
    '', '/作品契约/契约.md', 'C:/作品契约/契约.md', '\\作品契约\\契约.md', '//server/book/作品契约/契约.md',
    '../作品契约/契约.md', '本书记忆/../契约.md', './作品契约/契约.md', '作品契约//契约.md',
    '作品契约/契约.md\0', '作品契约/契约.md ', '本书记忆/.md', '本书记忆/CON.md',
    '大纲/卷规划/卷00/卷纲.md', '大纲/卷规划/卷-1/卷纲.md', '大纲/卷规划/卷01.5/卷纲.md',
    '大纲/卷规划/卷999999999999999999999/卷纲.md', '大纲/卷规划/卷01/constructor', '大纲/卷规划/卷01/__proto__',
    '大纲/卷规划/卷01/未知.md', '定稿/卷01/0000-渡口.md', '定稿/卷01/0001-.md', '定稿/卷01/0001-..md',
    '定稿/卷01/0001-渡口.md.bak', '世界书/模块声明.md/未知.md', '未知/文章.md', '未知.json',
    '草稿区/材料包/卷01-渡口/01-错误段名.md', '草稿区/材料包/卷01-渡口/正文.md',
    '草稿区/材料包/卷01-渡口/补充/_bad.md', `草稿区/材料包/卷01-渡口/补充/${'a'.repeat(65)}.md`,
    '草稿区/定稿准备/卷01-渡口/附件.md', `草稿区/提案/retcon-${hash}/附件.md`,
    '草稿区/提案/retcon-123/正文.md', '草稿区/.author-edits/short.json', `草稿区/.author-edits/${'a'.repeat(81)}.json`,
    '草稿区/.archive-receipts/unknown.json', `.webnovel/${hash}.json`, '.webnovel/finalized-search.worker.lock',
  ])('leaves unsafe, malformed or unknown path %s unclassified', relative => {
    expect(classifyDocumentPath(relative)).toBeUndefined()
  })

  it('performs no filesystem calls while routing', () => {
    const deny = () => { throw new Error('Classifier attempted filesystem access') }
    const mocks = [vi.spyOn(fs, 'readFileSync').mockImplementation(deny), vi.spyOn(fs, 'statSync').mockImplementation(deny), vi.spyOn(fs, 'readdirSync').mockImplementation(deny)]
    syncBuiltinESMExports()
    let routed: (ReturnType<typeof classifyDocumentPath>)[]
    try { routed = pathCases.map(([relative]) => classifyDocumentPath(relative)) }
    finally { for (const mock of mocks) mock.mockRestore(); syncBuiltinESMExports() }
    expect(routed.every(Boolean)).toBe(true)
  })
})
