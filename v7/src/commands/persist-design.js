import { readJsonInput } from '../util/json-input.js'
import {
  buildDesignChangePlan,
  validateDesignPayload,
} from '../knowledge/design.js'
import { DesignReader } from '../storage/adapters/DesignReader.js'
import { persistDesignChanges } from '../state-machine/persist.js'

/** persist-design --file=<json>：保存或放弃作者已确认的计划对象。 */
export async function run(args, options, ctx) {
  const input = await readJsonInput(ctx, options.file, 'file')
  if (!input.ok) return { ok: false, error: input.error }
  const validation = validateDesignPayload(input.data)
  if (!validation.ok) {
    return { ok: false, error: `故事对象设计未通过校验：\n- ${validation.errors.join('\n- ')}` }
  }

  const listed = await new DesignReader(ctx.repoPath).list()
  if (!listed.ok) {
    return { ok: false, error: `现有计划对象读取失败：\n- ${listed.errors.join('\n- ')}` }
  }
  const reservedNames = await readFactNames(ctx.cache)
  const plan = buildDesignChangePlan(
    listed.objects,
    validation.objects,
    validation.abandons,
    reservedNames
  )
  if (!plan.ok) {
    return { ok: false, error: `故事对象存在冲突：\n- ${plan.errors.join('\n- ')}` }
  }
  const saved = await persistDesignChanges(ctx, plan)
  if (!saved.ok) return { ok: false, error: saved.error }
  if (saved.unchanged) return { ok: true, output: '故事对象设计没有实际变化，无需重复落盘。' }

  const lines = []
  if (plan.savedIds.length) lines.push(`已保存计划对象：${plan.savedIds.join('、')}。`)
  if (plan.abandonedIds.length) lines.push(`已放弃计划对象：${plan.abandonedIds.join('、')}。`)
  lines.push(`本次设计已入档（commit ${String(saved.commitHash).slice(0, 8)}）。`)
  return { ok: true, output: lines.join('\n') }
}

async function readFactNames(cache) {
  if (!cache) return []
  try {
    const entities = await cache.query('SELECT id FROM entities ORDER BY id')
    const aliases = await cache.query('SELECT alias, entity_id FROM entity_aliases ORDER BY alias')
    return [
      ...entities.map((row) => ({ 名称: String(row.id), 归属: String(row.id) })),
      ...aliases.map((row) => ({ 名称: String(row.alias), 归属: String(row.entity_id) })),
    ]
  } catch {
    return []
  }
}
