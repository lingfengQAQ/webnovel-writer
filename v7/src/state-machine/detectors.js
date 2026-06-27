import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseFrontMatter } from '../storage/parsers/front-matter.js'
import { createGit } from '../finalize/git.js'

/** 序0：扫描源文件 front matter 解析失败 */
export async function detectParseFailures(repoPath) {
  const subs = [
    '定稿/正文',
    '大纲/伏笔',
    '大纲/悬念',
    '大纲/感情线',
    '定稿/设定/角色',
    '定稿/设定/信息差',
  ]
  const failures = []
  for (const sub of subs) {
    const base = path.join(repoPath, sub)
    let files
    try {
      files = await fs.readdir(base)
    } catch {
      continue
    }
    for (const f of files) {
      if (!f.endsWith('.md')) continue
      const parsed = parseFrontMatter(await fs.readFile(path.join(base, f), 'utf8'))
      if (!parsed.ok) failures.push({ file: `${sub}/${f}`, error: parsed.error })
    }
  }
  return failures
}

/** 序1：无 book.yaml（当前目录还没有书） */
export async function bookMissing(repoPath) {
  try {
    await fs.access(path.join(repoPath, 'book.yaml'))
    return false
  } catch {
    return true
  }
}

/** 序2：定稿/大纲 有未登记手改（git 工作树有未提交改动） */
export async function hasManualEdits(repoPath) {
  try {
    const status = await createGit(repoPath).status()
    return status
      .split('\n')
      .filter(Boolean)
      .some((l) => {
        const p = l.slice(3)
        return p.startsWith('定稿') || p.startsWith('大纲')
      })
  } catch {
    return false
  }
}

/** 序3：工作区有未完成流程（草稿/审稿/待定稿批次） */
export async function hasUnfinishedWork(repoPath) {
  const ws = path.join(repoPath, '工作区')
  let files
  try {
    files = await fs.readdir(ws)
  } catch {
    return false
  }
  if (files.some((f) => f.startsWith('草稿') || f === '审稿.md')) return true
  try {
    const batch = await fs.readdir(path.join(ws, '待定稿'))
    if (batch.length) return true
  } catch {
    // 无待定稿
  }
  return false
}
