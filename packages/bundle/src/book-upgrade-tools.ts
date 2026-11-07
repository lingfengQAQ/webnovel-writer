import fs from 'node:fs'
import path from 'node:path'
import { validateJsonSchemaValue, type JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import {
  askAuthor, applyBookUpgrade, previewBookUpgrade, previewBookUpgradeResume, resumeBookUpgrade,
  type BookUpgradePreview, type BookUpgradeResult, type BookUpgradeResumePreview, type OperationProvenance,
} from '@webnovel/core'
import type { NovelToolDefinition, NovelToolsDeps, ToolExecContext } from './novel-tools'
import { failureFrom, toolFailure } from './tool-failure'
import {
  BOOK_UPGRADE_APPLY_PARAMETERS, BOOK_UPGRADE_PREVIEW_OUTPUT, BOOK_UPGRADE_PREVIEW_PARAMETERS,
  BOOK_UPGRADE_RESUME_PARAMETERS, BOOK_UPGRADE_WRITE_OUTPUT,
} from './book-upgrade-output'

const marker = { maintenance: 'book-upgrade' as const }
const cancelled = () => ({ ...marker, ...toolFailure('author-cancelled', '书仓升级请求已取消，本次不继续写入。') })
const identity = (root: string): string => {
  const real = fs.realpathSync.native(root)
  return process.platform === 'win32' ? path.resolve(real).toLowerCase() : path.resolve(real)
}

function provenance(exec: ToolExecContext | undefined): OperationProvenance | undefined {
  if (exec === undefined) return undefined
  return {
    ...(exec.callId === undefined ? {} : { operationId: `tool-${exec.callId}`, callId: exec.callId }),
    ...(exec.name === undefined ? {} : { toolName: exec.name }),
    ...(exec.agent?.id === undefined ? {} : { agentId: exec.agent.id }),
    ...(exec.agent?.session?.header?.id === undefined ? {} : { sessionId: exec.agent.session.header.id }),
  }
}

function previewMessage(preview: BookUpgradePreview): string {
  if (preview.state === 'ready') return '整仓升级预览已生成。请核对全部文件差异和受影响工件，再请求执行；预览没有写入书仓。'
  if (preview.state === 'unchanged') return '当前受支持范围无须升级，没有写入文件或产生新提交。'
  return '当前整仓条件不满足，不能执行局部修复。请先核对阻断项；本次没有写入。'
}

function reviewJson(value: unknown): string {
  const json = JSON.stringify(value, null, 2)
  const longest = (json.match(/`+/g) ?? []).reduce((length, run) => Math.max(length, run.length), 2)
  const fence = '`'.repeat(longest + 1)
  return `${fence}json\n${json}\n${fence}`
}

function approvalDetail(preview: BookUpgradePreview): string {
  // JSON retains exact author strings; a longer fence cannot be closed by those strings.
  return reviewJson({
    计划指纹: preview.fingerprint, 基线提交: preview.baseHead, 规则版本: preview.ruleVersion,
    文件差异: preview.changes.map(change => ({ 路径: change.relPath, 原文: change.before, 目标: change.after, 规则: change.rules, 证据: change.evidence })),
    保留未完工件: preview.activeWork ?? [],
    执行条件: '请暂停写作及自动任务。本次只升级格式，保留草稿和旧审核证据，不表示章节已收尾。草稿原文与目标保存在本地维护收据，Git仅记录真源和收据校验值',
    受影响工件: preview.effects,
  })
}

function resumeDetail(preview: BookUpgradeResumePreview): string {
  const restore = preview.state === 'interrupted'
  return reviewJson({
    操作编号: preview.operationId, 本次核对指纹: preview.fingerprint,
    本次动作: restore ? '恢复原中断文件批次' : '核对已落盘批次，补办尚未完成的清理或提交',
    完成后: restore
      ? '只将已核实的中断批次恢复到变换前状态，不继续转换。仍需升级时，必须重新预览并请求新的作者批准。'
      : '只核对并提交原收据中的文件，不重新转换。已有完整提交证据时不新增提交。',
    当前核对: preview.reason, 路径: preview.paths,
    输出证据: preview.outputs?.map(output => ({ 路径: output.relPath, 变换前SHA256: output.before, 目标SHA256: output.sha256, 目标Git对象: output.gitBlob })),
    本地草稿备份: preview.drafts ?? [],
    受影响工件: preview.effects ?? [],
  })
}

function writeResult(bookId: string, result: BookUpgradeResult) {
  const messages: Record<BookUpgradeResult['state'], string> = {
    committed: '本次整仓升级已提交，文件与格式标记已按同批结果核对。',
    'already-committed': '已核实原升级提交，本次没有重复变换或新增提交。',
    'written-pending-commit': '升级文件已写入，版本提交尚未完成。请保留现场，按原操作编号续办。',
    recovered: '原升级的中断批次已恢复。请重新预览书仓，再决定是否执行升级。',
    blocked: '本次书仓升级没有完成，请先核对原因。',
  }
  return {
    ...marker, bookId, ...result, message: messages[result.state],
    ...(!result.ok ? { reason: result.reason ?? messages[result.state], next: result.state === 'written-pending-commit'
      ? '处理提交失败原因后，使用原 operationId 调用 novel_resume_book_upgrade；不要重新转换文件。'
      : '保留原文件和维护证据，先核对原因。需要新计划时重新调用 novel_preview_book_upgrade。' } : {}),
  }
}

/** Author questions stay outside the write lock; core rechecks identity and the exact plan inside it. */
export function createBookUpgradeTools(deps: NovelToolsDeps): NovelToolDefinition[] {
  const resolve = (args: Record<string, unknown>, schema: JsonSchemaNode, exec?: ToolExecContext) => {
    if (exec?.signal?.aborted) return cancelled()
    if (validateJsonSchemaValue(schema, args).length || typeof args.bookId !== 'string' || !args.bookId.trim()
      || ['fingerprint', 'operationId'].some(key => Object.hasOwn(args, key) && (typeof args[key] !== 'string' || !/^[a-f0-9]{64}$/.test(args[key])))) {
      return { ...marker, ...toolFailure('invalid-argument', '升级工具只接受书id与所列指纹或操作编号，不接受路径、内容、批准标志或局部修复参数。') }
    }
    const bookId = args.bookId.trim()
    try {
      const root = deps.bookRootOfBookId(bookId, exec?.agent)
      if (root === undefined) return { ...marker, ...toolFailure('book-not-found', '书id不存在或不唯一，请先核对当前工作范围。') }
      const physicalRoot = identity(root)
      return { ok: true as const, bookId, root, validateIdentity: () => {
        const current = deps.bookRootOfBookId(bookId, exec?.agent)
        return current !== undefined && identity(current) === physicalRoot
      } }
    } catch (error) { return { ...marker, ...failureFrom(error, '书仓身份无法核实：') } }
  }
  const checkIdentity = (book: { validateIdentity: () => boolean }): boolean => {
    try { return book.validateIdentity() } catch { return false }
  }
  const stale = () => ({ ...marker, ...toolFailure('approval-stale', '书id归属或升级计划已变化，旧批准不可使用。', '重新核对书目与整仓升级预览，再呈报作者。') })

  return [
    {
      name: 'novel_preview_book_upgrade',
      description: '只读预览指定书仓的整仓格式升级，列出精确文件差异、来源证据、受影响工件和阻断项。只有整仓可升级、Git干净且没有写入锁或待处理事务时才返回可执行指纹。已核验的未完工件保留并列在activeWork，执行前须暂停写作。不执行局部修复，不写文件或恢复事务。',
      parameters: BOOK_UPGRADE_PREVIEW_PARAMETERS, output: BOOK_UPGRADE_PREVIEW_OUTPUT,
      execute: (args, exec) => {
        const book = resolve(args, BOOK_UPGRADE_PREVIEW_PARAMETERS, exec)
        if (!book.ok) return book
        const preview = previewBookUpgrade(book.root)
        if (exec?.signal?.aborted) return cancelled()
        if (!checkIdentity(book) || (preview.bookId !== undefined && preview.bookId !== book.bookId)) return stale()
        return { ...marker, ...preview, message: previewMessage(preview) }
      },
    },
    {
      name: 'novel_apply_book_upgrade',
      description: '执行刚预览的整仓升级。传入预览原始fingerprint；工具重新核对整仓并向作者呈报这份精确差异，只有本次批准有效且锁内证据未变化才写入和提交。未批准、过期计划或部分可修均不写入。提交失败保留operationId并改走续办。',
      parameters: BOOK_UPGRADE_APPLY_PARAMETERS, output: BOOK_UPGRADE_WRITE_OUTPUT,
      execute: async (args, exec) => {
        const book = resolve(args, BOOK_UPGRADE_APPLY_PARAMETERS, exec)
        if (!book.ok) return book
        const preview = previewBookUpgrade(book.root)
        if (exec?.signal?.aborted) return cancelled()
        if (!checkIdentity(book) || preview.bookId !== book.bookId) return stale()
        if (preview.state !== 'ready') return { ...marker, ...toolFailure('source-conflict', previewMessage(preview), '调用 novel_preview_book_upgrade 核对完整阻断项，不执行局部修复。'), state: 'blocked', bookId: book.bookId, issues: preview.issues }
        if (preview.fingerprint !== args.fingerprint) return stale()
        if (!deps.askFn) return { ...marker, ...toolFailure('host-unavailable', '作者裁决通道不可用，本次没有写入。') }
        const decision = await askAuthor(deps.askFn, '书仓升级', { 范围: `书id：${book.bookId}`, 摘要: approvalDetail(preview) }, { agent: exec?.agent, signal: exec?.signal })
        if (exec?.signal?.aborted) return cancelled()
        if (!decision.ok || decision.决定 !== '已批准') return { ...marker, ...toolFailure('author-declined', decision.ok ? '作者退回本次书仓升级，未执行变换。' : decision.reason) }
        if (!checkIdentity(book)) return stale()
        return writeResult(book.bookId, applyBookUpgrade(book.root, { bookId: book.bookId, fingerprint: preview.fingerprint!, signal: exec?.signal, provenance: provenance(exec), validateIdentity: book.validateIdentity }))
      },
    },
    {
      name: 'novel_resume_book_upgrade',
      description: '按原operationId核对并续办书仓升级：中断批次按原事务恢复，已写待提交只补原提交，已有可信提交则返回核对结果。实际续办先向作者呈报精确收据并等待批准；损坏、冲突或作者后来改动不覆盖。不用于主动撤销或重新转换。',
      parameters: BOOK_UPGRADE_RESUME_PARAMETERS, output: BOOK_UPGRADE_WRITE_OUTPUT,
      execute: async (args, exec) => {
        const book = resolve(args, BOOK_UPGRADE_RESUME_PARAMETERS, exec)
        if (!book.ok) return book
        const operationId = args.operationId as string
        const preview = previewBookUpgradeResume(book.root, operationId)
        if (exec?.signal?.aborted) return cancelled()
        if (!checkIdentity(book) || (preview.bookId !== undefined && preview.bookId !== book.bookId)) return stale()
        if (!preview.ok || !preview.fingerprint || preview.state === 'blocked') return { ...marker, ...toolFailure('source-conflict', preview.reason ?? '无法核实这次维护操作，未续办。', '保留维护收据、事务和当前文件，先核对冲突或缺失证据。'), state: 'blocked', operationId, paths: preview.paths }
        if (preview.state === 'committed') return writeResult(book.bookId, { ok: true, state: 'already-committed', operationId, commit: preview.commit, paths: preview.paths, effects: preview.effects })
        if (!deps.askFn) return { ...marker, ...toolFailure('host-unavailable', '作者裁决通道不可用，本次没有续办。') }
        const decision = await askAuthor(deps.askFn, '书仓升级续办', { 范围: `书id：${book.bookId}`, 摘要: resumeDetail(preview) }, { agent: exec?.agent, signal: exec?.signal })
        if (exec?.signal?.aborted) return cancelled()
        if (!decision.ok || decision.决定 !== '已批准') return { ...marker, ...toolFailure('author-declined', decision.ok ? '作者退回本次书仓升级续办，未继续写入。' : decision.reason) }
        if (!checkIdentity(book)) return stale()
        return writeResult(book.bookId, resumeBookUpgrade(book.root, { bookId: book.bookId, operationId, fingerprint: preview.fingerprint, signal: exec?.signal, provenance: provenance(exec), validateIdentity: book.validateIdentity }))
      },
    },
  ]
}
