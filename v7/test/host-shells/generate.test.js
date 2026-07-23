import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { generateHostShells, renderTemplate } from '../../src/host-shells/generate.js'

const V7 = fileURLToPath(new URL('../../', import.meta.url))

test('renderTemplate：if/unless 条件块 + 变量插值', () => {
  const t = '{{#if a}}A入{{/if}}{{#unless a}}A去{{/unless}} {{x.y}}'
  assert.equal(renderTemplate(t, { a: true, x: { y: '值' } }).trim(), 'A入 值')
  assert.equal(renderTemplate(t, { a: false, x: { y: '值' } }).trim(), 'A去 值')
})

test('renderTemplate：agentCapable=false → 渲染兼容(降级)模式块', () => {
  const t = '{{#if agentCapable}}完整{{/if}}{{#unless agentCapable}}兼容模式{{/unless}}'
  assert.match(renderTemplate(t, { agentCapable: false }), /兼容模式/)
  assert.ok(!renderTemplate(t, { agentCapable: false }).includes('完整'))
})

test('生成 claude-code 壳：hasHooks 块入、unless 块去；两审完整模式；F1 命令接线；占位符全渲染', async () => {
  const out = await generateHostShells(V7)
  const skill = out['claude-code']['skills/webnovel-writer/SKILL.md']
  assert.match(skill, /SessionStart 已注入/)
  assert.ok(!skill.includes('session-context`，向作者报'), 'hasHooks=true 应去掉 unless 块')
  assert.match(skill, /独立 subagent/)
  assert.ok(!skill.includes('兼容模式'), 'agentCapable=true 应去掉兼容模式块')
  assert.match(skill, /node \.webnovel\/bin\/webnovel-writer\.js next --json/, '命令引用变量应渲染为 vendored 调用')
  for (const cmdName of [
    'review-input', 'save-review', 'finalize', 'persist-book', 'persist-outline',
    'knowledge-query', 'persist-contract', 'persist-design', 'read-design',
  ]) {
    assert.ok(skill.includes(cmdName), `写章流程应接 F1 命令 ${cmdName}`)
  }
  assert.match(skill, /本章技法/)
  assert.match(skill, /factChanges/)
  assert.doesNotMatch(skill, /题材流派指导|恩怨清算|章尾钩子|节拍索引/)
  assert.ok(!skill.includes('{{'), '占位符应全部渲染')
})

test('生成 codex 壳：无 hook → unless 块入；角色输出 TOML', async () => {
  const out = await generateHostShells(V7)
  const skill = out['codex']['skills/webnovel-writer/SKILL.md']
  assert.match(skill, /session-context/)
  assert.ok(!skill.includes('SessionStart 已注入'))
  const role = out['codex']['agents/事实审查.toml']
  assert.match(role, /name = "事实审查"/)
  assert.match(role, /instructions = """/)
})

test('角色占位符注入 category（来自 schema.js 单源）', async () => {
  const out = await generateHostShells(V7)
  const factRole = out['claude-code']['agents/事实审查.md']
  const editorialRole = out['claude-code']['agents/编辑审.md']
  assert.match(factRole, /unregistered_thread/)
  assert.match(factRole, /factChanges/)
  assert.match(editorialRole, /作品契约/)
  assert.doesNotMatch(`${factRole}\n${editorialRole}`, /题材流派指导|恩怨清算默认|恩怨清算:/)
  assert.ok(!factRole.includes('{{categories'), 'category 占位符已渲染')
  assert.ok(!factRole.includes('{{schema'), 'schema 占位符已渲染')
})

test('所有生成壳都保留审稿输入令牌与批内重审草稿绑定协议', async () => {
  const out = await generateHostShells(V7)
  for (const [host, files] of Object.entries(out)) {
    const skill = files['skills/webnovel-writer/SKILL.md']
    assert.match(
      skill,
      /\{"审稿输入令牌","事实审查","编辑审","mode","待确认新专名","章摘要"\}/,
      `${host} SKILL 应声明带令牌的 save-review 外层`,
    )
    assert.match(skill, /外层令牌同样逐字复制 ReviewInput/)
    assert.match(skill, /必须与两份报告内令牌相等/)
    assert.match(skill, /禁止重算、改写或省略/)
    assert.match(skill, /batch-status --json/)
    assert.match(skill, /草稿路径/)
    assert.match(skill, /review-input <章号> --draft=<草稿路径>/)
    assert.match(skill, /save-review <章号> --file=<json路径> --draft=<同一路径>/)
    assert.match(skill, /禁止默认使用 `草稿-A\.md`/)

    for (const roleName of ['事实审查', '编辑审']) {
      const entry = Object.entries(files).find(([rel]) => rel.startsWith(`agents/${roleName}.`))
      assert.ok(entry, `${host} 应生成 ${roleName} 任务书`)
      const role = entry[1]
      assert.match(role, /作品契约版本/)
      assert.match(role, /审稿输入令牌/)
      assert.match(role, /逐字原样复制 ReviewInput/)
      assert.match(role, /禁止重算、改写或省略/)
      assert.match(role, /"审稿输入令牌": "sha256:[0-9a-f]{64}"/)
    }
  }
})

test('drift check：同输入连跑两次逐字节一致', async () => {
  const a = await generateHostShells(V7)
  const b = await generateHostShells(V7)
  assert.deepEqual(a, b)
})
