import { promises as fs } from 'node:fs'
import path from 'node:path'
import { loadBooks } from '../session/index.js'

/**
 * 工作目录定位（story-repo-spec §2.0,M5 B2）。只判定,不建缓存——bin 按返回的 plan 组 ctx。
 * 三分支：书仓库直启（兼容开发/测试）/ 工作目录按当前书解析 / 无处可依人话提示。
 *
 * scope（命令模块可选导出,缺省 'book'）：
 * - 'book'            需要书仓库（repoPath + cache）
 * - 'workdir'         需要工作目录（.webnovel/ 存在）
 * - 'workdir-or-book' 书仓库直启优先,否则工作目录（persist-book：建新书时书目录还不存在）
 * - 'anywhere'        当前目录即工作目标,自行校验（init：装出 .webnovel/ 之前就要能跑）
 *
 * @returns {Promise<
 *   | {mode:'book', repoPath:string, workdir:null}
 *   | {mode:'workdir', workdir:string}
 *   | {mode:'workdir-book', workdir:string, repoPath:string, book:object}
 *   | {mode:'workdir-no-book', workdir:string, message:string}
 *   | {mode:'error', message:string}>}
 */
export async function resolveRunContext(cwd, { scope = 'book' } = {}) {
  if (scope === 'anywhere') return { mode: 'workdir', workdir: cwd }

  const hasBookYaml = await exists(path.join(cwd, 'book.yaml'))
  const hasWebnovel = await exists(path.join(cwd, '.webnovel'))

  if (scope === 'workdir') {
    if (!hasWebnovel) return { mode: 'error', message: NOT_WORKDIR }
    return { mode: 'workdir', workdir: cwd }
  }

  if (scope === 'workdir-or-book') {
    if (hasBookYaml) return { mode: 'book', repoPath: cwd, workdir: null }
    if (hasWebnovel) return { mode: 'workdir', workdir: cwd }
    return { mode: 'error', message: NOWHERE }
  }

  // scope === 'book'
  if (hasBookYaml) return { mode: 'book', repoPath: cwd, workdir: null }
  if (hasWebnovel) {
    const { books } = await loadBooks(cwd)
    const current = books.find((b) => b.当前)
    if (!current) {
      const message = books.length
        ? `尚未选择当前书（候选：${books.map((b) => b.书名).join('、')}）。运行 switch-book <书名> 选一本。`
        : '工作目录还没有书。对 AI 说「建书」开始第一本。'
      return { mode: 'workdir-no-book', workdir: cwd, message }
    }
    const repoPath = path.join(cwd, current.目录)
    if (!(await exists(path.join(repoPath, 'book.yaml')))) {
      return {
        mode: 'workdir-no-book',
        workdir: cwd,
        message: `登记的当前书《${current.书名}》在 ${current.目录}/ 里找不到 book.yaml。运行 list-books 核对书单,或 switch-book 换一本。`,
      }
    }
    return { mode: 'workdir-book', workdir: cwd, repoPath, book: current }
  }
  return { mode: 'error', message: NOWHERE }
}

const NOT_WORKDIR = '这里不是 webnovel-writer 工作目录（缺 .webnovel/）。请到装好的工作目录里运行;还没安装先跑 webnovel-writer init。'
const NOWHERE =
  '请从工作目录启动（目录下应有 .webnovel/）,或在书仓库根目录（含 book.yaml）运行。还没安装先跑 webnovel-writer init。'

async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
