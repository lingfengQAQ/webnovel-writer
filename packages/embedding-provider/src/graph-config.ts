import z from '@deepseek-ai/schemastery'

export interface GraphSettings { enabled?: boolean; provider?: string; model?: string; timeoutMs?: number }
export const GraphConfig: z<GraphSettings> = z.object({
  enabled: z.boolean().default(false).description('提供独立图谱抽取模型；保存配置后仍须在每本书的关系页手动启用'),
  provider: z.string().description('宿主提供方路由'),
  model: z.string().description('图谱抽取模型'),
  timeoutMs: z.number().step(1).min(100).max(180000).default(60000),
})
export function resolveGraphSettings(input: GraphSettings): Required<Omit<GraphSettings, 'enabled'>> | undefined {
  if (!input.enabled) return undefined
  const checked = GraphConfig(input)
  if (!checked.provider?.trim() || !checked.model?.trim()) throw new Error('请填写图谱聊天模型的宿主提供方和模型')
  return { provider: checked.provider.trim(), model: checked.model.trim(), timeoutMs: checked.timeoutMs! }
}
