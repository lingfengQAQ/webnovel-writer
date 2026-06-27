import { ChapterReader } from '../storage/adapters/ChapterReader.js'
import { CacheManager } from '../cache/index.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * read-chapter <章号> [--front-matter|--tail=N|--head=N|--摘要]
 */
export async function execute(args, options) {
  const chapterNum = parseInt(args[0], 10)
  if (isNaN(chapterNum)) {
    console.error('章号必须是数字')
    process.exit(1)
  }

  const repoPath = process.cwd()
  const cache = new CacheManager(path.join(repoPath, '.cache', 'index.db'))
  await cache.ensureReady(repoPath)

  const reader = new ChapterReader(repoPath, cache)

  try {
    if (options['front-matter']) {
      const result = await reader.readFrontMatter(chapterNum)
      if (result.ok) {
        console.log(JSON.stringify(result.data, null, 2))
      } else {
        console.error(result.error)
        process.exit(1)
      }
    } else if (options.tail) {
      const wordCount = parseInt(options.tail, 10)
      const result = await reader.readTail(chapterNum, wordCount)
      if (result.ok) {
        console.log(result.text)
      } else {
        console.error(result.error)
        process.exit(1)
      }
    } else if (options.head) {
      const wordCount = parseInt(options.head, 10)
      const result = await reader.readHead(chapterNum, wordCount)
      if (result.ok) {
        console.log(result.text)
      } else {
        console.error(result.error)
        process.exit(1)
      }
    } else if (options['摘要']) {
      // 读摘要文件
      const summaryPath = path.join(repoPath, '定稿', '摘要', '章摘要', `${String(chapterNum).padStart(4, '0')}.md`)
      try {
        const summary = await fs.readFile(summaryPath, 'utf8')
        console.log(summary.trim())
      } catch (err) {
        console.error(`章节 ${chapterNum} 摘要不存在`)
        process.exit(1)
      }
    } else {
      // 默认：读正文
      const result = await reader.readBody(chapterNum)
      if (result.ok) {
        console.log(result.body)
      } else {
        console.error(result.error)
        process.exit(1)
      }
    }
  } finally {
    await cache.close()
  }
}
