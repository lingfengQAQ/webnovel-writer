// M1-M7 review 行为探针：库级直调真实路径（persistCreateBook 建书，非测试脚手架），
// 逐条裁决候选 CONFIRMED / REFUTED。跑完自删临时目录。
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const V7 = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'v7')
const m = (p) => import(`file:///${path.join(V7, p).replace(/\\/g, '/')}`)

const { persistCreateBook, persistRepair } = await m('src/state-machine/persist.js')
const { finalizeChapter } = await m('src/finalize/index.js')
const { stageChapter, finalizeBatch, readBatch, stagedFacts, overlayBookStatus } = await m('src/staging/index.js')
const { gotoChapter } = await m('src/state-machine/flows/goto-chapter.js')
const { determineNextState } = await m('src/state-machine/index.js')
const { CacheManager } = await m('src/cache/index.js')
const { assembleBookStatus } = await m('src/prep/book-status.js')
const { EntityReader } = await m('src/storage/adapters/EntityReader.js')
const { migrateV6 } = await m('src/migrate/index.js')
const { run: listCharacters } = await m('src/commands/list-characters.js')

const verdicts = []
const V = (id, confirmed, detail) => {
  verdicts.push({ id, confirmed, detail })
  console.log(`${confirmed ? '【CONFIRMED】' : '【REFUTED】'} ${id}: ${detail}`)
}

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wnw-review-probe-'))
let n = 0

/** 真实建书：persistCreateBook + 独立 cache（不用 gitBookCtx——G-1 指其形态失真）。 */
async function makeBook(extraYaml = '') {
  const repo = path.join(tmpRoot, `book-${++n}`)
  await fs.mkdir(repo, { recursive: true })
  const ctx0 = { repoPath: repo, cache: null }
  const r = await persistCreateBook(ctx0, {
    book: { spec_version: '7.0', 书名: `探针${n}`, 类型: '玄幻', 每章目标字数: 3000, 卷规模: 40 },
    总纲: '# 总纲\n\n## 结局\n主角胜。\n',
    卷纲: '# 第1卷\n\n第一卷纲要。\n',
  })
  if (!r.ok) throw new Error(`建书失败: ${r.error}`)
  if (extraYaml) {
    const p = path.join(repo, 'book.yaml')
    await fs.writeFile(p, (await fs.readFile(p, 'utf8')) + extraYaml, 'utf8')
  }
  const cache = new CacheManager(path.join(repo, '.cache', 'index.db'))
  await cache.ensureReady(repo)
  return { repoPath: repo, cache }
}

const payloadOf = (num, extra = {}) => ({
  chapterNum: num,
  frontMatter: {
    章号: num, 标题: `第${num}章题`, 卷: 1, 书内时间: `夏月初${num}`, 字数: 100,
    章定位: '推进', 钩子: '危机钩-强', 情绪定位: '铺垫',
  },
  body: `第${num}章正文内容，情节推进一格。`,
  summary: `第${num}章摘要。`,
  commitLines: {},
  workspaceFiles: [],
  ...extra,
})

async function stage(ctx, num, extra = {}) {
  await fs.mkdir(path.join(ctx.repoPath, '工作区'), { recursive: true })
  await fs.writeFile(path.join(ctx.repoPath, '工作区', '审稿.md'), `# 第 ${num} 章审稿单\n\n> 共 0 个问题：0 阻断。\n`, 'utf8')
  const r = await stageChapter(ctx, { chapterNum: num, payload: payloadOf(num, extra) })
  if (!r.ok) throw new Error(`stage ${num} 失败: ${r.error}`)
}

