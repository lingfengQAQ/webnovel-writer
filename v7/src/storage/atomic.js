import { promises as fs } from 'node:fs'
import path from 'node:path'

let counter = 0

/**
 * 原子批量写：全部先落 .tmp，再备份旧文件并 rename，任一失败回滚。
 * 同目录 rename 原子（同卷），保证多文件"要么全成要么原样"（spec error-handling §3.1）。
 * @param {string} repoPath
 * @param {Array<{path: string, content: string}>} files 相对路径
 * @returns {Promise<string[]>} 已写的相对路径
 */
export async function writeAtomicBatch(repoPath, files) {
  const seen = new Set()
  const plans = []
  const resolvedRoot = path.resolve(repoPath)
  try {
    for (const f of files) {
      if (seen.has(f.path)) throw new Error(`批量写入包含重复路径：${f.path}`)
      seen.add(f.path)
      const full = path.join(repoPath, f.path)
      // P0-F4 总闸：不信任任何调用方，词法级 repo 边界断言（目标可能尚不存在，
      // 故不做 realpath；与 staging/contract-invalidation.js 的
      // workspaceRemovalIsContained 判定口径不同构，两处注释互指）。
      // 必须在 mkdir 之前判定：越界时零建目录。
      const resolved = path.resolve(full)
      if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
        throw new Error(`批量写入路径越界：${f.path}`)
      }
      await fs.mkdir(path.dirname(full), { recursive: true })
      const n = counter++
      const tmp = `${full}.wnwtmp.${process.pid}.${n}`
      const backup = `${full}.wnwbackup.${process.pid}.${n}`
      const plan = { tmp, final: full, backup, existed: false, renamedIn: false, rel: f.path }
      plans.push(plan)
      await fs.writeFile(tmp, f.content, 'utf8')

      try {
        const stat = await fs.stat(full)
        if (stat.isDirectory()) throw new Error(`目标路径是目录，不能写入文件：${f.path}`)
        await fs.rename(full, backup)
        plan.existed = true
      } catch (err) {
        if (err.code !== 'ENOENT') throw err
      }
    }

    for (const p of plans) {
      await fs.rename(p.tmp, p.final)
      p.renamedIn = true
    }
    for (const p of plans) {
      if (p.existed) await fs.rm(p.backup, { force: true })
    }
  } catch (err) {
    for (const p of plans.toReversed()) {
      await restorePlan(p)
    }
    throw err
  }
  return plans.map((p) => p.rel)
}

async function restorePlan(plan) {
  try {
    await fs.rm(plan.tmp, { force: true })
  } catch {
    // 尽力回滚
  }
  try {
    // 只删本次真正写入过 final 的内容；existed=false 且未 renamedIn 时 final 位置
    // 是从未动过的原文件（写 tmp/备份 rename 先失败的场景），绝不能删（R12）。
    if (plan.renamedIn) {
      await fs.rm(plan.final, { force: true })
    }
    if (plan.existed) {
      await fs.rename(plan.backup, plan.final)
    }
  } catch {
    // 尽力回滚；调用方会收到原始错误
  }
}
