import { promises as fs } from 'node:fs'
import path from 'node:path'
import { persistCreateBook } from '../state-machine/persist.js'
import { registerBook } from '../session/index.js'
import { readJsonInput } from '../util/json-input.js'
import { validateCreateBookPayload } from '../knowledge/contract.js'

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
  const validation = validateCreateBookPayload(spec.data)
  if (!validation.ok) {
    return { ok: false, error: `建书产物未通过校验：\n- ${validation.errors.join('\n- ')}` }
  }
  const { book } = spec.data

  // 书仓库直启：落当前书仓库
  if (ctx.repoPath) {
    const r = await persistCreateBook(ctx, spec.data)
    return r.ok
      ? { ok: true, output: `建书完成：${r.written.join('、')}` }
      : { ok: false, error: r.error }
  }

  // 工作目录模式：建书目录 + 登记
  const dirName = options.dir && options.dir !== true ? options.dir : String(book.书名)
  if (/[\\/]/.test(dirName) || dirName.includes('..') || dirName.startsWith('.')) {
    return { ok: false, error: `书目录名不合法：${dirName}（须是工作目录下的一层普通目录名）` }
  }
  // Windows 目录名雷区前置拦截,不让 mkdir 深处报天书;书名本身不用改,指路 --dir
  const hasControlChar = [...dirName].some((c) => c.charCodeAt(0) < 32)
  if (/[<>:"|?*]/.test(dirName) || hasControlChar || /[. ]$/.test(dirName)) {
    return {
      ok: false,
      error: `书名「${dirName}」含文件系统不支持的字符（< > : " | ? * 控制符，或结尾的点/空格），不能直接当目录名。书名不用改，加 --dir=<目录名> 指定一个不含这些字符的目录即可。`,
    }
  }
  const repoPath = path.join(ctx.workdir, dirName)
  try {
    await fs.access(path.join(repoPath, 'book.yaml'))
    return { ok: false, error: `已有同名书目录 ${dirName}/（含 book.yaml），不覆盖。换个书名或用 --dir 指定其他目录。` }
  } catch {
    // 目录不存在或还不是书——可建
  }
  const r = await persistCreateBook({ repoPath }, spec.data)
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
