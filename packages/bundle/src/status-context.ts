/**
 * 机会性读取 systemPrompt 服务（B6 纪律）：未声明 inject 的 ctx 上属性访问会抛
 * 「cannot get property without inject」——统一走 ctx.get，属性读只作无 get 面
 * 时的降级。（dsh 运行时对齐批：scope ctx 比宿主 agent ctx 更严格，暴露了此题。）
 */
function sysPromptOf(ctx: Context): SystemPromptLike | undefined {
  const get = (ctx as unknown as { get?: (n: string) => unknown }).get
  if (typeof get === 'function') {
    try { return get.call(ctx, 'systemPrompt') as SystemPromptLike | undefined } catch { return undefined }
  }
  return (ctx as unknown as { systemPrompt?: SystemPromptLike }).systemPrompt
}

/** 书架事实随请求现算；选书与近况由普通工具回复进入宿主对话。 */
import { type Context } from '@deepseek-ai/cordis'
import { scanBooks, type BookOverview } from './bookshelf'
import { activeChapterLine, readAuthorMemoryCatalog, readBookMemoryCatalog, renderMemoryCatalog } from '@webnovel/core'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { MEMORY_CATALOG_SOURCE, isMemoryCatalogSource } from './message-sources'
export { MEMORY_CATALOG_SOURCE } from './message-sources'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { SessionSeq } from '@deepseek-ai/dsh-session'

/** 渲染工作区总览：书列表 + 新建入口；已有对话沿用作者选择。 */
export function renderOverview(
  workspaceRoot: string,
  bookIdOf: (book: BookOverview) => string | undefined = (b) => b.bookId,
): string {
  const books = scanBooks(workspaceRoot)
  const lines: string[] = ['【工作区总览】', '']
  if (books.length === 0) {
    lines.push('目前还没有书。')
    lines.push('- 新建一本书：先告诉我你的构想，我会陪你梳理作品构想。', '')
  } else {
    lines.push('书架里的书：')
    for (const book of books) {
      const id = bookIdOf(book) ?? '（无书id）'
      lines.push(`- 《${book.name}》（书id：${id}）——继续写这本书`)
    }
    lines.push('', '- 新建一本书：告诉我你的构想，我会陪你梳理作品构想。', '')
  }
  lines.push('沿用作者在本对话中指定的书；尚未明确书目时再询问。工具调用携带书id，继续写作前从书仓核对近况。')
  return lines.join('\n')
}

/** 渲染当前书+近况(已选书时):「现在写哪本」+ 该书进度。 */
export function renderCurrentBook(bookName: string, bookId: string, overviewLine: string): string {
  return [
    `【当前书】现在写的是《${bookName}》（书id：${bookId}）。`,
    overviewLine,
  ].join('\n')
}

/** 选书结果附带的本书记忆目录（选书时快照；只作定位，正文不进）。 */
export function bookMemoryCatalogText(bookRoot: string): string {
  try {
    return renderMemoryCatalog(readBookMemoryCatalog(bookRoot), '选书时')
  } catch (error) {
    return `【本书记忆目录】读取错误：${error instanceof Error ? error.message : String(error)}`
  }
}

/** 作者记忆目录的初始快照文字（会话开始时）。 */
export function authorMemoryCatalogText(workspaceRoot: string): string {
  try {
    return renderMemoryCatalog(readAuthorMemoryCatalog(workspaceRoot), '会话开始时')
  } catch (error) {
    return `【作者记忆目录】读取错误：${error instanceof Error ? error.message : String(error)}`
  }
}

/** 从书仓读取当前章节的一行近况，不依赖聊天记录。 */
export function progressLineOf(bookRoot: string): string {
  try {
    const result = activeChapterLine(bookRoot)
    return result.ok ? result.行 : `近况推导异常：${result.reason}`
  } catch (error) {
    return `近况推导异常：${error instanceof Error ? error.message : String(error)}`
  }
}

/** dsh `systemPrompt` 服务的窄声明(仅本插件消费面;防锁 dsh 全量类型)。 */
export interface SystemPromptLike {
  context(context: {
    readonly name: string
    readonly order: number
    readonly text: string | (() => string)
  }): () => void
}

/** Only our own delivery is inspected; this never derives or stores a current book. */
function catalogWasDelivered(agent: Agent): boolean {
  for (let seq = agent.session.seq - 1; seq >= 0; seq--) {
    const event = agent.session.eventAt(seq as SessionSeq)
    if (event?.type !== 'user/message') continue
    if (isMemoryCatalogSource(event.data.source)) return true
  }
  return false
}

/** Append once on an admitted step. Rejected/cancelled steps do not mark a delivery. */
export function attachInitialMemoryCatalog(ctx: Context, deps: StatusDeps): () => void {
  let delivered = false
  return ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted || delivered || agent.ctx !== ctx) return decision
    delivered = catalogWasDelivered(agent)
    if (delivered || decision.messages.some(message => isMemoryCatalogSource(message.source))) return decision
    const root = deps.workspaceRoot()
    if (root === undefined) return decision
    const text = authorMemoryCatalogText(root)
    return { ...decision, messages: [...decision.messages, createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: MEMORY_CATALOG_SOURCE, form: 'snapshot', sections: [{ name: 'webnovel.memory', text }] },
    })] }
  }, { prepend: true })
}

/** agent/created 时挂到该 agent scoped ctx 的依赖面。 */
export interface StatusDeps {
  /** 工作范围根;未装机时为 undefined(此时不注入)。 */
  readonly workspaceRoot: () => string | undefined
}

/**
 * 注册书架 context（每次现扫）及作者记忆目录的一次性原生消息。
 * 作者目录独立于整份 runtime snapshot，其他 context 变化也不会再次附带它。
 *
 * 审计 B2(对称修正)：要交回的是两样 —— `sys.context()` 回的注销函数
 * (dsh system-prompt 真类型 `context(context: PromptContext): () => void`)，
 * 与 `agentCtx.inject()` 回的 Fiber fork。原先只 dispose fiber、丢弃注销函数，
 * 且在 fiber 无 dispose 表面时直接返回 undefined —— 调用方据此以为「没挂上、无需
 * 交回」，可 context 其实已经注册，那条路径是真泄漏。现在两样都收，任一在即交回。
 */
export function attachStatusToAgent(
  agentCtx: Context & { readonly systemPrompt?: SystemPromptLike },
  deps: StatusDeps,
): (() => Promise<void>) | undefined {
  if (sysPromptOf(agentCtx) === undefined) return undefined
  try {
    let off: (() => void) | undefined
    const offMemory = typeof agentCtx.on === 'function' ? attachInitialMemoryCatalog(agentCtx, deps) : undefined
    const fiber = agentCtx.inject(['systemPrompt'], (scope) => {
      const sys = sysPromptOf(scope as Context)
      if (sys === undefined) return
      const undo = sys.context({
        name: 'webnovel.status',
        order: 90,
        text: () => {
          const ws = deps.workspaceRoot()
          return ws === undefined ? '' : renderOverview(ws)
        },
      })
      if (typeof undo === 'function') off = undo
    })
    return async () => {
      offMemory?.()
      off?.()
      if (typeof fiber?.dispose === 'function') await fiber.dispose()
    }
  } catch {
    return undefined
  }
}
