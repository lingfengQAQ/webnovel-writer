import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'

test('v7 包版本、GPL v3 元数据与随包许可证保持一致', async () => {
  const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const lock = JSON.parse(await fs.readFile(new URL('../package-lock.json', import.meta.url), 'utf8'))
  const [rootLicense, packageLicense] = await Promise.all([
    fs.readFile(new URL('../../LICENSE', import.meta.url), 'utf8'),
    fs.readFile(new URL('../LICENSE', import.meta.url), 'utf8'),
  ])

  assert.equal(pkg.version, lock.version)
  assert.equal(pkg.version, lock.packages[''].version)
  assert.equal(pkg.license, 'GPL-3.0-only')
  assert.equal(lock.packages[''].license, pkg.license)
  assert.ok(pkg.files.includes('LICENSE'))
  assert.deepEqual(
    pkg.files.filter((entry) => entry.startsWith('docs')),
    ['docs/knowledge/', 'docs/migration-guide.md'],
  )
  assert.ok(!pkg.files.some((entry) => entry.includes('story-repo-spec')))
  assert.ok(!pkg.files.includes('docs/'))
  assert.equal(packageLicense, rootLicense)
})
