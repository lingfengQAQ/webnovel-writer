import {
  ReferenceError, previewReference, referencePreviewView, importReference, listReferences, deleteReference, planReference, runReference, referenceStatus, recoverReference,
  reportReference, queryReferences, saveReferenceIdea, readReferenceEvidence, readReferenceManifest, readReferenceSource, referenceRoot, referenceRead, referenceWrite, referenceLocked, referenceHash, referenceJson, manifestOp,
  type ParseOptions, type SourceMetadata, type ReferenceRange, type ModelRunner, type InspirationReference,
} from '@webnovel/core'
import type { AgentLike, NovelToolDefinition, ToolExecContext } from '../novel-tools'
import type { ReferenceHost } from './host'

export const REFERENCE_TOOL_NAMES = ['novel_reference_source', 'novel_reference_analyze', 'novel_reference_query', 'novel_reference_report'] as const
interface Deps { workspaceRoot(agent?: AgentLike): string | undefined; referenceHost?: Pick<ReferenceHost, 'readFile' | 'runner'> }
const string = { type: 'string' } as const
const source = { sourceId: string }
const tags = { type: 'array', items: string }
const ranges = { oneOf: [{ const: 'all' }, { type: 'array', items: { type: 'object', additionalProperties: false, properties: { unitId: string, start: { type: 'integer' }, end: { type: 'integer' } }, required: ['unitId', 'start', 'end'] } }] }
const metadata = { type: 'object', additionalProperties: false, properties: { title: string, author: string, translator: string, edition: string, acquiredFrom: string, allowedUses: string, basis: string, basisKind: { enum: ['user-declaration', 'checkable-license'] } }, required: ['title', 'author', 'edition', 'acquiredFrom', 'allowedUses', 'basis', 'basisKind'] }
const reference = { type: 'object', additionalProperties: false, properties: { 参考书: string, 原文版本: string, 机制: string, 机制版本: { type: 'integer' } }, required: ['参考书', '原文版本', '机制', '机制版本'] }
const encoding = { enum: ['utf-8', 'utf-16le', 'utf-16be', 'gb18030', 'big5'] }
function variant(action: string, properties: Record<string, unknown>, required: string[] = Object.keys(properties)) { return { type: 'object', additionalProperties: false, properties: { action: { const: action }, ...properties }, required: ['action', ...required] } }
const output: NovelToolDefinition['output'] = { schema: { type: 'object', properties: { ok: { type: 'boolean' }, reason: string }, required: ['ok'] }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] }

