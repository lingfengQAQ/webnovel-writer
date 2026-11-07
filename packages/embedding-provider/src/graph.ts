import type { Context } from '@deepseek-ai/cordis'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { AuxiliaryService } from './auxiliary'
import { GraphConfig, resolveGraphSettings } from './graph-config'
import { HostGraphProvider } from './graph-model'
import { attachLiveSettings } from './live-settings'

export const name = 'webnovel-graph'
export const Config = GraphConfig.volatile()
declare module '@deepseek-ai/cordis' { interface Context { graphExtraction: AuxiliaryService<HostGraphProvider> } }
export function apply(ctx: Context, entry: ReturnType<typeof Config>): void {
  let llm: LlmRuntime | undefined
  const settings = () => resolveGraphSettings(entry.get() ?? {})
  settings()
  const service = new AuxiliaryService(ctx, 'graphExtraction', () => {
    const config = settings(), runtime = llm
    if (!config || !runtime) return undefined
    return { key: JSON.stringify(config), dependency: runtime, create: () => new HostGraphProvider(config, runtime) }
  })
  ctx.effect(() => () => service.close(), 'webnovel: graph model requests')
  attachLiveSettings(ctx, resolveGraphSettings, () => service.refresh())
  ctx.on('llm/adapters-updated', () => service.refresh())
  ctx.inject(['llm'], scope => {
    const runtime = scope.llm
    llm = runtime; service.refresh()
    scope.effect(() => () => { if (llm === runtime) { llm = undefined; service.refresh() } }, 'webnovel: graph LLM generation')
  })
}
