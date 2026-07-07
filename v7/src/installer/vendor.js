import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

/**
 * vendoring：把运行时复制进 .webnovel/（spec §2.0——工作目录自包含,离线可跑,版本可诊断）。
 * 只产 {相对 workdir 路径: 内容} 的文件集,不直接写盘——统一走安装器的哈希三态写入。
 * 复制源 = 当前运行的包根;js-yaml 及其传递依赖从本包的解析位置递归收集。
 */

const RUNTIME_ENTRIES = ['bin', 'src', 'roles', 'references', 'package.json']

/** 文件集/清单键统一正斜杠：清单跨平台可移植（双平台 CI、网盘搬家不失配） */
const posix = (p) => p.split(path.sep).join('/')

export async function collectRuntimeFiles(packageRoot) {
  const files = {}
  for (const entry of RUNTIME_ENTRIES) {
    await collectInto(files, path.join(packageRoot, entry), `.webnovel/${entry}`)
  }
  await collectDependency(files, 'js-yaml', new Set())
  return files
}

/** 递归收集一个 npm 依赖及其 production 传递依赖到 .webnovel/node_modules/<name>/ */
async function collectDependency(files, name, seen) {
  if (seen.has(name)) return
  seen.add(name)
  const require = createRequire(import.meta.url)
  let pkgJsonPath
  try {
    pkgJsonPath = require.resolve(`${name}/package.json`)
  } catch {
    throw new Error(`找不到运行时依赖 ${name}（安装包不完整）`)
  }
  const pkgDir = path.dirname(pkgJsonPath)
  await collectInto(files, pkgDir, `.webnovel/node_modules/${name}`, {
    skip: (rel) => rel === 'node_modules' || rel.startsWith(`node_modules${path.sep}`),
  })
  const pkg = JSON.parse(await fs.readFile(pkgJsonPath, 'utf8'))
  for (const dep of Object.keys(pkg.dependencies || {})) {
    await collectDependency(files, dep, seen)
  }
}

async function collectInto(files, srcPath, destRel, { skip } = {}) {
  const stat = await fs.stat(srcPath)
  if (stat.isFile()) {
    files[destRel] = await fs.readFile(srcPath, 'utf8')
    return
  }
  const walk = async (dir, relBase) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const rel = relBase ? path.join(relBase, e.name) : e.name
      if (skip && skip(rel)) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) await walk(full, rel)
      else if (e.isFile()) files[`${destRel}/${posix(rel)}`] = await fs.readFile(full, 'utf8')
    }
  }
  await walk(srcPath, '')
}
