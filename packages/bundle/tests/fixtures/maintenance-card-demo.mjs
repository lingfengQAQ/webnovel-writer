/** A deterministic adapter plan; every displayed result comes from the actual installed tool. */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const hash = value => createHash('sha256').update(value).digest('hex')
function fileHashes(root) {
  const files = {}
  const visit = relative => {
    const target = path.join(root, relative), stat = fs.lstatSync(target)
    if (stat.isDirectory()) for (const name of fs.readdirSync(target).sort()) visit(relative ? `${relative}/${name}` : name)
    else files[relative] = hash(fs.readFileSync(target))
  }
  visit('')
  return files
}
function lastResult(messages) {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'tool') continue
    for (const item of message.content ?? []) if (item.type === 'text') {
      try { const value = JSON.parse(item.text); if (typeof value?.ok === 'boolean') return value } catch { /* Skip non-business text. */ }
    }
  }
  throw new Error('Maintenance demo cannot locate the preceding actual tool result')
}

export function createMaintenanceCardDemo(workspace) {
  const bookName = '维护升级演示', root = path.join(workspace, bookName), contract = path.join(root, '作品契约/契约.md')
  const hook = path.join(root, '.git/hooks/pre-commit')
  const git = (...args) => execFileSync('git', ['--no-optional-locks', ...args], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
  const report = { bookRoot: root, calls: [], states: [], authorQuestions: 0 }
  let step = 0, bookId, fingerprint, before, baseHead, writtenContract
  const call = (name, args) => { report.calls.push(name); return [name, args] }
  const expectState = (value, state) => {
    if (value.state !== state) throw new Error(`Maintenance demo expected ${state}: ${JSON.stringify(value)}`)
    report.states.push(state)
  }
  return {
    report,
    next(messages) {
      if (step > 7) return undefined
      const stage = step++
      if (stage === 0) return call('novel_create_book', { bookName, concept: { 状态: '已确认', 核心创意: '在旧港找回失踪友人的信件', 题材与目标读者: '悬疑' } })
      const value = lastResult(messages)
      if (stage === 1) {
        if (!value.ok || !value.bookId) throw new Error('Synthetic maintenance demo book was not created')
        bookId = value.bookId
        git('config', 'core.autocrlf', 'false'); git('config', 'core.hooksPath', '.git/hooks')
        fs.writeFileSync(contract, fs.readFileSync(contract, 'utf8').replace(/^书仓格式版本: 1\r?\n/m, ''))
        git('add', '--', '作品契约/契约.md'); git('commit', '--quiet', '-m', 'fixture: unversioned book')
        fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
        before = fileHashes(root); baseHead = git('rev-parse', 'HEAD')
        report.before = before; report.baseHead = baseHead
        return call('novel_preview_book_upgrade', { bookId })
      }
      if (stage === 2) {
        expectState(value, 'ready'); fingerprint = value.fingerprint
        report.previewUnchanged = JSON.stringify(fileHashes(root)) === JSON.stringify(before)
        if (!report.previewUnchanged) throw new Error('Maintenance preview modified synthetic book bytes')
        return call('novel_apply_book_upgrade', { bookId, fingerprint })
      }
      if (stage === 3) {
        expectState(value, 'written-pending-commit')
        writtenContract = fs.readFileSync(contract, 'utf8')
        report.pendingHeadUnchanged = git('rev-parse', 'HEAD') === baseHead
        fs.unlinkSync(hook)
        return call('novel_resume_book_upgrade', { bookId, operationId: fingerprint })
      }
      if (stage === 4) {
        expectState(value, 'committed')
        report.resumePreservedSource = fs.readFileSync(contract, 'utf8') === writtenContract
        report.upgradeCommits = Number(git('rev-list', '--count', `${baseHead}..HEAD`))
        report.completed = fileHashes(root)
        return call('novel_resume_book_upgrade', { bookId, operationId: fingerprint })
      }
      if (stage === 5) {
        expectState(value, 'already-committed')
        report.repeatUnchanged = JSON.stringify(fileHashes(root)) === JSON.stringify(report.completed)
        return call('novel_preview_book_upgrade', { bookId })
      }
      if (stage === 6) {
        expectState(value, 'unchanged')
        const draft = path.join(root, '草稿区/草稿/卷01-正在写/稿1.起草中.txt')
        fs.mkdirSync(path.dirname(draft), { recursive: true }); fs.writeFileSync(draft, '---\n身份: 无法唯一核实的旧身份\n---\n保留待核对的合成测试稿。')
        report.blockedBefore = fileHashes(root)
        return call('novel_preview_book_upgrade', { bookId })
      }
      expectState(value, 'blocked')
      report.blockedUnchanged = JSON.stringify(fileHashes(root)) === JSON.stringify(report.blockedBefore)
      report.finished = report.previewUnchanged && report.pendingHeadUnchanged && report.resumePreservedSource && report.upgradeCommits === 1 && report.repeatUnchanged && report.blockedUnchanged
      if (!report.finished) throw new Error('Maintenance demo byte or commit verification failed')
      return undefined
    },
  }
}
