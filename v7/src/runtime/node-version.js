// Node 版本门槛检查。
// 纯函数与副作用分离：比较逻辑在此（可测），process.exit 留给入口 bin/。
export const MIN_NODE = '22.13.0'

/**
 * 比较运行时 Node 版本是否满足最低要求。
 * @param {string} versionString 形如 "v22.13.0" 或 "22.13.0"
 * @returns {{ok: boolean, message: string}} ok=true 时 message 为空串
 */
export function checkNodeVersion(versionString) {
  const current = parseVersion(versionString)
  if (!current) {
    return {
      ok: false,
      message: `无法识别 Node 版本「${versionString}」。本工具需要 Node ${MIN_NODE} 或更高版本。`,
    }
  }
  if (compare(current, parseVersion(MIN_NODE)) >= 0) {
    return { ok: true, message: '' }
  }
  return {
    ok: false,
    message:
      `当前 Node 版本 ${current.join('.')} 过低，本工具需要 ${MIN_NODE} 或更高版本。\n` +
      `请升级 Node 后重试：https://nodejs.org/（建议安装最新 LTS）。`,
  }
}

function parseVersion(s) {
  if (typeof s !== 'string') return null
  const m = s.trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}
