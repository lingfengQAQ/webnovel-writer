/** Synthetic files and deterministic model calls; tools, Session and UI remain real. */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function prepareResultCardDemo(root) {
  const book = path.join(root, '验收作品甲')
  const target = path.join(root, '演示导出')
  const script = fileURLToPath(new URL('../../skills/novel-export/scripts/最小导出.mjs', import.meta.url))
  const run = (...args) => JSON.parse(execFileSync(process.execPath, [script, '--book', book, ...args], { encoding: 'utf8', windowsHide: true }))
  const computed = run()
  if (!computed.ok) throw new Error(JSON.stringify(computed.gaps))
  if (!fs.existsSync(target)) {
    const report = run('--目标', target)
    if (!report.ok) throw new Error(JSON.stringify(report))
    fs.mkdirSync(target)
    for (const file of report.文件) fs.writeFileSync(path.join(target, file.名称), file.content, { flag: 'wx' })
  }
  const verification = run('--目标', target, '--校验', 'true')
  if (!verification.ok) throw new Error(JSON.stringify(verification))
  return [
    ['novel_select_book', { bookId: 'acceptance-a' }],
    ['novel_get_book_progress', { bookId: 'acceptance-a' }],
    ['novel_get_story_status', { bookId: '不存在的书' }],
    ['present', { files: [
      { path: path.join(book, '草稿区/草稿/卷01-来信/稿1.md'), description: '演示草稿 · 来信' },
      { path: path.join(target, computed.合集文件), description: '演示作品 · 已校验定稿合集' },
      { path: path.join(target, computed.清单文件), description: '演示作品 · 来源与版本清单' },
    ] }],
  ]
}

export function* demoToolChunks(index, entry) {
  const [name, args] = entry
  const id = `writing-ui-demo-${index}`
  const raw = JSON.stringify(args)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: raw }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: raw } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}
