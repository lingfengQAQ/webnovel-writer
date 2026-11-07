import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as stub from '@deepseek-ai/dsh-client-ui-primitives'

const roots = [
  fileURLToPath(new URL('../src/client', import.meta.url)),
  fileURLToPath(new URL('../../embedding-provider/src', import.meta.url)),
]
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)])

/** Runtime names the client takes from the shell-seeded package (type-only imports excluded). */
function importedNames(): Map<string, string[]> {
  const names = new Map<string, string[]>()
  for (const root of roots) {
    for (const file of walk(root).filter(name => /\.tsx?$/.test(name))) {
      const source = fs.readFileSync(file, 'utf8')
      for (const match of source.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*'@deepseek-ai\/dsh-client-ui-primitives'/g)) {
        if (match[1]) continue
        for (const raw of match[2]!.split(',')) {
          const name = raw.trim()
          if (!name || name.startsWith('type ')) continue
          const imported = name.split(/\s+as\s+/)[0]!
          names.set(imported, [...names.get(imported) ?? [], path.relative(root, file).replaceAll('\\', '/')])
        }
      }
      if (/from\s*'@deepseek-ai\/dsh-client-ui-primitives\//.test(source)) throw new Error(`深导入 ui-primitives 子路径：${file}`)
    }
  }
  return names
}

describe('ui-primitives 单测替身', () => {
  it('客户端从共享包取用的每个运行时名字，替身都提供', () => {
    const names = importedNames()
    expect(names.size).toBeGreaterThan(0)
    const missing = [...names].filter(([name]) => !(name in stub)).map(([name, files]) => `${name}（${files.join('、')}）`)
    expect(missing).toEqual([])
  })
})
