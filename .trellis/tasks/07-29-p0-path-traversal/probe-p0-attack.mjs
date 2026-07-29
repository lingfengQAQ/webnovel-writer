/**
 * P0 路径穿越修复 端到端攻击探针（implement.md S6）
 * 走真实 CLI bin + 真 git 书仓，三条攻击样例：
 *   A) finalize payload secretWrites[1].id = "../../x"
 *   B) finalize payload timelineRows[1].volumeNum = "../../x"
 *   C) persist-volume-review 伏笔条目 id = "../../x"
 * 期望：人话拒绝、git status 干净、仓外零写入零建目录。
 */
import { spawnSync } from 'node:child_process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)

const v7 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'v7')
const BIN = path.join(v7, 'bin', 'webnovel-writer.js')
const sampleBook = path.join(v7, 'test', 'fixtures', 'sample-book')

// 复用测试侧的绑定器生成带令牌的审稿输入（finalize 的 sha256 令牌门卫要求）
const { writeReviewArtifacts } = await import(
  pathToFileURL(path.join(v7, 'test', 'staging', '_helper.js')).href
)
import { pathToFileURL } from 'node:url'

const lines = []
const LOG_PATH = fileURLToPath(new URL('./probe-p0-attack-output.txt', import.meta.url))
const say = (s = '') => { lines.push(s); console.log(s) }
process.on('exit', () => {
  try { writeFileSync(LOG_PATH, lines.join('\n') + '\n', 'utf8') } catch { /* 日志尽力而为 */ }
})

