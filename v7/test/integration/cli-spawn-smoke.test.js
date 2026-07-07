import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tempV6, inlineFixture } from '../migrate/_v6.js'

const exec = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BIN = path.join(__dirname, '../../bin/webnovel-writer.js')
const fixtureRoot = path.join(__dirname, '../fixtures/sample-book')

/**
 * G-6：M6/M7 新命令的 bin spawn 冒烟——参数解析、exitCode、错误人话（不带栈）。
 * 全走真子进程；finally 的 rm 兼作 cache.close 探针（db 未关 Windows 会 EBUSY/EPERM）。
 */

test('bin spawn 冒烟：export 单章（书仓库直启）+ 坏参数人话退出', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-spawn-book-'))
  await fs.cp(fixtureRoot, repo, { recursive: true })
  const run = (args) => exec(process.execPath, [BIN, ...args], { cwd: repo, encoding: 'utf8' })
  try {
    const r = await run(['export', '1'])
    assert.match(r.stdout, /第0001章-开局\.txt/)
    const exported = await fs.readFile(path.join(repo, '工作区', '导出', '第0001章-开局.txt'), 'utf8')
    assert.ok(exported.length > 0)
    assert.ok(!exported.startsWith('---'), '导出应剥 front matter')

    const err = await run(['export', 'abc']).then(
      () => null,
      (e) => e
    )
    assert.ok(err, '坏参数应非零退出')
    assert.equal(err.code, 1)
    assert.match(err.stderr, /用法/)
    assert.ok(!/\n\s+at /.test(err.stderr), `错误不带栈：${err.stderr}`)
  } finally {
    await fs.rm(repo, { recursive: true, force: true })
  }
})

test('bin spawn 冒烟：migrate v6 项目（工作目录）+ 缺参数人话退出', async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-spawn-workdir-'))
  await fs.mkdir(path.join(workdir, '.webnovel'), { recursive: true })
  const v6 = await tempV6(inlineFixture)
  const run = (args) => exec(process.execPath, [BIN, ...args], { cwd: workdir, encoding: 'utf8' })
  try {
    const r = await run(['migrate', v6.v6Path])
    assert.match(r.stdout, /迁移报告/)
    await fs.access(path.join(workdir, '剑碎虚空', 'book.yaml'))
    await fs.access(path.join(workdir, '剑碎虚空', '工作区', '迁移报告.md'))

    const err = await run(['migrate']).then(
      () => null,
      (e) => e
    )
    assert.ok(err, '缺参数应非零退出')
    assert.equal(err.code, 1)
    assert.match(err.stderr, /用法/)
    assert.ok(!/\n\s+at /.test(err.stderr), `错误不带栈：${err.stderr}`)
  } finally {
    await fs.rm(workdir, { recursive: true, force: true })
    await v6.cleanup()
  }
})
