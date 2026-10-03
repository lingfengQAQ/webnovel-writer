import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseDocument, serializeDocument } from '../repo/frontmatter'
import { ingestNote, searchNotes, type InspirationReference } from '../inspire/pool'
import { ReferenceError, type MechanismRecord, type ReferenceRoute, type BatchResult, type ReferenceManifest, type ParsedSource } from './types'
import { manifestOp, readReferenceManifest, readReferenceSource, referenceHash, referenceId, referenceJson, referenceLocked, referencePath, referenceRead, referenceRoot, referenceWrite, listReferences } from './storage'
import { mechanismBody, referenceStatus, sameReferenceRoute, validBatch } from './analysis'

export const mechanismPath = (id: string) => `机制/${referenceId(id)}.md`
export const mechanismHistoryPath = (id: string, version: number) => `.analysis/mechanisms/${referenceId(id)}/${version}.md`
export function reportReference(workspace: string, sourceId: string) {
  return referenceLocked(workspace, sourceId, root => {
    const manifest = readReferenceManifest(root), source = readReferenceSource(root, manifest)
    const ops: { relPath: string; content: string }[] = []
    const cache = new Map<string, BatchResult | undefined>()
    const observations: string[] = []
    for (const batch of Object.values(manifest.batches)) {
      const result = validBatch(root, manifest, source, batch, cache)
      if (!result) continue
      const observationPath = `观察/${batch.id}-${batch.resultHash!.slice(0, 16)}.md`
      const observationText = `# 来源观察与解释\n\n原文版本：${batch.revision}\n\n阅读范围：${batch.range.unitId} ${batch.readStart}–${batch.range.end}\n\n${result.extraction.observations.map(item => `## ${item.kind}：${item.statement}\n\n行动主体：${item.actor}\n\n事件时序：${item.eventOrder}\n\n披露时序：${item.disclosureOrder}\n\n人物知情：${item.characterKnowledge}\n\n读者知情：${item.readerKnowledge}\n\n证据：${item.evidence.map(i => result.evidence[i]!.id).join('、')}\n`).join('\n')}\n## 解释假设\n\n${result.extraction.hypotheses.map(item => `- ${item.statement}（${item.evidence.map(i => result.evidence[i]!.id).join('、')}）`).join('\n') || '未提出假设。'}\n\n## 未闭合问题\n\n${result.extraction.openQuestions.join('\n') || '当前片段未提出；不据此断言全书没有未知。'}\n`
      if (!fs.existsSync(referencePath(root, observationPath))) ops.push({ relPath: observationPath, content: observationText })
      observations.push(`- [${batch.range.unitId} ${batch.range.start}–${batch.range.end}](${observationPath})`)
      for (const [index, draft] of result.extraction.mechanisms.entries()) {
        const id = `m-${referenceHash(referenceJson([batch.id, batch.resultHash, index])).slice(0, 32)}`
        if (manifest.mechanisms[id]) continue
        const evidence = draft.evidence.map(i => result.evidence[i]!.id)
        const text = serializeDocument({ schemaVersion: 1, 身份: id, 版本: 1, 状态: '候选', 标题: draft.title, 标签: draft.tags,
          原作依据: [{ 参考书: sourceId, 原文版本: manifest.currentRevision, 证据: evidence }] }, mechanismBody(draft))
        manifest.mechanisms[id] = [{ id, version: 1, revision: manifest.currentRevision, hash: referenceHash(text), batchId: batch.id, resultHash: batch.resultHash!, evidence }]
        ops.push({ relPath: mechanismPath(id), content: text }, { relPath: mechanismHistoryPath(id, 1), content: text })
      }
    }
    const status = referenceStatus(workspace, sourceId)
    const records = Object.values(manifest.mechanisms).flatMap(versions => {
      const record = versions[versions.length - 1]!, batch = manifest.batches[record.batchId]
      const pending = ops.find(op => op.relPath === mechanismPath(record.id))
      const text = pending?.content ?? referenceRead(root, mechanismPath(record.id))
      return record.revision === manifest.currentRevision && referenceHash(text) === record.hash && batch?.resultHash === record.resultHash && validBatch(root, manifest, source, batch, cache) ? [record] : []
    })
    const inputHash = referenceHash(referenceJson([manifest.currentRevision, manifest.metadata, status.units, [...cache.entries()].filter(([, result]) => result).map(([id]) => [id, manifest.batches[id]!.resultHash]), records.map(record => [record.id, record.version, record.hash]), source.issues]))
    const title = status.fullBookEligible ? '全书可读正文拆解汇编' : '局部拆解报告'
    const content = `# ${title}\n\n作品：${manifest.metadata.title}\n\n来源版本：${manifest.currentRevision}\n\n已校验批次：${status.verifiedBatches}。结构与证据位置已检查，解释仍为假设，未验证创意效果。\n\n## 阅读覆盖\n\n${status.units.map(unit => `- ${unit.unitId}：${unit.covered}/${unit.characters} 字符`).join('\n')}\n\n## 缺口与未知\n\n${source.issues.length ? source.issues.map(issue => `- ${issue.message}`).join('\n') : status.fullBookEligible ? '当前可读正文范围已覆盖；这不证明对作品的解释唯一或正确。' : '仍有未读范围，不能作全书结论。'}\n\n## 来源观察与解释\n\n${observations.join('\n') || '尚无已验证提取。'}\n\n## 参考机制\n\n${records.length ? records.map(record => `- [${record.id} · v${record.version}](${mechanismPath(record.id)})`).join('\n') : '尚无有据机制；不为数量编造。'}\n\n## 模型来源\n\n${[...new Set(Object.values(manifest.batches).filter(batch => validBatch(root, manifest, source, batch, cache)).map(batch => `${batch.route?.provider}/${batch.route?.model}`))].join('\n')}\n`
    let reportPath = '报告.md'
    if (manifest.report && fs.existsSync(referencePath(root, manifest.report.path))) {
      const current = referenceRead(root, manifest.report.path)
      if (manifest.report.inputHash === inputHash && referenceHash(current) === manifest.report.hash) {
        if (ops.length) referenceWrite(root, [...ops, manifestOp(manifest)])
        return { sourceId, reportPath: path.join(root, manifest.report.path), fullBookComplete: status.fullBookEligible, mechanisms: records.length }
      }
      if (referenceHash(current) !== manifest.report.hash) reportPath = `报告-${inputHash.slice(0, 16)}.md`
      else reportPath = manifest.report.path
    } else if (fs.existsSync(referencePath(root, reportPath))) reportPath = `报告-${inputHash.slice(0, 16)}.md`
    if (fs.existsSync(referencePath(root, reportPath))) {
      const existing = referenceRead(root, reportPath)
      if (existing !== content && (manifest.report?.path !== reportPath || manifest.report.hash !== referenceHash(existing))) {
        let suffix = 1
        do { reportPath = `报告-${inputHash.slice(0, 16)}-${suffix++}.md` } while (fs.existsSync(referencePath(root, reportPath)))
      }
    }
    manifest.report = { path: reportPath, hash: referenceHash(content), inputHash }
    const historyPath = `.analysis/reports/${inputHash}.md`
    if (!fs.existsSync(referencePath(root, historyPath))) ops.push({ relPath: historyPath, content })
    referenceWrite(root, [...ops, { relPath: reportPath, content }, manifestOp(manifest)])
    return { sourceId, reportPath: path.join(root, reportPath), fullBookComplete: status.fullBookEligible, mechanisms: records.length }
  })
}

