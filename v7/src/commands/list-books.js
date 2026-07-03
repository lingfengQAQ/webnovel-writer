import { loadBooks } from '../session/index.js'

/**
 * list-books：书单（当前标记/目录/最后打开）。登记缺失时触发扫描重建自愈。
 * 契约：纯返回 {ok, output?, error?}。
 */
export const scope = 'workdir'

export async function run(args, options, ctx) {
  const { books, rebuilt, needsAuthorPick } = await loadBooks(ctx.workdir)
  if (!books.length) {
    return { ok: true, output: '工作目录还没有书。对 AI 说「建书」开始第一本。' }
  }
  const lines = books.map(
    (b) =>
      `${b.当前 ? '→' : '　'} 《${b.书名}》  目录：${b.目录}${b.最后打开 ? `  最后打开：${b.最后打开}` : ''}`
  )
  if (rebuilt) lines.push('（书单刚按目录扫描重建）')
  if (needsAuthorPick) lines.push('尚未选择当前书：运行 webnovel-writer switch-book <书名>')
  return { ok: true, output: lines.join('\n') }
}
