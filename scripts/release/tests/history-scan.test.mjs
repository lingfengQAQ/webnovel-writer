import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { checkTree } from '../check-public-tree.mjs'

function repository(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scriptor-history-'))
  const git = (...args) => execFileSync('git', ['-c', 'user.name=History test', '-c', 'user.email=history@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
  const put = (name, body) => { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), body) }
  const commit = () => { git('add', '-A'); git('commit', '--quiet', '-m', 'fixture') }
  try { git('init', '--quiet'); git('config', 'core.autocrlf', 'false'); run({ root, git, put, commit }) }
  finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }) }
}

test('history batching handles binary newlines, empty blobs, repeated objects and multiple batches', () => repository(({ root, put, commit }) => {
  put('README.md', 'public')
  put('packages/empty.txt', '')
  put('packages/binary.bin', Buffer.alloc(9 * 1024 * 1024, 10))
  put('packages/another.bin', Buffer.from([255, 0, 10, 13, 0, 255]))
  commit()
  put('packages/copy.bin', Buffer.from([255, 0, 10, 13, 0, 255]))
  commit()
  assert.deepEqual(checkTree(root), { ok: true, files: 5, commits: 2 })
}))

test('deleted credentials remain rejected without disclosing their value', () => repository(({ root, put, commit }) => {
  const secret = 'sk-' + 'a'.repeat(40)
  put('README.md', secret); commit()
  put('README.md', 'clean now'); commit()
  assert.throws(() => checkTree(root), error => error.message.includes('Possible credential in README.md') && !error.message.includes(secret))
  assert.equal(checkTree(root, false).commits, 0)
}))

test('private paths removed from HEAD are still checked in reachable history', () => repository(({ root, put, commit }) => {
  put('README.md', 'public'); put('.trellis/private.md', 'private'); commit()
  fs.unlinkSync(path.join(root, '.trellis/private.md')); fs.rmdirSync(path.join(root, '.trellis')); commit()
  assert.throws(() => checkTree(root), /outside public allowlist/)
}))

test('historical symlinks reject even when HEAD is a regular file', () => repository(({ root, git, put, commit }) => {
  put('README.md', 'public'); put('packages/link.txt', 'target'); commit()
  const oid = git('rev-parse', 'HEAD:packages/link.txt')
  git('update-index', '--cacheinfo', `120000,${oid},packages/link.txt`)
  git('commit', '--quiet', '-m', 'symlink fixture')
  git('update-index', '--cacheinfo', `100644,${oid},packages/link.txt`)
  git('commit', '--quiet', '-m', 'regular again')
  assert.throws(() => checkTree(root), /Non-regular history entry/)
}))
