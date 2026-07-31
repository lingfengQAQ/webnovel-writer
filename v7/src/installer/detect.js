import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * PATH 探测已装的 agent CLI（multi-agent spec §8.1）。纯函数注入 env/platform,可测。
 * 按 registry 声明顺序返回命中的 host 名;探测名来自 registry 的 detect_bin。
 */
export async function detectHosts(registry, { env = process.env, platform = process.platform } = {}) {
  const pathVar = env.PATH || env.Path || ''
  const dirs = pathVar.split(path.delimiter).filter(Boolean)
  // win32 语义：PATHEXT 惯例大写（.CMD）而 shim 文件常为小写（.cmd），真实 Windows 靠
  // 文件系统大小写不敏感命中——这里补小写变体，使匹配不依赖文件系统特性
  // （大小写敏感卷/跨平台模拟 win32 同样成立）。
  const rawExts =
    platform === 'win32'
      ? ['', ...(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
      : ['']
  const exts = [...new Set(rawExts.flatMap((e) => [e, e.toLowerCase()]))]
  const hits = []
  for (const [host, cfg] of Object.entries(registry.hosts)) {
    if (host === '_default' || !cfg.detect_bin) continue
    if (await findOnPath(cfg.detect_bin, dirs, exts)) hits.push(host)
  }
  return hits
}

async function findOnPath(bin, dirs, exts) {
  for (const dir of dirs) {
    for (const ext of exts) {
      try {
        const stat = await fs.stat(path.join(dir, bin + ext))
        if (stat.isFile()) return true
      } catch {
        // 该目录没有 → 继续
      }
    }
  }
  return false
}

/** 解析 --hosts=a,b 覆盖：校验都在 registry 内,给人话错误 */
export function parseHostsOverride(value, registry) {
  const names = String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!names.length) return { ok: false, error: '--hosts 需要逗号分隔的宿主名（如 --hosts=claude-code,codex）' }
  const known = Object.keys(registry.hosts).filter((h) => h !== '_default')
  const unknown = names.filter((n) => !known.includes(n))
  if (unknown.length) {
    return { ok: false, error: `不认识的宿主：${unknown.join('、')}。可用：${known.join('、')}` }
  }
  return { ok: true, hosts: names }
}
