import { promises as fs } from 'node:fs'
import path from 'node:path'
import { serializeYAML } from '../storage/serializers/yaml-dialect.js'
import { parseFrontMatter } from '../storage/parsers/front-matter.js'
import { parseMarkdownTable } from '../storage/parsers/markdown-table.js'
import { parseBookConfig } from '../storage/parsers/book-config.js'
import { writeAtomicBatch } from '../storage/atomic.js'
import { createGit } from '../finalize/git.js'
import { refreshCacheAfterSourceChange } from '../cache/index.js'

/**
 * AI 态产物回流落盘（M3 落盘,AI 不碰文件）。AI 提交结构化 DTO,本层映射到路径写出。
 * 与 dto.js（读侧组装）对称。多文件写入走 writeAtomicBatch（要么全成要么原样,spec error-handling §3.1）。
 */

/** 读现有 .gitignore，补齐缺失的必需条目，返回合并后内容。 */
async function buildGitignore(repoPath, required) {
  const gi = path.join(repoPath, '.gitignore')
  let existing = ''
  try {
    existing = await fs.readFile(gi, 'utf8')
  } catch {
    // 无 .gitignore
  }
  const lines = existing.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  for (const e of required) {
    if (!lines.includes(e)) lines.push(e)
  }
  return lines.join('\n') + '\n'
}

/** 序6 起草细纲 → 工作区/细纲.md */
export async function persistDraftOutline(ctx, { 细纲 }) {
  try {
    const written = await writeAtomicBatch(ctx.repoPath, [
      { path: path.join('工作区', '细纲.md'), content: 细纲 },
    ])
    return { ok: true, written, error: '' }
  } catch (err) {
    return { ok: false, written: [], error: `落盘细纲失败：${err.message}` }
  }
}

/** 书仓库指路 AGENTS.md（spec §2.1 建书时自动生成；migrate 建仓复用）。内容内嵌：运行时 vendored 副本不带 templates/ */
export function bookAgentsMd(书名) {
  return [
    '# webnovel-writer 书仓库',
    '',
    `本目录是《${书名}》的书仓库（定稿 / 大纲 / 文风 / 工作区）。AI 工具不要在这里启动——各平台壳装在上一层工作目录。`,
    '',
    '- 日常写作：回上一层工作目录启动 agent CLI，对它说「继续」。',
    '- 单独 clone 了本仓库：先在期望的工作目录运行 `npx webnovel-writer init`，把本仓库放进工作目录，再运行 `webnovel-writer list-books` 重建书单。',
    '',
    '事实变更只经定稿流程入 git。',
    '',
  ].join('\n')
}

/** 序1 建书 → book.yaml + 大纲/总纲.md + 大纲/卷纲/第01卷.md + AGENTS.md 指路 + .gitignore + git init + core.quotepath */
export async function persistCreateBook(ctx, { book, 总纲, 卷纲 }) {
  try {
    const gitignore = await buildGitignore(ctx.repoPath, ['.cache/', '工作区/'])
    const written = await writeAtomicBatch(ctx.repoPath, [
      { path: 'book.yaml', content: serializeYAML(book) },
      { path: path.join('大纲', '总纲.md'), content: 总纲 },
      { path: path.join('大纲', '卷纲', '第01卷.md'), content: 卷纲 },
      { path: 'AGENTS.md', content: bookAgentsMd(book?.书名 || '未命名') },
      { path: '.gitignore', content: gitignore },
    ])
    // P0-2：书仓库工程化（spec quality §3.3 钉死建书流程负责 git init + core.quotepath）
    const git = createGit(ctx.repoPath)
    await git.init()
    await git.setQuotepathFalse()
    // 建书产物随手提交（一次性 init 前缀）：否则 next 立刻误触序2 手改检测;身份未配则局部兜底
    await git.ensureIdentity()
    await git.add(written)
    if (await git.hasStagedChanges()) {
      await git.commit(`init: 建书《${book?.书名 || '未命名'}》`)
    }
    return { ok: true, written, error: '' }
  } catch (err) {
    return { ok: false, written: [], error: `建书落盘失败：${err.message}` }
  }
}

