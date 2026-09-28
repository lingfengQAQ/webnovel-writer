import { Service, type Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import { attachLiveSettings } from './live-settings'
import { HostSceneProvider, HttpRerankingProvider } from './auxiliary-models'
import { resolveSceneSettings, resolveRerankSettings, type SceneSettings, type RerankSettings } from './auxiliary-config'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sceneSegmentation: AuxiliaryService<HostSceneProvider>
    reranking: AuxiliaryService<HttpRerankingProvider>
  }
}

interface Client { close(): Promise<void> }
export class AuxiliaryService<T extends Client> extends Service {
  private client?: T
  private key?: string
  // A plain container prevents Cordis from re-wrapping a nested Service on each property read.
  private readonly binding: { dependency?: unknown } = {}
  private closed = false
  private readonly retiring = new Set<Promise<void>>()
  constructor(ctx: Context, name: 'sceneSegmentation' | 'reranking', private readonly factory: () => { key: string; dependency?: unknown; create(): T } | undefined) { super(ctx, name) }
  current(): T | undefined {
    if (this.closed) return undefined
    const options = this.factory()
    if (!options) { this.refresh(); return undefined }
    if (!this.client || this.key !== options.key || this.binding.dependency !== options.dependency) {
      this.refresh()
      this.client = options.create(); this.key = options.key; this.binding.dependency = options.dependency
    }
    return this.client
  }
  refresh(): void {
    if (!this.client) return
    const task = this.client.close()
    this.client = undefined; this.key = undefined; this.binding.dependency = undefined
    this.retiring.add(task)
    void task.then(() => this.retiring.delete(task), () => this.retiring.delete(task))
  }
  async close(): Promise<void> { this.closed = true; this.refresh(); await Promise.allSettled([...this.retiring]) }
}

export function attachSceneModel(ctx: Context, sceneSource: () => SceneSettings): void {
  let llm: LlmRuntime | undefined
  const scenes = new AuxiliaryService(ctx, 'sceneSegmentation', () => {
    const config = resolveSceneSettings(sceneSource())
    if (!config || !llm) return undefined
    const runtime = llm
    return { key: JSON.stringify(config), dependency: runtime, create: () => new HostSceneProvider(config, runtime) }
  })
  ctx.effect(() => () => scenes.close(), 'webnovel: scene model requests')
  attachLiveSettings(ctx, resolveSceneSettings, () => scenes.refresh())
  ctx.on('llm/adapters-updated', () => scenes.refresh())
  // Cordis contextual facades are not identity-stable across get() calls.
  // Capture one injected service generation and cancel it when that scope ends.
  ctx.inject(['llm'], scope => {
    const runtime = scope.llm
    llm = runtime
    scenes.refresh()
    scope.effect(() => () => { if (llm === runtime) { llm = undefined; scenes.refresh() } }, 'webnovel: scene LLM generation')
  })
}

export function attachRerankingModel(ctx: Context, rerankSource: () => RerankSettings): void {
  const reranking = new AuxiliaryService(ctx, 'reranking', () => {
    const config = resolveRerankSettings(rerankSource())
    if (!config) return undefined
    return { key: JSON.stringify(config), create: () => new HttpRerankingProvider(config, async () => {
      const credentials = ctx.get('credentials')
      return credentials ? (await credentials.resolve(credentialRef(config.apiKeyEnv)))?.value : undefined
    }) }
  })
  ctx.effect(() => () => reranking.close(), 'webnovel: reranking requests')
  attachLiveSettings(ctx, resolveRerankSettings, () => reranking.refresh())
}
