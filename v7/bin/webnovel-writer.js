#!/usr/bin/env node

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { CacheManager } from '../src/cache/index.js'
import { checkNodeVersion } from '../src/runtime/node-version.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 版本门槛先行（M0 起的不变量；纯比较在 node-version.js，副作用留这里）
const gate = checkNodeVersion(process.version)
if (!gate.ok) {
  console.error(gate.message)
  process.exit(1)
}

const argv = process.argv.slice(2)
const command = argv[0]

if (command === '--version' || command === '-v') {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  console.log(pkg.version)
  process.exit(0)
}

if (!command || command === '--help') {
  console.log('用法：webnovel-writer <命令> [选项]')
  console.log('')
  console.log('精准读取接口（41 个，分布于 21 个命令；逐条清单见任务 prd.md AC2）：')
  console.log('  read-chapter <章号> [--front-matter|--tail=N|--head=N|--摘要]')
  console.log('  read-chapters [--range=a-b --摘要|--recent=N --tail=M]')
  console.log('  list-chapters --章定位=推进 [--卷=N]')
  console.log('  read-thread <ID> [--履历|--收尾计划|--描述]')
  console.log('  list-threads [--悬了太久|--type=<t> [--status=<s>]|--strength=<强>]')
  console.log('  read-timeline [--current-and-prev|--current-volume|--卷=N|--在场=名]')
  console.log('  read-character <正名> [--front-matter|--section=<标题>]')
  console.log('  resolve-alias <别名>')
  console.log('  list-characters [--status=<状态>]')
  console.log('  read-worldview --section=<标题>')
  console.log('  read-secret <ID> [--基本信息|--内容]')
  console.log('  list-secrets [--reader-knows=false]')
  console.log('  read-outline [--总纲 [--section=<标题>|--结局]|--卷=N [--section=<标题>]]')
  console.log('  list-volumes')
  console.log('  grep-story <关键词> [--regex=<pattern>]')
  console.log('  report-overdue-threads | report-secret-accumulation | report-thread-activity --卷=N')
  console.log('  report-weak-hook-streak | report-book-stats | report-style-drift')
  console.log('')
  console.log('写章流程（M2，零 AI 脚本面）：')
  console.log('  prepare-chapter <章号>                  备料：写出 工作区/本章写作材料.md')
  console.log('  mechanical-check <章号> [--draft=<路径>]  机检：字数/禁词/禁句式/复读/新专名/信息差候选')
  console.log('')
  console.log('状态机 / 例外流程（M3）：')
  console.log('  next                                    继续：状态机判定下一步（git 健康检查先行）')
  console.log('  impact <关键词>                          影响分析：哪些章建立在这个事实上（已发布/未发布）')
  console.log('  goto-chapter <章号> [--confirm]          回到第N章（先备份再回滚，作者不碰 git）')
  process.exit(0)
}

// 解析选项与位置参数：--key=value → {key:value}，--flag → {flag:true}
function parseArgs(rest) {
  const options = {}
  const positionalArgs = []
  for (const arg of rest) {
    if (arg.startsWith('--')) {
      const m = arg.match(/^--([^=]+)(?:=(.*))?$/)
      if (m) options[m[1]] = m[2] !== undefined ? m[2] : true
    } else {
      positionalArgs.push(arg)
    }
  }
  return { options, positionalArgs }
}

let cache
try {
  const commandPath = path.join(__dirname, '../src/commands', `${command}.js`)
  const commandUrl = new URL(`file:///${commandPath.replace(/\\/g, '/')}`).href
  const mod = await import(commandUrl)

  const { options, positionalArgs } = parseArgs(argv.slice(1))

  const repoPath = process.cwd() // M3 状态机后续处理工作目录定位
  cache = new CacheManager(path.join(repoPath, '.cache', 'index.db'))
  await cache.ensureReady(repoPath)

  const result = await mod.run(positionalArgs, options, { repoPath, cache })
  if (result.ok) {
    if (result.output) console.log(result.output)
    process.exitCode = 0
  } else {
    console.error(result.error)
    process.exitCode = 1
  }
} catch (err) {
  if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'ENOENT') {
    console.error(`未知命令「${command}」。运行 webnovel-writer --help 查看可用命令。`)
    process.exitCode = 1
  } else {
    // 永不带栈崩溃（错误规范 §1）
    console.error(`执行命令「${command}」时出错：${err.message}`)
    process.exitCode = 1
  }
} finally {
  if (cache) await cache.close() // 显式关闭，避免 Windows 文件锁
}
