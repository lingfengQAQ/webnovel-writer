import { EntityReader } from '../storage/adapters/EntityReader.js'

/**
 * read-character <正名> [--front-matter|--section=<标题>]（默认完整）
 * 契约：纯返回 {ok, output?, error?}（见 design §6.2）。
 */
export async function run(args, options, ctx) {
  const name = args[0]
  if (!name) {
    return { ok: false, error: '请指定角色正名' }
  }

  const reader = new EntityReader(ctx.repoPath, ctx.cache)

  if (options['front-matter']) {
    const r = await reader.readCharacterFrontMatter(name)
    return r.ok ? { ok: true, output: JSON.stringify(r.data, null, 2) } : { ok: false, error: r.error }
  }

  if (options.section) {
    const r = await reader.readCharacterFull(name)
    if (!r.ok) return { ok: false, error: r.error }
    const section = extractSection(r.body, options.section)
    return section
      ? { ok: true, output: section }
      : { ok: false, error: `角色 ${name} 无「${options.section}」小节` }
  }

  // 默认：完整
  const r = await reader.readCharacterFull(name)
  return r.ok
    ? { ok: true, output: JSON.stringify({ frontMatter: r.frontMatter, body: r.body }, null, 2) }
    : { ok: false, error: r.error }
}

// 从正文提取指定 ## 小节
function extractSection(body, title) {
  const lines = body.split('\n')
  let inSection = false
  const out = []
  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (inSection) break
      if (line.includes(title)) {
        inSection = true
        continue
      }
    }
    if (inSection) out.push(line)
  }
  return out.join('\n').trim()
}
