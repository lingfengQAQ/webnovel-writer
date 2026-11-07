import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { classifyDocumentPath } from '../src/repo/document-types'
import { paths, LEDGER_NAMES } from '../src/repo/paths'
import { parseDocument, serializeDocument } from '../src/repo/frontmatter'
import { parseBookFormatVersion } from '../src/repo/book-format'
import { parseMachineJson } from '../src/repo/schema'
import { composeBody, listChapterDrafts, splitCandidateFacts } from '../src/repo/drafts'
import { removeSync } from '../src/repo/remove'
import { scaffoldBookFiles } from '../src/book/scaffold'
import { checkConceptCompleteness, parseConcept, serializeConcept, type Concept } from '../src/inspire/concept'
import { contractTemplate, prepareContract, readExistingContract } from '../src/design/contract'
import { prepareSkeleton, prepareVolumeLayout } from '../src/design/skeleton'
import { preparePlanTimeline, prepareRecentWindow, prepareVolumeOutline, prepareVolumeSummary, volumeOutlineGaps } from '../src/design/volume'
import { seedMinDesign } from '../src/design/seed'
import { parseWindow } from '../src/derive/scan'
import { writeCandidate, confirmOutline, checkConfirmable } from '../src/outline/write'
import { parseOutline } from '../src/outline/parse'
import { 定位段小节, 单元字段 } from '../src/outline/template'
import { computePack, 待定稿包七件 } from '../src/prepare/pack'
import { computeMaterials } from '../src/assembly/assemble'
import { loadMaterialPackage, parseMaterialManifest } from '../src/assembly/read'
import { 材料包十段 } from '../src/assembly/sections'
import { scanFinalized } from '../src/retrieval/source'
import { computeVolumeSummaryCandidate } from '../src/summary'
import { makeArchiveReceipt, archiveReceiptOp, readArchiveReceipt } from '../src/commit/receipt'
import { currentSceneRecord, readSceneRecords, writeSceneRecords, SCENE_RULE_VERSION, SCENE_CACHE_PATH, sceneBodyHash, type SceneRecord } from '../src/retrieval/scenes'
import { emptyIndexState, readIndexState, writeIndexState, INDEX_STATE_PATH } from '../src/retrieval/state'
import { registerProposal, resolveProposal, loadProposal, retconEventOps } from '../src/revise/proposal'
import { saveAuthorDocument, readAuthorSave, documentHash } from '../src/revise/document'

const temporary = fs.realpathSync.native(os.tmpdir())
let root: string
const key = { 卷: 1, 章: 1, 章名: '渡口' }
const concept: Concept = { 状态: '已确认', 核心创意: '失去船票的人找回自己的名字。', 题材与目标读者: '面向成年读者的幻想故事。' }

beforeEach(() => { root = fs.mkdtempSync(path.join(temporary, 'webnovel-document-types-')) })
afterEach(() => {
  if (path.dirname(root) !== temporary || !path.basename(root).startsWith('webnovel-document-types-')) throw new Error('Unexpected fixture path')
  removeSync(root)
})
function put(relative: string, content: string): void {
  const target = path.join(root, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content, 'utf8')
}
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8')
function initialize(): void {
  scaffoldBookFiles(root, concept, { bookId: 'catalog-book' })
  seedMinDesign(root, { 窗口项: key.章名 })
}
function confirmFixtureOutline(): void {
  initialize()
  const body = ['# 章细纲', '## 定位段',
    ...定位段小节.flatMap(section => [`### ${section}`, section === '章节功能' ? '说明来意。\n- 〔软〕用平缓语气。' : '已核对本章窗口与材料。']),
    '## 细纲段', '### 单元 1', ...单元字段.map(field => `- ${field}：主角在渡口核对船票。`)].join('\n')
  writeCandidate(root, { ...key, 来源引用: ['作品契约/契约.md@1', '大纲/卷规划/卷01/卷纲.md@1'], body })
  expect(confirmOutline(root, key)).toMatchObject({ ok: true })
}

