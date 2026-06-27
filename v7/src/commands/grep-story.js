import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * grep-story <关键词>（R4 补 --regex=<pattern>）→ JSON 数组（章号、匹配行、上下文）
 * 全文检索 定稿/正文/*.md。契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const keyword = args[0]
  if (!keyword) {
    return { ok: false, error: '请指定检索关键词' }
  }

  const dir = path.join(ctx.repoPath, '定稿', '正文')
  let files = []
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md')).sort()
  } catch {
    return { ok: true, output: JSON.stringify([], null, 2) }
  }

  const hits = []
  for (const file of files) {
    const num = parseInt(file.match(/\d+/)?.[0] || '0', 10)
    const content = await fs.readFile(path.join(dir, file), 'utf8')
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(keyword)) {
        hits.push({
          章号: num,
          匹配行: lines[i].trim(),
          上下文: lines.slice(Math.max(0, i - 1), i + 2).join(' ').trim(),
        })
      }
    }
  }
  return { ok: true, output: JSON.stringify(hits, null, 2) }
}
