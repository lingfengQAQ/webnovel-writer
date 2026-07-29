import { prepareChapterMaterials } from '../prep/index.js'
import { parsePositiveInt } from '../util/positive-int.js'

/**
 * prepare-chapter <章号> → 组装并写出 工作区/本章写作材料.md（备料，零 AI）
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const chapterNum = parsePositiveInt(args[0])
  if (chapterNum === null) {
    return { ok: false, error: '章号必须是数字（正整数）' }
  }
  const r = await prepareChapterMaterials(ctx, { chapterNum })
  return r.ok ? { ok: true, output: `已写出 ${r.filePath}` } : { ok: false, error: r.error }
}
