import { promises as fs } from 'node:fs'
import path from 'node:path'
import { serializeYAML } from '../storage/serializers/yaml-dialect.js'
import { parseFrontMatter } from '../storage/parsers/front-matter.js'

/**
 * AI 态产物回流落盘（M3 落盘,AI 不碰文件）。AI 提交结构化 DTO,本层映射到路径写出。
 * 与 dto.js（读侧组装）对称。
 */

async function writeFile(repoPath, rel, content) {
  const full = path.join(repoPath, rel)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, content, 'utf8')
  return rel
}

/** 序6 起草细纲 → 工作区/细纲.md */
export async function persistDraftOutline(ctx, { 细纲 }) {
  try {
    const rel = await writeFile(ctx.repoPath, path.join('工作区', '细纲.md'), 细纲)
    return { ok: true, written: [rel], error: '' }
  } catch (err) {
    return { ok: false, written: [], error: `落盘细纲失败：${err.message}` }
  }
}

/** 序1 建书 → book.yaml + 大纲/总纲.md + 大纲/第01卷.md */
export async function persistCreateBook(ctx, { book, 总纲, 卷纲 }) {
  try {
    const written = []
    written.push(await writeFile(ctx.repoPath, 'book.yaml', serializeYAML(book)))
    written.push(await writeFile(ctx.repoPath, path.join('大纲', '总纲.md'), 总纲))
    written.push(await writeFile(ctx.repoPath, path.join('大纲', '第01卷.md'), 卷纲))
    return { ok: true, written, error: '' }
  } catch (err) {
    return { ok: false, written: [], error: `建书落盘失败：${err.message}` }
  }
}

/** 序4 卷复盘 → 定稿/摘要/卷摘要/NN.md + 大纲/第{卷号+1}卷.md（+ 可选伏笔条目） */
export async function persistVolumeReview(ctx, { 卷号, 卷摘要, 下卷卷纲, 伏笔条目 = [] }) {
  try {
    const written = []
    const nn = String(卷号).padStart(2, '0')
    written.push(await writeFile(ctx.repoPath, path.join('定稿', '摘要', '卷摘要', `${nn}.md`), 卷摘要))
    if (下卷卷纲) {
      const next = String(卷号 + 1).padStart(2, '0')
      written.push(await writeFile(ctx.repoPath, path.join('大纲', `第${next}卷.md`), 下卷卷纲))
    }
    for (const e of 伏笔条目) {
      const body = `---\n${serializeYAML(e.frontMatter || {})}\n---\n${e.body || ''}`
      written.push(await writeFile(ctx.repoPath, path.join('大纲', '伏笔', `${e.id}.md`), body))
    }
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
  const written = []
  for (const r of repairs) {
    if (!allowedFiles.includes(r.file)) {
      return { ok: false, written, error: `拒绝写入非失败清单文件：${r.file}` }
    }
    const parsed = parseFrontMatter(r.content)
    if (!parsed.ok) {
      return { ok: false, written, error: `修复内容仍解析失败（${r.file}）：${parsed.error}` }
    }
  }
  for (const r of repairs) {
    written.push(await writeFile(ctx.repoPath, r.file, r.content))
  }
  return { ok: true, written, error: '' }
}
