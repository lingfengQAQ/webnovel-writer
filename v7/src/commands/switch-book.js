import { setCurrentBook } from '../session/index.js'

/**
 * switch-book <书名或目录名>：换书=改 books.jsonl 的「当前」标记。未命中列候选。
 * 契约：纯返回 {ok, output?, error?}。
 */
export const scope = 'workdir'

export async function run(args, options, ctx) {
  const name = args[0]
  if (!name) return { ok: false, error: '用法：webnovel-writer switch-book <书名或目录名>' }
  const r = await setCurrentBook(ctx.workdir, name)
  if (!r.ok) return { ok: false, error: r.error }
  return { ok: true, output: `已切换：当前在写《${r.book.书名}》（目录：${r.book.目录}）` }
}
