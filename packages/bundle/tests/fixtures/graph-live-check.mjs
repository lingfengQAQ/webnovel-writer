/** Real model quality check using only newly generated synthetic settlement records. */
import * as fs from 'node:fs'
import * as path from 'node:path'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
register('../../../../scripts/strip-types-loader.mjs', import.meta.url)

const output = path.resolve(process.argv[2]), devModule = pathToFileURL(path.resolve(process.argv[3]))
const { runDevModel } = await import(devModule.href)
const { createBook, writeEntry, planSettlement, writeBatchAtomic, documentHash, withBookLockAsync } = await import('../../../core/src/index.ts')
const { StudyService } = await import('../../src/study/service.ts')
const { GRAPH_SYSTEM } = await import('../../../embedding-provider/src/graph-model.ts')
const { GRAPH_PROMPT_VERSION, extractionInput, graphIdentityHash, validateExtraction, overlayExtractions } = await import('../../src/study/graph-extraction.ts')
const { saveGraphCache } = await import('../../src/indexing/graph-storage.ts')

fs.mkdirSync(output, { recursive: true })
const workspace = path.join(output, 'workspace')
fs.mkdirSync(workspace, { recursive: true })
const corpus = [
  { id: 'teacher', text: '林舟是沈青的师父。', required: true },
  { id: 'negation', text: '林舟从未收沈青为徒，两人没有师徒关系。', forbidAsserted: true },
  { id: 'testimony', text: '阿夏说：“林舟和沈青已经结盟。”这只是阿夏的说法，尚未证实。', qualified: true },
  { id: 'future', text: '林舟打算明年与沈青结盟；此刻双方尚未结盟。', forbidAsserted: true },
  { id: 'cooccurrence', text: '林舟与沈青站在同一条街上。天开始下雨。', empty: true },
  { id: 'rescue', text: '林舟把沈青从水中救了起来。', required: true },
  { id: 'ambiguous', text: '林舟向无名道谢。这里的无名未说明指同名甲还是同名乙。', unassigned: true },
  { id: 'alias', text: '阿舟与沈青约定互相照应。', required: true },
  { id: 'unknown', text: '一位不知姓名的老者帮助了沈青，老者的身份仍未查明。', unassigned: true },
  { id: 'ended', text: '林舟和沈青曾是挚友，如今已经反目，并明确断绝朋友关系。' },
  { id: 'shared-room', text: '林舟在客栈看书。沈青在客栈吃饭。', empty: true },
  { id: 'listed', text: '名单上的三个名字依次是林舟、沈青、阿夏。', empty: true },
]
const result = createBook({ workspaceRoot: workspace, 书名: '图谱合成验收', concept: { 状态: '已确认', 核心创意: '用于验证沉淀关系抽取的合成故事，不是真实书稿。', 题材与目标读者: '软件验收用合成语料。' } })
assert.equal(result.ok, true, result.reason)
const { bookRoot, bookId } = result
writeEntry(bookRoot, '人物档案', '林舟', { 类型: '人物', 性质: '计划', 状态: '已确认', 来源: '构想/构想快照.md', 别名: '阿舟', 正文: '这是计划资料，不作为已发生事实输入。' })
for (const name of ['同名甲', '同名乙']) writeEntry(bookRoot, '人物档案', name, { 类型: '人物', 性质: '计划', 状态: '已确认', 来源: '构想/构想快照.md', 别名: '无名', 正文: '用于测试同名歧义的计划人物。' })
for (const [index, sample] of corpus.entries()) {
  const key = { 卷: 1, 章: index + 1, 章名: sample.id }
  const directory = path.join(bookRoot, '草稿区/定稿准备', sample.id)
  fs.mkdirSync(directory, { recursive: true })
  const initialFacts = index === 0 ? ['沈青', '阿夏', '同名甲', '同名乙'].map(name => `\n### ${name}\n${name}独自走过渡口。\n`).join('') : ''
  fs.writeFileSync(path.join(directory, '事实变更.md'), `# 事实变更\n## 人物档案\n### 林舟\n${sample.text}\n${initialFacts}`)
  const plan = planSettlement(bookRoot, directory, { 章节: key, 批准: true, 裁决记录: '仅用于合成验收的已授权夹具' }, key)
  assert.equal(plan.ok, true, plan.reason)
  writeBatchAtomic(bookRoot, plan.ops)
}
const graph = new StudyService(workspace).graphSource('book:' + bookId)
const evidence = graph.evidence.filter(item => item.eligible)
const before = graph.sourceHashes
assert.equal(evidence.filter(item => item.sourceKind === 'world-append' && item.ownerId === 'world:世界书/人物档案/林舟.md').length, corpus.length)
const requests = evidence.map(item => ({ system: GRAPH_SYSTEM, text: JSON.stringify(extractionInput(graph, item)) }))
fs.writeFileSync(path.join(output, 'input-manifest.json'), JSON.stringify({ synthetic: true, createdBy: ['createBook', 'writeEntry', 'planSettlement', 'writeBatchAtomic'], sourceHashes: before,
  inputs: evidence.map((item, index) => ({ id: item.id, chapter: item.recordChapter, sourceKind: item.sourceKind, inputSha256: documentHash(requests[index].text) })) }, null, 2) + '\n')
