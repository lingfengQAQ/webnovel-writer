import path from 'node:path'
import fs from 'node:fs'
import { currentBookProvenance } from '../repo/lock'
import { contentHash, stableJson } from '../commit/receipt'
import { ReadonlyBookSnapshot, type ReadonlyDirectoryEntry } from './snapshot'

export const UPGRADE_RECEIPT_DIR = '草稿区/.maintenance-receipts'
export const UPGRADE_ROOTS = ['作品契约', '构想', '大纲', '世界书', '账本', '本书记忆', '定稿', '草稿区'] as const

/** Only rule-produced source bytes can be overlaid. Physical inputs are still observed. */
export class UpgradeReader extends ReadonlyBookSnapshot {
  constructor(root: string, private readonly overlay: ReadonlyMap<string, string> = new Map(), private readonly ownedOperation?: string) {
    super(root)
  }

  override readFile(relative: string): string | undefined {
    const original = super.readFile(relative)
    return this.overlay.has(relative) ? this.overlay.get(relative) : original
  }

  override listDirectory(relative: string): readonly ReadonlyDirectoryEntry[] | undefined {
    let entries = super.listDirectory(relative)
    if (relative === '.webnovel' && this.ownedOperation !== undefined) {
      const held = currentBookProvenance(this.root)
      const ownerText = super.readFile('.webnovel/book.lock')
      let owned = false
      try {
        const owner = JSON.parse(ownerText ?? 'null') as { operationId?: unknown; pid?: unknown; token?: unknown } | null
        const mutex = super.listDirectory('.webnovel/writer.lock')
        const mutexText = mutex?.length === 1 && mutex[0]?.kind === 'file' && /^owner-[a-f0-9-]+\.json$/.test(mutex[0].name)
          ? super.readFile(`.webnovel/writer.lock/${mutex[0].name}`) : undefined
        owned = held?.operationId === this.ownedOperation && owner?.operationId === this.ownedOperation && owner?.pid === process.pid
          && typeof owner?.token === 'string' && mutexText === ownerText
      } catch { /* Unknown lock evidence remains visible and blocks. */ }
      if (owned) entries = entries?.filter(entry => !['book.lock', 'writer.lock'].includes(entry.name))
    }
    const additions = [...this.overlay.keys()].filter(file => path.posix.dirname(file) === relative)
    if (additions.length === 0) return entries
    const merged = new Map((entries ?? []).map(entry => [entry.name, entry]))
    for (const file of additions) if (!merged.has(path.posix.basename(file))) merged.set(path.posix.basename(file), { name: path.posix.basename(file), kind: 'file' })
    return [...merged.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  }
}

export interface UpgradeInventory {
  readonly files: ReadonlyMap<string, string>
  readonly directories: readonly string[]
  readonly fingerprint: string
}

/** Runtime locks/audit and Git internals have their own validators; source membership never omits ignored drafts. */
export function readUpgradeInventory(reader: ReadonlyBookSnapshot): UpgradeInventory {
  const files = new Map<string, string>()
  const directories: string[] = []
  const walk = (relative: string): void => {
    const entries = reader.listDirectory(relative)
    if (entries === undefined) return
    directories.push(relative)
    for (const entry of entries) {
      const file = `${relative}/${entry.name}`
      if (file === UPGRADE_RECEIPT_DIR) continue
      if (entry.kind === 'directory') walk(file)
      else {
        const value = reader.readFile(file)
        if (value !== undefined) files.set(file, value)
      }
    }
  }
  reader.listDirectory('')
  for (const root of UPGRADE_ROOTS) walk(root)
  for (const relative of ['.gitignore', '.gitattributes']) {
    const value = reader.readFile(relative)
    if (value !== undefined) files.set(relative, value)
  }
  return { files, directories: directories.sort(), fingerprint: upgradeInventoryFingerprint(files, directories) }
}

export function upgradeInventoryFingerprint(files: ReadonlyMap<string, string>, directories: readonly string[]): string {
  return contentHash(stableJson({ files: Object.fromEntries([...files].map(([file, text]) => [file, contentHash(text)])), directories: [...directories].sort() }))
}

export function upgradeRootIdentity(root: string): string {
  const stat = fs.lstatSync(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('书仓根必须为独立普通目录')
  const physical = fs.realpathSync.native(root)
  return `${process.platform === 'win32' ? physical.toLowerCase() : physical}:${stat.dev}:${stat.ino}`
}
