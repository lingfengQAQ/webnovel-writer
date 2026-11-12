import { validateJsonSchemaValue, type JsonSchemaNode, type ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import { createReferenceTools } from './reference/tools'
import type { ReferenceHost } from './reference/host'
/**
 * 主 Agent 专用 Tools（方案 A：core 能力结构化包装为 Tool）。
 *
 * 供主管 Agent 显式调用，严格保证不变量、路径解析与状态跃迁：
 * - novel_create_book: 建书立项（带构想完整度校验 N2）
 * - novel_update_contract: 安全更新作品契约分部（防 N1 抹除）；分部「已确认」时随确认产生 design: 提交
 * - novel_seed_min_design: 测试/走查专用（默认不注册，见 NOVEL_TEST_TOOL_NAMES）：注入占位设计骨架；成功后整批一次 design: 提交
 * - novel_get_story_status: 获取全书/章节真源推导状态（N4）
 * - novel_check_book / novel_begin_chapter: 主动只读检查 / 新章书级边界核对，不写入或迁移
 * - novel_select_book: 显式切换当前会话正在写的书
 * - novel_prepare_pack: 组装待定稿包七件（定稿准备，呈作者裁决前）
 * - novel_settle_chapter: 作者批准后定稿原子沉淀（ch: 单次 Git 提交，不变量 1/6）
 * - novel_new_outline_draft / novel_confirm_outline: 候选细纲落草稿区 / 确认落真源（design(chNNNN): 整批提交）
 * - novel_update_skeleton / novel_update_volume_layout: 故事骨架 / 分卷布局更新（design: 整批提交）
 * - novel_confirm_worldbook_entry / novel_confirm_volume_outline: 世界书条目 / 卷纲与计划时间线确认（design: 整批提交）
 * - novel_roll_window: 近期窗口追加条目 / 标记已消费（design: 提交）
 * - novel_assemble_materials: 组装材料包（幂等重建；readiness 播报）
 * - novel_apply_revision: 作者口述的一处小改（改稿小修快路，带补丁产新稿，不带只记处置）
 * - novel_apply_revision_batch: 处置批落实（改稿主路：一次写新稿并回写全部处置）
 * - novel_import_draft: 作者稿导入（作者手写/作者手改，与 AI 稿地位相同）
 * - novel_record_review_findings: 隔离子 Agent 发现项回写（堵空审通过；「作者意见」模块同此通道）
 * - novel_record_memory: 按 scope 保存作者／本书记忆，显式新增／更新与索引同步
 * - novel_record_proposal / novel_resolve_proposal: 提案登记（acquisition）与裁决回写（S4）
 * - novel_apply_retcon: 吃书补偿执行（emission，必过作者裁决；retcon: 提交＋补偿事件留痕，S4）
 * - novel_editor_suggest: 回复书房编辑器请求，只把结果交回编辑器，不写文件
 *
 * 提交点纪律（拍板 1/7）：提交由写入器服务（受信代码）执行，模型不碰 git；
 * 定稿入档与吃书补偿沿原裁决；独立书仓升级批准绑定精确计划，设计侧确认走 design:。
 */

import { captureApprovalFiles } from './approval-snapshot'
import { readStoryStatus } from './story-status'
import { MAINTENANCE_OUTPUT, MAINTENANCE_PARAMETERS } from './maintenance-output'
import { createBookUpgradeTools } from './book-upgrade-tools'
import { failureFrom, expectedFailure, FAILURE_FIELDS, normalizeFailure, toolFailure } from './tool-failure'
import { omitUndefinedFields } from './tool-json'
import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import type { ToolOutputDefinition } from '@deepseek-ai/dsh-tools'
import type { Session } from '@deepseek-ai/dsh-session'
import { DESIGN_COMMIT_FIELDS, NATIVE_DESIGN_TOOLS, designCommitResult, type DesignCommitResult } from './design-commit-result'
import { acceptEditorSuggestion, type EditorRequestHub } from './study/editor-requests'
import {
  activeChapterLine,
  assertWritableTargets,
  applyVersionFields,
  archiveRetconRequest,
  bumpVersion,
  applyRevision,
  applyRevisionBatch,
  assembleMaterials,
  commitConfirmed,
  confirmOutline,
  createBook,
  inspectBookDocuments,
  inspectChapterOpening,
  type BookInspection,
  type ChapterOpeningInspection,
  listAuthorMemory,
  listBookMemoryEntries,
  writeBookMemory,
  authorMemoryWriteRoot,
  parseWindow,
  paths,
  preparePack,
  scanChapter,
  archiveChapter,
  reconcileLedger,
  renderBookProgress,
  reportDraftReadiness,
  scanDesignDetail,
  selectCurrentVolume,
  searchFinalized,
  type EmbeddingProvider,
  type IndexAction,
  indexFailure,
  writePending,
  seedMinDesign,
  prepareSkeleton,
  prepareVolumeLayout,
  writeAuthorMemory,
  writeCandidate,
  prepareContract,
  prepareEntry,
  WORLDBOOK_INPUT_FIELDS,
  WORLDBOOK_NATURES,
  WORLDBOOK_STATES,
  type WorldbookEntryInput,
  ensureModulesDeclared,
  preparePlanTimeline,
  prepareRecentWindow,
  prepareVolumeOutline,
  prepareVolumeSummary,
  volumeOutlineGaps,
  withBookWrite,
  withBookWriteAsync,
  updateOperationTargets,
  type FileOp,
  草稿字段序,
  extractVersionFields,
  initialVersion,
  parseDocument,
  serializeDocument,
  serializeReviewRecord,
  reviewRecordHashOf,
  type ChapterKey,
  type Concept,
  type ContractParts,
  type ContractPartState,
  type 处置状态,
  askAuthor,
  type AskFn,
} from '@webnovel/core'
import { writeSettlementDecision } from '@webnovel/core'
import { ingestAuthorRevision, planSettlement, registerProposal, resolveProposal, retconEventOps } from '@webnovel/core'
import { importAuthorDraft } from '@webnovel/drafting'
import { ingestFindings } from '@webnovel/review'
import { lastCommitOf, type LastCommitResult } from '@webnovel/core'
import type { OperationProvenance } from '@webnovel/core'
import type { NativeWrite } from './native-write'
import { scanBooks } from './bookshelf'
import { bookMemoryCatalogText, progressLineOf, renderCurrentBook } from './status-context'
import type { IndexView } from './indexing/manager'
import { computeMaterials, type SupplementEdit } from '@webnovel/core'

/** 窄取工具执行内可见的 Agent 子集（避免全量依赖 dsh-agent）。 */
export interface AgentLike {
  readonly id: string
  readonly ctx?: unknown
  readonly session?: {
    readonly requestHeader?: Session['requestHeader']
    readonly seq?: number
    readonly eventAt?: Session['eventAt']
    readonly header?: {
      readonly id?: string
      readonly origin?: string
      readonly parentSession?: string
      /** 会话所附工作区路径（D10：web 多工作区下按会话解析书仓与门禁根）。 */
      readonly cwd?: string
    }
  }
}

/**
 * 工具执行上下文（dsh 运行时对齐批）：dsh `ToolRunContext` 的窄投影。
 * 注册 wrapper 全字段透传（signal/callId/rootCallId/token/parent/deferContext/
 * concludeTurn），工具按需消费；字段逐一对照 dsh-tools 类型，编译器校验形状。
 */
export interface ToolExecContext {
  readonly agent?: AgentLike
  readonly name?: string
  readonly arguments?: unknown
  readonly callId?: string
  readonly rootCallId?: string
  readonly token?: ToolExecutionToken
  readonly parent?: symbol
  readonly signal?: AbortSignal
  deferContext?(context: unknown): void
  concludeTurn?(): void
}

export interface NovelToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: ToolOutputDefinition
  readonly execute: (args: Record<string, unknown>, sessionContext?: ToolExecContext) => Promise<unknown> | unknown
}

export interface NovelToolsDeps {
  readonly referenceHost?: Pick<ReferenceHost, 'runner' | 'readFile'>
  readonly nativeWrite?: NativeWrite
  /** Resolve on every query, including after network waits, to respect service reloads. */
  readonly embeddingProvider?: (agent?: AgentLike) => EmbeddingProvider | undefined
  readonly rerankingProvider?: (agent?: AgentLike) => import('@webnovel/core').RerankingProvider | undefined
  readonly indexManage?: (bookId: string, action: IndexAction | 'status', agent: AgentLike, chapter?: number) => Promise<IndexView>
  readonly workspaceRoot: (agent?: AgentLike) => string | undefined
  /** 按会话解析书仓（D10）：agent 的会话 cwd 优先，全局认领兜底。 */
  readonly bookRootOfBookId: (bookId: string, agent?: AgentLike) => string | undefined
  readonly askFn?: AskFn
  /** 注册测试/走查专用工具（NOVEL_TEST_TOOL_NAMES）；作者环境不开，默认 false。 */
  readonly testTools?: boolean
  /** 书房编辑器请求。缺席时 novel_editor_suggest 拒绝交回，不读写书仓。 */
  readonly editorRequests?: EditorRequestHub
}

function provenanceOf(ctx: ToolExecContext | undefined, targets?: readonly string[]): OperationProvenance | undefined {
  const operationId = ctx?.callId === undefined ? undefined : `tool-${ctx.callId}`
  const p: OperationProvenance = {
    ...(operationId === undefined ? {} : { operationId }),
    ...(ctx?.agent?.session?.header?.id === undefined ? {} : { sessionId: ctx.agent.session.header.id }),
    ...(ctx?.agent?.id === undefined ? {} : { agentId: ctx.agent.id }),
    ...(ctx?.name === undefined ? {} : { toolName: ctx.name }),
    ...(ctx?.callId === undefined ? {} : { callId: ctx.callId }),
    ...(targets === undefined ? {} : { targets }),
  }
  return Object.keys(p).length === 0 ? undefined : p
}

/** Business-only list, exactly matching createNovelTools. Complete inventory lives in tool-catalog. */
export { NOVEL_TOOL_NAMES } from './tool-catalog'

/**
 * 测试/走查专用工具：只在 `deps.testTools` 为真时注册，不进 NOVEL_TOOL_NAMES。
 * seed 只写占位确认态（各部只有「已确认」标注、没有正文），不得作为作者的开写入口。
 */
export const NOVEL_TEST_TOOL_NAMES: readonly string[] = ['novel_seed_min_design']

