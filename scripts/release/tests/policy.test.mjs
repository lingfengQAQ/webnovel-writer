import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkPublicPath, checkPublicText, checkMarkdownLinks } from '../check-public-tree.mjs'
import { releaseVersion, root as sourceRoot } from '../version.mjs'

test('public policy rejects private files and permits runtime Markdown', () => {
  for (const file of ['.trellis/prd.md', 'session.jsonl', 'packages/bundle/.env', '../README.md', 'packages/bundle/dsh-local.yml']) assert.throws(() => checkPublicPath(file))
  checkPublicPath('packages/bundle/skills/novel-director/SKILL.md')
  checkPublicPath('docs/user/install.md')
})
test('credential and personal-path checks do not echo their values', () => {
  for (const value of ['sk-' + 'a'.repeat(40), 'ghp_' + 'b'.repeat(40), ['C:', 'Users', 'private', 'book'].join('/')]) {
    assert.throws(() => checkPublicText('README.md', value), error => !error.message.includes(value))
  }
  checkPublicText('example.md', 'API key: <YOUR_API_KEY>')
})
test('release version binds exact tag, package and changelog', () => {
  const value = releaseVersion()
  assert.equal(value.tag, `scriptor-v${value.version}`)
  assert.throws(() => releaseVersion(undefined, 'v6.2.1'))
})

test('version checks every user tutorial and optional package installation example', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scriptor-doc-versions-'))
  const files = ['package.json', 'CHANGELOG.md', 'README.md', 'packages/meta/RELEASE_NOTES.md',
    ...['bundle', 'meta', 'embedding-provider', 'companion'].flatMap(name => [`packages/${name}/package.json`, `packages/${name}/README.md`])]
  try {
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      fs.copyFileSync(path.join(sourceRoot, file), path.join(root, file))
    }
    fs.mkdirSync(path.join(root, 'docs/user'), { recursive: true })
    const tutorial = path.join(root, 'docs/user/another-tutorial.md')
    for (const sample of ['@linfengqaqtat/dsh-scriptor-retrieval@1.0.0', 'linfengqaqtat-dsh-scriptor-companion-1.0.0.tgz']) {
      fs.writeFileSync(tutorial, sample)
      assert.throws(() => releaseVersion(root), /Stale.*example/)
    }
  } finally {
    const remove = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const target = path.join(dir, entry.name); if (entry.isDirectory()) remove(target); else fs.unlinkSync(target) }; fs.rmdirSync(dir) }
    remove(root)
  }
})
test('documentation links cannot escape the exported tree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scriptor-links-'))
  try {
    fs.writeFileSync(path.join(root, 'README.md'), 'ok')
    checkMarkdownLinks(root, 'README.md', '[self](README.md)')
    assert.throws(() => checkMarkdownLinks(root, 'README.md', '[private](../secret.md)'))
    assert.throws(() => checkMarkdownLinks(root, 'README.md', '[missing](missing.md)'))
  } finally { fs.unlinkSync(path.join(root, 'README.md')); fs.rmdirSync(root) }
})
