import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

/** Restore only CRLF-equivalent generated notices to the public tree's bytes. */
export function restoreNoticeLineEndings(root) {
  const git = args => execFileSync('git', args, { cwd: root, windowsHide: true })
  const files = git(['ls-files', '--modified', '-z']).toString('utf8').split('\0').filter(Boolean)
  for (const filename of files) {
    if (!/^packages\/(bundle|embedding-provider)\/licenses\/[^/]+\.txt$/.test(filename)) continue
    const target = path.join(root, filename)
    if (!fs.existsSync(target) || !fs.lstatSync(target).isFile()) continue
    const original = git(['show', `HEAD:${filename}`])
    const current = fs.readFileSync(target)
    if (current.toString('utf8').replaceAll('\r\n', '\n') === original.toString('utf8')) fs.writeFileSync(target, original)
  }
}
