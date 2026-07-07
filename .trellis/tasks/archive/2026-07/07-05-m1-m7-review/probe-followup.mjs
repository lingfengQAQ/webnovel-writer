// 补充探针：P-4b 重号章文件（序 0 拦不住的静默截断）、P-7b finalize 清理目录（正确相对路径）
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const V7 = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'v7')
const m = (p) => import(`file:///${path.join(V7, p).replace(/\\/g, '/')}`)

const { persistCreateBook } = await m('src/state-machine/persist.js')
const { finalizeChapter } = await m('src/finalize/index.js')
const { determineNextState } = await m('src/state-machine/index.js')
const { CacheManager } = await m('src/cache/index.js')
const { createGit } = await m('src/finalize/git.js')

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-probe2-'))
let n = 0
async function makeBook() {
  const repo = path.join(tmpRoot, `book-${++n}`)
  await fs.mkdir(repo, { recursive: true })
  const r = await persistCreateBook({ repoPath: repo, cache: null }, {
    book: { spec_version: '7.0', 书名: `补探${n}`, 类型: '玄幻', 每章目标字数: 3000, 卷规模: 40 },
    总纲: '# 总纲\n\n## 结局\nx\n', 卷纲: '# 第1卷\ny\n',
  })
  if (!r.ok) throw new Error(r.error)
  const cache = new CacheManager(path.join(repo, '.cache', 'index.db'))
  await cache.ensureReady(repo)
  return { repoPath: repo, cache }
}
const payloadOf = (num, extra = {}) => ({
  chapterNum: num,
  frontMatter: { 章号: num, 标题: `第${num}章题`, 卷: 1, 书内时间: `夏月初${num}`, 字数: 100, 章定位: '推进', 钩子: '危机钩-强', 情绪定位: '铺垫' },
  body: `第${num}章正文。`, summary: `摘${num}`, commitLines: {}, workspaceFiles: [], ...extra,
})

// P-4b: 同章号两个合法文件 → 序 0 不拦 → INSERT 撞主键被吞 → MAX 偏小 → next 重抄
try {
  const ctx = await makeBook()
  for (const c of [1, 2, 3]) await finalizeChapter(ctx, payloadOf(c))
  const chDir = path.join(ctx.repoPath, '定稿', '正文')
  // 手改场景：作者复制了一份第 3 章改标题（两文件 front matter 均合法、同章号）
  const f3 = (await fs.readdir(chDir)).find((f) => f.startsWith('0003-'))
  await fs.copyFile(path.join(chDir, f3), path.join(chDir, '0003-旧稿备份.md'))
  const rb = await ctx.cache.rebuildFromSource(ctx.repoPath)
  const max = (await ctx.cache.query('SELECT MAX(chapter_num) AS m FROM chapters', []))[0].m
  const next = await determineNextState(ctx)
  console.log(`P-4b 重号章: rebuild.ok=${rb.ok} warnings=${JSON.stringify(rb.warnings || [])} MAX=${max} next序=${next.序} nextChapter=${next.dto?.nextChapter}`)
  console.log(max === 2 && next.dto?.nextChapter === 3 ? '【CONFIRMED】静默丢章+指向重抄已存在的第3章' : `【部分/REFUTED】看上行`)
  await ctx.cache.close()
} catch (e) { console.log(`P-4b 异常: ${e.message}`) }

// P-7b: workspaceFiles 含目录（正确相对路径）→ rm 无 recursive
try {
  const ctx = await makeBook()
  await fs.mkdir(path.join(ctx.repoPath, '工作区', '评审报告'), { recursive: true })
  await fs.writeFile(path.join(ctx.repoPath, '工作区', '评审报告', 'a.md'), 'x', 'utf8')
  const r = await finalizeChapter(ctx, payloadOf(1, { workspaceFiles: ['评审报告'] }))
  const committed = await createGit(ctx.repoPath).findChapterCommit(1)
  const dirLeft = await fs.access(path.join(ctx.repoPath, '工作区', '评审报告')).then(() => true, () => false)
  console.log(`P-7b 清理目录: finalize.ok=${r.ok} err=${(r.error || '').slice(0, 60)} ch(1)commit=${committed ? '在' : '无'} 目录残留=${dirLeft}`)
  console.log(!r.ok && committed ? '【CONFIRMED】已 commit 却报失败（C1 成立）' : r.ok && dirLeft ? '【部分】ok 但目录静默残留（清理漏，弱化版 C1）' : '【REFUTED】')
  await ctx.cache.close()
} catch (e) { console.log(`P-7b 异常: ${e.message}`) }

await fs.rm(tmpRoot, { recursive: true, force: true })
