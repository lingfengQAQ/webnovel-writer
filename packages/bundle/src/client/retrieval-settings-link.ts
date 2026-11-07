import type { SettingsTarget } from './plugin-nav'

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** A successful keyword query can still report unavailable semantic retrieval. */
export function retrievalSettingsLink(toolName: string, raw: string): { target: SettingsTarget; needsAttention: boolean } | undefined {
  if (toolName !== 'novel_search_finalized' && toolName !== 'novel_index_manage') return undefined
  const fallback = { target: { kind: 'bundle', group: 'retrieval' } as SettingsTarget, needsAttention: false }
  let value: unknown
  try { value = JSON.parse(raw) } catch { return fallback }
  if (!object(value) || typeof value.ok !== 'boolean') return fallback
  const index = object(value.index) ? value.index : {}
  const ranking = object(value.reranking) ? value.reranking : {}
  const missingEmbedding = index.phase === 'unconfigured' || index.providerConfigured === false
    || value.degraded === '未启用或未配置嵌入提供方，本次仅检索关键词'
    || value.degraded === '嵌入提供方未声明有效维度，本次仅检索关键词'
  const rankingProblem = ranking.applied === false && typeof ranking.reason === 'string'
  const needsAttention = !value.ok || missingEmbedding || rankingProblem || ['failed', 'retrying', 'unconfigured'].includes(String(index.phase))
    || value.status === 'partial' || (typeof value.degraded === 'string' && value.degraded !== '本次指定关键词模式')
  return {
    needsAttention,
    target: missingEmbedding ? { kind: 'row', rowId: 'webnovel-embeddings' }
      : rankingProblem ? { kind: 'row', rowId: 'webnovel-reranking' } : fallback.target,
  }
}
