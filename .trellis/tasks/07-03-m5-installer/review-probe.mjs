// M1-M5 review 行为探针：真 CLI 子进程跑边角流程,验证代码层疑点。跑完自删临时目录。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)
const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'webnovel-writer.js')

const workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-probe-'))
await fs.mkdir(path.join(workdir, '.webnovel'), { recursive: true })
const run = async (args, expectFail = false) => {
  try {
    const r = await exec(process.execPath, [BIN, ...args], { cwd: workdir, encoding: 'utf8' })
    return { code: 0, out: r.stdout, err: r.stderr }
  } catch (e) {
    if (!expectFail) console.error(`命令失败 ${args.join(' ')}:\n${e.stderr || e.message}`)
    return { code: e.code ?? 1, out: e.stdout || '', err: e.stderr || '' }
  }
}
const j = async (name, data) => {
  const p = path.join(workdir, name)
  await fs.writeFile(p, JSON.stringify(data), 'utf8')
  return p
}
const repo = path.join(workdir, '测')

try {
  // 建书 + 定稿两章
  const f建 = await j('建书.json', { book: { spec_version: '7.0', 书名: '测', 卷规模: 40, 体检周期: 50 }, 总纲: '# 总纲\n## 结局\nx', 卷纲: '# 第1卷\ny' })
  await run(['persist-book', `--file=${f建}`])
  for (const n of [1, 2]) {
    const fp = await j(`定稿${n}.json`, {
      frontMatter: { 章号: n, 标题: `第${n}章`, 卷: 1, 字数: 10, 章定位: '推进' },
      body: `第${n}章正文。`, summary: `摘要${n}`, commitLines: {}, workspaceFiles: [],
    })
    const r = await run(['finalize', String(n), `--payload=${fp}`])
    if (!r.out.includes('已定稿')) console.error(`定稿${n}失败: ${r.err}`)
  }

  // 探针1：卷复盘产物落盘后 next → 是否误触序2
  const f卷 = await j('卷复盘.json', { 卷号: 1, 卷摘要: '# 第01卷复盘\n清账。', 下卷卷纲: '# 第2卷\nz', 伏笔条目: [{ id: '伏笔-001-试', frontMatter: { id: '伏笔-001', 短题: '试', 状态: '进行', 开启章: 2 }, body: '收尾计划:第10章' }] })
  const pv = await run(['persist-volume-review', `--file=${f卷}`])
  console.log(`persist-volume-review: ${pv.code === 0 ? 'ok' : pv.err}`)
  const n1 = await run(['next', '--json'])
  const s1 = JSON.parse(n1.out)
  console.log(`探针1 卷复盘后 next → 序${s1.序} ${s1.state}  ${s1.序 === 2 ? '【误触序2 确认】' : ''}`)

  // 探针1b：新伏笔条目在缓存里可见吗（陈旧性）
  const lt = await run(['list-threads'], true)
  console.log(`探针1b 卷复盘新伏笔 list-threads 可见: ${lt.out.includes('伏笔-001') ? '可见' : '【不可见=缓存陈旧 确认】'}`)

  // 收拾：把卷复盘产物 commit 掉,让探针2 干净
  const git = (a) => exec('git', a, { cwd: repo })
  await git(['add', '-A'])
  await git(['commit', '-q', '-m', 'vol(1): probe'])

  // 探针2：goto-chapter 1 --confirm 后 next → 起草第几章
  const g = await run(['goto-chapter', '1', '--confirm'])
  console.log(`goto: ${(g.out || g.err).split('\n')[0]}`)
  const n2 = await run(['next', '--json'])
  const s2 = JSON.parse(n2.out)
  const next2 = s2.dto ? s2.dto.nextChapter : undefined
  console.log(`探针2 回到第1章后 next → 序${s2.序} nextChapter=${next2}  ${next2 === 3 ? '【缓存领先,起草错章 确认】' : next2 === 2 ? '正常' : `state=${s2.state}`}`)

  // 探针3：手改一个已跟踪文件 → next 序2 → 有无补登通道
  await fs.appendFile(path.join(repo, '大纲', '总纲.md'), '\n作者手改。', 'utf8')
  const n3 = await run(['next', '--json'])
  const s3 = JSON.parse(n3.out)
  console.log(`探针3 手改后 next → 序${s3.序} ${s3.state} message=${s3.message} dto=${JSON.stringify(s3.dto)}`)
} finally {
  await fs.rm(workdir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
}
