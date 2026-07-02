import { promises as fs } from 'node:fs'
import path from 'node:path'
import { serializeYAML } from '../storage/serializers/yaml-dialect.js'
import { parseFrontMatter } from '../storage/parsers/front-matter.js'
import { writeAtomicBatch } from '../storage/atomic.js'
import { createGit } from '../finalize/git.js'

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

/** 序1 建书 → book.yaml + 大纲/总纲.md + 大纲/卷纲/第01卷.md + .gitignore + git init + core.quotepath */
export async function persistCreateBook(ctx, { book, 总纲, 卷纲 }) {
  try {
    const gitignore = await buildGitignore(ctx.repoPath, ['.cache/', '工作区/'])
    const written = await writeAtomicBatch(ctx.repoPath, [
      { path: 'book.yaml', content: serializeYAML(book) },
      { path: path.join('大纲', '总纲.md'), content: 总纲 },
      { path: path.join('大纲', '卷纲', '第01卷.md'), content: 卷纲 },
      { path: '.gitignore', content: gitignore },
    ])
    // P0-2：书仓库工程化（spec quality §3.3 钉死建书流程负责 git init + core.quotepath）
    const git = createGit(ctx.repoPath)
    await git.init()
    await git.setQuotepathFalse()
    return { ok: true, written, error: '' }
  } catch (err) {
    return { ok: false, written: [], error: `建书落盘失败：${err.message}` }
  }
}

/** 序4 卷复盘 → 定稿/摘要/卷摘要/第NN卷.md + 大纲/卷纲/第{卷号+1}卷.md（+ 可选伏笔条目） */
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
    return { ok: true, written, error: '' }
  } catch (err) {
    return { ok: false, written: [], error: `卷复盘落盘失败：${err.message}` }
  }
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
    const parsed = parseFrontMatter(r.content)
    if (!parsed.ok) {
      return { ok: false, written: [], error: `修复内容仍解析失败（${r.file}）：${parsed.error}` }
    }
  }
  try {
    const written = await writeAtomicBatch(
      ctx.repoPath,
      repairs.map((r) => ({ path: r.file, content: r.content }))
    )
    return { ok: true, written, error: '' }
  } catch (err) {
    return { ok: false, written: [], error: `修复落盘失败：${err.message}` }
  }
}
