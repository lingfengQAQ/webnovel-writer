import { OutlineReader } from '../storage/adapters/OutlineReader.js'
import { extractSection } from '../util/markdown.js'

/**
 * read-outline [--总纲 [--section=<标题>|--结局] | --卷=N [--section=<标题>]]
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const reader = new OutlineReader(ctx.repoPath, ctx.cache)

  if (options['总纲']) {
    const title = options['结局']
      ? '结局'
      : options.section && options.section !== true
        ? options.section
        : null
    if (!title) {
      return { ok: false, error: '读总纲请指定 --结局 或 --section=<标题>' }
    }
    const r = await reader.readOutlineSection(title)
    if (!r.ok) return { ok: false, error: r.error }
    return r.content
      ? { ok: true, output: r.content }
      : { ok: false, error: `总纲无「${title}」小节` }
  }

  if (options['卷'] !== undefined && options['卷'] !== true) {
    const volNum = parseInt(options['卷'], 10)
    const r = await reader.readVolumeOutline(volNum)
    if (!r.ok) return { ok: false, error: r.error }

    if (options.section && options.section !== true) {
      const section = extractSection(r.content, options.section)
      return section
        ? { ok: true, output: section }
        : { ok: false, error: `第${volNum}卷无「${options.section}」小节` }
    }
    return { ok: true, output: r.content }
  }

  return { ok: false, error: '请指定 --总纲 或 --卷=N' }
}
