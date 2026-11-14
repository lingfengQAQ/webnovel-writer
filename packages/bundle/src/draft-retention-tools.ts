import fs from 'node:fs'
import path from 'node:path'
import { validateJsonSchemaValue, type JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import {
  askAuthor, previewDraftRetention, confirmDraftRetention, parseDraftRetention, verifyDraftRetention,
  assertDraftRetentionBinding, inspectPendingSettlementRetention, authorDocumentPath, parseMachineJson, MACHINE_SCHEMA_VERSION, paths, validateSegment,
  type ChapterKey, type DraftRetentionManifest, type DraftRetentionPreview, type DraftRetentionResult, type OperationProvenance,
} from '@webnovel/core'
import type { NovelToolDefinition, NovelToolsDeps, ToolExecContext } from './novel-tools'
import { failureFrom, toolFailure } from './tool-failure'
import { DRAFT_RETENTION_PREVIEW_PARAMETERS, DRAFT_RETENTION_CONFIRM_PARAMETERS, DRAFT_RETENTION_PREVIEW_OUTPUT, DRAFT_RETENTION_CONFIRM_OUTPUT } from './draft-retention-output'

const marker = { maintenance: 'draft-retention' as const }
const cancelled = () => ({ ...marker, ...toolFailure('author-cancelled', '本次草稿留档确认已取消，没有继续写入。') })
const stale = () => ({ ...marker, ...toolFailure('approval-stale', '章节归属或留档预览已变化，原指纹不可用于本次确认。', '重新调用 novel_preview_draft_retention 核对当前证据，再呈报作者。') })
const physicalIdentity = (root: string): string => {
  const real = fs.realpathSync.native(root), stat = fs.lstatSync(root)
  return `${process.platform === 'win32' ? path.resolve(real).toLowerCase() : path.resolve(real)}:${stat.dev}:${stat.ino}`
}

/** A fence longer than any author text preserves the exact review data. */
export function retentionReviewJson(value: unknown): string {
  const json = JSON.stringify(value, null, 2)
  const fence = '`'.repeat((json.match(/`+/g) ?? []).reduce((length, run) => Math.max(length, run.length), 2) + 1)
  return `${fence}json\n${json}\n${fence}`
}

/** The public settlement entrypoint requires a prepared, bound inventory for an identified book. */
export function preparedDraftRetention(root: string, bookId: string, chapter: ChapterKey): { ok: true; manifest: DraftRetentionManifest } | ReturnType<typeof toolFailure> {
  try {
    const directory = paths.待定稿包目录(chapter.卷, chapter.章名)
    const read = (relative: string): string => {
      const target = authorDocumentPath(root, relative), stat = fs.lstatSync(target)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('待定稿包须为独立普通文件')
      return fs.readFileSync(target, 'utf8')
    }
    const parsed = parseMachineJson(read(`${directory}/清单.json`), MACHINE_SCHEMA_VERSION)
    if (!parsed.ok || !Object.hasOwn(parsed.data, '草稿留档')) throw new Error('待定稿包缺少受支持的草稿留档清单')
    const manifest = parseDraftRetention(parsed.data['草稿留档'])
    if (manifest.bookId !== bookId || manifest.chapter.卷 !== chapter.卷 || manifest.chapter.章 !== chapter.章 || manifest.chapter.章名 !== chapter.章名) throw new Error('待定稿包的留档清单与本次书和章节不一致')
    assertDraftRetentionBinding(read(`${directory}/正文.md`), manifest)
    const verified = verifyDraftRetention(root, manifest)
    if (!verified.ok) {
      try {
        const recovery = inspectPendingSettlementRetention(root, chapter)
        if (recovery !== undefined) return toolFailure('source-conflict', recovery.reason, recovery.next)
      } catch (error) {
        return toolFailure('source-conflict', `原定稿收据或输出无法核实：${error instanceof Error ? error.message : String(error)}`,
          '保留原待定稿包、输出和收据，将冲突呈报作者；不要重新准备、手改清单或直接补交。')
      }
      throw new Error(verified.issues.map(issue => `${issue.路径}：${issue.说明}`).join('；'))
    }
    return { ok: true, manifest }
  } catch (error) {
    return toolFailure('source-conflict', `定稿前无法核实草稿留档：${error instanceof Error ? error.message : String(error)}`, '核对来源稿和目录后调用 novel_prepare_pack 重新准备，再完整呈报作者；不要手改清单或摘要。')
  }
}

function provenance(exec?: ToolExecContext): OperationProvenance | undefined {
  return exec === undefined ? undefined : {
    ...(exec.callId === undefined ? {} : { operationId: `tool-${exec.callId}`, callId: exec.callId }),
    ...(exec.name === undefined ? {} : { toolName: exec.name }),
    ...(exec.agent?.id === undefined ? {} : { agentId: exec.agent.id }),
    ...(exec.agent?.session?.header?.id === undefined ? {} : { sessionId: exec.agent.session.header.id }),
  }
}

function previewMessage(preview: DraftRetentionPreview): string {
  if (preview.state === 'unchanged') return '本章已有可核实的留档证据，本次没有写入或新增提交。'
  if (preview.state === 'blocked') return '当前证据不足以确认本章草稿留档，请先核对具体问题。'
  return preview.action === 'resume'
    ? '原留档确认已写入但尚未完成提交。已核对原清单，续办只处理这一批文件。'
    : '本章当前留档清单与拟增元数据已列出。确认表示作者现在认定这些工件仅作历史留档。'
}

function approvalDetail(preview: DraftRetentionPreview): string {
  return retentionReviewJson({
    本次动作: preview.action === 'resume' ? '续办原草稿留档确认，只补原提交，不扩大清单' : '明确确认当前这些工件仅作本章历史留档',
    计划指纹: preview.fingerprint, 操作编号: preview.operationId, 基线提交: preview.baseHead,
    章节: preview.chapter, 来源稿: preview.manifest?.sourceDraft, 留档清单: preview.manifest,
    文件差异: preview.change, 提示: preview.notices,
    确认范围: '这是对当前清单的明确确认，不补造过去的作者批准。定稿正文保留，确认后新增或修改的稿件仍需核对。请暂停对本章的写入，直至本次完成。',
  })
}

function writeResult(bookId: string, chapter: ChapterKey, result: DraftRetentionResult) {
  const messages: Record<DraftRetentionResult['state'], string> = {
    committed: '本章草稿留档确认已提交，原清单和定稿元数据已按同批结果核对。',
    'already-committed': '已核实本章原留档提交，本次没有重复写入或新增提交。',
    'written-pending-commit': '草稿留档确认已写入，提交尚未完成。请保留原证据并重新预览本章续办。',
    blocked: '本次草稿留档确认没有完成，请先核对原因。',
  }
  return { ...marker, bookId, chapter, ...result, message: messages[result.state],
    ...(!result.ok ? { reason: result.reason ?? messages[result.state], next: result.state === 'written-pending-commit'
      ? '处理提交失败原因后，重新调用 novel_preview_draft_retention；按返回的新指纹调用 novel_confirm_draft_retention 续办原操作，不重新准备或扩大留档清单。'
      : '保留原文件与收据，核对原因后重新调用 novel_preview_draft_retention。' } : {}),
  }
}

/** No write lock spans an author question. Core verifies the approved preview under its lock. */
export function createDraftRetentionTools(deps: NovelToolsDeps): NovelToolDefinition[] {
  const resolve = (args: Record<string, unknown>, schema: JsonSchemaNode, exec?: ToolExecContext) => {
    if (exec?.signal?.aborted) return cancelled()
    if (validateJsonSchemaValue(schema, args).length || typeof args.bookId !== 'string' || !args.bookId.trim()
      || !Number.isSafeInteger(args['卷']) || !Number.isSafeInteger(args['章']) || Number(args['卷']) < 1 || Number(args['章']) < 1
      || typeof args['章名'] !== 'string' || validateSegment(args['章名']).length
      || (Object.hasOwn(args, 'fingerprint') && (typeof args.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(args.fingerprint)))) {
      return { ...marker, ...toolFailure('invalid-argument', '留档工具只接受书id、明确章节及确认时的预览指纹，不接受路径、内容、清单或批准标志。') }
    }
    const bookId = args.bookId.trim(), chapter = { 卷: args['卷'] as number, 章: args['章'] as number, 章名: args['章名'] }
    try {
      const root = deps.bookRootOfBookId(bookId, exec?.agent)
      if (root === undefined) return { ...marker, ...toolFailure('book-not-found', '书id不存在或不唯一，请先核对当前工作范围。') }
      const before = physicalIdentity(root)
      return { ok: true as const, bookId, chapter, root, validateIdentity: () => {
        const current = deps.bookRootOfBookId(bookId, exec?.agent)
        return current !== undefined && physicalIdentity(current) === before
      } }
    } catch (error) { return { ...marker, ...failureFrom(error, '书仓身份无法核实：') } }
  }
  const sameBook = (book: { validateIdentity: () => boolean }, preview: DraftRetentionPreview, bookId: string): boolean => {
    try { return book.validateIdentity() && (preview.bookId === undefined || preview.bookId === bookId) } catch { return false }
  }
  return [
    {
      name: 'novel_preview_draft_retention',
      description: '只读核对已有定稿章的草稿留档，列出当前来源稿、完整工件清单和拟增定稿元数据。旧章缺少留档证据时返回当前确认计划；原确认已写未交时返回精确续办计划。预览不写文件，不确认过去的批准。',
      parameters: DRAFT_RETENTION_PREVIEW_PARAMETERS, output: DRAFT_RETENTION_PREVIEW_OUTPUT,
      execute: (args, exec) => {
        const book = resolve(args, DRAFT_RETENTION_PREVIEW_PARAMETERS, exec)
        if (!book.ok) return book
        const preview = previewDraftRetention(book.root, book.chapter)
        if (exec?.signal?.aborted) return cancelled()
        if (!sameBook(book, preview, book.bookId)) return stale()
        return { ...marker, ...preview, message: previewMessage(preview), ...(!preview.ok ? {
          reason: preview.issues.map(issue => `${issue.路径}：${issue.说明}`).join('；') || previewMessage(preview),
          code: 'source-conflict', next: '保留本章文件与原收据，核对问题和来源证据；不要手写留档清单来绕过检查。',
        } : {}) }
      },
    },
    {
      name: 'novel_confirm_draft_retention',
      description: '按本章预览的原始fingerprint请求作者明确确认当前留档清单。工具复验并呈报原文差异，批准后在锁内核对同一证据，再写入定稿元数据与留档收据并提交。续办只补原操作；已有可信证据则只读返回，不重新封存后来出现或变化的稿件。',
      parameters: DRAFT_RETENTION_CONFIRM_PARAMETERS, output: DRAFT_RETENTION_CONFIRM_OUTPUT,
      execute: async (args, exec) => {
        const book = resolve(args, DRAFT_RETENTION_CONFIRM_PARAMETERS, exec)
        if (!book.ok) return book
        const fingerprint = args.fingerprint as string
        const preview = previewDraftRetention(book.root, book.chapter)
        if (exec?.signal?.aborted) return cancelled()
        if (!sameBook(book, preview, book.bookId) || preview.bookId !== book.bookId) return stale()
        if (preview.state === 'unchanged' && preview.ok) return writeResult(book.bookId, book.chapter, {
          ok: true, state: 'already-committed', operationId: preview.operationId, commit: preview.commit, notices: preview.notices,
        })
        if (!preview.ok || preview.state !== 'ready') return { ...marker, bookId: book.bookId, chapter: book.chapter, state: 'blocked', issues: preview.issues, notices: preview.notices,
          ...toolFailure('source-conflict', previewMessage(preview), '重新调用 novel_preview_draft_retention 核对具体问题；不执行部分留档确认。') }
        if (!preview.fingerprint || preview.fingerprint !== fingerprint || !preview.manifest || !preview.action) return stale()
        if (!deps.askFn) return { ...marker, ...toolFailure('host-unavailable', '作者裁决通道不可用，本次没有确认留档。') }
        const decision = await askAuthor(deps.askFn, '草稿留档确认', { 范围: `书id：${book.bookId}`, 摘要: approvalDetail(preview) }, { agent: exec?.agent, signal: exec?.signal })
        if (exec?.signal?.aborted) return cancelled()
        if (!decision.ok || decision.决定 !== '已批准') return { ...marker, ...toolFailure('author-declined', decision.ok ? '作者退回本次草稿留档确认，没有继续写入。' : decision.reason) }
        if (!sameBook(book, preview, book.bookId)) return stale()
        return writeResult(book.bookId, book.chapter, confirmDraftRetention(book.root, {
          bookId: book.bookId, chapter: book.chapter, fingerprint, signal: exec?.signal, provenance: provenance(exec), validateIdentity: book.validateIdentity,
        }))
      },
    },
  ]
}
