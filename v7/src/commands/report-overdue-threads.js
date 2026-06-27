import { ThreadLedgerReader } from '../storage/adapters/ThreadLedgerReader.js'
import { BookConfigReader } from '../storage/adapters/BookConfigReader.js'
import { CacheManager } from '../cache/index.js'
import path from 'node:path'

export async function execute(args, options) {
  const repoPath = process.cwd()
  const cache = new CacheManager(path.join(repoPath, '.cache', 'index.db'))
  await cache.ensureReady(repoPath)

  const threadReader = new ThreadLedgerReader(repoPath, cache)
  const configReader = new BookConfigReader(repoPath)

  try {
    const configResult = await configReader.read()
    if (!configResult.ok) {
      console.error('无法读取 book.yaml')
      process.exit(1)
    }

    const overdueThreads = await threadReader.listOverdue(configResult.data)

    // 按类型分组输出
    const grouped = {}
    for (const t of overdueThreads) {
      if (!grouped[t.type]) grouped[t.type] = []
      grouped[t.type].push(t)
    }

    console.log(JSON.stringify(grouped, null, 2))
  } finally {
    await cache.close()
  }
}
