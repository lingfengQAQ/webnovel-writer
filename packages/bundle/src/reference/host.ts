import * as path from 'node:path'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { SettingsForms } from '@deepseek-ai/dsh-settings'
import { BlockAssembler, createUserMessage, type LlmRuntime } from '@deepseek-ai/dsh-llm'
import { REFERENCE_LIMITS, ReferenceError, abortableReference, referenceHash, sameReferenceRoute, type ModelRunner, type ReferenceRoute } from '@webnovel/core'
import type { AgentLike } from '../novel-tools'

export interface ReferenceHostAccess {
  fs(agent: AgentLike): FileSystem | undefined
  llm(agent: AgentLike): LlmRuntime | undefined
  settings(agent: AgentLike): SettingsForms | undefined
}
/** No extra Agent, conversation, credentials, vector API or raw-prompt logging. */
export class ReferenceHost {
  private readonly shutdown = new AbortController()
  private generation = 0
  constructor(private readonly access: ReferenceHostAccess) {}
  changed(): void { this.generation++ }
  close(): void { this.shutdown.abort() }
  async readFile(agent: AgentLike, workspace: string, filename: string, signal?: AbortSignal): Promise<Uint8Array> {
    const active = AbortSignal.any([this.shutdown.signal, ...(signal ? [signal] : [])])
    active.throwIfAborted()
    const fs = this.access.fs(agent)
    if (!fs) throw new ReferenceError('fs-unavailable', '宿主文件服务不可用')
    if (!path.isAbsolute(filename)) throw new ReferenceError('source-path', '请选择原文文件的绝对路径')
    const mapped = fs.processPathFromHostPath(filename), workspacePath = fs.processPathFromHostPath(workspace)
    if (!mapped || !workspacePath) throw new ReferenceError('fs-world', '该文件或工作范围无法映射到当前执行环境；未回退到其他文件系统读取')
    const info = await fs.lstat(mapped, undefined, active)
    if (info?.type !== 'file') throw new ReferenceError('source-type', '原文必须是明确选定的普通文件，不接受目录或链接')
    let ancestor = path.dirname(mapped)
    while (path.dirname(ancestor) !== ancestor) {
      if ((await fs.lstat(ancestor, undefined, active))?.type !== 'directory') throw new ReferenceError('source-type', '原文的祖先目录包含链接或不可访问路径')
      ancestor = path.dirname(ancestor)
    }
    const target = await fs.resolve(mapped, { signal: active })
    const library = await fs.resolve(path.join(workspacePath, '书房/参考书'), { signal: active })
    if (fs.contains(library, target)) throw new ReferenceError('source-path', '原文件不能位于待清除的受管参考库内')
    const before = await fs.stat(target, active)
    if (before?.type !== 'file' || (before.size !== undefined && before.size > REFERENCE_LIMITS.sourceBytes)) throw new ReferenceError('source-limit', '源文件不可读或超过 64 MiB')
    const bytes = await fs.readBytes(target, active, REFERENCE_LIMITS.sourceBytes)
    const afterTarget = await fs.resolve(mapped, { signal: active }), after = await fs.stat(afterTarget, active)
    const afterPath = await fs.lstat(mapped, undefined, active)
    if (afterTarget.targetKey !== target.targetKey || after?.version !== before.version || afterPath?.version !== info.version || afterPath.type !== 'file') throw new ReferenceError('source-changed', '源文件在读取期间变化，请重新预检')
    active.throwIfAborted()
    return bytes
  }
  runner(agent: AgentLike): ModelRunner {
    const getRoute = async (): Promise<ReferenceRoute> => {
      this.shutdown.signal.throwIfAborted()
      // The header is the route that actually dispatched this tool-bearing step.
      // A UI model switch is admitted by DSH on the next step, then this header changes.
      const config = agent.session?.requestHeader?.()?.config
      const llm = this.access.llm(agent)
      if (!config?.provider || !config.model || !llm) throw new ReferenceError('model-unavailable', '当前主会话没有可核对的实际模型路由')
      const provider = llm.listProviders().find(provider => provider.id === config.provider)
      if (!provider) throw new ReferenceError('model-unavailable', '当前模型提供方已卸载')
      const entry = llm.listConfigurableProviders().find(entry => entry.provider === config.provider)
      let profile: unknown = null
      if (entry) {
        const settings = this.access.settings(agent)
        const section = settings?.describe({ redactSecrets: true }).find(section => section.ns === entry.settingsNs)
        if (!section) throw new ReferenceError('model-unavailable', '无法核对提供方配置，未发送原文')
        profile = section.value
        for (const key of entry.settingsPath) profile = profile && typeof profile === 'object' ? (profile as Record<string, unknown>)[key] : undefined
        if (!profile) throw new ReferenceError('model-unavailable', '提供方配置路径不可用')
      }
      return { provider: config.provider, model: config.model, service: provider.name + ' · ' + referenceHash(JSON.stringify(profile)).slice(0, 24) }
    }
    return {
      route: getRoute,
      maxInputChars: async () => {
        const route = await getRoute(), llm = this.access.llm(agent)!
        const prepared = await llm.prepareCall({ provider: route.provider, model: route.model, maxTokens: 8192 })
        // UTF-8 bytes bound text tokens conservatively; reserve output, protocol and context.
        return Math.min(REFERENCE_LIMITS.batchChars, Math.floor(((prepared.context?.contextWindow ?? 32768) - 16_000) / 4))
      },
      run: async (input, signal) => {
        const active = AbortSignal.any([signal, this.shutdown.signal]), generation = this.generation
        const check = async () => {
          active.throwIfAborted()
          if (this.generation !== generation || !sameReferenceRoute(input.route, await getRoute())) throw new ReferenceError('route-changed', '提供方或模型路由已变化，请重新核对')
        }
        await check()
        const llm = this.access.llm(agent)
        if (!llm) throw new ReferenceError('model-unavailable', '宿主模型服务不可用')
        const prepared = await abortableReference(llm.prepareCall({ provider: input.route.provider, model: input.route.model, maxTokens: input.maxOutputTokens }, active), active)
        await check()
        if (Buffer.byteLength(input.system + input.text) + input.maxOutputTokens > (prepared.context?.contextWindow ?? 32768)) throw new ReferenceError('model-budget', '本批超出模型上下文预算，请重新计划更小范围')
        const assembler = new BlockAssembler()
        let outputSize = 0
        try {
          await abortableReference((async () => {
            for await (const chunk of prepared.stream({ ...prepared.config, system: input.system, messages: [createUserMessage({ content: [{ type: 'text', text: input.text }], source: { kind: 'user' } })], signal: active })) {
              active.throwIfAborted(); assembler.push(chunk)
              outputSize += JSON.stringify(chunk).length
              if (outputSize > REFERENCE_LIMITS.outputChars * 8) throw new ReferenceError('model-output', '分析回复超过限制')
            }
          })(), active)
        } catch (error) {
          active.throwIfAborted()
          throw error instanceof ReferenceError ? error : new ReferenceError('model-transport', '配置模型请求未完成，未记录原文或原始错误')
        }
        await check()
        if (assembler.finish?.kind !== 'stop' || assembler.blocks().some(block => block.type === 'tool-call')) throw new ReferenceError('model-output', '分析回复未正常结束或试图调用工具')
        return assembler.blocks().filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text').map(block => block.text).join('')
      },
    }
  }
}