export function createNovelTools(deps: NovelToolsDeps): NovelToolDefinition[] {
  async function writeNative(root: string, op: FileOp, exec?: ToolExecContext): Promise<void> {
    if (deps.nativeWrite === undefined) throw new Error('DSH 原生 write 不可用，拒绝无版本保护的写入')
    updateOperationTargets(root, undefined, [op.relPath])
    assertWritableTargets(root, [op.relPath])
    await deps.nativeWrite(root, op, exec)
  }
  type BookResolved =
    | { readonly ok: true; readonly bookRoot: string }
    | { readonly ok: false; readonly reason: string }

  const resolveBook = (args: Record<string, unknown>, sessionContext?: ToolExecContext): BookResolved => {
    const bookId = args['bookId'] ? String(args['bookId']).trim() : undefined
    if (!bookId) return toolFailure('book-not-found', '未指定 bookId 参数（必填）')
    const bookRoot = deps.bookRootOfBookId(bookId, sessionContext?.agent)
    if (!bookRoot) return { ok: false, reason: `书id不存在或不唯一，未能定位书仓路径（bookId: ${bookId}）——若在工作台多工作区环境，请确认会话已附上书所在的工作范围` }
    return { ok: true, bookRoot }
  }

  const resolveInspectionBook = (args: Record<string, unknown>, sessionContext?: ToolExecContext) => {
    if (sessionContext?.signal?.aborted) return cancelledInspection()
    const errors = validateJsonSchemaValue(MAINTENANCE_PARAMETERS, args)
    if (errors.length > 0 || typeof args['bookId'] !== 'string' || args['bookId'].trim() === '') {
      return toolFailure('invalid-argument', '检查只接受非空 bookId，不接受路径、章号、批准或迁移参数。')
    }
    try { return resolveBook(args, sessionContext) } catch (error) { return failureFrom(error, '书仓身份无法核实：') }
  }

  /** 章键参数校验（真机 D-004：漏传 卷 时 NaN 路径把错误报成「无待审稿」）。 */
  const chapterKeyOf = (args: Record<string, unknown>): { readonly ok: true; readonly key: ChapterKey } | { readonly ok: false; readonly reason: string } => {
    const 卷 = Number(args['卷'])
    const 章 = Number(args['章'])
    const 章名 = String(args['章名'] ?? '').trim()
    if (!Number.isSafeInteger(卷) || 卷 < 1) return { ok: false, reason: `卷必须是从 1 开始的正整数。请检查 卷 参数（收到：${String(args['卷'] ?? '未传')}）` }
    if (!Number.isSafeInteger(章) || 章 < 1) return { ok: false, reason: `章必须是正整数（全书连续，1 起）——请确认已传入 章 参数（收到：${String(args['章'] ?? '未传')}）` }
    if (章名 === '') return { ok: false, reason: '章名不能为空（须与近期窗口条目逐字一致）' }
    return { ok: true, key: { 卷, 章, 章名 } }
  }

  /** 作者没有批准：区分关闭窗口与明确驳回，都不要重试。 */
  const notApproved = (reason: string) => /取消|abort/i.test(reason)
    ? toolFailure('author-cancelled', `作者裁决已取消，没有做出决定（${reason}），本次没有写入`)
    : toolFailure('author-declined', `未获作者批准：${reason}`)

  const memoryProperties: Record<string, JsonSchemaNode> = {
    名称: { type: 'string', description: '一事一条；同一事项沿用已有名称' },
    描述: { type: 'string', description: '一句话说明以后何时需要这条记忆' },
    类: { type: 'string', enum: ['文风', '决策', '对话', '灵感'] },
    标签: { type: 'array', items: { type: 'string' }, description: '可选定位标签，不决定作者或本书归属' },
    来源: { type: 'string', description: '原始决定或定稿的来源' },
    正文: { type: 'string', description: '简短的当前有效结论，保留必要条件和理由，不追加讨论流水' },
  }
  const memoryValidation: JsonSchemaNode = {
    oneOf: (['book', 'author'] as const).flatMap(scope => (['新增', '更新'] as const).map(operation => ({
      type: 'object', additionalProperties: false,
      properties: {
        ...memoryProperties, scope: { type: 'string', enum: [scope] }, 操作: { type: 'string', enum: [operation] },
        ...(scope === 'book' ? { bookId: { type: 'string' } } : {}),
        ...(operation === '更新' ? { 原文: { type: 'string', description: '先原生 read，再原样提供含 frontmatter 的完整旧条目' } } : {}),
      },
      required: ['scope', '操作', '名称', '描述', '类', '来源', '正文', ...(scope === 'book' ? ['bookId'] : []), ...(operation === '更新' ? ['原文'] : [])],
    } satisfies JsonSchemaNode))),
  }
  const memoryParameters = {
    type: 'object', additionalProperties: false,
    properties: { ...memoryProperties, scope: { type: 'string', enum: ['book', 'author'] },
      操作: { type: 'string', enum: ['新增', '更新'] },
      bookId: { type: 'string', description: 'scope=book 必填；scope=author 不传' },
      原文: { type: 'string', description: '仅更新必填，提供原生 read 读到的完整旧条目，含 frontmatter' } },
    required: ['scope', '操作', '名称', '描述', '类', '来源', '正文'],
  }
  const tools: NovelToolDefinition[] = [
    ...createReferenceTools(deps),
    {
      name: 'novel_select_book',
      description: '核对作者在对话中指定的小说，返回书id、书名、书仓近况与该书记忆目录快照，供后续调用使用。首次明确选书和作者切书时调用。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '书仓的唯一标识（如 b-123abc）或书名' },
        },
        required: ['bookId'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            bookId: { type: 'string' },
            bookName: { type: 'string' },
            近况: { type: 'string' },
            记忆目录: { type: 'string', description: '该书本书记忆目录的选书时快照（名称、一句话描述、文件位置；正文不含）' },
            message: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: (args, sessionContext) => {
        const root = deps.workspaceRoot(sessionContext?.agent)
        if (root === undefined) return toolFailure('host-unavailable', '工作范围未就绪：工作台还没有加载工作区')
        const books = scanBooks(root)
        const target = String(args['bookId']).trim()
        const matches = books.filter((b) => b.bookId === target || b.name === target)
        const matched = matches[0]
        if (matches.length > 1 || matched?.bookId && books.filter(b => b.bookId === matched.bookId).length > 1) {
          return { ok: false, reason: `书目或书id不唯一：${target}，请先核对重复书仓；不会自动选择或改写书id` }
        }
        if (!matched || !matched.bookId) {
          return {
            ok: false,
            reason: `未找到匹配的书目：${target}。当前可用书目：${books.map((b) => `《${b.name}》（${b.bookId}）`).join(', ') || '无'}`,
          }
        }
        const 近况 = progressLineOf(matched.root)
        return {
          ok: true,
          bookId: matched.bookId,
          bookName: matched.name,
          近况,
          记忆目录: bookMemoryCatalogText(matched.root),
          message: renderCurrentBook(matched.name, matched.bookId, 近况),
        }
      },
    },
    {
      name: 'novel_create_book',
      description: '新建一部长篇小说并初始化规范书仓。前置要求：七个构想字段齐全、核心创意与题材目标读者明确，其余可留白；作者已确认立项。',
      parameters: {
        type: 'object',
        properties: {
          bookName: { type: 'string', description: '小说书名（不可含路径字符与保留字）' },
          concept: {
            type: 'object',
            description: '作品构想七要素（状态必须为已确认）',
            properties: {
              状态: { type: 'string', enum: ['已确认'], description: '必须为已确认' },
              核心创意: { type: 'string' },
              题材与目标读者: { type: 'string' },
              主角核心欲望: { type: 'string' },
              主要冲突: { type: 'string' },
              核心看点: { type: 'string' },
              差异化方向: { type: 'string' },
              明确不要什么: { type: 'string' },
            },
            required: ['状态', '核心创意', '题材与目标读者', '主角核心欲望', '主要冲突', '核心看点', '差异化方向', '明确不要什么'],
          },
        },
        required: ['bookName', 'concept'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', description: '是否成功' },
            bookId: { type: 'string', description: '新建书仓的书id' },
            bookRoot: { type: 'string', description: '书仓绝对路径' },
            commit: { type: 'string', description: '建书首提交哈希' },
            reason: { type: 'string', description: '失败原因' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: (args, sessionContext) => {
        const root = deps.workspaceRoot(sessionContext?.agent)
        if (root === undefined) return toolFailure('host-unavailable', '工作范围未就绪：工作台还没有加载工作区')
        const bookName = String(args['bookName']).trim()
        const concept = args['concept'] as Concept
        const res = createBook({ workspaceRoot: root, 书名: bookName, concept })
        // 裁决 12：建书后不自动切书，由模型显式调 novel_select_book
        return res
      },
    },
    {
      name: 'novel_update_contract',
      description: '更新当前小说的作品契约分部（如题材与读者定位、核心看点与差异化等）。会自动保留书id与未修改分部。分部置为「已确认」即作者确认，随确认产生 design: 提交；暂定/留白不产生提交。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '书id（必填）' },
          partName: {
            type: 'string',
            enum: [
              '题材与读者定位',
              '核心看点与差异化',
              '阅读体验与情绪承诺',
              '主角原则与关系边界',
              '叙事方式与文风基调',
              '创作禁区与不可妥协项',
            ],
            description: '契约分部名称',
          },
          state: { type: 'string', enum: ['已确认', '暂定', '留白'], description: '分部确认状态' },
          content: { type: 'string', description: '该分部的详细设定文本。阅读体验与情绪承诺可含三级标题「章节篇幅」，其下只写三项列表：目标汉字数、下限汉字数、上限汉字数；正整数且下限≤目标≤上限。' },
          summary: { type: 'string', description: '提交摘要（可选，如「契约·核心看点」；缺省用分部名）' },
        },
        required: ['bookId', 'partName', 'state', 'content'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ...DESIGN_COMMIT_FIELDS,
            ok: { type: 'boolean', description: '是否成功' },
            message: { type: 'string', description: '结果说明' },
            reason: { type: 'string', description: '失败原因' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: async (args, sessionContext) => {
        const book = resolveBook(args, sessionContext)
        if (!book.ok) return book
        const bookRoot = book.bookRoot
        const bookId = String(args['bookId']).trim()
        const partName = args['partName'] as any
        const state = args['state'] as ContractPartState
        const content = String(args['content'])
        const parts: ContractParts = {
          [partName]: { state, body: content },
        }
        try {
          await writeNative(bookRoot, prepareContract(bookRoot, parts), sessionContext)
        } catch (err) {
          return failureFrom(err, `更新契约失败：`)
        }
        // 提交点跟随作者确认（拍板 1）：只有已确认态产生 design: 提交；暂定/留白只写文件。
        if (state !== '已确认') {
          return { ok: true, commitState: 'not-required', retryable: false, message: `已完成《${bookId}》契约【${partName}】更新，状态为〔${state}〕，无需提交，不要为补提交重复调用。` }
        }
        const summary = args['summary'] !== undefined ? String(args['summary']).trim() : `契约·${partName}`
        const commit = commitConfirmed({
          bookRoot,
          paths: [paths.契约()],
          prefix: 'design',
          summary,
          provenance: provenanceOf(sessionContext, [paths.契约()]),
        })
        return designCommitResult(commit, `契约【${partName}】`, args, sessionContext)
      },
    },
    {
      name: 'novel_seed_min_design',
      description: '【测试/走查专用】为测试书一键写入占位设计（各部只有「已确认」标注、没有正文），用于验证空内容与模板待核对提示，不代表开写就绪；不得用于作者的书。成功后整批一次 design: 提交；重跑幂等（已提交过则无改动、不重复提交）。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '书id（必填）' },
        },
        required: ['bookId'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', description: '是否成功' },
            message: { type: 'string', description: '结果说明' },
            reason: { type: 'string', description: '失败原因' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: (args, sessionContext) => {
        const book = resolveBook(args, sessionContext)
        if (!book.ok) return book
        const bookRoot = book.bookRoot
        // resolveBook 已校验 bookId 非空。
        const bookId = String(args['bookId']).trim()
        try {
          seedMinDesign(bookRoot)
        } catch (err) {
          return failureFrom(err, `初始化最小设计失败：`)
        }
        // 整批一次提交（拍板 7）：seed 写入的全部设计侧工件随本次确认一并入 git。
        const 卷 = 1
        const seedPaths = [
          paths.契约(),
          '世界书/模块声明.md',
          '世界书/人物档案/主角.md',
          '世界书/世界规则/基础规则.md',
          '大纲/故事骨架.md',
          '大纲/分卷布局.md',
          paths.卷纲(卷),
          paths.计划时间线(卷),
          paths.近期窗口(卷),
        ].filter((p) => fs.existsSync(nodePath.join(bookRoot, p)))
        const commit = commitConfirmed({ bookRoot, paths: seedPaths, prefix: 'design', summary: '最小设计骨架', provenance: provenanceOf(sessionContext, seedPaths) })
        if (!commit.ok) {
          return { ok: false, reason: `最小设计已写入但提交失败（重跑本工具即可补提交）：${commit.reason}` }
        }
        return {
          ok: true,
          message: commit.noChanges === true
            ? '测试占位设计已存在（本次无改动，未产生新提交）；仍需真实设计内容，不能据此判断开写就绪。'
            : `测试占位设计已写入；仍需真实设计内容，不能据此判断开写就绪。（${commit.message}）`,
        }
      },
    },
    {
      name: 'novel_get_story_status',
      description: '读取小说的真实推进状态与可恢复章节（从 Git 与书仓真源推导，断更无损恢复）。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '书id（必填）' },
        },
        required: ['bookId'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', description: '是否成功' },
            bookId: { type: 'string', description: '书id' },
            design: { type: 'object', description: '设计面事实清单与建议（建议仅供参考）；「内容问题」影响就绪建议，「已确认无内容」保留全部已确认空分部的提示，合法远期留白不阻塞' },
            chapters: { type: 'array', description: '章节事实清单列表（每章含逐行事实项与建议）' },
            书仓诊断: { type: 'array', items: { type: 'string' }, description: '书仓运行目录的问题（残留锁、隔离的事务）；没有问题时不返回' },
            reason: { type: 'string', description: '失败原因' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: (args, sessionContext) => {
        const book = resolveBook(args, sessionContext)
        if (!book.ok) return book
        const bookRoot = book.bookRoot
        // resolveBook 已校验 bookId 非空。
        const bookId = String(args['bookId']).trim()
        try {
          return { ok: true, bookId, ...readStoryStatus(bookRoot) }
        } catch (err) {
          return failureFrom(err, `推导状态失败：`)
        }
      },
    },
    {
      name: 'novel_check_book',
      description: '只读检查指定书仓，返回格式、问题位置及实际受检和未检范围。可用于主动核对，不要求开始新章；不修改文件、不恢复事务、不生成迁移计划。',
      parameters: MAINTENANCE_PARAMETERS,
      output: MAINTENANCE_OUTPUT,
      execute: (args, sessionContext) => {
        const book = resolveInspectionBook(args, sessionContext)
        if (!book.ok) return book
        if (sessionContext?.signal?.aborted) return cancelledInspection()
        const bookId = String(args['bookId']).trim()
        const 书仓检查 = readBookInspection(book.bookRoot)
        if (sessionContext?.signal?.aborted) return { ...cancelledInspection(), bookId, 书仓检查 }
        return { ok: true, bookId, 书仓检查, 待核对: inspectionNotes(书仓检查), message: '只读检查已返回。未修改书仓，也未生成迁移计划。' }
      },
    },
    {
      name: 'novel_begin_chapter',
      description: '作者明确开始新章时，替换原状态查询，不再加调状态工具。一次返回状态与书级开章核对；边界核实后才检查书仓。未收尾或无法核实时转恢复核对，不执行全仓检查。不指定或创建章节，不写文件，也不批准开写。恢复、改稿及普通查询仍用 novel_get_story_status。',
      parameters: MAINTENANCE_PARAMETERS,
      output: MAINTENANCE_OUTPUT,
      execute: (args, sessionContext) => {
        const book = resolveInspectionBook(args, sessionContext)
        if (!book.ok) return book
        if (sessionContext?.signal?.aborted) return cancelledInspection()
        const bookId = String(args['bookId']).trim()
        let 开章核对 = readOpeningInspection(book.bookRoot)
        if (sessionContext?.signal?.aborted) return { ...cancelledInspection(), bookId, 开章核对 }
        const 状态读取 = readStoryStatusSafely(book.bookRoot)
        if (sessionContext?.signal?.aborted) return { ...cancelledInspection(), bookId, 开章核对, 状态读取 }
        const 书仓检查: BookInspection | InspectionUnavailable = 开章核对.状态 === '边界已核对'
          ? readBookInspection(book.bookRoot)
          : { 状态: '未检查', 原因: '开章边界尚未核实，未执行全仓检查。先恢复或核对已有稿件；主动查格式可用 novel_check_book。' }
        if (sessionContext?.signal?.aborted) return { ...cancelledInspection(), bookId, 开章核对, 状态读取, 书仓检查 }
        // Both scans must refer to unchanged opening evidence, not two unrelated stable snapshots.
        if (开章核对.状态 === '边界已核对') {
          const latest = readOpeningInspection(book.bookRoot)
          if (latest.状态 !== '边界已核对') 开章核对 = latest
          else if (!开章核对.快照.稳定 || !latest.快照.稳定 || 开章核对.快照.指纹 !== latest.快照.指纹) {
            开章核对 = {
              ...latest, 状态: '无法核实',
              问题: [...latest.问题, { 代码: 'opening-snapshot-changed', 路径: '', 说明: '检查期间开章相关证据发生变化，请重新核对。' }],
              快照: { ...latest.快照, 稳定: false },
            }
          } else 开章核对 = latest
        }
        if (sessionContext?.signal?.aborted) return { ...cancelledInspection(), bookId, 开章核对, 状态读取, 书仓检查 }
        const 待核对 = [
          ...(状态读取.ok ? [] : [状态读取.reason]),
          ...('原因' in 开章核对 ? [开章核对.原因] : 开章核对.问题.map(issue => issue.说明)),
          ...(开章核对.状态 === '边界已核对' ? [] : [开章核对.状态]),
          ...inspectionNotes(书仓检查),
        ]
        return { ok: true, bookId, 状态读取, 开章核对, 书仓检查, 待核对: [...new Set(待核对)], message: '只读开章核对已返回。不代表章节已开始，也不代替作者批准。' }
      },
    },
    ...createBookUpgradeTools(deps),
    {
      name: 'novel_search_finalized',
      description: '检索指定书的已定稿正文。关键词与已启用嵌入服务融合召回；返回章节、路径、行号、版本和哈希。结果仅供定位，必须原生 read 核对原文后才能引用；无提供方或接口失败时明确返回关键词模式。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '当前工作范围内的书id（必填）' },
          query: { type: 'string', description: '待找的词句或情节描述，1–256 字符；关键词按完整字面匹配' },
          mode: { type: 'string', enum: ['hybrid', 'keyword'], description: '默认混合检索；精确词句可指定 keyword 跳过查询模型' },
          rerank: { type: 'boolean', description: '默认使用已启用的重排服务；false 跳过重排' },
          limit: { type: 'integer', description: '最多返回 1–50 条，默认 10' },
        },
        required: ['bookId', 'query'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            bookId: { type: 'string' },
            mode: { type: 'string', enum: ['hybrid', 'keyword'] },
            status: { type: 'string', enum: ['matches', 'no-matches', 'no-finalized', 'partial'] },
            query: { type: 'string' },
            hits: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  relativePath: { type: 'string' }, absolutePath: { type: 'string' },
                  volume: { type: 'integer' }, chapter: { type: 'integer' }, title: { type: 'string' },
                  startLine: { type: 'integer' }, endLine: { type: 'integer' }, snippet: { type: 'string' },
                  scene: { type: 'object', description: '所属场景的标识和原文起止行号' },
                  version: { oneOf: [{ type: 'string' }, { type: 'number' }] }, hash: { type: 'string', description: '原文件字节的 SHA-256' },
                  matchedBy: { type: 'array', items: { type: 'string', enum: ['keyword', 'semantic'] } },
                  来源标注: {
                    type: 'object',
                    properties: {
                      条目: { type: 'string' }, 片段: { type: 'string' }, 来源: { type: 'string' },
                      版本: { oneOf: [{ type: 'string' }, { type: 'number' }] }, 状态: { type: 'string' }, 完整性: { type: 'string' },
                    },
                    required: ['条目', '片段', '来源', '版本', '状态', '完整性'],
                  },
                },
                required: ['relativePath', 'absolutePath', 'volume', 'chapter', 'title', 'startLine', 'endLine', 'snippet', 'version', 'hash', 'matchedBy', '来源标注'],
              },
            },
            limited: { type: 'boolean' },
            issues: {
              type: 'array', description: '未能检索的来源，不可将 partial 解释为完整搜索',
              items: { type: 'object', properties: { path: { type: 'string' }, code: { type: 'string' }, message: { type: 'string' } }, required: ['path', 'code', 'message'] },
            },
            degraded: { type: 'string' },
            reranking: { type: 'object', description: '是否执行模型重排、候选数及降级原因' },
            index: {
              type: 'object',
              properties: {
                state: { type: 'string', enum: ['created', 'ready', 'rebuilt'] }, chapters: { type: 'integer' }, chunks: { type: 'integer' },
                embedded: { type: 'integer' }, reused: { type: 'integer' },
              },
              required: ['state', 'chapters', 'chunks', 'embedded', 'reused'],
            },
            message: { type: 'string' },
            code: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: async (args, sessionContext) => {
        const book = resolveBook(args, sessionContext)
        if (!book.ok) return { ...book, code: 'book-not-found' }
        const result = await searchFinalized(book.bookRoot, {
          query: args['query'] as string,
          limit: args['limit'] as number | undefined,
          getProvider: () => deps.embeddingProvider?.(sessionContext?.agent),
          getReranker: () => deps.rerankingProvider?.(sessionContext?.agent),
          mode: args['mode'] as 'hybrid' | 'keyword' | undefined,
          rerank: args['rerank'] as boolean | undefined,
          signal: sessionContext?.signal,
        })
        return { ...result, bookId: String(args['bookId']).trim() }
      },
    },
    {
      name: 'novel_index_manage',
      description: '查看指定书的后台索引状态，或委托程序更新、暂停、继续和重建。正常维护自动运行。收到索引错误先查状态；全量重建只在作者明确要求时使用，不自行操作数据库或无限重试。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '当前工作范围内的书id' },
          action: { type: 'string', enum: ['status', 'enable', 'disable', 'update', 'pause', 'resume', 'retry', 'rebuild', 'rescan-scenes'], description: '默认 status；update 增量更新，rebuild 仅重建向量；rescan-scenes 按作者明确要求重新识别场景' },
          chapter: { type: 'integer', minimum: 1, description: 'rescan-scenes 可指定一章；省略表示全书' },
        },
        required: ['bookId'],
      },
      output: {
        schema: { type: 'object', properties: { ok: { type: 'boolean' }, index: { type: 'object' }, code: { type: 'string' }, reason: { type: 'string' } }, required: ['ok'] },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: async (args, sessionContext) => {
        if (!sessionContext?.agent) return { ok: false, code: 'agent-required', reason: '索引管理需要当前主控' }
        if (!deps.indexManage) return { ok: false, code: 'unavailable', reason: '后台索引服务尚未就绪' }
        const action = args['action'] ?? 'status'
        if (typeof action !== 'string' || !['status', 'enable', 'disable', 'update', 'pause', 'resume', 'retry', 'rebuild', 'rescan-scenes'].includes(action)) return { ok: false, code: 'invalid-action', reason: '未知索引操作' }
        const book = resolveBook(args, sessionContext)
        if (!book.ok) return { ...book, code: 'book-not-found' }
        try { return { ok: true, index: await deps.indexManage(String(args['bookId']).trim(), action as IndexAction | 'status', sessionContext.agent, args['chapter'] as number | undefined) } }
        catch (error) { const failure = indexFailure(error); return { ok: false, code: failure.code, reason: failure.message } }
      },
    },
    {
      name: 'novel_prepare_pack',
      description: '组装本章待定稿包七件（正文/事实变更/时间线变更/账本变更/章摘要/卷对账/记忆候选）到草稿区定稿准备目录，供呈报作者裁决。传沉淀候选（沉淀子代理对账产出）则写入七件并逐段预校验，失败返回解析器原话且不写任何文件；不传则相应件为占位。前置：存在唯一待审稿。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '书id（必填）' },
          卷: { type: 'number', description: '卷号（如 1）' },
          章: { type: 'number', description: '章号（全书连续，如 1）' },
          章名: { type: 'string', description: '章名（如 第一章）' },
          时间线变更: { type: 'string', description: '沉淀候选：时间线变更全文（可选）' },
          账本变更: { type: 'string', description: '沉淀候选：账本变更全文（可选）' },
          记忆候选: { type: 'string', description: '少量长期结论，可为空；条目操作为新增或更新' },
          记忆原文: { type: 'object', additionalProperties: { type: 'string' }, description: '仅更新候选需要：名称到已读完整旧条目的映射' },
          章摘要: { type: 'string', description: '沉淀候选：章摘要全文（可选）' },
          事实变更: { type: 'string', description: '沉淀候选：事实变更全文（可选）' },
        },
        required: ['bookId', '卷', '章', '章名'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', description: '是否成功' },
            dir: { type: 'string', description: '待定稿包目录（书仓内相对路径）' },
            files: { type: 'array', description: '七件清单' },
            message: { type: 'string', description: '结果说明' },
            reason: { type: 'string', description: '失败原因' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: (args, sessionContext) => {
        const book = resolveBook(args, sessionContext)
        if (!book.ok) return book
        const bookRoot = book.bookRoot
        const keyResult = chapterKeyOf(args)
        if (!keyResult.ok) return keyResult
        const key = keyResult.key
        const textArg = (name: string): string | undefined => {
          const raw = args[name]
          if (raw === undefined || raw === null) return undefined
          const s = String(raw)
          return s.trim() === '' ? undefined : s
        }
        const memoryOriginals = args['记忆原文']
        if (memoryOriginals !== undefined && (memoryOriginals === null || typeof memoryOriginals !== 'object' || Array.isArray(memoryOriginals) || Object.values(memoryOriginals).some(value => typeof value !== 'string'))) {
          return toolFailure('invalid-argument', '记忆原文须为条目名称到完整原文的映射')
        }
        const 沉淀候选 = {
          ...(memoryOriginals === undefined ? {} : { 记忆原文: memoryOriginals as Record<string, string> }),
          ...(textArg('时间线变更') === undefined ? {} : { 时间线变更: textArg('时间线变更') }),
          ...(textArg('账本变更') === undefined ? {} : { 账本变更: textArg('账本变更') }),
          ...(textArg('记忆候选') === undefined ? {} : { 记忆候选: textArg('记忆候选') }),
          ...(textArg('章摘要') === undefined ? {} : { 章摘要: textArg('章摘要') }),
          ...(textArg('事实变更') === undefined ? {} : { 事实变更: textArg('事实变更') }),
        }
        try {
          const res = preparePack(bookRoot, key, 沉淀候选)
          if (!res.ok) return { ok: false, reason: res.reason }
          return {
            ok: true,
            dir: res.dir,
            files: res.files,
            message: `待定稿包已组装至 ${res.dir}，请逐件审阅后呈报作者裁决；作者批准后再调用 novel_settle_chapter 沉淀。`,
          }
        } catch (err) {
          return failureFrom(err, `组装待定稿包失败：`)
        }
      },
    },
    {
      name: 'novel_settle_chapter',
      description: '定稿原子沉淀：将作者已批准的待定稿包按清单原子写入并做单次 Git 提交（ch:）。⚠️ 仅在作者明确批准定稿裁决后调用，未获批准严禁入档。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '书id（必填）' },
          卷: { type: 'number', description: '卷号（如 1）' },
          章: { type: 'number', description: '章号（全书连续，如 1）' },
          章名: { type: 'string', description: '章名（如 第一章）' },
          summary: { type: 'string', description: '提交摘要（如 第一章 登船）' },
        },
        required: ['bookId', '卷', '章', '章名', 'summary'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', description: '是否成功' },
            message: { type: 'string', description: '结果说明（含入档去处）' },
            reason: { type: 'string', description: '失败原因' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: async (args, sessionContext) => {
        if (!deps.askFn) return toolFailure('host-unavailable', '裁决通道不可用：当前环境无法弹出作者裁决窗口，本次没有写入')
        const book = resolveBook(args, sessionContext)
        if (!book.ok) return book
        const bookRoot = book.bookRoot
        const keyResult = chapterKeyOf(args)
        if (!keyResult.ok) return keyResult
        const key = keyResult.key
        const approvalFiles = [paths.待定稿包目录(key.卷, key.章名), paths.契约()]
        const before = captureApprovalFiles(bookRoot, approvalFiles, args)
        if (!before.ok) return before
        const decision = await askAuthor(deps.askFn, '定稿入档', { 范围: `卷${key.卷.toString().padStart(2, '0')}/${key.章名}` }, { agent: sessionContext?.agent, signal: sessionContext?.signal })
        if (!decision.ok) return notApproved(decision.reason)
        if (sessionContext?.signal?.aborted) return toolFailure('author-cancelled', '作者裁决已取消（会话已中止），没有做出决定，本次没有写入')
        // decision.ok 只表示答案有效;退回同样是有效答案,须按 决定 判。
        const 裁决 = decision.决定 === '已批准' ? '已批准' : '已退回'
        return withBookWrite(bookRoot, () => {
          if (sessionContext?.signal?.aborted) return toolFailure('author-cancelled', '作者裁决已取消（会话已中止），没有做出决定，本次没有写入')
          const currentBook = resolveBook(args, sessionContext)
        if (!currentBook.ok || currentBook.bookRoot !== bookRoot) return toolFailure('approval-stale', '等待作者裁决期间书id或归属已变化，本次没有写入', '调用 novel_select_book 核对书目，再重新呈报作者。')
        const current = captureApprovalFiles(bookRoot, approvalFiles, args)
          if (!current.ok || current.fingerprint !== before.fingerprint) return toolFailure('approval-stale', '待定稿包在等待作者裁决期间已变化，旧批准不可使用')
          const decisionWrite = writeSettlementDecision(bookRoot, key, 裁决)
          if (裁决 !== '已批准') {
            // 驳回本身必须保留原有语义;清单缺失时无法落裁决,但不能把作者决定
            // 误报成基础设施错误。若清单存在,上面的回写仍会打通退回通路。
            return toolFailure('author-declined', `未获作者批准：作者${decision.决定}，本章没有入档`)
          }
          if (!decisionWrite.ok) return { ok: false, reason: decisionWrite.reason }
          try {
            const res = archiveChapter({
              bookRoot,
              packageDir: paths.待定稿包目录(key.卷, key.章名),
              summary: String(args['summary']).trim(),
              settlement: { 章节: key, 批准: true, 裁决记录: `作者于 ${new Date().toISOString()} 批准定稿入档（kind=${decision.kind}, 决定=${decision.决定}）` },
              provenance: provenanceOf(sessionContext),
            })
            if (!res.ok) return { ok: false, reason: res.reason }
            return { ok: true, message: `定稿沉淀完成（${res.message}），入档：${res.dests.join('、')}` }
          } catch (err) {
            return failureFrom(err, `定稿沉淀失败：`)
          }
        }, provenanceOf(sessionContext))
      },
    },
    {
      name: 'novel_new_outline_draft',
      description: '在草稿区落一份候选细纲（空模板或带正文与来源引用）。候选属草稿区散文工件，可反复重写；确认落真源须走 novel_confirm_outline。空模板不含约束分级标记，确认前正文须自带至少一行〔硬〕/〔软〕/〔自由〕行内标记。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '书id（必填）' },
          卷: { type: 'number', description: '卷号（如 1）' },
          章名: { type: 'string', description: '章名（如 第一章）' },
          正文: { type: 'string', description: '细纲正文（可选，缺省落空模板）' },
          来源引用: { type: 'array', items: { type: 'string' }, description: '来源引用行（可选）。合法形态：来源:<仓内相对路径>@<版本>（如 大纲/卷规划/卷01/卷纲.md@1）、来源:作者自定义、来源:对谈共创；锚点/行号/绝对路径无效' },
        },
        required: ['bookId', '卷', '章名'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', description: '是否成功' },
            relPath: { type: 'string', description: '候选细纲相对路径' },
            message: { type: 'string', description: '结果说明' },
            reason: { type: 'string', description: '失败原因' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: (args, sessionContext) => {
        const book = resolveBook(args, sessionContext)
        if (!book.ok) return book
        const 卷 = Number(args['卷'])
        const 章名 = String(args['章名'] ?? '').trim()
        if (!Number.isSafeInteger(卷) || 卷 < 1) return toolFailure('invalid-argument', `卷必须是从 1 开始的正整数。请检查 卷 参数（收到：${String(args['卷'] ?? '未传')}）`)
        if (章名 === '') return { ok: false, reason: '章名不能为空（须与近期窗口条目逐字一致）' }
        try {
          const rel = writeCandidate(book.bookRoot, {
            卷,
            章名,
            body: args['正文'] === undefined ? undefined : String(args['正文']),
            来源引用: Array.isArray(args['来源引用']) ? (args['来源引用'] as unknown[]).map(String) : undefined,
          })
          return { ok: true, relPath: rel, message: `候选细纲已落草稿区：${rel}。完成后调 novel_confirm_outline 确认。` }
        } catch (err) {
          return failureFrom(err, `落候选细纲失败：`)
        }
      },
    },
    {
      name: 'novel_confirm_outline',
      description: '确认章细纲落真源（含既有门槛校验；已有确认细纲再确认＝版本+1；真源已落位、候选已删时重跑＝幂等补提交）。随确认产生 design(chNNNN): 提交，提案批次整批文件经「批次文件」一并入提交。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '书id（必填）' },
          卷: { type: 'number', description: '卷号（如 1）' },
          章: { type: 'number', description: '章号（全书连续，如 1）' },
          章名: { type: 'string', description: '章名（如 第一章）' },
          summary: { type: 'string', description: '提交摘要（可选，如「确认细纲·初见」）' },
          批次文件: { type: 'array', items: { type: 'string' }, description: '同批整改的受影响未定稿下游文件（提案批次整批确认）' },
        },
        required: ['bookId', '卷', '章', '章名'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', description: '是否成功' },
            relPath: { type: 'string', description: '确认细纲真源相对路径' },
            message: { type: 'string', description: '结果说明' },
            reason: { type: 'string', description: '失败原因' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: (args, sessionContext) => {
        const book = resolveBook(args, sessionContext)
        if (!book.ok) return book
        const keyResult = chapterKeyOf(args)
        if (!keyResult.ok) return keyResult
        const { 卷, 章, 章名 } = keyResult.key
        try {
          const r = confirmOutline(book.bookRoot, { 卷, 章, 章名 })
          if (!r.ok) return { ok: false, reason: r.gaps.join(';'), ...(r.播报 === undefined ? {} : { message: r.播报.join('；') }) }
          const batch = Array.isArray(args['批次文件']) ? (args['批次文件'] as unknown[]).map((v) => String(v).trim()).filter((v) => v !== '') : []
          const commit = commitConfirmed({
            bookRoot: book.bookRoot,
            paths: [paths.确认细纲(卷, 章, 章名), ...batch],
            prefix: 'design',
            summary: args['summary'] !== undefined ? String(args['summary']).trim() : `确认细纲·${章名}`,
            chapterScope: 章,
            provenance: provenanceOf(sessionContext, [paths.确认细纲(卷, 章, 章名), ...batch]),
          })
          if (!commit.ok) {
            return { ok: false, reason: `细纲已确认落位但提交失败（已落盘但未提交，重跑本工具即可补提交）：${commit.reason}` }
          }
          return {
            ok: true,
            relPath: paths.确认细纲(卷, 章, 章名),
            message: commit.noChanges === true
              ? `细纲《${章名}》此前已确认（幂等重放，无改动未产生新提交）`
              : `细纲《${章名}》已确认落真源（${commit.message}）${r.播报 && r.播报.length > 0 ? `；播报：${r.播报.join('；')}` : ''}`,
          }
        } catch (err) {
          return failureFrom(err, `确认细纲失败：`)
        }
      },
    },
    {
      name: 'novel_update_skeleton',
      description: '更新故事骨架（真源，覆盖式写入，再确认版本+1）。随确认产生 design: 提交；提案批次整批文件经「批次文件」一并入提交。影响面先经影响分析呈报、作者裁决后同批整改再整批确认。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '书id（必填）' },
          正文: { type: 'string', description: '骨架九部完整结构及状态标注；前两部确认当前追求与阻力，其余可暂定/留白，不强填终局；空的已确认部分仍报缺内容' },
          summary: { type: 'string', description: '提交摘要（可选）' },
          批次文件: { type: 'array', items: { type: 'string' }, description: '同批整改的受影响未定稿下游文件' },
        },
        required: ['bookId', '正文'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ...DESIGN_COMMIT_FIELDS,
            ok: { type: 'boolean', description: '是否成功' },
            relPath: { type: 'string', description: '真源相对路径' },
            message: { type: 'string', description: '结果说明' },
            reason: { type: 'string', description: '失败原因' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: async (args, sessionContext) => {
        const book = resolveBook(args, sessionContext)
        if (!book.ok) return book
        try {
          const w = prepareSkeleton(book.bookRoot, String(args['正文']))
          await writeNative(book.bookRoot, w, sessionContext)
          return finishDesignCommit(book.bookRoot, [w.relPath], args, '故事骨架', null, sessionContext)
        } catch (err) {
          return failureFrom(err, `更新故事骨架失败：`)
        }
      },
    },
    {
      name: 'novel_update_volume_layout',
      description: '更新分卷布局（真源，覆盖式写入，再确认版本+1）。随确认产生 design: 提交；提案批次整批文件经「批次文件」一并入提交。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '书id（必填）' },
          正文: { type: 'string', description: '分卷布局完整正文（Markdown）' },
          summary: { type: 'string', description: '提交摘要（可选）' },
          批次文件: { type: 'array', items: { type: 'string' }, description: '同批整改的受影响未定稿下游文件' },
        },
        required: ['bookId', '正文'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ...DESIGN_COMMIT_FIELDS,
            ok: { type: 'boolean', description: '是否成功' },
            relPath: { type: 'string', description: '真源相对路径' },
            message: { type: 'string', description: '结果说明' },
            reason: { type: 'string', description: '失败原因' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: async (args, sessionContext) => {
        const book = resolveBook(args, sessionContext)
        if (!book.ok) return book
        try {
          const w = prepareVolumeLayout(book.bookRoot, String(args['正文']))
          await writeNative(book.bookRoot, w, sessionContext)
          return finishDesignCommit(book.bookRoot, [w.relPath], args, '分卷布局', null, sessionContext)
        } catch (err) {
          return failureFrom(err, `更新分卷布局失败：`)
        }
      },
    },
    {
      name: 'novel_roll_window',
      description: '近期窗口滚动（真源）：追加新条目（状态默认「已确认」）或把既有条目标记「已消费」。随确认产生 design: 提交。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '书id（必填）' },
          卷: { type: 'number', description: '卷号（如 1）' },
          action: { type: 'string', enum: ['追加', '标已消费'], description: '追加新条目 / 把既有条目标已消费' },
          名称: { type: 'string', description: '窗口条目名称' },
          状态: { type: 'string', description: '追加时的状态（可选，默认「已确认」）' },
          summary: { type: 'string', description: '提交摘要（可选）' },
          批次文件: { type: 'array', items: { type: 'string' }, description: '同批整改的受影响未定稿下游文件' },
        },
        required: ['bookId', '卷', 'action', '名称'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ...DESIGN_COMMIT_FIELDS,
            ok: { type: 'boolean', description: '是否成功' },
            relPath: { type: 'string', description: '真源相对路径' },
            message: { type: 'string', description: '结果说明' },
            reason: { type: 'string', description: '失败原因' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: async (args, sessionContext) => {
        const book = resolveBook(args, sessionContext)
        if (!book.ok) return book
        const 卷 = Number(args['卷'])
        if (!Number.isSafeInteger(卷) || 卷 < 1) return toolFailure('invalid-argument', `卷必须是从 1 开始的正整数。请检查 卷 参数（收到：${String(args['卷'] ?? '未传')}）`)
        const 名称 = String(args['名称']).trim()
        const action = String(args['action'])
        try {
          const rel = paths.近期窗口(卷)
          let text = ''
          try { text = fs.readFileSync(nodePath.join(book.bookRoot, rel), 'utf-8') } catch { text = '' }
          const items = parseWindow(text).map((e) => ({ 名称: e.name, 状态: e.state }))
          if (action === '追加') {
            if (items.some((i) => i.名称 === 名称)) return { ok: false, reason: `窗口已有同名条目：${名称}` }
            items.push({ 名称, 状态: args['状态'] !== undefined ? String(args['状态']).trim() : '已确认' })
          } else {
            const hit = items.find((i) => i.名称 === 名称)
            if (hit === undefined) return { ok: false, reason: `窗口无条目「${名称}」，无法标已消费` }
            for (const i of items) if (i.名称 === 名称) i.状态 = '已消费'
          }
          await writeNative(book.bookRoot, prepareRecentWindow(卷, items), sessionContext)
          return finishDesignCommit(book.bookRoot, [rel], args, `近期窗口·${action}`, null, sessionContext)
        } catch (err) {
          return failureFrom(err, `窗口滚动失败：`)
        }
      },
    },
    {
      name: 'novel_confirm_worldbook_entry',
      description: '新建/确认世界书计划条目（真源），或更新其计划首段与明确字段；省略保留旧值和追加事实。事实由定稿入档写入，修改走更正/吃书。随确认产生 design: 提交；提案批次整批文件经「批次文件」一并入提交。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '书id（必填）' },
          模块: { type: 'string', description: '世界书模块名（如 人物档案）' },
          名称: { type: 'string', description: '条目名（如 主角）' },
          类型: { type: 'string', description: WORLDBOOK_INPUT_FIELDS.类型.description },
          性质: { type: 'string', enum: [...WORLDBOOK_NATURES], description: WORLDBOOK_INPUT_FIELDS.性质.description },
          状态: { type: 'string', enum: [...WORLDBOOK_STATES], description: WORLDBOOK_INPUT_FIELDS.状态.description },
          来源: { type: 'string', description: WORLDBOOK_INPUT_FIELDS.来源.description },
          别名: { type: 'string', description: WORLDBOOK_INPUT_FIELDS.别名.description },
          正文: { type: 'string', description: WORLDBOOK_INPUT_FIELDS.正文.description },
          summary: { type: 'string', description: '提交摘要（可选）' },
          批次文件: { type: 'array', items: { type: 'string' }, description: '同批整改的受影响未定稿下游文件' },
        },
        required: ['bookId', '模块', '名称'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ...DESIGN_COMMIT_FIELDS,
            ok: { type: 'boolean', description: '是否成功' },
            relPath: { type: 'string', description: '条目真源相对路径' },
            message: { type: 'string', description: '结果说明' },
            reason: { type: 'string', description: '失败原因' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: async (args, sessionContext) => {
        const book = resolveBook(args, sessionContext)
        if (!book.ok) return book
        const 模块 = String(args['模块']).trim()
        const 名称 = String(args['名称']).trim()
        try {
          // Core validates raw JSON values; do not turn null, arrays or omissions into text.
          const fields = Object.fromEntries(Object.keys(WORLDBOOK_INPUT_FIELDS)
            .filter(key => Object.hasOwn(args, key)).map(key => [key, args[key]])) as WorldbookEntryInput
          const op = prepareEntry(book.bookRoot, 模块, 名称, fields)
          await writeNative(book.bookRoot, op, sessionContext)
          ensureModulesDeclared(book.bookRoot, [模块])
          return finishDesignCommit(book.bookRoot, [op.relPath, '世界书/模块声明.md'], args, `世界书条目·${名称}`, null, sessionContext)
        } catch (err) {
          return failureFrom(err, `写入世界书条目失败：`)
        }
      },
    },
    {
      name: 'novel_confirm_volume_outline',
      description: '确认当前卷规划（卷纲或计划时间线，真源）或卷摘要（卷末复盘后经候选确认落盘，真源）。随确认产生 design: 提交；提案批次整批文件经「批次文件」一并入提交。卷摘要沿用版本协议：首次 v1、正文变化 +1、原样重跑复用版本。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '书id（必填）' },
          卷: { type: 'number', description: '卷号（如 1）' },
          目标: { type: 'string', enum: ['卷纲', '计划时间线', '卷摘要'], description: '写哪一件' },
          正文: { type: 'string', description: '完整正文（Markdown）' },
          summary: { type: 'string', description: '提交摘要（可选）' },
          批次文件: { type: 'array', items: { type: 'string' }, description: '同批整改的受影响未定稿下游文件' },
        },
        required: ['bookId', '卷', '目标', '正文'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ...DESIGN_COMMIT_FIELDS,
            ok: { type: 'boolean', description: '是否成功' },
            relPath: { type: 'string', description: '卷大纲真源相对路径' },
            gaps: { type: 'array', description: '卷纲段落缺口' },
            message: { type: 'string', description: '结果说明' },
            reason: { type: 'string', description: '失败原因' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: async (args, sessionContext) => {
        const book = resolveBook(args, sessionContext)
        if (!book.ok) return book
        const 卷 = Number(args['卷'])
        if (!Number.isSafeInteger(卷) || 卷 < 1) return toolFailure('invalid-argument', `卷必须是从 1 开始的正整数。请检查 卷 参数（收到：${String(args['卷'] ?? '未传')}）`)
        const 目标 = String(args['目标'])
        try {
          const rel = 目标 === '卷纲' ? paths.卷纲(卷) : 目标 === '卷摘要' ? paths.卷摘要(卷) : paths.计划时间线(卷)
          if (目标 === '卷纲') {
            const 正文 = String(args['正文'])
            const gaps = volumeOutlineGaps(正文)
            if (gaps.length > 0) return { ok: false, reason: gaps.join(';'), gaps }
            await writeNative(book.bookRoot, prepareVolumeOutline(book.bookRoot, 卷, 正文), sessionContext)
          }
          else if (目标 === '卷摘要') await writeNative(book.bookRoot, prepareVolumeSummary(book.bookRoot, 卷, String(args['正文'])), sessionContext)
          else await writeNative(book.bookRoot, preparePlanTimeline(book.bookRoot, 卷, String(args['正文'])), sessionContext)
          return finishDesignCommit(book.bookRoot, [rel], args, `${目标}·卷${String(卷).padStart(2, '0')}`, null, sessionContext)
        } catch (err) {
          return failureFrom(err, `确认${目标}失败：`)
        }
      },
    },
    {
      name: 'novel_assemble_materials',
      description: '组装本章十段基础材料并保留已登记补充。ok 表示操作完成，材料有缺或旧来源过期仍如实报告。卷纲参考中的候选只供选料，不自动进入已选材料；主控核对后以用途=本章卷纲参考登记原文。补充先用模式=预览取得原文、来源读取哈希与材料清单哈希，再用模式=保存提交返回的操作。来源限当前书或同工作范围书房原文，索引不是证据。来源变化保留旧摘录并标过期。是否开写由主控判断。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '书id（必填）' },
          卷: { type: 'number', description: '卷号（如 1）' },
          章: { type: 'number', description: '章号（全书连续，如 1）' },
          章名: { type: 'string', description: '章名（如 第一章）' },
          模式: { type: 'string', enum: ['预览', '保存'], description: '预览只读；保存按核对后的引用落盘；缺省保存' },
          材料清单哈希: { type: 'string', description: '预览返回的当前清单SHA-256；空字符串表示此前无清单，设置/移除时传入' },
          补充操作: {
            type: 'array', description: '显式设置或移除补充；省略时保留既有补充',
            items: {
              type: 'object', required: ['操作', '编号'], properties: {
                操作: { type: 'string', enum: ['设置', '移除'] },
                编号: { type: 'string', description: '稳定编号，如 memory-1，字母数字短横线下划线，最长64位' },
                标题: { type: 'string', description: '设置时必填，自由标题' },
                理由: { type: 'string', description: '设置时必填，本章为什么需要这段原文' },
                性质: { type: 'string', enum: ['原文', '建议'], description: '设置时必填，建议不作事实' },
                用途: { type: 'string', enum: ['本章卷纲参考'], description: '选取本章卷纲依据时填写；须引用本书当前卷纲且性质为原文，普通补充省略' },
                来源: {
                  type: 'object', required: ['域', '路径'], properties: {
                    域: { type: 'string', enum: ['本书', '书房'] },
                    路径: { type: 'string', description: '对应域内相对原文路径；书房示例 作者记忆/决策.md；不能引用索引' },
                    起行: { type: 'integer', minimum: 1, description: '从1开始，省略从首行读' },
                    终行: { type: 'integer', minimum: 1, description: '包含该行；省略读到末行' },
                    读取哈希: { type: 'string', description: '预览自动返回；保存时原样带回，拒绝来源漂移' },
                  },
                },
              },
            },
          },
        },
        required: ['bookId', '卷', '章', '章名'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', description: '本次计算或保存是否完成；不代表材料齐备或允许开写' },
            dir: { type: 'string', description: '材料包目录' },
            状态: { type: 'string', description: '材料包完整状态' },
            gaps: { type: 'array', description: '缺口清单' },
            readiness: { type: 'object', description: '开写就绪度报告' },
            材料清单哈希: { type: 'string', description: '预览时为当前清单哈希，保存时为写入后哈希' },
            合计字数: { type: 'number', description: '基础与补充材料合计字数' },
            补充预览: { type: 'array', description: '核对用原文及带来源读取哈希的操作；保存时只需回传操作，无需转录原文' },
            卷纲参考: { type: 'object', description: '自动定位结果、供主控核对的候选原文/来源范围、当前计算方案的已登记参考及有效性；预览尚未落盘' },
            message: { type: 'string', description: '结果说明' },
            reason: { type: 'string', description: '失败原因' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: (args, sessionContext) => {
        const book = resolveBook(args, sessionContext)
        if (!book.ok) return book
        const keyResult = chapterKeyOf(args)
        if (!keyResult.ok) return keyResult
        const { 卷, 章, 章名 } = keyResult.key
        try {
          const input = { 卷, 章, 章名,
            ...(Array.isArray(args['补充操作']) ? { 补充操作: args['补充操作'] as SupplementEdit[] } : {}),
            ...(typeof args['材料清单哈希'] === 'string' ? { 材料清单哈希: args['材料清单哈希'] } : {}),
          }
          if (args['模式'] === '预览') {
            const result = computeMaterials(book.bookRoot, { ...input, 仅预览: true })
            // 失败或空补充时可选字段缺席；工具返回值必须是无损 JSON，undefine 会被宿主拒收。
            return { ok: result.ok, dir: result.dir, 状态: result.状态, gaps: result.gaps,
              材料清单哈希: result.已有清单哈希 ?? '', 合计字数: result.合计字数 ?? 0, 补充预览: result.补充预览 ?? [],
              ...(result.卷纲参考 === undefined ? {} : { 卷纲参考: result.卷纲参考 }),
              message: result.ok ? `材料预览已计算（状态：${result.状态}），未落盘。核对原文后，用返回的操作（含读取哈希）和材料清单哈希保存。` : `材料预览未完成：${result.gaps.join('；')}`,
            }
          }
          const res = assembleMaterials(book.bookRoot, input)
          if (!res.ok) return { ok: false, dir: res.dir, 状态: res.状态, gaps: res.gaps, 材料清单哈希: res.材料清单哈希 ?? '', reason: `材料包未保存：${res.gaps.join(';')}` }
          const readiness = reportDraftReadiness(book.bookRoot, `草稿区/草稿/卷${String(卷).padStart(2, '0')}-${章名}/`)
          return {
            ok: true,
            dir: res.dir,
            状态: res.状态,
            gaps: res.gaps,
            readiness,
            材料清单哈希: res.材料清单哈希, 合计字数: res.合计字数,
            ...(res.卷纲参考 === undefined ? {} : { 卷纲参考: res.卷纲参考 }),
            message: `材料包已保存至 ${res.dir}（状态：${res.状态}${res.gaps.length > 0 ? `；缺:${res.gaps.join('、')}` : ''}）。${readiness?.说明 ?? ''}`,
          }
        } catch (err) {
          return failureFrom(err, `组装材料包失败：`)
        }
      },
    },
    {
      name: 'novel_apply_revision',
      description: '落实一条发现项处置。带补丁且处置为已解决/已接受修改时产出新待审稿；不带补丁只记处置。可记录上游条目的作者保留/已驳回/无法判断；关联提案已通过后记「已转提案」并传提案编号。实际真源修改只走提案。补丁新文只能是作者给出的原文改法（逐字新句或明确删除），此时传 生成模块: 作者手改；作者只给方向时，派改稿子代理。先从 novel_get_story_status 取得本章审核记录哈希并传入，避免覆盖旧记录；多项走 novel_apply_revision_batch。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '书id（必填）' },
          卷: { type: 'number', description: '卷号（如 1）' },
          章: { type: 'number', description: '章号（全书连续，如 1）' },
          章名: { type: 'string', description: '章名（如 第一章）' },
          发现项编号: { type: 'string', description: '审核记录中的发现项编号' },
          审核记录哈希: { type: 'string', description: '状态查询或上次处置返回的记录 SHA-256；不一致时拒绝写入' },
          改动说明: { type: 'string', description: '本条处置说明（可选，省略保留已有说明）' },
          提案编号: { type: 'string', pattern: '^\\d{4}$', description: '已转提案时传已通过且关联本发现项的四位提案编号' },
          生成模块: { type: 'string', description: '作者逐字给出的小修传 作者手改' },
          处置: { type: 'string', enum: ['待处理', '已接受修改', '已解决', '作者保留', '已驳回', '无法判断', '已转提案'], description: '处置状态。已转提案：影响真源的发现项已登记提案且作者已通过，必须传四位提案编号，提案须关联本章本发现项' },
          补丁旧文: { type: 'string', description: '补丁 old（可选；与补丁新文成对）' },
          补丁新文: { type: 'string', description: '补丁 new（可选）' },
        },
        required: ['bookId', '卷', '章', '章名', '发现项编号', '处置'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', description: '是否成功' },
            relPath: { type: 'string', description: '新一版待审稿相对路径（无补丁时缺席）' },
            审核记录哈希: { type: 'string', description: '写入后的记录 SHA-256，供下一次处置使用' },
            message: { type: 'string', description: '结果说明' },
            reason: { type: 'string', description: '失败原因' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: (args, sessionContext) => {
        const book = resolveBook(args, sessionContext)
        if (!book.ok) return book
        const keyResult = chapterKeyOf(args)
        if (!keyResult.ok) return keyResult
        const key = keyResult.key
        try {
          if ((args['补丁旧文'] === undefined) !== (args['补丁新文'] === undefined)) return { ok: false, reason: '补丁旧文与补丁新文必须成对提供' }
          const hasPatch = args['补丁旧文'] !== undefined && args['补丁新文'] !== undefined
          const res = applyRevision(book.bookRoot, key, {
            发现项编号: String(args['发现项编号']).trim(),
            处置: String(args['处置']) as 处置状态,
            ...(args['审核记录哈希'] === undefined ? {} : { 审核记录哈希: String(args['审核记录哈希']) }),
            ...(args['改动说明'] === undefined ? {} : { 改动说明: String(args['改动说明']) }),
            ...(args['提案编号'] === undefined ? {} : { 提案编号: String(args['提案编号']) }),
            ...(args['生成模块'] === undefined ? {} : { 生成模块: String(args['生成模块']) }),
            ...(hasPatch ? { 补丁: { old: String(args['补丁旧文']), new: String(args['补丁新文']) } } : {}),
          })
          if (!res.ok) return { ok: false, reason: res.reason }
          return { ok: true, relPath: res.relPath, 审核记录哈希: res.审核记录哈希, message: res.relPath === undefined ? '处置已记入审核记录（无补丁，不产生新稿）' : `已产出新一版待审稿：${res.relPath}` }
        } catch (err) {
          return failureFrom(err, `落实处置失败：`)
        }
      },
    },
    {
      name: 'novel_apply_revision_batch',
      description: '处置批落实：新稿与全部处置同批落盘；不传新稿正文只回写选定处置，保留其余字段和审核证据。传入状态查询或上次处置返回的审核记录哈希；旧记录、重复或未知编号整批拒绝。上游条目的保留/驳回/无法判断用纯处置批记录，实际修改仍走提案，不与正文修改混批。作者稿用 novel_import_draft。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '书id（必填）' },
          卷: { type: 'number', description: '卷号（如 1）' },
          章: { type: 'number', description: '章号（全书连续，如 1）' },
          章名: { type: 'string', description: '章名（如 第一章）' },
          新稿正文: { type: 'string', description: '改稿子代理返回的整稿正文（可选；不传＝只回写处置）' },
          审核记录哈希: { type: 'string', description: '状态查询或上次处置返回的记录 SHA-256；不一致时整批拒绝' },
          候选事实: { type: 'array', items: { type: 'string' }, description: '覆盖候选事实段（可选；不传沿用源稿）' },
          生成模块: { type: 'string', description: '留痕用（可选；默认 改稿，作者手改时传 作者手改）' },
          处置: {
            type: 'array',
            description: '处置清单（逐条对应审核记录发现项）',
            items: {
              type: 'object',
              properties: {
                发现项编号: { type: 'string', description: '审核记录中的发现项编号' },
                处置: { type: 'string', enum: ['待处理', '已接受修改', '已解决', '作者保留', '已驳回', '无法判断', '已转提案'], description: '处置状态。已转提案：影响真源的发现项已登记提案且作者已通过，必须传四位提案编号，提案须关联本章本发现项' },
                改动说明: { type: 'string', description: '该条对应的改动说明（可选）' },
                提案编号: { type: 'string', pattern: '^\\d{4}$', description: '已转提案时传已通过且关联本发现项的四位提案编号' },
              },
              required: ['发现项编号', '处置'],
            },
          },
        },
        required: ['bookId', '卷', '章', '章名', '处置'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', description: '是否成功' },
            relPath: { type: 'string', description: '新一版待审稿相对路径（只回写处置时缺席）' },
            更新条数: { type: 'number', description: '回写的处置条数' },
            审核记录哈希: { type: 'string', description: '写入后的记录 SHA-256，供下一批处置使用' },
            message: { type: 'string', description: '结果说明' },
            reason: { type: 'string', description: '失败原因' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: (args, sessionContext) => {
        const book = resolveBook(args, sessionContext)
        if (!book.ok) return book
        const raw处置 = args['处置']
        if (!Array.isArray(raw处置) || raw处置.length === 0) return { ok: false, reason: '处置清单为空' }
        const 处置 = raw处置.map((item) => {
          const o = (item ?? {}) as Record<string, unknown>
          const 改动说明 = typeof o['改动说明'] === 'string' && o['改动说明'].trim() !== '' ? String(o['改动说明']) : undefined
          return {
            发现项编号: String(o['发现项编号'] ?? '').trim(),
            处置: String(o['处置'] ?? '') as 处置状态,
            ...(o['提案编号'] === undefined ? {} : { 提案编号: String(o['提案编号']) }),
            ...(改动说明 === undefined ? {} : { 改动说明 }),
          }
        })
        const keyResult = chapterKeyOf(args)
        if (!keyResult.ok) return keyResult
        try {
          const res = applyRevisionBatch(book.bookRoot, {
            ...keyResult.key,
            ...(args['新稿正文'] === undefined ? {} : { 新稿正文: String(args['新稿正文']) }),
            ...(args['审核记录哈希'] === undefined ? {} : { 审核记录哈希: String(args['审核记录哈希']) }),
            ...(Array.isArray(args['候选事实']) ? { 候选事实: (args['候选事实'] as unknown[]).map(String) } : {}),
            ...(args['生成模块'] === undefined ? {} : { 生成模块: String(args['生成模块']) }),
            处置,
          })
          if (!res.ok) return { ok: false, reason: res.reason }
          return {
            ok: true,
            ...(res.relPath === undefined ? {} : { relPath: res.relPath }),
            更新条数: res.更新条数,
            审核记录哈希: res.审核记录哈希,
            message: res.relPath === undefined
              ? `已回写 ${res.更新条数} 条处置（无新稿）`
              : `已写入新稿 ${res.relPath}，并回写 ${res.更新条数} 条处置`,
          }
        } catch (err) {
          return failureFrom(err, `处置批落实失败：`)
        }
      },
    },
    {
      name: 'novel_import_draft',
      description: '作者稿导入：把作者亲手写的整章或改过的版本落为草稿区新一稿，与 AI 稿地位相同（生成模块留痕 作者手写/作者手改）。未要求润色的作者稿显式传 角色: 待审稿；作者要求润色才传 角色: 草稿。润色、改稿节点贴作者改过的版本用 角色: 待审稿（旧待审稿自动降级，父版本指向被改的稿）。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '书id（必填）' },
          卷: { type: 'number', description: '卷号（如 1）' },
          章: { type: 'number', description: '章号（全书连续，如 1）' },
          章名: { type: 'string', description: '章名（如 第一章）' },
          正文: { type: 'string', description: '作者稿全文（可带「## 草稿候选事实」段）' },
          候选事实: { type: 'array', items: { type: 'string' }, description: '候选事实（可选，逐条）' },
          角色: { type: 'string', enum: ['草稿', '待审稿'], description: '草稿＝写稿节点导入；待审稿＝润色/改稿节点替代导入' },
          生成模块: { type: 'string', enum: ['作者手写', '作者手改'], description: '整章自写＝作者手写；在某稿基础上改＝作者手改' },
          父版本: { type: 'number', description: '作者手改时指向被改稿的版本（可选；缺省取该章最新版本）' },
        },
        required: ['bookId', '卷', '章', '章名', '正文', '角色', '生成模块'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', description: '是否成功' },
            relPath: { type: 'string', description: '新稿相对路径' },
            diff: { type: 'array', description: '作者手改时：相对父版本的行级差异' },
            followup: { type: 'object', description: '作者手改时：后续范围报告（硬约束回查/仍待处置/建议重跑）' },
            message: { type: 'string', description: '结果说明' },
            reason: { type: 'string', description: '失败原因' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: (args, sessionContext) => {
        const book = resolveBook(args, sessionContext)
        if (!book.ok) return book
        const keyResult = chapterKeyOf(args)
        if (!keyResult.ok) return keyResult
        const key = keyResult.key
        const 角色 = String(args['角色']) === '待审稿' ? '待审稿' : '草稿'
        const 生成模块 = String(args['生成模块']) === '作者手改' ? '作者手改' : '作者手写'
        try {
          // M1：作者手改（待审稿替代）走 ingestAuthorRevision——正文原样落盘＋后续范围报告＋diff
          if (角色 === '待审稿' && 生成模块 === '作者手改') {
            const r = ingestAuthorRevision(book.bookRoot, key, String(args['正文'] ?? ''))
            if (!r.ok) return { ok: false, reason: r.reason }
            return {
              ok: true,
              relPath: r.relPath,
              diff: r.diff,
              followup: r.followup,
              message: `作者手改已摄入：${r.relPath}（生成模块 作者手改，原样落盘）。后续范围报告：硬约束回查失败 ${r.followup.硬约束回查失败.length} 项；仍待处置 ${r.followup.仍待处置.length} 项${r.followup.建议重跑.length > 0 ? `；建议重跑 ${r.followup.建议重跑.join('、')}` : ''}。是否重跑由你判断，本工具不自动开跑。`,
            }
          }
          const res = importAuthorDraft(book.bookRoot, {
            ...key,
            正文: String(args['正文'] ?? ''),
            ...(Array.isArray(args['候选事实']) ? { 候选事实: (args['候选事实'] as unknown[]).map(String) } : {}),
            角色,
            生成模块,
            ...(args['父版本'] === undefined ? {} : { 父版本: Number(args['父版本']) }),
          })
          if (!res.ok) return { ok: false, reason: res.reason }
          return {
            ok: true,
            relPath: res.relPath,
            ...(res.播报 === undefined ? {} : { 播报: res.播报 }),
            message: `作者稿已导入：${res.relPath}（生成模块 ${生成模块}，角色 ${角色}）。要跳过润色就传「角色: 待审稿」。`,
          }
        } catch (err) {
          return failureFrom(err, `作者稿导入失败：`)
        }
      },
    },
    {
      name: 'novel_record_review_findings',
      description: '把审读子代理产出的发现项回写进审核记录（堵「空审通过」）。返回本模块实际落盘的发现项编号与审核记录哈希，后续处置原样沿用，不缩写或自行拼接编号。同一模块重复回写＝本轮整批替换；跨轮按 模块名+证据位置+问题说明 认亲。全部模块回写仅表示报告齐全；证据须适用当前稿且发现项均有效处置，才能报告审核通过。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '书id（必填）' },
          卷: { type: 'number', description: '卷号（如 1）' },
          章: { type: 'number', description: '章号（全书连续，如 1）' },
          章名: { type: 'string', description: '章名（如 第一章）' },
          模块名: { type: 'string', description: '审读模块名（如 章节结构审读）' },
          发现项: {
            type: 'array',
            description: '发现项数组（每条含 证据位置/问题说明 等；无问题传空数组）',
            items: { type: 'object' },
          },
          审读指纹: { type: 'string', description: '自动模块每次必填：使用派发该模块时的审核输入指纹，不得省略或换成后来取得的值；作者意见可不提供' },
        },
        required: ['bookId', '卷', '章', '章名', '模块名', '发现项'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', description: '是否成功' },
            完成: { type: 'boolean', description: '全部审读模块（确定性＋语义）是否回写完毕' },
            审核通过: { type: 'boolean', description: '当前证据有效且所有发现项已处置' },
            待处置数: { type: 'number', description: '仍未处置的发现项数量' },
            待回写模块: { type: 'array', description: '尚未回写的模块名（与「完成」同源：为空即完成）' },
            待继承处置数: { type: 'number', description: '上一轮已给处置中暂存待继承的条数' },
            发现项编号: { type: 'array', description: '本模块实际落盘的规范编号，按接收的发现项顺序返回；处置时原样使用', items: { type: 'string' } },
            审核记录哈希: { type: 'string', description: '本次回写的记录 SHA-256，供后续处置使用；其他模块回写后使用最新哈希' },
            message: { type: 'string', description: '结果说明' },
            reason: { type: 'string', description: '失败原因' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: (args, sessionContext) => {
        const book = resolveBook(args, sessionContext)
        if (!book.ok) return book
        const keyResult = chapterKeyOf(args)
        if (!keyResult.ok) return keyResult
        try {
          const r = ingestFindings(book.bookRoot, keyResult.key, String(args['模块名']).trim(), Array.isArray(args['发现项']) ? (args['发现项'] as unknown[]) : [],
            typeof args['审读指纹'] === 'string' ? args['审读指纹'] : undefined)
          if (!r.ok || r.record === null) return { ok: false, reason: r.reason ?? '发现项回写未完成' }
          const 完成 = r.record?.完成 === true
          const 审核通过 = scanChapter(book.bookRoot, keyResult.key).审核完成
          const 待处置数 = r.record?.问题.filter(item => !item.处置状态 || item.处置状态 === '待处理').length ?? 0
          const pending = r.待回写模块 ?? []
          const 待继承处置数 = r.record?.待继承处置?.length ?? 0
          return {
            ok: true,
            完成,
            审核通过,
            待处置数,
            待回写模块: pending,
            待继承处置数,
            发现项编号: r.record.问题.filter(item => item.模块名 === String(args['模块名']).trim()).map(item => item.发现项编号),
            审核记录哈希: reviewRecordHashOf(serializeReviewRecord(r.record)),
            message: 审核通过
              ? '发现项已回写，全部模块完成，审核通过。'
              : 完成 ? `全部模块已回写，但审核尚未通过；仍有 ${待处置数} 项待处置，请核对当前证据并完成处置。`
              : `发现项已回写。尚待回写模块：${pending.join('、')}（全部回写后审核才完成）。${inheritNote(待继承处置数)}`,
          }
        } catch (err) {
          return failureFrom(err, `发现项回写失败：`)
        }
      },
    },
    {
      name: 'novel_record_proposal',
      description: '登记内容修改提案（登记本身不代表批准执行）：作者要求改某处、或审核/对账发现缺口漂移时登记，先跑影响分析脚本再补「影响分析」内容，呈作者裁决。提案文件落 草稿区/提案/，作者可读可改。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '书id（必填）' },
          域: { type: 'string', enum: ['内容修订', '吃书补偿'], description: '内容修订＝改计划/设定等真源；吃书补偿＝涉及已定稿内容' },
          类型: { type: 'string', enum: ['补充设计', '修改计划', '事实更正', '吃书'], description: '提案类型' },
          内容: { type: 'string', description: '提案正文：改什么、为什么、影响面摘要' },
          来源: { type: 'string', description: '提案来源（如「第3章审核发现项 2 条」「作者对话指示」）' },
          影响分析: { type: 'string', description: '影响分析脚本输出的摘要（可登记后补）' },
          关联发现项: { type: 'array', description: '从审核转交的提案须登记原发现项身份', items: { type: 'object', properties: {
            卷: { type: 'integer', minimum: 1 }, 章: { type: 'integer', minimum: 1 }, 章名: { type: 'string' }, 发现项编号: { type: 'string' },
          }, required: ['卷', '章', '章名', '发现项编号'] } },
        },
        required: ['bookId', '域', '类型', '内容', '来源'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', description: '是否成功' },
            编号: { type: 'string', description: '提案编号（4 位序）' },
            relPath: { type: 'string', description: '提案文件相对路径' },
            reason: { type: 'string', description: '失败原因' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: (args, sessionContext) => {
        const book = resolveBook(args, sessionContext)
        if (!book.ok) return book
        try {
          const r = registerProposal(book.bookRoot, {
            域: String(args['域']) === '吃书补偿' ? '吃书补偿' : '内容修订',
            类型: (['补充设计', '修改计划', '事实更正', '吃书'] as const).includes(args['类型'] as never) ? (args['类型'] as '补充设计' | '修改计划' | '事实更正' | '吃书') : '修改计划',
            内容: String(args['内容'] ?? ''),
            来源: String(args['来源'] ?? '作者对话指示'),
            ...(args['关联发现项'] === undefined ? {} : { 关联发现项: args['关联发现项'] as NonNullable<Parameters<typeof registerProposal>[1]['关联发现项']> }),
            ...(args['影响分析'] === undefined ? {} : { 影响分析: String(args['影响分析']) }),
          })
          return { ...r, message: `提案 ${r.编号} 已登记：${r.relPath}。先跑影响分析脚本补「影响分析」，再呈作者裁决（novel_resolve_proposal）。` }
        } catch (err) {
          return failureFrom(err, `提案登记失败：`)
        }
      },
    },
    {
      name: 'novel_resolve_proposal',
      description: '回写提案的作者裁决（通过/驳回＋裁决记录）。作者在对话或工作台的表态即决定（指令即批准）；已裁决的提案不重复回写。通过后：未定稿下游经确认类工具「批次文件」整批 design: 提交；已定稿下游走 novel_apply_retcon。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '书id（必填）' },
          提案编号: { type: 'string', description: '提案编号（4 位序，如 0001）' },
          决定: { type: 'string', enum: ['通过', '驳回'], description: '作者决定' },
          裁决记录: { type: 'string', description: '作者裁决的一句话理由（必填，留痕）' },
        },
        required: ['bookId', '提案编号', '决定', '裁决记录'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', description: '是否成功' },
            reason: { type: 'string', description: '失败原因' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: (args, sessionContext) => {
        const book = resolveBook(args, sessionContext)
        if (!book.ok) return book
        return resolveProposal(book.bookRoot, String(args['提案编号']).trim(), String(args['决定']) === '驳回' ? '驳回' : '通过', String(args['裁决记录'] ?? ''))
      },
    },
    {
      name: 'novel_apply_retcon',
      description: '吃书补偿执行（必过作者裁决）：把受影响定稿章按更正后正文重写、可选沉淀候选走整条更正（世界书/账本/记忆），生成补偿事件记录并单次 retcon: 提交。前置：影响分析已呈报、作者已在对话中批准。不是撤销——历史经补偿事件留痕。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '书id（必填）' },
          卷: { type: 'number', description: '受影响定稿章卷号' },
          章: { type: 'number', description: '受影响定稿章章号' },
          章名: { type: 'string', description: '受影响定稿章章名' },
          更正后正文: { type: 'string', description: '更正后的定稿章全文（原样落盘）' },
          提案编号: { type: 'string', description: '关联提案编号（可选）' },
          摘要: { type: 'string', description: '补偿事件摘要（retcon: 提交说明）' },
          事实变更: { type: 'string', description: '沉淀候选：事实变更全文（可选，走整条更正）' },
          时间线变更: { type: 'string', description: '沉淀候选：时间线变更全文（可选）' },
          账本变更: { type: 'string', description: '沉淀候选：账本变更全文（可选，更正既有条目）' },
          记忆候选: { type: 'string', description: '沉淀候选：本书层记忆候选全文（可选）' },
          更正后章摘要: { type: 'string', description: '更正后的章摘要全文（可选；未传则现有章摘要加失效标记，同提交）' },
        },
        required: ['bookId', '卷', '章', '章名', '更正后正文', '摘要'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', description: '是否成功' },
            dests: { type: 'array', description: 'retcon 提交覆盖的文件' },
            补偿事件: { type: 'string', description: '补偿事件记录相对路径' },
            reason: { type: 'string', description: '失败原因' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: async (args, sessionContext) => {
        if (!deps.askFn) return toolFailure('host-unavailable', '裁决通道不可用：当前环境无法弹出作者裁决窗口，本次没有写入')
        const book = resolveBook(args, sessionContext)
        if (!book.ok) return book
        const bookRoot = book.bookRoot
        const keyResult = chapterKeyOf(args)
        if (!keyResult.ok) return keyResult
        const key = keyResult.key
        args = structuredClone(args)
        // Normalize exactly what the writer consumes before any version/event is generated.
        let 更正正文输入 = String(args['更正后正文'] ?? '')
        const passthrough = parseDocument(更正正文输入)
        if (passthrough.ok && (passthrough.data.fields['身份'] !== undefined || passthrough.data.fields['角色'] !== undefined)) {
          更正正文输入 = passthrough.data.body
        }
        更正正文输入 = serializeDocument({}, 更正正文输入)
        const 候选字段 = ['事实变更', '时间线变更', '账本变更', '记忆候选'] as const
        const optionalText = (field: string) => String(args[field] ?? '').trim() ? String(args[field]) : null
        const request = {
          更正后正文: 更正正文输入,
          更正后章摘要: optionalText('更正后章摘要'),
          提案编号: args['提案编号'] === undefined ? null : String(args['提案编号']),
          摘要: String(args['摘要'] ?? '吃书补偿').trim(),
          ...Object.fromEntries(候选字段.map(field => [field, optionalText(field)])),
        }
        const approvalFiles = [paths.定稿章(key.卷, key.章, key.章名), paths.章摘要(key.卷, key.章, key.章名), paths.契约(),
          ...(候选字段.some(field => optionalText(field) !== null) ? ['世界书', '账本', '本书记忆'] : [])]
        const before = captureApprovalFiles(bookRoot, approvalFiles, args)
        if (!before.ok) return before
        const decision = await askAuthor(deps.askFn, '吃书补偿', { 范围: `定稿/卷${key.卷.toString().padStart(2, '0')}/${key.章名}` }, { agent: sessionContext?.agent, signal: sessionContext?.signal })
        if (!decision.ok) return notApproved(decision.reason)
        if (sessionContext?.signal?.aborted) return toolFailure('author-cancelled', '作者裁决已取消（会话已中止），没有做出决定，本次没有写入')
        if (decision.决定 !== '已批准') return toolFailure('author-declined', `未获作者批准：作者${decision.决定}，没有执行吃书补偿`)

        return withBookWrite(bookRoot, () => {
        if (sessionContext?.signal?.aborted) return toolFailure('author-cancelled', '作者裁决已取消（会话已中止），没有做出决定，本次没有写入')
        const currentBook = resolveBook(args, sessionContext)
        if (!currentBook.ok || currentBook.bookRoot !== bookRoot) return toolFailure('approval-stale', '等待作者裁决期间书id或归属已变化，本次没有写入', '调用 novel_select_book 核对书目，再重新呈报作者。')
        const current = captureApprovalFiles(bookRoot, approvalFiles, args)
        if (!current.ok || current.fingerprint !== before.fingerprint) return toolFailure('approval-stale', '待补偿内容在等待作者裁决期间已变化，旧批准不可使用')
        const 定稿相对 = paths.定稿章(key.卷, key.章, key.章名)
        const res = archiveRetconRequest({ bookRoot, chapter: 定稿相对, request, provenance: provenanceOf(sessionContext) }, plannedPackageDir => {
        let 更正后全文: string
        try {
          const src = fs.readFileSync(nodePath.join(bookRoot, 定稿相对), 'utf-8')
          const doc = parseDocument(src)
          if (!doc.ok) return { ok: false, reason: `定稿章解析失败：${doc.detail}` }
          const parent = extractVersionFields(doc.data.fields).版本
          const baseVer = parent === null ? initialVersion('吃书补偿') : bumpVersion(parent, '吃书补偿')
          const fields = applyVersionFields(
            { ...doc.data.fields, 选定: true },
            { ...baseVer, 生成模块: '吃书补偿', ...(args['提案编号'] === undefined ? {} : { 来源快照: { 补偿: String(args['提案编号']) } }) },
          )
          更正后全文 = serializeDocument(fields, 更正正文输入, 草稿字段序)
        } catch (err) {
          return failureFrom(err, `定稿章读取失败：`)
        }

        // 沉淀候选（可选）：写入补偿包目录，走 planSettlement 整条更正既有条目
        let packageDir: string | undefined
        const has候选 = 候选字段.some(f => optionalText(f) !== null)
        if (has候选) {
          const 包相对 = plannedPackageDir
          const 包绝对 = nodePath.join(bookRoot, 包相对)
          const 候选文件: Record<string, string> = {
            事实变更: '事实变更.md', 时间线变更: '时间线变更.md', 账本变更: '账本变更.md', 记忆候选: '本书层记忆候选.md',
          }
          const contents = new Map(候选字段.flatMap(f => {
            const value = optionalText(f)
            return value === null ? [] : [[候选文件[f]!, value] as const]
          }))
          // A failed pre-write attempt may have prepared this package. Reuse only exact
          // ordinary files; never overwrite an unknown or author-edited candidate.
          if (fs.existsSync(包绝对)) {
            for (const name of fs.readdirSync(包绝对)) {
              const file = nodePath.join(包绝对, name)
              const stat = fs.lstatSync(file)
              if (!contents.has(name) || !stat.isFile() || stat.isSymbolicLink() || fs.readFileSync(file, 'utf8') !== contents.get(name)) {
                return { ok: false, reason: '补偿包候选冲突，已保留，请核对后处理' }
              }
            }
          }
          fs.mkdirSync(包绝对, { recursive: true })
          for (const [name, value] of contents) {
            const file = nodePath.join(包绝对, name)
            if (!fs.existsSync(file)) fs.writeFileSync(file, value, { encoding: 'utf8', flag: 'wx' })
          }
          packageDir = 包相对
        }

        try {
          // F3:补偿事件记录与本次 retcon 同一提交(不再提交后另写)
          const event = retconEventOps(bookRoot, {
            ...(args['提案编号'] === undefined ? {} : { 提案编号: String(args['提案编号']) }),
            受影响工件: [定稿相对],
            卷: key.卷,
            账本留痕: `吃书补偿：${request.摘要}`,
            摘要: request.摘要,
          })
          const retconFiles: Array<{ 目标: string; 内容: string }> = [
            { 目标: 定稿相对, 内容: 更正后全文 },
            { 目标: event.relPath, 内容: event.content },
          ]
          // F3:章摘要随 retcon 同提交——传更正后摘要则整件更新,未传则加失效标记(不冒充已更新)
          const 摘要相对 = paths.章摘要(key.卷, key.章, key.章名)
          if (request.更正后章摘要 !== null) {
            retconFiles.push({ 目标: 摘要相对, 内容: request.更正后章摘要 })
          } else {
            try {
              const 摘要现文 = fs.readFileSync(nodePath.join(bookRoot, 摘要相对), 'utf-8')
              retconFiles.push({
                目标: 摘要相对,
                内容: `> 〔摘要过期〕定稿正文已经吃书补偿更正,本摘要待重做(关联提案 ${String(args['提案编号'] ?? '（未登记）')})

${摘要现文}`,
              })
            } catch { /* 无章摘要文件则无失效动作 */ }
          }
          return {
            bookRoot,
            ...(packageDir === undefined ? {} : { packageDir }),
            files: retconFiles,
            summary: request.摘要,
            settlement: { 章节: key, 批准: true, 裁决记录: `作者于 ${new Date().toISOString()} 批准吃书补偿（kind=${decision.kind}, 决定=${decision.决定}）` },
            provenance: provenanceOf(sessionContext),
          }
        } catch (err) {
          return failureFrom(err, `吃书补偿失败：`)
        }
        })
        if (!res.ok) return res
        return {
          ok: true,
          dests: res.dests,
          补偿事件: res.dests.find(dest => dest.includes('/补偿/')) ?? '（随 retcon: 提交留痕）',
          message: `吃书补偿完成（${res.message}）。补偿事件记录随本次 retcon: 提交留痕。受影响未定稿下游须同批整改（确认类工具「批次文件」）。`,
        }
        }, provenanceOf(sessionContext))
      },
    },
    {
      name: 'novel_record_memory',
      description: '谨慎记录长期记忆。scope=book 只记当前书，必须有 bookId；scope=author 只记明确跨书的偏好，不传 bookId。默认不写；仅保存作者明确要求记住，或已确认且以后持续有用、无法从真源恢复的结论。写前读索引和相关条目；没有新信息不写，同一事项更新原条目。操作为新增时不覆盖；更新须提供完整原文与合并后的简短正文。临时讨论、章节复述和真源已有内容不记；作者手改内容只按明确授权更新。',
      parameters: memoryParameters,
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            scope: { type: 'string', enum: ['book', 'author'], description: '实际记忆归属' },
            bookId: { type: 'string' },
            relPath: { type: 'string', description: '相对作者工作范围或本书根目录的实际路径' },
            updated: { type: 'boolean' }, changed: { type: 'boolean' }, duplicate: { type: 'boolean' },
            reason: { type: 'string' }, message: { type: 'string' }, ...DESIGN_COMMIT_FIELDS,
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: (args, sessionContext) => {
        if (validateJsonSchemaValue(memoryValidation, args).length) return toolFailure('invalid-argument', '请明确记忆范围和新增／更新操作。本书范围需 bookId，作者范围不传 bookId；更新还需完整原文。')
        const scope = args['scope'] as 'book' | 'author'
        const workspace = deps.workspaceRoot(sessionContext?.agent)
        if (workspace === undefined) return toolFailure('host-unavailable', '工作范围未就绪，无法记录记忆')
        const resolved = scope === 'book' ? resolveBook(args, sessionContext) : { ok: true as const, bookRoot: workspace }
        if (!resolved.ok) return resolved
        const root = resolved.bookRoot
        const input = {
          名称: String(args['名称']), 描述: String(args['描述']),
          类: args['类'] as '文风' | '决策' | '对话' | '灵感',
          来源: String(args['来源']), 正文: String(args['正文']),
          操作: args['操作'] as '新增' | '更新',
          ...(args['原文'] === undefined ? {} : { 原文: String(args['原文']) }),
          ...(args['标签'] === undefined ? {} : { 标签: args['标签'] as string[] }),
        }
        const directory = scope === 'book' ? '本书记忆' : '作者记忆'
        try {
          const writeRoot = scope === 'book' ? root : authorMemoryWriteRoot(root)
          return withBookWrite(writeRoot, () => {
            sessionContext?.signal?.throwIfAborted()
            const targets = [`${directory}/${input.名称.trim()}.md`, `${directory}/索引.md`]
            assertWritableTargets(writeRoot, targets)
            const result = scope === 'book'
              ? writeBookMemory(root, { ...input, 裁决记录: '对谈中已确认的记忆' })
              : writeAuthorMemory(root, input)
            if (!result.ok) return toolFailure(result.reason.includes('原文已变化') ? 'source-conflict' : 'invalid-argument', result.reason,
              '读取最新索引和条目，核对后再调用；不要改名新增来绕过冲突。')
            const value = { ...result, scope, ...(scope === 'book' ? { bookId: String(args['bookId']) } : {}) }
            if (scope === 'author' || result.duplicate) return {
              ...value, commitState: 'not-required', retryable: false,
              message: result.changed ? '作者记忆已保存。' : '已有相同结论，本次没有写入。',
            }
            const commit = commitConfirmed({ bookRoot: root, paths: [result.relPath, paths.本书记忆索引()],
              prefix: 'design', summary: `记忆：${input.名称}`, provenance: provenanceOf(sessionContext) })
            return { ...value, ...designCommitResult(commit, '本书记忆已保存', args, sessionContext) }
          }, provenanceOf(sessionContext))
        } catch (error) { return failureFrom(error, '记忆保存失败：') }
      },
    },
    {
      name: 'novel_note_pending',
      description: '写/清「待补便签」（真源工件分节内的 待补： 行——只有算不出来的才落盘）。文本缺省为空＝清除该节便签。写后随 design: 提交。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '书id（必填）' },
          relPath: { type: 'string', description: '书仓内真源工件相对路径（如 大纲/故事骨架.md）' },
          节名: { type: 'string', description: '分节/条目名（如 线索悬念伏笔）' },
          文本: { type: 'string', description: '便签内容（缺省/空＝清除该节便签）' },
          summary: { type: 'string', description: '提交摘要（可选）' },
        },
        required: ['bookId', 'relPath', '节名'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', description: '是否成功' },
            relPath: { type: 'string', description: '落便签的真源相对路径' },
            message: { type: 'string', description: '结果说明' },
            reason: { type: 'string', description: '失败原因' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: (args, sessionContext) => {
        const book = resolveBook(args, sessionContext)
        if (!book.ok) return book
        const relPath = String(args['relPath']).trim().replace(/\\/g, '/')
        const 节名 = String(args['节名']).trim()
        const 文本 = args['文本'] === undefined || String(args['文本']).trim() === '' ? null : String(args['文本']).trim()
        try {
          const r = writePending(book.bookRoot, relPath, 节名, 文本)
          if (!r.ok) return { ok: false, reason: r.reason }
          const commit = commitConfirmed({
            bookRoot: book.bookRoot,
            paths: [relPath],
            prefix: 'design',
            summary: args['summary'] !== undefined ? String(args['summary']).trim() : `待补便签·${节名}`,
            provenance: provenanceOf(sessionContext, [relPath]),
          })
          if (!commit.ok) {
            return { ok: false, reason: `便签已写入但提交失败（已落盘但未提交，重跑本工具即可补提交）：${commit.reason}` }
          }
          return { ok: true, relPath, message: 文本 === null ? `已清除「${节名}」待补便签` : `已记待补便签（${节名}）：${文本}` }
        } catch (err) {
          return failureFrom(err, `待补便签失败：`)
        }
      },
    },
    {
      name: 'novel_get_book_progress',
      description: '查书级进度卡（现算，不进 context）：设计工件状态与待补便签、上次改动章号、世界书计数、章进度、近期窗口余量、本卷未决偏离。选完书后、动设计侧节点前该查。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '书id（必填）' },
          卷: { type: 'number', description: '卷号（可选，默认当前卷）' },
        },
        required: ['bookId'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', description: '是否成功' },
            渲染: { type: 'string', description: '书级进度卡渲染文本' },
            未决偏离: { type: 'array', description: '未经作者处置的偏离项' },
            待核对: { type: 'array', description: '章级计划待核对（可选；按章号关联同章事实供核对，同章任一事件不等于内容兑现）' },
            卷: { type: 'number', description: '当前卷号' },
            规划卷: { type: 'number', description: '规划目标卷（可选；当前卷已证完成且无已确认窗口条目时给出）' },
            reason: { type: 'string', description: '失败原因' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: (args, sessionContext) => {
        const book = resolveBook(args, sessionContext)
        if (!book.ok) return book
        try {
          // 默认对账卷与选择器同一口径(任务21, B3):active 取该卷;planning 保留已完成卷并呈报规划目标;empty 默认1
          const selection = selectCurrentVolume(book.bookRoot)
          const 卷 = args['卷'] !== undefined
            ? Number(args['卷'])
            : selection.kind === 'active'
              ? selection.卷
              : selection.kind === 'planning'
                ? (selection.已完成卷 ?? selection.规划卷)
                : 1
          const detail = scanDesignDetail(book.bookRoot, 卷)
          const docPaths = [
            detail.契约.路径, detail.骨架.路径, detail.分卷.路径,
            ...detail.卷规划.flatMap((v) => [paths.卷纲(v.卷号), paths.计划时间线(v.卷号), paths.近期窗口(v.卷号)]),
          ]
          const history: Record<string, LastCommitResult> = {}
          for (const p of docPaths) {
            if (history[p] === undefined) history[p] = lastCommitOf(book.bookRoot, p)
          }
          // 本书当前决策优先；仅兼容明确标记本书的旧作者条目。
          let 未决偏离: string[] = []
          let 待核对: { 名称: string; 章号: number; 本章事实: string[] }[] = []
          let 疑似占位待核对: { 名称: string; 来源: string }[] = []
          const recon = reconcileLedger(book.bookRoot, 卷)
          if (recon.ok) {
            const 偏离 = [...recon.report.计划未兑现, ...recon.report.事实未计划].map((item) => item.名称)
            const ws = deps.workspaceRoot(sessionContext?.agent)
            const 书名 = nodePath.basename(book.bookRoot)
            const 本书条目 = listBookMemoryEntries(book.bookRoot)
            const 本书名称 = new Set(本书条目.map(entry => entry.名称))
            const 旧作者条目 = ws === undefined ? [] : listAuthorMemory(ws).filter(entry =>
              entry.适用范围 === undefined && !本书名称.has(entry.名称)
              && entry.标签.some(tag => tag === 书名 || tag === String(args['bookId'] ?? '')))
            const 处置文本 = [...本书条目, ...旧作者条目].filter(entry => entry.类 === '决策')
              .map(entry => `${entry.名称} ${entry.描述 ?? ''} ${entry.正文}`)
            未决偏离 = 偏离.filter((名) => !处置文本.some((text) => text.includes(名)))
            // 章级待核对单独计数呈报(任务21, B1):不进未决偏离;非空时不得呈报无偏离
            待核对 = recon.report.章级待核对.map((p) => ({ 名称: p.计划项.名称, 章号: p.章号, 本章事实: p.本章事实.map((f) => f.名称) }))
            疑似占位待核对 = [...(recon.report.疑似占位待核对 ?? [])]
          }
          const 渲染 = renderBookProgress(detail, history, 未决偏离, 待核对.length, 疑似占位待核对)
          return {
            ok: true,
            渲染,
            未决偏离,
            ...(待核对.length > 0 ? { 待核对 } : {}),
            ...(疑似占位待核对.length > 0 ? { 疑似占位待核对 } : {}),
            内容问题: detail.内容问题 ?? [],
            卷,
            ...(selection.kind === 'planning' ? { 规划卷: selection.规划卷 } : {}),
          }
        } catch (err) {
          return failureFrom(err, `进度卡查询失败：`)
        }
      },
    },
    {
      name: 'novel_editor_suggest',
      description: '把书房编辑器请求的结果交回编辑器，由作者决定是否采用。只用于回复以「【书房编辑器」开头的请求；必须调用本工具交回，不要直接改写文件，也不要把这次请求当作推进章节的授权。润色、扩写、精简、按要求改用 replace；续写用 insert；审读用 comments；没有可交回的修改时用 none。润色不得新增行动者、立场、动作或事实。审读只标出问题，comments 的每条 quote 必须逐字摘自请求原文。本工具不读写书仓。',
      parameters: {
        type: 'object',
        properties: {
          requestId: { type: 'string', description: '书房编辑器请求中的编号' },
          kind: { type: 'string', enum: ['replace', 'insert', 'comments', 'none'], description: 'replace 替换原文，insert 在插入点续写，comments 只标问题，none 表示无需修改' },
          text: { type: 'string', description: 'replace 或 insert 的正文' },
          comments: {
            type: 'array',
            description: '审读批注，1 到 12 条；每条 quote 必须逐字摘自请求原文',
            items: {
              type: 'object',
              properties: {
                quote: { type: 'string', description: '逐字摘自请求原文的引文' },
                note: { type: 'string', description: '这条引文的问题说明，不超过 300 字' },
              },
              required: ['quote', 'note'],
            },
          },
          note: { type: 'string', description: '给作者的一句话说明，不超过 200 字' },
        },
        required: ['requestId', 'kind'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', description: '是否已交回编辑器' },
            requestId: { type: 'string' },
            delivered: { type: 'boolean', description: '成功时为 true，表示结果已送到编辑器' },
            message: { type: 'string' },
            reason: { type: 'string', description: '未能交回的原因' },
          },
          required: ['ok'],
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: (args, sessionContext) => acceptEditorSuggestion(deps.editorRequests, sessionContext?.agent, args),
    },
  ]

  // Tool calls are the product write boundary. Keep the read-modify-write
  // portion of synchronous mutations under the same book lock that protects
  // the final atomic file replacement. Approval tools remain async and take
  // their lock in the final write services after the author decision.
  const locked = new Set([
    'novel_new_outline_draft', 'novel_prepare_pack',
    'novel_update_contract', 'novel_seed_min_design', 'novel_confirm_outline',
    'novel_update_skeleton', 'novel_update_volume_layout', 'novel_roll_window',
    'novel_confirm_worldbook_entry', 'novel_confirm_volume_outline',
    'novel_assemble_materials', 'novel_apply_revision', 'novel_apply_revision_batch',
    'novel_import_draft', 'novel_record_review_findings', 'novel_record_proposal',
    'novel_resolve_proposal', 'novel_note_pending',
  ])
  const nativeTools = NATIVE_DESIGN_TOOLS
  const registered = deps.testTools === true ? tools : tools.filter((tool) => !NOVEL_TEST_TOOL_NAMES.includes(tool.name))
  const guarded = registered.map((tool) => {
    if (!locked.has(tool.name)) return tool
    return {
      ...tool,
      execute: (args: Record<string, unknown>, sessionContext?: ToolExecContext) => {
        const bookId = args['bookId'] === undefined ? '' : String(args['bookId']).trim()
        const root = bookId === '' ? undefined : deps.bookRootOfBookId(bookId, sessionContext?.agent)
        if (root === undefined) return tool.execute(args, sessionContext)
        try {
          if (nativeTools.has(tool.name)) {
            return withBookWriteAsync(root, async () => tool.execute(args, sessionContext), provenanceOf(sessionContext))
              .catch((error: unknown) => failureFrom(error))
          }
          return withBookWrite(root, () => tool.execute(args, sessionContext), provenanceOf(sessionContext))
        } catch (error) {
          return failureFrom(error)
        }
      },
    }
  })
  // Every failure carries code and next so the main Agent can choose its next step.
  // Results also leave without undefined-valued keys, which the host rejects as non-lossless JSON.
  const finish = (result: unknown) => omitUndefinedFields(normalizeFailure(result))
  return guarded.map((tool) => ({
    ...tool,
    output: withFailureFields(tool.output),
    execute: (args: Record<string, unknown>, sessionContext?: ToolExecContext) => {
      const failed = (error: unknown) => {
        const result = expectedFailure(error)
        if (result !== undefined) return result
        throw error // Unexpected host failures retain isError/cancellation semantics.
      }
      try {
        const result = tool.execute(args, sessionContext)
        if (result !== null && typeof result === 'object' && typeof (result as PromiseLike<unknown>).then === 'function') {
          return Promise.resolve(result).then(finish, failed)
        }
        return finish(result)
      } catch (error) { return failed(error) }
    },
  }))
}

type InspectionUnavailable = { readonly 状态: '未检查' | '部分失败'; readonly 原因: string }
type OpeningUnavailable = { readonly 状态: '无法核实'; readonly 原因: string }

function cancelledInspection() {
  return toolFailure('author-cancelled', '本次检查已取消，未继续读取书仓。', '若仍需检查，请重新发起本次请求。')
}

function readStoryStatusSafely(root: string) {
  try { return { ok: true as const, ...readStoryStatus(root) } } catch (error) { return failureFrom(error, '推导状态失败：') }
}

function readOpeningInspection(root: string): ChapterOpeningInspection | OpeningUnavailable {
  try { return inspectChapterOpening(root) } catch (error) { return { 状态: '无法核实', 原因: failureFrom(error, '开章核对失败：').reason } }
}

function readBookInspection(root: string): BookInspection | InspectionUnavailable {
  try { return inspectBookDocuments(root) } catch (error) { return { 状态: '部分失败', 原因: failureFrom(error, '书仓检查失败：').reason } }
}

function inspectionNotes(result: BookInspection | InspectionUnavailable): string[] {
  if ('原因' in result) return [result.原因]
  return [...new Set([
    ...result.问题.map(issue => issue.说明),
    ...result.未检范围.map(item => `${item.路径}：${item.原因}`),
    ...(result.结论 === '未发现已知问题' && result.状态 === '已检查' && result.快照.稳定 ? [] : [result.结论]),
  ])]
}

function withFailureFields(output: ToolOutputDefinition): ToolOutputDefinition {
  const schema = (output as { schema?: { properties?: Record<string, unknown> } }).schema
  if (schema?.properties === undefined) return output
  return { ...output, schema: { ...schema, properties: { ...schema.properties, ...FAILURE_FIELDS } } } as ToolOutputDefinition
}

/** 重置轮次暂存的上一轮处置:明示条数与沿用规则,免得调用方以为上一轮结论凭空消失。 */
function inheritNote(n: number): string {
  return n === 0 ? '' : `上一轮已给处置 ${n} 条暂存待继承：对应模块重新回写时，模块名、证据位置、问题说明一致的发现项沿用原处置，其余作废。`
}

/** 设计侧确认工具的公共收尾:整批一次 design: 提交(拍板 7),失败返回「已落盘但未提交」。 */
function finishDesignCommit(
  bookRoot: string,
  writtenPaths: readonly string[],
  args: Record<string, unknown>,
  defaultSummary: string,
  chapterScope: number | null,
  sessionContext?: ToolExecContext,
): DesignCommitResult {
  const batch = Array.isArray(args['批次文件']) ? (args['批次文件'] as unknown[]).map((v) => String(v).trim()).filter((v) => v !== '') : []
  const commit = commitConfirmed({
    bookRoot,
    paths: [...writtenPaths, ...batch],
    prefix: 'design',
    summary: args['summary'] !== undefined ? String(args['summary']).trim() : defaultSummary,
    ...(chapterScope === null ? {} : { chapterScope }),
    provenance: provenanceOf(sessionContext, [...writtenPaths, ...batch]),
  })
  return designCommitResult(commit, defaultSummary, args, sessionContext)
}
