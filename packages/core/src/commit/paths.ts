/**
 * 提交前路径校验(不变量 8):书仓 git 只存本书工件。
 * 拒收知识库正文、配置域、作者层记忆与书仓外路径。
 */

import * as path from 'node:path'

const ALLOWED_TOP = new Set(['定稿', '大纲', '世界书', '账本', '本书记忆', '作品契约', '构想'])
const REJECT_TOP = new Set(['知识库', 'profiles', 'books', '草稿区'])

export type CommitPathCheck =
  | { readonly ok: true; readonly relPath: string }
  | { readonly ok: false; readonly reason: string }

function toPosix(rel: string): string {
  return rel.split(/[\\/]/).join('/')
}

export function checkCommitPath(bookRoot: string, target: string): CommitPathCheck {
  if (path.isAbsolute(target) || /^[a-zA-Z]:/.test(target)) {
    const root = path.resolve(bookRoot)
    const abs = path.resolve(target)
    const rel = path.relative(root, abs)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { ok: false, reason: '提交路径越出书仓根,拒绝' }
    }
    return checkCommitRelPath(toPosix(rel))
  }
  if (target.split(/[\\/]/).includes('..')) {
    return { ok: false, reason: '提交路径含穿越段,拒绝' }
  }
  return checkCommitRelPath(toPosix(target))
}

export function checkCommitRelPath(relPath: string): CommitPathCheck {
  const p = toPosix(relPath).replace(/^\/+/, '')
  if (p === '' || p === '.') return { ok: false, reason: '提交路径不能是书仓根' }
  if (p.split('/').includes('..')) return { ok: false, reason: '提交路径含穿越段,拒绝' }
  const top = p.split('/')[0] ?? ''
  if (top === '知识库' || p.startsWith('知识库/')) {
    return { ok: false, reason: '知识库条目正文不得进入定稿提交' }
  }
  if (top === 'profiles' || p.startsWith('profiles/')) {
    return { ok: false, reason: '配置域路径不得进入书仓提交' }
  }
  if (REJECT_TOP.has(top) && top !== '知识库' && top !== 'profiles') {
    return { ok: false, reason: `路径「${top}/」不得进入定稿提交` }
  }
  if (!ALLOWED_TOP.has(top)) {
    return { ok: false, reason: `路径「${p}」非本书真源,拒绝提交` }
  }
  return { ok: true, relPath: p }
}
