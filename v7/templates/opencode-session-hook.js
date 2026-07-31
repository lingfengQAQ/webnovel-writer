/**
 * webnovel-writer OpenCode 会话启动注入（F7，模板=本文件，安装时落 .opencode/plugins/）。
 *
 * 形态与 webnovel-writer 在 claude-code 的 SessionStart hook 对齐：会话首条用户消息时
 * 运行 `.webnovel/bin/webnovel-writer.js session-context`，把「当前在写哪本/共几本/全书近况入口」
 * 注入该消息并持久化进历史；每会话只注一次（内存集顶层 + 历史标记双重幂等）。
 *
 * 所有失败一律静默（fail-open）：webnovel 脚本缺失/报错/超时都不阻塞会话。
 * OpenCode 1.2.x 起要求插件导出为工厂函数（见本函数签名）；本插件零配置即可被发现。
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const INJECTED_MARK = '<!-- webnovel-session-injected -->'
const SESSION_TIMEOUT_MS = 8000

// 插件实例内幂等（同会话不重复注入）；跨进程幂等靠历史标记（hasInjectedInHistory）。
const doneSessions = new Set()

function hasInjectedInHistory(messages) {
  if (!Array.isArray(messages)) return false
  return messages.some(
    (msg) =>
      msg?.info?.role === 'user' &&
      Array.isArray(msg.parts) &&
      msg.parts.some((p) => p?.type === 'text' && typeof p.text === 'string' && p.text.includes(INJECTED_MARK))
  )
}

async function readSessionContext(directory) {
  const bin = path.join(directory, '.webnovel', 'bin', 'webnovel-writer.js')
  try {
    await fs.access(bin)
  } catch {
    return '' // 未安装 webnovel 运行时：静默
  }
  try {
    // 调 PATH 上的 node（与 SKILL 的 {{cmd}} 调用形一致：node .webnovel/bin/webnovel-writer.js）；
    // 不用 process.execPath——宿主二进制（Bun/Node 均可）不一定是能跑 ESM 的 node。
    const { stdout } = await execFileAsync(
      'node',
      [bin, 'session-context'],
      { cwd: directory, timeout: SESSION_TIMEOUT_MS, encoding: 'utf8', maxBuffer: 1024 * 1024 }
    )
    return String(stdout || '').trim()
  } catch {
    return '' // node 不在 PATH / 脚本失败 / 超时：静默，不阻塞会话
  }
}

export default async ({ directory, client }) => {
  return {
    'chat.message': async (input, output) => {
      try {
        const sessionID = input?.sessionID
        if (!sessionID || doneSessions.has(sessionID)) return

        // 跨进程幂等：本会话历史里已有注入标记就跳过
        try {
          const history = await client.session.messages({ path: { id: sessionID }, query: { directory } })
          if (hasInjectedInHistory(history?.data || history || [])) {
            doneSessions.add(sessionID)
            return
          }
        } catch {
          // 读历史失败不阻塞注入（最多重复注入一次，无副作用）
        }

        const context = await readSessionContext(directory)
        doneSessions.add(sessionID)
        if (!context) return

        const injected = `${context}\n\n${INJECTED_MARK}`
        const parts = output?.parts || []
        const textIdx = parts.findIndex((p) => p?.type === 'text' && typeof p.text === 'string')
        if (textIdx !== -1) {
          parts[textIdx].text = `${injected}\n\n---\n\n${parts[textIdx].text}`
        } else {
          parts.unshift({ type: 'text', text: injected })
        }
      } catch {
        // fail-open 总兜底：任何异常都不影响会话
      }
    },
  }
}
