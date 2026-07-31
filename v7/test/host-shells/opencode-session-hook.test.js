import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'

/**
 * F7 复核整改（claude review #3）：插件行为自动化测试——直接导入工厂函数执行 chat.message 钩，
 * 替代「只断言源码含关键字」的形状断言。覆盖：成功注入 / 同会话内存去重 / 历史标记去重 /
 * 无 text part / CLI 失败 fail-open / 历史 API 失败不阻塞注入 / client 返回形状两种（{data:[…]} 与裸数组）。
 */

const HOOK_PATH = new URL('../../templates/opencode-session-hook.js', import.meta.url)
const { default: createPlugin } = await import(HOOK_PATH.href)

const MARK = '<!-- webnovel-session-injected -->'
const CONTEXT_LINE = '当前在写《雪落长安》；共 1 本；继续写作直接说「继续」。'

async function makeWorkdir({ withBin = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-hook-'))
  if (withBin) {
    const bin = path.join(root, '.webnovel', 'bin', 'webnovel-writer.js')
    await fs.mkdir(path.dirname(bin), { recursive: true })
    await fs.writeFile(bin, `console.log(${JSON.stringify(CONTEXT_LINE)})\n`, 'utf8')
  }
  return { root, cleanup: () => fs.rm(root, { recursive: true, force: true }) }
}

function makeClient(history = []) {
  return {
    session: {
      messages: async () => ({ data: history }),
    },
  }
}

test('opencode 插件：成功注入——session-context 输出 prepend 到首条 text part 且带标记', async () => {
  const { root, cleanup } = await makeWorkdir()
  try {
    const hooks = await createPlugin({ directory: root, client: makeClient() })
    const output = { parts: [{ type: 'text', text: '用户的问题' }] }
    await hooks['chat.message']({ sessionID: 's-ok' }, output)
    assert.ok(output.parts[0].text.startsWith(CONTEXT_LINE), '注入文本应在用户问题之前')
    assert.ok(output.parts[0].text.includes(MARK), '注入含持久化标记')
    assert.ok(output.parts[0].text.endsWith('用户的问题'), '原问题保留在尾部')
  } finally {
    await cleanup()
  }
})

test('opencode 插件：同会话内存去重——第二次 chat.message 不改变消息', async () => {
  const { root, cleanup } = await makeWorkdir()
  try {
    const hooks = await createPlugin({ directory: root, client: makeClient() })
    const output = { parts: [{ type: 'text', text: 'Q1' }] }
    await hooks['chat.message']({ sessionID: 's-dedupe' }, output)
    const afterFirst = output.parts[0].text
    output.parts[0].text = 'Q2（用户改口）'
    await hooks['chat.message']({ sessionID: 's-dedupe' }, output)
    assert.equal(output.parts[0].text, 'Q2（用户改口）', '同 sessionID 第二次不得再注入')
    assert.ok(!afterFirst.includes('Q2'), '首次注入内容未受后续影响')
  } finally {
    await cleanup()
  }
})

test('opencode 插件：历史标记去重——会话史含注入标记则不重复注入（跨进程幂等）', async () => {
  const { root, cleanup } = await makeWorkdir()
  try {
    const history = [
      { info: { role: 'user' }, parts: [{ type: 'text', text: `${CONTEXT_LINE}\n\n${MARK}` }] },
    ]
    const hooks = await createPlugin({ directory: root, client: makeClient(history) })
    const output = { parts: [{ type: 'text', text: 'Q' }] }
    await hooks['chat.message']({ sessionID: 's-history' }, output)
    assert.equal(output.parts[0].text, 'Q', '历史已有标记不得重复注入')
  } finally {
    await cleanup()
  }
})

test('opencode 插件：client 返回裸数组形状也兼容', async () => {
  const { root, cleanup } = await makeWorkdir()
  try {
    const client = { session: { messages: async () => [{ info: { role: 'user' }, parts: [{ type: 'text', text: MARK }] }] } }
    const hooks = await createPlugin({ directory: root, client })
    const output = { parts: [{ type: 'text', text: 'Q' }] }
    await hooks['chat.message']({ sessionID: 's-raw-array' }, output)
    assert.equal(output.parts[0].text, 'Q', '裸数组 + 有标记 → 去重')
  } finally {
    await cleanup()
  }
})

test('opencode 插件：无 text part 时插入新 text part', async () => {
  const { root, cleanup } = await makeWorkdir()
  try {
    const hooks = await createPlugin({ directory: root, client: makeClient() })
    const output = { parts: [] }
    await hooks['chat.message']({ sessionID: 's-nopart' }, output)
    assert.equal(output.parts.length, 1)
    assert.equal(output.parts[0].type, 'text')
    assert.ok(output.parts[0].text.includes(CONTEXT_LINE))
  } finally {
    await cleanup()
  }
})

test('opencode 插件：CLI 缺失（未安装 webnovel 运行时）→ 静默不注入不抛错', async () => {
  const { root, cleanup } = await makeWorkdir({ withBin: false })
  try {
    const hooks = await createPlugin({ directory: root, client: makeClient() })
    const output = { parts: [{ type: 'text', text: 'Q' }] }
    await hooks['chat.message']({ sessionID: 's-nobin' }, output)
    assert.equal(output.parts[0].text, 'Q', '无 bin 不得注入')
  } finally {
    await cleanup()
  }
})

test('opencode 插件：历史读取 API 抛错 → 不阻塞注入（最多重复注一次）', async () => {
  const { root, cleanup } = await makeWorkdir()
  try {
    const client = { session: { messages: async () => { throw new Error('API down') } } }
    const hooks = await createPlugin({ directory: root, client })
    const output = { parts: [{ type: 'text', text: 'Q' }] }
    await hooks['chat.message']({ sessionID: 's-apidown' }, output)
    assert.ok(output.parts[0].text.includes(CONTEXT_LINE), '历史读失败时照注（宁重不丢）')
  } finally {
    await cleanup()
  }
})

test('opencode 插件：缺 sessionID → 早退不抛错', async () => {
  const { root, cleanup } = await makeWorkdir()
  try {
    const hooks = await createPlugin({ directory: root, client: makeClient() })
    const output = { parts: [{ type: 'text', text: 'Q' }] }
    await hooks['chat.message']({}, output)
    assert.equal(output.parts[0].text, 'Q')
  } finally {
    await cleanup()
  }
})