export function createReferenceTools(deps: Deps): NovelToolDefinition[] {
  const context = (exec?: ToolExecContext) => {
    const workspace = deps.workspaceRoot(exec?.agent)
    if (!workspace) throw new ReferenceError('workspace-missing', '当前会话没有有效工作范围')
    return workspace
  }
  const host = (exec?: ToolExecContext) => {
    if (!deps.referenceHost || !exec?.agent) throw new ReferenceError('host-unavailable', '当前会话的文件或模型宿主能力不可用')
    return { runtime: deps.referenceHost, agent: exec.agent }
  }
  const wrap = (operation: (args: Record<string, unknown>, exec?: ToolExecContext) => unknown | Promise<unknown>): NovelToolDefinition['execute'] => async (args, exec) => {
    try { exec?.signal?.throwIfAborted(); return { ok: true, ...(await operation(args, exec) as object) } }
    catch (error) { return { ok: false, code: error instanceof ReferenceError ? error.code : 'reference-failed', reason: error instanceof ReferenceError ? error.message : exec?.signal?.aborted ? '操作已取消，已验证结果保留' : '参考资料处理失败，请核对输入或本地文件；未返回原文或原始服务错误' } }
  }
  async function checkOriginal(workspace: string, sourceId: string, exec?: ToolExecContext) {
    const { runtime, agent } = host(exec), root = referenceRoot(workspace, sourceId), manifest = readReferenceManifest(root)
    const origin = JSON.parse(referenceRead(root, '.analysis/origin.json')) as { filename: string }
    const bytes = await runtime.readFile(agent, workspace, origin.filename, exec?.signal)
    const hash = referenceHash(bytes), changed = hash !== manifest.revisions[manifest.currentRevision]!.sourceHash
    if (changed) referenceLocked(workspace, sourceId, root => {
      const current = readReferenceManifest(root)
      for (const batch of Object.values(current.batches)) batch.state = 'stale'
      for (const plan of Object.values(current.plans)) plan.allowed = false
      referenceWrite(root, [manifestOp(current)])
    })
    return { changed, sourceHash: hash }
  }
  function guardedRunner(workspace: string, sourceId: string, exec?: ToolExecContext): ModelRunner {
    const { runtime, agent } = host(exec), runner = runtime.runner(agent)
    return { route: () => runner.route(), maxInputChars: () => runner.maxInputChars(), run: async (input, signal) => {
      const fresh = async () => { if ((await checkOriginal(workspace, sourceId, { ...exec, signal })).changed) throw new ReferenceError('source-changed', '原文件已变化，请对该 sourceId 重新导入；旧分析已待复核') }
      await fresh(); const response = await runner.run(input, signal); await fresh(); return response
    } }
  }
  return [
    { name: REFERENCE_TOOL_NAMES[0], description: '本地 TXT/EPUB 预检、导入、列举、版本核对和清除。预检仅返回格式、索引与问题，不返回原文。导入只保存本地副本，不发送模型；清除只删除指定参考库，不删除原文件或作者灵感。来源声明不代表权利保证。',
      parameters: { oneOf: [variant('preview', { filename: string, encoding }, ['filename']), variant('import', { filename: string, encoding, metadata, sourceId: string, expectedSourceHash: string }, ['filename', 'metadata', 'expectedSourceHash']), variant('list', {}), variant('check', source), variant('delete', source)] }, output,
      execute: wrap(async (args, exec) => {
        const workspace = context(exec)
        if (args.action === 'list') return { sources: listReferences(workspace) }
        if (args.action === 'delete') { deleteReference(workspace, String(args.sourceId)); return { deleted: true, notice: '本地参考库已清除；原文件、作者点子及已发送服务端的数据不在本地清除范围内' } }
        if (args.action === 'check') return checkOriginal(workspace, String(args.sourceId), exec)
        if (args.action !== 'preview' && args.action !== 'import') throw new ReferenceError('invalid-action', '未知来源操作')
        const { runtime, agent } = host(exec), filename = String(args.filename)
        const bytes = await runtime.readFile(agent, workspace, filename, exec?.signal)
        const options: ParseOptions = args.encoding ? { encoding: args.encoding as ParseOptions['encoding'] } : {}
        if (args.action === 'preview') return referencePreviewView(await previewReference(bytes, filename, options, exec?.signal))
        if (args.expectedSourceHash !== referenceHash(bytes)) throw new ReferenceError('source-changed', '原文件与预检不一致，请重新预检')
        const result = await importReference(workspace, { bytes, filename, options, metadata: args.metadata as SourceMetadata, sourceId: args.sourceId as string | undefined }, exec?.signal)
        referenceLocked(workspace, result.sourceId, root => referenceWrite(root, [{ relPath: '.analysis/origin.json', content: referenceJson({ filename }) }]))
        return result
      }) },
    { name: REFERENCE_TOOL_NAMES[1], description: '渐进拆书：plan 展示选定原文范围和实际配置服务；作者明确允许后 run 的 allowProcessing=true 记录该次处理许可，之后同服务同范围无需重问。run 一次只处理下一有界批次。status 不发送原文；recover 保留已校验结果，重置中断批次。',
      parameters: { oneOf: [variant('plan', { ...source, ranges }), variant('run', { ...source, planId: string, allowProcessing: { type: 'boolean' } }, ['sourceId', 'planId']), variant('status', { ...source, planId: string }, ['sourceId']), variant('recover', source)] }, output,
      execute: wrap(async (args, exec) => {
        const workspace = context(exec), sourceId = String(args.sourceId)
        if (args.action === 'status') return referenceStatus(workspace, sourceId, args.planId as string | undefined)
        if (args.action === 'recover') return recoverReference(workspace, sourceId)
        const runner = guardedRunner(workspace, sourceId, exec)
        if (args.action === 'plan') { if ((await checkOriginal(workspace, sourceId, exec)).changed) throw new ReferenceError('source-changed', '原文件已变化，请先重新导入'); return planReference(workspace, sourceId, args.ranges as ReferenceRange[] | 'all', runner) }
        if (args.action === 'run') return runReference(workspace, sourceId, String(args.planId), runner, args.allowProcessing === true, exec?.signal)
        throw new ReferenceError('invalid-action', '未知拆书操作')
      }) },
    { name: REFERENCE_TOOL_NAMES[2], description: '本地文字/标签检索，区分作者点子与有据参考机制；失效结果不混入机制。只在作者明确要求核对某证据时使用 evidence，且核对当前服务允许范围；短原文将进入主对话。无向量化或额外服务请求。',
      parameters: { oneOf: [variant('search', { query: { type: 'string' }, sourceId: string, tags, type: string }, ['query']), variant('evidence', { ...source, evidenceId: string, allowInChat: { type: 'boolean', const: true } })] }, output,
      execute: wrap(async (args, exec) => {
        const workspace = context(exec)
        if (args.action === 'search') return queryReferences(workspace, String(args.query ?? ''), { sourceId: args.sourceId as string | undefined, tags: args.tags as string[] | undefined, type: args.type as string | undefined })
        if (args.action !== 'evidence') throw new ReferenceError('invalid-action', '未知检索操作')
        const { runtime, agent } = host(exec)
        return readReferenceEvidence(workspace, String(args.sourceId), String(args.evidenceId), await runtime.runner(agent).route(), args.allowInChat === true)
      }) },
    { name: REFERENCE_TOOL_NAMES[3], description: '保存可读拆书报告与版本化机制，部分覆盖只出局部报告。机制保存不自动入灵感池；探索形成新候选时 save-idea 写入既有灵感池，固定依据版本，operationId 同次重试复用；不代表本书采纳。',
      parameters: { oneOf: [variant('build', source), variant('save-idea', { body: string, operationId: string, references: { type: 'array', items: reference }, tags, type: string }, ['body', 'operationId', 'references'])] }, output,
      execute: wrap((args, exec) => {
        const workspace = context(exec)
        if (args.action === 'build') return reportReference(workspace, String(args.sourceId))
        if (args.action === 'save-idea') return saveReferenceIdea(workspace, { body: String(args.body), operationId: String(args.operationId), references: args.references as InspirationReference[], tags: args.tags as string[] | undefined, type: args.type as string | undefined })
        throw new ReferenceError('invalid-action', '未知报告操作')
      }) },
  ]
}
