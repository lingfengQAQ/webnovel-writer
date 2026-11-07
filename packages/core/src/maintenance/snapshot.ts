import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { MaintenanceIssue, MaintenanceSnapshot } from './types'

export interface ReadonlyDirectoryEntry {
  readonly name: string
  readonly kind: 'file' | 'directory' | 'other'
}

type Observation = { readonly kind: 'file' | 'directory'; readonly digest: string }
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)
const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT'
const sameFile = (left: fs.Stats, right: fs.Stats): boolean => left.dev === right.dev && left.ino === right.ino

/** An optimistic read set, not a lock or a permanent authorization. */
export class ReadonlyBookSnapshot {
  readonly root: string
  readonly issues: MaintenanceIssue[] = []
  private readonly startedAt = new Date().toISOString()
  private readonly observations = new Map<string, Observation>()
  private readonly changed = new Set<string>()
  private readonly rootIdentity: fs.Stats | undefined

  constructor(root: string) {
    this.root = path.resolve(root)
    try {
      const stat = fs.lstatSync(this.root)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('书仓根须为普通目录，不能是链接')
      this.rootIdentity = stat
    } catch (error) {
      this.problem('', error)
    }
  }

  private problem(relative: string, error: unknown): void {
    const issue = { 代码: 'READ_FAILED', 路径: relative || '.', 说明: `只读检查无法读取：${errorText(error)}` }
    if (!this.issues.some(existing => existing.代码 === issue.代码 && existing.路径 === issue.路径 && existing.说明 === issue.说明)) this.issues.push(issue)
  }

  private target(relative: string): { absolute: string; stat: fs.Stats } | undefined {
    if (this.rootIdentity === undefined) throw new Error('书仓根无法核实')
    const normalized = relative.replace(/\\/g, '/')
    const parts = normalized === '' ? [] : normalized.split('/')
    if (path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || parts.some(part => part === '' || part === '.' || part === '..' || /[\x00-\x1f<>:"|?*]/.test(part))) throw new Error('检查路径须为仓内相对路径')
    let absolute = this.root
    let stat = fs.lstatSync(absolute)
    if (!stat.isDirectory() || stat.isSymbolicLink() || !sameFile(stat, this.rootIdentity)) throw new Error('书仓根在检查期间发生变化')
    for (const [index, part] of parts.entries()) {
      absolute = path.join(absolute, part)
      try { stat = fs.lstatSync(absolute) } catch (error) {
        if (isMissing(error)) return undefined
        throw error
      }
      if (stat.isSymbolicLink()) throw new Error('检查不跟随文件或目录链接')
      if (index < parts.length - 1 && !stat.isDirectory()) throw new Error('检查路径的父项不是目录')
    }
    return { absolute, stat }
  }

  private file(relative: string): { digest: string; value?: Buffer } {
    const target = this.target(relative)
    if (target === undefined) return { digest: 'missing' }
    if (!target.stat.isFile() || target.stat.nlink !== 1) throw new Error('检查目标须为独立普通文件')
    const fd = fs.openSync(target.absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    try {
      const opened = fs.fstatSync(fd)
      const current = this.target(relative)
      if (current === undefined || !sameFile(opened, current.stat) || !sameFile(opened, target.stat) || !opened.isFile() || opened.nlink !== 1) throw new Error('检查文件在打开期间发生变化')
      const value = fs.readFileSync(fd)
      const after = fs.fstatSync(fd)
      if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new Error('检查文件在读取期间发生变化')
      return { digest: `${opened.dev}:${opened.ino}:${hash(value)}`, value }
    } finally { fs.closeSync(fd) }
  }

  private directory(relative: string): { digest: string; value?: readonly ReadonlyDirectoryEntry[] } {
    const target = this.target(relative)
    if (target === undefined) return { digest: 'missing' }
    if (!target.stat.isDirectory()) throw new Error('检查目标不是目录')
    const entries = fs.readdirSync(target.absolute, { withFileTypes: true }).map(entry => ({
      name: entry.name,
      kind: (entry.isFile() ? 'file' : entry.isDirectory() ? 'directory' : 'other') as ReadonlyDirectoryEntry['kind'],
    })).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    const after = this.target(relative)
    if (after === undefined || !sameFile(target.stat, after.stat)) throw new Error('检查目录在读取期间发生变化')
    return { digest: `${target.stat.dev}:${target.stat.ino}:${hash(JSON.stringify(entries))}`, value: entries }
  }

  private observe(relative: string, kind: Observation['kind'], digest: string): void {
    const key = `${kind}:${relative}`
    const previous = this.observations.get(key)
    if (previous !== undefined && previous.digest !== digest) this.changed.add(relative || '.')
    if (previous === undefined) this.observations.set(key, { kind, digest })
  }

  readFile(relative: string): string | undefined {
    try {
      const result = this.file(relative)
      this.observe(relative, 'file', result.digest)
      return result.value === undefined ? undefined : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(result.value)
    } catch (error) {
      this.problem(relative, error)
      return undefined
    }
  }

  listDirectory(relative: string): readonly ReadonlyDirectoryEntry[] | undefined {
    try {
      const result = this.directory(relative)
      this.observe(relative, 'directory', result.digest)
      return result.value
    } catch (error) {
      this.problem(relative, error)
      return undefined
    }
  }

  finish(): MaintenanceSnapshot {
    for (const [key, observation] of this.observations) {
      const relative = key.slice(key.indexOf(':') + 1)
      try {
        const result = observation.kind === 'file' ? this.file(relative) : this.directory(relative)
        if (result.digest !== observation.digest) this.changed.add(relative || '.')
      } catch (error) {
        this.changed.add(relative || '.')
        this.problem(relative, error)
      }
    }
    const changes = [...this.changed].sort()
    for (const relative of changes) {
      if (!this.issues.some(issue => issue.代码 === 'SNAPSHOT_CHANGED' && issue.路径 === relative)) this.issues.push({ 代码: 'SNAPSHOT_CHANGED', 路径: relative, 说明: '检查期间文件或目录已变化，请重新核对' })
    }
    return {
      开始时间: this.startedAt,
      结束时间: new Date().toISOString(),
      指纹: hash(JSON.stringify([...this.observations].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))),
      稳定: this.rootIdentity !== undefined && changes.length === 0 && !this.issues.some(issue => issue.代码 === 'READ_FAILED'),
      文件数: [...this.observations.values()].filter(observation => observation.kind === 'file' && observation.digest !== 'missing').length,
      目录数: [...this.observations.values()].filter(observation => observation.kind === 'directory' && observation.digest !== 'missing').length,
      变更: changes,
    }
  }
}

export function createReadonlyBookSnapshot(root: string): ReadonlyBookSnapshot {
  return new ReadonlyBookSnapshot(root)
}
