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

test('生成 claude-code 壳：hasHooks 块入、unless 块去；两审完整模式；占位符全渲染', async () => {
  const out = await generateHostShells(V7)
  const skill = out['claude-code']['skills/webnovel-writer/SKILL.md']
  assert.match(skill, /SessionStart 已注入/)
  assert.ok(!skill.includes('扫描含'), 'hasHooks=true 应去掉 unless 块')
  assert.match(skill, /完整模式/)
  assert.ok(!skill.includes('{{'), '占位符应全部渲染')
})

test('生成 codex 壳：无 hook → unless 块入；角色输出 TOML', async () => {
  const out = await generateHostShells(V7)
  const skill = out['codex']['skills/webnovel-writer/SKILL.md']
  assert.match(skill, /读工作目录/)
  assert.ok(!skill.includes('SessionStart 已注入'))
  const role = out['codex']['agents/事实审查.toml']
  assert.match(role, /name = "事实审查"/)
  assert.match(role, /instructions = """/)
})

test('角色占位符注入 category（来自 schema.js 单源）', async () => {
  const out = await generateHostShells(V7)
  const role = out['claude-code']['agents/事实审查.md']
  assert.match(role, /unregistered_thread/)
  assert.ok(!role.includes('{{categories'), 'category 占位符已渲染')
  assert.ok(!role.includes('{{schema'), 'schema 占位符已渲染')
})

test('drift check：同输入连跑两次逐字节一致', async () => {
  const a = await generateHostShells(V7)
  const b = await generateHostShells(V7)
  assert.deepEqual(a, b)
})
