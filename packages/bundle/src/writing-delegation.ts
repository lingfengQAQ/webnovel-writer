import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionSeq } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { AgentLike } from './novel-tools'

import { WRITING_DELEGATE_TOOL } from './tool-catalog'
export { WRITING_DELEGATE_TOOL } from './tool-catalog'
export const WRITING_ROLES = ['drafting', 'polish', 'revision', 'review', 'settle'] as const
export type WritingRole = typeof WRITING_ROLES[number]
export interface WritingAssignment { role: WritingRole; bookId?: string; chapter?: number }
const creationRole = new AsyncLocalStorage<WritingAssignment & { parent: AgentLike }>()
const isRole = (value: unknown): value is WritingRole => WRITING_ROLES.some(role => role === value)
const marker = (role: WritingRole) => `<!-- scriptor-worker:v1:${role} -->\n`

/** Explicit role only: never infer a worker's job from its title or prose. */
export function writingRoleOf(agent: AgentLike): WritingRole | undefined {
  return writingAssignmentOf(agent)?.role
}

export function writingAssignmentOf(agent: AgentLike): WritingAssignment | undefined {
  const active = creationRole.getStore()
  if (active && typeof agent.session?.header?.parentSession === 'string'
    && agent.session.header.parentSession === active.parent.session?.header?.id) return { role: active.role, bookId: active.bookId, chapter: active.chapter }
  const session = agent.session as Session | undefined
  if (typeof session?.eventAt !== 'function' || typeof session.seq !== 'number') return undefined
  // Skip forked parent history. The initial task message is the durable role;
  // later messages and quoted materials cannot retag this worker.
  for (let seq: number = session.inheritedEventCount ?? 0; seq < session.seq; seq++) {
    const event = session.eventAt(seq as SessionSeq)
    if (event?.type !== 'user/message' || event.data.source.kind !== 'user') continue
    const first = event.data.content[0]
    if (first?.type !== 'text') return undefined
    const role = WRITING_ROLES.find(role => first.text.startsWith(marker(role)))
    if (!role) return undefined
    const assignment = /^<!-- scriptor-assignment:v1:(.+) -->\n/.exec(first.text.slice(marker(role).length))
    if (!assignment) return { role }
    try {
      const value = JSON.parse(assignment[1]!) as { bookId?: unknown; chapter?: unknown }
      return { role, ...(typeof value.bookId === 'string' && value.bookId.trim() ? { bookId: value.bookId } : {}),
        ...(typeof value.chapter === 'number' && Number.isSafeInteger(value.chapter) && value.chapter > 0 ? { chapter: value.chapter } : {}) }
    } catch { return { role } }
  }
  return undefined
}

/** Add one typed role field while reusing the native tool's routing and lifecycle. */
export function attachWritingDelegationToAgent(agent: AgentLike): (() => Promise<void>) | undefined {
  const context = agent.ctx as Context | undefined
  if (typeof context?.inject !== 'function') return undefined
  const fiber = context.inject(['tools'], scope => {
    scope.effect(function* () {
      let native: ToolDefinition | undefined
      let off: (() => void) | undefined
      let updating = false
      const refresh = () => {
        if (updating) return
        const current = scope.tools.get('subagent', agent as Parameters<typeof scope.tools.get>[1])
        if (current === native) return
        updating = true
        try {
          off?.(); off = undefined
          native = current
          if (!current) return
          const parameters = current.parameters as { properties?: Record<string, unknown>; required?: string[] }
          off = scope.tools.register({
            ...current,
            name: WRITING_DELEGATE_TOOL,
            description: '委派小说生产任务，按 role 绑定该实例的规约和权限。drafting 为起草，polish 为润色，revision 为改稿。review 为审读，settle 为沉淀对账。明确目标书和章节时填写 bookId、chapter，供进度归属；未明确时不要猜填。普通研究和工具任务使用 subagent。\n' + current.description,
            parameters: {
              ...current.parameters,
              properties: { ...parameters.properties, role: { type: 'string', enum: [...WRITING_ROLES] },
                bookId: { type: 'string', description: '已明确的目标书id；仅用于任务归属' },
                chapter: { type: 'integer', minimum: 1, description: '已明确的全书章号；仅用于任务归属' } },
              required: [...parameters.required ?? [], 'role'],
            },
            execute(args, exec) {
              const { role, bookId, chapter, ...task } = args as Record<string, unknown>
              if (!isRole(role) || typeof task['prompt'] !== 'string' || exec.agent !== agent) {
                throw new Error('写作委派须指定有效 role、任务 prompt 和当前主控。')
              }
              if (bookId !== undefined && (typeof bookId !== 'string' || !bookId.trim() || bookId.length > 256 || /[\r\n<>]/.test(bookId))
                || chapter !== undefined && (typeof chapter !== 'number' || !Number.isSafeInteger(chapter) || chapter < 1)) throw new Error('委派的书id或章号无效')
              const assignment = { ...(typeof bookId === 'string' ? { bookId: bookId.trim() } : {}), ...(typeof chapter === 'number' ? { chapter } : {}) }
              const attribution = Object.keys(assignment).length ? `<!-- scriptor-assignment:v1:${JSON.stringify(assignment)} -->\n` : ''
              return creationRole.run({ parent: agent, role, ...assignment }, () => current.execute({
                ...task, prompt: marker(role) + attribution + task['prompt'],
              }, exec))
            },
          })
        } finally { updating = false }
      }
      yield () => { off?.() }
      yield scope.on('tools/change', refresh)
      refresh()
    })
  })
  return async () => { await fiber.dispose() }
}
