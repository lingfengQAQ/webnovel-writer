import { Service, type Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import { Config as SettingsConfig, resolveSettings, type EmbeddingSettings } from './config'
import { HttpEmbeddingProvider } from './http'
import type { EmbeddingProvider } from '@webnovel/core'
import { attachDiscovery } from './discovery'
import { attachLiveSettings } from './live-settings'

export const Config = SettingsConfig.volatile()
export const name = 'webnovel-embedding-provider'
export const inject = ['credentials']

declare module '@deepseek-ai/cordis' { interface Context { embeddings: EmbeddingService } }

export class EmbeddingService extends Service {
  private currentClient: HttpEmbeddingProvider | undefined
  private readonly closing = new Set<Promise<void>>()

  constructor(ctx: Context, private readonly source: () => EmbeddingSettings) { super(ctx, 'embeddings') }

  current(): EmbeddingProvider | undefined {
    const configuration = resolveSettings(this.source())
    if (!configuration) { this.retire(); return undefined }
    if (!this.currentClient || JSON.stringify(configuration) !== JSON.stringify(this.currentClient.config)) {
      this.retire()
      this.currentClient = new HttpEmbeddingProvider(configuration, async () => {
        const credentials = this.ctx.get('credentials')
        return credentials ? (await credentials.resolve(credentialRef(configuration.apiKeyEnv)))?.value : undefined
      })
    }
    return this.currentClient
  }

  refresh(): void { this.retire() }

  private retire(): void {
    if (!this.currentClient) return
    const task = this.currentClient.close()
    this.currentClient = undefined
    this.closing.add(task)
    void task.then(() => this.closing.delete(task), () => this.closing.delete(task))
  }

  async close(): Promise<void> { this.retire(); await Promise.allSettled([...this.closing]) }
}

export function apply(ctx: Context, entry: ReturnType<typeof Config>): void {
  const current = () => entry.get() ?? {}
  resolveSettings(current())
  const service = new EmbeddingService(ctx, current)
  attachDiscovery(ctx)
  ctx.effect(() => () => service.close(), 'webnovel embeddings: cancel pending requests')
  attachLiveSettings(ctx, resolveSettings, () => service.refresh())
}
