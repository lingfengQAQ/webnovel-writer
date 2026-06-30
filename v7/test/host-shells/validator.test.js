import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { validatePackage, driftCheck } from '../../src/host-shells/validator.js'

const V7 = fileURLToPath(new URL('../../', import.meta.url))

async function makePkg() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-pkg-'))
  const w = async (rel, c) => {
    const full = path.join(root, rel)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, c, 'utf8')
  }
  await w('adapters/registry.json', JSON.stringify({ schema_version: 'webnovel-host-registry/v2', hosts: { 'claude-code': { tier: 1, agentCapable: true, hasHooks: true } } }))
  await w('adapters/claude-code/support.md', '# claude-code 核验\n')
  await w('roles/事实审查.md', '---\nname: 事实审查\ndescription: d\n---\nbody {{categories.factCheck}}')
  await w('skills/webnovel-writer/SKILL.md', '---\nname: webnovel-writer\ndescription: d\n---\nbody')
  return { root, w, cleanup: () => fs.rm(root, { recursive: true, force: true }) }
}

test('validatePackage：真实 v7 资产通过', async () => {
  const r = await validatePackage(V7)
  assert.equal(r.ok, true, '真实资产应过 validator：' + r.errors.join('；'))
})

test('validatePackage：一级宿主缺 support.md → 报错', async () => {
  const { root, cleanup } = await makePkg()
  try {
    await fs.rm(path.join(root, 'adapters/claude-code/support.md'))
    const r = await validatePackage(root)
    assert.equal(r.ok, false)
    assert.ok(r.errors.some((e) => e.includes('support.md')))
  } finally { await cleanup() }
})

test('validatePackage：角色缺 description → 报错', async () => {
  const { root, w, cleanup } = await makePkg()
  try {
    await w('roles/事实审查.md', '---\nname: 事实审查\n---\nbody')
    const r = await validatePackage(root)
    assert.equal(r.ok, false)
    assert.ok(r.errors.some((e) => e.includes('description')))
  } finally { await cleanup() }
})

test('validatePackage：SKILL description 超 8k → 报错', async () => {
  const { root, w, cleanup } = await makePkg()
  try {
    await w('skills/webnovel-writer/SKILL.md', `---\nname: w\ndescription: ${'描'.repeat(9000)}\n---\nbody`)
    const r = await validatePackage(root)
    assert.equal(r.ok, false)
    assert.ok(r.errors.some((e) => e.includes('8k') || e.includes('预算')))
  } finally { await cleanup() }
})

test('validatePackage：含本机绝对路径 → 报错', async () => {
  const { root, w, cleanup } = await makePkg()
  try {
    await w('roles/事实审查.md', '---\nname: 事实审查\ndescription: d\n---\n见 C:\\\\Users\\\\x\\\\a.md')
    const r = await validatePackage(root)
    assert.equal(r.ok, false)
    assert.ok(r.errors.some((e) => e.includes('绝对路径')))
  } finally { await cleanup() }
})

test('validatePackage（P1-5）：扩展绝对路径检测 /tmp /opt /root UNC C:/ 都算', async () => {
  const cases = [
    '见 /tmp/draft.md',
    '落在 /opt/webnovel/x',
    '备份在 /root/book',
    '挂载 /mnt/d/book',
    'UNC \\\\nas\\\\share\\\\b.md',
    '正斜杠盘符 C:/Users/x/a.md',
  ]
  for (const c of cases) {
    const { root, w, cleanup } = await makePkg()
    try {
      await w('roles/事实审查.md', `---\nname: 事实审查\ndescription: d\n---\n${c}`)
      const r = await validatePackage(root)
      assert.equal(r.ok, false, `应检出绝对路径：${c}`)
      assert.ok(r.errors.some((e) => e.includes('绝对路径')), c)
    } finally { await cleanup() }
  }
})

test('validatePackage（P1-5）：URL scheme 与 prose 不误报', async () => {
  const { root, w, cleanup } = await makePkg()
  try {
    await w('roles/事实审查.md', '---\nname: 事实审查\ndescription: d\n---\n参见 https://example.com/a/b 与 http://x.io 和 and/or 及 §3/4 节,无绝对路径。')
    const r = await validatePackage(root)
    assert.equal(r.ok, true, `URL/prose 不应误报绝对路径：${r.errors.join('；')}`)
  } finally { await cleanup() }
})

test('driftCheck：真实 v7 确定性 + validator 通过', async () => {
  const r = await driftCheck(V7)
  assert.equal(r.ok, true, r.error)
})
