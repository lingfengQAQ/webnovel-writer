import { EntityReader } from '../storage/adapters/EntityReader.js'
import path from 'node:path'

export async function execute(args, options) {
  const alias = args[0]
  if (!alias) {
    console.error('请指定别名')
    process.exit(1)
  }

  const repoPath = process.cwd()
  const reader = new EntityReader(repoPath)

  const result = await reader.resolveAlias(alias)
  if (result.ok) {
    console.log(result.canonicalName)
  } else {
    console.error(result.error)
    process.exit(1)
  }
}