function cli(args, cwd) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' })
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}
async function main() {
  // —— 造书：sample-book 拷到临时目录 + git init ——
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-p0-probe-'))
  const repo = path.join(sandbox, '书仓')
  const outside = path.join(sandbox, '仓外')
  await fs.cp(sampleBook, repo, { recursive: true })
  await fs.mkdir(outside, { recursive: true })
  await fs.writeFile(path.join(repo, '.gitignore'), '.cache/\n工作区/\n', 'utf8')
  const g = (args) => execFileAsync('git', args, { cwd: repo })
  await g(['init', '-q'])
  await g(['config', 'core.quotepath', 'false'])
  await g(['config', 'user.email', 'probe@example.com'])
  await g(['config', 'user.name', 'probe'])
  await g(['add', '-A'])
  await g(['commit', '-q', '-m', 'init'])
  const { stdout: revBefore } = await g(['rev-list', '--count', 'HEAD'])
  say(`书仓就位：${repo}`)
  say(`初始 commit 数：${revBefore.trim()}`)

  // —— 正常两审工件（finalize 的前置，含 sha256 令牌绑定）——
  // （由各攻击/回归用例在定稿前各自重建，因为每次 finalize 会消费工作区工件）

  const basePayload = {
    chapterNum: 3,
    frontMatter: {
      章号: 3, 标题: '探针章', 卷: 1, 视角: '林晚', 字数: 100,
      章定位: '推进', 钩子: '危机钩-强', 情绪定位: '铺垫',
    },
    body: '探针正文。\n', summary: '探针摘要。', commitLines: {}, workspaceFiles: [],
  }

  const attacks = [
    {
      name: 'A) secretWrites[1].id 路径穿越',
      make: () => ({
        ...basePayload,
        secretWrites: [
          { id: '信息差-001-正常', frontMatter: { 强度: '高' }, content: '## 内容\nx' },
          { id: '../../x', frontMatter: { 强度: '高' }, content: '## 内容\nx' },
        ],
      }),
      expect: [/secretWrites\[1\]\.id/, /非法/],
    },
    {
      name: 'B) timelineRows[1].volumeNum 路径穿越',
      make: () => ({
        ...basePayload,
        timelineRows: [{ volumeNum: 1, row: { 章: 3, 书内时间: 't', 一句话事件: 'e', 在场: 'x' } },
                       { volumeNum: '../../x', row: { 章: 3, 书内时间: 't', 一句话事件: 'e', 在场: 'x' } }],
      }),
      expect: [/timelineRows\[1\]\.volumeNum/, /正整数/],
    },
  ]

  let pass = 0, fail = 0
  for (const atk of attacks) {
    say(`\n=== ${atk.name} ===`)
    const payload = atk.make()
    await writeReviewArtifacts(repo, 3, [], [], payload)
    const payloadPath = path.join(sandbox, 'attack.json')
    await fs.writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8')
    const r = cli(['finalize', '3', `--payload=${payloadPath}`], repo)
    say(`退出码：${r.code}`)
    say(`输出：${r.out.trim()}`)
    const rejectOk = r.code === 1 && atk.expect.every((re) => re.test(r.out))
    const { stdout: status } = await g(['status', '--porcelain'])
    const cleanOk = status.trim() === ''
    const { stdout: revAfter } = await g(['rev-list', '--count', 'HEAD'])
    const revOk = revAfter.trim() === revBefore.trim()
    let outsideOk = true
    for (const p of ['x.md', path.join('..', '..', 'x.md')]) {
      try { await fs.access(path.join(repo, p)); outsideOk = false } catch { /* 期望不存在 */ }
    }
    try { await fs.readdir(outside) } catch { /* 仓外目录本身在 */ }
    const outsideFiles = (await fs.readdir(outside)).filter((f) => f === 'x.md' || f.startsWith('第'))
    if (outsideFiles.length) outsideOk = false
    say(`人话拒绝：${rejectOk ? '✓' : '✗'}  git干净：${cleanOk ? '✓' : '✗'}  零提交：${revOk ? '✓' : '✗'}  仓外零残留：${outsideOk ? '✓' : '✗'}`)
    if (rejectOk && cleanOk && revOk && outsideOk) pass++
    else fail++
  }

  // —— C) 卷复盘伏笔 id 攻击 ——
  say('\n=== C) persist-volume-review 伏笔条目 id 路径穿越 ===')
  {
    const specPath = path.join(sandbox, 'vol.json')
    await fs.writeFile(specPath, JSON.stringify({
      卷号: 1, 卷摘要: '收束。',
      伏笔条目: [{ id: '../../x', frontMatter: { 状态: '埋设' }, body: 'x' }],
    }, null, 2), 'utf8')
    const r = cli(['persist-volume-review', `--file=${specPath}`], repo)
    say(`退出码：${r.code}`)
    say(`输出：${r.out.trim()}`)
    const rejectOk = r.code === 1 && /伏笔条目/.test(r.out) && /伏笔-NNN/.test(r.out)
    const { stdout: status } = await g(['status', '--porcelain'])
    const cleanOk = status.trim() === ''
    let outsideOk = true
    try { await fs.access(path.join(repo, '..', 'x.md')); outsideOk = false } catch { /* 期望不存在 */ }
    const volSummaryMissing = await fs.access(path.join(repo, '定稿', '摘要', '卷摘要', '第01卷.md')).then(() => false, () => true)
    say(`人话拒绝：${rejectOk ? '✓' : '✗'}  git干净：${cleanOk ? '✓' : '✗'}  零摘要写入：${volSummaryMissing ? '✓' : '✗'}  仓外零残留：${outsideOk ? '✓' : '✗'}`)
    if (rejectOk && cleanOk && volSummaryMissing && outsideOk) pass++
    else fail++
  }

  // —— D) 合法定稿回归（探针不只证明拒绝，也证明没把书搞残）——
  say('\n=== D) 合法定稿回归 ===')
  {
    await writeReviewArtifacts(repo, 3, [], [], basePayload)
    const payloadPath = path.join(sandbox, 'ok.json')
    await fs.writeFile(payloadPath, JSON.stringify(basePayload, null, 2), 'utf8')
    const r = cli(['finalize', '3', `--payload=${payloadPath}`], repo)
    const ok = r.code === 0 && (await fs.readFile(path.join(repo, '定稿', '正文', '0003-探针章.md'), 'utf8')).includes('探针正文')
    say(`退出码：${r.code}  正常定稿：${ok ? '✓' : '✗'}  ${r.out.trim().split('\n')[0]}`)
    if (ok) pass++
    else fail++
  }

  say(`\n探针结果：${pass} 过 / ${fail} 挂`)
  await fs.rm(sandbox, { recursive: true, force: true })
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { say(`探针自身故障：${e.stack}`); process.exit(2) })
