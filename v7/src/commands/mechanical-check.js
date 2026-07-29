import { promises as fs } from 'node:fs'
import path from 'node:path'
import { mechanicalCheck } from '../mechanical-check/index.js'
import { writeAtomicBatch } from '../storage/atomic.js'
import { acquireContractMutationLock } from '../staging/contract-invalidation.js'
import {
  mechanicalBudgetForChapter,
  readRetryPolicy,
  recordMechanicalAttempt,
  reserveMechanicalAttempt,
  retryDraftHash,
  retryPolicyFile,
} from '../retry-policy/index.js'

/**
 * mechanical-check <章号> [--draft=<path>] [--author-confirmed]
 * → JSON {pass, issues, candidates, used, remaining, blocked, action}（机检，零 token）
 * 默认草稿 工作区/草稿-A.md。契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const chapterNum = parseInt(args[0], 10)
  if (isNaN(chapterNum)) {
    return { ok: false, error: '章号必须是数字' }
  }
  const draftPath =
    options.draft && options.draft !== true
      ? path.resolve(ctx.repoPath, options.draft)
      : path.join(ctx.repoPath, '工作区', '草稿-A.md')

  const lock = await acquireContractMutationLock(ctx.repoPath, '机检重试记账')
  if (!lock.ok) return { ok: false, error: lock.error }
  try {
    const before = await fs.readFile(draftPath, 'utf8')
    const draftHash = retryDraftHash(before)
    const loaded = await readRetryPolicy(ctx.repoPath)
    if (!loaded.ok) return { ok: false, error: loaded.error }

    const reserved = reserveMechanicalAttempt(loaded.state, {
      chapterNum,
      draftHash,
      authorConfirmed: options['author-confirmed'] === true || options['author-confirmed'] === 'true',
    })
    if (!reserved.ok) return { ok: false, error: `机检重试预算无法核对：${reserved.error}` }
    if (!reserved.allowed) {
      // 未执行机检就没有 pass 结论（§2.4 pass=issues.length===0 是消费方契约），
      // 拒检分支只输出预算与去向。
      return {
        ok: true,
        output: JSON.stringify(
          {
            executed: false,
            used: reserved.budget.used,
            remaining: reserved.budget.remaining,
            blocked: true,
            action: reserved.action,
            message: reserved.error,
          },
          null,
          2
        ),
      }
    }

    const r = await mechanicalCheck(ctx, { chapterNum, draftPath })
    if (!r.ok) return { ok: false, error: r.error }
    const after = await fs.readFile(draftPath, 'utf8')
    if (retryDraftHash(after) !== draftHash) {
      return { ok: false, error: '机检期间草稿发生了变化，结果未记账；请对当前草稿重新运行机检。' }
    }

    const recorded = recordMechanicalAttempt(loaded.state, {
      chapterNum,
      draftHash,
      pass: r.pass,
      route: reserved.route,
    })
    if (!recorded.ok) return { ok: false, error: `机检重试预算无法记账：${recorded.error}` }
    if (recorded.changed) {
      await writeAtomicBatch(ctx.repoPath, [retryPolicyFile(recorded.state)])
    }
    const budget = mechanicalBudgetForChapter(recorded.state, chapterNum)
    const action = r.pass
      ? 'continue-to-review'
      : budget.remaining > 0
        ? 'revise-and-recheck'
        : 'hand-off-to-author'
    return {
      ok: true,
      output: JSON.stringify(
        {
          pass: r.pass,
          issues: r.issues,
          candidates: r.candidates,
          used: budget.used,
          remaining: budget.remaining,
          blocked: r.pass ? false : budget.blocked,
          action,
          executed: true,
        },
        null,
        2
      ),
    }
  } catch (err) {
    return { ok: false, error: `机检重试记账失败：${err.message}` }
  } finally {
    await lock.release()
  }
}
