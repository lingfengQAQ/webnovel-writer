import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

export const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
/** Check current instructions while retaining explicit historical tables and screenshot provenance. */
export function checkCurrentInstructions(text, file, version, hostVersion) {
  let historical = false
  for (const line of text.split(/\r?\n/)) {
    if (/^## /.test(line)) historical = /历史/.test(line)
    if (historical || /^>.*截图/.test(line) || /^\| \d/.test(line) || /^(?:> )?(?:图中|截图|历史截图|!\[)/.test(line)) continue
    const plain = line.replace(/[*`]/g, '')
    for (const match of plain.matchAll(/(?:Scriptor|当前主包|本次安装包都是|已安装列表显示|写作工作台和检索增强|升级到|更新到)\s*(\d+\.\d+\.\d+)/g)) {
      assert.equal(match[1], version, `Stale current version instruction in ${file}`)
    }
    if (/(?:本版|配套|本次|本页适用|先安装|先升级|安装.*客户端)/.test(plain)) {
      for (const match of plain.matchAll(/DSH\s+(\d+\.\d+\.\d+(?:-[\w.]+)?)/g)) {
        assert.equal(match[1], hostVersion, `Stale current host instruction in ${file}`)
      }
    }
    assert.doesNotMatch(plain, /(?:11\s*个写作技能|设置 → 模型 → (?:嵌入模型|检索辅助模型)|没有把它们搬到插件管理页)/, `Stale current UI instruction in ${file}`)
  }
}

export function releaseVersion(directory = root, tag) {
  const bundle = JSON.parse(fs.readFileSync(path.join(directory, 'packages/bundle/package.json'), 'utf8'))
  const workspace = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
  const meta = JSON.parse(fs.readFileSync(path.join(directory, 'packages/meta/package.json'), 'utf8'))
  assert.match(bundle.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
  assert.equal(workspace.version, bundle.version, 'Workspace and main release version must agree')
  assert.equal(meta.version, bundle.version, 'Full and main release version must agree')
  for (const name of ['embedding-provider', 'companion']) {
    const optional = JSON.parse(fs.readFileSync(path.join(directory, `packages/${name}/package.json`), 'utf8'))
    assert.equal(optional.version, bundle.version, 'All Scriptor release versions must agree')
  }
  assert.equal(bundle.name, '@linfengqaqtat/dsh-scriptor')
  const expectedTag = `scriptor-v${bundle.version}`
  if (tag) assert.equal(tag, expectedTag, 'Release tag must match the package version')
  const changelog = fs.readFileSync(path.join(directory, 'CHANGELOG.md'), 'utf8')
  assert.ok(changelog.includes(`## [${bundle.version}]`), 'Missing versioned changelog entry')
  const documents = ['README.md', 'packages/bundle/README.md', 'packages/meta/README.md', 'packages/meta/RELEASE_NOTES.md',
    'packages/embedding-provider/README.md', 'packages/companion/README.md',
    ...fs.readdirSync(path.join(directory, 'docs/user')).filter(file => file.endsWith('.md')).map(file => `docs/user/${file}`)]
  if (fs.existsSync(path.join(directory, 'docs/maintenance/cli-install.md'))) documents.push('docs/maintenance/cli-install.md')
  for (const file of documents) {
    const text = fs.readFileSync(path.join(directory, file), 'utf8')
    checkCurrentInstructions(text, file, bundle.version, bundle.devDependencies['@deepseek-ai/dsh-llm'])
    for (const match of text.matchAll(/linfengqaqtat-dsh-scriptor-(?:(?:full|retrieval|companion)-)?([\d][\w.-]*)\.tgz/g)) {
      assert.equal(match[1], bundle.version, `Stale installation example in ${file}`)
    }
    for (const match of text.matchAll(/releases\/tag\/scriptor-v([\d][\w.-]*)/g)) {
      assert.equal(match[1], bundle.version, `Stale download link in ${file}`)
    }
    for (const match of text.matchAll(/dsh-scriptor(?:-(?:full|retrieval|companion))?@(\d+[\w.-]*)/g)) {
      assert.equal(match[1], bundle.version, `Stale registry installation example in ${file}`)
    }
  }
  return { version: bundle.version, tag: expectedTag, prerelease: bundle.version.includes('-'),
    packageName: bundle.name, filename: `linfengqaqtat-dsh-scriptor-${bundle.version}.tgz` }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify(releaseVersion(root, process.env.RELEASE_TAG), null, 2))
}
