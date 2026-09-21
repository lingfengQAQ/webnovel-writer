import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

export const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
export function releaseVersion(directory = root, tag) {
  const bundle = JSON.parse(fs.readFileSync(path.join(directory, 'packages/bundle/package.json'), 'utf8'))
  const workspace = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
  const meta = JSON.parse(fs.readFileSync(path.join(directory, 'packages/meta/package.json'), 'utf8'))
  assert.match(bundle.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-z]+\.[1-9]\d*)?$/)
  assert.equal(workspace.version, bundle.version, 'Workspace and main release version must agree')
  assert.equal(meta.version, bundle.version, 'Full and main release version must agree')
  assert.equal(bundle.name, '@linfengqaqtat/dsh-scriptor')
  const expectedTag = `scriptor-v${bundle.version}`
  if (tag) assert.equal(tag, expectedTag, 'Release tag must match the package version')
  const changelog = fs.readFileSync(path.join(directory, 'CHANGELOG.md'), 'utf8')
  assert.ok(changelog.includes(`## [${bundle.version}]`), 'Missing versioned changelog entry')
  for (const file of ['README.md', 'packages/bundle/README.md', 'packages/meta/README.md', 'packages/meta/RELEASE_NOTES.md', 'docs/user/install.md', 'docs/user/upgrade-backup.md']) {
    const text = fs.readFileSync(path.join(directory, file), 'utf8')
    for (const match of text.matchAll(/linfengqaqtat-dsh-scriptor-([\d][\w.-]*)\.tgz/g)) {
      assert.equal(match[1], bundle.version, `Stale installation example in ${file}`)
    }
    for (const match of text.matchAll(/releases\/tag\/scriptor-v([\d][\w.-]*)/g)) {
      assert.equal(match[1], bundle.version, `Stale download link in ${file}`)
    }
    for (const match of text.matchAll(/dsh-scriptor(?:-full)?@(\d+[\w.-]*)/g)) {
      assert.equal(match[1], bundle.version, `Stale registry installation example in ${file}`)
    }
  }
  return { version: bundle.version, tag: expectedTag, prerelease: bundle.version.includes('-'),
    packageName: bundle.name, filename: `linfengqaqtat-dsh-scriptor-${bundle.version}.tgz` }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify(releaseVersion(root, process.env.RELEASE_TAG), null, 2))
}
