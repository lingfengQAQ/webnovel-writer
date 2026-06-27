#!/usr/bin/env node

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 解析命令行参数
const args = process.argv.slice(2)
const command = args[0]

if (!command || command === '--help') {
  console.log('用法：webnovel-writer <命令> [选项]')
  console.log('')
  console.log('可用命令：')
  console.log('  read-chapter <章号> [--front-matter|--tail=N|--head=N]')
  console.log('  read-thread <条目ID> [--fields=基本信息|--履历|--收尾计划|--描述]')
  console.log('  read-timeline [--current-and-prev|--卷=N|--在场=名]')
  console.log('  read-character <正名> [--front-matter|--section=标题]')
  console.log('  resolve-alias <别名>')
  console.log('  list-threads [--悬了太久|--type=<t>|--status=<s>]')
  console.log('  report-overdue-threads')
  console.log('  ... (更多命令见文档)')
  process.exit(0)
}

// 动态 import 命令模块
try {
  const commandPath = path.join(__dirname, '../src/commands', `${command}.js`)
  const commandUrl = new URL(`file:///${commandPath.replace(/\\/g, '/')}`).href
  const commandModule = await import(commandUrl)

  // 解析选项（简化实现：--key=value 或 --flag）
  const options = {}
  const positionalArgs = []

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      const match = arg.match(/^--([^=]+)(?:=(.*))?$/)
      if (match) {
        const key = match[1]
        const value = match[2] !== undefined ? match[2] : true
        options[key] = value
      }
    } else {
      positionalArgs.push(arg)
    }
  }

  // 执行命令
  await commandModule.execute(positionalArgs, options)
} catch (err) {
  if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'ENOENT') {
    console.error(`未知命令「${command}」。`)
    console.error('运行 webnovel-writer --help 查看可用命令。')
    process.exit(1)
  }

  // 其他错误
  console.error(`执行命令「${command}」时出错：`)
  console.error(err.message)
  process.exit(1)
}
