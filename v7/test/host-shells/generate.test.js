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
  assert.match(skill, /SessionStart 已注入「当前在写哪本 \/ 共几本 \/ 全书近况入口」/)
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
  assert.match(skill, /session-context`，向作者报「当前在写哪本 \/ 共几本 \/ 全书近况入口」/)
  assert.ok(!skill.includes('SessionStart 已注入'))
  const role = out['codex']['agents/事实审查.toml']
  assert.match(role, /name = "事实审查"/)
  assert.match(role, /instructions = """/)
})

// F7：opencode 壳——SKILL 走 hasHooks/agentCapable 双真支路；两审 subagent 只读 permission；插件随壳产。
test('生成 opencode 壳：hasHooks 启动段入、两审完整模式；agents 含 mode+四 deny；插件带 chat.message', async () => {
  const out = await generateHostShells(V7)
  assert.ok(out.opencode, 'registry 应产 opencode 壳')

  const skill = out.opencode['skills/webnovel-writer/SKILL.md']
  assert.match(skill, /SessionStart 已注入「当前在写哪本 \/ 共几本 \/ 全书近况入口」/)
  assert.ok(!skill.includes('兼容模式'), 'agentCapable=true 应去掉兼容模式块')
  assert.match(skill, /独立 subagent/)
  assert.ok(!skill.includes('{{'), '占位符应全部渲染')

  for (const roleName of ['事实审查', '编辑审']) {
    const role = out.opencode[`agents/${roleName}.md`]
    assert.ok(role, `缺 ${roleName} 壳`)
    // C1/C2 实测 schema：mode=subagent + 四 deny 键（写/执行/联网/再派发全封）
    assert.match(role, /mode: subagent/)
    for (const key of ['edit: deny', 'bash: deny', 'webfetch: deny', 'task: deny']) {
      assert.ok(role.includes(key), `${roleName} 缺 permission ${key}`)
    }
    assert.match(role, /审稿输入令牌/, `${roleName} 任务书本体入壳`)
    assert.ok(!role.includes('{{categories'), `${roleName} category 占位符已渲染`)
  }

  const plugin = out.opencode['plugins/webnovel-session.js']
  assert.ok(plugin, 'opencode 壳应带会话注入插件')
  assert.match(plugin, /chat\.message/)
  assert.match(plugin, /session-context/)
  assert.match(plugin, /fail-open/, '插件须 fail-open 注释可考')
  assert.doesNotMatch(plugin, /C:\\|C:\//, '插件不含本机绝对路径')
})

test('opencode 两审壳 name=文件名一致性（OpenCode 以文件名注册 agent id）', async () => {
  const out = await generateHostShells(V7)
  for (const roleName of ['事实审查', '编辑审']) {
    const role = out.opencode[`agents/${roleName}.md`]
    assert.ok(role.includes(`name: ${roleName}`), `${roleName} 的 frontmatter name 应与文件名一致`)
  }
})

test('所有生成 SKILL 的状态机序 4 卷复盘排在序 5 体检之前', async () => {
  const out = await generateHostShells(V7)
  for (const [host, files] of Object.entries(out)) {
    const skill = files['skills/webnovel-writer/SKILL.md']
    const sequence4 = skill.indexOf('- 序4 卷复盘')
    const sequence5 = skill.indexOf('- 序5 体检')
    assert.ok(sequence4 >= 0, `${host} 缺序4卷复盘`)
    assert.ok(sequence5 >= 0, `${host} 缺序5体检`)
    assert.ok(sequence4 < sequence5, `${host} 应按状态机序号展示序4后序5`)
  }
})

test('所有生成 SKILL 都声明 alpha hook 边界与序2事后自愈', async () => {
  const out = await generateHostShells(V7)
  for (const [host, files] of Object.entries(out)) {
    const skill = files['skills/webnovel-writer/SKILL.md']
    assert.match(skill, /next` 序2只做事后手改自愈/)
    assert.match(skill, /不是 PreToolUse 写前拦截/)
    assert.match(skill, /7\.0\.0-alpha 不安装 PreToolUse/)
    assert.ok(!skill.includes('{{'), `${host} 占位符应全部渲染`)
  }
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
