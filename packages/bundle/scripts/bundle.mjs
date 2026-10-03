/**
 * 打成单文件 ESM 产物,供 dsh 以原生 ESM 直接加载。
 *
 * 只构建插件入口 lib/index.js 一份产物；技能脚本（skills 下各 scripts 目录的 .mjs）
 * 是手写薄入口（R21／裁决 A1,2026-09-05）——运行能力经相对引 lib/index.js,构建尾部
 * 只做接缝校验,不再内联任何 core 副本进 skills/。
 *
 * 为什么必须打包(2026-09-01 真机冒烟实证):
 * dsh 用原生 ESM `import()` 吃插件入口,而 Node 的 ESM 解析器不补全扩展名;
 * 本仓 tsconfig 走 moduleResolution: "Bundler",源码里 229 处相对导入都无扩展名,
 * 且 `@webnovel/core` 是源码直引 —— dsh 端没有 node_modules/@webnovel/*。
 * 直接把 dsh-local.yml 指向 src/index.ts 会以 ERR_MODULE_NOT_FOUND 加载失败。
 * 单文件产物同时解掉这两条:相对导入全部内联,跨包依赖一并内联。
 * 形态对齐 dsh 自身插件(@deepseek-ai/dsh-skill-filesystem:main=lib/index.js,产物内零相对导入)。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isBuiltin } from 'node:module'
import * as esbuild from 'esbuild'
import { writeNotices } from '../../../scripts/release/notices.mjs'
import { thinScripts as THIN_SCRIPTS } from './artifact-contract.mjs'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))

/** dsh 宿主提供的服务面,不进产物。 */
const EXTERNAL = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-skill-filesystem', 'node:*']

function checkDependencies(result) {
  for (const output of Object.values(result.metafile.outputs)) {
    for (const entry of output.imports.filter(entry => entry.external)) {
      if (!isBuiltin(entry.path) && !manifest.peerDependencies?.[entry.path] && !manifest.dependencies?.[entry.path]) {
        throw new Error(`未声明产物运行依赖: ${entry.path}`)
      }
    }
  }
  const shared = /node_modules\/(?:@deepseek-ai\/(?:cordis|dsh-tools|dsh-llm|dsh-skill-filesystem)\/|react\/)/
  for (const input of Object.keys(result.metafile.inputs)) {
    if (shared.test(input.replaceAll('\\', '/'))) throw new Error(`共享运行时被内联: ${input}`)
  }
}

async function buildEntry(entry, outfile) {
  const result = await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22.19',
    format: 'esm',
    external: EXTERNAL,
    sourcemap: false,
    legalComments: 'inline',
    logLevel: 'warning',
    metafile: true,
    // 内联的 CJS 依赖(yaml@2.9.0)内部 require('process') 会落到 esbuild 的 __require
    // 垫片上并在运行时抛 "Dynamic require of X is not supported"(2026-09-01 真机实证)。
    // 注入真 require 让这类调用回到 Node 内置解析。
    banner: {
      js: [
        "import { createRequire as __createRequire } from 'node:module'",
        'const require = __createRequire(import.meta.url)',
      ].join('\n'),
    },
  })
  const bytes = fs.statSync(outfile).size
  checkDependencies(result)
  const inlined = Object.keys(result.metafile.inputs).length
  console.log(`[bundle] ${path.relative(packageRoot, outfile)} ok (${(bytes / 1024).toFixed(1)} KB, 内联 ${inlined} 个模块)`)
  const leftover = /from\s*["']\.[^"']*["']/.exec(fs.readFileSync(outfile, 'utf8'))
  if (leftover !== null) throw new Error(`产物残留相对导入:${leftover[0]}`)
  console.log(`[bundle] 自检:产物内零相对导入 (${path.relative(packageRoot, outfile)})`)
  return result
}

const hostBuild = await buildEntry(path.join(packageRoot, 'src', 'index.ts'), path.join(packageRoot, 'lib', 'index.js'))

// DSH's native client module loader supplies the shared React runtime.
const clientBuild = await esbuild.build({
  entryPoints: [path.join(packageRoot, 'src', 'client', 'index.tsx')],
  outfile: path.join(packageRoot, 'lib', 'client.js'),
  platform: 'browser', format: 'cjs', bundle: true, external: ['react'], target: 'chrome110',
  loader: { '.css': 'text' }, minify: true, legalComments: 'inline', metafile: true,
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => { const module = { exports: {} }; const exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
})
checkDependencies(clientBuild)
console.log('[bundle] lib/client.js ok (DSH native client module)')

/**
 * 技能脚本薄入口接缝校验（R21／裁决 A1）。
 *
 * 脚本产物形态已定：skills 下各 scripts 目录的 .mjs 是**手写薄入口**（进 git），运行能力
 * 经相对引插件根 `lib/index.js`，不再由本构建内联 core 副本。这里逐个校验薄入口与 lib
 * 的接缝（入口存在／引 lib／lib 导出对应能力），防止「删了 re-export、脚本只在运行时才炸」。
 */
const libText = fs.readFileSync(path.join(packageRoot, 'lib', 'index.js'), 'utf8')
for (const [rel, fn] of THIN_SCRIPTS) {
  const abs = path.join(packageRoot, ...rel.split('/'))
  if (!fs.existsSync(abs)) throw new Error(`脚本薄入口缺失:${rel}`)
  const text = fs.readFileSync(abs, 'utf8')
  if (!text.includes('lib/index.js')) throw new Error(`脚本薄入口未引 lib/index.js(违背裁决 A1):${rel}`)
  if (!libText.includes(fn)) throw new Error(`lib/index.js 未导出 ${fn},薄入口将无法加载:${rel}`)
}
console.log(`[bundle] 脚本薄入口接缝校验 ok (${THIN_SCRIPTS.length} 个薄入口 -> lib/index.js)`)

writeNotices(packageRoot, [hostBuild, clientBuild])
// Vendored diagram artwork is source input rather than an npm dependency.
fs.appendFileSync(path.join(packageRoot, 'THIRD_PARTY_NOTICES.md'), '\n## Archify artwork\n\nWriting workflow geometry and semantic styling derive from Archify 3.0.1 (MIT).\nCopyright (c) 2026 tt-a1i (Archify); Copyright (c) 2025 Cocoon AI.\n[Original notice](licenses/archify.txt). Source: https://github.com/tt-a1i/archify\n')