const live = await runDevModel({ purpose: 'dev-llm', task: 'graph-quality', data: 'synthetic', allowLive: true, requests })
fs.writeFileSync(path.join(output, 'raw-model-results.json'), JSON.stringify(live, null, 2) + '\n', { mode: 0o600 })
const model = live.report.model.model, identity = graphIdentityHash(graph)
const extractionRows = live.results.map((result, index) => {
  const source = evidence[index]
  const value = JSON.parse(result.text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1'))
  const checked = validateExtraction(value, extractionInput(graph, source))
  return { version: GRAPH_PROMPT_VERSION, key: documentHash(requests[index].text), evidenceId: source.id, sourceHash: source.location.hash,
    identityHash: identity, revision: live.report.configSha256, model, ...checked }
})
assert.deepEqual(new StudyService(workspace).graphSource('book:' + bookId).sourceHashes, before)
await withBookLockAsync(bookRoot, async () => { for (const row of extractionRows) saveGraphCache(bookRoot, graph, row) })
const projected = overlayExtractions(graph, extractionRows)
const assessments = corpus.map((sample, index) => {
  const source = evidence.find(item => item.ownerId === 'world:世界书/人物档案/林舟.md' && item.sourceKind === 'world-append' && item.recordChapter === index + 1)
  const row = extractionRows.find(item => item.evidenceId === source.id)
  const concerns = []
  if (sample.required && !row.relations.some(item => item.assigned)) concerns.push('required relationship missing')
  if (sample.forbidAsserted && row.relations.some(item => item.qualifier === 'asserted')) concerns.push('negation or future possibility promoted to asserted')
  if (sample.qualified && row.relations.some(item => item.qualifier === 'asserted')) concerns.push('testimony promoted to asserted')
  if (sample.empty && row.relations.length) concerns.push('co-occurrence created a relation')
  if (sample.unassigned && row.relations.some(item => item.assigned)) concerns.push('unknown or ambiguous person assigned')
  return { id: sample.id, chapter: index + 1, text: sample.text, relations: row.relations, rejected: row.rejected, concerns }
})
const report = { schemaVersion: 1, synthetic: true, realModel: true, model, inputCount: evidence.length,
  calls: live.report.calls, requests: live.report.requests, billing: live.report.billing, runDir: live.runDir,
  sourceUnchanged: true, noStructuredRelationFieldsAdded: true, validatedEdges: projected.edges.filter(edge => edge.evidenceKind === 'extracted').length,
  unassigned: projected.unassigned.length, assessments, passed: assessments.every(item => !item.concerns.length) }
fs.writeFileSync(path.join(output, 'quality-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ passed: report.passed, model, inputs: report.inputCount, httpRequests: report.requests.length,
  validatedEdges: report.validatedEdges, unassigned: report.unassigned, assessments: assessments.map(item => ({ id: item.id, relations: item.relations.length, concerns: item.concerns })), output }, null, 2))
if (!report.passed) process.exitCode = 1
