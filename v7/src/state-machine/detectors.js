import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseFrontMatter } from '../storage/parsers/front-matter.js'
import { parseMarkdownTable } from '../storage/parsers/markdown-table.js'
import { BookConfigReader } from '../storage/adapters/BookConfigReader.js'
import { createGit } from '../finalize/git.js'

/**
 * 序0：扫描源文件解析失败。清单钉死于 spec 0.9 §10（实现不得自行增减）：
 * 六目录 front matter + book.yaml + 文风铁律 front matter + 名册表 + 时间线表。
 * 任一清单文件解析失败都不得静默降级为默认值。
 */
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

  // book.yaml：存在但解析失败才算（缺失归序 1 建书态）
  try {
    await fs.access(path.join(repoPath, 'book.yaml'))
    const cfg = await new BookConfigReader(repoPath).read()
    if (!cfg.ok) failures.push({ file: 'book.yaml', error: cfg.error })
  } catch {
    // 无 book.yaml
  }

  // 文风铁律 front matter（文件可选，缺失跳过）
  try {
    const fl = await fs.readFile(path.join(repoPath, '文风', '文风铁律.md'), 'utf8')
    const parsed = parseFrontMatter(fl)
    if (!parsed.ok) failures.push({ file: '文风/文风铁律.md', error: parsed.error })
  } catch {
    // 无文风铁律
  }

  // 名册表（文件可选，缺失跳过；与重建器的软跳过互补——这里是作者面对的修复确认）
  try {
    const roster = await fs.readFile(path.join(repoPath, '定稿', '设定', '名册.md'), 'utf8')
    const t = parseMarkdownTable(roster)
    if (!t.ok) failures.push({ file: '定稿/设定/名册.md', error: t.error })
  } catch {
    // 无名册
  }

  // 时间线表（按卷多文件，目录可选）
  try {
    const tlDir = path.join(repoPath, '定稿', '设定', '时间线')
    for (const f of await fs.readdir(tlDir)) {
      if (!f.endsWith('.md')) continue
      const t = parseMarkdownTable(await fs.readFile(path.join(tlDir, f), 'utf8'))
      if (!t.ok) failures.push({ file: `定稿/设定/时间线/${f}`, error: t.error })
    }
  } catch {
    // 无时间线目录
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

/** 序2：定稿/大纲 下未登记的手改清单（git 工作树未提交改动,含未跟踪新文件）。
 * 供状态机出 dto 变更清单、relink 补登命令圈定 add 范围——检测与执行同源,不双写。 */
export async function listManualEdits(repoPath) {
  try {
    const status = await createGit(repoPath).status()
    const paths = []
    for (const line of status.split('\n').filter(Boolean)) {
      // porcelain 行「XY path」;重命名是「XY old -> new」,两侧都算手改
      for (const p of line.slice(3).split(' -> ')) {
        if (p.startsWith('定稿') || p.startsWith('大纲')) paths.push(p)
      }
    }
    return paths
  } catch {
    return []
  }
}

/** 序2：定稿/大纲 有未登记手改（git 工作树有未提交改动） */
export async function hasManualEdits(repoPath) {
  return (await listManualEdits(repoPath)).length > 0
}

/**
 * 序3 明细：工作区现存的断点工件 + 按 spec §10 续跑映射推断从哪继续（最深工件优先）。
 * 细纲计入——已确认的细纲是作者决策，不得被序 6 重新起草覆盖。
 */
export async function unfinishedWorkDetail(repoPath) {
  const ws = path.join(repoPath, '工作区')
  let files = []
  try {
    files = await fs.readdir(ws)
  } catch {
    files = []
  }
  const 现存 = files.filter(
    (f) => f.startsWith('草稿') || f === '审稿.md' || f === '细纲.md' || f === '本章写作材料.md'
  )
  try {
    if ((await fs.readdir(path.join(ws, '待定稿'))).length) 现存.push('待定稿/')
  } catch {
    // 无待定稿
  }
  const 从哪继续 = 现存.includes('待定稿/')
    ? '待定稿批次续跑'
    : 现存.includes('审稿.md')
      ? '等作者裁决（接受/改完接受/打回）'
      : 现存.some((f) => f.startsWith('草稿'))
        ? '机检与两审'
        : 现存.includes('本章写作材料.md')
          ? '写稿'
          : 现存.includes('细纲.md')
            ? '出示细纲请作者过目，然后备料'
            : ''
  return { 现存, 从哪继续 }
}

/** 序3：工作区有未完成流程（细纲/材料/草稿/审稿/待定稿批次，spec 0.9 §10 续跑映射） */
export async function hasUnfinishedWork(repoPath) {
  return (await unfinishedWorkDetail(repoPath)).现存.length > 0
}

/** 序4 辅助：该卷的卷摘要已存在 = 卷复盘已完成（防复盘后重复触发） */
export async function volumeReviewDone(repoPath, volumeNum) {
  const nn = String(volumeNum).padStart(2, '0')
  try {
    await fs.access(path.join(repoPath, '定稿', '摘要', '卷摘要', `第${nn}卷.md`))
    return true
  } catch {
    return false
  }
}
