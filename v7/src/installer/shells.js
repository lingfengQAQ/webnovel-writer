import { generateHostShells } from '../host-shells/generate.js'

/**
 * 平台壳落位（multi-agent spec §8.1）：M4 生成器输出的相对布局（skills/、agents/）
 * 平移进各宿主 install_dir（.claude/ .codex/ …）。只产文件集,写入统一走哈希三态。
 */
export async function buildShellFiles(packageRoot, registry, hosts) {
  const all = await generateHostShells(packageRoot)
  const files = {}
  for (const host of hosts) {
    const dir = registry.hosts[host]?.install_dir
    if (!dir) continue
    for (const [rel, content] of Object.entries(all[host] || {})) {
      // 文件集键统一正斜杠（清单跨平台可移植;生成器 rel 本就是正斜杠）
      files[`${dir}/${rel}`] = content
    }
  }
  return files
}

/**
 * claude-code SessionStart hook 接线：对 .claude/settings.json 做保留式合并——
 * 只在 SessionStart 内按 command 精确判重,用户已有 hooks/权限配置原样保留。
 * settings.json 是用户主权文件,不进哈希清单,update 重复调用无副作用。
 * @returns {{content: string, changed: boolean, error?: string}}
 */
export function mergeClaudeSettings(existingText, command) {
  let settings = {}
  if (existingText != null && existingText.trim()) {
    try {
      settings = JSON.parse(existingText)
    } catch (err) {
      return { content: existingText, changed: false, error: `settings.json 不是合法 JSON（${err.message}），跳过 hook 接线` }
    }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return { content: existingText, changed: false, error: 'settings.json 结构异常，跳过 hook 接线' }
    }
  }
  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {}
  if (!Array.isArray(settings.hooks.SessionStart)) settings.hooks.SessionStart = []
  const alreadyInstalled = settings.hooks.SessionStart.some((group) =>
    Array.isArray(group?.hooks)
    && group.hooks.some((hook) => hook?.type === 'command' && hook.command === command)
  )
  if (alreadyInstalled) {
    return { content: JSON.stringify(settings, null, 2) + '\n', changed: false }
  }
  settings.hooks.SessionStart.push({ hooks: [{ type: 'command', command }] })
  return { content: JSON.stringify(settings, null, 2) + '\n', changed: true }
}

/** 会话上下文注入命令（hook 与 SKILL 缺省路径同源） */
export const SESSION_HOOK_COMMAND = 'node .webnovel/bin/webnovel-writer.js session-context'
