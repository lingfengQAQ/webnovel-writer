/**
 * 建书动作(PRD §3.2 / 插件规格 §5):控制点＋原子服务,非节点。
 * 前置:书名合法 ∧ 无同名;失败全清,零残留。R20:书建在工作范围下。
 * R16:不写登记文件(书目录由扫描发现,§2.3);书id 生成并写入契约 frontmatter(§3.1)。
 * N2 修复:建书前校验构想完整度与确认状态(checkConceptCompleteness)，若未提供完整确认构想则拒绝建书。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { formatCommitMessage } from '../commit/message'
import { assertSegment, validateSegment } from '../repo/paths'
import { removeSync } from '../repo/remove'
import { scaffoldBookFiles } from './scaffold'
import { scanWorkspaceBooks } from './identity'
import { withBookLock } from '../repo/lock'
import { checkConceptCompleteness, type Concept } from '../inspire/concept'

export interface CreateBookInput {
  /** 工作范围根(R20:书建在其下)。 */
  readonly workspaceRoot: string
  readonly 书名: string
  /** 建书构想(N2: 必填且须已确认完整)。 */
  readonly concept: Concept
}

export type CreateBookResult =
  | { readonly ok: true; readonly bookRoot: string; readonly bookId: string; readonly commit: string }
  | { readonly ok: false; readonly reason: string }

const FIRST_COMMIT = formatCommitMessage({ prefix: 'vol', summary: '建书' })

/** 书id 生成:确定性(同一书名恒同 id),ASCII 短标识,不随改名漂移(格式规格 §2.3)。 */
export function generateBookId(书名: string): string {
  let h = 5381
  for (const ch of 书名) {
    h = ((h << 5) + h + ch.codePointAt(0)!) >>> 0 // djb2
  }
  return `b-${h.toString(36)}`
}

/** 兼容旧名(旧实现返回书名本身;新代码用 generateBookId)。 */
export function bookIdFromName(书名: string): string {
  return generateBookId(书名)
}

export function createBook(input: CreateBookInput): CreateBookResult {
  if (validateSegment(input.书名).length > 0) {
    try { assertSegment(input.书名, '书名') } catch (err) {
      return { ok: false, reason: String(err) }
    }
  }

  if (input.书名.normalize('NFC') === '书房') return { ok: false, reason: '书房是共享资料保留目录，请换一个书名' }

  const { workspaceRoot } = input
  if (!fs.existsSync(workspaceRoot) || !fs.statSync(workspaceRoot).isDirectory()) {
    return { ok: false, reason: '工作范围不存在' }
  }

  const bookRoot = path.join(workspaceRoot, input.书名)
  if (fs.existsSync(bookRoot)) {
    return { ok: false, reason: `目标目录已存在:${bookRoot}` }
  }

  // N2: 严格校验构想完整性与确认状态
  const completeness = checkConceptCompleteness(input.concept)
  if (!completeness.ok) {
    return { ok: false, reason: `构想未确认或未完整,拒绝建书(缺失: ${completeness.gaps.join(', ')})` }
  }

  try {
    return withBookLock(workspaceRoot, () => {
      const bookId = generateBookId(input.书名)
      if (scanWorkspaceBooks(workspaceRoot).some(book => book.bookId === bookId)) {
        return { ok: false, reason: `书id已存在或碰撞:${bookId}，请换一个书名；已有书id不会改写` }
      }
      let created = false
      try {
        fs.mkdirSync(bookRoot)
        created = true
        scaffoldBookFiles(bookRoot, input.concept, { bookId })
        const commit = initFirstCommit(bookRoot)
        return { ok: true, bookRoot, bookId, commit }
      } catch (err) {
        if (created) {
          try { removeSync(bookRoot) } catch { /* 尽力清书仓 */ }
        }
        return { ok: false, reason: `建书失败已回滚:${String(err)}` }
      }
    })
  } catch (error) {
    return { ok: false, reason: `建书失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

function initFirstCommit(bookRoot: string): string {
  runGit(bookRoot, ['init'])
  runGit(bookRoot, ['config', 'user.email', 'webnovel-writer@local'])
  runGit(bookRoot, ['config', 'user.name', 'webnovel-writer'])
  runGit(bookRoot, ['config', 'commit.gpgsign', 'false'])
  runGit(bookRoot, ['add', '-A'])
  runGit(bookRoot, ['commit', '-m', FIRST_COMMIT])
  return FIRST_COMMIT
}

function runGit(cwd: string, args: readonly string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8', windowsHide: true })
  if (r.error) throw new Error(`git ${args[0]} 失败:${r.error.message}`)
  if ((r.status ?? 1) !== 0) {
    throw new Error(`git ${args.join(' ')} 失败:${(r.stderr ?? '').trim() || (r.stdout ?? '').trim() || '非零退出'}`)
  }
}
