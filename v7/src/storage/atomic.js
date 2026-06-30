import { promises as fs } from 'node:fs'
import path from 'node:path'

let counter = 0

/**
 * 原子批量写：全部先落 .tmp 再 rename，任一失败回滚（删 tmp）。
 * 同目录 rename 原子（同卷），保证多文件"要么全成要么原样"（spec error-handling §3.1）。
 * @param {string} repoPath
 * @param {Array<{path: string, content: string}>} files 相对路径
 * @returns {Promise<string[]>} 已写的相对路径
 */
export async function writeAtomicBatch(repoPath, files) {
  const plans = []
  for (const f of files) {
    const full = path.join(repoPath, f.path)
    await fs.mkdir(path.dirname(full), { recursive: true })
    const tmp = `${full}.wnwtmp.${process.pid}.${counter++}`
    await fs.writeFile(tmp, f.content, 'utf8')
    plans.push({ tmp, final: full, rel: f.path })
  }
  try {
    for (const p of plans) {
      await fs.rename(p.tmp, p.final)
    }
  } catch (err) {
    for (const p of plans) {
      await fs.rm(p.tmp, { force: true })
    }
    throw err
  }
  return plans.map((p) => p.rel)
}
