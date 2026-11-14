import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'

export const baseline = JSON.parse(fs.readFileSync(new URL('../../../dsh-baseline.json', import.meta.url), 'utf8'))

function directories(root) {
  return fs.readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => path.join(root, item.name))
}

/** A validation target is a pinned source, not a claim that its tests passed. */
export function sourceForCommit(commit) {
  const sources = baseline.validationSources
  if (!Array.isArray(sources) || sources.length === 0
    || sources.some(source => !/^[a-f0-9]{40}$/.test(source.commit) || source.tag !== `dsh-v${source.version}` || !Number.isSafeInteger(source.sessionFormat))
    || new Set(sources.map(source => source.commit)).size !== sources.length
    || !sources.some(source => source.commit === baseline.source.commit && source.version === baseline.source.version && source.tag === baseline.source.tag)) {
    throw new Error('DSH validation sources must contain unique exact pins, including the development source')
  }
  const source = sources.find(source => source.commit === commit)
  if (source === undefined) throw new Error(`DSH checkout is not an approved source (${sources.map(source => `${source.tag}: ${source.commit}`).join(', ')}); found ${commit}`)
  return source
}

/** 固定官方 commit 的已构建 checkout；不改源码或安装状态。 */
export function loadSourceHost(input) {
  const root = fs.realpathSync.native(path.resolve(input))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
  const commit = git('rev-parse', 'HEAD')
  const source = sourceForCommit(commit)
  if (git('status', '--porcelain', '--untracked-files=no') !== '') throw new Error('DSH source has tracked changes; use the unmodified baseline checkout')
  const packages = new Map()
  const candidates = [
    ...directories(path.join(root, 'vendor')),
    ...directories(path.join(root, 'packages')).flatMap(directories),
    ...directories(path.join(root, 'apps')),
  ]
  for (const directory of candidates) {
    const file = path.join(directory, 'package.json')
    if (!fs.existsSync(file)) continue
    const metadata = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (metadata.name.startsWith('@deepseek-ai/dsh') && metadata.version !== source.version) throw new Error(`DSH package version mismatch: ${metadata.name}; expected ${source.version}`)
    packages.set(metadata.name, { directory, metadata })
  }
  const get = name => {
    const pkg = packages.get(name)
    if (pkg === undefined) throw new Error(`DSH source package missing: ${name}`)
    return pkg
  }
  const entry = name => {
    const pkg = get(name)
    if (typeof pkg.metadata.main !== 'string') throw new Error(`DSH package has no main entry: ${name}`)
    const file = path.resolve(pkg.directory, pkg.metadata.main)
    if (!fs.existsSync(file)) throw new Error(`DSH build missing: ${file}; run npm run build:lib:host in the checkout`)
    return file
  }
  const typePaths = {}
  for (const [name, pkg] of packages) {
    if (typeof pkg.metadata.types === 'string') {
      const file = path.resolve(pkg.directory, pkg.metadata.types)
      if (fs.existsSync(file)) typePaths[name] = [file]
    }
    for (const [subpath, definition] of Object.entries(pkg.metadata.exports ?? {})) {
      if (!subpath.startsWith('.') || typeof definition?.types !== 'string') continue
      const file = path.resolve(pkg.directory, definition.types)
      if (fs.existsSync(file)) typePaths[subpath === '.' ? name : name + subpath.slice(1)] = [file]
    }
  }
  return { root, commit, get, entry, typePaths, version: source.version }
}