// ============ P-1 (E1/D2): goto 回退 × 进行中批次 → 孤儿批次 + 定稿章号缺口 ============
try {
  const ctx = await makeBook()
  for (const c of [1, 2, 3]) {
    const r = await finalizeChapter(ctx, payloadOf(c))
    if (!r.ok) throw new Error(`定稿${c}: ${r.error}`)
  }
  await stage(ctx, 4)
  const g = await gotoChapter(ctx, { chapterNum: 2, confirm: true })
  const batch = await readBatch(ctx.repoPath)
  const next = await determineNextState(ctx)
  const fb = await finalizeBatch(ctx)
  const files = (await fs.readdir(path.join(ctx.repoPath, '定稿', '正文'))).sort()
  const nums = files.map((f) => Number(f.slice(0, 4)))
  const hasGap = fb.ok && nums.includes(4) && !nums.includes(3)
  V('P-1 goto×批次(E1)', g.ok && batch.exists && hasGap,
    `goto2=${g.ok} 批次残留=${batch.exists} next序=${next.序} finalizeBatch.ok=${fb.ok} 定稿=[${nums}]${hasGap ? ' ← 缺第3章，断档确认' : ''}`)
  await ctx.cache.close()
} catch (e) { V('P-1 goto×批次(E1)', false, `探针异常: ${e.message}`) }

// ============ P-2 (E2): 批次进行中手动 finalize 同章 → 双计 + finalize-batch 卡死 ============
try {
  const ctx = await makeBook()
  await finalizeChapter(ctx, payloadOf(1))
  await stage(ctx, 2, { threadCreates: [{ id: '伏笔-201', 短题: '试线', frontMatter: { 强度: '中', 状态: '进行', 开启章: 2 }, body: '## 描述\n试。\n\n## 收尾计划\n第9章。\n\n## 履历\n- 第2章：埋下\n' }] })
  const manual = await finalizeChapter(ctx, payloadOf(2, { threadCreates: [{ id: '伏笔-201', 短题: '试线', frontMatter: { 强度: '中', 状态: '进行', 开启章: 2 }, body: '## 描述\n试。\n\n## 收尾计划\n第9章。\n\n## 履历\n- 第2章：埋下\n' }] }))
  const status = await assembleBookStatus(ctx)
  const facts = await stagedFacts(ctx.repoPath)
  const overlaid = overlayBookStatus(status.data ?? status, facts)
  const 总章数 = overlaid?.总章数 ?? overlaid?.data?.总章数
  const fb = await finalizeBatch(ctx)
  V('P-2 手动finalize×批次(E2)', manual.ok && !fb.ok,
    `手动finalize2.ok=${manual.ok} overlay总章数=${总章数}(定稿2+staged1=双计) finalizeBatch.ok=${fb.ok} err=${(fb.error || '').slice(0, 60)}`)
  await ctx.cache.close()
} catch (e) { V('P-2 手动finalize×批次(E2)', false, `探针异常: ${e.message}`) }

// ============ P-3 (D1): persistRepair 修 book.yaml 被 front matter 校验拒绝 ============
try {
  const ctx = await makeBook('卷规模: 40\n') // 追加重复键 → YAML 解析失败
  const next = await determineNextState(ctx)
  const failures = next.dto?.failures?.map((f) => f.file) || []
  const good = 'spec_version: "7.0"\n书名: 探针修复\n类型: 玄幻\n每章目标字数: 3000\n卷规模: 40\n'
  const rep = await persistRepair(ctx, { repairs: [{ file: 'book.yaml', content: good }] }, { allowedFiles: failures })
  V('P-3 persistRepair锁死(D1)', next.序 === 0 && failures.includes('book.yaml') && !rep.ok,
    `序=${next.序} failures=[${failures}] 合法修复被拒=${!rep.ok} err=${(rep.error || '').slice(0, 60)}`)
  await ctx.cache.close()
} catch (e) { V('P-3 persistRepair锁死(D1)', false, `探针异常: ${e.message}`) }

// ============ P-4 (B1): 坏章 rebuild 静默截断 → MAX 偏小 → next 重抄本章 ============
try {
  const ctx = await makeBook()
  for (const c of [1, 2, 3]) await finalizeChapter(ctx, payloadOf(c))
  const chDir = path.join(ctx.repoPath, '定稿', '正文')
  const f3 = (await fs.readdir(chDir)).find((f) => f.startsWith('0003-'))
  await fs.writeFile(path.join(chDir, f3), '---\n章号: [broken\n---\n正文', 'utf8')
  const rb = await ctx.cache.rebuildFromSource(ctx.repoPath)
  const max = (await ctx.cache.query('SELECT MAX(chapter_num) AS m FROM chapters', []))[0].m
  const next = await determineNextState(ctx)
  V('P-4 rebuild静默截断(B1)', rb.ok !== false && !(rb.warnings || []).length && max === 2 && next.dto?.nextChapter === 3,
    `rebuild.ok=${rb.ok} warnings=${(rb.warnings || []).length} MAX=${max} next序=${next.序} nextChapter=${next.dto?.nextChapter}（=3 即重抄已存在第3章）`)
  await ctx.cache.close()
} catch (e) { V('P-4 rebuild静默截断(B1)', false, `探针异常: ${e.message}`) }

