/**
 * Run the actual installed package through DSH's native tool pipeline, without a model.
 * Copy this file into the main-only install-smoke directory before executing it:
 *
 * node issue-213-installed.mjs <profile> <host-package.json> <blocked-source> <report.json> [expected-version]
 *
 * The profile and host must belong to an install-smoke directory, not a user profile.
 * Optional Node permission flags must allow that directory, the Node installation,
 * trusted native addons and child processes (the fixture invokes Git). Source denial
 * is reported separately; trusted Git subprocesses are not an OS sandbox proof.
 * Installed-file versus tarball comparison belongs to the caller's artifact check.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
assert.ok(args.length === 4 || args.length === 5,
  'Usage: node issue-213-installed.mjs <profile> <host-package.json> <blocked-source> <report.json> [expected-version]')
const [profile, hostAnchor, blockedSource, reportPath] = args.slice(0, 4).map(value => path.resolve(value))
const expectedVersion = args[4] ?? '8.4.1-preview.1'
const isolationRoot = path.resolve(profile, '../../..')
const sourceRoot = path.resolve(path.dirname(blockedSource), '../../..')
const within = (parent, target) => {
  const relative = path.relative(parent, target)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
const hash = value => createHash('sha256').update(value).digest('hex')
const errorText = error => error instanceof Error ? error.stack ?? error.message : String(error)

assert.ok(within(isolationRoot, hostAnchor), 'Use the host installed by install-smoke')
assert.ok(within(isolationRoot, reportPath), 'Keep probe evidence inside the isolated installation')
assert.ok(within(isolationRoot, fileURLToPath(import.meta.url)), 'Copy the probe into the isolated installation')
assert.ok(!within(sourceRoot, isolationRoot) && isolationRoot !== sourceRoot, 'The installation must be outside the source checkout')
assert.equal(path.dirname(profile), path.join(isolationRoot, 'home', 'profiles'))
assert.equal(JSON.parse(fs.readFileSync(path.join(isolationRoot, 'host', 'package.json'), 'utf8')).name, 'scriptor-isolated-host')
assert.equal(fs.existsSync(reportPath), false, 'Use a new report path; do not overwrite earlier evidence')
const sourceReadDenied = process.permission?.has('fs.read', blockedSource) === false
if (sourceReadDenied) assert.throws(() => fs.readFileSync(blockedSource), { code: 'ERR_ACCESS_DENIED' })

// This is a separate fixture process. Never inherit the author's DSH homes or Git overrides.
for (const key of Object.keys(process.env)) if (/^(DSH_|GIT_)|^AGENTS_HOME$|^NODE_PATH$/i.test(key)) delete process.env[key]
Object.assign(process.env, {
  DSH_HOME: path.join(isolationRoot, 'home'), DSH_AGENTS_HOME: path.join(isolationRoot, 'agents'),
  DSH_TELEMETRY_DISABLED: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1',
})
const workspace = fs.mkdtempSync(path.join(path.dirname(reportPath), 'issue213-workspace-'))
const emptyGitConfig = path.join(workspace, 'empty-gitconfig')
fs.writeFileSync(emptyGitConfig, '')
process.env.GIT_CONFIG_GLOBAL = emptyGitConfig
process.chdir(workspace)

const require = createRequire(hostAnchor)
const packageRequire = createRequire(path.join(profile, 'package.json'))
const packageEntry = packageRequire.resolve('@linfengqaqtat/dsh-scriptor')
const packageManifest = packageRequire.resolve('@linfengqaqtat/dsh-scriptor/package.json')
assert.ok(within(isolationRoot, fs.realpathSync.native(packageEntry)), 'The tested entry must be installed in isolation')
const manifest = JSON.parse(fs.readFileSync(packageManifest, 'utf8'))
assert.equal(manifest.name, '@linfengqaqtat/dsh-scriptor')
assert.equal(manifest.version, expectedVersion)
const hostManifest = JSON.parse(fs.readFileSync(hostAnchor, 'utf8'))
const report = {
  ok: false, node: process.version, hostVersion: hostManifest.version,
  installed: { name: manifest.name, version: manifest.version, entry: packageEntry, entrySha256: hash(fs.readFileSync(packageEntry)) },
  actualLoader: false, actualToolPipeline: false, modelCalls: 0, sourceReadDenied,
  isolationScope: 'Node filesystem grants when enabled; trusted native addons and Git subprocesses are not an OS sandbox proof',
  workspace, checks: {},
}
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
save()

function snapshot(root) {
  const entries = []
  const visit = relative => {
    const absolute = path.join(root, relative), stat = fs.lstatSync(absolute)
    assert.equal(stat.isSymbolicLink(), false, `Unexpected link in synthetic book: ${relative}`)
    if (stat.isDirectory()) {
      entries.push([`${relative}/`, 'directory'])
      for (const name of fs.readdirSync(absolute).sort()) visit(relative ? `${relative}/${name}` : name)
    } else {
      assert.ok(stat.isFile(), `Unexpected special file in synthetic book: ${relative}`)
      entries.push([relative, stat.size, hash(fs.readFileSync(absolute))])
    }
  }
  visit('')
  return entries
}

function syntheticBook(name, bookId, unknownReceipt) {
  const root = path.join(workspace, name)
  fs.mkdirSync(path.join(root, '作品契约'), { recursive: true })
  fs.writeFileSync(path.join(root, '作品契约', '契约.md'),
    `---\n书id: ${bookId}\n书仓格式版本: 1\n版本: 1\n状态: 待确认\n---\n\n# 合成诊断书仓\n\n只用于验证维护阻断的工具返回值。\n`)
  fs.writeFileSync(path.join(root, '.gitignore'), '草稿区/\n.webnovel/\n')
  const git = (...rest) => execFileSync('git', ['--no-optional-locks', ...rest], {
    cwd: root, env: process.env, encoding: 'utf8', windowsHide: true, timeout: 15000,
  }).trim()
  git('init', '--quiet', '--initial-branch=main')
  git('config', 'user.name', 'Scriptor installed-package test')
  git('config', 'user.email', 'scriptor-test@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'core.autocrlf', 'false')
  git('config', 'core.hooksPath', '.git/hooks')
  git('add', '--', '.gitignore', '作品契约/契约.md')
  git('commit', '--quiet', '-m', 'fixture: synthetic issue 213 book')
  const head = git('rev-parse', 'HEAD')
  if (unknownReceipt) {
    const directory = path.join(root, '草稿区', '.maintenance-receipts')
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, '.DS_Store'), 'synthetic unknown receipt entry\n')
  }
  assert.equal(git('status', '--porcelain=v1'), '')
  return { root, bookId, head }
}

let ctx, writing, offQuestions
const failures = []
let completed = false
let questions = 0
try {
  report.phase = 'prepare-synthetic-books'; save()
  const receiptBook = syntheticBook('receipt-blocker', 'issue213-receipt', true)
  const gitBook = syntheticBook('git-unavailable', 'issue213-git', false)
  assert.equal(fs.existsSync(path.join(gitBook.root, '草稿区', '.maintenance-receipts')), false)
  const emptyPath = path.join(workspace, 'empty-path')
  fs.mkdirSync(emptyPath)

  report.phase = 'boot-installed-package'; save()
  const { boot, PluginPackages } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href)
  const resolution = JSON.parse(fs.readFileSync(path.join(profile, 'scriptor-probe-resolution.json'), 'utf8'))
  const hostPlugin = (id, name, config) => ({ id, name: pathToFileURL(require.resolve(name)).href, ...(config ? { config } : {}) })
  const config = [
    hostPlugin('llm', '@deepseek-ai/dsh-llm'),
    hostPlugin('session', '@deepseek-ai/dsh-session'),
    hostPlugin('agent', '@deepseek-ai/dsh-agent'),
    hostPlugin('system-prompt', '@deepseek-ai/dsh-system-prompt'),
    hostPlugin('tools', '@deepseek-ai/dsh-tools'),
    hostPlugin('tool-executor-native', '@deepseek-ai/dsh-tool-executor-native'),
    hostPlugin('fs', '@deepseek-ai/dsh-fs-local', { cwd: workspace }),
    hostPlugin('working-directory', '@deepseek-ai/dsh-working-directory', { defaultDirectory: workspace }),
    hostPlugin('skills', '@deepseek-ai/dsh-skill'),
    hostPlugin('session-projection', '@deepseek-ai/dsh-session-projection'),
    hostPlugin('agent-loop', '@deepseek-ai/dsh-agent-loop'),
    hostPlugin('user-questions', '@deepseek-ai/dsh-user-questions'),
    { id: 'webnovel', name: pathToFileURL(packageEntry).href, config: { autoIndexOnCommit: false } },
    hostPlugin('agent-preset-registry', '@deepseek-ai/dsh-agent-preset-registry', { default: 'scriptor' }),
    hostPlugin('preset-scriptor', '@deepseek-ai/dsh-agent-preset', { id: 'scriptor', name: '写作模式', plugins: [
      { id: 'scriptor-agent', name: pathToFileURL(packageRequire.resolve('@linfengqaqtat/dsh-scriptor/preset')).href, isolate: { webnovelWriting: true } },
    ] }),
  ]
  const configPath = path.join(workspace, 'loader.json')
  fs.writeFileSync(configPath, JSON.stringify(config))
  ctx = await boot('issue213-installed', configPath, [], async host => {
    await host.plugin(PluginPackages, { resolution })
  })
  report.actualLoader = true
  offQuestions = ctx.on('user-questions/request', () => {
    questions++
    throw new Error('A readonly preview must not ask for author approval')
  })
  writing = await ctx.get('agents').create({ sessionId: 'issue213-installed', meta: { cwd: workspace, agentPreset: 'scriptor' },
    setup: async scope => { await scope.get('agentPresets').mount(scope, 'scriptor') },
  })
  const tools = ctx.get('tools')
  assert.ok(tools.schemas(writing.agent).some(tool => tool.name === 'novel_preview_book_upgrade'), 'The installed writing Agent must register the preview tool')

  const checkPreview = async (name, book, expectedCode) => {
    report.phase = name; save()
    // Include every business, hidden and Git file, directory and membership in both books.
    const before = [snapshot(receiptBook.root), snapshot(gitBook.root)]
    const evidence = { ok: false, expectedCode, snapshots: { before },
      beforeSha256: hash(JSON.stringify(before)), includesHiddenFilesAndGit: true }
    report.checks[name] = evidence
    save()
    const batch = await tools.execute({ agent: writing.agent, signal: new AbortController().signal,
      calls: [{ type: 'tool-call', id: `issue213-${name}`, name: 'novel_preview_book_upgrade', arguments: JSON.stringify({ bookId: book.bookId }) }],
    })
    evidence.batch = batch
    save()
    const after = [snapshot(receiptBook.root), snapshot(gitBook.root)]
    evidence.snapshots.after = after
    evidence.afterSha256 = hash(JSON.stringify(after))
    evidence.bookBytesUnchanged = evidence.afterSha256 === evidence.beforeSha256
    save()
    assert.equal(batch.results?.length, 1)
    const result = batch.results[0].result
    assert.equal(result.isError, false, JSON.stringify(result))
    report.actualToolPipeline = true
    assert.equal(result.value?.ok, true, JSON.stringify(result))
    assert.equal(result.value.state, 'blocked')
    assert.equal(result.value.bookId, book.bookId)
    assert.deepEqual(result.value.changes, [])
    assert.equal(Object.hasOwn(result.value, 'fingerprint'), false)
    assert.ok(result.value.issues.some(issue => issue.代码 === expectedCode), JSON.stringify(result.value.issues))
    assert.deepEqual(after, before, 'A preview changed synthetic book or Git bytes')
    assert.equal(questions, 0)
    evidence.ok = true
    save()
    return result.value
  }

  const receipt = await checkPreview('unknown-receipt', receiptBook, 'UPGRADE_PREVIEW_FAILED')
  assert.equal(receipt.baseHead, receiptBook.head)
  assert.equal(Object.hasOwn(receipt, 'inspectionBefore'), false)
  assert.equal(Object.hasOwn(receipt, 'inspectionAfter'), false)
  assert.ok(receipt.issues.some(issue => /维护收据目录含未知或非普通文件/.test(issue.说明)))

  // A missing executable exercises the same unavailable-capability result, without
  // pretending to reproduce a particular old Git version or changing user config.
  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
  const originalPath = process.env[pathKey]
  try {
    process.env[pathKey] = emptyPath
    const unavailable = spawnSync('git', ['--version'], { cwd: workspace, env: process.env, encoding: 'utf8', windowsHide: true })
    assert.equal(unavailable.error?.code, 'ENOENT', 'The synthetic PATH must make Git unavailable')
    const value = await checkPreview('git-unavailable', gitBook, 'OPENING_GIT_READONLY_UNAVAILABLE')
    assert.equal(Object.hasOwn(value, 'baseHead'), false)
    assert.equal(fs.existsSync(path.join(gitBook.root, '草稿区', '.maintenance-receipts')), false)
  } finally {
    if (originalPath === undefined) delete process.env[pathKey]
    else process.env[pathKey] = originalPath
  }
  report.authorQuestions = questions
  completed = true
  delete report.phase
} catch (error) {
  failures.push(error)
  report.error = errorText(error)
} finally {
  for (const dispose of [() => offQuestions?.(), () => writing?.dispose(), () => ctx?.fiber.dispose()]) {
    try { await dispose() } catch (error) {
      failures.push(error)
      const cleanupErrors = report.cleanupErrors ??= []
      cleanupErrors.push(errorText(error))
    }
  }
  report.ok = completed && failures.length === 0
  try { save() } catch (error) {
    failures.push(error)
    report.ok = false
    console.error(`Could not save probe evidence: ${errorText(error)}`)
  }
  console.log(JSON.stringify({ ok: report.ok, report: reportPath, version: manifest.version, checks: Object.keys(report.checks) }))
}
if (failures.length) throw failures[0]
