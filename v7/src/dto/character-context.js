import { EntityReader } from '../storage/adapters/EntityReader.js'

/**
 * 组装角色上下文 DTO（CharacterContext）。AI 永不见文件结构（实施计划 §1.5 原则 1）：
 * 只返回领域字段（境界/状态/位置/持有…），不含任何文件路径。
 * @param {{repoPath: string, cache?: object}} ctx
 * @param {string} name 正名
 * @returns {Promise<{ok: boolean, context: object|null, error: string}>}
 */
export async function assembleCharacterContext(ctx, name) {
  const reader = new EntityReader(ctx.repoPath, ctx.cache, ctx.degradation)
  const r = await reader.readCharacterFrontMatter(name)
  if (!r.ok) {
    return { ok: false, context: null, error: r.error }
  }
  const fm = r.data || {}
  return {
    ok: true,
    context: {
      正名: fm.姓名 || name,
      别名: fm.别名 || [],
      状态: fm.状态 ?? null,
      位置: fm.位置 ?? null,
      境界: fm.境界 ?? null,
      持有: fm.持有 || [],
      最后变更章: fm.最后变更章 ?? null,
    },
    error: '',
  }
}
