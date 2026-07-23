import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { minimalCreateBookPayload } from '../state-machine/_helper.js'

const exec = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BIN = path.join(__dirname, '../../bin/webnovel-writer.js')

/**
 * M5 出口判据 D2（AC5）：写章八阶段每一步走宿主可调的 CLI 通道,全程子进程 spawn bin,
 * 零进程内调用。建书 → next → 细纲 → 草稿 → 备料 → 机检 → 审稿输入 → 两审入库 → 定稿 → next 不重抄。
 * 路径含中文（工作目录名/书名）,兼做中文路径链路探针。
 */
test('主循环全程 CLI：建书→写1章→两审→定稿→next 报第2章', async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-cli-工作目录-'))
  const run = (args, opts = {}) =>
    exec(process.execPath, [BIN, ...args], { cwd: workdir, encoding: 'utf8', ...opts })
  const runFail = async (args) => {
    try {
      await run(args)
      return null
    } catch (err) {
      return err
    }
  }

  try {
    // 0. 模拟已安装的工作目录（安装器落位前的最小标记;init 集成随第 3 步任务补 CI 全链路）
    await fs.mkdir(path.join(workdir, '.webnovel'), { recursive: true })

    // 1. 空工作目录 next --json → 序1 建书引导（经真 bin,不是进程内）
    const r1 = await run(['next', '--json'])
    const s1 = JSON.parse(r1.stdout)
    assert.equal(s1.序, 1)
    assert.equal(s1.state, 'create-book')

    // 2. 建书（persist-book --file）→ 登记为当前书
    await fs.writeFile(
      path.join(workdir, '建书.json'),
      JSON.stringify(minimalCreateBookPayload({
        book: { 书名: '青云试剑', 卷规模: 40, 体检周期: 50 },
        总纲: '# 总纲\n## 结局\n林晚登顶。',
        卷纲: '# 第1卷\n入门与试炼。',
      })),
      'utf8'
    )
    const r2 = await run(['persist-book', '--file=建书.json'])
    assert.ok(r2.stdout.includes('已登记为当前书'), r2.stdout)
    const repo = path.join(workdir, '青云试剑')
    await fs.access(path.join(repo, 'book.yaml'))
    await fs.access(path.join(repo, 'AGENTS.md'))

    // 3. list-books 看到当前书
    const r3 = await run(['list-books'])
    assert.ok(r3.stdout.includes('青云试剑'))

    // 4. next --json → 序6 起草第 1 章（建书产物已随 init commit,不误触序2 手改）
    const r4 = await run(['next', '--json'])
    const s4 = JSON.parse(r4.stdout)
    assert.equal(s4.序, 6, `建书后应序6,实际:${r4.stdout}`)
    assert.equal(s4.dto.nextChapter, 1)

    // 5. 细纲回流（persist-outline --file）
    await fs.writeFile(
      path.join(workdir, '细纲.json'),
      JSON.stringify({ 细纲: '## 本章要写到的事\n林晚初入青云宗,得玉佩。\n' }),
      'utf8'
    )
    await run(['persist-outline', `--file=${path.join(workdir, '细纲.json')}`])
    await fs.access(path.join(repo, '工作区', '细纲.md'))

    // 6. 备料 + 草稿 + 机检（草稿是 AI 产物,落工作区不经 CLI）
    const r6 = await run(['prepare-chapter', '1'])
    assert.ok(r6.stdout.includes('本章写作材料'), r6.stdout)
    const chapterFrontMatter = {
      章号: 1,
      标题: '初入青云',
      卷: 1,
      字数: 30,
      章定位: '铺垫',
      钩子: '悬念钩-中',
      情绪定位: '铺垫',
    }
    await fs.writeFile(
      path.join(repo, '工作区', '草稿-A.md'),
      [
        '---',
        '章号: 1',
        '标题: 初入青云',
        '卷: 1',
        '字数: 30',
        '章定位: 铺垫',
        '钩子: 悬念钩-中',
        '情绪定位: 铺垫',
        '---',
        '林晚背着行囊踏入青云宗山门,腰间玉佩微微发烫。',
      ].join('\n'),
      'utf8'
    )
    const r6b = await run(['mechanical-check', '1'])
    const mc = JSON.parse(r6b.stdout)
    assert.ok('pass' in mc && Array.isArray(mc.issues))

    // 7. 审稿输入 → 两审（桩产物）入库
    const r7 = await run(['review-input', '1'])
    assert.ok(r7.stdout.includes('审稿输入.json'))
    const input = JSON.parse(await fs.readFile(path.join(repo, '工作区', '审稿输入.json'), 'utf8'))
    assert.equal(input.章号, 1)
    await fs.writeFile(
      path.join(workdir, '两审.json'),
      JSON.stringify({
        审稿输入令牌: input.审稿输入令牌,
        事实审查: { 审稿输入令牌: input.审稿输入令牌, chapter: 1, issues: [] },
        编辑审: { 审稿输入令牌: input.审稿输入令牌, chapter: 1, issues: [] },
        章摘要: '林晚入宗,玉佩异动。',
      }),
      'utf8'
    )
    const r7b = await run(['save-review', '1', `--file=${path.join(workdir, '两审.json')}`])
    assert.ok(r7b.stdout.includes('0 个阻断'), r7b.stdout)
    await fs.access(path.join(repo, '工作区', '审稿.md'))

    // 8. 定稿（finalize --payload）→ 正文入档、工作区清理
    await fs.writeFile(
      path.join(workdir, '定稿包.json'),
      JSON.stringify({
        frontMatter: chapterFrontMatter,
        body: '林晚背着行囊踏入青云宗山门,腰间玉佩微微发烫。',
        summary: '林晚入宗,玉佩异动。',
        commitLines: {},
        workspaceFiles: ['工作区/草稿-A.md', '工作区/细纲.md', '工作区/审稿输入.json', '工作区/审稿.md', '工作区/本章写作材料.md'],
      }),
      'utf8'
    )
    const r8 = await run(['finalize', '1', `--payload=${path.join(workdir, '定稿包.json')}`])
    assert.ok(r8.stdout.includes('已定稿'), r8.stdout)
    await fs.access(path.join(repo, '定稿', '正文', '0001-初入青云.md'))
    await fs.access(path.join(repo, '定稿', '摘要', '章摘要', '0001.md'))
    await assert.rejects(fs.access(path.join(repo, '工作区', '草稿-A.md')), '定稿后草稿应清理')

    // 9. next --json → 序6 起草第 2 章（定稿刷新缓存,不重抄第 1 章）
    const r9 = await run(['next', '--json'])
    const s9 = JSON.parse(r9.stdout)
    assert.equal(s9.序, 6, `定稿后应序6,实际:${r9.stdout}`)
    assert.equal(s9.dto.nextChapter, 2, '定稿后 next 应起草第 2 章(不重抄)')

    // 10. 换书人话报错路径：switch-book 不存在的书 → 退出码非零 + 候选
    const err = await runFail(['switch-book', '不存在的书'])
    assert.ok(err, '应失败退出')
    assert.ok(String(err.stderr).includes('青云试剑'), `候选应含现有书:${err.stderr}`)
  } finally {
    await fs.rm(workdir, { recursive: true, force: true })
  }
})