/** 序4 卷复盘 → 定稿/摘要/卷摘要/第NN卷.md + 大纲/卷纲/第{卷号+1}卷.md（+ 可选伏笔条目）。
 * 产物随手 commit（`vol(NN): 复盘与下卷规划`,spec §9）——与建书同理,不 commit 会让 next 误触序2 手改检测；
 * 新伏笔条目改了源,同步刷缓存,否则 list-threads/备料/两审要等下次定稿才看得见。 */
export async function persistVolumeReview(ctx, { 卷号, 卷摘要, 下卷卷纲, 伏笔条目 = [] }) {
  try {
    const files = []
    const nn = String(卷号).padStart(2, '0')
    files.push({ path: path.join('定稿', '摘要', '卷摘要', `第${nn}卷.md`), content: 卷摘要 })
    if (下卷卷纲) {
      const next = String(卷号 + 1).padStart(2, '0')
      files.push({ path: path.join('大纲', '卷纲', `第${next}卷.md`), content: 下卷卷纲 })
    }
    for (const e of 伏笔条目) {
      const body = `---\n${serializeYAML(e.frontMatter || {})}\n---\n${e.body || ''}`
      files.push({ path: path.join('大纲', '伏笔', `${e.id}.md`), content: body })
    }
    const written = await writeAtomicBatch(ctx.repoPath, files)
    const git = createGit(ctx.repoPath)
    await git.ensureIdentity()
    await git.add(written)
    if (await git.hasStagedChanges()) {
      await git.commit(`vol(${nn}): 复盘与下卷规划`)
    }
    const cacheRefresh = await refreshCacheAfterSourceChange(ctx)
    return { ok: true, written, cacheRefresh, error: '' }
  } catch (err) {
    return { ok: false, written: [], error: `卷复盘落盘失败：${err.message}` }
  }
}

/**
 * 序0 修复回写的内容校验：按文件类型分派解析器（R3）——
 * 与 detectors.detectParseFailures 的检测器选型一刀对齐：book.yaml 是纯 YAML、
 * 名册/时间线是纯表格，用 parseFrontMatter 一刀切会把合法修复拒之门外，书锁死在序 0。
 */
function validateRepairContent(file, content) {
  const rel = String(file).replaceAll('\\', '/')
  if (rel === 'book.yaml') {
    const r = parseBookConfig(content)
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }
  if (rel === '定稿/设定/名册.md' || rel.startsWith('定稿/设定/时间线/')) {
    const r = parseMarkdownTable(content)
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }
  const r = parseFrontMatter(content)
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}

/**
 * 序0 修复确认 → 写回修复后的源文件。安全网:
 * 只写在 allowedFiles（M3 检测到的失败清单）内的文件;修复内容必须能解析,否则不写。
 */
export async function persistRepair(ctx, { repairs }, { allowedFiles = [] } = {}) {
  for (const r of repairs) {
    if (!allowedFiles.includes(r.file)) {
      return { ok: false, written: [], error: `拒绝写入非失败清单文件：${r.file}` }
    }
    const check = validateRepairContent(r.file, r.content)
    if (!check.ok) {
      return { ok: false, written: [], error: `修复内容仍解析失败（${r.file}）：${check.error}` }
    }
  }
  try {
    const written = await writeAtomicBatch(
      ctx.repoPath,
      repairs.map((r) => ({ path: r.file, content: r.content }))
    )
    // 修复件此前因解析失败不在缓存,写完必须自刷,否则报表/备料继续缺数据。
    // 修复本身不 commit：入档走序2 手改补登（relink）,与 spec §9 的手改通道一致。
    const cacheRefresh = await refreshCacheAfterSourceChange(ctx)
    return { ok: true, written, cacheRefresh, error: '' }
  } catch (err) {
    return { ok: false, written: [], error: `修复落盘失败：${err.message}` }
  }
}
