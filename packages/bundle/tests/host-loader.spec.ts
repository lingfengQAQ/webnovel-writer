import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { promisify } from 'node:util'
import { removeSync } from '../../core/src/repo/remove'
import { loadSourceHost } from '../scripts/dsh-source.mjs'
import { linkFixtureDependencies } from './fixtures/fixture-dependencies.mjs'

const run = promisify(execFile)
const packageRoot = path.resolve(__dirname, '..')
const checks = [
  '真实 Loader 与基线版本',
  '主 Agent 工具与全局隔离',
  '子 Agent 工具拒绝与真实 never 策略',
  '真实问答拒绝受委派调用',
  '作者裁决与本次调用绑定',
  'Loader 卸载重载等价',
  '随包技能发现、资源、覆盖优先级与卸载重载',
  '运行时归属优先于历史 origin',
  '同一会话恢复后重新装机',
  '问答依赖卸载与重载',
  '审批依赖晚到仍拒绝子 Agent',
  '真实文件工具动作授权与审计',
  '文件动作预取消与等待中取消',
  '作者裁决预取消与迟到批准',
  '工作区注册、别名与非法 cwd',
  '裁决服务失败不写真源',
  '真实提案与补偿提交',
  '七类设计文件复用原生观察与 design 提交',
  '作者保存和落盘前并发修改使旧观察失效',
  '读观察按会话隔离且普通嵌套调用不能绕过门禁',
  '原生写入后提交失败可原样重跑且不重复升版',
  '多文件改稿保留事务且不拆成原生单文件写入',
  '纯处置保留证据、拒绝旧记录并允许上游保留',
  '记忆目录会话开始快照与选书目录',
  '补充原文预览保存、恢复审读与源变化失效',
  '最小导出合集清单、范围冲突与确定重跑',
  '当前宿主中文候选生成编辑确认与失败恢复',
  '定稿检索真实权限、关键词与原文定位',
  '独立嵌入提供方真实 HTTP 混合检索与配置刷新',
  '嵌入提供方卸载、晚到与取消不污染缓存',
  '宿主场景模型、独立缓存与可选重排完整接线',
  '工作区依赖重启交回旧根',
  '原生文件工具对子 Agent 的边界',
  '工具服务重启后重新装机',
  '原生对话恢复后继续',
] as const

interface LoaderReport {
  node: string
  checks: Record<string, { ok: boolean; error?: string }>
  [key: string]: unknown
}

let root: string
let report: LoaderReport

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-loader-'))
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace)
  const source = process.env['WEBNOVEL_DSH_SOURCE']
  if (source === undefined) {
    linkFixtureDependencies(packageRoot, root)
  } else {
    const host = loadSourceHost(source)
    fs.mkdirSync(path.join(root, 'node_modules', '@deepseek-ai'), { recursive: true })
    for (const name of ['cordis', 'dsh-tools', 'dsh-llm', 'dsh-credentials', 'dsh-skill-filesystem']) {
      fs.symlinkSync(host.get(`@deepseek-ai/${name}`).directory, path.join(root, 'node_modules', '@deepseek-ai', name), 'junction')
    }
  }
  const outfile = path.join(root, 'lib', 'webnovel.mjs')
  fs.cpSync(path.join(packageRoot, 'skills'), path.join(root, 'skills'), { recursive: true })
  await build({
    entryPoints: {
      'lib/webnovel': path.join(packageRoot, 'src', 'index.ts'),
      'native-write-core': path.join(packageRoot, 'tests/fixtures/native-write-core.ts'),
      'embedding-provider': path.join(packageRoot, '../embedding-provider/src/index.ts'),
    },
    outdir: root,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-credentials', '@deepseek-ai/dsh-skill-filesystem', 'node:*'],
    legalComments: 'none',
    banner: { js: "import { createRequire as __createRequire } from 'node:module'\nconst require = __createRequire(import.meta.url)" },
  })
  const result = await run(process.execPath, [
    path.join(packageRoot, 'tests', 'fixtures', 'host-loader.mjs'), root, outfile,
  ], {
    cwd: workspace,
    env: { ...process.env, DSH_HOME: path.join(root, '.dsh'), DSH_AGENTS_HOME: path.join(root, '.agents'), DSH_TELEMETRY_DISABLED: '1' },
    timeout: 60_000,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  })
  report = JSON.parse(fs.readFileSync(path.join(root, 'report.json'), 'utf8')) as LoaderReport
  const reportPath = process.env['WEBNOVEL_LOADER_REPORT']
  if (reportPath !== undefined) fs.writeFileSync(path.resolve(reportPath), JSON.stringify({ ...report, stdout: result.stdout, stderr: result.stderr }, null, 2))
  expect(result.stderr).not.toContain('UNHANDLED')
}, 70_000)

afterAll(() => {
  if (root === undefined) return
  // removeSync uses lstat and unlinks package junctions without following them.
  removeSync(root)
})

describe('真实 DSH Loader 验收（独立进程）', () => {
  for (const name of checks) {
    it(name, () => {
      expect(report.checks[name], report.checks[name]?.error).toEqual({ ok: true })
    })
  }
})
