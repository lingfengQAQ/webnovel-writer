import { readJsonInput } from '../util/json-input.js'
import { ContractReader } from '../storage/adapters/ContractReader.js'
import { BookConfigReader } from '../storage/adapters/BookConfigReader.js'
import { validateContractUpdatePayload } from '../knowledge/contract.js'
import { persistWorkContract } from '../state-machine/persist.js'
import {
  finishContractInvalidation,
  prepareContractInvalidation,
  rollbackContractInvalidation,
} from '../staging/index.js'
import { acquireContractMutationLock } from '../staging/contract-invalidation.js'

/** persist-contract --file=<json>：只落作者已确认的契约修订，不自动查询或升级通用知识。 */
export async function run(args, options, ctx) {
  const input = await readJsonInput(ctx, options.file, 'file')
  if (!input.ok) return { ok: false, error: input.error }

  const lock = await acquireContractMutationLock(ctx.repoPath, '作品契约更新')
  if (!lock.ok) return { ok: false, error: lock.error }
  try {
    return await persistContractUpdate(input.data, ctx)
  } finally {
    await lock.release()
  }
}

async function persistContractUpdate(data, ctx) {
  const previous = await new ContractReader(ctx.repoPath).read()
  if (!previous.ok) return { ok: false, error: `不能更新作品契约：${previous.error}` }
  const config = await new BookConfigReader(ctx.repoPath).read()
  if (!config.ok) return { ok: false, error: `不能更新作品契约：${config.error}` }

  const next = await findNextChapter(ctx)
  if (!next.ok) return { ok: false, error: next.error }
  const nextChapter = next.chapter
  const validation = validateContractUpdatePayload(data, {
    previous: previous.data,
    nextChapter,
  })
  if (!validation.ok) {
    return { ok: false, error: `作品契约修订未通过校验：\n- ${validation.errors.join('\n- ')}` }
  }

  const fm = validation.contract.frontMatter
  const book = {
    ...config.data,
    类型: fm.类型,
    副题材: Array.isArray(fm.副题材) ? fm.副题材 : [],
    流派: Array.isArray(fm.流派) ? fm.流派 : [],
  }
  const invalidationPlan = await prepareContractInvalidation(
    ctx.repoPath,
    fm.生效起章,
    { nextChapter, contractVersion: fm.契约版本 }
  )
  if (!invalidationPlan.ok) {
    return { ok: false, error: `不能更新作品契约：${invalidationPlan.error}` }
  }
  const saved = await persistWorkContract(
    ctx,
    {
      book,
      作品契约: data.作品契约,
      contract: validation.contract,
      selections: validation.selections,
      decisions: validation.decisions,
      revision: validation.revision,
    },
    {
      additionalWrites: invalidationPlan.writes,
      rollbackAdditionalWrites: () =>
        rollbackContractInvalidation(ctx.repoPath, invalidationPlan),
    }
  )
  if (!saved.ok) return { ok: false, error: saved.error }

  const invalidation = await finishContractInvalidation(ctx.repoPath, invalidationPlan)
  const lines = [
    `作品契约已更新到 v${fm.契约版本}，从第 ${fm.生效起章} 章起生效（commit ${String(saved.commitHash).slice(0, 8)}）。`,
  ]
  if (invalidation.受影响章.length) {
    lines.push(`待定稿第 ${invalidation.受影响章.join('、')} 章已标为受影响，须重新备料、修订并审查。`)
  }
  if (invalidation.当前工作区失效) {
    lines.push('当前未定稿工件已标记为受影响；旧细纲与草稿保留，须重新起草或核对细纲，再备料、修订和审查。')
  }
  for (const warning of invalidation.warnings) lines.push(warning)
  return { ok: true, output: lines.join('\n') }
}

async function findNextChapter(ctx) {
  try {
    const rows = await ctx.cache.query('SELECT MAX(chapter_num) AS m FROM chapters')
    return { ok: true, chapter: (rows[0]?.m || 0) + 1, error: '' }
  } catch {
    return {
      ok: false,
      chapter: null,
      error: '不能更新作品契约：无法确认下一未定稿章，请删除书目录下 .cache/ 后重跑，缓存会自动重建。',
    }
  }
}