// ============ P-5 (G2): migrate 名册中文类型 → 迁移书角色全不可见 ============
try {
  const workdir = path.join(tmpRoot, 'workdir-g2')
  await fs.mkdir(path.join(workdir, '.webnovel'), { recursive: true })
  const { tempV6Sqlite } = await m('test/migrate/_v6.js')
  const v6 = await tempV6Sqlite()
  const mig = await migrateV6({ workdir }, v6.v6Path)
  const repo = path.join(workdir, '潮汐之下')
  const cache = new CacheManager(path.join(repo, '.cache', 'index.db'))
  await cache.ensureReady(repo)
  const ctx = { repoPath: repo, cache }
  const lc = await listCharacters([], {}, ctx)
  const rows = await cache.query("SELECT id, type FROM entities", [])
  const invisible = lc.ok && !(lc.output || '').includes('江遥')
  V('P-5 迁移角色不可见(G2)', mig.ok && invisible,
    `migrate.ok=${mig.ok} list-characters含江遥=${!invisible} entities.type=[${rows.map((r) => r.type).join(',')}]`)
  await cache.close()
  await v6.cleanup()
} catch (e) { V('P-5 迁移角色不可见(G2)', false, `探针异常: ${e.message}`) }

// ============ P-6 (A5 抽查): 名册中文分隔别名 → resolveAlias 全 MISS ============
try {
  const ctx = await makeBook()
  await fs.mkdir(path.join(ctx.repoPath, '定稿', '设定'), { recursive: true })
  await fs.writeFile(path.join(ctx.repoPath, '定稿', '设定', '名册.md'),
    '| 正名 | 别名 | 类型 | 首现章 |\n|---|---|---|---|\n| 林晚 | 阿晚，晚儿、小晚 | character | 1 |\n', 'utf8')
  await ctx.cache.rebuildFromSource(ctx.repoPath)
  const er = new EntityReader(ctx.repoPath, ctx.cache)
  const hits = []
  for (const a of ['阿晚', '晚儿', '小晚']) hits.push((await er.resolveAlias(a)).ok)
  V('P-6 别名中文分隔(A5)', hits.every((h) => !h), `resolveAlias(阿晚/晚儿/小晚)=[${hits}]（全 false 即全 MISS）`)
  await ctx.cache.close()
} catch (e) { V('P-6 别名中文分隔(A5)', false, `探针异常: ${e.message}`) }

// ============ P-7 (C1): finalize workspaceFiles 含目录 → 已 commit 却误报失败 ============
try {
  const ctx = await makeBook()
  await fs.mkdir(path.join(ctx.repoPath, '工作区', '评审报告'), { recursive: true })
  await fs.writeFile(path.join(ctx.repoPath, '工作区', '评审报告', 'a.md'), 'x', 'utf8')
  const r = await finalizeChapter(ctx, payloadOf(1, { workspaceFiles: ['工作区/评审报告'] }))
  const { createGit } = await m('src/finalize/git.js')
  const git = createGit(ctx.repoPath)
  const committed = await git.findChapterCommit(1)
  V('P-7 finalize误报失败(C1)', !r.ok && !!committed,
    `finalize.ok=${r.ok} err=${(r.error || '').slice(0, 50)} 但 ch(1) commit=${committed ? '已存在' : '无'}`)
  await ctx.cache.close()
} catch (e) { V('P-7 finalize误报失败(C1)', false, `探针异常: ${e.message}`) }

// ============ 汇总 ============
console.log('\n===== 裁决汇总 =====')
for (const v of verdicts) console.log(`${v.confirmed ? 'CONFIRMED' : 'REFUTED  '} | ${v.id}`)
await fs.rm(tmpRoot, { recursive: true, force: true })
