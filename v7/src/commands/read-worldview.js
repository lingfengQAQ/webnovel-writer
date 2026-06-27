import { promises as fs } from 'node:fs'
import path from 'node:path'
import { extractSection } from '../util/markdown.js'

/**
 * read-worldview --section=<标题> → 世界观指定小节（读 定稿/设定/世界观.md）
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  if (!options.section || options.section === true) {
    return { ok: false, error: '请用 --section=<标题> 指定世界观小节' }
  }

  const filePath = path.join(ctx.repoPath, '定稿', '设定', '世界观.md')
  let content
  try {
    content = await fs.readFile(filePath, 'utf8')
  } catch {
    return { ok: false, error: '世界观文件不存在' }
  }

  const section = extractSection(content, options.section)
  return section
    ? { ok: true, output: section }
    : { ok: false, error: `世界观无「${options.section}」小节` }
}
