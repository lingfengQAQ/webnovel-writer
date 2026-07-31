#!/usr/bin/env node
// M5 出口 D1（AC1 的 CI 半）：npm pack 产物 → 干净中文路径工作目录 → init → 建书 → next → update 全链路。
// 经 `npm run e2e:install` 运行（用 npm_execpath 定位 npm,全程 args 数组不走 shell,中文路径安全）。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)
const pkgRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const npmCli = process.env.npm_execpath
if (!npmCli) {
  console.error('请通过 npm run e2e:install 运行（脚本需要 npm_execpath 定位 npm）')
  process.exit(1)
}
const npm = (args, opts = {}) =>
  exec(process.execPath, [npmCli, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...opts })

let failed = false
const check = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) failed = true
}
const exists = async (p) => {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
const listRelativeFiles = async (root) => {
  const files = []
  const walk = async (dir, base = '') => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const rel = base ? `${base}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel)
      else if (entry.isFile()) files.push(rel)
    }
  }
  await walk(root)
  return files
}
const parsePackResult = (stdout) => {
  const parsed = JSON.parse(stdout)
  return Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]
}

const cleanups = []
try {
  // 1. pack（发布产物 = npx 消费的同一份包内容）
  const packDest = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-pack-'))
  cleanups.push(packDest)
  const packOut = await npm(['pack', '--json', '--pack-destination', packDest], { cwd: pkgRoot })
  const pack = parsePackResult(packOut.stdout)
  const packFiles = (pack?.files || []).map((entry) => (typeof entry === 'string' ? entry : entry.path))
  const packedDocs = packFiles.filter((rel) => rel.startsWith('docs/'))
  check(packFiles.includes('LICENSE'), 'pack 清单含 GPL 许可证')
  check(packFiles.includes('docs/migration-guide.md'), 'pack 清单含迁移指南')
  check(
    packedDocs.every((rel) => rel.startsWith('docs/knowledge/') || rel === 'docs/migration-guide.md'),
    'pack 清单 docs 仅含 knowledge 与 migration-guide',
  )
  check(!packFiles.some((rel) => rel.toLowerCase().includes('story-repo-spec')), 'pack 清单不含 story-repo-spec')
  check(!packFiles.some((rel) => rel.startsWith('docs/architecture/')), 'pack 清单不含 docs/architecture')
  const tgzName = pack?.filename
  const tgz = path.join(packDest, tgzName)
  check(await exists(tgz), `npm pack 产物：${tgzName}`)

  // 2. 装进干净沙箱
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-sandbox-'))
  cleanups.push(sandbox)
  await npm(['install', tgz, '--prefix', sandbox, '--no-audit', '--no-fund'], { cwd: sandbox })
  const installedBin = path.join(sandbox, 'node_modules', 'webnovel-writer', 'bin', 'webnovel-writer.js')
  const installedRoot = path.join(sandbox, 'node_modules', 'webnovel-writer')
  check(await exists(installedBin), '安装产物 bin 存在')
  const installedFiles = await listRelativeFiles(installedRoot)
  const installedDocs = installedFiles.filter((rel) => rel.startsWith('docs/'))
  check(
    installedDocs.every((rel) => rel.startsWith('docs/knowledge/') || rel === 'docs/migration-guide.md'),
    '安装包 docs 仅含 knowledge 与 migration-guide',
  )
  check(!installedFiles.some((rel) => rel.toLowerCase().includes('story-repo-spec')), '安装包不含 story-repo-spec')
  check(!installedFiles.some((rel) => rel.startsWith('docs/architecture/')), '安装包不含 docs/architecture')

  // 3. 中文用户名模拟路径里 init（一条命令装出工作目录）
  const base = await fs.mkdtemp(path.join(os.tmpdir(), '中文用户名-'))
  cleanups.push(base)
  const workdir = path.join(base, '工作目录')
  await fs.mkdir(workdir, { recursive: true })
  const userPreToolUse = [
    { matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'node 用户自己的写前检查.mjs' }] },
  ]
  await fs.mkdir(path.join(workdir, '.claude'), { recursive: true })
  await fs.writeFile(
    path.join(workdir, '.claude', 'settings.json'),
    JSON.stringify({ hooks: { PreToolUse: userPreToolUse } }, null, 2) + '\n',
    'utf8',
  )
  const node = (bin, args) =>
    exec(process.execPath, [bin, ...args], { cwd: workdir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })

  const init = await node(installedBin, ['init', '--hosts=claude-code,codex,opencode'])
  console.log('--- init 报告 ---\n' + init.stdout + '-----------------')
  for (const rel of [
    '.webnovel/bin/webnovel-writer.js',
    '.webnovel/node_modules/js-yaml/package.json',
    '.webnovel/manifest.json',
    '.webnovel/books.jsonl',
    '.webnovel/references/路由.csv',
    '.webnovel/references/节拍/PA-001-压抑蓄力爆发.md',
    '.webnovel/docs/knowledge/维度宪章.md',
    '.webnovel/docs/knowledge/调用者与字段矩阵.md',
    '.webnovel/docs/knowledge/策展规则.md',
    '.claude/skills/webnovel-writer/SKILL.md',
    '.claude/agents/事实审查.md',
    '.claude/settings.json',
    '.codex/agents/事实审查.toml',
    '.opencode/skills/webnovel-writer/SKILL.md',
    '.opencode/agents/事实审查.md',
    '.opencode/agents/编辑审.md',
    '.opencode/plugins/webnovel-session.js',
    'AGENTS.md',
  ]) {
    check(await exists(path.join(workdir, rel)), `init 布局：${rel}`)
  }
  // F7 opencode：两审壳含只读 permission（宿主硬约束）
  const ocRole = await fs.readFile(path.join(workdir, '.opencode/agents/事实审查.md'), 'utf8')
  check(/mode: subagent/.test(ocRole) && ocRole.includes('edit: deny') && ocRole.includes('task: deny'),
    'opencode 两审壳：mode=subagent + 只读 permission 落位')
  check(init.stdout.includes('opencode'), 'init 报告如实列出 opencode 宿主')
  const initializedFiles = await listRelativeFiles(path.join(workdir, '.webnovel'))
  const initializedDocs = initializedFiles.filter((rel) => rel.startsWith('docs/'))
  check(
    initializedDocs.every((rel) => rel.startsWith('docs/knowledge/')),
    'init 后 .webnovel/docs 仅含知识治理文档',
  )
  check(!initializedFiles.some((rel) => rel.toLowerCase().includes('story-repo-spec')), 'init 后不含 story-repo-spec')
  check(!initializedFiles.some((rel) => rel.startsWith('docs/architecture/')), 'init 后不含 docs/architecture')
  const initializedSettings = JSON.parse(await fs.readFile(path.join(workdir, '.claude/settings.json'), 'utf8'))
  check(
    JSON.stringify(initializedSettings.hooks.PreToolUse) === JSON.stringify(userPreToolUse),
    'init 保留用户自有 PreToolUse',
  )
  check(
    Array.isArray(initializedSettings.hooks.SessionStart)
      && initializedSettings.hooks.SessionStart.length === 1
      && initializedSettings.hooks.SessionStart[0]?.hooks?.[0]?.command?.endsWith('session-context'),
    'alpha 只新增 SessionStart 上下文 hook',
  )

  // 4. vendored bin 建第一本书（干净环境一条命令装出并建书 = AC1 链路）
  const vendoredBin = path.join(workdir, '.webnovel', 'bin', 'webnovel-writer.js')
  await fs.writeFile(
    path.join(workdir, '建书.json'),
    JSON.stringify({
      book: {
        spec_version: '7.0',
        书名: '雪落长安',
        类型: '玄幻',
        副题材: [],
        流派: [],
        卷规模: 40,
        体检周期: 50,
      },
      总纲: '# 总纲\n## 结局\n终成一代大家。',
      卷纲: '# 第1卷\n初入长安。',
      作品契约: [
        '---',
        '类型: 玄幻',
        '副题材:',
        '流派:',
        '创意约束:',
        '来源版本:',
        '  - 作者自定义',
        '契约版本: 1',
        '生效起章: 1',
        '更新原因: 初始建书',
        '变更类型: 建书',
        '---',
        '## 核心读者承诺',
        '成长与选择都有可见后果。',
        '## 骨架约定',
        '按卷推进长期目标。',
        '## 题材融合协议',
        '本书暂不混合副题材。',
        '## 创意约束落地',
        '主线困境不由临时奖励解决。',
        '## 差异化点',
        '- 线索改变人物关系。',
        '- 成长代价延续到后文。',
        '- 反派掌握先手信息。',
        '## 冲突与关系结算原则',
        '- 主角底线：不牺牲无辜。',
        '- 伤害后果：责任必须可见。',
        '- 和解条件：先有修复行动。',
        '- 救赎条件：持续付出代价。',
        '- 允许余地：善良与克制可以成立。',
        '## 本书专属毒点',
        '- 不用旁白直接揭谜。',
        '## 节奏与兑现参数',
        '统计对象：主线发生不可逆变化的章节。',
        '使用目的：让主线推进保持可观察且不靠固定套路。',
        '失效条件：进入终局兑现阶段后改用终局清算标准。',
        '本书配额：每三章推进一次主线。',
      ].join('\n'),
      知识选择: [{ 维度: '题材', 名称: '玄幻', 来源: '作者自定义' }],
      作者已确认: true,
    }),
    'utf8'
  )
  const pb = await node(vendoredBin, ['persist-book', '--file=建书.json'])
  check(pb.stdout.includes('已登记为当前书'), '建书并登记为当前书（vendored bin）')
  check(await exists(path.join(workdir, '雪落长安', 'book.yaml')), '书仓库 book.yaml')
  check(await exists(path.join(workdir, '雪落长安', 'AGENTS.md')), '书仓库指路 AGENTS.md')
  check(await exists(path.join(workdir, '雪落长安', '作品契约', '作品契约.md')), '书仓库作品契约真源')
  check(await exists(path.join(workdir, '雪落长安', '作品契约', '知识选择记录.md')), '书仓库知识选择记录')

  // 5. next --json → 序6 起草第 1 章
  const nx = await node(vendoredBin, ['next', '--json'])
  const dto = JSON.parse(nx.stdout)
  check(dto.序 === 6 && dto.dto.nextChapter === 1, `next 判定起草第 1 章（实际：序${dto.序}）`)

  // 6. update 幂等重跑
  const up = await node(installedBin, ['update'])
  check(/升级完成|安装完成/.test(up.stdout), 'update 幂等可重跑')
  const afterUpdateSettings = JSON.parse(await fs.readFile(path.join(workdir, '.claude/settings.json'), 'utf8'))
  check(
    JSON.stringify(afterUpdateSettings.hooks.PreToolUse) === JSON.stringify(userPreToolUse),
    'update 保留用户自有 PreToolUse',
  )
  check(
    Array.isArray(afterUpdateSettings.hooks.SessionStart)
      && afterUpdateSettings.hooks.SessionStart.length === 1,
    'update 不重复安装 SessionStart',
  )

  if (failed) {
    console.error('\n安装链路 e2e 存在失败项')
    process.exit(1)
  }
  console.log('\n安装链路 e2e 全通过：pack → 安装 → 中文路径 init → 建书 → next → update')
} catch (err) {
  console.error(`安装链路 e2e 异常：${err.message}`)
  if (err.stdout) console.error(err.stdout)
  if (err.stderr) console.error(err.stderr)
  process.exit(1)
} finally {
  for (const d of cleanups) {
    try {
      await fs.rm(d, { recursive: true, force: true, maxRetries: 3 })
    } catch {
      // 临时目录清理尽力而为
    }
  }
}
