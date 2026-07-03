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

const cleanups = []
try {
  // 1. pack（发布产物 = npx 消费的同一份包内容）
  const packDest = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-pack-'))
  cleanups.push(packDest)
  const packOut = await npm(['pack', '--pack-destination', packDest], { cwd: pkgRoot })
  const tgzName = packOut.stdout.trim().split('\n').at(-1).trim()
  const tgz = path.join(packDest, tgzName)
  check(await exists(tgz), `npm pack 产物：${tgzName}`)

  // 2. 装进干净沙箱
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-sandbox-'))
  cleanups.push(sandbox)
  await npm(['install', tgz, '--prefix', sandbox, '--no-audit', '--no-fund'], { cwd: sandbox })
  const installedBin = path.join(sandbox, 'node_modules', 'webnovel-writer', 'bin', 'webnovel-writer.js')
  check(await exists(installedBin), '安装产物 bin 存在')

  // 3. 中文用户名模拟路径里 init（一条命令装出工作目录）
  const base = await fs.mkdtemp(path.join(os.tmpdir(), '中文用户名-'))
  cleanups.push(base)
  const workdir = path.join(base, '工作目录')
  await fs.mkdir(workdir, { recursive: true })
  const node = (bin, args) =>
    exec(process.execPath, [bin, ...args], { cwd: workdir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })

  const init = await node(installedBin, ['init', '--hosts=claude-code,codex'])
  console.log('--- init 报告 ---\n' + init.stdout + '-----------------')
  for (const rel of [
    '.webnovel/bin/webnovel-writer.js',
    '.webnovel/node_modules/js-yaml/package.json',
    '.webnovel/manifest.json',
    '.webnovel/books.jsonl',
    '.claude/skills/webnovel-writer/SKILL.md',
    '.claude/agents/事实审查.md',
    '.claude/settings.json',
    '.codex/agents/事实审查.toml',
    'AGENTS.md',
  ]) {
    check(await exists(path.join(workdir, rel)), `init 布局：${rel}`)
  }

  // 4. vendored bin 建第一本书（干净环境一条命令装出并建书 = AC1 链路）
  const vendoredBin = path.join(workdir, '.webnovel', 'bin', 'webnovel-writer.js')
  await fs.writeFile(
    path.join(workdir, '建书.json'),
    JSON.stringify({
      book: { spec_version: '7.0', 书名: '雪落长安', 卷规模: 40, 体检周期: 50 },
      总纲: '# 总纲\n## 结局\n终成一代大家。',
      卷纲: '# 第1卷\n初入长安。',
    }),
    'utf8'
  )
  const pb = await node(vendoredBin, ['persist-book', '--file=建书.json'])
  check(pb.stdout.includes('已登记为当前书'), '建书并登记为当前书（vendored bin）')
  check(await exists(path.join(workdir, '雪落长安', 'book.yaml')), '书仓库 book.yaml')
  check(await exists(path.join(workdir, '雪落长安', 'AGENTS.md')), '书仓库指路 AGENTS.md')

  // 5. next --json → 序6 起草第 1 章
  const nx = await node(vendoredBin, ['next', '--json'])
  const dto = JSON.parse(nx.stdout)
  check(dto.序 === 6 && dto.dto.nextChapter === 1, `next 判定起草第 1 章（实际：序${dto.序}）`)

  // 6. update 幂等重跑
  const up = await node(installedBin, ['update'])
  check(/升级完成|安装完成/.test(up.stdout), 'update 幂等可重跑')

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
