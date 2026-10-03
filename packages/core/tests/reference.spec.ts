import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { randomUUID } from 'node:crypto'
import { importReference, planReference, runReference, referenceStatus, recoverReference, reportReference, queryReferences, saveReferenceIdea, resolveReference, readReferenceEvidence, readReferenceManifest, referenceRoot, deleteReference, referenceHash, type ModelInput, type InspirationReference } from '../src'
import { listNotes, ingestNote, searchNotes, deleteNote } from '../src/inspire'
import { saveAuthorDocument } from '../src/revise/document'
import { parseDocument } from '../src/repo/frontmatter'
import { removeSync } from '../src/repo/remove'
import { FakeReferenceRunner, extractionFor, referenceMetadata, referenceText } from './fixtures/reference'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'reference-test-'))
afterAll(() => removeSync(scratch))
async function setup(text = referenceText) {
  const workspace = fs.mkdtempSync(path.join(scratch, 'workspace-'))
  const imported = await importReference(workspace, { bytes: Buffer.from(text), filename: 'sample.txt', metadata: referenceMetadata })
  return { workspace, imported, runner: new FakeReferenceRunner() }
}
async function complete(workspace: string, sourceId: string, runner: FakeReferenceRunner) {
  const plan = await planReference(workspace, sourceId, 'all', runner)
  for (let i = 0; i < plan.batches; i++) await runReference(workspace, sourceId, plan.planId, runner, i === 0)
  return plan
}
describe('渐进拆书与版本化灵感', () => {
  it('局部到全部、重复导入与批次幂等，机制不自动入池', async () => {
    const { workspace, imported, runner } = await setup()
    const again = await importReference(workspace, { bytes: Buffer.from(referenceText), filename: 'renamed.txt', metadata: referenceMetadata })
    expect(again.sourceId).toBe(imported.sourceId); expect(again.reused).toBe(true)
    const unit = imported.units[0]!, plan = await planReference(workspace, imported.sourceId, [{ unitId: unit.id, start: 0, end: unit.characters }], runner)
    await expect(runReference(workspace, imported.sourceId, plan.planId, runner)).rejects.toMatchObject({ code: 'processing-required' })
    expect(runner.calls).toBe(0)
    const status = await runReference(workspace, imported.sourceId, plan.planId, runner, true)
    expect(status.selectedRangeComplete).toBe(true); expect(status.fullBookEligible).toBe(false)
    await runReference(workspace, imported.sourceId, plan.planId, runner)
    expect(runner.calls).toBe(1)
    expect(reportReference(workspace, imported.sourceId).fullBookComplete).toBe(false)
    await complete(workspace, imported.sourceId, runner)
    expect(runner.calls).toBe(2)
    const report = reportReference(workspace, imported.sourceId)
    expect(report.fullBookComplete).toBe(true)
    expect(listNotes(workspace)).toEqual([])
    expect(fs.readFileSync(report.reportPath, 'utf8')).not.toContain('船主需要航图')
  })
  it('源版本同长度变化、模型变更均不沿用旧许可', async () => {
    const { workspace, imported, runner } = await setup()
    const plan = await planReference(workspace, imported.sourceId, 'all', runner)
    runner.current = { ...runner.current, service: 'different-endpoint' }
    await expect(runReference(workspace, imported.sourceId, plan.planId, runner, true)).rejects.toMatchObject({ code: 'route-changed' })
    expect(runner.calls).toBe(0)
    await importReference(workspace, { bytes: Buffer.from(referenceText.replace('航图', '海图')), filename: 'sample.txt', metadata: referenceMetadata, sourceId: imported.sourceId })
    await expect(runReference(workspace, imported.sourceId, plan.planId, runner, true)).rejects.toMatchObject({ code: 'plan-stale' })
  })
  it('证据定位伪造最多修复两次，失败不计覆盖', async () => {
    const { workspace, imported, runner } = await setup()
    runner.handler = async input => { const value = extractionFor(input); value.evidence[0]!.quote = '伪造引文'; return JSON.stringify(value) }
    const plan = await planReference(workspace, imported.sourceId, 'all', runner)
    await expect(runReference(workspace, imported.sourceId, plan.planId, runner, true)).rejects.toMatchObject({ code: 'invalid-analysis' })
    expect(runner.calls).toBe(3); expect(referenceStatus(workspace, imported.sourceId).verifiedBatches).toBe(0)
  })
  it('取消与迟到回复不提交，之前的批次保留并可恢复', async () => {
    const { workspace, imported, runner } = await setup()
    const plan = await planReference(workspace, imported.sourceId, 'all', runner)
    await runReference(workspace, imported.sourceId, plan.planId, runner, true)
    let release!: (value: string) => void, entered!: () => void, input!: ModelInput
    const ready = new Promise<void>(resolve => { entered = resolve })
    runner.handler = request => { input = request; entered(); return new Promise(resolve => { release = resolve }) }
    const abort = new AbortController(), running = runReference(workspace, imported.sourceId, plan.planId, runner, false, abort.signal)
    await ready; abort.abort()
    await expect(running).rejects.toMatchObject({ code: 'cancelled' })
    release(JSON.stringify(extractionFor(input)))
    expect(referenceStatus(workspace, imported.sourceId).verifiedBatches).toBe(1)
    recoverReference(workspace, imported.sourceId); runner.handler = undefined
    await runReference(workspace, imported.sourceId, plan.planId, runner)
    expect(referenceStatus(workspace, imported.sourceId).fullBookEligible).toBe(true)
  })
  it('结果文件损坏使其后依赖和机制失效，恢复只重做相应范围', async () => {
    const { workspace, imported, runner } = await setup()
    const plan = await complete(workspace, imported.sourceId, runner)
    reportReference(workspace, imported.sourceId)
    const root = referenceRoot(workspace, imported.sourceId), manifest = readReferenceManifest(root)
    const first = manifest.batches[plan.batches ? Object.keys(manifest.batches)[0]! : '']!
    fs.writeFileSync(path.join(root, `.analysis/batches/${first.id}/${first.resultHash}.json`), '{}')
    expect(referenceStatus(workspace, imported.sourceId).verifiedBatches).toBe(0)
    expect(queryReferences(workspace, '合作').mechanisms).toEqual([])
    recoverReference(workspace, imported.sourceId)
    await runReference(workspace, imported.sourceId, plan.planId, runner)
    await runReference(workspace, imported.sourceId, plan.planId, runner)
    expect(referenceStatus(workspace, imported.sourceId).fullBookEligible).toBe(true)
  })
  it('长阅读单元连续分块，重叠不重复统计覆盖', async () => {
    const { workspace, imported, runner } = await setup('第一章 长章\n' + '船主在等待。\n'.repeat(210))
    await complete(workspace, imported.sourceId, runner)
    const status = referenceStatus(workspace, imported.sourceId)
    expect(status.units[0]!.covered).toBe(imported.units[0]!.characters)
    expect(status.fullBookEligible).toBe(true); expect(runner.calls).toBeGreaterThan(1)
  })
  it('旧池格式、可选标签与未知字段保留，参考元数据损坏仍可读正文', async () => {
    const { workspace } = await setup()
    const dir = path.join(workspace, '书房/灵感池'); fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'old.md'), '旧的自由脑洞。')
    const id = ingestNote(workspace, '两人交换。', { type: '对谈候选', tags: ['互惠'], fields: { 作者自定义: '保留' } })
    expect(searchNotes(workspace, '互惠')[0]!.id).toBe(id)
    expect(listNotes(workspace).find(note => note.id === 'old')!.body).toBe('旧的自由脑洞。')
    const file = path.join(dir, `${id}.md`), before = fs.readFileSync(file, 'utf8'), date = listNotes(workspace).find(note => note.id === id)!.createdAt
    saveAuthorDocument(path.join(workspace, '书房'), { path: `灵感池/${id}.md`, expectedHash: referenceHash(before), body: '改过的点子。', shared: true })
    const note = listNotes(workspace).find(note => note.id === id)!
    expect(note.fields?.['作者自定义']).toBe('保留'); expect(note.createdAt).toBe(date)
    fs.writeFileSync(path.join(dir, 'bad.md'), '---\n参考依据: wrong\n---\n仍可看。')
    expect(listNotes(workspace).find(note => note.id === 'bad')).toMatchObject({ body: '仍可看。', issues: expect.any(Array) })
  })
  it('具体机制引用、同次重试、同源多点子、作者机制编辑升版及双向删除独立', async () => {
    const { workspace, imported, runner } = await setup()
    await complete(workspace, imported.sourceId, runner); reportReference(workspace, imported.sourceId)
    const mechanism = queryReferences(workspace, '合作').mechanisms[0]!
    const ref: InspirationReference = { 参考书: imported.sourceId, 原文版本: mechanism.revision, 机制: mechanism.mechanismId, 机制版本: mechanism.version }
    const input = { body: '一个没有港口的货主，试探共同经营渡船。', operationId: 'idea-once', references: [ref] }
    const first = saveReferenceIdea(workspace, input)
    expect(saveReferenceIdea(workspace, input).noteId).toBe(first.noteId)
    saveReferenceIdea(workspace, { ...input, operationId: 'idea-twice', body: '另一个不同点子。' })
    expect(listNotes(workspace)).toHaveLength(2)
    const before = fs.readFileSync(mechanism.path, 'utf8'), body = parseDocument(before)
    expect(body.ok).toBe(true)
    const saved = saveAuthorDocument(path.join(workspace, '书房'), { path: path.relative(path.join(workspace, '书房'), mechanism.path), expectedHash: referenceHash(before), body: (body.ok ? body.data.body : '') + '\n作者另一解释。', shared: true, operationId: randomUUID(), provenance: { sessionId: 'test' } })
    expect(saved.version).toBe(2); expect(resolveReference(workspace, ref).state).toBe('stale')
    expect(fs.readFileSync(first.path, 'utf8')).toContain('货主')
    deleteNote(workspace, first.noteId); expect(fs.existsSync(mechanism.path)).toBe(true)
    deleteReference(workspace, imported.sourceId)
    expect(listNotes(workspace)).toHaveLength(1); expect(resolveReference(workspace, ref).state).toBe('unavailable')
  })
  it('证据回查须明确请求且在服务许可范围内，默认检索无原文', async () => {
    const { workspace, imported, runner } = await setup()
    await complete(workspace, imported.sourceId, runner); reportReference(workspace, imported.sourceId)
    const root = referenceRoot(workspace, imported.sourceId), manifest = readReferenceManifest(root), record = Object.values(manifest.mechanisms)[0]![0]!
    expect(() => readReferenceEvidence(workspace, imported.sourceId, record.evidence[0]!, runner.current, false)).toThrow()
    expect(() => readReferenceEvidence(workspace, imported.sourceId, record.evidence[0]!, { ...runner.current, service: 'changed' }, true)).toThrow()
    expect(readReferenceEvidence(workspace, imported.sourceId, record.evidence[0]!, runner.current, true).text.length).toBeGreaterThan(0)
    expect(JSON.stringify(queryReferences(workspace, '合作'))).not.toContain('船主需要航图')
  })
  it('报告连续被作者编辑时重建另存，保留每份作者文字', async () => {
    const { workspace, imported, runner } = await setup()
    await complete(workspace, imported.sourceId, runner)
    const first = reportReference(workspace, imported.sourceId)
    fs.appendFileSync(first.reportPath, '\n第一份作者评论。')
    const second = reportReference(workspace, imported.sourceId)
    fs.appendFileSync(second.reportPath, '\n第二份作者评论。')
    const third = reportReference(workspace, imported.sourceId)
    expect(new Set([first.reportPath, second.reportPath, third.reportPath]).size).toBe(3)
    expect(fs.readFileSync(first.reportPath, 'utf8')).toContain('第一份作者评论')
    expect(fs.readFileSync(second.reportPath, 'utf8')).toContain('第二份作者评论')
    const root = referenceRoot(workspace, imported.sourceId), manifest = readReferenceManifest(root)
    expect(fs.readFileSync(path.join(root, `.analysis/reports/${manifest.report!.inputHash}.md`), 'utf8')).not.toContain('作者评论')
  })
  it('来源在模型等待期间清除，不重新创建目录或提交迟到响应', async () => {
    const { workspace, imported, runner } = await setup()
    const plan = await planReference(workspace, imported.sourceId, 'all', runner)
    let release!: () => void, entered!: () => void
    const ready = new Promise<void>(resolve => { entered = resolve })
    runner.handler = async input => { await new Promise<void>(resolve => { release = resolve; entered() }); return JSON.stringify(extractionFor(input)) }
    const running = runReference(workspace, imported.sourceId, plan.planId, runner, true)
    await ready; deleteReference(workspace, imported.sourceId); release()
    await expect(running).rejects.toMatchObject({ code: 'source-deleted' })
    expect(fs.existsSync(referenceRoot(workspace, imported.sourceId))).toBe(false)
  })
})
