import { promises as fs } from 'node:fs'
import path from 'node:path'
import { persistCreateBook } from '../state-machine/persist.js'
import { registerBook } from '../session/index.js'
import { readJsonInput } from '../util/json-input.js'

/**
 * persist-book --file=<json> [--dir=<目录名>]：序1 建书产物回流。
 * 工作目录模式：建 workdir/<目录>/ 落盘 + books.jsonl 登记置当前（目录名取 --dir,缺省书名）。
 * 书仓库直启（cwd 含 book.yaml,开发/测试）：落 cwd,不登记（无工作目录层）。
 * 契约：纯返回 {ok, output?, error?}。
 */
export const scope = 'workdir-or-book'

export async function run(args, options, ctx) {
  const spec = await readJsonInput(ctx, options.file, 'file')
  if (!spec.ok) return { ok: false, error: spec.error }
  const { book, 总纲, 卷纲 } = spec.data
  if (!book || typeof book !== 'object' || !book.书名) {
    return { ok: false, error: 'JSON 需含对象字段「book」（book.yaml 内容,至少有 书名）' }
  }
  if (typeof 总纲 !== 'string' || !总纲.trim()) return { ok: false, error: 'JSON 需含非空字符串字段「总纲」' }
  if (typeof 卷纲 !== 'string' || !卷纲.trim()) return { ok: false, error: 'JSON 需含非空字符串字段「卷纲」' }

  // 书仓库直启：落当前书仓库
  if (ctx.repoPath) {
    const r = await persistCreateBook(ctx, { book, 总纲, 卷纲 })
    return r.ok
      ? { ok: true, output: `建书完成：${r.written.join('、')}` }
      : { ok: false, error: r.error }
  }

  // 工作目录模式：建书目录 + 登记
  const dirName = options.dir && options.dir !== true ? options.dir : String(book.书名)
  if (/[\\/]/.test(dirName) || dirName.includes('..') || dirName.startsWith('.')) {
    return { ok: false, error: `书目录名不合法：${dirName}（须是工作目录下的一层普通目录名）` }
  }
  const repoPath = path.join(ctx.workdir, dirName)
  try {
    await fs.access(path.join(repoPath, 'book.yaml'))
    return { ok: false, error: `已有同名书目录 ${dirName}/（含 book.yaml），不覆盖。换个书名或用 --dir 指定其他目录。` }
  } catch {
    // 目录不存在或还不是书——可建
  }
  const r = await persistCreateBook({ repoPath }, { book, 总纲, 卷纲 })
  if (!r.ok) return { ok: false, error: r.error }
  const reg = await registerBook(ctx.workdir, { 书名: String(book.书名), 目录: dirName })
  if (!reg.ok) {
    return { ok: false, error: `书已建成（${dirName}/）但登记失败：${reg.error}。运行 list-books 触发书单重建。` }
  }
  return {
    ok: true,
    output: `建书完成：《${book.书名}》（目录 ${dirName}/），已登记为当前书。继续运行 next 判定下一步。`,
  }
}
