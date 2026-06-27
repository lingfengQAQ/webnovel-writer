#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeHostShells, generateHostShells } from '../src/host-shells/generate.js'
import { driftCheck } from '../src/host-shells/validator.js'

// scripts/ → 上一级是 v7 包根
const v7 = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const getOpt = (k) => {
  const a = args.find((x) => x.startsWith(`${k}=`))
  return a ? a.slice(k.length + 1) : undefined
}

async function main() {
  if (has('--check')) {
    const r = await driftCheck(v7)
    if (!r.ok) {
      console.error(`drift check 失败：${r.error}`)
      process.exit(1)
    }
    console.log('drift check 通过：生成器确定 + validator 通过')
    return
  }

  const target = getOpt('--target') || 'all'
  const distDir = path.join(v7, 'dist')
  const all = await generateHostShells(v7)
  const hosts = target === 'all' ? Object.keys(all) : [target]
  for (const host of hosts) {
    if (!all[host]) {
      console.error(`未知宿主：${target}（可选：${Object.keys(all).join('、')}）`)
      process.exit(1)
    }
  }
  await writeHostShells(v7, distDir)
  console.log(`已生成宿主壳到 dist/：${hosts.join('、')}`)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
