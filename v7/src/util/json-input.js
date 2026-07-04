import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * F1 通道的 JSON 输入一律走文件（--file/--payload,Windows 中文管道编码雷区,不走 stdin）。
 * 相对路径两处都找：先按启动目录（宿主常把临时 JSON 写在工作目录）,再按书仓库
 * （SKILL 约定临时 JSON 放 工作区/）。都没有则把找过的路径如实列出。
 * @returns {Promise<{ok: true, data: object}|{ok: false, error: string}>}
 */
export async function readJsonInput(ctx, value, flagName) {
  if (!value || value === true) {
    return { ok: false, error: `缺少 --${flagName}=<json文件路径>（JSON 走文件,不走管道）` }
  }
  const candidates = []
  if (path.isAbsolute(value)) {
    candidates.push(value)
  } else {
    for (const base of [process.cwd(), ctx.repoPath || ctx.workdir]) {
      if (!base) continue
      const full = path.resolve(base, value)
      if (!candidates.includes(full)) candidates.push(full)
    }
  }
  let raw = null
  for (const full of candidates) {
    try {
      raw = await fs.readFile(full, 'utf8')
      break
    } catch (err) {
      if (err.code !== 'ENOENT') return { ok: false, error: `读不到 ${full}：${err.message}` }
    }
  }
  if (raw == null) {
    return { ok: false, error: `读不到 ${value}（找过：${candidates.join('、')}）` }
  }
  try {
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, error: `${value} 的内容需要是 JSON 对象` }
    }
    return { ok: true, data }
  } catch (err) {
    return { ok: false, error: `${value} 不是合法 JSON：${err.message}` }
  }
}