type ReferenceResolution = { state: 'current' | 'stale' | 'unavailable'; message: string; path?: string }
function resolveLoadedReference(root: string, manifest: ReferenceManifest, source: ParsedSource, reference: InspirationReference, cache = new Map<string, BatchResult | undefined>()): ReferenceResolution {
  try {
    const versions = manifest.mechanisms[reference.机制], record = versions?.find(record => record.version === reference.机制版本 && record.revision === reference.原文版本)
    if (!record) return { state: 'unavailable', message: '依据版本不可用，作者点子保留' }
    const batch = manifest.batches[record.batchId], latest = versions![versions!.length - 1]!
    const history = referenceRead(root, mechanismHistoryPath(record.id, record.version))
    const current = referenceRead(root, mechanismPath(record.id))
    const valid = reference.原文版本 === manifest.currentRevision && latest.version === record.version && referenceHash(history) === record.hash && referenceHash(current) === record.hash
      && batch?.resultHash === record.resultHash && validBatch(root, manifest, source, batch, cache)
    return { state: valid ? 'current' : 'stale', message: valid ? '依据版本可用；分析解释仍可讨论' : '依据已变或待复核，作者点子保留', ...(valid ? { path: path.join(root, mechanismPath(record.id)) } : {}) }
  } catch { return { state: 'unavailable', message: '来源缺失或不可读取，作者点子保留' } }
}
export function resolveReference(workspace: string, reference: InspirationReference): ReferenceResolution {
  try {
    const root = referenceRoot(workspace, reference.参考书), manifest = readReferenceManifest(root)
    return resolveLoadedReference(root, manifest, readReferenceSource(root, manifest), reference)
  } catch { return { state: 'unavailable', message: '来源缺失或不可读取，作者点子保留' } }
}
export function queryReferences(workspace: string, query: string, filter?: { sourceId?: string; tags?: string[]; type?: string }) {
  const ideas = searchNotes(workspace, query, filter).map(note => ({ ...note, referenceStatus: note.references?.map(ref => ({ reference: ref, ...resolveReference(workspace, ref) })) }))
  const mechanisms: { sourceId: string; mechanismId: string; version: number; revision: string; title: string; tags: string[]; body: string; path: string }[] = []
  const sources = filter?.sourceId ? [{ sourceId: filter.sourceId }] : listReferences(workspace)
  const issues: { sourceId: string; message: string }[] = []
  for (const { sourceId } of sources) {
    try {
      const root = referenceRoot(workspace, sourceId), manifest = readReferenceManifest(root), source = readReferenceSource(root, manifest)
      const cache = new Map<string, BatchResult | undefined>()
      for (const versions of Object.values(manifest.mechanisms)) {
        const record = versions[versions.length - 1]!
        if (resolveLoadedReference(root, manifest, source, { 参考书: sourceId, 原文版本: record.revision, 机制: record.id, 机制版本: record.version }, cache).state !== 'current') continue
        const text = referenceRead(root, mechanismPath(record.id)), parsed = parseDocument(text)
        if (!parsed.ok) continue
        const tags = Array.isArray(parsed.data.fields['标签']) ? parsed.data.fields['标签'].filter((tag): tag is string => typeof tag === 'string') : []
        if (filter?.tags && !filter.tags.every(tag => tags.includes(tag))) continue
        if (query && !text.toLocaleLowerCase().includes(query.toLocaleLowerCase())) continue
        mechanisms.push({ sourceId, mechanismId: record.id, version: record.version, revision: record.revision, title: String(parsed.data.fields['标题'] ?? record.id), tags, body: parsed.data.body, path: path.join(root, mechanismPath(record.id)) })
      }
    } catch { issues.push({ sourceId, message: '参考库不可用，未返回旧机制作为有效依据' }) }
  }
  return { ideas: ideas.slice(0, 50), mechanisms: mechanisms.slice(0, 30), limited: ideas.length > 50 || mechanisms.length > 30, issues }
}
export function saveReferenceIdea(workspace: string, input: { body: string; operationId: string; references: InspirationReference[]; tags?: string[]; type?: string }) {
  if (!input.body.trim() || !input.operationId.trim() || !input.references.length) throw new ReferenceError('idea-invalid', '请提供新点子、保存操作身份和具体机制版本')
  for (const ref of input.references) if (resolveReference(workspace, ref).state !== 'current') throw new ReferenceError('evidence-stale', '参考依据待复核，请核对后保存；既有点子不受影响')
  const id = ingestNote(workspace, input.body, { operationId: input.operationId, references: input.references, tags: input.tags, type: input.type ?? '拆书启发' })
  return { noteId: id, path: path.join(workspace, '书房/灵感池', `${id}.md`), adopted: false }
}
export function readReferenceEvidence(workspace: string, sourceId: string, evidenceId: string, route: ReferenceRoute, allowInChat: boolean) {
  if (!allowInChat) throw new ReferenceError('evidence-permission', '原文回查将进入当前对话，请先明确请求该处原文')
  referenceId(evidenceId)
  const root = referenceRoot(workspace, sourceId), manifest = readReferenceManifest(root), source = readReferenceSource(root, manifest)
  for (const batch of Object.values(manifest.batches)) {
    const result = validBatch(root, manifest, source, batch), evidence = result?.evidence.find(item => item.id === evidenceId)
    if (!evidence) continue
    const grant = Object.values(manifest.plans).find(plan => plan.allowed && plan.revision === manifest.currentRevision && plan.metadataHash === referenceHash(referenceJson(manifest.metadata)) && sameReferenceRoute(plan.route, route)
      && plan.ranges.some(range => range.unitId === evidence.unitId && range.start <= evidence.start && range.end >= evidence.end))
    if (!grant) throw new ReferenceError('processing-required', '该证据不在当前服务获准的处理范围内')
    const unit = source.units.find(unit => unit.id === evidence.unitId)!
    return { sourceId, revision: manifest.currentRevision, evidence, text: unit.text.slice(evidence.start, evidence.end), locations: unit.locations.filter((loc, index) => loc.char < evidence.end && (unit.locations[index + 1]?.char ?? unit.text.length) > evidence.start) }
  }
  throw new ReferenceError('evidence-missing', '未找到当前有效证据')
}

