import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { restoreNoticeLineEndings } from '../release-source.mjs'

test('notice normalization restores only CRLF differences and leaves real edits visible', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scriptor-notice-eol-'))
  const git = args => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' })
  const files = ['packages/bundle/licenses/example--1.0.0.txt', 'packages/bundle/licenses/changed--1.0.0.txt', 'README.md']
  try {
    git(['init']); git(['config', 'core.autocrlf', 'false'])
    git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.com'])
    git(['config', 'commit.gpgsign', 'false'])
    for (const file of files) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), 'Original\nLicense\n') }
    git(['add', '.']); git(['commit', '-m', 'fixture'])
    fs.writeFileSync(path.join(root, files[0]), 'Original\r\nLicense\r\n')
    fs.writeFileSync(path.join(root, files[1]), 'Changed\r\nLicense\r\n')
    fs.writeFileSync(path.join(root, files[2]), 'Original\r\nLicense\r\n')
    restoreNoticeLineEndings(root)
    assert.equal(fs.readFileSync(path.join(root, files[0]), 'utf8'), 'Original\nLicense\n')
    assert.equal(fs.readFileSync(path.join(root, files[1]), 'utf8'), 'Changed\r\nLicense\r\n')
    assert.equal(fs.readFileSync(path.join(root, files[2]), 'utf8'), 'Original\r\nLicense\r\n')
  } finally {
    const remove = directory => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const file = path.join(directory, entry.name); if (entry.isDirectory()) remove(file); else { fs.chmodSync(file, 0o666); fs.unlinkSync(file) } } fs.rmdirSync(directory) }
    remove(root)
  }
})
