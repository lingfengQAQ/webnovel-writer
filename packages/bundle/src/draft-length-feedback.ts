import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import {
  canonicalizePath, draftLengthFeedback, draftLengthTarget, extractToolPath, isFullyQualifiedPath,
  isMutatingFileTool, readChapterLength, resolveInsideBook,
} from '@webnovel/core'
import { scanBooks } from './bookshelf'
import { DRAFT_LENGTH_SOURCE } from './message-sources'

interface FeedbackHost {
  on?: (event: string, listener: (...args: never[]) => unknown) => unknown
}

interface FeedbackDeps {
  readonly agent: { readonly id: string }
  readonly workspaceRoot: () => string | undefined
  readonly warn: (message: string) => void
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Attach to the actual caller; no cache, new turn, or mutation of native results. */
export function attachDraftLengthFeedbackToAgent(host: FeedbackHost, deps: FeedbackDeps): (() => void) | undefined {
  if (typeof host.on !== 'function') return undefined
  const listener = async (
    exec: ToolExecution,
    result: Readonly<ToolExecutionResult>,
    next: () => Promise<PostToolDecision>,
  ): Promise<PostToolDecision> => {
    const decision = await next()
    if (exec.agent !== deps.agent || result.isError || decision.kind !== 'accept' || exec.signal.aborted) return decision
    const args = record(exec.arguments)
    if (!args || !isMutatingFileTool({ name: exec.name, arguments: args })) return decision
    try {
      const value = record(result.value)
      const savedPath = typeof value?.['path'] === 'string' ? value['path'] : extractToolPath({ name: exec.name, arguments: args })
      const workspace = deps.workspaceRoot()
      if (!workspace || !savedPath || !isFullyQualifiedPath(savedPath)) return decision
      const requestedPath = extractToolPath({ name: exec.name, arguments: args })
      if (requestedPath && isFullyQualifiedPath(requestedPath)
        && canonicalizePath(requestedPath) !== canonicalizePath(savedPath)) return decision
      const matches = scanBooks(workspace).flatMap(book => {
        const resolved = resolveInsideBook(book.root, savedPath)
        const target = resolved.ok ? draftLengthTarget(resolved.relPath) : undefined
        return target ? [{ book, target }] : []
      })
      if (matches.length !== 1) return decision
      const { book, target } = matches[0]!
      const text = typeof value?.['after'] === 'string' ? value['after'] : undefined
      const feedback = draftLengthFeedback(target, text, readChapterLength(book.root))
      const message = createUserMessage({
        source: { kind: DRAFT_LENGTH_SOURCE },
        content: [{ type: 'text', text: `【草稿字数快照】\n${JSON.stringify({ 书id: book.bookId, ...feedback })}\n仅对应本次保存文本，不代表完整稿或审读通过；后续修改后需重新核验。身份检查只核对格式与目录，不证明章号来源；有身份问题须交回主控核对。` }],
      })
      return { ...decision, additionalContexts: [...decision.additionalContexts ?? [], message] }
    } catch {
      // Observation must never turn a successful native write into an error.
      try { deps.warn('[webnovel-bundle] 草稿字数反馈未生成，本次字数未核验。') } catch { /* Preserve the native outcome even when logging fails. */ }
      return decision
    }
  }
  const off = host.on('tools/post-execute', listener as never)
  return () => { if (typeof off === 'function') off() }
}
