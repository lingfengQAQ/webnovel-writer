import { TimelineReader } from '../storage/adapters/TimelineReader.js'
import path from 'node:path'

export async function execute(args, options) {
  const repoPath = process.cwd()
  const reader = new TimelineReader(repoPath)

  if (options['current-and-prev']) {
    // 简化：假设当前卷=1，读第1卷
    const result = await reader.readVolumeRange(1, 1)
    if (result.ok) {
      console.log(JSON.stringify(result.timeline, null, 2))
    } else {
      console.error(result.error)
      process.exit(1)
    }
  } else {
    console.error('请指定选项（如 --current-and-prev）')
    process.exit(1)
  }
}
