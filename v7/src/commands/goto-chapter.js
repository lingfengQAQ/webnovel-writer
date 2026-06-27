import { gotoChapter } from '../state-machine/flows/goto-chapter.js'

/**
 * goto-chapter <章号> [--confirm] → 回到第N章（人话命令，先备份再回滚）
 * 不带 --confirm 只展示影响范围；带 --confirm 才真回退。
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const chapterNum = parseInt(args[0], 10)
  if (isNaN(chapterNum)) {
    return { ok: false, error: '请指定要回到的章号' }
  }
  const r = await gotoChapter(ctx, { chapterNum, confirm: !!options.confirm })
  return r.ok ? { ok: true, output: r.message } : { ok: false, error: r.error }
}
