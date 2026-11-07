import z from '@deepseek-ai/schemastery'
import { DEFAULT_RERANK_TIMEOUT_MS, MAX_RERANK_TIMEOUT_MS, MIN_RERANK_TIMEOUT_MS } from '@webnovel/core/retrieval-policy'

export const SCENE_NAMESPACE = 'webnovel-scenes'
export const RERANK_NAMESPACE = 'webnovel-reranking'
export const RERANK_CREDENTIAL = 'WEBNOVEL_RERANK_API_KEY'
export interface SceneSettings { enabled?: boolean; provider?: string; model?: string; concurrency?: number; timeoutMs?: number }
export interface RerankSettings { enabled?: boolean; endpoint?: string; model?: string; apiKeyEnv?: string; candidates?: number; timeoutMs?: number }
export const SceneConfig: z<SceneSettings> = z.object({
  enabled: z.boolean().default(false).description('后台向所选聊天模型发送定稿正文，识别场景边界；关闭后已有边界继续复用'),
  provider: z.string().description('宿主模型提供方路由'),
  model: z.string().description('场景识别模型'),
  concurrency: z.number().step(1).min(1).max(8).default(2),
  timeoutMs: z.number().step(1).min(100).max(180_000).default(60_000),
})
export const RerankConfig: z<RerankSettings> = z.object({
  enabled: z.boolean().default(false).description('语义查询向重排服务发送问题及少量定稿候选；不参与索引重建'),
  endpoint: z.string().description('完整重排接口地址，包含 /rerank 路径'),
  model: z.string().description('专用重排序模型'),
  apiKeyEnv: z.string().role('credential-ref').default(RERANK_CREDENTIAL),
  candidates: z.number().step(1).min(1).max(200).default(40),
  timeoutMs: z.number().step(1).min(MIN_RERANK_TIMEOUT_MS).max(MAX_RERANK_TIMEOUT_MS).default(DEFAULT_RERANK_TIMEOUT_MS),
})
const integer = (value: number | undefined, fallback: number, min: number, max: number) => {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error('参数须为 ' + min + '–' + max + ' 的整数')
  return result
}
function name(value: string | undefined, label: string): string {
  if (!value?.trim() || value.length > 256 || /[\r\n\0]/.test(value)) throw new Error('请填写有效的' + label)
  return value.trim()
}
export function resolveSceneSettings(input: SceneSettings): Required<Omit<SceneSettings, 'enabled'>> | undefined {
  if (!input.enabled) return undefined
  return { provider: name(input.provider, '宿主提供方'), model: name(input.model, '场景模型'),
    concurrency: integer(input.concurrency, 2, 1, 8), timeoutMs: integer(input.timeoutMs, 60_000, 100, 180_000) }
}
export function resolveRerankSettings(input: RerankSettings): Required<Omit<RerankSettings, 'enabled'>> | undefined {
  if (!input.enabled) return undefined
  let endpoint: URL
  try { endpoint = new URL(input.endpoint ?? '') } catch { throw new Error('重排接口地址无效') }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || endpoint.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw new Error('重排接口须为 HTTPS 地址（本机可用 HTTP），不得含凭据或查询参数')
  const apiKeyEnv = input.apiKeyEnv ?? RERANK_CREDENTIAL
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) throw new Error('重排凭据引用名称无效')
  return { endpoint: endpoint.href, model: name(input.model, '重排模型'), apiKeyEnv,
    candidates: integer(input.candidates, 40, 1, 200),
    timeoutMs: integer(input.timeoutMs, DEFAULT_RERANK_TIMEOUT_MS, MIN_RERANK_TIMEOUT_MS, MAX_RERANK_TIMEOUT_MS) }
}
