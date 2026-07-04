import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { installWorkdir } from '../../src/installer/index.js'
import { readManifest } from '../../src/installer/manifest.js'

const exec = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.join(__dirname, '../..')
const NO_ENV = { env: { PATH: '' } } // 探测归零,宿主全靠显式指定 → 测试确定性

async function tmpWorkdir() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-init-'))
  return { root, ctx: { workdir: root, packageRoot: PKG_ROOT }, cleanup: () => fs.rm(root, { recursive: true, force: true }) }
}
const read = (root, rel) => fs.readFile(path.join(root, rel), 'utf8')
const exists = async (root, rel) => {
  try {
    await fs.access(path.join(root, rel))
    return true
  } catch {
    return false
  }
}

test('init：一条命令装出完整布局（AC2）,vendored bin 自包含可跑', async () => {
  const { root, ctx, cleanup } = await tmpWorkdir()
  try {
    const r = await installWorkdir(ctx, { hostsOverride: 'claude-code,codex', ...NO_ENV })
    assert.equal(r.ok, true, r.error)

    // .webnovel/ 运行时自包含
    for (const rel of [
      '.webnovel/bin/webnovel-writer.js',
      '.webnovel/src/session/index.js',
      '.webnovel/roles/事实审查.md',
      '.webnovel/roles/编辑审.md',
      '.webnovel/node_modules/js-yaml/package.json',
      '.webnovel/node_modules/argparse/package.json',
      '.webnovel/package.json',
      '.webnovel/manifest.json',
      '.webnovel/books.jsonl',
    ]) {
      assert.ok(await exists(root, rel), `缺 ${rel}`)
    }
    // 平台壳落位
    assert.ok(await exists(root, '.claude/skills/webnovel-writer/SKILL.md'))
    assert.ok(await exists(root, '.claude/agents/事实审查.md'))
    assert.ok(await exists(root, '.codex/agents/事实审查.toml'))
    // hook 接线
    const settings = JSON.parse(await read(root, '.claude/settings.json'))
    assert.ok(JSON.stringify(settings).includes('session-context'))
    // AGENTS.md 标记块
    const agents = await read(root, 'AGENTS.md')
    assert.ok(agents.includes('<!-- WEBNOVEL:START -->') && agents.includes('<!-- WEBNOVEL:END -->'))
    // 报告人话
    assert.ok(r.report.includes('claude-code') && r.report.includes('下一步'))

    // vendored bin 真的能跑（js-yaml 链路含在内）：list-books 走 session→storage→yaml
    const out = await exec(process.execPath, [path.join(root, '.webnovel/bin/webnovel-writer.js'), 'list-books'], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.ok(out.stdout.includes('还没有书'), out.stdout)
  } finally {
    await cleanup()
  }
})

test('init：未检测到宿主 → 只装公约数层 + --hosts 指引（D-2）', async () => {
  const { root, ctx, cleanup } = await tmpWorkdir()
  try {
    const r = await installWorkdir(ctx, NO_ENV)
    assert.equal(r.ok, true, r.error)
    assert.ok(await exists(root, '.webnovel/bin/webnovel-writer.js'))
    assert.ok(await exists(root, 'AGENTS.md'))
    assert.ok(!(await exists(root, '.claude')), '未检测到不应装 claude 壳')
    assert.ok(r.report.includes('--hosts'), '报告应指引 --hosts 补装')
  } finally {
    await cleanup()
  }
})

test('update 三态：未改→更新;手改→跳过并列出;--force→覆盖;删了→重建（AC3）', async () => {
  const { root, ctx, cleanup } = await tmpWorkdir()
  try {
    await installWorkdir(ctx, { hostsOverride: 'claude-code', ...NO_ENV })
    const skillRel = '.claude/skills/webnovel-writer/SKILL.md'
    const rolesRel = '.claude/agents/事实审查.md'

    // 手改一个生成文件
    await fs.writeFile(path.join(root, skillRel), '作者自己改过的 SKILL', 'utf8')
    // 删一个生成文件
    await fs.rm(path.join(root, rolesRel))

    const r = await installWorkdir(ctx, { hostsOverride: 'claude-code', ...NO_ENV })
    assert.equal(r.ok, true, r.error)
    assert.ok(r.skipped.includes(skillRel), `手改文件应跳过：${r.skipped}`)
    assert.equal(await read(root, skillRel), '作者自己改过的 SKILL', '手改内容不得被覆盖')
    assert.ok(await exists(root, rolesRel), '删掉的生成文件应重建')
    assert.ok(r.report.includes('跳过') && r.report.includes('--force'))

    // --force 覆盖手改
    const rf = await installWorkdir(ctx, { hostsOverride: 'claude-code', force: true, ...NO_ENV })
    assert.equal(rf.ok, true)
    assert.notEqual(await read(root, skillRel), '作者自己改过的 SKILL')
  } finally {
    await cleanup()
  }
})

test('update：AGENTS.md 只动标记块,块外用户内容保留;books.jsonl 永不覆盖', async () => {
  const { root, ctx, cleanup } = await tmpWorkdir()
  try {
    await installWorkdir(ctx, { hostsOverride: 'codex', ...NO_ENV })
    // 用户在块外加了自己的说明;books.jsonl 有登记
    const agents = await read(root, 'AGENTS.md')
    await fs.writeFile(path.join(root, 'AGENTS.md'), agents + '\n## 我自己的备注\n别动这里。\n', 'utf8')
    await fs.writeFile(path.join(root, '.webnovel/books.jsonl'), '{"书名":"星海","目录":"星海","当前":true}\n', 'utf8')

    const r = await installWorkdir(ctx, { hostsOverride: 'codex', ...NO_ENV })
    assert.equal(r.ok, true, r.error)
    const after = await read(root, 'AGENTS.md')
    assert.ok(after.includes('我自己的备注'), '块外用户内容必须保留')
    assert.ok(after.includes('<!-- WEBNOVEL:START -->'))
    assert.ok((await read(root, '.webnovel/books.jsonl')).includes('星海'), 'books.jsonl 不得覆盖')
  } finally {
    await cleanup()
  }
})

test('init：用户已有无标记块的 AGENTS.md → 块前置,原内容保留', async () => {
  const { root, ctx, cleanup } = await tmpWorkdir()
  try {
    await fs.writeFile(path.join(root, 'AGENTS.md'), '# 我的项目说明\n手写内容。\n', 'utf8')
    const r = await installWorkdir(ctx, NO_ENV)
    assert.equal(r.ok, true)
    const after = await read(root, 'AGENTS.md')
    assert.ok(after.startsWith('<!-- WEBNOVEL:START -->'))
    assert.ok(after.includes('我的项目说明'))
    assert.ok(r.notes.some((n) => n.includes('AGENTS.md')))
  } finally {
    await cleanup()
  }
})

test('护栏：书仓库里 init 拒绝;vendored 副本自更新指引 npx', async () => {
  const { root, ctx, cleanup } = await tmpWorkdir()
  try {
    await fs.writeFile(path.join(root, 'book.yaml'), '书名: 测\n', 'utf8')
    const r = await installWorkdir(ctx, NO_ENV)
    assert.equal(r.ok, false)
    assert.ok(r.error.includes('上一层'))

    const vendored = await installWorkdir(
      { workdir: root, packageRoot: path.join(root, '.webnovel') },
      NO_ENV
    )
    assert.equal(vendored.ok, false)
    assert.ok(vendored.error.includes('npx'))
  } finally {
    await cleanup()
  }
})

test('update：既装宿主无需重新探测也继续跟新（manifest 记忆）', async () => {
  const { root, ctx, cleanup } = await tmpWorkdir()
  try {
    await installWorkdir(ctx, { hostsOverride: 'codex', ...NO_ENV })
    // 不给 hostsOverride、探测为空 → 仍应给 codex 跟新（从 manifest 推断既装）
    const r = await installWorkdir(ctx, NO_ENV)
    assert.equal(r.ok, true)
    assert.deepEqual(r.hosts, ['codex'])
    const m = await readManifest(root)
    assert.ok(Object.keys(m.files).some((k) => k.startsWith('.codex')))
  } finally {
    await cleanup()
  }
})

test('update：只更新部分宿主时其他宿主清单记录保留,手改不被下轮静默覆盖（P2-3）', async () => {
  const { root, ctx, cleanup } = await tmpWorkdir()
  try {
    await installWorkdir(ctx, { hostsOverride: 'codex', ...NO_ENV })
    // 只更 claude-code：.codex 的记录不能从清单里丢
    await installWorkdir(ctx, { hostsOverride: 'claude-code', ...NO_ENV })
    const m = await readManifest(root)
    const codexKeys = Object.keys(m.files).filter((k) => k.startsWith('.codex'))
    assert.ok(codexKeys.length > 0, '本轮未涉及的 .codex 记录应保留在清单里')

    // 手改一个 .codex 文件后全量 update：应识别为手改跳过,而不是判 new 静默覆盖
    const modified = codexKeys[0]
    await fs.writeFile(path.join(root, modified), '用户手改内容', 'utf8')
    const r = await installWorkdir(ctx, { hostsOverride: 'codex,claude-code', ...NO_ENV })
    assert.equal(r.ok, true)
    assert.ok(r.skipped.includes(modified), `${modified} 应被判手改跳过（实际 skipped：${r.skipped.join('、')}）`)
    assert.equal(await read(root, modified), '用户手改内容', '手改内容不得被覆盖')
  } finally {
    await cleanup()
  }
})
