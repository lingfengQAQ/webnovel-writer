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
import { buildCli } from '../scripts/build-cli.mjs'

const run = promisify(execFile)
const packageRoot = path.resolve(__dirname, '..')
const checks = [
  '写作能力停用与技能依赖中断期间即时撤销',
  '空白切换与同名预设代际保持隔离',
  '写作模式与普通模式并存且普通文件遵循宿主路径',
  '真实 Loader 与基线版本',
  '主 Agent 工具与全局隔离',
  '子 Agent 工具拒绝且保留宿主审批策略',
  '真实问答拒绝受委派调用',
  '作者裁决与本次调用绑定',
  'Loader 卸载重载等价',
  '随包技能发现、资源、覆盖优先级与卸载重载',
  '运行时归属优先于历史 origin',
  '同一会话恢复后重新装机',
  '问答依赖卸载与重载',
  '审批依赖重启不改写会话策略',
  '真实文件工具动作授权与审计',
  '当前目录变更与恢复不改变书仓保护或同级目录',
  '文件动作预取消与等待中取消',
  '作者裁决预取消与迟到批准',
  '工作区注册、别名与非法 cwd',
  '裁决服务失败不写真源',
  '只读开章与主动检查不增加状态调用或书仓写入',
  '真实提案与补偿提交',
  '七类设计文件复用原生观察与 design 提交',
  '作者保存和落盘前并发修改使旧观察失效',
  '读观察按会话隔离且普通嵌套调用不能绕过门禁',
  '原生写入后提交失败可原样重跑且不重复升版',
  '多文件改稿保留事务且不拆成原生单文件写入',
  '纯处置保留证据、拒绝旧记录并允许上游保留',
  '记忆目录会话开始快照与选书目录',
  '补充原文预览保存、恢复审读与源变化失效',
  '参考小说真实文件服务、配置模型与私有原文边界',
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

function linkHostDependencies(fixtureRoot: string) {
  const source = process.env['WEBNOVEL_DSH_SOURCE']
  if (source === undefined) {
    linkFixtureDependencies(packageRoot, fixtureRoot)
  } else {
    const host = loadSourceHost(source)
    fs.mkdirSync(path.join(fixtureRoot, 'node_modules', '@deepseek-ai'), { recursive: true })
    for (const name of ['cordis', 'dsh-tools', 'dsh-tool-executor-native', 'dsh-llm', 'dsh-credentials', 'dsh-skill-filesystem']) {
      fs.symlinkSync(host.get(`@deepseek-ai/${name}`).directory, path.join(fixtureRoot, 'node_modules', '@deepseek-ai', name), 'junction')
    }
  }
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-loader-'))
  const workspace = path.join(root, 'workspace')
  fs.mkdirSync(workspace)
  linkHostDependencies(root)
  const outfile = path.join(root, 'lib', 'webnovel.mjs')
  fs.cpSync(path.join(packageRoot, 'skills'), path.join(root, 'skills'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
  await buildCli(path.join(root, 'lib/cli.js'))
  await build({
    entryPoints: {
      'lib/webnovel': path.join(packageRoot, 'src', 'index.ts'),
      'lib/preset': path.join(packageRoot, 'src', 'preset.ts'),
      'native-write-core': path.join(packageRoot, 'tests/fixtures/native-write-core.ts'),
      'embedding-provider': path.join(packageRoot, '../embedding-provider/src/index.ts'),
      scenes: path.join(packageRoot, '../embedding-provider/src/scenes.ts'),
      reranking: path.join(packageRoot, '../embedding-provider/src/reranking.ts'),
    },
    outdir: root,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-tool-executor-native', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-credentials', '@deepseek-ai/dsh-skill-filesystem', 'node:*'],
    legalComments: 'none',
    banner: { js: "import { createRequire as __createRequire } from 'node:module'\nconst require = __createRequire(import.meta.url)" },
  })
  const result = await run(process.execPath, [
    path.join(packageRoot, 'tests', 'fixtures', 'host-loader.mjs'), root, outfile,
  ], {
    cwd: workspace,
    env: { ...process.env, DSH_HOME: path.join(root, '.dsh'), DSH_AGENTS_HOME: path.join(root, '.agents'), DSH_TELEMETRY_DISABLED: '1' },
    // The shared process runs 35 integration scenarios, including native settings
    // reloads and local HTTP. Keep a total bound without treating it as one test.
    timeout: 90_000,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  }).catch((error: unknown) => {
    const partialPath = path.join(root, 'report.json')
    const partial = fs.existsSync(partialPath) ? fs.readFileSync(partialPath, 'utf8') : '(report not created)'
    const reportPath = process.env['WEBNOVEL_LOADER_REPORT']
    if (reportPath !== undefined) fs.writeFileSync(path.resolve(reportPath), partial)
    const failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    throw new Error(`Loader process failed: ${failure}\nLast progress report:\n${partial}`, { cause: error })
  })
  report = JSON.parse(fs.readFileSync(path.join(root, 'report.json'), 'utf8')) as LoaderReport
  const reportPath = process.env['WEBNOVEL_LOADER_REPORT']
  if (reportPath !== undefined) fs.writeFileSync(path.resolve(reportPath), JSON.stringify({ ...report, stdout: result.stdout, stderr: result.stderr }, null, 2))
  expect(result.stderr).not.toContain('UNHANDLED')
}, 100_000)

afterAll(() => {
  if (root === undefined) return
  // removeSync uses lstat and unlinks package junctions without following them.
  removeSync(root)
})

describe('真实 DSH Loader 验收（独立进程）', () => {
  it('整仓升级通过真实问答批准，失败续办不重复写入，收据拒绝原生改写', async () => {
    const upgradeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-maintenance-loader-'))
    try {
      linkHostDependencies(upgradeRoot)
      for (const file of ['embedding-provider.mjs', 'scenes.mjs', 'reranking.mjs']) fs.copyFileSync(path.join(root, file), path.join(upgradeRoot, file))
      fs.cpSync(path.join(packageRoot, 'skills'), path.join(upgradeRoot, 'skills'), { recursive: true })
      const result = await run(process.execPath, [path.join(packageRoot, 'tests/fixtures/host-loader.mjs'), upgradeRoot, path.join(root, 'lib/webnovel.mjs'), 'book-upgrade'], {
        cwd: upgradeRoot, env: { ...process.env, DSH_HOME: path.join(upgradeRoot, '.dsh'), DSH_AGENTS_HOME: path.join(upgradeRoot, '.agents'), DSH_TELEMETRY_DISABLED: '1' },
        timeout: 60_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024,
      }).catch(error => { throw new Error(fs.readFileSync(path.join(upgradeRoot, 'report.json'), 'utf8'), { cause: error }) })
      const outcome = JSON.parse(fs.readFileSync(path.join(upgradeRoot, 'report.json'), 'utf8'))
      expect(outcome.checks['整仓升级真实批准、失败续办和收据保护'], outcome.checks['整仓升级真实批准、失败续办和收据保护']?.error).toEqual({ ok: true })
      expect(outcome.maintenanceUpgrade).toEqual({ readonlyPreview: true, authorQuestions: 3, rejectedBeforeWrite: true, pendingCommit: true, resumeWithoutRewrite: true, repeatWithoutCommit: true, receiptProtected: true, delegatedToolsDenied: true })
      report.maintenanceUpgrade = outcome.maintenanceUpgrade
      const reportPath = process.env['WEBNOVEL_LOADER_REPORT']
      if (reportPath) fs.writeFileSync(path.resolve(reportPath), JSON.stringify({ ...report, maintenanceUpgradeLoader: { ...outcome, stdout: result.stdout, stderr: result.stderr } }, null, 2))
    } finally { removeSync(upgradeRoot) }
  }, 70_000)
  it('原生草稿统计、PTC、取消、隔离与恢复', async () => {
    const feedbackRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-draft-length-'))
    try {
      linkHostDependencies(feedbackRoot)
      for (const file of ['native-write-core.mjs', 'embedding-provider.mjs', 'scenes.mjs', 'reranking.mjs']) fs.copyFileSync(path.join(root, file), path.join(feedbackRoot, file))
      fs.mkdirSync(path.join(feedbackRoot, 'lib'))
      fs.copyFileSync(path.join(root, 'lib/preset.mjs'), path.join(feedbackRoot, 'lib/preset.mjs'))
      fs.cpSync(path.join(packageRoot, 'skills'), path.join(feedbackRoot, 'skills'), { recursive: true })
      await run(process.execPath, [path.join(packageRoot, 'tests/fixtures/host-loader.mjs'), feedbackRoot, path.join(root, 'lib/webnovel.mjs'), 'draft-length'], {
        cwd: feedbackRoot, env: { ...process.env, DSH_HOME: path.join(feedbackRoot, '.dsh'), DSH_AGENTS_HOME: path.join(feedbackRoot, '.agents'), DSH_TELEMETRY_DISABLED: '1' },
        timeout: 45000, windowsHide: true, maxBuffer: 2 * 1024 * 1024,
      }).catch(error => { throw new Error(fs.readFileSync(path.join(feedbackRoot, 'report.json'), 'utf8'), { cause: error }) })
      const result = JSON.parse(fs.readFileSync(path.join(feedbackRoot, 'report.json'), 'utf8'))
      expect(Object.keys(result.checks)).toHaveLength(5)
      for (const entry of Object.values(result.checks) as Array<{ ok: boolean; error?: string }>) expect(entry, entry.error).toEqual({ ok: true })
      expect(result.draftLength).toMatchObject({ childReceipts: 3, reviewMatches: true, partialExcluded: true, quarantine: true, ptcReceivedOnce: true, lifecycle: true, historyRestored: true })
    } finally { removeSync(feedbackRoot) }
  }, 60000)

  it('#167 作者保存后重复空操作结束轮次，新的作者委托仍可正常修改', async () => {
    const loopRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webnovel-save-loop-'))
    try {
      linkHostDependencies(loopRoot)
      for (const file of ['native-write-core.mjs', 'embedding-provider.mjs', 'scenes.mjs', 'reranking.mjs']) fs.copyFileSync(path.join(root, file), path.join(loopRoot, file))
      await run(process.execPath, [path.join(packageRoot, 'tests/fixtures/host-loader.mjs'), loopRoot, path.join(root, 'lib/webnovel.mjs'), 'save-loop'], {
        cwd: loopRoot, env: { ...process.env, DSH_HOME: path.join(loopRoot, '.dsh'), DSH_AGENTS_HOME: path.join(loopRoot, '.agents'), DSH_TELEMETRY_DISABLED: '1' },
        timeout: 45000, windowsHide: true, maxBuffer: 2 * 1024 * 1024,
      })
      const result = JSON.parse(fs.readFileSync(path.join(loopRoot, 'report.json'), 'utf8'))
      expect(result.checks['保存后的重复空操作终止且下一轮可修改']).toEqual({ ok: true })
      expect(result.saveLoop).toMatchObject({ repeatedTurnRequests: 3, totalRequests: 6, noExtraCommit: true, nextTurnChanged: true })
      expect(result.saveInspection).toMatchObject({ notificationReceived: true, nativeReadCalls: 2, impactReferences: ['大纲/故事骨架.md'], noAutomaticWrites: true })
    } finally { removeSync(loopRoot) }
  }, 60000)

  for (const name of checks) {
    it(name, () => {
      expect(report.checks[name], report.checks[name]?.error).toEqual({ ok: true })
    })
  }
})