/** Called under the source lock by the existing author-save transaction. */
export function prepareReferenceAuthorEdit(studyRoot: string, relative: string, original: string, body: string) {
  const match = /^参考书\/(ref-[a-f0-9]{20,64})\/机制\/(m-[a-f0-9]{20,64})\.md$/.exec(relative)
  if (!match) return undefined
  const [, sourceId, mechanismId] = match
  const root = referenceRoot(path.dirname(studyRoot), sourceId!), manifest = readReferenceManifest(root), versions = manifest.mechanisms[mechanismId!]
  const previous = versions?.[versions.length - 1], parsed = parseDocument(original)
  if (!previous || previous.hash !== referenceHash(original) || !parsed.ok) throw new ReferenceError('mechanism-conflict', '机制版本或内容已变化，请重新读取')
  const fields = { ...parsed.data.fields, 版本: previous.version + 1 }
  const text = serializeDocument(fields, body), record: MechanismRecord = { ...previous, version: previous.version + 1, hash: referenceHash(text), authorEdited: true }
  versions!.push(record)
  const prefix = `参考书/${sourceId}/`
  const op = manifestOp(manifest)
  return { fields, operations: [{ relPath: prefix + mechanismHistoryPath(mechanismId!, record.version), content: text }, { relPath: prefix + op.relPath, content: op.content }] }
}
