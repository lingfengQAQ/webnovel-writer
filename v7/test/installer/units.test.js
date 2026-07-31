import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { detectHosts, parseHostsOverride } from '../../src/installer/detect.js'
import { classifyFile, sha256, readManifest, writeManifest } from '../../src/installer/manifest.js'
import { mergeClaudeSettings, SESSION_HOOK_COMMAND } from '../../src/installer/shells.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REGISTRY = JSON.parse(
  await fs.readFile(path.join(__dirname, '../../adapters/registry.json'), 'utf8')
)

async function tmpDir(prefix = 'wnw-inst-') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  return { root, cleanup: () => fs.rm(root, { recursive: true, force: true }) }
}

test('detectHosts：PATH 上有探测名才命中（win32 认 PATHEXT）', async () => {
  const { root, cleanup } = await tmpDir('wnw-path-')
  try {
    // 造一个假 claude 可执行
    const ext = process.platform === 'win32' ? '.cmd' : ''
    await fs.writeFile(path.join(root, `claude${ext}`), '#!/bin/sh\n', 'utf8')
    const env = { PATH: root, PATHEXT: '.COM;.EXE;.BAT;.CMD' }
    const hits = await detectHosts(REGISTRY, { env })
    assert.deepEqual(hits, ['claude-code'])
    // 空 PATH → 全不命中
    assert.deepEqual(await detectHosts(REGISTRY, { env: { PATH: '' } }), [])
  } finally {
    await cleanup()
  }
})

test('parseHostsOverride：未知宿主人话报错并列可用项', () => {
  const bad = parseHostsOverride('claude-code,不存在', REGISTRY)
  assert.equal(bad.ok, false)
  assert.ok(bad.error.includes('不存在') && bad.error.includes('codex'))
  const good = parseHostsOverride('codex, cursor', REGISTRY)
  assert.deepEqual(good.hosts, ['codex', 'cursor'])
})

test('detectHosts：opencode 探测命中（win32 .cmd/no-ext 双 shim 形态）', async () => {
  const { root, cleanup } = await tmpDir('wnw-path-oc-')
  try {
    // A1 实测 Windows 三 shim 形态：opencode / opencode.cmd / opencode.ps1 并存——
    // '' ext 分支命中无扩展名 shim；.CMD ext 分支命中 .cmd。两形态分别断言。
    // platform 显式注入 win32：不注入时 Linux CI 按 posix 只查无扩展名，.cmd 分支测不到。
    await fs.writeFile(path.join(root, 'opencode'), '#!/bin/sh\n', 'utf8')
    await fs.writeFile(path.join(root, 'opencode.cmd'), '@echo off\n', 'utf8')
    const env = { PATH: root, PATHEXT: '.COM;.EXE;.BAT;.CMD' }
    const hits = await detectHosts(REGISTRY, { env, platform: 'win32' })
    assert.ok(hits.includes('opencode'), `opencode 应命中：${JSON.stringify(hits)}`)

    // 只有 .cmd 时（win32 常见）也命中
    await fs.rm(path.join(root, 'opencode'), { force: true })
    const hits2 = await detectHosts(REGISTRY, { env, platform: 'win32' })
    assert.ok(hits2.includes('opencode'), `.cmd shim 应命中：${JSON.stringify(hits2)}`)
  } finally {
    await cleanup()
  }
})

test('manifest：三态判定 + 读写往返', async () => {
  const { root, cleanup } = await tmpDir()
  try {
    const m = { version: '7.0.0-alpha', files: { 'a.md': sha256('旧内容') } }
    await writeManifest(root, m)
    const back = await readManifest(root)
    assert.equal(back.files['a.md'], sha256('旧内容'))

    assert.equal(classifyFile('新.md', null, back), 'new')
    assert.equal(classifyFile('a.md', null, back), 'missing')
    assert.equal(classifyFile('a.md', sha256('旧内容'), back), 'unchanged')
    assert.equal(classifyFile('a.md', sha256('用户改过'), back), 'user-modified')
    assert.equal(classifyFile('a.md', sha256('x'), null), 'new')
  } finally {
    await cleanup()
  }
})

test('mergeClaudeSettings：新建/保留用户配置/幂等/坏 JSON 不动', () => {
  // 新建
  const a = mergeClaudeSettings(null, SESSION_HOOK_COMMAND)
  assert.equal(a.changed, true)
  const parsedA = JSON.parse(a.content)
  assert.equal(parsedA.hooks.SessionStart[0].hooks[0].command, SESSION_HOOK_COMMAND)

  // 保留用户已有 hooks 与其他配置
  const user = JSON.stringify({
    permissions: { allow: ['Bash'] },
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo 自己的' }] }] },
  })
  const b = mergeClaudeSettings(user, SESSION_HOOK_COMMAND)
  assert.equal(b.changed, true)
  const parsedB = JSON.parse(b.content)
  assert.deepEqual(parsedB.permissions.allow, ['Bash'])
  assert.equal(parsedB.hooks.SessionStart.length, 2)

  // 幂等：再合并不重复
  const c = mergeClaudeSettings(b.content, SESSION_HOOK_COMMAND)
  assert.equal(c.changed, false)
  assert.equal(JSON.parse(c.content).hooks.SessionStart.length, 2)

  // 坏 JSON → 不动原文,报 error
  const d = mergeClaudeSettings('{坏的', SESSION_HOOK_COMMAND)
  assert.equal(d.changed, false)
  assert.ok(d.error)
  assert.equal(d.content, '{坏的')
})

test('mergeClaudeSettings：只安装 SessionStart，保留用户 PreToolUse 且不跨区误判幂等', () => {
  const userPreToolUse = [
    { matcher: 'Write|Edit', hooks: [{ type: 'command', command: SESSION_HOOK_COMMAND }] },
  ]
  const user = JSON.stringify({ hooks: { PreToolUse: userPreToolUse } })
  const merged = mergeClaudeSettings(user, SESSION_HOOK_COMMAND)
  assert.equal(merged.changed, true)
  const parsed = JSON.parse(merged.content)
  assert.deepEqual(parsed.hooks.PreToolUse, userPreToolUse)
  assert.equal(parsed.hooks.SessionStart.length, 1)
  assert.deepEqual(parsed.hooks.SessionStart[0].hooks[0], {
    type: 'command',
    command: SESSION_HOOK_COMMAND,
  })

  const again = mergeClaudeSettings(merged.content, SESSION_HOOK_COMMAND)
  assert.equal(again.changed, false)
  assert.deepEqual(JSON.parse(again.content).hooks.PreToolUse, userPreToolUse)
})
