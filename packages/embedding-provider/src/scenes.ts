import type { Context } from '@deepseek-ai/cordis'
import { SceneConfig, resolveSceneSettings } from './auxiliary-config'
import { attachSceneModel } from './auxiliary'

export const name = 'webnovel-scenes'
export const inject = ['embeddings']
export const Config = SceneConfig.volatile()
export function apply(ctx: Context, config: ReturnType<typeof Config>): void {
  resolveSceneSettings(config.get() ?? {})
  attachSceneModel(ctx, () => config.get() ?? {})
}
