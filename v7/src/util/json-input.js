import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * F1 通道的 JSON 输入一律走文件（--file/--payload,Windows 中文管道编码雷区,不走 stdin）。
 * 相对路径相对 ctx.repoPath（书仓库）,无书时相对 ctx.workdir。
 * @returns {Promise<{ok: true, data: object}|{ok: false, error: string}>}
 */
export async function readJsonInput(ctx, value, flagName) {
  if (!value || value === true) {
    return { ok: false, error: `缺少 --${flagName}=<json文件路径>（JSON 走文件,不走管道）` }
  }
  const base = ctx.repoPath || ctx.workdir || process.cwd()
  const full = path.isAbsolute(value) ? value : path.resolve(base, value)
  let raw
  try {
    raw = await fs.readFile(full, 'utf8')
  } catch (err) {
    return { ok: false, error: `读不到 ${value}：${err.message}` }
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
