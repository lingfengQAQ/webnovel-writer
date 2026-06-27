#!/usr/bin/env node
// CLI 入口：版本门槛先行，再分发子命令。M0 子命令均为占位，不实现业务逻辑。
import { readFileSync } from 'node:fs'
import { checkNodeVersion } from '../src/runtime/node-version.js'

const gate = checkNodeVersion(process.version)
if (!gate.ok) {
  process.stderr.write(gate.message + '\n')
  process.exit(1)
}

const command = process.argv[2]
switch (command) {
  case '--version':
  case '-v':
    process.stdout.write(readPackageVersion() + '\n')
    break
  case 'init':
  case 'update':
    process.stdout.write(`「${command}」尚未实现（M0 骨架占位）。\n`)
    break
  case undefined:
    process.stdout.write('用法：webnovel-writer <init|update>\n')
    break
  default:
    process.stderr.write(`未知命令「${command}」。可用：init、update。\n`)
    process.exit(1)
}

function readPackageVersion() {
  const pkgUrl = new URL('../package.json', import.meta.url)
  const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8'))
  return pkg.version
}
