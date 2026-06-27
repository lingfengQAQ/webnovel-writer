import { ThreadLedgerReader } from '../storage/adapters/ThreadLedgerReader.js'
import { CacheManager } from '../cache/index.js'
import path from 'node:path'

/**
 * read-thread <条目ID> [--fields=基本信息|--履历|--收尾计划|--描述]
 */
export async function execute(args, options) {
  const threadId = args[0]
  if (!threadId) {
    console.error('请指定条目 ID（如 伏笔-001）')
    process.exit(1)
  }

  const repoPath = process.cwd()
  const cache = new CacheManager(path.join(repoPath, '.cache', 'index.db'))
  await cache.ensureReady(repoPath)

  const reader = new ThreadLedgerReader(repoPath, cache)

  try {
    if (options['履历']) {
      const result = await reader.readHistory(threadId)
      if (result.ok) {
        console.log(JSON.stringify(result.history, null, 2))
      } else {
        console.error(result.error)
        process.exit(1)
      }
    } else if (options['收尾计划']) {
      const result = await reader.readClosurePlan(threadId)
      if (result.ok) {
        console.log(result.plan)
      } else {
        console.error(result.error)
        process.exit(1)
      }
    } else if (options['描述']) {
      const result = await reader.readDescription(threadId)
      if (result.ok) {
        console.log(result.description)
      } else {
        console.error(result.error)
        process.exit(1)
      }
    } else {
      // 默认：基本信息
      const result = await reader.readBasicInfo(threadId)
      if (result.ok) {
        console.log(JSON.stringify(result.data, null, 2))
      } else {
        console.error(result.error)
        process.exit(1)
      }
    }
  } finally {
    await cache.close()
  }
}
