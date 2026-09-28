import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { authorDocumentPath, canonicalizePath } from '@webnovel/core'

/** Bind author approval to actual bytes, including absence, never manifest claims. */
export function captureApprovalFiles(root: string, relatives: readonly string[], request: unknown):
  { ok: true; fingerprint: string } | { ok: false; reason: string } {
  try {
    const files: Array<[string, string | null]> = []
    const visit = (relative: string): void => {
      const target = authorDocumentPath(root, relative)
      try {
        const stat = fs.statSync(target)
        if (stat.isDirectory()) {
          const names = fs.readdirSync(target).sort()
          files.push([relative + '/', JSON.stringify(names)])
          for (const name of names) visit(path.posix.join(relative, name))
        } else if (stat.isFile()) {
          files.push([relative, createHash('sha256').update(fs.readFileSync(target)).digest('hex')])
        } else throw new Error(`不是普通文件或目录：${relative}`)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') { files.push([relative, null]); return }
        throw error
      }
    }
    for (const relative of [...new Set(relatives)].sort()) visit(relative)
    return { ok: true, fingerprint: createHash('sha256').update(JSON.stringify([canonicalizePath(root), request, files])).digest('hex') }
  } catch (error) {
    return { ok: false, reason: `无法核对作者裁决内容：${error instanceof Error ? error.message : String(error)}` }
  }
}
