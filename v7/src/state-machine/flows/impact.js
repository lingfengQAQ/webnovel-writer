import { promises as fs } from 'node:fs'
import path from 'node:path'
import { BookConfigReader } from '../../storage/adapters/BookConfigReader.js'

/**
 * 影响分析（spec §9，纯脚本）：grep 正文 + 条目履历 + 时间线，列引用清单；
 * 按 book.yaml `已发布到章`（默认 0）把正文命中分「已发布/未发布」两清单。
 * @param {{repoPath: string}} ctx
 * @param {{关键词: string}} args
 */
export async function analyzeImpact(ctx, { 关键词 } = {}) {
  if (!关键词) return { ok: false, error: '请提供要分析影响的关键词或实体名' }
  const { repoPath } = ctx

  const 正文章号 = []
  for (const f of await listMd(path.join(repoPath, '定稿', '正文'))) {
    if ((await fs.readFile(f, 'utf8')).includes(关键词)) {
      const num = parseInt(path.basename(f).match(/\d+/)?.[0] || '0', 10)
      if (num) 正文章号.push(num)
    }
  }

  const 履历命中 = []
  for (const f of await walkMd(path.join(repoPath, '大纲'))) {
    if ((await fs.readFile(f, 'utf8')).includes(关键词)) 履历命中.push(path.relative(repoPath, f))
  }

  const 时间线命中 = []
  for (const f of await listMd(path.join(repoPath, '定稿', '设定', '时间线'))) {
    if ((await fs.readFile(f, 'utf8')).includes(关键词)) 时间线命中.push(path.relative(repoPath, f))
  }

  const config = await new BookConfigReader(repoPath).read()
  const 已发布到章 = (config.ok && config.data.已发布到章) || 0
  const chapters = [...new Set(正文章号)].sort((a, b) => a - b)
  return {
    ok: true,
    关键词,
    已发布: chapters.filter((c) => c <= 已发布到章),
    未发布: chapters.filter((c) => c > 已发布到章),
    履历命中,
    时间线命中,
  }
}

async function listMd(dir) {
  try {
    return (await fs.readdir(dir)).filter((f) => f.endsWith('.md')).map((f) => path.join(dir, f))
  } catch {
    return []
  }
}

async function walkMd(dir) {
  let out = []
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out = out.concat(await walkMd(full))
    else if (e.name.endsWith('.md')) out.push(full)
  }
  return out
}
