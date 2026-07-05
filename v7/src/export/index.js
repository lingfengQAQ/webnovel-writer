import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ChapterReader } from '../storage/adapters/ChapterReader.js'
import { BookConfigReader } from '../storage/adapters/BookConfigReader.js'
import { sanitizeFileName } from '../util/filename.js'

/**
 * 干净导出（spec §4.7）：去 front matter 纯正文，落 工作区/导出/（不入 git）。
 * 单章无标题行（发布界面标题另填）；范围/全书合并单文件，每章「第N章 标题」行分隔，
 * 章间空两行——批量导入工具按标题行分章。
 * @param {{repoPath: string}} ctx
 * @param {{mode: 'single'|'range'|'all', chapterNum?: number, start?: number, end?: number}} opts
 * @returns {Promise<{ok: boolean, files: string[], output: string, error: string}>}
 */
export async function exportChapters(ctx, opts) {
  const existing = await listFinalizedChapters(ctx.repoPath)
  if (!existing.length) {
    return fail('还没有定稿章节，没有可导出的正文。')
  }

  let nums
  let fileName
  if (opts.mode === 'single') {
    nums = [opts.chapterNum]
  } else if (opts.mode === 'range') {
    if (opts.start > opts.end) {
      return fail(`起章不能大于止章（${opts.start} > ${opts.end}）。`)
    }
    nums = []
    for (let n = opts.start; n <= opts.end; n++) nums.push(n)
  } else {
    nums = existing.map((c) => c.num)
  }

  const byNum = new Map(existing.map((c) => [c.num, c]))
  const missing = nums.filter((n) => !byNum.has(n))
  if (missing.length) {
    return fail(`第 ${missing.join('、')} 章不在定稿区，无法导出。当前定稿到第 ${existing[existing.length - 1].num} 章。`)
  }

  const reader = new ChapterReader(ctx.repoPath)
  const parts = []
  for (const n of nums) {
    const body = await reader.readBody(n)
    if (!body.ok) return fail(`读取第 ${n} 章失败：${body.error}`)
    parts.push({ num: n, title: byNum.get(n).title, body: body.body.trim() })
  }

  let content
  if (opts.mode === 'single') {
    fileName = `第${pad(nums[0])}章-${sanitizeFileName(parts[0].title)}.txt`
    content = `${parts[0].body}\n`
  } else {
    if (opts.mode === 'range') {
      fileName = `第${pad(opts.start)}-${pad(opts.end)}章.txt`
    } else {
      const config = await new BookConfigReader(ctx.repoPath).read()
      const 书名 = config.ok ? config.data.书名 : '未命名'
      fileName = `全书-${sanitizeFileName(书名)}.txt`
    }
    content = parts.map((p) => `第${p.num}章 ${p.title}\n\n${p.body}`).join('\n\n\n') + '\n'
  }

  const outDir = path.join(ctx.repoPath, '工作区', '导出')
  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(path.join(outDir, fileName), content, 'utf8')

  const 章数 = nums.length
  return {
    ok: true,
    files: [fileName],
    output: `已导出 ${章数} 章到 工作区/导出/${fileName}（纯正文，可直接粘贴发布）。`,
    error: '',
  }
}

/** 扫定稿/正文/ 列全部章（升序），文件名 NNNN-标题.md。 */
async function listFinalizedChapters(repoPath) {
  const dir = path.join(repoPath, '定稿', '正文')
  let files
  try {
    files = await fs.readdir(dir)
  } catch {
    return []
  }
  const chapters = []
  for (const f of files) {
    const m = f.match(/^(\d{4})-(.+)\.md$/)
    if (m) chapters.push({ num: Number(m[1]), title: m[2] })
  }
  return chapters.sort((a, b) => a.num - b.num)
}

function pad(n) {
  return String(n).padStart(4, '0')
}

function fail(error) {
  return { ok: false, files: [], output: '', error }
}
