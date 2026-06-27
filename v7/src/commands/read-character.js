import { EntityReader } from '../storage/adapters/EntityReader.js'
import path from 'node:path'

export async function execute(args, options) {
  const name = args[0]
  if (!name) {
    console.error('请指定角色正名')
    process.exit(1)
  }

  const repoPath = process.cwd()
  const reader = new EntityReader(repoPath)

  if (options['front-matter']) {
    const result = await reader.readCharacterFrontMatter(name)
    if (result.ok) {
      console.log(JSON.stringify(result.data, null, 2))
    } else {
      console.error(result.error)
      process.exit(1)
    }
  } else {
    const result = await reader.readCharacterFull(name)
    if (result.ok) {
      console.log(JSON.stringify({ frontMatter: result.frontMatter, body: result.body }, null, 2))
    } else {
      console.error(result.error)
      process.exit(1)
    }
  }
}