describe('document directory with real domain producers and consumers', () => {
  it('classifies generated book files without treating blank planning sections as completed', () => {
    scaffoldBookFiles(root, concept, { bookId: 'catalog-book' })
    expect(parseBookFormatVersion(read(paths.契约()))).toEqual({ ok: true, version: 1 })
    const snapshot = parseConcept(read(paths.构想快照()))
    expect(snapshot).toMatchObject(concept)
    expect(checkConceptCompleteness(snapshot)).toEqual({ ok: true })
    expect(checkConceptCompleteness(parseConcept(serializeConcept({ ...concept, 核心创意: '' })))).toMatchObject({ ok: false })
    const contract = readExistingContract(root)
    expect(Object.values(contract.parts).every(part => part?.state === '留白')).toBe(true)
    for (const relative of [paths.契约(), paths.构想快照(), paths.故事骨架(), paths.分卷布局(), paths.卷纲(1), paths.计划时间线(1), paths.近期窗口(1), '世界书/模块声明.md', ...LEDGER_NAMES.map(paths.账本)]) {
      expect(classifyDocumentPath(relative), relative).toBeDefined()
      expect(parseDocument(read(relative)).ok).toBe(true)
    }
  })

  it('preserves current contract and design metadata through real prepare and read functions', () => {
    put(paths.契约(), contractTemplate({ '题材与读者定位': { state: '暂定', body: '原定位' } }, { 书id: 'catalog-book', 作者扩展: ['保留'] }))
    const contract = prepareContract(root, { '题材与读者定位': { state: '已确认', body: '新定位' } })
    expect(classifyDocumentPath(contract.relPath)?.units).toEqual(['I01'])
    put(contract.relPath, contract.content)
    expect(readExistingContract(root)).toMatchObject({ fields: { 书id: 'catalog-book', 作者扩展: ['保留'] }, parts: { '题材与读者定位': { state: '已确认', body: '新定位' } } })
    const volumeBody = '# 卷纲\n## 叙事结构\n在渡口相见。\n## 弧线\n留白\n## 线索推进\n留白\n## 卷末兑现\n留白\n'
    const writes = [prepareSkeleton(root, '# 骨架\n当前方向。'), prepareVolumeLayout(root, '# 分卷\n后续留白。'), prepareVolumeOutline(root, 1, volumeBody), preparePlanTimeline(root, 1, '# 计划时间线\n## 窗口覆盖\n- 渡口\n')]
    expect(volumeOutlineGaps(writes[2]!.content)).toEqual([])
    for (const op of writes) {
      expect(classifyDocumentPath(op.relPath)).toBeDefined()
      const parsed = parseDocument(op.content)
      expect(parsed).toMatchObject({ ok: true, data: { fields: { 版本: 1 } } })
      put(op.relPath, op.content)
    }
    expect(prepareVolumeOutline(root, 1, volumeBody).content).toBe(writes[2]!.content)
  })

  it('keeps window lifecycle markers in the existing line protocol', () => {
    const entries = [{ 名称: '渡口', 状态: '已确认' }, { 名称: '往事', 状态: '已消费' }, { 名称: '旧路', 状态: '已失效' }]
    const op = prepareRecentWindow(1, entries)
    expect(classifyDocumentPath(op.relPath)?.units).toEqual(['I07'])
    expect(parseWindow(op.content)).toEqual(entries.map(item => ({ name: item.名称, state: item.状态 })))
    expect(parseDocument(op.content)).toMatchObject({ ok: true, data: { fields: {} } })
  })

  it('routes both outline stages while the existing contextual gate still decides confirmation', () => {
    initialize()
    const candidate = writeCandidate(root, { ...key })
    expect(classifyDocumentPath(candidate)?.units).toEqual(['I08'])
    expect(checkConfirmable(root, key).ok).toBe(false)
    expect(fs.existsSync(path.join(root, candidate))).toBe(true)
    confirmFixtureOutline()
    const confirmed = paths.确认细纲(key.卷, key.章, key.章名)
    expect(classifyDocumentPath(confirmed)?.units).toEqual(['I09'])
    expect(fs.existsSync(path.join(root, candidate))).toBe(false)
    const parsed = parseOutline(read(confirmed))
    expect(parsed.状态).toBe('已确认')
    expect(parsed.来源引用).toHaveLength(2)
    expect(parsed.units).toHaveLength(1)
  })

  it('routes draft, prepared files, finalized prose and chapter/volume summaries without conflating them', async () => {
    confirmFixtureOutline()
    const draft = `${paths.草稿目录(1, key.章名)}/稿1.md`
    const prose = '主角在渡口核对船票。\n\n船夫记下他的名字。'
    put(draft, serializeDocument({ 身份: key, 角色: '待审稿', 选定: true, 版本: 1 }, composeBody(prose, ['人物：主角抵达渡口。'])))
    expect(classifyDocumentPath(draft)?.units).toEqual(['I22'])
    expect(splitCandidateFacts(listChapterDrafts(root, key)[0]!.body)).toEqual({ prose, facts: ['人物：主角抵达渡口。'] })
    const prepared = computePack(root, key, { 章摘要: '主角到渡口核对船票。\n章末状态：停在渡口，等候船夫。' })
    expect(prepared.ok, prepared.reason).toBe(true)
    const ops = prepared.文件!
    expect(ops).toHaveLength(待定稿包七件.length + 1)
    expect(ops.every(op => classifyDocumentPath(op.relPath)?.units[0] === 'I26')).toBe(true)
    const main = ops.find(op => op.relPath.endsWith('/正文.md'))!.content
    const summary = ops.find(op => op.relPath.endsWith('/章摘要.md'))!.content
    const manifest = parseMachineJson(ops.find(op => op.relPath.endsWith('/清单.json'))!.content, 1)
    expect(manifest.ok).toBe(true)
    put(paths.定稿章(1, 1, key.章名), main)
    put(paths.章摘要(1, 1, key.章名), summary)
    const finalized = await scanFinalized(root)
    expect(finalized.issues).toEqual([])
    expect(finalized.documents[0]).toMatchObject({ prose, path: paths.定稿章(1, 1, key.章名) })
    expect(classifyDocumentPath(finalized.documents[0]!.path)?.units).toEqual(['I16'])
    expect(classifyDocumentPath(paths.章摘要(1, 1, key.章名))?.units).toEqual(['I17'])
    const candidate = computeVolumeSummaryCandidate(root, 1)
    expect(candidate.ok).toBe(true)
    if (!candidate.ok) throw new Error(candidate.reason)
    expect(candidate.候选).toContain('主角到渡口核对船票。')
    const volume = prepareVolumeSummary(root, 1, candidate.候选)
    expect(classifyDocumentPath(volume.relPath)?.units).toEqual(['I18'])
    expect(parseDocument(volume.content)).toMatchObject({ ok: true, data: { fields: { 版本: 1 } } })
  })

  it('routes actual material output and still uses the shared material loader', () => {
    confirmFixtureOutline()
    const materials = computeMaterials(root, key)
    expect(materials.ok).toBe(true)
    for (const op of materials.文件!) {
      expect(['I23', 'I24']).toContain(classifyDocumentPath(op.relPath)?.units[0])
      put(op.relPath, op.content)
    }
    const loaded = loadMaterialPackage(root, key)
    expect(Object.keys(loaded.段)).toHaveLength(材料包十段.length)
    expect(loaded.段['本章任务与确认细纲']).toContain('来源窗口项及拆并关系')
    expect(parseMaterialManifest(loaded.清单!).raw['schemaVersion']).toBe(1)
  })

  it('keeps proposal decisions and formal compensation metadata in their own contracts', () => {
    const proposal = registerProposal(root, { 域: '内容修订', 类型: '修改计划', 来源: '作者明确要求', 内容: '把相见地点改到渡口。' })
    expect(classifyDocumentPath(proposal.relPath)?.units).toEqual(['I28'])
    expect(resolveProposal(root, proposal.编号, '通过', '批准这项计划修改。')).toEqual({ ok: true })
    const loaded = loadProposal(root, proposal.编号)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) throw new Error(loaded.reason)
    expect(parseDocument(loaded.text)).toMatchObject({ ok: true, data: { fields: { 状态: '已通过', 来源: '作者明确要求' } } })
    const compensation = retconEventOps(root, { 卷: 1, 提案编号: proposal.编号, 受影响工件: [paths.定稿章(1, 1, key.章名)], 摘要: '更正地名。', 账本留痕: '保留其余事实。' })
    expect(classifyDocumentPath(compensation.relPath)?.units).toEqual(['I29'])
    expect(parseDocument(compensation.content)).toMatchObject({ ok: true, data: { fields: { 关联提案: proposal.编号, 受影响工件: [paths.定稿章(1, 1, key.章名)] } } })
  })

  it('does not substitute the common JSON envelope for archive receipt evidence', () => {
    execFileSync('git', ['init', '--quiet'], { cwd: root, windowsHide: true })
    const op = { relPath: paths.定稿章(1, 1, key.章名), content: '保留原正文。\n' }
    put(op.relPath, op.content)
    const scope = 'a'.repeat(64)
    const receipt = makeArchiveReceipt(root, { scope, request: 'b'.repeat(64), mode: 'ch', message: 'ch: 合成验收' }, [op], [])
    const saved = archiveReceiptOp(receipt)
    put(saved.relPath, saved.content)
    expect(classifyDocumentPath(saved.relPath)?.units).toEqual(['I30'])
    expect(parseMachineJson(saved.content, 1).ok).toBe(false)
    expect(readArchiveReceipt(root, scope)).toEqual(receipt)
    const corrupted = saved.content + 'broken'
    put(saved.relPath, corrupted)
    expect(() => readArchiveReceipt(root, scope)).toThrow(/收据损坏/)
    expect(read(saved.relPath)).toBe(corrupted)
  })

  it('keeps scene cache freshness separate from runtime index settings', () => {
    fs.mkdirSync(path.join(root, '.webnovel'))
    const hash = sceneBodyHash('正文')
    const record: SceneRecord = { rule: SCENE_RULE_VERSION, paragraphs: 2, ends: [1, 2], model: 'synthetic', status: 'ready' }
    writeSceneRecords(root, { [hash]: record })
    expect(classifyDocumentPath(SCENE_CACHE_PATH)?.units).toEqual(['I33'])
    const records = readSceneRecords(root)
    expect(currentSceneRecord(records, hash, 2)).toEqual(record)
    expect(currentSceneRecord(records, hash, 3)).toBeUndefined()
    const state = { ...emptyIndexState(), auto: true, phase: 'queued' as const, generation: 3 }
    writeIndexState(root, state)
    expect(classifyDocumentPath(INDEX_STATE_PATH)?.units).toEqual(['I34'])
    expect(readIndexState(root)).toEqual(state)
    const corrupt = JSON.stringify({ ...state, generation: -1 })
    put(INDEX_STATE_PATH, corrupt)
    expect(() => readIndexState(root)).toThrow(/索引状态无法读取/)
    expect(read(INDEX_STATE_PATH)).toBe(corrupt)
    expect(readSceneRecords(root)).toEqual(records)
  })

  it('routes a real author save receipt but leaves session and retry validation to its reader', () => {
    const draft = `${paths.草稿目录(1, key.章名)}/稿1.md`
    const before = serializeDocument({ 身份: key, 角色: '草稿', 版本: 1 }, composeBody('旧正文。', ['线索：船票。']))
    put(draft, before)
    const input = { path: draft, expectedHash: documentHash(before), body: composeBody('新正文。', ['线索：船票。']), operationId: 'catalog-save-0001', provenance: { sessionId: 'catalog-session', toolName: 'author-editor' } }
    const saved = saveAuthorDocument(root, input)
    const receipt = `草稿区/.author-edits/${input.operationId}.json`
    expect(classifyDocumentPath(receipt)?.units).toEqual(['I35'])
    expect(readAuthorSave(root, input.operationId, input.provenance.sessionId)).toEqual(saved)
    expect(() => readAuthorSave(root, input.operationId, 'another-session')).toThrow(/不属于当前会话/)
    expect(saveAuthorDocument(root, input)).toEqual(saved)
  })
})
